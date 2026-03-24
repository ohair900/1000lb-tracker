/**
 * Fatigue calculations — per-lift ACWR and per-muscle-group ACWR.
 *
 * ACWR = Acute:Chronic Workload Ratio.
 *   - Acute  = 7-day tonnage
 *   - Chronic = 28-day tonnage / 4 (weekly average)
 *
 * Thresholds:
 *   > 1.3  -> red  (high fatigue)
 *   > 1.1  -> yellow (moderate)
 *   <= 1.1 -> green (recovered)
 */

import { MS_PER_DAY } from '../constants/time.js';
import {
  FATIGUE_THRESHOLD_HIGH,
  FATIGUE_THRESHOLD_MOD,
} from '../constants/thresholds.js';
import {
  MUSCLE_GROUPS,
  MAIN_LIFT_WEIGHTS,
  ACCESSORY_CAT_WEIGHTS,
} from '../data/muscle-groups.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import store from '../state/store.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sum the weighted tonnage contributed by accessory log entries
 * to a given muscle group (with a 0.5 multiplier).
 */
function calcAccessoryTonnage(accEntries, muscleGroup) {
  let tonnage = 0;
  accEntries.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    if (!cw || !cw[muscleGroup]) return;
    const sets = a.setsCompleted || [];
    tonnage += sets.reduce(
      (s, reps, i) => s + ((a.setWeights && a.setWeights[i]) || a.weight || 0) * reps,
      0
    ) * cw[muscleGroup] * 0.5;
  });
  return tonnage;
}

/**
 * Count how many accessory log entries contribute to a muscle group.
 */
function countAccessoryEntries(accEntries, muscleGroup) {
  return accEntries.filter(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return false;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    return cw && cw[muscleGroup];
  }).length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate per-lift fatigue using the ACWR model.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ acwr: number|null, status: 'green'|'yellow'|'red' }|null}
 *   null when there are fewer than 2 entries in the 28-day window.
 */
export function calcFatigueLift(lift) {
  const now = Date.now();
  const e7 = store.entries.filter(e => e.lift === lift && (now - e.timestamp) <= 7 * MS_PER_DAY);
  const e28 = store.entries.filter(e => e.lift === lift && (now - e.timestamp) <= 28 * MS_PER_DAY);
  if (e28.length < 2) return null;

  const ton7 = e7.reduce((s, e) => s + e.weight * e.reps, 0);
  const ton28 = e28.reduce((s, e) => s + e.weight * e.reps, 0);
  const weeklyAvg28 = ton28 / 4;
  const acwr = weeklyAvg28 > 0 ? ton7 / weeklyAvg28 : null;

  let status = 'green';
  if (acwr !== null) {
    if (acwr > FATIGUE_THRESHOLD_HIGH) status = 'red';
    else if (acwr > FATIGUE_THRESHOLD_MOD) status = 'yellow';
  }
  return { acwr, status };
}

/**
 * Calculate fatigue for each muscle group using ACWR, incorporating
 * both main-lift and accessory-log tonnage.
 *
 * @returns {Object|null} Map of muscle-group name to
 *   { acwr, status, label } or null (per-group), or null entirely
 *   if no group has enough data.
 */
export function calcFatigueByMuscle() {
  const now = Date.now();
  const results = {};
  let anyValid = false;

  // Pre-filter main lift entries by time window
  const main7 = store.entries.filter(e => (now - e.timestamp) <= 7 * MS_PER_DAY);
  const main28 = store.entries.filter(e => (now - e.timestamp) <= 28 * MS_PER_DAY);
  // Pre-filter accessory entries by time window
  const acc7 = store.accessoryLog.filter(a => (now - a.timestamp) <= 7 * MS_PER_DAY);
  const acc28 = store.accessoryLog.filter(a => (now - a.timestamp) <= 28 * MS_PER_DAY);

  MUSCLE_GROUPS.forEach(mg => {
    let ton7 = 0, ton28 = 0, count28 = 0;

    // Main lift contributions
    main28.forEach(e => {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      if (!w || !w[mg]) return;
      const ton = e.weight * e.reps * w[mg];
      ton28 += ton;
      count28++;
    });
    main7.forEach(e => {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      if (!w || !w[mg]) return;
      ton7 += e.weight * e.reps * w[mg];
    });

    // Accessory contributions (0.5 multiplier)
    ton28 += calcAccessoryTonnage(acc28, mg);
    count28 += countAccessoryEntries(acc28, mg);
    ton7 += calcAccessoryTonnage(acc7, mg);

    if (count28 < 3) { results[mg] = null; return; }
    const weeklyAvg28 = ton28 / 4;
    const acwr = weeklyAvg28 > 0 ? ton7 / weeklyAvg28 : null;
    let status = 'green', label = 'Low';
    if (acwr !== null) {
      if (acwr > FATIGUE_THRESHOLD_HIGH) { status = 'red'; label = 'High'; }
      else if (acwr > FATIGUE_THRESHOLD_MOD) { status = 'yellow'; label = 'Med'; }
    }
    results[mg] = { acwr, status, label };
    anyValid = true;
  });

  return anyValid ? results : null;
}
