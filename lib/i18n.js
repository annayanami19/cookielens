/**
 * CookieLens — i18n helpers over chrome.i18n.
 *
 * `t()` wraps api.i18n.getMessage (it returns the key itself when the
 * message is missing, so gaps stay visible during development).
 * `applyI18n()` fills elements carrying data-i18n attributes:
 *
 *   data-i18n             → textContent
 *   data-i18n-placeholder → placeholder attribute
 *   data-i18n-title       → title attribute
 *   data-i18n-aria-label  → aria-label attribute
 *
 * The active locale follows the browser's language (standard extension
 * i18n); there is no manual in-extension switcher.
 */

import { api } from './browser-detector.js';

/**
 * Translate a message key with optional substitutions.
 * @param {string} key message key from the locale message files
 * @param {string|Array<string>} [substitutions] values for the $1…$9 placeholders
 * @returns {string} the translated message, or the key when it is unknown
 */
export function t(key, substitutions = []) {
  try {
    const message = api.i18n.getMessage(key, substitutions);
    return message || key;
  } catch {
    return key;
  }
}

/**
 * Fill every translatable element under `root` from its data-i18n
 * attributes. Call once at init; JS-generated text uses t() directly.
 * @param {Document|Element} [root] subtree to localize (defaults to the page)
 */
export function applyI18n(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.getAttribute('data-i18n'));
  }
  for (const element of root.querySelectorAll('[data-i18n-placeholder]')) {
    element.setAttribute('placeholder', t(element.getAttribute('data-i18n-placeholder')));
  }
  for (const element of root.querySelectorAll('[data-i18n-title]')) {
    element.setAttribute('title', t(element.getAttribute('data-i18n-title')));
  }
  for (const element of root.querySelectorAll('[data-i18n-aria-label]')) {
    element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria-label')));
  }
}
