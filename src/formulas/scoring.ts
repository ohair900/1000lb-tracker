/**
 * Competition scoring formulas — Wilks and DOTS.
 *
 * Both take a total in kg, bodyweight in kg, and gender string,
 * and return a normalised score (or null if inputs are missing).
 */

import { WILKS, DOTS } from '../constants/formulas.js';
import type { Gender } from '../types.js';

/**
 * Calculate the Wilks score.
 */
export function calcWilks(totalKg: number, bwKg: number, gender: Gender): number | null {
  if (!gender || !totalKg || !bwKg) return null;
  const c = WILKS[gender];
  const d =
    c.a + c.b * bwKg + c.c * bwKg ** 2 + c.d * bwKg ** 3 + c.e * bwKg ** 4 + c.f * bwKg ** 5;
  return d <= 0 ? null : (totalKg * 500) / d;
}

/**
 * Calculate the DOTS score.
 */
export function calcDOTS(totalKg: number, bwKg: number, gender: Gender): number | null {
  if (!gender || !totalKg || !bwKg) return null;
  const c = DOTS[gender];
  const d = c.a + c.b * bwKg + c.c * bwKg ** 2 + c.d * bwKg ** 3 + c.e * bwKg ** 4;
  return d <= 0 ? null : (totalKg * 500) / d;
}
