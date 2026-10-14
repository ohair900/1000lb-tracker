/**
 * Program support functions — querying workouts, checking completion,
 * auto-progression logic, and week-streak tracking.
 *
 * These functions operate on `store.programConfig` and the program templates.
 */

import store from '../state/store.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { LIFT_NAMES } from '../constants/lift-config.js';
import { roundToPlate } from '../formulas/plates.js';
import { formatWeight } from '../formulas/units.js';
import { SUPPLEMENTAL_TIERS } from '../constants/program-tiers.js';
import { findConflicts, substituteExercise } from './injury.js';

function _validFrozenSetData(data) {
  return !!data && Number.isFinite(Number(data.weight)) && Number.isFinite(Number(data.reps));
}

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

/**
 * Days since the last logged entry for a lift (0 = today).
 * @param {string} lift
 * @returns {number} Days, or Infinity if no entries
 */
export function daysSinceLastLift(lift) {
  let latest = 0;
  for (const e of store.entries) {
    if (e.lift === lift && e.timestamp > latest) latest = e.timestamp;
  }
  if (!latest) return Infinity;
  const now = new Date();
  const then = new Date(latest);
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thenDay = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  return Math.round((nowDay - thenDay) / 86400000);
}

// ---------------------------------------------------------------------------
// Workout query
// ---------------------------------------------------------------------------

/**
 * Build one rendered set row, merging the template prescription with any
 * frozen completion data (so a later TM change can't rewrite history).
 *
 * @param {Object} s - Template set ({ pct, reps, tier?, day? })
 * @param {string} key - programConfig storage key for this set
 * @param {number} i - 0-based set index
 * @param {number} tm - Current training max (lbs)
 * @returns {Object} Rendered set
 */
function _buildSet(s, key, i, tm) {
  const maybeFrozen = store.programConfig.completedSets[key]
    ? store.programConfig.completedSetData?.[key]
    : null;
  const frozen = _validFrozenSetData(maybeFrozen) ? maybeFrozen : null;
  return {
    num: i + 1,
    weight: frozen ? frozen.weight : roundToPlate((tm * s.pct) / 100),
    reps: frozen ? frozen.reps : s.reps,
    pct: s.pct,
    tier: s.tier || null,
    day: s.day || null,
    completed: !!store.programConfig.completedSets[key],
  };
}

/**
 * Build the reduced prescription for a scheduled deload week.
 * Uses `-d` key infixes so deload completion marks never collide with the
 * template's normal set keys for the same absolute week.
 */
function _buildDeloadSets(tmpl, lift, useWeek, tm) {
  const pct = tmpl.deloadPct || 50;
  const count = tmpl.deloadSets || 3;
  const reps = tmpl.deloadReps || 5;
  const sets = [];
  for (let i = 0; i < count; i++) {
    sets.push(_buildSet({ pct, reps }, `${lift}-${useWeek}-d${i}`, i, tm));
  }
  return sets;
}

/**
 * Build the workout prescription for a lift on a given program week.
 * Merges template set data with completion state from programConfig.
 *
 * Templates may declare an optional scheduled deload
 * (`deloadEvery: N` weeks, `deloadPct`, `deloadSets`, `deloadReps`). On
 * deload weeks the reduced prescription is returned with `isDeload: true`
 * and a clearly labeled title. Day-rotation programs (Texas) are excluded:
 * their "weeks" are training days, not calendar weeks, so modulo arithmetic
 * would misfire — that's a follow-up.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @param {number} [weekOverride] - Week number to use (defaults to lift's week)
 * @returns {{ label: string, week: number, isDeload: boolean, sets: Object[] }|null}
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

  const deloadEvery = tmpl.deloadEvery;
  const isDeload =
    Number.isFinite(deloadEvery) &&
    deloadEvery > 1 &&
    !tmpl.dayRotation &&
    useWeek % deloadEvery === 0;

  const workout = {
    label: isDeload ? `${weekData.label} — Deload` : weekData.label,
    week: useWeek,
    isDeload,
    sets: isDeload
      ? _buildDeloadSets(tmpl, lift, useWeek, tm)
      : weekData.sets.map((s, i) => _buildSet(s, `${lift}-${useWeek}-${i}`, i, tm)),
  };
  // Injury-aware: when the programmed main lift loads an injured area,
  // attach a substitution notice (weights stay as programmed — the lifter
  // decides; the notice names the safe swap). Backward-compatible: callers
  // that ignore `_injuryNotice` see the same shape as before.
  const conflicts = findConflicts([lift]);
  if (conflicts.length) {
    const sub = substituteExercise(lift);
    workout._injuryNotice = {
      lift,
      region: conflicts[0].region,
      severity: conflicts[0].severity,
      reason: conflicts[0].reason,
      substituteId: sub.substituted ? sub.exerciseId : null,
      substituteReason: sub.reason,
      dropped: sub.dropped,
    };
  }
  return workout;
}

// ---------------------------------------------------------------------------
// Completion checks
// ---------------------------------------------------------------------------

/**
 * Shared implementation: every PRIMARY set for the lift's current program
 * week is marked complete (BBB / T2 / other supplemental tiers excluded).
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {boolean}
 */
function _liftWeekComplete(lift) {
  if (!store.programConfig.activeProgram) return false;
  if (!store.programConfig.trainingMaxes[lift]) return false;
  const workout = getProgramWorkout(lift);
  if (!workout) return false;
  return _primarySets(workout).every((s) => s.completed);
}

/**
 * Check whether the given lift's current week is fully complete
 * (all sets done for that lift).
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {boolean}
 */
export function isWeekComplete(lift) {
  return _liftWeekComplete(lift);
}

/**
 * Check whether all prescribed sets for a single lift are complete
 * in the current program week.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {boolean}
 */
export function isLiftComplete(lift) {
  return _liftWeekComplete(lift);
}

/**
 * Find the first week (from 1 to currentWeek) where the lift still
 * has incomplete primary sets (BBB/supplemental excluded).
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
    if (workout && !_primarySets(workout).every((s) => s.completed)) return w;
  }
  return lw;
}

/** Filter to only primary working sets (exclude BBB / T2 / other supplemental). */
function _primarySets(workout) {
  return workout.sets.filter((s) => !SUPPLEMENTAL_TIERS.includes(s.tier));
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
 * Returns SUCCESS-type results only (`type: 'progress'`). Failure-driven
 * deloads are evaluated separately via `recordSessionFailure()` — a deload
 * must never be triggered (or auto-applied) by an individual set click, so
 * the two result types take deliberately different paths.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ type: 'progress', lift: string, oldTM: number, newTM: number, reason: string }|null}
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
  const increment = lift === 'bench' ? prog.upperIncrement : prog.lowerIncrement;
  const week = ((lw - 1) % tmpl.weeks) + 1;

  if (prog.type === 'session') {
    // SL5x5 / SS: all sets completed for this lift this week.
    // Success path only — failure counting was moved to recordSessionFailure()
    // (per-week, evaluated at week advance) so mid-workout clicks can never
    // stack up failure counts or trigger a TM deload.
    const weekData = tmpl.schedule[week];
    if (!weekData) return null;
    const allDone = weekData.sets.every(
      (_, i) => store.programConfig.completedSets[`${lift}-${lw}-${i}`]
    );
    if (allDone) {
      // Success: reset failure count, progress
      if (store.programConfig.failureCounts) store.programConfig.failureCounts[lift] = 0;
      store.saveProgramConfig();
      return {
        type: 'progress',
        lift,
        oldTM: tm,
        newTM: tm + increment,
        reason: 'All sets completed',
      };
    }
    return null;
  }

  // amrap-type programs (5/3/1, nSuns, GZCL) use cycle-boundary progression instead
  if (prog.type === 'amrap') return null;

  if (prog.type === 'intensity-pr') {
    // Texas Method: check intensity day AMRAP
    const weekData = tmpl.schedule[week];
    if (!weekData) return null;
    const amrapIdx = weekData.sets.findIndex(
      (s) => typeof s.reps === 'string' && s.reps.includes('+') && s.day === 'Intensity'
    );
    if (amrapIdx < 0) return null;
    const key = `${lift}-${lw}-${amrapIdx}`;
    const reps = store.programConfig.amrapResults[key];
    if (reps !== undefined && reps >= prog.minReps) {
      return {
        type: 'progress',
        lift,
        oldTM: tm,
        newTM: tm + increment,
        reason: `Intensity PR: ${reps} reps`,
      };
    }
    return null;
  }

  return null;
}

/**
 * Record a failed session for session-type programs (SL5x5 / SS).
 *
 * Call this ONCE per session boundary (e.g. when advancing past the week's
 * workout) — never per set click. A week counts as a failure only when at
 * least one primary set was attempted but not all were completed; a week
 * with zero completed sets is treated as "not trained", not a failure.
 *
 * Counting is per-WEEK: `lastFailureWeek` guarantees a given lift-week can
 * only ever contribute one failure, no matter how often this is called.
 * After 3 consecutive failed weeks a deload result is returned — the caller
 * MUST get explicit user confirmation before applying it (never auto-apply).
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ type: 'deload', lift: string, oldTM: number, newTM: number, reason: string }|null}
 *   A deload result on the 3rd consecutive failed week, otherwise null.
 */
export function recordSessionFailure(lift) {
  if (!store.programConfig.autoProgressEnabled || !store.programConfig.activeProgram) return null;
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  if (!tmpl || !tmpl.progression || tmpl.progression.type !== 'session') return null;
  const tm = store.programConfig.trainingMaxes[lift];
  if (!tm) return null;

  const lw = getLiftWeek(lift);
  const workout = getProgramWorkout(lift);
  if (!workout) return null;
  const primary = _primarySets(workout);

  const doneCount = primary.filter((s) => s.completed).length;
  if (doneCount === primary.length) {
    // Completed after all — reset the failure streak, nothing to record.
    if (store.programConfig.failureCounts) store.programConfig.failureCounts[lift] = 0;
    store.saveProgramConfig();
    return null;
  }
  if (doneCount === 0) {
    // No attempt logged this week — not a failed session, don't count it.
    return null;
  }

  // Per-week gate: a lift-week contributes at most one failure.
  if (!store.programConfig.lastFailureWeek) {
    store.programConfig.lastFailureWeek = { squat: 0, bench: 0, deadlift: 0 };
  }
  if (store.programConfig.lastFailureWeek[lift] === lw) return null;
  store.programConfig.lastFailureWeek[lift] = lw;

  if (!store.programConfig.failureCounts) {
    store.programConfig.failureCounts = { squat: 0, bench: 0, deadlift: 0 };
  }
  store.programConfig.failureCounts[lift] = (store.programConfig.failureCounts[lift] || 0) + 1;

  if (store.programConfig.failureCounts[lift] >= 3) {
    const deloadTM = roundToPlate(tm * 0.9);
    store.programConfig.failureCounts[lift] = 0;
    store.saveProgramConfig();
    return {
      type: 'deload',
      lift,
      oldTM: tm,
      newTM: deloadTM,
      reason: '3 failed sessions in a row — 10% TM deload suggested',
    };
  }
  store.saveProgramConfig();
  return null;
}

/**
 * Check if a lift qualifies for cycle-boundary progression.
 * Called when advancing past the last week of a cycle.
 *
 * @param {string} lift
 * @param {number} cycleEndWeek - The absolute week number of the cycle's last week
 * @param {Object} tmpl - Program template
 * @returns {{ type: 'progress', lift: string, oldTM: number, newTM: number, reason: string }|null}
 */
export function checkCycleBoundaryProgression(lift, cycleEndWeek, tmpl) {
  const tm = store.programConfig.trainingMaxes[lift];
  if (!tm) return null;
  const startWeek = cycleEndWeek - tmpl.weeks + 1;

  // Check all PRIMARY sets completed across the entire cycle. Supplemental
  // tiers (BBB/T2) are excluded: the workout overlay only records completedSets
  // for main sets, so requiring supplemental completion would make progression
  // unreachable for any program with back-off volume (nSuns, 5/3/1, GZCL).
  let allSetsComplete = true;
  for (let w = startWeek; w <= cycleEndWeek; w++) {
    const schedWeek = ((w - 1) % tmpl.weeks) + 1;
    const weekData = tmpl.schedule[schedWeek];
    if (!weekData) continue;
    for (let i = 0; i < weekData.sets.length; i++) {
      if (SUPPLEMENTAL_TIERS.includes(weekData.sets[i].tier)) continue;
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

  // Gate: must hit minimum reps to earn the increase
  if (bestAmrapReps < (prog.minReps || 1)) return null;

  // Flat increment from template (not percentage-based)
  const increment = lift === 'bench' ? prog.upperIncrement : prog.lowerIncrement;
  const newTM = tm + increment;
  return {
    type: 'progress',
    lift,
    oldTM: tm,
    newTM,
    reason: `Cycle complete (+${formatWeight(increment)} ${store.unit}) AMRAP: ${bestAmrapReps} reps`,
  };
}

/**
 * Apply a progression result: update the training max, record history,
 * and persist.
 *
 * @param {{ type: string, lift: string, oldTM: number, newTM: number, reason: string }} result
 *   The result from `checkAutoProgression`, `checkCycleBoundaryProgression`,
 *   or `recordSessionFailure` (the latter only after explicit user confirm).
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
    reason: result.reason,
  });
  store.saveProgramConfig();
  const name = LIFT_NAMES[result.lift];
  return `${name} TM: ${formatWeight(result.oldTM)} \u2192 ${formatWeight(result.newTM)} ${store.unit}`;
}
