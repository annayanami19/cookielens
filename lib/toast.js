/**
 * CookieLens — toast notifications for the popup.
 *
 * Toasts stack in a fixed container; each auto-dismisses after 2.5 s (5 s
 * when it carries an action button such as "Undo") or via its close button.
 * `role="alert"` keeps screen readers informed. Message text is set through
 * textContent, so cookie names/values are safe to show.
 */

import { t } from './i18n.js';

const TOAST_DURATION_MS = 2500;
const TOAST_ACTION_DURATION_MS = 5000;

/**
 * Show a toast message, optionally with one action button (e.g. "Undo").
 * @param {string} message
 * @param {'info'|'success'|'error'} [type]
 * @param {object} [options]
 * @param {string} [options.actionLabel] label of the extra action button
 * @param {Function} [options.onAction] invoked when the action button is clicked
 * @param {number} [options.durationMs] auto-dismiss delay; defaults to 5 s for
 *   toasts with an action, otherwise 2.5 s
 */
export function showToast(message, type = 'info', options = {}) {
  const container = ensureContainer();
  const { actionLabel = '', onAction = null, durationMs } = options;
  const duration =
    durationMs ?? (actionLabel && typeof onAction === 'function' ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS);

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');

  const text = document.createElement('span');
  text.className = 'toast-message';
  text.textContent = message;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.textContent = '✕';
  close.setAttribute('aria-label', t('commonDismissToast'));

  const timer = setTimeout(dismiss, duration);
  close.addEventListener('click', () => dismiss());

  if (actionLabel && typeof onAction === 'function') {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'toast-action';
    action.textContent = actionLabel;
    action.addEventListener('click', () => {
      dismiss();
      onAction();
    });
    toast.append(text, action, close);
  } else {
    toast.append(text, close);
  }

  container.append(toast);

  function dismiss() {
    clearTimeout(timer);
    toast.remove();
  }
}

/**
 * Return the toast container, creating it on first use.
 * @returns {HTMLElement}
 */
function ensureContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.append(container);
  }
  return container;
}
