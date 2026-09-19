/**
 * CookieLens — shared cookie-list UI controller.
 *
 * The same module powers the toolbar popup, the Chrome side panel and the
 * DevTools panel (see CONTEXT). Mutations (save/remove/import) always go
 * through the service worker via runtime messages. Deliberate deviations
 * from "UI never touches APIs": this page listens to cookies.onChanged
 * itself for live refresh, calls chrome.permissions directly because
 * permission requests need a user gesture, and reads storage.onChanged so
 * Options-page changes apply without reopening.
 *
 * All user-facing text goes through lib/i18n.js: static HTML via
 * applyI18n()/data-i18n attributes at init, generated strings via t().
 */

import { api } from '../../lib/browser-detector.js';
import { Emitter } from '../../lib/emitter.js';
import {
  buildCookieForSet,
  datetimeLocalToUnix,
  hostnameOf,
  isWebUrl,
  originOf,
  sortBy,
  unixToDatetimeLocal,
} from '../../lib/cookie.js';
import { applyI18n, t } from '../../lib/i18n.js';
import { detectFormat } from '../../lib/format-detector.js';
import * as jsonFormat from '../../lib/formats/json-format.js';
import * as netscapeFormat from '../../lib/formats/netscape-format.js';
import * as headerstringFormat from '../../lib/formats/headerstring-format.js';
import * as curlFormat from '../../lib/formats/curl-format.js';
import { downloadText } from '../../lib/download.js';
import { getOptions, setOptions } from '../../lib/storage-handler.js';
import {
  FLAG_PINS,
  FLAG_PROTECTED,
  clearFlag,
  getFlagMap,
  isFlagged,
  setFlag,
} from '../../lib/flags.js';
import * as profiles from '../../lib/profiles.js';
import { showToast } from '../../lib/toast.js';

const REFRESH_DEBOUNCE_MS = 150;
const DELETE_ALL_ARM_MS = 3000;
const COPIED_FEEDBACK_MS = 1500;
const VALUE_MAX_CHARS = 28;

/**
 * Which container hosts this UI. DevTools pages expose chrome.devtools;
 * the action popup window is listed by extension.getViews({type:'popup'});
 * everything else is the side panel.
 * @type {'popup'|'sidepanel'|'devtools'}
 */
const CONTEXT = api.devtools?.inspectedWindow
  ? 'devtools'
  : (api.extension?.getViews({ type: 'popup' }) ?? []).includes(window)
    ? 'popup'
    : 'sidepanel';
document.documentElement.classList.add(`ctx-${CONTEXT}`);

const EXPORT_SERIALIZERS = {
  json: { labelKey: 'exportFormatJson', serialize: (cookies) => jsonFormat.serialize(cookies) },
  netscape: { labelKey: 'exportFormatNetscape', serialize: (cookies) => netscapeFormat.serialize(cookies) },
  headerstring: {
    labelKey: 'exportFormatHeaderString',
    serialize: (cookies) => headerstringFormat.serialize(cookies),
  },
  'curl-bash': {
    labelKey: 'exportFormatCurlBash',
    serialize: (cookies) => curlFormat.serialize(cookies, { url: state.tab?.url ?? '', shell: 'bash' }),
  },
  'curl-cmd': {
    labelKey: 'exportFormatCurlCmd',
    serialize: (cookies) => curlFormat.serialize(cookies, { url: state.tab?.url ?? '', shell: 'cmd' }),
  },
};

const SINGLE_COOKIE_JSON_KEYS = [
  'domain',
  'expirationDate',
  'hostOnly',
  'httpOnly',
  'name',
  'path',
  'sameSite',
  'secure',
  'session',
  'value',
];

const bus = new Emitter();
const state = {
  tab: null,
  cookies: [],
  filter: '',
  editing: null,
  deleteAllArmed: false,
  exportBusy: false,
  options: {},
  /** Full pins map from storage: domain key → [cookieName]. */
  pins: {},
  /** Full protected map from storage: domain key → [cookieName]. */
  protected: {},
  /** Names of selected cookies for the contextual bulk bar (popup lifetime). */
  selected: new Set(),
};

let refreshTimer = null;
let deleteAllTimer = null;
let copiedTimer = null;
/** Open menu → the button whose aria-expanded mirrors its state. */
const menuControls = new WeakMap();

const $ = (id) => document.getElementById(id);

bus.on('cookies:updated', renderList);

/**
 * Entry point.
 */
async function init() {
  applyI18n();
  document.title = t('extName');
  $('version').textContent = `v${api.runtime.getManifest().version}`;
  wireEvents();

  let options = {};
  try {
    options = await getOptions();
  } catch {
    // Defaults are fine when storage is unavailable.
  }
  applyOptions(options);

  if (CONTEXT === 'popup' && typeof api.sidePanel?.open === 'function') {
    $('open-sidepanel-btn').hidden = false;
  }

  await resolveTab();
}

/**
 * Attach every event listener once.
 */
function wireEvents() {
  menuControls.set($('options-menu'), $('options-btn'));
  menuControls.set($('export-menu'), $('export-menu-btn'));

  $('options-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    hideMenu($('export-menu'));
    toggleMenu($('options-menu'));
  });

  $('open-sidepanel-btn').addEventListener('click', async () => {
    hideMenu($('options-menu'));
    try {
      await api.sidePanel.open({ windowId: state.tab?.windowId });
      window.close();
    } catch (error) {
      showToast(t('popupErrorOpenSidePanel', [error.message]), 'error');
    }
  });

  $('open-options-btn').addEventListener('click', () => {
    hideMenu($('options-menu'));
    api.runtime.openOptionsPage();
  });

  $('advanced-toggle').addEventListener('change', async (event) => {
    syncFormAdvanced();
    await persistOptions({ advanced: event.target.checked });
  });

  $('allow-site-btn').addEventListener('click', async () => {
    if (!state.tab?.url) {
      return;
    }
    const granted = await requestPermissions([`${originOf(state.tab.url)}/*`]);
    if (granted) {
      await enterMainScreen();
    }
  });

  $('allow-all-btn').addEventListener('click', async () => {
    const granted = await requestPermissions(['<all_urls>']);
    if (granted) {
      await enterMainScreen();
    }
  });

  $('search').addEventListener('input', (event) => {
    state.filter = event.target.value;
    renderList();
  });

  $('sort-column').addEventListener('change', (event) => {
    persistOptions({ sortColumn: event.target.value });
  });

  $('sort-direction').addEventListener('click', () => {
    const next = (state.options.sortDirection ?? 'asc') === 'asc' ? 'desc' : 'asc';
    persistOptions({ sortDirection: next });
  });

  $('add-btn').addEventListener('click', () => openForm('new'));
  $('form-cancel').addEventListener('click', closeForm);
  $('cookie-form').addEventListener('submit', onSaveForm);

  $('form-hostonly').addEventListener('change', syncFormAdvanced);
  $('form-session').addEventListener('change', syncFormAdvanced);
  $('form-samesite').addEventListener('change', (event) => {
    // Chrome refuses SameSite=no_restriction without the Secure flag.
    if (event.target.value === 'no_restriction') {
      $('form-secure').checked = true;
    }
  });
  for (const button of document.querySelectorAll('[data-expiry]')) {
    button.addEventListener('click', () => {
      $('form-session').checked = false;
      syncFormAdvanced();
      $('form-expiration').value = unixToDatetimeLocal(Math.floor(Date.now() / 1000) + Number(button.dataset.expiry));
    });
  }

  $('delete-all-btn').addEventListener('click', onDeleteAll);
  $('import-btn').addEventListener('click', openImport);
  $('import-cancel').addEventListener('click', closeImport);
  $('import-submit').addEventListener('click', onImport);

  $('import-file-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', onImportFile);

  $('bulk-toggle-all').addEventListener('click', onBulkToggleAll);
  $('bulk-export').addEventListener('click', onBulkExport);
  $('bulk-delete').addEventListener('click', onBulkDelete);
  $('bulk-cancel').addEventListener('click', onBulkCancel);

  $('profiles-btn').addEventListener('click', () => {
    if ($('profiles-panel').hidden) {
      openProfiles();
    } else {
      closeProfiles();
    }
  });
  $('profiles-cancel').addEventListener('click', closeProfiles);
  $('profile-save').addEventListener('click', onSaveProfile);
  $('profile-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onSaveProfile();
    }
  });

  $('export-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    onExportMainClick();
  });
  $('export-menu-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    hideMenu($('options-menu'));
    toggleMenu($('export-menu'));
  });
  for (const item of document.querySelectorAll('#export-menu .menu-item')) {
    item.addEventListener('click', () => {
      const key = item.dataset.export ?? '';
      if (key.endsWith('-file')) {
        exportAsFile(key.slice(0, -'-file'.length));
      } else {
        exportAs(key);
      }
    });
  }

  document.addEventListener('click', (event) => {
    for (const menu of [$('options-menu'), $('export-menu')]) {
      if (!menu.hidden && !menu.parentElement.contains(event.target)) {
        hideMenu(menu);
      }
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideMenu($('options-menu'));
      hideMenu($('export-menu'));
    }
  });

  // Live options: changes made on the Options page apply immediately.
  // Pin/protect map changes (own toggles or another container) re-render too.
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (changes.options?.newValue) {
      applyOptions(changes.options.newValue);
      renderList();
    }
    if (changes.pins) {
      state.pins = changes.pins.newValue ?? {};
    }
    if (changes.protected) {
      state.protected = changes.protected.newValue ?? {};
    }
    if (changes.pins || changes.protected) {
      renderList();
    }
  });

  api.cookies.onChanged.addListener((changeInfo) => {
    if (changeInfo.cause === 'overwrite') {
      return;
    }
    if (!state.tab?.url || $('screen-main').hidden) {
      return;
    }
    const host = hostnameOf(state.tab.url).toLowerCase();
    const domain = String(changeInfo.cookie?.domain ?? '').replace(/^\./, '').toLowerCase();
    if (domain && (host === domain || host.endsWith(`.${domain}`))) {
      scheduleRefresh();
    }
  });
}

/* ------------------------------------------------------------------ *
 * Screens: restricted / permission / main.
 * ------------------------------------------------------------------ */

/**
 * Resolve the target tab and pick the screen to show. DevTools panels name
 * their inspected tab explicitly; the popup and the side panel use the
 * active tab of the current window.
 */
async function resolveTab() {
  let tab = null;
  try {
    if (CONTEXT === 'devtools') {
      const response = await sendMessage({ type: 'getTabById', tabId: api.devtools.inspectedWindow.tabId });
      tab = response?.tab ?? null;
    } else {
      const response = await sendMessage({ type: 'getCurrentTab' });
      tab = response?.tab ?? null;
    }
  } catch (error) {
    console.error('[CEP] could not resolve the target tab', error);
  }

  if (!tab?.url || !isWebUrl(tab.url)) {
    showScreen('restricted');
    return;
  }
  state.tab = tab;

  let allowed = false;
  try {
    allowed = await api.permissions.contains({ origins: [`${originOf(tab.url)}/*`] });
  } catch (error) {
    console.error('[CEP] permissions.contains failed', error);
  }

  if (allowed) {
    await enterMainScreen();
  } else {
    $('permission-text').textContent = t('popupPermissionText', [hostnameOf(tab.url)]);
    showScreen('permission');
  }
}

/**
 * Request optional host permissions. Must run inside a user gesture.
 * @param {string[]} patterns match patterns such as "https://example.com/*"
 * @returns {Promise<boolean>} true when the user granted them
 */
async function requestPermissions(patterns) {
  try {
    return await api.permissions.request({ origins: patterns });
  } catch {
    // Outside a user gesture the request throws — treat it as denied.
    return false;
  }
}

/**
 * Switch to the main screen and load the cookie list.
 */
async function enterMainScreen() {
  showScreen('main');
  await loadFlags();
  await loadCookies();
}

/**
 * Load the pin/protect maps for the initial render; storage.onChanged keeps
 * them fresh afterwards.
 */
async function loadFlags() {
  try {
    const [pins, protectedMap] = await Promise.all([getFlagMap(FLAG_PINS), getFlagMap(FLAG_PROTECTED)]);
    state.pins = pins;
    state.protected = protectedMap;
  } catch (error) {
    console.error('[CEP] could not load the cookie flags', error);
  }
}

/**
 * Show exactly one of the three screens.
 * @param {'permission'|'restricted'|'main'} name
 */
function showScreen(name) {
  $('screen-permission').hidden = name !== 'permission';
  $('screen-restricted').hidden = name !== 'restricted';
  $('screen-main').hidden = name !== 'main';
}

/* ------------------------------------------------------------------ *
 * Options (theme, sorting, layout) — applied live from storage.
 * ------------------------------------------------------------------ */

/**
 * Apply a persisted options object to the UI.
 * @param {object} options merged options from storage-handler
 */
function applyOptions(options) {
  state.options = options;

  const root = document.documentElement;
  root.dataset.theme = options.theme === 'auto' ? '' : options.theme;
  root.classList.toggle('no-anim', options.animations === false);
  document.body.classList.toggle('bar-top', options.buttonBarPosition === 'top');

  $('advanced-toggle').checked = Boolean(options.advanced);
  $('sort-column').value = options.sortColumn ?? 'name';
  $('sort-direction').textContent = (options.sortDirection ?? 'asc') === 'desc' ? '↓' : '↑';

  syncFormAdvanced();
  sortCookies();
}

/**
 * Patch the persisted options: update local state + UI immediately, then
 * persist in the background.
 * @param {object} patch
 */
async function persistOptions(patch) {
  Object.assign(state.options, patch);
  applyOptions(state.options);
  renderList();
  try {
    await setOptions(patch);
  } catch (error) {
    console.error('[CEP] could not persist options', error);
  }
}

/* ------------------------------------------------------------------ *
 * Cookie list.
 * ------------------------------------------------------------------ */

/**
 * Fetch the tab's cookies through the service worker and re-render.
 */
async function loadCookies() {
  if (!state.tab?.url) {
    return;
  }
  try {
    const response = await sendMessage({ type: 'getAllCookies', url: state.tab.url });
    state.cookies = response?.cookies ?? [];
    pruneSelection();
    sortCookies();
    bus.emit('cookies:updated');
  } catch (error) {
    showToast(t('popupErrorLoadCookies', [error.message]), 'error');
  }
}

/**
 * (Re-)sort the full list with the persisted column/direction. Pinned
 * cookies (per their own domain key) are partitioned to the front and sorted
 * among themselves; the rest follows. Filtering in renderList() happens
 * afterwards, so sorting always covers every cookie.
 */
function sortCookies() {
  const column = state.options.sortColumn ?? 'name';
  const direction = state.options.sortDirection ?? 'asc';
  const pinned = [];
  const rest = [];
  for (const cookie of state.cookies) {
    (isFlagged(state.pins, cookie) ? pinned : rest).push(cookie);
  }
  state.cookies = [...sortBy(pinned, column, direction), ...sortBy(rest, column, direction)];
}

/**
 * Drop selected names that no longer exist in the loaded list (e.g. deleted
 * from elsewhere), then sync the bulk bar.
 */
function pruneSelection() {
  if (state.selected.size === 0) {
    return;
  }
  const present = new Set(state.cookies.map((cookie) => cookie.name));
  for (const name of [...state.selected]) {
    if (!present.has(name)) {
      state.selected.delete(name);
    }
  }
}

/**
 * Debounced refresh triggered by cookies.onChanged.
 */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(loadCookies, REFRESH_DEBOUNCE_MS);
}

/**
 * Render the (filtered) cookie list into the list container.
 */
function renderList() {
  const container = $('cookie-list');
  container.replaceChildren();

  const visible = filterCookies(state.cookies, state.filter);
  if (visible.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = state.cookies.length === 0 ? t('popupEmptyNone') : t('popupEmptyNoMatch');
    container.append(empty);
    return;
  }

  for (const cookie of visible) {
    container.append(buildRow(cookie));
  }
  updateBulkBar();
}

/**
 * Filter cookies by name, domain or value (case-insensitive).
 * @param {Array<object>} cookies
 * @param {string} filter
 * @returns {Array<object>}
 */
function filterCookies(cookies, filter) {
  const needle = filter.trim().toLowerCase();
  if (!needle) {
    return cookies;
  }
  return cookies.filter((cookie) =>
    (cookie.name || '').toLowerCase().includes(needle) ||
    (cookie.domain || '').toLowerCase().includes(needle) ||
    (cookie.value || '').toLowerCase().includes(needle)
  );
}

/**
 * Build one cookie row from the <template>, using textContent only
 * (cookie names/values are untrusted page data). Every aria-label and
 * tooltip is (re)set from t() because applyI18n() cannot reach into
 * template content.
 * @param {object} cookie
 * @returns {Node}
 */
function buildRow(cookie) {
  const row = $('tpl-cookie-row').content.cloneNode(true);
  const rowEl = row.querySelector('.cookie-row');
  const pinned = isFlagged(state.pins, cookie);
  rowEl.classList.toggle('pinned', pinned);

  // Leading checkbox for the contextual bulk bar (selection keyed by name).
  const checkbox = row.querySelector('.row-select');
  checkbox.checked = state.selected.has(cookie.name);
  checkbox.setAttribute('aria-label', t('popupAriaSelect', [cookie.name]));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      state.selected.add(cookie.name);
    } else {
      state.selected.delete(cookie.name);
    }
    updateBulkBar();
  });

  const name = row.querySelector('.cookie-name');
  name.textContent = cookie.name;
  name.title = t('popupCopyNameTitle');
  name.addEventListener('click', () => {
    copyText(cookie.name, t('commonCopiedName', [truncate(cookie.name, 32)]));
  });

  // Second line: the configurable extra-info column. Only the value is
  // clickable (copies the full value); other fields are plain text.
  const showValue = (state.options.extraInfo ?? 'value') === 'value';
  const infoText = truncate(extraInfoOf(cookie), VALUE_MAX_CHARS);
  if (showValue) {
    const valueButton = document.createElement('button');
    valueButton.type = 'button';
    valueButton.className = 'cookie-extra cookie-value';
    valueButton.textContent = infoText;
    valueButton.title = cookie.value ?? '';
    valueButton.setAttribute('aria-label', t('popupAriaCopyValue', [cookie.name]));
    valueButton.addEventListener('click', () => {
      copyText(cookie.value ?? '', t('commonCopiedValue', [truncate(cookie.name, 24)]));
    });
    row.querySelector('.cookie-extra').replaceWith(valueButton);
  } else {
    const cell = row.querySelector('.cookie-extra');
    cell.classList.remove('cookie-value');
    cell.textContent = infoText;
  }

  const chips = row.querySelector('.cookie-chips');
  if (cookie.httpOnly) {
    chips.append(buildChip(t('popupChipHttpOnly')));
  }
  if (cookie.secure) {
    chips.append(buildChip(t('popupChipSecure')));
  }
  if (cookie.session) {
    chips.append(buildChip(t('popupChipSession')));
  }

  const pinButton = row.querySelector('.row-pin');
  pinButton.classList.toggle('active', pinned);
  pinButton.title = t('popupPinTitle');
  pinButton.setAttribute('aria-label', pinned ? t('popupAriaUnpin', [cookie.name]) : t('popupAriaPin', [cookie.name]));
  pinButton.addEventListener('click', () => toggleFlag(cookie, FLAG_PINS));

  const protectedActive = isFlagged(state.protected, cookie);
  const protectButton = row.querySelector('.row-protect');
  protectButton.classList.toggle('active', protectedActive);
  protectButton.title = t('popupProtectTitle');
  protectButton.setAttribute(
    'aria-label',
    protectedActive ? t('popupAriaProtectRemove', [cookie.name]) : t('popupAriaProtect', [cookie.name])
  );
  protectButton.addEventListener('click', () => toggleFlag(cookie, FLAG_PROTECTED));

  const copyButton = row.querySelector('.row-copy');
  copyButton.setAttribute('aria-label', t('popupAriaCopyJson'));
  copyButton.title = t('popupCopyJsonTitle');
  copyButton.addEventListener('click', () => {
    copyText(cookieToJson(cookie), t('commonCopiedJson', [truncate(cookie.name, 24)]));
  });

  const editButton = row.querySelector('.row-edit');
  editButton.setAttribute('aria-label', t('popupAriaEditCookie'));
  editButton.title = t('popupEditTitle');
  editButton.addEventListener('click', () => openForm('edit', cookie));

  const deleteButton = row.querySelector('.row-delete');
  deleteButton.setAttribute('aria-label', t('popupAriaDeleteCookie'));
  deleteButton.title = t('popupDeleteTitle');
  deleteButton.addEventListener('click', () => onDeleteCookie(cookie));
  return row;
}

/**
 * Build the text for the row's extra-info column.
 * @param {object} cookie
 * @returns {string}
 */
function extraInfoOf(cookie) {
  switch (state.options.extraInfo) {
    case 'domain':
      return cookie.domain ?? '';
    case 'path':
      return cookie.path || '/';
    case 'expiry':
      return cookie.session || cookie.expirationDate == null
        ? t('popupChipSession')
        : formatExpiry(cookie.expirationDate);
    case 'sameSite':
      return cookie.sameSite ?? 'unspecified';
    default:
      return cookie.value ?? '';
  }
}

/**
 * Format epoch seconds as a local "YYYY-MM-DD HH:mm" string.
 * @param {number} seconds
 * @returns {string}
 */
function formatExpiry(seconds) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) {
    return String(seconds);
  }
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * One-line JSON of a single cookie (known fields only, undefined dropped).
 * @param {object} cookie
 * @returns {string}
 */
function cookieToJson(cookie) {
  const item = {};
  for (const key of SINGLE_COOKIE_JSON_KEYS) {
    if (cookie[key] !== undefined) {
      item[key] = cookie[key];
    }
  }
  return JSON.stringify(item);
}

/**
 * Copy text to the clipboard and confirm with a toast.
 * @param {string} text
 * @param {string} successMessage
 */
async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, 'success');
  } catch (error) {
    showToast(t('commonCopyFailed', [error.message]), 'error');
  }
}

/**
 * Build a small flag chip.
 * @param {string} label
 * @returns {HTMLElement}
 */
function buildChip(label) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = label;
  return chip;
}

/**
 * Truncate a string to max characters, ending with an ellipsis.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ------------------------------------------------------------------ *
 * Add / edit form.
 * ------------------------------------------------------------------ */

/**
 * Open the add/edit form. Edit prefills from the cookie; add prefills
 * host-only session defaults bound to the tab.
 * @param {'new'|'edit'} mode
 * @param {object} [cookie]
 */
function openForm(mode, cookie = null) {
  closeImport();
  closeProfiles();
  hideMenu($('export-menu'));
  hideMenu($('options-menu'));

  state.editing = cookie;
  $('form-panel').hidden = false;
  $('form-title').textContent = mode === 'edit' ? t('popupEditCookie') : t('popupAddCookie');

  const knownSameSite = ['no_restriction', 'lax', 'strict'];
  $('form-name').value = cookie?.name ?? '';
  $('form-value').value = cookie?.value ?? '';
  $('form-domain').value = cookie?.domain ? cookie.domain.replace(/^\./, '') : hostnameOf(state.tab.url);
  $('form-path').value = cookie?.path ?? '/';
  $('form-samesite').value = knownSameSite.includes(cookie?.sameSite) ? cookie.sameSite : 'unspecified';
  $('form-secure').checked = cookie?.secure ?? false;
  $('form-httponly').checked = cookie?.httpOnly ?? false;
  $('form-hostonly').checked = cookie?.hostOnly ?? true;
  $('form-session').checked = cookie ? cookie.session : true;
  $('form-expiration').value = cookie && !cookie.session ? unixToDatetimeLocal(cookie.expirationDate) : '';

  syncFormAdvanced();
  $('form-name').focus();
}

/**
 * Close the add/edit form.
 */
function closeForm() {
  state.editing = null;
  $('form-panel').hidden = true;
}

/**
 * Reconcile advanced-section dependent state: visibility, session disabling
 * the expiration input, and host-only forcing the domain to the tab hostname.
 */
function syncFormAdvanced() {
  $('form-advanced').hidden = !$('advanced-toggle').checked;

  const session = $('form-session').checked;
  $('form-expiration').disabled = session;
  if (session) {
    $('form-expiration').value = '';
  }

  const hostOnly = $('form-hostonly').checked;
  if (hostOnly && state.tab?.url) {
    // Host-only cookies always live on the exact tab hostname, no leading dot.
    $('form-domain').value = hostnameOf(state.tab.url);
  }
  $('form-domain').disabled = hostOnly;
}

/**
 * Submit the form → saveCookie through the service worker.
 * @param {SubmitEvent} event
 */
async function onSaveForm(event) {
  event.preventDefault();
  if (!state.tab?.url) {
    return;
  }

  const name = $('form-name').value.trim();
  const value = $('form-value').value;
  if (!name) {
    showToast(t('popupErrorNameRequired'), 'error');
    return;
  }

  const advanced = $('advanced-toggle').checked;
  let parsed;
  if (advanced) {
    const session = $('form-session').checked;
    parsed = {
      name,
      value,
      domain: $('form-domain').value.trim(),
      hostOnly: $('form-hostonly').checked,
      path: $('form-path').value.trim() || '/',
      session,
      expirationDate: session ? undefined : datetimeLocalToUnix($('form-expiration').value) ?? undefined,
      sameSite: $('form-samesite').value,
      secure: $('form-secure').checked,
      httpOnly: $('form-httponly').checked,
    };
  } else if (state.editing) {
    // Basic mode patches name/value only: resetting Secure/HttpOnly/expiry of
    // the existing cookie would silently end the user's session.
    parsed = { ...state.editing, name, value };
  } else {
    parsed = {
      name,
      value,
      hostOnly: true,
      path: '/',
      session: true,
      sameSite: 'unspecified',
      secure: false,
      httpOnly: false,
    };
  }

  try {
    await sendMessage({ type: 'saveCookie', cookie: buildCookieForSet(parsed, state.tab.url) });
    closeForm();
    showToast(t('popupCookieSaved'), 'success');
    await loadCookies();
  } catch (error) {
    showToast(t('popupErrorSave', [error.message]), 'error');
  }
}

/**
 * Delete one cookie via the service worker, offering a 5 s undo toast.
 * @param {object} cookie
 */
async function onDeleteCookie(cookie) {
  const snapshot = [{ ...cookie }];
  try {
    await sendMessage({ type: 'removeCookie', url: originOf(state.tab.url), name: cookie.name });
    showToast(t('popupDeletedCookie', [truncate(cookie.name, 32)]), 'success', {
      actionLabel: t('commonUndo'),
      onAction: () => restoreCookies(snapshot),
    });
    await loadCookies();
  } catch (error) {
    showToast(t('popupErrorDeleteCookie', [error.message]), 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Pin & protect flags.
 * ------------------------------------------------------------------ */

/**
 * Toggle the pin or protect flag of one cookie and persist it. The
 * storage.onChanged listener re-renders the rows with the new state.
 * @param {object} cookie
 * @param {'pins'|'protected'} flag
 */
async function toggleFlag(cookie, flag) {
  const map = flag === FLAG_PINS ? state.pins : state.protected;
  const active = isFlagged(map, cookie);
  try {
    if (active) {
      await clearFlag(cookie, flag);
    } else {
      await setFlag(cookie, flag);
    }
    const pinnedOn = flag === FLAG_PINS;
    showToast(
      active
        ? (pinnedOn ? t('popupUnpinned') : t('popupProtectionRemoved'))
        : pinnedOn
          ? t('popupPinned')
          : t('popupProtected'),
      'success'
    );
  } catch (error) {
    showToast(t('popupErrorFlag', [error.message]), 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Delete All — arm, then confirm within 3 seconds.
 * ------------------------------------------------------------------ */

/**
 * Two-step Delete All handler on the danger button. Protected cookies are
 * skipped by the service worker; the toast reports them and offers undo.
 * @param {MouseEvent} event
 */
async function onDeleteAll(event) {
  const button = event.currentTarget;
  if (!state.deleteAllArmed) {
    state.deleteAllArmed = true;
    button.textContent = t('popupConfirmDeleteAll');
    button.classList.add('armed');
    deleteAllTimer = setTimeout(() => disarmDeleteAll(button), DELETE_ALL_ARM_MS);
    return;
  }

  disarmDeleteAll(button);
  if (!state.tab?.url) {
    return;
  }
  // Snapshot only the cookies that can actually be deleted (protected stay).
  const snapshot = state.cookies
    .filter((cookie) => !isFlagged(state.protected, cookie))
    .map((cookie) => ({ ...cookie }));
  try {
    const response = await sendMessage({ type: 'removeAllCookies', url: originOf(state.tab.url) });
    showDeletedToast(response?.removed ?? 0, response?.skipped ?? 0, snapshot);
    await loadCookies();
  } catch (error) {
    showToast(t('popupErrorDeleteCookies', [error.message]), 'error');
  }
}

/**
 * Restore the Delete All button to its idle state.
 * @param {HTMLButtonElement} button
 */
function disarmDeleteAll(button) {
  clearTimeout(deleteAllTimer);
  state.deleteAllArmed = false;
  button.textContent = t('popupDeleteAll');
  button.classList.remove('armed');
}

/* ------------------------------------------------------------------ *
 * Multi-select bulk bar — select all/none, export JSON, delete, cancel.
 * ------------------------------------------------------------------ */

/**
 * Sync the contextual bulk bar: shown with a live count while ≥ 1 cookie is
 * selected, replacing the search bar.
 */
function updateBulkBar() {
  const count = state.selected.size;
  const active = count > 0;
  $('bulk-bar').hidden = !active;
  $('search-bar').hidden = active;
  $('bulk-count').textContent = active ? t('popupBulkSelected', [count]) : t('popupBulkZeroSelected');
}

/**
 * "Select all/none" — applies to the currently visible (filtered) cookies.
 */
function onBulkToggleAll() {
  const visible = filterCookies(state.cookies, state.filter);
  const allSelected = visible.length > 0 && visible.every((cookie) => state.selected.has(cookie.name));
  for (const cookie of visible) {
    if (allSelected) {
      state.selected.delete(cookie.name);
    } else {
      state.selected.add(cookie.name);
    }
  }
  renderList();
  updateBulkBar();
}

/**
 * Copy only the selected cookies to the clipboard as JSON.
 */
async function onBulkExport() {
  const selected = state.cookies.filter((cookie) => state.selected.has(cookie.name));
  if (selected.length === 0) {
    return;
  }
  try {
    await navigator.clipboard.writeText(jsonFormat.serialize(selected));
    showToast(t('popupBulkExported', [selected.length]), 'success');
  } catch (error) {
    showToast(t('commonExportFailed', [error.message]), 'error');
  }
}

/**
 * Delete the selected cookies (protected ones are skipped by the service
 * worker) and offer undo.
 */
async function onBulkDelete() {
  const names = [...state.selected];
  if (names.length === 0 || !state.tab?.url) {
    return;
  }
  // Snapshot before deleting — protected cookies survive, so undo simply
  // re-sets the snapshot unchanged.
  const snapshot = state.cookies
    .filter((cookie) => names.includes(cookie.name))
    .map((cookie) => ({ ...cookie }));
  try {
    const response = await sendMessage({ type: 'removeCookiesByName', url: originOf(state.tab.url), names });
    state.selected.clear();
    await loadCookies();
    showDeletedToast(response?.removed ?? 0, response?.skipped ?? 0, snapshot);
  } catch (error) {
    showToast(t('popupErrorDeleteCookies', [error.message]), 'error');
  }
}

/**
 * Leave bulk mode: clear the selection and bring the search bar back.
 */
function onBulkCancel() {
  state.selected.clear();
  renderList();
  updateBulkBar();
}

/* ------------------------------------------------------------------ *
 * Undo delete — in-memory snapshot, popup lifetime, 5 s window.
 * ------------------------------------------------------------------ */

/**
 * Toast for a finished delete: mentions skipped protected cookies and offers
 * a 5 s Undo when something was actually removed.
 * @param {number} removed
 * @param {number} skipped
 * @param {Array<object>} snapshot copies of the cookies that were up for deletion
 */
function showDeletedToast(removed, skipped, snapshot) {
  const suffix = skipped > 0 ? `, ${t('commonSkippedProtected', [skipped])}` : '';
  if (removed <= 0) {
    showToast(`${t('commonDeletedCount', [removed])}${suffix}.`, 'info');
    return;
  }
  showToast(`${t('commonDeletedCount', [removed])}${suffix}.`, 'success', {
    actionLabel: t('commonUndo'),
    onAction: () => restoreCookies(snapshot),
  });
}

/**
 * Re-create previously deleted cookies through importCookies (undo). The
 * snapshot lives in memory only — it dies with the popup.
 * @param {Array<object>} snapshot
 */
async function restoreCookies(snapshot) {
  if (!snapshot.length || !state.tab?.url) {
    return;
  }
  // Rebuild the set() details exactly like an import: host-only cookies land
  // on the tab host, domain cookies keep their domain.
  const cookiesForSet = snapshot.map((cookie) => buildCookieForSet(cookie, state.tab.url));
  try {
    const response = await sendMessage({ type: 'importCookies', cookies: cookiesForSet });
    showToast(t('popupRestoredCount', [response?.imported ?? 0]), 'success');
    await loadCookies();
  } catch (error) {
    showToast(t('commonErrorRestore', [error.message]), 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Export — clipboard (copy group) and file (download group).
 * ------------------------------------------------------------------ */

/**
 * Main Export button: one-click copy with the default format, or open the
 * menu when the user chose "Ask every time".
 */
async function onExportMainClick() {
  if (copiedTimer) {
    return; // ignore clicks while the "✓ Copied" feedback is showing
  }
  hideMenu($('options-menu'));
  const format = state.options.exportFormat ?? 'json';
  if (format === 'ask' || !EXPORT_SERIALIZERS[format]) {
    toggleMenu($('export-menu'));
    return;
  }
  await exportAs(format);
}

/**
 * Serialize the current list in the chosen format and copy it.
 * @param {string} format key of EXPORT_SERIALIZERS
 */
async function exportAs(format) {
  const serializer = EXPORT_SERIALIZERS[format];
  if (!serializer || state.exportBusy) {
    return;
  }

  state.exportBusy = true;
  try {
    await navigator.clipboard.writeText(serializer.serialize(state.cookies));
    hideMenu($('export-menu'));
    showCopiedFeedback();
    showToast(t('popupExportedCount', [state.cookies.length, t(serializer.labelKey)]), 'success');
  } catch (error) {
    showToast(t('commonExportFailed', [error.message]), 'error');
  } finally {
    state.exportBusy = false;
  }
}

/**
 * Serialize the current list and download it as a file.
 * @param {string} format key of EXPORT_SERIALIZERS ("json" or "netscape")
 */
async function exportAsFile(format) {
  const serializer = EXPORT_SERIALIZERS[format];
  if (!serializer || state.exportBusy) {
    return;
  }

  state.exportBusy = true;
  try {
    const extension = format === 'netscape' ? 'txt' : 'json';
    const hostname = state.tab?.url ? hostnameOf(state.tab.url) : 'cookies';
    downloadText(`cookies-${hostname}-${localDateStamp()}.${extension}`, serializer.serialize(state.cookies));
    hideMenu($('export-menu'));
    showToast(t('popupDownloadedCount', [state.cookies.length, t(serializer.labelKey)]), 'success');
  } catch (error) {
    showToast(t('commonExportFailed', [error.message]), 'error');
  } finally {
    state.exportBusy = false;
  }
}

/**
 * Show the transient "✓ Copied" state on the Export button.
 */
function showCopiedFeedback() {
  const button = $('export-btn');
  button.textContent = t('popupCopiedFeedback');
  button.classList.add('copied');
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedTimer = null;
    button.textContent = t('popupExport');
    button.classList.remove('copied');
  }, COPIED_FEEDBACK_MS);
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

/* ------------------------------------------------------------------ *
 * Import — auto-detect format, set every cookie via the service worker.
 * ------------------------------------------------------------------ */

/**
 * Open the inline import panel.
 */
function openImport() {
  closeForm();
  closeProfiles();
  hideMenu($('export-menu'));
  hideMenu($('options-menu'));
  $('import-panel').hidden = false;
  $('import-text').focus();
}

/**
 * Close the inline import panel.
 */
function closeImport() {
  $('import-panel').hidden = true;
}

/**
 * Read the chosen file as text into the import textarea; the format is
 * still auto-detected on import.
 * @param {Event} event
 */
function onImportFile(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = ''; // allow picking the same file again later
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    $('import-text').value = String(reader.result ?? '');
    showToast(t('popupFileLoaded', [file.name]), 'info');
    $('import-text').focus();
  });
  reader.addEventListener('error', () => {
    showToast(t('popupErrorReadFile', [file.name]), 'error');
  });
  reader.readAsText(file);
}

/**
 * Parse the textarea, push every cookie through saveCookie (via importCookies)
 * and report successes/failures plus the detected format.
 */
async function onImport() {
  if (!state.tab?.url) {
    return;
  }
  const text = $('import-text').value;

  let detected;
  try {
    detected = detectFormat(text);
  } catch {
    // All parsers failed — surface the localized "invalid format" message.
    showToast(t('popupErrorInvalidFormat'), 'error');
    return;
  }

  // Cookies without a domain become host-only cookies on the tab origin.
  const cookiesForSet = detected.cookies.map((cookie) => buildCookieForSet(cookie, state.tab.url));
  try {
    const response = await sendMessage({ type: 'importCookies', cookies: cookiesForSet });
    const imported = response?.imported ?? 0;
    const failed = response?.failed ?? 0;
    showToast(
      t('popupImportedCount', [imported, failed, detected.format]),
      failed > 0 ? 'error' : 'success'
    );
    if (imported > 0) {
      closeImport();
      $('import-text').value = '';
      await loadCookies();
    }
  } catch (error) {
    showToast(t('commonImportFailed', [error.message]), 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Cookie profiles — save the site's cookies, restore merge/replace.
 * ------------------------------------------------------------------ */

/**
 * Open the profiles panel and (re)render the stored profiles.
 */
async function openProfiles() {
  closeForm();
  closeImport();
  hideMenu($('export-menu'));
  hideMenu($('options-menu'));
  $('profile-bind-host').textContent = state.tab?.url ? hostnameOf(state.tab.url) : '';
  $('profiles-panel').hidden = false;
  await renderProfileList();
}

/**
 * Close the profiles panel.
 */
function closeProfiles() {
  $('profiles-panel').hidden = true;
}

/**
 * Render the stored profiles, newest first.
 */
async function renderProfileList() {
  const container = $('profile-list');
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
 * Build one profile row: name/meta plus Merge / Replace / Duplicate /
 * Rename (inline) / Delete. Everything via createElement + textContent.
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
  meta.textContent = `${profile.domain || t('commonGlobal')} · ${t('commonCookieCount', [(profile.cookies ?? []).length])}`;
  top.append(nameSpan, meta);

  const actions = document.createElement('div');
  actions.className = 'profile-actions';
  actions.append(
    profileActionButton(t('popupProfileMerge'), t('popupProfileRestoreMergeTitle', [profile.name]), () =>
      onRestoreProfile(profile, 'merge')
    ),
    profileActionButton(t('popupProfileReplace'), t('popupProfileRestoreReplaceTitle', [profile.name]), () =>
      onRestoreProfile(profile, 'replace')
    )
  );

  const duplicateBtn = document.createElement('button');
  duplicateBtn.type = 'button';
  duplicateBtn.className = 'icon-btn';
  duplicateBtn.textContent = '⧉';
  duplicateBtn.setAttribute('aria-label', t('popupAriaProfileDuplicate', [profile.name]));
  duplicateBtn.addEventListener('click', () => onDuplicateProfile(profile));

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'icon-btn';
  renameBtn.textContent = '✎';
  renameBtn.setAttribute('aria-label', t('popupAriaProfileRename', [profile.name]));
  renameBtn.addEventListener('click', () => startProfileRename(profile, nameSpan));

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'icon-btn';
  deleteBtn.textContent = '✕';
  deleteBtn.setAttribute('aria-label', t('popupAriaProfileDelete', [profile.name]));
  deleteBtn.addEventListener('click', () => onDeleteProfile(profile));

  actions.append(duplicateBtn, renameBtn, deleteBtn);
  rowEl.append(top, actions);
  return rowEl;
}

/**
 * Small labelled action button for profile rows.
 * @param {string} label
 * @param {string} title tooltip / accessibility hint
 * @param {Function} onClick
 * @returns {HTMLButtonElement}
 */
function profileActionButton(label, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-mini';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Inline rename: swap the name span for a text input. Enter saves,
 * Escape cancels, blur saves — no window.prompt.
 * @param {object} profile
 * @param {HTMLElement} nameSpan the span showing the current name
 */
function startProfileRename(profile, nameSpan) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'profile-rename-input';
  input.value = profile.name;
  input.setAttribute('aria-label', t('popupAriaProfileRename', [profile.name]));
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const settle = async (save) => {
    if (settled) {
      return;
    }
    settled = true;
    const next = input.value.trim();
    if (save && next && next !== profile.name) {
      try {
        await profiles.renameProfile(profile.id, next);
        showToast(t('popupProfileRenamed'), 'success');
      } catch (error) {
        showToast(t('popupErrorProfileRename', [error.message]), 'error');
      }
    }
    await renderProfileList();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      settle(true);
    } else if (event.key === 'Escape') {
      settle(false);
    }
  });
  input.addEventListener('blur', () => settle(true));
}

/**
 * Save the current site's cookies as a named profile (optionally bound to
 * the tab hostname).
 */
async function onSaveProfile() {
  const name = $('profile-name').value.trim();
  if (!name) {
    showToast(t('popupErrorProfileName'), 'error');
    return;
  }
  if (!state.tab?.url) {
    return;
  }
  const bind = $('profile-bind').checked;
  try {
    const profile = await profiles.saveProfile({
      name,
      domain: bind ? hostnameOf(state.tab.url) : null,
      cookies: state.cookies.map((cookie) => ({ ...cookie })),
    });
    $('profile-name').value = '';
    showToast(
      t('popupProfileSaved', [truncate(profile.name, 24), t('commonCookieCount', [profile.cookies.length])]),
      'success'
    );
    await renderProfileList();
  } catch (error) {
    showToast(t('popupErrorProfileSave', [error.message]), 'error');
  }
}

/**
 * Restore a profile onto the current site. "replace" first runs the per-site
 * Delete All (respects protected cookies, offers undo), then imports.
 * @param {object} profile
 * @param {'merge'|'replace'} mode
 */
async function onRestoreProfile(profile, mode) {
  if (!state.tab?.url) {
    return;
  }
  try {
    if (mode === 'replace') {
      const snapshot = state.cookies
        .filter((cookie) => !isFlagged(state.protected, cookie))
        .map((cookie) => ({ ...cookie }));
      const removedResponse = await sendMessage({ type: 'removeAllCookies', url: originOf(state.tab.url) });
      showDeletedToast(removedResponse?.removed ?? 0, removedResponse?.skipped ?? 0, snapshot);
    }
    // Profile cookies carry their own domain; host-only ones (no domain in
    // the set() details) land on the current tab host.
    const cookiesForSet = (profile.cookies ?? []).map((cookie) => buildCookieForSet(cookie, state.tab.url));
    const response = await sendMessage({ type: 'importCookies', cookies: cookiesForSet });
    const imported = response?.imported ?? 0;
    const failed = response?.failed ?? 0;
    const modeLabel = mode === 'merge' ? t('popupProfileMerge') : t('popupProfileReplace');
    const suffix = failed > 0 ? `, ${t('commonFailedCount', [failed])}` : '';
    showToast(
      `${t('popupProfileRestored', [imported, truncate(profile.name, 24), modeLabel])}${suffix}.`,
      failed > 0 ? 'error' : 'success'
    );
    await loadCookies();
  } catch (error) {
    showToast(t('popupErrorProfileRestore', [error.message]), 'error');
  }
}

/**
 * Duplicate a profile.
 * @param {object} profile
 */
async function onDuplicateProfile(profile) {
  try {
    await profiles.duplicateProfile(profile.id);
    showToast(t('popupProfileDuplicated', [truncate(profile.name, 24)]), 'success');
    await renderProfileList();
  } catch (error) {
    showToast(t('popupErrorProfileDuplicate', [error.message]), 'error');
  }
}

/**
 * Delete a profile.
 * @param {object} profile
 */
async function onDeleteProfile(profile) {
  try {
    await profiles.deleteProfile(profile.id);
    showToast(t('commonProfileDeleted', [truncate(profile.name, 24)]), 'success');
    await renderProfileList();
  } catch (error) {
    showToast(t('commonErrorProfileDelete', [error.message]), 'error');
  }
}

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

/**
 * Send a message to the service worker and resolve with its response.
 * @param {object} message
 * @returns {Promise<object>}
 */
async function sendMessage(message) {
  try {
    const response = await api.runtime.sendMessage(message);
    if (response?.error) {
      throw new Error(response.error);
    }
    return response;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Shift an open menu horizontally so it stays inside the viewport. Menus are
 * anchored to their button's right edge, which pokes out of the panel's left
 * edge in narrow containers once the button wraps to another row.
 * @param {HTMLElement} menu
 */
function clampMenuToViewport(menu) {
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  let shiftX = 0;
  if (rect.left < margin) {
    shiftX = margin - rect.left;
  } else if (rect.right > viewport - margin) {
    shiftX = viewport - margin - rect.right;
  }
  menu.style.transform = shiftX ? `translateX(${Math.round(shiftX)}px)` : '';
}

/**
 * Toggle a dropdown menu and its aria-expanded state.
 * @param {HTMLElement} menu
 */
function toggleMenu(menu) {
  menu.hidden = !menu.hidden;
  if (!menu.hidden) {
    // Drop any previous shift first, then measure from the natural position —
    // a stale transform would make the clamp compute against wrong bounds.
    menu.style.transform = '';
    clampMenuToViewport(menu);
  } else {
    menu.style.transform = '';
  }
  menuControls.get(menu)?.setAttribute('aria-expanded', String(!menu.hidden));
}

/**
 * Hide a dropdown menu if it is open.
 * @param {HTMLElement} menu
 */
function hideMenu(menu) {
  if (menu.hidden) {
    return;
  }
  menu.hidden = true;
  menu.style.transform = '';
  menuControls.get(menu)?.setAttribute('aria-expanded', 'false');
}

init();
