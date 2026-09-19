/**
 * CookieLens — cookie model helpers.
 *
 * Pure functions shared by the popup and the service worker: no chrome.* calls.
 */

/**
 * Return a new array sorted by the given column and direction.
 * Name and domain use locale-aware case-insensitive comparison; expiration is
 * numeric and session cookies always sort last, whatever the direction.
 * @param {Array<object>} cookies
 * @param {'name'|'domain'|'expiration'} column
 * @param {'asc'|'desc'} [direction]
 * @returns {Array} sorted copy (input untouched)
 */
export function sortBy(cookies, column, direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  const sorted = [...cookies];

  if (column === 'expiration') {
    sorted.sort((a, b) => {
      const aSession = a.session === true || a.expirationDate == null;
      const bSession = b.session === true || b.expirationDate == null;
      if (aSession && bSession) {
        return 0;
      }
      if (aSession) {
        return 1; // session cookies always last, regardless of direction
      }
      if (bSession) {
        return -1;
      }
      return (Number(a.expirationDate) - Number(b.expirationDate)) * factor;
    });
    return sorted;
  }

  const key = column === 'domain' ? 'domain' : 'name';
  sorted.sort((a, b) => {
    return (
      String(a[key] ?? '').localeCompare(String(b[key] ?? ''), undefined, { sensitivity: 'base' }) * factor
    );
  });
  return sorted;
}

/**
 * Return a new array sorted by cookie name, case-insensitive.
 * Kept as a stable helper; delegates to sortBy().
 * @param {Array<object>} cookies
 * @returns {Array} sorted copy (input untouched)
 */
export function sortByName(cookies) {
  return sortBy(cookies, 'name', 'asc');
}

/**
 * Get the origin (scheme + host + port) of a URL.
 * @param {string} url
 * @returns {string}
 * @throws {TypeError} when the URL cannot be parsed
 */
export function originOf(url) {
  return new URL(url).origin;
}

/**
 * Get the hostname of a URL.
 * @param {string} url
 * @returns {string}
 * @throws {TypeError} when the URL cannot be parsed
 */
export function hostnameOf(url) {
  return new URL(url).hostname;
}

/**
 * Check whether a URL is a plain web URL (http/https only).
 * chrome://, edge://, about:, file:, ... are not editable.
 * @param {string} url
 * @returns {boolean}
 */
export function isWebUrl(url) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Build a chrome.cookies.set() details object from a generic parsed cookie
 * (form state or imported cookie). Only known fields are copied, so internal
 * metadata (pinned, protected, storeId, ...) never reaches the browser API.
 * @param {object} parsed
 * @param {string} parsed.name
 * @param {string} [parsed.value]
 * @param {string} [parsed.domain]
 * @param {string} [parsed.path]
 * @param {number} [parsed.expirationDate] epoch seconds
 * @param {boolean} [parsed.session]
 * @param {boolean} [parsed.hostOnly]
 * @param {boolean} [parsed.secure]
 * @param {boolean} [parsed.httpOnly]
 * @param {string} [parsed.sameSite]
 * @param {string} tabUrl URL used for the set() call (determines the host)
 * @returns {object} details ready for chrome.cookies.set()
 */
export function buildCookieForSet(parsed, tabUrl) {
  const url = isWebUrl(tabUrl) ? originOf(tabUrl) : String(tabUrl);
  const details = {
    url,
    name: parsed.name,
    value: typeof parsed.value === 'string' ? parsed.value : '',
    path: typeof parsed.path === 'string' && parsed.path.trim() ? parsed.path : '/',
  };

  if (parsed.secure === true) {
    details.secure = true;
  }
  if (parsed.httpOnly === true) {
    details.httpOnly = true;
  }
  if (parsed.sameSite === 'no_restriction' || parsed.sameSite === 'lax' || parsed.sameSite === 'strict') {
    details.sameSite = parsed.sameSite;
  }
  if (details.sameSite === 'no_restriction') {
    // Chrome refuses SameSite=no_restriction without the Secure flag.
    details.secure = true;
  }

  const session = parsed.session === true || parsed.expirationDate == null;
  if (!session) {
    details.expirationDate = Math.floor(Number(parsed.expirationDate));
  }

  // Omitting domain makes set() create a host-only cookie for the url's host;
  // a domain cookie (subdomains included) is expressed by passing domain explicitly.
  const hostOnly = parsed.hostOnly === true || typeof parsed.domain !== 'string' || !parsed.domain.trim();
  if (!hostOnly) {
    details.domain = parsed.domain.trim().replace(/^\./, '');
  }

  return details;
}

/**
 * Convert epoch seconds to a datetime-local input value in local time.
 * @param {number} seconds
 * @returns {string} "YYYY-MM-DDTHH:mm", or '' for invalid input
 */
export function unixToDatetimeLocal(seconds) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (part) => String(part).padStart(2, '0');
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
  const time = [pad(date.getHours()), pad(date.getMinutes())].join(':');
  return `${day}T${time}`;
}

/**
 * Convert a datetime-local input value to epoch seconds (interpreted as local time).
 * @param {string} value
 * @returns {number|null} epoch seconds, or null when empty/invalid
 */
export function datetimeLocalToUnix(value) {
  if (!value) {
    return null;
  }
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
