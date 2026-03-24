/**
 * Program support functions — querying workouts, checking completion,
 * auto-progression logic, and week-streak tracking.
 *
 * These functions operate on `store.programConfig` and the program templates.
 */

import store from '../state/store.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { roundToPlate } from '../formulas/plates.js';
import { formatWeight } from '../formulas/units.js';

// ---------------------------------------------------------------------------
// Key helpers — cycle-aware keys for completedSets/amrapResults/completedWeeks
// ---------------------------------------------------------------------------

export function setKey(lift, cycle, week, idx) {
  return `${lift}-c${cycle}-w${week}-${idx}`;
}

export function weekKey(cycle, week) {
  return `c${cycle}-w${week}`;
}

// ---------------------------------------------------------------------------
// Workout query
// ---------------------------------------------------------------------------

/**
 * Build the workout prescription for a lift on a given program week.
 * Merges template set data with completion state from programConfig.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @param {number} [weekOverride] - Week number to use (defaults to currentWeek)
 * @returns {{ label: string, week: number, sets: Object[] }|null}
 */
export function getProgramWorkout(lift, weekOverride, cycleOverride) {
  if (!store.programConfig.activeProgram) return null;
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  if (!tmpl) return null;
  const tm = store.programConfig.trainingMaxes[lift];
  if (!tm) return null;
  const useWeek = weekOverride || store.programConfig.currentWeek;
  const useCycle = cycleOverride || store.programConfig.currentCycle || 1;
  const week = ((useWeek - 1) % tmpl.weeks) + 1;
  const weekData = tmpl.schedule[week];
  if (!weekData) return null;
  return {
    label: weekData.label,
    week: useWeek,
    cycle: useCycle,
    sets: weekData.sets.map((s, i) => ({
      num: i + 1,
      weight: roundToPlate(tm * s.pct / 100),
      reps: s.reps,
      pct: s.pct,
      tier: s.tier || null,
      day: s.day || null,
      completed: !!store.programConfig.completedSets[setKey(lift, useCycle, useWeek, i)]
    }))
  };
}

// ---------------------------------------------------------------------------
// Completion checks
// ---------------------------------------------------------------------------

/**
 * Check whether the current program week is fully complete
 * (all sets for every lift with a training max are done).
 *
 * @returns {boolean}
 */
export function isWeekComplete() {
  if (!store.programConfig.activeProgram) return false;
  const liftsWithTM = LIFTS.filter(l => store.programConfig.trainingMaxes[l]);
  if (liftsWithTM.length === 0) return false;
  return liftsWithTM.every(lift => {
    const workout = getProgramWorkout(lift);
    if (!workout) return false;
    return workout.sets.every(s => s.completed);
  });
}

/**
 * Check whether all prescribed sets for a single lift are complete
 * in the current program week.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {boolean}
 */
export function isLiftComplete(lift) {
  if (!store.programConfig.activeProgram || !store.programConfig.trainingMaxes[lift]) return false;
  const workout = getProgramWorkout(lift);
  if (!workout) return false;
  return workout.sets.every(s => s.completed);
}

/**
 * Find the first week (from 1 to currentWeek) where the lift still
 * has incomplete sets.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {number} Week number (falls back to currentWeek)
 */
export function findFirstIncompleteWeek(lift) {
  if (!store.programConfig.activeProgram) return store.programConfig.currentWeek;
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  if (!tmpl) return store.programConfig.currentWeek;
  for (let w = 1; w <= store.programConfig.currentWeek; w++) {
    const workout = getProgramWorkout(lift, w);
    if (workout && !workout.sets.every(s => s.completed)) return w;
  }
  return store.programConfig.currentWeek;
}

// ---------------------------------------------------------------------------
// Week streak
// ---------------------------------------------------------------------------

/**
 * Mark the current week as completed and recalculate the consecutive
 * week streak (counting backward from the current week).
 */
export function updateWeekStreak() {
  const cycle = store.programConfig.currentCycle || 1;
  store.programConfig.completedWeeks[weekKey(cycle, store.programConfig.currentWeek)] = true;
  let streak = 0;
  for (let w = store.programConfig.currentWeek; w >= 1; w--) {
    if (store.programConfig.completedWeeks[weekKey(cycle, w)]) streak++;
    else break;
  }
  store.programConfig.weekStreak = streak;
  store.saveProgramConfig();
}

// ---------------------------------------------------------------------------
// Auto-progression
// ---------------------------------------------------------------------------

/**
 * Determine whether a lift qualifies for automatic training-max progression
 * under the active program's progression rules.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ lift: string, oldTM: number, newTM: number, reason: string }|null}
 *   A progression result, or null if no progression is earned.
 */
export function checkAutoProgression(lift) {
  if (!store.programConfig.autoProgressEnabled || !store.programConfig.activeProgram) return null;
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  if (!tmpl || !tmpl.progression) return null;
  const prog = tmpl.progression;
  const tm = store.programConfig.trainingMaxes[lift];
  if (!tm) return null;
  const increment = (lift === 'bench') ? prog.upperIncrement : prog.lowerIncrement;
  const week = ((store.programConfig.currentWeek - 1) % tmpl.weeks) + 1;

  if (prog.type === 'session') {
    // SL5x5 / SS: all sets completed for this lift this week
    const weekData = tmpl.schedule[week];
    if (!weekData) return null;
    const cycle = store.programConfig.currentCycle || 1;
    const allDone = weekData.sets.every((_, i) =>
      store.programConfig.completedSets[setKey(lift, cycle, store.programConfig.currentWeek, i)]
    );
    if (!allDone) return null;
    return { lift, oldTM: tm, newTM: tm + increment, reason: 'All sets completed' };
  }

  if (prog.type === 'amrap') {
    // 5/3/1 / nSuns / GZCL: check if on the right week and AMRAP reps met
    if (week !== prog.amrapWeek) return null;
    const weekData = tmpl.schedule[week];
    if (!weekData) return null;
    // Find the AMRAP set(s) — reps contain '+'
    const amrapIdxs = weekData.sets
      .map((s, i) => typeof s.reps === 'string' && s.reps.includes('+') ? i : -1)
      .filter(i => i >= 0);
    if (amrapIdxs.length === 0) return null;
    // Check if any AMRAP result meets minimum
    const cycle2 = store.programConfig.currentCycle || 1;
    for (const idx of amrapIdxs) {
      const key = setKey(lift, cycle2, store.programConfig.currentWeek, idx);
      const reps = store.programConfig.amrapResults[key];
      if (reps !== undefined && reps >= prog.minReps) {
        return { lift, oldTM: tm, newTM: tm + increment, reason: `AMRAP: ${reps} reps` };
      }
    }
    return null;
  }

  if (prog.type === 'intensity-pr') {
    // Texas Method: check intensity day AMRAP
    const weekData = tmpl.schedule[week];
    if (!weekData) return null;
    const amrapIdx = weekData.sets.findIndex(
      s => typeof s.reps === 'string' && s.reps.includes('+') && s.day === 'Intensity'
    );
    if (amrapIdx < 0) return null;
    const key = setKey(lift, store.programConfig.currentCycle || 1, store.programConfig.currentWeek, amrapIdx);
    const reps = store.programConfig.amrapResults[key];
    if (reps !== undefined && reps >= prog.minReps) {
      return { lift, oldTM: tm, newTM: tm + increment, reason: `Intensity PR: ${reps} reps` };
    }
    return null;
  }

  return null;
}

/**
 * Apply a progression result: update the training max, record history,
 * and persist.
 *
 * @param {{ lift: string, oldTM: number, newTM: number, reason: string }} result
 *   The result from `checkAutoProgression`.
 * @returns {string|null} A human-readable toast message, or null if no result.
 */
export function applyProgression(result) {
  if (!result) return null;
  store.programConfig.trainingMaxes[result.lift] = result.newTM;
  store.programConfig.tmHistory.push({
    date: new Date().toISOString().split('T')[0],
    lift: result.lift,
    oldTM: result.oldTM,
    newTM: result.newTM,
    reason: result.reason
  });
  store.saveProgramConfig();
  const name = LIFT_NAMES[result.lift];
  return `${name} TM: ${formatWeight(result.oldTM)} \u2192 ${formatWeight(result.newTM)} ${store.unit}`;
}
