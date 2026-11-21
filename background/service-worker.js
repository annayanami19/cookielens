/**
 * CookieLens — service worker (background).
 *
 * Message router (UI → chrome.cookies.*), per-tab cookie-count badge,
 * keyboard commands, the right-click context menu, the offscreen clipboard
 * bridge and the automatic daily backup alarm. Every listener is registered
 * at the top level; the only state in memory is the double-press window of
 * the delete command and the idempotent context-menu (re)registration, both
 * safe to lose on suspension.
 */

import { api } from '../lib/browser-detector.js';
import { hostnameOf, isWebUrl } from '../lib/cookie.js';
import { FLAG_PROTECTED, getFlagMap, isFlagged } from '../lib/flags.js';
import * as jsonFormat from '../lib/formats/json-format.js';
import { t } from '../lib/i18n.js';
import { runBackup } from '../lib/backups.js';
import { getOptions } from '../lib/storage-handler.js';

const BADGE_COLOR = '#d99e4a';
const OFFSCREEN_URL = 'offscreen/offscreen.html';
const FLASH_FEEDBACK_MS = 1500;
const DELETE_CONFIRM_WINDOW_MS = 2500;
const MENU_ROOT = 'cep-root';
const MENU_OPEN_PANEL = 'cep-open-panel';
const MENU_EXPORT_JSON = 'cep-export-json';
const BACKUP_ALARM = 'daily-backup';
const BACKUP_PERIOD_MINUTES = 1440;
const BACKUP_DELAY_MINUTES = 5;

/** tabId → Date.now() of the first "delete site cookies" key press. */
const pendingDeletePresses = new Map();

/* ------------------------------------------------------------------ *
 * Message router — always `return true` to keep the channel open for
 * the async sendResponse.
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
  return true;
});

/**
 * Handle one UI message and build its response.
 * @param {object} message
 * @returns {Promise<object>}
 */
async function handleMessage(message) {
  switch (message?.type) {
    case 'getCurrentTab': {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      return { tab: tab ?? null };
    }
    case 'getTabById': {
      // api.tabs.get rejects for unknown ids — the router turns that into {error}.
      const tab = await api.tabs.get(message.tabId);
      return { tab };
    }
    case 'getAllCookies': {
      const cookies = await getAllForUrl(message.url);
      return { cookies };
    }
    case 'getAllCookiesEverywhere': {
      const stores = await api.cookies.getAllCookieStores();
      const cookies = [];
      for (const store of stores) {
        cookies.push(...(await getAllForStore(store.id)));
      }
      return { cookies, storeCount: stores.length };
    }
    case 'removeAllCookiesEverywhere': {
      const stores = await api.cookies.getAllCookieStores();
      const protectedMap = await protectedMapSafe();
      let removed = 0;
      let failed = 0;
      let skipped = 0;
      for (const store of stores) {
        const cookies = await getAllForStore(store.id);
        for (const cookie of cookies) {
          if (isFlagged(protectedMap, cookie)) {
            skipped += 1;
            continue;
          }
          try {
            await api.cookies.remove(
              removeDetailsFor(cookie, { url: cookieUrlOf(cookie), name: cookie.name, storeId: store.id }),
            );
            removed += 1;
          } catch {
            failed += 1;
          }
        }
      }
      return { removed, failed, skipped };
    }
    case 'saveCookie':
      await api.cookies.set(message.cookie);
      return { ok: true };
    case 'removeCookie':
      await api.cookies.remove({ url: message.url, name: message.name });
      return { ok: true };
    case 'removeAllCookies':
      return removeAllForUrl(message.url);
    case 'removeCookiesByName': {
      const names = new Set(message.names ?? []);
      const cookies = await getAllForUrl(message.url);
      const protectedMap = await protectedMapSafe();
      let removed = 0;
      let skipped = 0;
      for (const cookie of cookies) {
        if (!names.has(cookie.name)) {
          continue;
        }
        if (isFlagged(protectedMap, cookie)) {
          skipped += 1;
          continue;
        }
        try {
          await api.cookies.remove(removeDetailsFor(cookie, { url: message.url, name: cookie.name }));
          removed += 1;
        } catch {
          // Skip unreachable cookies and keep going.
        }
      }
      return { removed, skipped };
    }
    case 'importCookies': {
      let imported = 0;
      let failed = 0;
      for (const cookie of message.cookies ?? []) {
        try {
          await api.cookies.set(cookie);
          imported += 1;
        } catch {
          failed += 1;
        }
      }
      return { imported, failed };
    }
    case 'runBackupNow':
      // Same snapshot the daily alarm takes, on demand (options page).
      return runBackup();
    case 'restoreBackup': {
      // Merge-only restore: every backup cookie is re-set with a URL
      // reconstructed from its own scheme/domain/path.
      let imported = 0;
      let failed = 0;
      for (const cookie of message.cookies ?? []) {
        try {
          await api.cookies.set(restoreCookieForSet(cookie));
          imported += 1;
        } catch {
          failed += 1;
        }
      }
      return { imported, failed };
    }
    default:
      throw new Error(`Unknown message type: ${message?.type}`);
  }
}

/* ------------------------------------------------------------------ *
 * Cookie deletion / restore helpers (shared by messages and commands).
 * ------------------------------------------------------------------ */

/**
 * Read the protected map, treating a storage failure as "nothing protected".
 * @returns {Promise<object>}
 */
async function protectedMapSafe() {
  try {
    return await getFlagMap(FLAG_PROTECTED);
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * Partitioned cookies (CHIPS) — read/remove helpers.
 * ------------------------------------------------------------------ */

/**
 * Get every cookie matching one URL, including CHIPS partitioned cookies.
 * A filter without a partitionKey only returns unpartitioned cookies;
 * an empty partitionKey selects every partition (Chrome 119+ / recent
 * Firefox). Browsers without the partitionKey filter reject it — fall back
 * to the plain filter, which matches the pre-CHIPS behaviour.
 * @param {string} url
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
async function getAllForUrl(url) {
  try {
    return await api.cookies.getAll({ url, partitionKey: {} });
  } catch {
    return api.cookies.getAll({ url });
  }
}

/**
 * getAllForUrl() scoped to one cookie store (browser-wide queries).
 * @param {string} storeId
 * @returns {Promise<chrome.cookies.Cookie[]>}
 */
async function getAllForStore(storeId) {
  try {
    return await api.cookies.getAll({ storeId, partitionKey: {} });
  } catch {
    return api.cookies.getAll({ storeId });
  }
}

/**
 * Build a cookies.remove() details object that can also target partitioned
 * cookies: a cookie read with a partitionKey is only removed when the same
 * partitionKey is passed back. Unpartitioned cookies have no partitionKey,
 * so their details stay untouched.
 * @param {chrome.cookies.Cookie} cookie
 * @param {object} base fixed details (url, name, optional storeId)
 * @returns {object} details ready for cookies.remove()
 */
function removeDetailsFor(cookie, base) {
  const details = { ...base };
  if (cookie?.partitionKey) {
    details.partitionKey = cookie.partitionKey;
  }
  return details;
}

/**
 * Delete every cookie of one URL, skipping protected cookies.
 * @param {string} url
 * @returns {Promise<{removed: number, skipped: number}>}
 */
async function removeAllForUrl(url) {
  const cookies = await getAllForUrl(url);
  const protectedMap = await protectedMapSafe();
  let removed = 0;
  let skipped = 0;
  for (const cookie of cookies) {
    if (isFlagged(protectedMap, cookie)) {
      skipped += 1;
      continue;
    }
    try {
      await api.cookies.remove(removeDetailsFor(cookie, { url, name: cookie.name }));
      removed += 1;
    } catch {
      // Skip unreachable cookies and keep going.
    }
  }
  return { removed, skipped };
}

/**
 * Reconstruct a request URL for a stored cookie so cookies.remove() can
 * target it (remove() needs a URL, not a domain).
 * @param {chrome.cookies.Cookie} cookie
 * @returns {string}
 */
function cookieUrlOf(cookie) {
  const domain = String(cookie?.domain ?? '').replace(/^\./, '');
  return `${cookie?.secure ? 'https' : 'http'}://${domain}${cookie?.path || '/'}`;
}

/**
 * Build a cookies.set() details object for one backed-up (native) cookie:
 * the URL is reconstructed from the cookie's own scheme/domain/path via
 * cookieUrlOf(). Only set()-legal fields are copied — hostOnly is expressed
 * by omitting the domain, session by omitting expirationDate.
 * @param {object} cookie backed-up cookie
 * @returns {object} details ready for cookies.set()
 */
function restoreCookieForSet(cookie) {
  const details = {
    url: cookieUrlOf(cookie),
    name: cookie.name,
    value: typeof cookie.value === 'string' ? cookie.value : '',
    path: cookie.path || '/',
  };
  if (cookie.secure === true) {
    details.secure = true;
  }
  if (cookie.httpOnly === true) {
    details.httpOnly = true;
  }
  if (cookie.sameSite === 'no_restriction' || cookie.sameSite === 'lax' || cookie.sameSite === 'strict') {
    details.sameSite = cookie.sameSite;
  }
  if (cookie.session !== true && cookie.expirationDate != null) {
    details.expirationDate = Math.floor(Number(cookie.expirationDate));
  }
  if (cookie.hostOnly !== true && typeof cookie.domain === 'string' && cookie.domain.trim()) {
    details.domain = cookie.domain.trim().replace(/^\./, '');
  }
  return details;
}

/* ------------------------------------------------------------------ *
 * Badge — cookie count per tab + transient command feedback.
 * ------------------------------------------------------------------ */

api.action.setBadgeBackgroundColor({ color: BADGE_COLOR });

api.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await api.tabs.get(tabId);
    updateBadge(tabId, tab.url);
  } catch {
    // Tab closed before we could read it.
  }
});

api.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    updateBadge(tabId, changeInfo.url);
  }
});

api.cookies.onChanged.addListener((changeInfo) => {
  // "overwrite" always pairs with an "explicit" event for the same change.
  if (changeInfo.cause === 'overwrite') {
    return;
  }
  refreshBadgesForCookieDomain(changeInfo.cookie);
});

refreshActiveTabBadge();

/**
 * Refresh the badge of every open tab whose hostname matches the cookie domain.
 * @param {chrome.cookies.Cookie} [cookie]
 */
async function refreshBadgesForCookieDomain(cookie) {
  const domain = String(cookie?.domain ?? '').replace(/^\./, '').toLowerCase();
  if (!domain) {
    return;
  }
  let tabs = [];
  try {
    tabs = await api.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab.url || !isWebUrl(tab.url)) {
      continue;
    }
    const host = hostnameOf(tab.url).toLowerCase();
    if (host === domain || host.endsWith(`.${domain}`)) {
      updateBadge(tab.id, tab.url);
    }
  }
}

/**
 * Set the badge of one tab to its cookie count ("" without permission).
 * @param {number} tabId
 * @param {string} [url]
 */
async function updateBadge(tabId, url) {
  let text = '';
  if (url && isWebUrl(url)) {
    try {
      const cookies = await getAllForUrl(url);
      text = String(cookies.length);
    } catch {
      // No host permission for this URL (yet) — keep the badge empty.
      text = '';
    }
  }
  try {
    await api.action.setBadgeText({ tabId, text });
  } catch {
    // Tab may be gone by now — nothing to do.
  }
}

/**
 * Flash a transient badge text on one tab (command feedback), then restore
 * the cookie-count badge.
 * @param {number} tabId
 * @param {string} text "✓" on success, "!" on failure / confirm arm
 * @param {number} durationMs how long the flash stays visible
 */
function flashBadge(tabId, text, durationMs) {
  try {
    api.action.setBadgeText({ tabId, text });
  } catch {
    // Tab may be gone already.
  }
  setTimeout(() => {
    restoreBadgeCount(tabId);
  }, durationMs);
}

/**
 * Put the regular cookie-count badge back after a flash.
 * @param {number} tabId
 */
async function restoreBadgeCount(tabId) {
  try {
    const tab = await api.tabs.get(tabId);
    await updateBadge(tabId, tab.url);
  } catch {
    // Tab closed before the flash ended — nothing to restore.
  }
}

/** Runs on every SW wake-up so a freshly spawned worker repaints the badge. */
async function refreshActiveTabBadge() {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await updateBadge(tab.id, tab.url);
    }
  } catch {
    // No active browser window yet.
  }
}

/* ------------------------------------------------------------------ *
 * Keyboard commands (chrome.commands).
 * ------------------------------------------------------------------ */

api.commands?.onCommand.addListener((command) => {
  handleCommand(command).catch((error) => {
    console.error(`[CEP] command "${command}" failed`, error);
  });
});

/**
 * Dispatch one keyboard command against the active tab.
 * @param {string} command
 */
async function handleCommand(command) {
  let tab = null;
  try {
    [tab] = await api.tabs.query({ active: true, currentWindow: true });
  } catch {
    return;
  }
  if (!tab?.id) {
    return;
  }
  switch (command) {
    case 'open-side-panel':
      await openSidePanel(tab);
      break;
    case 'export-site-json':
      await exportSiteJsonToClipboard(tab);
      break;
    case 'delete-site-cookies':
      await deleteSiteCookiesWithConfirm(tab);
      break;
    default:
      break;
  }
}

/**
 * Open the Chrome side panel for the tab's window (no-op without the API).
 * @param {chrome.tabs.Tab} tab
 */
async function openSidePanel(tab) {
  if (typeof api.sidePanel?.open !== 'function') {
    return;
  }
  try {
    await api.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error('[CEP] could not open the side panel', error);
  }
}

/**
 * Copy the active site's cookies as JSON to the clipboard and flash "✓".
 * @param {chrome.tabs.Tab} tab
 */
async function exportSiteJsonToClipboard(tab) {
  if (!tab.url || !isWebUrl(tab.url)) {
    flashBadge(tab.id, '!', FLASH_FEEDBACK_MS);
    return;
  }
  try {
    const cookies = await getAllForUrl(tab.url);
    await writeClipboard(jsonFormat.serialize(cookies));
    flashBadge(tab.id, '✓', FLASH_FEEDBACK_MS);
  } catch (error) {
    console.error('[CEP] quick export failed', error);
    flashBadge(tab.id, '!', FLASH_FEEDBACK_MS);
  }
}

/**
 * Delete all cookies of the active site. Two presses within 2.5 s confirm —
 * the first press only arms the command (badge "!").
 * @param {chrome.tabs.Tab} tab
 */
async function deleteSiteCookiesWithConfirm(tab) {
  if (!tab.url || !isWebUrl(tab.url)) {
    return;
  }
  const now = Date.now();
  const firstPress = pendingDeletePresses.get(tab.id);
  if (!firstPress || now - firstPress > DELETE_CONFIRM_WINDOW_MS) {
    pendingDeletePresses.set(tab.id, now);
    flashBadge(tab.id, '!', DELETE_CONFIRM_WINDOW_MS);
    return;
  }
  pendingDeletePresses.delete(tab.id);
  try {
    const { removed, skipped } = await removeAllForUrl(tab.url);
    console.log(`[CEP] quick delete: ${removed} removed, ${skipped} protected skipped`);
    flashBadge(tab.id, '✓', FLASH_FEEDBACK_MS);
  } catch (error) {
    console.error('[CEP] quick delete failed', error);
    flashBadge(tab.id, '!', FLASH_FEEDBACK_MS);
  }
}

/* ------------------------------------------------------------------ *
 * Clipboard via the offscreen document (Chromium; degrades elsewhere).
 * ------------------------------------------------------------------ */

/**
 * Check whether the offscreen clipboard document already exists.
 * @returns {Promise<boolean>}
 */
async function hasOffscreenDocument() {
  if (typeof api.runtime.getContexts === 'function') {
    const contexts = await api.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return (contexts ?? []).length > 0;
  }
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  return clients.some((client) => client.url.endsWith(OFFSCREEN_URL));
}

/**
 * Write text to the system clipboard through the offscreen document. The
 * document is created once and kept alive for reuse. On browsers without
 * the offscreen API this throws and callers degrade to the "!" badge.
 * @param {string} text
 * @returns {Promise<void>}
 * @throws {Error} when the offscreen API is missing or the copy fails
 */
async function writeClipboard(text) {
  if (typeof api.offscreen?.createDocument !== 'function') {
    throw new Error('This browser has no offscreen clipboard API.');
  }
  if (!(await hasOffscreenDocument())) {
    await api.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['CLIPBOARD'],
      justification: 'Write cookie export to the clipboard',
    });
  }
  // A freshly created document may still be loading — retry briefly.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response = null;
    try {
      response = await api.runtime.sendMessage({ type: 'copy', text });
    } catch {
      response = null; // receiving end not ready yet
    }
    if (response?.ok) {
      return;
    }
    if (response?.error) {
      throw new Error(response.error);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('The clipboard helper did not respond.');
}

/* ------------------------------------------------------------------ *
 * Context menu — "CookieLens" on pages (titles via i18n).
 * ------------------------------------------------------------------ */

api.contextMenus?.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }
  switch (info.menuItemId) {
    case MENU_OPEN_PANEL:
      openSidePanel(tab);
      break;
    case MENU_EXPORT_JSON:
      exportSiteJsonToClipboard(tab);
      break;
    default:
      break;
  }
});

setupContextMenus();

/**
 * (Re)create the context menu items. Runs idempotently on every SW start
 * (and therefore on install) with a remove-then-create pattern; duplicate
 * ids or races surface through runtime.lastError and are swallowed.
 */
function setupContextMenus() {
  if (typeof api.contextMenus?.create !== 'function') {
    return;
  }
  try {
    api.contextMenus.removeAll(() => {
      void api.runtime.lastError; // nothing to clear on the very first run
      createMenuItem({ id: MENU_ROOT, title: t('extName'), contexts: ['page'] });
      createMenuItem({
        id: MENU_OPEN_PANEL,
        parentId: MENU_ROOT,
        title: t('menuOpen'),
        contexts: ['page'],
      });
      createMenuItem({
        id: MENU_EXPORT_JSON,
        parentId: MENU_ROOT,
        title: t('menuExportJson'),
        contexts: ['page'],
      });
    });
  } catch (error) {
    console.error('[CEP] could not register the context menu', error);
  }
}

/**
 * Create one context menu item, ignoring duplicate-id errors.
 * @param {object} createProperties
 */
function createMenuItem(createProperties) {
  try {
    api.contextMenus.create(createProperties, () => void api.runtime.lastError);
  } catch (error) {
    console.error('[CEP] could not create the menu item', createProperties.id, error);
  }
}

/* ------------------------------------------------------------------ *
 * Automatic daily backup (chrome.alarms + lib/backups.js).
 * ------------------------------------------------------------------ */

api.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== BACKUP_ALARM) {
    return;
  }
  runDailyBackup().catch((error) => {
    console.error('[CEP] daily backup failed', error);
  });
});

ensureBackupAlarm();

/**
 * Create the daily backup alarm when it is missing. Alarms persist across
 * restarts, so this create-if-missing runs cheaply on every SW start (and
 * again from onInstalled, covering fresh installs and updates).
 */
async function ensureBackupAlarm() {
  if (typeof api.alarms?.create !== 'function') {
    return;
  }
  try {
    const existing = await api.alarms.get(BACKUP_ALARM);
    if (!existing) {
      api.alarms.create(BACKUP_ALARM, {
        periodInMinutes: BACKUP_PERIOD_MINUTES,
        delayInMinutes: BACKUP_DELAY_MINUTES,
      });
    }
  } catch (error) {
    console.error('[CEP] could not ensure the backup alarm', error);
  }
}

/**
 * Snapshot every cookie of every cookie store — unless the user turned the
 * automatic backup off. A snapshot for today's date overwrites the previous
 * one, so re-fires stay idempotent per day.
 * @returns {Promise<{date: string, count: number}>}
 */
async function runDailyBackup() {
  let options = {};
  try {
    options = await getOptions();
  } catch {
    // Storage unavailable — fall through with the default (enabled).
  }
  if (options.autoBackup === false) {
    return { date: '', count: 0 };
  }
  return runBackup();
}

/* ------------------------------------------------------------------ *
 * Toolbar icon — open the side panel or the popup (options.openTarget).
 * ------------------------------------------------------------------ */

const POPUP_PATH = 'interface/popup/cookie-list.html';

/**
 * Sync the toolbar-icon behavior with the persisted openTarget option:
 * "panel" clears the popup and asks Chrome to open the side panel on click
 * (setPanelBehavior, Chrome 114+ — older builds silently keep the popup),
 * "popup" restores the normal popup. Runs on every SW start and whenever
 * the options change.
 * @returns {Promise<void>}
 */
async function applyOpenTargetBehavior() {
  let options = {};
  try {
    options = await getOptions();
  } catch {
    // Defaults apply when storage is unavailable.
  }
  const panelSupported = typeof api.sidePanel?.setPanelBehavior === 'function';
  const openAsPanel = options.openTarget === 'panel' && panelSupported;
  try {
    if (panelSupported) {
      await api.sidePanel.setPanelBehavior({ openPanelOnActionClick: openAsPanel });
    }
    await api.action.setPopup({ popup: openAsPanel ? '' : POPUP_PATH });
  } catch (error) {
    console.error('[CEP] could not apply the open-target behavior', error);
  }
}

api.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.options) {
    applyOpenTargetBehavior();
  }
});

applyOpenTargetBehavior();

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[CEP] ${details.reason} — v${api.runtime.getManifest().version}`);
  ensureBackupAlarm();
});
