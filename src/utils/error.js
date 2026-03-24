/**
 * Defensive-coding utilities for wrapping risky operations.
 *
 * These keep the rest of the codebase clean by centralising try/catch
 * logic for JSON parsing and other fail-prone calls.
 */

/**
 * Execute `fn` inside a try/catch.  On failure, log a warning with
 * the provided `context` label and return `undefined`.
 * @param {Function} fn - Zero-arg function to call
 * @param {string} [context=''] - Label for the console.warn message
 * @returns {*} The return value of `fn`, or `undefined` on error
 */
export function safeCall(fn, context = '') {
  try {
    return fn();
  } catch (err) {
    console.warn(`[${context}]`, err);
    return undefined;
  }
}

/**
 * Parse a JSON string, returning `fallback` if the string is falsy
 * or if parsing throws.
 * @param {string|null|undefined} str - Raw JSON string
 * @param {*} [fallback=null] - Value returned on failure
 * @returns {*}
 */
export function safeJsonParse(str, fallback = null) {
  try {
    return str ? JSON.parse(str) : fallback;
  } catch {
    console.warn('JSON parse failed');
    return fallback;
  }
}
