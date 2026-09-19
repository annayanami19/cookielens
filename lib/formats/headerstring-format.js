/**
 * CookieLens — HTTP Cookie header string format ("name=value; ...").
 *
 * The format carries no domain/path/flags, so parsed cookies are host-only
 * session cookies; the import flow binds them to the current tab origin.
 */

const PAIR_SEPARATOR = /;\s*/;

/**
 * Serialize cookies to a single header string.
 * @param {Array<object>} cookies
 * @returns {string}
 */
export function serialize(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value ?? ''}`).join('; ');
}

/**
 * Parse a header string into cookies.
 * @param {string} text
 * @returns {Array<object>} normalized cookies
 * @throws {Error} with a user-friendly message
 */
export function parse(text) {
  const cookies = [];

  for (const part of text.trim().split(PAIR_SEPARATOR)) {
    const pair = part.trim();
    if (!pair) {
      continue;
    }
    const equals = pair.indexOf('=');
    const name = equals > 0 ? pair.slice(0, equals).trim() : '';
    if (!name) {
      throw new Error('Input is not in a valid format.');
    }
    cookies.push({
      name,
      value: pair.slice(equals + 1),
      domain: undefined,
      hostOnly: true,
      path: '/',
      secure: false,
      httpOnly: false,
      session: true,
      sameSite: 'unspecified',
    });
  }

  if (cookies.length === 0) {
    throw new Error('No cookies found.');
  }
  return cookies;
}
