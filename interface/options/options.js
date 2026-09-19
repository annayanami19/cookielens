/**
 * CookieLens — options page controller.
 *
 * Every control persists immediately through storage-handler.setOptions.
 * The "everywhere" actions (export / delete all / backup) run in the service
 * worker via runtime messages; the backup list, profile list and file
 * downloads are handled on this page (extension pages may read
 * chrome.storage directly — backups.js and profiles.js do exactly that).
 */

import { api } from '../../lib/browser-detector.js';
import { applyI18n, t } from '../../lib/i18n.js';
import * as jsonFormat from '../../lib/formats/json-format.js';
import * as netscapeFormat from '../../lib/formats/netscape-format.js';
import { downloadText } from '../../lib/download.js';
import { getOptions, setOptions } from '../../lib/storage-handler.js';
import * as profiles from '../../lib/profiles.js';
import * as backups from '../../lib/backups.js';
import { showToast } from '../../lib/toast.js';

const DELETE_CONFIRM_TEXT = 'DELETE';

const state = {
  options: {},
};

const $ = (id) => document.getElementById(id);

/**
 * Entry point.
 */
async function init() {
  applyI18n();
  document.title = `${t('extName')} — ${t('optionsTitle')}`;

  const version = api.runtime.getManifest().version;
  $('version').textContent = `v${version}`;
  $('about-version').textContent = `${t('extName')} v${version}`;

  try {
    state.options = await getOptions();
  } catch {
    state.options = {};
  }
  hydrateControls();
  wireEvents();
  await renderProfileList();
  await renderBackupList();
}

/**
 * Mirror the current options into the form controls and the theme.
 */
function hydrateControls() {
  applyDisplay();
  $('opt-opentarget').value = state.options.openTarget ?? 'panel';
  $('opt-theme').value = state.options.theme ?? 'auto';
  $('opt-advanced').checked = Boolean(state.options.advanced);
  $('opt-animations').checked = state.options.animations !== false;
  $('opt-barpos').value = state.options.buttonBarPosition ?? 'bottom';
  $('opt-extrainfo').value = state.options.extraInfo ?? 'value';
  $('opt-exportformat').value = state.options.exportFormat ?? 'json';
  $('opt-autobackup').checked = state.options.autoBackup !== false;
}

/**
 * Apply the display-only options (theme + animations) to this page.
 */
function applyDisplay() {
  const root = document.documentElement;
  root.dataset.theme = state.options.theme === 'auto' ? '' : state.options.theme;
  root.classList.toggle('no-anim', state.options.animations === false);
}

/**
 * Attach every event listener once.
 */
function wireEvents() {
  $('opt-opentarget').addEventListener('change', (event) => persist({ openTarget: event.target.value }));
  $('opt-theme').addEventListener('change', (event) => persist({ theme: event.target.value }));
  $('opt-advanced').addEventListener('change', (event) => persist({ advanced: event.target.checked }));
  $('opt-animations').addEventListener('change', (event) => persist({ animations: event.target.checked }));
  $('opt-barpos').addEventListener('change', (event) => persist({ buttonBarPosition: event.target.value }));
  $('opt-extrainfo').addEventListener('change', (event) => persist({ extraInfo: event.target.value }));
  $('opt-exportformat').addEventListener('change', (event) => persist({ exportFormat: event.target.value }));
  $('opt-autobackup').addEventListener('change', (event) => persist({ autoBackup: event.target.checked }));

  $('export-all-json-btn').addEventListener('click', () => exportAll('json'));
  $('export-all-netscape-btn').addEventListener('click', () => exportAll('netscape'));

  $('backup-now-btn').addEventListener('click', onBackupNow);

  $('delete-all-confirm').addEventListener('input', (event) => {
    $('delete-all-everywhere-btn').disabled = event.target.value.trim() !== DELETE_CONFIRM_TEXT;
  });
  $('delete-all-everywhere-btn').addEventListener('click', onDeleteAllEverywhere);

  // Keep this page in sync when another tab/window changes the options, the
  // stored profiles or the backups (e.g. a backup taken in the popup).
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (changes.options?.newValue) {
      Object.assign(state.options, changes.options.newValue);
      hydrateControls();
    }
    if (changes.profiles) {
      renderProfileList();
    }
    if (changes.backups) {
      renderBackupList();
    }
  });
}

/* ------------------------------------------------------------------ *
 * Profiles — read-only management: download as JSON file, delete.
 * Restoring (merge/replace) lives in the popup, on the target site.
 * ------------------------------------------------------------------ */

/**
 * Render the stored profiles, newest first.
 */
async function renderProfileList() {
  const container = $('options-profile-list');
  container.replaceChildren();

  let list = [];
  try {
    list = await profiles.listProfiles();
  } catch (error) {
    showToast(t('commonErrorLoadProfiles', [error.message]), 'error');
    return;
  }

  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = t('popupProfilesEmpty');
    container.append(empty);
    return;
  }
  for (const profile of list) {
    container.append(buildProfileRow(profile));
  }
}

/**
 * Build one profile row (name, domain/global, count, saved date) with
 * Download JSON and Delete actions — createElement/textContent only.
 * @param {object} profile
 * @returns {HTMLElement}
 */
function buildProfileRow(profile) {
  const rowEl = document.createElement('div');
  rowEl.className = 'profile-row';

  const top = document.createElement('div');
  top.className = 'profile-top';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'profile-name-text';
  nameSpan.textContent = profile.name;
  const meta = document.createElement('span');
  meta.className = 'profile-meta';
  const count = (profile.cookies ?? []).length;
  meta.textContent = [
    profile.domain || t('commonGlobal'),
    t('commonCookieCount', [count]),
    t('commonSavedAt', [formatTimestamp(profile.createdAt)]),
  ].join(' · ');
  top.append(nameSpan, meta);

  const actions = document.createElement('div');
  actions.className = 'profile-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn btn-mini';
  downloadBtn.textContent = t('commonDownloadJson');
  downloadBtn.addEventListener('click', () => onDownloadProfile(profile));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-mini danger';
  deleteBtn.textContent = t('commonDelete');
  deleteBtn.addEventListener('click', () => onDeleteProfile(profile));

  actions.append(downloadBtn, deleteBtn);
  rowEl.append(top, actions);
  return rowEl;
}

/**
 * Download a profile's cookies as `cookie-profile-<name>.json`.
 * @param {object} profile
 */
function onDownloadProfile(profile) {
  try {
    const cookies = profile.cookies ?? [];
    const safeName =
      String(profile.name)
        .trim()
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'profile';
    downloadText(`cookie-profile-${safeName}.json`, jsonFormat.serialize(cookies));
    showToast(t('optionsProfileDownloaded', [profile.name, t('commonCookieCount', [cookies.length])]), 'success');
  } catch (error) {
    showToast(t('optionsErrorDownloadProfile', [error.message]), 'error');
  }
}

/**
 * Delete a profile and refresh the list.
 * @param {object} profile
 */
async function onDeleteProfile(profile) {
  try {
    await profiles.deleteProfile(profile.id);
    showToast(t('commonProfileDeleted', [profile.name]), 'success');
    await renderProfileList();
  } catch (error) {
    showToast(t('commonErrorProfileDelete', [error.message]), 'error');
  }
}

/**
 * Format an epoch-milliseconds timestamp as "YYYY-MM-DD HH:mm" (local time).
 * @param {number} ms
 * @returns {string}
 */
function formatTimestamp(ms) {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ------------------------------------------------------------------ *
 * Backups — toggle, snapshot now, and per-date download/restore/delete.
 * Listing/reading/deleting touch storage directly via lib/backups.js; the
 * snapshot and the merge-restore run in the service worker.
 * ------------------------------------------------------------------ */

/**
 * Render the stored backups (date + cookie count) with Download / Restore /
 * Delete actions, newest first.
 */
async function renderBackupList() {
  const container = $('backup-list');
  container.replaceChildren();

  let list = [];
  try {
    list = await backups.listBackups();
  } catch (error) {
    showToast(t('backupsError', [error.message]), 'error');
    return;
  }

  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = t('backupsEmpty');
    container.append(empty);
    return;
  }
  for (const backup of list) {
    container.append(buildBackupRow(backup));
  }
}

/**
 * Build one backup row: date + count plus Download JSON / Restore / Delete.
 * @param {{date: string, count: number, cookies: Array<object>}} backup
 * @returns {HTMLElement}
 */
function buildBackupRow(backup) {
  const rowEl = document.createElement('div');
  rowEl.className = 'profile-row';

  const top = document.createElement('div');
  top.className = 'profile-top';
  const dateSpan = document.createElement('span');
  dateSpan.className = 'profile-name-text';
  dateSpan.textContent = backup.date;
  const meta = document.createElement('span');
  meta.className = 'profile-meta';
  meta.textContent = t('commonCookieCount', [backup.count ?? (backup.cookies ?? []).length]);
  top.append(dateSpan, meta);

  const actions = document.createElement('div');
  actions.className = 'profile-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'btn btn-mini';
  downloadBtn.textContent = t('commonDownloadJson');
  downloadBtn.addEventListener('click', () => onDownloadBackup(backup));

  const restoreBtn = document.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.className = 'btn btn-mini';
  restoreBtn.textContent = t('commonRestore');
  restoreBtn.addEventListener('click', () => onRestoreBackup(backup));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-mini danger';
  deleteBtn.textContent = t('commonDelete');
  deleteBtn.addEventListener('click', () => onDeleteBackup(backup));

  actions.append(downloadBtn, restoreBtn, deleteBtn);
  rowEl.append(top, actions);
  return rowEl;
}

/**
 * "Back up now": ask the service worker to snapshot every cookie, then
 * refresh the list.
 */
async function onBackupNow() {
  try {
    const response = await sendMessage({ type: 'runBackupNow' });
    const date = response?.date ?? '';
    const count = response?.count ?? 0;
    showToast(t('backupsSaved', [date, t('commonCookieCount', [count])]), 'success');
    await renderBackupList();
  } catch (error) {
    showToast(t('backupsError', [error.message]), 'error');
  }
}

/**
 * Download one backup as `cookie-backup-<date>.json`.
 * @param {{date: string, cookies: Array<object>}} backup
 */
function onDownloadBackup(backup) {
  try {
    downloadText(`cookie-backup-${backup.date}.json`, jsonFormat.serialize(backup.cookies ?? []));
    showToast(t('backupsDownloaded', [backup.date]), 'success');
  } catch (error) {
    showToast(t('backupsError', [error.message]), 'error');
  }
}

/**
 * Restore one backup as a merge: every cookie is re-set through the service
 * worker (existing cookies with the same name/domain/path are overwritten).
 * @param {{date: string, cookies: Array<object>}} backup
 */
async function onRestoreBackup(backup) {
  try {
    const response = await sendMessage({ type: 'restoreBackup', cookies: backup.cookies ?? [] });
    const imported = response?.imported ?? 0;
    const failed = response?.failed ?? 0;
    const suffix = failed > 0 ? `, ${t('commonFailedCount', [failed])}` : '';
    showToast(`${t('backupsRestored', [imported, backup.date])}${suffix}.`, failed > 0 ? 'error' : 'success');
  } catch (error) {
    showToast(t('backupsErrorRestore', [error.message]), 'error');
  }
}

/**
 * Delete one backup and refresh the list.
 * @param {{date: string}} backup
 */
async function onDeleteBackup(backup) {
  try {
    await backups.deleteBackup(backup.date);
    showToast(t('backupsDeleted', [backup.date]), 'success');
    await renderBackupList();
  } catch (error) {
    showToast(t('backupsErrorDelete', [error.message]), 'error');
  }
}

/* ------------------------------------------------------------------ *
 * General persistence + browser-wide actions.
 * ------------------------------------------------------------------ */

/**
 * Apply the patch locally (instant feedback), then persist it.
 * @param {object} patch partial options
 */
async function persist(patch) {
  Object.assign(state.options, patch);
  applyDisplay();
  try {
    await setOptions(patch);
  } catch (error) {
    showToast(t('optionsErrorSaveOption', [error.message]), 'error');
  }
}

/**
 * Export every cookie of every cookie store as a downloaded file.
 * @param {'json'|'netscape'} format
 */
async function exportAll(format) {
  try {
    const response = await sendMessage({ type: 'getAllCookiesEverywhere' });
    const cookies = response?.cookies ?? [];
    const stamp = localDateStamp();
    if (format === 'netscape') {
      downloadText(`cookies-all-${stamp}.txt`, netscapeFormat.serialize(cookies));
    } else {
      downloadText(`cookies-all-${stamp}.json`, jsonFormat.serialize(cookies));
    }
    showToast(
      t('optionsExportedAll', [cookies.length, response?.storeCount ?? 1]),
      'success'
    );
  } catch (error) {
    showToast(t('commonExportFailed', [error.message]), 'error');
  }
}

/**
 * Delete every cookie of every cookie store after the typed confirmation.
 */
async function onDeleteAllEverywhere() {
  const button = $('delete-all-everywhere-btn');
  if (button.disabled) {
    return;
  }
  try {
    const response = await sendMessage({ type: 'removeAllCookiesEverywhere' });
    const removed = response?.removed ?? 0;
    const failed = response?.failed ?? 0;
    const skipped = response?.skipped ?? 0;
    // Protected cookies are skipped by the service worker; mention them.
    const parts = [t('commonDeletedCount', [removed])];
    if (skipped > 0) {
      parts.push(t('commonSkippedProtected', [skipped]));
    }
    if (failed > 0) {
      parts.push(t('commonFailedCount', [failed]));
    }
    showToast(`${parts.join(', ')}.`, failed > 0 ? 'error' : 'success');
  } catch (error) {
    showToast(t('optionsErrorDeleteAll', [error.message]), 'error');
  } finally {
    $('delete-all-confirm').value = '';
    button.disabled = true;
  }
}

/**
 * Local "YYYY-MM-DD" stamp used in download file names.
 * @returns {string}
 */
function localDateStamp() {
  const now = new Date();
  const pad = (part) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Send a message to the service worker and resolve with its response.
 * @param {object} message
 * @returns {Promise<object>}
 * @throws {Error} when the worker answered with {error}
 */
async function sendMessage(message) {
  const response = await api.runtime.sendMessage(message);
  if (response?.error) {
    throw new Error(response.error);
  }
  return response;
}

init();
