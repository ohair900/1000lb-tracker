/**
 * Plate-loading calculations.
 *
 * All functions are unit-aware — they read the current unit from the store
 * and select the appropriate plate set (kg or lbs) and bar weight.
 */

import { PLATES_KG, PLATES_LBS } from '../constants/lift-config.js';
import { WEIGHT_INCREMENT_KG, WEIGHT_INCREMENT_LBS } from '../constants/thresholds.js';
import store from '../state/store.js';

/**
 * Round a weight to the nearest loadable increment.
 * Uses 2.5 kg increments in kg mode, 5 lb increments in lbs mode.
 * @param {number} weight - Weight in the current display unit
 * @returns {number} Rounded weight
 */
export function roundToPlate(weight) {
  const increment = store.unit === 'kg' ? WEIGHT_INCREMENT_KG : WEIGHT_INCREMENT_LBS;
  return Math.round(weight / increment) * increment;
}

/**
 * Calculate the plates needed on each side of the bar.
 * Returns null if the weight is at or below the empty bar.
 * @param {number} totalWeight - Total barbell weight in the current display unit
 * @returns {number[]|null} Array of plate values per side (descending), or null
 */
export function calcPlatesPerSide(totalWeight) {
  const barWeight = store.unit === 'kg' ? 20 : 45;
  if (totalWeight <= barWeight) return null;
  let remaining = (totalWeight - barWeight) / 2;
  const plates = store.unit === 'kg' ? PLATES_KG : PLATES_LBS;
  const result = [];
  for (const plate of plates) {
    while (remaining >= plate - 0.01) {
      result.push(plate);
      remaining -= plate;
    }
  }
  return result;
}

/**
 * Format plate loading as a human-readable string.
 * Example: "45x2 + 25 + 10"  (per side)
 * @param {number} totalWeight - Total barbell weight in the current display unit
 * @returns {string} Formatted plate string, or '' if no plates needed
 */
export function formatPlates(totalWeight) {
  const plates = calcPlatesPerSide(totalWeight);
  if (!plates || plates.length === 0) return '';
  const seen = [];
  plates.forEach(p => {
    const existing = seen.find(s => s.plate === p);
    if (existing) existing.count++;
    else seen.push({ plate: p, count: 1 });
  });
  return seen.map(s => s.count > 1 ? `${s.plate}x${s.count}` : `${s.plate}`).join(' + ');
}
