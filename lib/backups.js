/**
 * CookieLens — automatic daily backups.
 *
 * Storage shape (chrome.storage.local, own key — not via storage-handler):
 *   backups: { "<YYYY-MM-DD>": { date, count,
 *                                cookies: [native cookie objects, storeId stripped] } }
 *
 * A snapshot covers every cookie of every cookie store — the same iteration
 * the service worker uses for getAllCookiesEverywhere. Only the 5 newest
 * dates are kept, and writing a snapshot for a date that already exists
 * overwrites it, so the daily alarm stays idempotent per day. The restore
 * itself is a merge performed by the service worker (`restoreBackup`).
 */

import { api } from './browser-detector.js';

const BACKUPS_KEY = 'backups';
const MAX_BACKUPS = 5;

/**
 * Local "YYYY-MM-DD" stamp used as the backup map key.
 * @returns {string}
 */
function todayKey() {
  const now = new Date();
  const pad = (part) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Copy a cookie without its storeId (backups must be store-independent).
 * @param {object} cookie
 * @returns {object} shallow copy without the storeId key
 */
function stripStoreId(cookie) {
  const copy = {};
  for (const [key, value] of Object.entries(cookie ?? {})) {
    if (key !== 'storeId') {
      copy[key] = value;
    }
  }
  return copy;
}

/**
 * Read the whole backups map.
 * @returns {Promise<object>} map of date → backup
 */
async function readBackups() {
  const result = await api.storage.local.get(BACKUPS_KEY);
  return result[BACKUPS_KEY] ?? {};
}

/**
 * Collect every cookie of every cookie store (same iteration as the
 * service worker's getAllCookiesEverywhere).
 * @returns {Promise<Array<object>>}
 */
async function collectAllCookies() {
  const stores = await api.cookies.getAllCookieStores();
  const cookies = [];
  for (const store of stores) {
    cookies.push(...(await api.cookies.getAll({ storeId: store.id })));
  }
  return cookies;
}

/**
 * List the stored backups, newest date first.
 * @returns {Promise<Array<{date: string, count: number, cookies: Array<object>}>>}
 */
export async function listBackups() {
  const map = await readBackups();
  return Object.values(map).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/**
 * Take a snapshot of every cookie in the browser and store it under today's
 * date, overwriting an earlier snapshot of the same day. Afterwards only the
 * MAX_BACKUPS newest dates remain in storage.
 * @returns {Promise<{date: string, count: number}>} the stored snapshot
 */
export async function runBackup() {
  const cookies = (await collectAllCookies()).map(stripStoreId);
  const date = todayKey();
  const map = await readBackups();
  map[date] = { date, count: cookies.length, cookies };
  const newest = Object.keys(map).sort((a, b) => b.localeCompare(a)).slice(0, MAX_BACKUPS);
  const pruned = {};
  for (const key of newest) {
    pruned[key] = map[key];
  }
  await api.storage.local.set({ [BACKUPS_KEY]: pruned });
  return { date, count: cookies.length };
}

/**
 * Get one backup by date.
 * @param {string} date "YYYY-MM-DD" backup key
 * @returns {Promise<object|null>} the backup, or null when unknown
 */
export async function getBackup(date) {
  const map = await readBackups();
  return map[date] ?? null;
}

/**
 * Delete one backup (no-op for unknown dates).
 * @param {string} date "YYYY-MM-DD" backup key
 * @returns {Promise<void>}
 */
export async function deleteBackup(date) {
  const map = await readBackups();
  if (!map[date]) {
    return;
  }
  delete map[date];
  await api.storage.local.set({ [BACKUPS_KEY]: map });
}
