/**
 * CookieLens — import format auto-detection.
 */

import * as jsonFormat from './formats/json-format.js';
import * as netscapeFormat from './formats/netscape-format.js';
import * as headerstringFormat from './formats/headerstring-format.js';

const FORMATS = [
  { name: 'JSON', format: jsonFormat },
  { name: 'Netscape', format: netscapeFormat },
  { name: 'Header String', format: headerstringFormat },
];

/**
 * Try each parser in order (JSON → Netscape → Header String) and return the
 * first one that succeeds.
 * @param {string} text
 * @returns {{format: string, cookies: Array<object>}}
 * @throws {Error} "Input is not in a valid format." when no parser accepts the text
 */
export function detectFormat(text) {
  for (const { name, format } of FORMATS) {
    try {
      const cookies = format.parse(text);
      return { format: name, cookies };
    } catch {
      // Not this format — fall through to the next parser.
    }
  }
  throw new Error('Input is not in a valid format.');
}
