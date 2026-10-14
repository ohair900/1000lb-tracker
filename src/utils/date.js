/**
 * Date-related utility functions.
 *
 * All date strings in the app use the ISO-8601 `YYYY-MM-DD` format.
 * IMPORTANT: "today" and date-grouping keys must use the lifter's LOCAL
 * wall clock (getFullYear/getMonth/getDate). Using
 * `new Date().toISOString()` returns UTC, which is already tomorrow for
 * evening lifters west of Greenwich — that shifted logged sets, streaks,
 * and chart buckets by a day. Use localDateStr() for any "what day is it"
 * computation. We append "T12:00:00" when constructing Date objects to
 * avoid timezone-boundary bugs near midnight.
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
 * Return the LOCAL calendar date of `d` as a `YYYY-MM-DD` string, using
 * the device's wall clock (getFullYear/getMonth/getDate).
 *
 * Prefer this over `d.toISOString().split('T')[0]` whenever the question is
 * "what day is it for the lifter" — toISOString() is UTC, so after ~5-6 PM
 * in US timezones it already returns tomorrow.
 *
 * @param {Date} [d] - Defaults to now.
 * @returns {string} e.g. "2026-10-13"
 */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Alias for localDateStr — same local-wall-clock `YYYY-MM-DD` key.
 * @param {Date} [d] - Defaults to now.
 * @returns {string}
 */
export const localDateKey = localDateStr;

/**
 * Calculate the integer number of days between two ISO date strings.
 * Positive if `a` is later than `b`.
 * @param {string} a - ISO date string
 * @param {string} b - ISO date string
 * @returns {number}
 */
export function dayDiff(a, b) {
  return Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / MS_PER_DAY);
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
