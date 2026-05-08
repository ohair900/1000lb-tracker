/**
 * Estimated One-Rep Max (e1RM) calculations.
 *
 * - calcE1RM  — Epley formula: weight * (1 + reps / 30)
 * - bestE1RM  — highest e1RM recorded for a given lift
 * - getTotal  — sum of best e1RM across squat, bench, deadlift
 */

import { E1RM_DIVISOR } from '../constants/formulas.js';
import store from '../state/store.js';
import type { Lift } from '../types.js';

/**
 * Calculate estimated 1-rep max using the Epley formula.
 * For singles (reps === 1) the weight itself is the e1RM.
 */
export function calcE1RM(weight: number, reps: number): number {
  return reps === 1 ? weight : weight * (1 + reps / E1RM_DIVISOR);
}

/**
 * Find the best (highest) e1RM ever recorded for a lift.
 * Returns null if no entries exist.
 */
export function bestE1RM(lift: Lift): number | null {
  const v = store.entries.filter((e: { lift: string; e1rm: number }) => e.lift === lift);
  return v.length === 0 ? null : Math.max(...v.map((e: { e1rm: number }) => e.e1rm));
}

/**
 * Sum the best e1RM for each of the three competition lifts.
 * Returns null if any lift has no entries.
 */
export function getTotal(): number | null {
  const s = bestE1RM('squat');
  const b = bestE1RM('bench');
  const d = bestE1RM('deadlift');
  return s && b && d ? s + b + d : null;
}
