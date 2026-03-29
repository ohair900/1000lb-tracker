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
// Per-lift week helper
// ---------------------------------------------------------------------------

/**
 * Get the current absolute week for a lift.
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {number}
 */
export function getLiftWeek(lift) {
  return store.programConfig.liftWeeks?.[lift] || 1;
}

// ---------------------------------------------------------------------------
// Workout query
// ---------------------------------------------------------------------------

/**
 * Build the workout prescription for a lift on a given program week.
 * Merges template set data with completion state from programConfig.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @param {number} [weekOverride] - Week number to use (defaults to lift's week)
 * @returns {{ label: string, week: number, sets: Object[] }|null}
 */
export function getProgramWorkout(lift, weekOverride) {
  if (!store.programConfig.activeProgram) return null;
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  if (!tmpl) return null;
  const tm = store.programConfig.trainingMaxes[lift];
  if (!tm) return null;
  const useWeek = weekOverride || getLiftWeek(lift);
  const week = ((useWeek - 1) % tmpl.weeks) + 1;
  const weekData = tmpl.schedule[week];
  if (!weekData) return null;
  return {
    label: weekData.label,
    week: useWeek,
    sets: weekData.sets.map((s, i) => ({
      num: i + 1,
      weight: roundToPlate(tm * s.pct / 100),
      reps: s.reps,
      pct: s.pct,
      tier: s.tier || null,
      day: s.day || null,
      completed: !!store.programConfig.completedSets[`${lift}-${useWeek}-${i}`]
    }))
  };
}

// ---------------------------------------------------------------------------
// Completion checks
// ---------------------------------------------------------------------------

/**
 * Check whether the given lift's current week is fully complete
 * (all sets done for that lift).
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {boolean}
 */
export function isWeekComplete(lift) {
  if (!store.programConfig.activeProgram) return false;
  if (!store.programConfig.trainingMaxes[lift]) return false;
  const workout = getProgramWorkout(lift);
  if (!workout) return false;
  return workout.sets.every(s => s.completed);
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
  const lw = getLiftWeek(lift);
  if (!store.programConfig.activeProgram) return lw;
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  if (!tmpl) return lw;
  for (let w = 1; w <= lw; w++) {
    const workout = getProgramWorkout(lift, w);
    if (workout && !workout.sets.every(s => s.completed)) return w;
  }
  return lw;
}

// ---------------------------------------------------------------------------
// Week streak
// ---------------------------------------------------------------------------

/**
 * Mark the given lift's current week as completed and recalculate
 * the consecutive week streak.
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 */
export function updateWeekStreak(lift) {
  const lw = getLiftWeek(lift);
  store.programConfig.completedWeeks[`${lift}-${lw}`] = true;
  let streak = 0;
  for (let w = lw; w >= 1; w--) {
    if (store.programConfig.completedWeeks[`${lift}-${w}`]) streak++;
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
  const lw = getLiftWeek(lift);
  const increment = (lift === 'bench') ? prog.upperIncrement : prog.lowerIncrement;
  const week = ((lw - 1) % tmpl.weeks) + 1;

  if (prog.type === 'session') {
    // SL5x5 / SS: all sets completed for this lift this week
    const weekData = tmpl.schedule[week];
    if (!weekData) return null;
    const allDone = weekData.sets.every((_, i) =>
      store.programConfig.completedSets[`${lift}-${lw}-${i}`]
    );
    if (!allDone) return null;
    return { lift, oldTM: tm, newTM: tm + increment, reason: 'All sets completed' };
  }

  // amrap-type programs (5/3/1, nSuns, GZCL) use cycle-boundary progression instead
  if (prog.type === 'amrap') return null;

  if (prog.type === 'intensity-pr') {
    // Texas Method: check intensity day AMRAP
    const weekData = tmpl.schedule[week];
    if (!weekData) return null;
    const amrapIdx = weekData.sets.findIndex(
      s => typeof s.reps === 'string' && s.reps.includes('+') && s.day === 'Intensity'
    );
    if (amrapIdx < 0) return null;
    const key = `${lift}-${lw}-${amrapIdx}`;
    const reps = store.programConfig.amrapResults[key];
    if (reps !== undefined && reps >= prog.minReps) {
      return { lift, oldTM: tm, newTM: tm + increment, reason: `Intensity PR: ${reps} reps` };
    }
    return null;
  }

  return null;
}

/**
 * Check if a lift qualifies for cycle-boundary progression.
 * Called when advancing past the last week of a cycle.
 *
 * @param {string} lift
 * @param {number} cycleEndWeek - The absolute week number of the cycle's last week
 * @param {Object} tmpl - Program template
 * @returns {{ lift: string, oldTM: number, newTM: number, reason: string }|null}
 */
export function checkCycleBoundaryProgression(lift, cycleEndWeek, tmpl) {
  const tm = store.programConfig.trainingMaxes[lift];
  if (!tm) return null;
  const startWeek = cycleEndWeek - tmpl.weeks + 1;

  // Check all sets completed across the entire cycle
  let allSetsComplete = true;
  for (let w = startWeek; w <= cycleEndWeek; w++) {
    const schedWeek = ((w - 1) % tmpl.weeks) + 1;
    const weekData = tmpl.schedule[schedWeek];
    if (!weekData) continue;
    for (let i = 0; i < weekData.sets.length; i++) {
      if (!store.programConfig.completedSets[`${lift}-${w}-${i}`]) {
        allSetsComplete = false;
        break;
      }
    }
    if (!allSetsComplete) break;
  }

  if (!allSetsComplete) return null;

  // Check AMRAP reps on the amrap week within this cycle
  const prog = tmpl.progression;
  const amrapAbsWeek = startWeek + (prog.amrapWeek - 1);
  const amrapWeekData = tmpl.schedule[prog.amrapWeek];
  let bestAmrapReps = 0;
  if (amrapWeekData) {
    amrapWeekData.sets.forEach((s, idx) => {
      if (typeof s.reps === 'string' && s.reps.includes('+')) {
        const reps = store.programConfig.amrapResults[`${lift}-${amrapAbsWeek}-${idx}`];
        if (reps !== undefined && reps > bestAmrapReps) bestAmrapReps = reps;
      }
    });
  }

  // 10% if AMRAP reps > 3, otherwise 5%
  const pct = bestAmrapReps > 3 ? 0.10 : 0.05;
  const isMetric = store.unit === 'kg';
  const step = isMetric ? 2.5 : 5;
  const newTM = Math.round((tm * (1 + pct)) / step) * step;
  const pctLabel = pct === 0.10 ? '10%' : '5%';
  return { lift, oldTM: tm, newTM, reason: `Cycle complete (+${pctLabel})${bestAmrapReps > 3 ? ` AMRAP: ${bestAmrapReps} reps` : ''}` };
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
