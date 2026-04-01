// src/formulas/inol.js — Intensity of Number of Lifts (INOL) load metric

/**
 * Calculate INOL for a main lift set.
 * INOL = reps / (100 - %1RM)
 *
 * Produces a load value that accounts for intensity — heavy singles at 95%
 * produce ~10× the load of a rep at 50%, even though tonnage is proportional.
 *
 * @param {number} weight - Weight lifted
 * @param {number} reps   - Number of reps
 * @param {number} e1rm   - Estimated 1-rep max
 * @returns {number} INOL value (falls back to weight*reps if no e1rm)
 */
export function calcINOL(weight, reps, e1rm) {
  if (!e1rm || e1rm <= 0) return weight * reps;
  const pct1RM = Math.min(99, (weight / e1rm) * 100);
  return reps / (100 - pct1RM);
}

/**
 * Calculate INOL for an accessory exercise using pctOfTM to approximate %1RM.
 *
 * pctOfTM represents the working weight as a fraction of the training max.
 * Since TM is typically ~90% of true 1RM, pctOfTM × 90 approximates %1RM.
 *
 * @param {number} weight  - Weight lifted
 * @param {number} reps    - Number of reps
 * @param {number} pctOfTM - Fraction of training max (e.g. 0.65)
 * @returns {number} INOL value (falls back to weight*reps if no pctOfTM)
 */
export function calcAccessoryINOL(weight, reps, pctOfTM) {
  if (!pctOfTM || pctOfTM <= 0) return weight * reps;
  const approxPct1RM = Math.min(99, pctOfTM * 90);
  return reps / (100 - approxPct1RM);
}
