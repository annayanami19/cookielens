/**
 * CookieLens — named cookie profiles.
 *
 * Storage shape (chrome.storage.local, own key — not via storage-handler):
 *   profiles: { "<uuid>": { id, name, domain|null, createdAt,
 *                           cookies: [native cookie objects, storeId stripped] } }
 *
 * Profiles are store-independent: storeId is stripped on save, and restoring
 * happens through the service worker's importCookies on the target tab.
 */

import { api } from './browser-detector.js';

const PROFILES_KEY = 'profiles';

/**
 * Read the whole profiles map.
 * @returns {Promise<object>} map of id → profile
 */
async function readProfiles() {
  const result = await api.storage.local.get(PROFILES_KEY);
  return result[PROFILES_KEY] ?? {};
}

/**
 * Persist the whole profiles map.
 * @param {object} map
 * @returns {Promise<void>}
 */
async function writeProfiles(map) {
  await api.storage.local.set({ [PROFILES_KEY]: map });
}

/**
 * Copy a cookie without its storeId (profiles must be store-independent).
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
 * List all profiles, newest first.
 * @returns {Promise<Array<object>>}
 */
export async function listProfiles() {
  const map = await readProfiles();
  return Object.values(map).sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
}

/**
 * Get one profile by id.
 * @param {string} id
 * @returns {Promise<object|null>} the profile, or null when unknown
 */
export async function getProfile(id) {
  const map = await readProfiles();
  return map[id] ?? null;
}

/**
 * Save a new profile under a fresh UUID.
 * @param {object} input
 * @param {string} input.name display name
 * @param {string|null} [input.domain] bound hostname, or null for a global profile
 * @param {Array<object>} [input.cookies] cookies to store (storeId stripped here)
 * @returns {Promise<object>} the stored profile
 */
export async function saveProfile({ name, domain = null, cookies = [] }) {
  const profile = {
    id: crypto.randomUUID(),
    name: String(name ?? '').trim() || 'Untitled profile',
    domain: domain ? String(domain) : null,
    createdAt: Date.now(),
    cookies: cookies.map(stripStoreId),
  };
  const map = await readProfiles();
  map[profile.id] = profile;
  await writeProfiles(map);
  return profile;
}

/**
 * Duplicate a profile under a new id, with "(copy)" appended to the name.
 * @param {string} id id of the profile to duplicate
 * @returns {Promise<object>} the new profile
 * @throws {Error} when the profile does not exist
 */
export async function duplicateProfile(id) {
  const map = await readProfiles();
  const source = map[id];
  if (!source) {
    throw new Error('Profile not found.');
  }
  const copy = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} (copy)`,
    createdAt: Date.now(),
    cookies: (source.cookies ?? []).map(stripStoreId),
  };
  map[copy.id] = copy;
  await writeProfiles(map);
  return copy;
}

/**
 * Rename a profile.
 * @param {string} id
 * @param {string} name new display name
 * @returns {Promise<object>} the updated profile
 * @throws {Error} when the profile does not exist
 */
export async function renameProfile(id, name) {
  const map = await readProfiles();
  const profile = map[id];
  if (!profile) {
    throw new Error('Profile not found.');
  }
  const trimmed = String(name ?? '').trim();
  if (trimmed) {
    profile.name = trimmed;
  }
  map[id] = profile;
  await writeProfiles(map);
  return profile;
}

/**
 * Delete a profile (no-op for unknown ids).
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteProfile(id) {
  const map = await readProfiles();
  if (!map[id]) {
    return;
  }
  delete map[id];
  await writeProfiles(map);
}
