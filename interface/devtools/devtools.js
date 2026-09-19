/**
 * CookieLens — DevTools panel registration.
 *
 * Plain script (no ES module import): devtools pages are a special document
 * and this keeps the registration working identically on Chromium and
 * Firefox. The panel reuses interface/popup/cookie-list.html; that page
 * detects the devtools context itself, applies i18n through applyI18n() in
 * its own init, and resolves the inspected tab through the service worker
 * (getTabById).
 *
 * The panel title stays the literal extension name on purpose: the
 * devtools.panels.create() API takes no __MSG_ keys and this invisible
 * document has no other UI text — its title is localized directly via
 * chrome.i18n.getMessage.
 */

const api = globalThis.browser ?? globalThis.chrome;

document.title = api.i18n?.getMessage('extName') || 'CookieLens';

try {
  api.devtools.panels.create('CookieLens', '../../icons/32.png', '../popup/cookie-list.html');
} catch (error) {
  console.error('[CEP] could not create the DevTools panel', error);
}
