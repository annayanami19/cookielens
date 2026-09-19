/**
 * CookieLens — cross-browser API accessor.
 *
 * Firefox exposes the promise-based `browser` namespace; Chromium only has
 * `chrome` (promise-based in MV3). Everything imports `api` instead of the
 * global directly so a Firefox port stays a manifest-level change.
 *
 * @type {typeof chrome}
 */
export const api = globalThis.browser ?? globalThis.chrome;
