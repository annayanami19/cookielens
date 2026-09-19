/**
 * CookieLens — tiny pub/sub event bus.
 */

export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} listener
   * @returns {Function} unsubscribe function
   */
  on(event, listener) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Unsubscribe a listener from an event.
   * @param {string} event
   * @param {Function} listener
   */
  off(event, listener) {
    this._listeners.get(event)?.delete(listener);
  }

  /**
   * Emit an event to every listener. A throwing listener never breaks the others.
   * @param {string} event
   * @param {...*} args
   */
  emit(event, ...args) {
    const listeners = this._listeners.get(event);
    if (!listeners) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`[CEP] listener for "${event}" failed`, error);
      }
    }
  }
}
