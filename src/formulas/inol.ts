/**
 * Intensity of Number of Lifts (INOL) load metric.
 *
 * INOL = reps / (100 - %1RM)
 */

/**
 * Calculate INOL for a main lift set.
 * Falls back to weight × reps if no e1rm is available.
 */
export function calcINOL(weight: number, reps: number, e1rm: number): number {
  if (!e1rm || e1rm <= 0) return weight * reps;
  const pct1RM = Math.min(99, (weight / e1rm) * 100);
  return reps / (100 - pct1RM);
}

/**
 * Calculate INOL for an accessory exercise using pctOfTM to approximate %1RM.
 * Since TM ≈ 90% of true 1RM, pctOfTM × 90 approximates %1RM.
 */
export function calcAccessoryINOL(weight: number, reps: number, pctOfTM: number): number {
  if (!pctOfTM || pctOfTM <= 0) return weight * reps;
  const approxPct1RM = Math.min(99, pctOfTM * 90);
  return reps / (100 - approxPct1RM);
}
