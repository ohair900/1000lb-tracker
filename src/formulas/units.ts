/**
 * Unit conversion and weight display helpers.
 *
 * Internal storage unit is always lbs.  These functions convert to/from
 * the user's display unit (lbs or kg) using the current value in the store.
 */

import { LBS_PER_KG } from '../constants/formulas.js';
import store from '../state/store.js';

// Re-export fmtNum from helpers so callers that import from formulas/units
// don't need a separate import for number formatting.
export { fmtNum } from '../utils/helpers.js';

/** Convert a value in lbs to kg. */
export function lbsToKg(v: number): number {
  return v / LBS_PER_KG;
}

/**
 * Convert an internal lbs value to the user's display unit, rounded to
 * one decimal place.
 */
export function displayWeight(val: number): number {
  if (store.unit === 'kg') return Math.round((val / LBS_PER_KG) * 10) / 10;
  return Math.round(val * 10) / 10;
}

/**
 * Format a weight for display as a string.  Integers are shown without
 * a decimal; fractional values get one decimal place.
 */
export function formatWeight(val: number): string {
  const w = displayWeight(val);
  return Number.isInteger(w) ? w.toString() : w.toFixed(1);
}

/**
 * Convert a user-entered value (which may be in kg) to the internal lbs unit.
 * If the user's unit is already lbs the value passes through unchanged.
 */
export function inputToLbs(val: number): number {
  return store.unit === 'kg' ? val * LBS_PER_KG : val;
}
