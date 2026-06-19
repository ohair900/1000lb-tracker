/**
 * Bodybuilding split plan support — querying the active split, resolving the
 * current day's exercises (equipment-aware), and rotating days.
 *
 * A split plan is active when `store.programConfig.activeProgram` is the split
 * sentinel and `store.programConfig.splitPlan` is set. Day rotation is stored
 * as `splitPlan.dayIndex` and advances on workout completion.
 */

import store from '../state/store.js';
import { EXERCISE_CATALOG } from '../data/exercise-catalog.js';
import {
  BODYBUILDING_SPLITS,
  DEFAULT_SPLIT_TYPE,
  SPLIT_PROGRAM_ID,
  schemeForSlot,
} from '../constants/bodybuilding-config.js';

/** @returns {boolean} Whether a bodybuilding split plan is currently active. */
export function isSplitActive() {
  return (
    store.programConfig?.activeProgram === SPLIT_PROGRAM_ID && !!store.programConfig?.splitPlan
  );
}

/** @returns {Object|null} The active split definition, or null. */
export function getActiveSplit() {
  if (!isSplitActive()) return null;
  const type = store.programConfig.splitPlan.type || DEFAULT_SPLIT_TYPE;
  return BODYBUILDING_SPLITS[type] || BODYBUILDING_SPLITS[DEFAULT_SPLIT_TYPE];
}

/** Activate a bodybuilding split plan. */
export function startSplitPlan(type = DEFAULT_SPLIT_TYPE) {
  store.programConfig.activeProgram = SPLIT_PROGRAM_ID;
  store.programConfig.splitPlan = { type, dayIndex: 0 };
  store.saveProgramConfig();
}

/** Advance the split to the next day (wraps around). */
export function advanceSplitDay() {
  if (!isSplitActive()) return;
  const split = getActiveSplit();
  const n = split.days.length;
  const cur = store.programConfig.splitPlan.dayIndex || 0;
  store.programConfig.splitPlan.dayIndex = (cur + 1) % n;
  store.saveProgramConfig();
}

/**
 * Resolve one slot to a concrete exercise given the current equipment profile.
 * @param {Object} slot
 * @returns {{ exerciseId: string|null, compLift: string|null, name: string,
 *   equipment: string, role: string, scheme: Object, isCompLift: boolean }}
 */
function resolveSlot(slot) {
  const equip = store.equipmentProfile || {};
  const scheme = schemeForSlot(slot);

  // Competition lift wins when the barbell is available.
  if (slot.compLift && equip.barbell !== false) {
    return {
      exerciseId: null,
      compLift: slot.compLift,
      name: slot.name,
      equipment: 'barbell',
      role: slot.role,
      scheme,
      isCompLift: true,
    };
  }

  // Otherwise first candidate whose equipment is enabled.
  const candidates = slot.candidates || [];
  let chosen = candidates.find((id) => {
    const ex = EXERCISE_CATALOG[id];
    return ex && equip[ex.equipment] !== false;
  });
  // Fallback: show the first candidate even if its equipment is off, so the
  // slot is never empty (the user can swap or enable gear).
  if (!chosen) chosen = candidates[0];

  const ex = chosen ? EXERCISE_CATALOG[chosen] : null;
  return {
    exerciseId: chosen || null,
    compLift: null,
    name: ex ? ex.name : chosen || 'Exercise',
    equipment: ex ? ex.equipment : 'barbell',
    role: slot.role,
    scheme,
    isCompLift: false,
  };
}

/**
 * Get the resolved day for the split plan.
 * @param {number} [dayIndex] - Defaults to the plan's current day.
 * @returns {{ key: string, label: string, muscles: string[], index: number,
 *   total: number, slots: Object[] }|null}
 */
export function getSplitDay(dayIndex) {
  const split = getActiveSplit();
  if (!split) return null;
  const total = split.days.length;
  const idx =
    dayIndex == null
      ? store.programConfig.splitPlan.dayIndex || 0
      : ((dayIndex % total) + total) % total;
  const day = split.days[idx];
  return {
    key: day.key,
    label: day.label,
    muscles: day.muscles,
    index: idx,
    total,
    slots: day.slots.map(resolveSlot),
  };
}
