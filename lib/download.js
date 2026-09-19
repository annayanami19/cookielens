/**
 * CookieLens — file download helper.
 *
 * Builds a Blob, triggers a download through a temporary anchor, then
 * revokes the object URL. No chrome.downloads permission needed: extension
 * pages (popup/options) may use plain anchor downloads.
 */

/**
 * Download a UTF-8 text file to the user's download folder.
 * @param {string} filename suggested file name
 * @param {string} text file contents
 */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Revoke on the next tick so the download has started before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
