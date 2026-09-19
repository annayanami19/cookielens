/**
 * CookieLens — per-domain cookie flags (pins & protected).
 *
 * Storage shape (chrome.storage.local, own keys — not via storage-handler):
 *   pins:      { "<domain-key>": ["cookieName", ...] }
 *   protected: { "<domain-key>": ["cookieName", ...] }
 *
 * The domain key is the cookie's own domain, lowercased with the leading dot
 * stripped — the same rule every consumer (popup list, service worker)
 * applies when checking a flag.
 */

import { api } from './browser-detector.js';

/** Storage key of the pinned-cookies map. */
export const FLAG_PINS = 'pins';

/** Storage key of the protected-cookies map. */
export const FLAG_PROTECTED = 'protected';

/**
 * Normalize a cookie domain into the storage map key.
 * @param {object} cookie
 * @returns {string} lowercased domain without the leading dot ('' when absent)
 */
export function domainKeyOf(cookie) {
  return String(cookie?.domain ?? '').replace(/^\./, '').toLowerCase();
}

/**
 * Read one full flag map from storage.
 * @param {'pins'|'protected'} flag storage key of the map
 * @returns {Promise<object>} map of domain key → cookie names (never null)
 */
export async function getFlagMap(flag) {
  const result = await api.storage.local.get(flag);
  return result[flag] ?? {};
}

/**
 * Get the flagged cookie names stored for one domain key.
 * @param {object} map full flag map as returned by getFlagMap()
 * @param {string} domainKey domain key (see domainKeyOf)
 * @returns {string[]} flagged cookie names for that domain
 */
export function getFlagged(map, domainKey) {
  return map?.[domainKey] ?? [];
}

/**
 * Check whether a cookie carries the flag, using its own domain key.
 * @param {object} map full flag map as returned by getFlagMap()
 * @param {object} cookie
 * @returns {boolean}
 */
export function isFlagged(map, cookie) {
  return getFlagged(map, domainKeyOf(cookie)).includes(cookie.name);
}

/**
 * Add a cookie to a flag map (no-op when already flagged) and persist it.
 * @param {object} cookie
 * @param {'pins'|'protected'} flag
 * @returns {Promise<void>}
 */
export async function setFlag(cookie, flag) {
  const map = await getFlagMap(flag);
  const key = domainKeyOf(cookie);
  const names = getFlagged(map, key);
  if (names.includes(cookie.name)) {
    return;
  }
  map[key] = [...names, cookie.name];
  await api.storage.local.set({ [flag]: map });
}

/**
 * Remove a cookie from a flag map and persist it. Empty domain entries are
 * dropped to keep the map small.
 * @param {object} cookie
 * @param {'pins'|'protected'} flag
 * @returns {Promise<void>}
 */
export async function clearFlag(cookie, flag) {
  const map = await getFlagMap(flag);
  const key = domainKeyOf(cookie);
  const names = getFlagged(map, key);
  if (!names.includes(cookie.name)) {
    return;
  }
  const rest = names.filter((name) => name !== cookie.name);
  if (rest.length === 0) {
    delete map[key];
  } else {
    map[key] = rest;
  }
  await api.storage.local.set({ [flag]: map });
}
