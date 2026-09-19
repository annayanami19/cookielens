/**
 * CookieLens — thin promise wrapper over chrome.storage.local
 * for the persisted `options` object.
 */

import { api } from './browser-detector.js';

const OPTIONS_KEY = 'options';

const DEFAULT_OPTIONS = Object.freeze({
  advanced: false,
  theme: 'auto',
  exportFormat: 'json',
  extraInfo: 'value',
  buttonBarPosition: 'bottom',
  animations: true,
  sortColumn: 'name',
  sortDirection: 'asc',
  autoBackup: true,
  openTarget: 'panel',
});

/**
 * Read the persisted options, merged over the defaults.
 * @returns {Promise<object>}
 */
export async function getOptions() {
  const result = await api.storage.local.get(OPTIONS_KEY);
  return { ...DEFAULT_OPTIONS, ...(result[OPTIONS_KEY] ?? {}) };
}

/**
 * Merge a partial patch into the persisted options.
 * @param {object} patch
 * @returns {Promise<void>}
 */
export async function setOptions(patch) {
  const current = await getOptions();
  await api.storage.local.set({ [OPTIONS_KEY]: { ...current, ...patch } });
}
