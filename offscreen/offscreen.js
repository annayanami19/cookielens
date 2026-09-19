/**
 * CookieLens — offscreen clipboard document.
 *
 * Plain script (not an ES module): the offscreen document is a minimal
 * helper page and stays a plain script like the devtools entry file.
 * It listens for exactly one message from the service worker:
 *   { type: 'copy', text }  →  navigator.clipboard.writeText(text)
 * and answers { ok: true } or { error }.
 */

const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'copy') {
    return undefined;
  }
  navigator.clipboard
    .writeText(String(message.text ?? ''))
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ error: error?.message ?? String(error) }));
  return true; // keep the channel open for the async response
});
