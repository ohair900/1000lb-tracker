/**
 * Date-related utility functions.
 *
 * All date strings in the app use the ISO-8601 `YYYY-MM-DD` format
 * (the "date" portion of `new Date().toISOString()`).  We append
 * "T12:00:00" when constructing Date objects to avoid timezone-boundary
 * bugs near midnight.
 */

import { MS_PER_DAY } from '../constants/time.js';

/**
 * Return a `YYYY-Www` week key for the given ISO date string.
 * Week numbering starts from Jan 1 and counts by 7-day spans —
 * this is a simplified ISO-week approximation, not strict ISO 8601.
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @returns {string} e.g. "2025-W09"
 */
export function getWeekKey(date) {
  const d = new Date(date + 'T12:00:00');
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / MS_PER_DAY + jan1.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + String(week).padStart(2, '0');
}

/**
 * Return a `YYYY-MM` month key for the given ISO date string.
 * Simply slices the first 7 characters.
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @returns {string} e.g. "2025-03"
 */
export function getMonthKey(date) {
  return date.slice(0, 7);
}

/**
 * Return today's date as an ISO date string (YYYY-MM-DD).
 * @returns {string}
 */
export function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Calculate the integer number of days between two ISO date strings.
 * Positive if `a` is later than `b`.
 * @param {string} a - ISO date string
 * @param {string} b - ISO date string
 * @returns {number}
 */
export function dayDiff(a, b) {
  return Math.round(
    (new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / MS_PER_DAY
  );
}

/**
 * Format a date string for display using the user's locale.
 * @param {string} date - ISO date string (YYYY-MM-DD)
 * @param {Intl.DateTimeFormatOptions} [opts] - Intl format options
 * @returns {string}
 */
export function formatDate(date, opts) {
  const defaults = { month: 'short', day: 'numeric', year: 'numeric' };
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', opts || defaults);
}
