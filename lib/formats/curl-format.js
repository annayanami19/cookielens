/**
 * CookieLens — cURL command export.
 *
 * Cookies are embedded as a single `Cookie:` header built exactly like the
 * Header String format (no domain/path/flags travel in a curl header). Two
 * shell dialects:
 *   bash — single quotes, `'` escaped as `'\''`, two lines joined with " \"
 *   cmd  — double quotes, `"` escaped as `\"`, one line
 * Export-only: there is no parse() because a curl command cannot be turned
 * back into cookies losslessly.
 */

import { serialize as serializeHeaderString } from './headerstring-format.js';

/**
 * Escape a value for single-quoted bash usage: ' becomes '\''.
 * @param {string} text
 * @returns {string}
 */
function escapeBash(text) {
  return String(text).replace(/'/g, `'\\''`);
}

/**
 * Escape a value for double-quoted Windows CMD usage: " becomes \".
 * @param {string} text
 * @returns {string}
 */
function escapeCmd(text) {
  return String(text).replace(/"/g, '\\"');
}

/**
 * Serialize cookies as a ready-to-run cURL command.
 * @param {Array<object>} cookies
 * @param {object} [options]
 * @param {string} [options.url] request URL (usually the active tab URL)
 * @param {'bash'|'cmd'} [options.shell] target shell dialect, default "bash"
 * @returns {string}
 */
export function serialize(cookies, { url = '', shell = 'bash' } = {}) {
  const headerValue = serializeHeaderString(cookies);

  if (shell === 'cmd') {
    return `curl "${escapeCmd(url)}" -H "Cookie: ${escapeCmd(headerValue)}"`;
  }
  return `curl '${escapeBash(url)}' \\\n  -H 'Cookie: ${escapeBash(headerValue)}'`;
}
