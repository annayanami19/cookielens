/**
 * CookieLens — JSON cookie format.
 *
 * Contract: array of native-shaped browser cookies;
 * internal metadata stripped, storeId always null, sameSite "unspecified"
 * exported as null.
 */

const EXPORT_KEYS = [
  'domain',
  'expirationDate',
  'hostOnly',
  'httpOnly',
  'name',
  'partitionKey',
  'path',
  'sameSite',
  'secure',
  'session',
  'value',
];

/**
 * Serialize cookies to pretty-printed JSON (4-space indent).
 * @param {Array<object>} cookies
 * @returns {string}
 */
export function serialize(cookies) {
  const list = cookies.map((cookie) => {
    const item = {};
    for (const key of EXPORT_KEYS) {
      item[key] = cookie[key];
    }
    item.sameSite = cookie.sameSite === 'unspecified' ? null : cookie.sameSite ?? null;
    // Session cookies have no expiry; undefined keys are dropped by JSON.stringify.
    item.expirationDate = cookie.session ? undefined : cookie.expirationDate;
    item.storeId = null;
    return item;
  });
  return JSON.stringify(list, null, 4);
}

/**
 * Parse a JSON cookie array.
 * @param {string} text
 * @returns {Array<object>} normalized cookies
 * @throws {Error} with a user-friendly message
 */
export function parse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Input is not in a valid format.');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('No cookies found.');
  }

  return data.map((item) => {
    if (typeof item !== 'object' || item === null || typeof item.name !== 'string' || !item.name) {
      throw new Error('Input is not in a valid format.');
    }
    const session = item.session === true || typeof item.expirationDate !== 'number';
    return {
      name: item.name,
      value: typeof item.value === 'string' ? item.value : '',
      domain: typeof item.domain === 'string' ? item.domain : undefined,
      hostOnly: item.hostOnly === true,
      path: typeof item.path === 'string' ? item.path : '/',
      secure: item.secure === true,
      httpOnly: item.httpOnly === true,
      session,
      expirationDate: session ? undefined : item.expirationDate,
      sameSite: typeof item.sameSite === 'string' ? item.sameSite : 'unspecified',
    };
  });
}
