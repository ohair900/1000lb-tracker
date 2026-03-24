/**
 * General-purpose utility functions extracted from the monolith.
 *
 * These are small, stateless helpers used across the entire application.
 * None of them depend on app state — they are pure functions (or thin DOM wrappers).
 */

/**
 * Shorthand for document.getElementById.
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
export const $ = (id) => document.getElementById(id);

/**
 * Escape a string for safe insertion into HTML.
 * Handles the five characters that can break HTML context.
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Classic trailing-edge debounce.
 * Returns a wrapper that delays invoking `fn` until `ms` milliseconds have
 * elapsed since the last call.
 * @param {Function} fn
 * @param {number} ms - Delay in milliseconds
 * @returns {Function}
 */
export function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * Generate a short, collision-resistant ID string.
 * Format: base-36 timestamp + 4 random base-36 chars.
 * Not cryptographically secure — fine for local entry IDs.
 * @returns {string}
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Format a number with locale-aware thousand separators, rounded to the
 * nearest integer.  Used for volume totals, tonnage, etc.
 * @param {number} n
 * @returns {string}
 */
export function fmtNum(n) {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Lazily ensure a child element with a given class exists inside `parent`.
 * If not found, creates one (default <div>) and appends it.
 * Useful for progressive DOM enhancement (e.g. badge overlays on cards).
 * @param {HTMLElement} parent
 * @param {string} cls - CSS class name to look for / assign
 * @param {string} [tag='div'] - Tag name if element must be created
 * @returns {HTMLElement}
 */
export function ensureChild(parent, cls, tag) {
  let el = parent.querySelector('.' + cls);
  if (!el) {
    el = document.createElement(tag || 'div');
    el.className = cls;
    parent.appendChild(el);
  }
  return el;
}
