/**
 * Workout guardrails — subtle, non-blocking hints shown in the builder.
 *
 * Checks: too many accessories, same-muscle overload, no pulling on bench day,
 * core neglect, exercise staleness, loading fatigued muscles.
 */

import store from '../state/store.js';
import { EXERCISE_CATALOG, MOVEMENT_PATTERNS } from '../data/exercise-catalog.js';
import { resolveExercise, resolveCanonicalId, getExerciseHistory } from '../data/exercise-compat.js';
import { MUSCLE_GROUPS } from '../data/muscle-groups.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';
import { analyzeRecencyGaps } from '../systems/gap-analysis.js';
import { estimateWorkoutDuration } from '../systems/gap-analysis.js';

// ---------------------------------------------------------------------------
// Main guardrail check
// ---------------------------------------------------------------------------

/**
 * Check all guardrails against the current builder exercise list.
 *
 * @param {string} mainLift - 'squat' | 'bench' | 'deadlift'
 * @param {Object[]} exercises - Current builder exercise list
 * @returns {Object[]} Array of { type, message, action?, actionLabel? }
 *   action is an optional callback (e.g., swap function)
 */
export function checkGuardrails(mainLift, exercises) {
  const hints = [];
  const accessories = exercises.filter(e => e.type !== 'main');

  // 1. Too many accessories (>6 warning with duration)
  if (accessories.length > 6) {
    const duration = estimateWorkoutDuration(exercises);
    hints.push({
      type: 'too-many',
      message: `${accessories.length} exercises — estimated ~${duration}min session`,
    });
  }

  // 2. Same muscle overload (>60% of accessory sets hit same group)
  const muscleSetCounts = {};
  let totalSets = 0;
  for (const ex of accessories) {
    const catalogEx = resolveExercise(ex.exerciseId || ex.id);
    const sets = ex.sets || 3;
    totalSets += sets;
    if (catalogEx && catalogEx.primaryMuscles) {
      for (const [mg, weight] of Object.entries(catalogEx.primaryMuscles)) {
        if (weight >= 0.30) {
          muscleSetCounts[mg] = (muscleSetCounts[mg] || 0) + sets;
        }
      }
    }
  }
  if (totalSets > 0) {
    for (const [mg, count] of Object.entries(muscleSetCounts)) {
      if (count / totalSets > 0.60) {
        hints.push({
          type: 'muscle-overload',
          message: `${Math.round(count / totalSets * 100)}% of sets target ${mg}`,
        });
        break; // Only show one overload warning
      }
    }
  }

  // 3. No pulling on bench day
  if (mainLift === 'bench') {
    const hasPull = accessories.some(ex => {
      const catalogEx = resolveExercise(ex.exerciseId || ex.id);
      if (!catalogEx) return false;
      const pattern = MOVEMENT_PATTERNS[catalogEx.movementPattern];
      return pattern && pattern.pushPull === 'pull';
    });
    if (!hasPull) {
      hints.push({
        type: 'no-pull',
        message: 'Consider adding a pulling movement for shoulder balance',
      });
    }
  }

  // 4. Core not trained 10+ days
  const recency = analyzeRecencyGaps();
  if (recency.Core && recency.Core.daysSince >= 10) {
    // Only hint if no core exercise is already in the builder
    const hasCore = accessories.some(ex => {
      const catalogEx = resolveExercise(ex.exerciseId || ex.id);
      return catalogEx && catalogEx.movementPattern === 'core-stability';
    });
    if (!hasCore) {
      hints.push({
        type: 'core-neglect',
        message: `Core hasn't been trained in ${recency.Core.daysSince} days`,
      });
    }
  }

  // 5. Exercise staleness (same exercise 8+ of last 10 sessions)
  for (const ex of accessories) {
    const canonId = resolveCanonicalId(ex.exerciseId || ex.id);
    const staleInfo = checkStaleness(canonId, mainLift);
    if (staleInfo) {
      hints.push({
        type: 'staleness',
        message: staleInfo.message,
        staleExerciseId: canonId,
        alternativeExercise: staleInfo.alternative,
      });
    }
  }

  // 6. Loading a "red" fatigue muscle group
  const muscleFatigue = calcFatigueByMuscle();
  if (muscleFatigue) {
    for (const ex of accessories) {
      const catalogEx = resolveExercise(ex.exerciseId || ex.id);
      if (!catalogEx || !catalogEx.primaryMuscles) continue;
      for (const [mg, weight] of Object.entries(catalogEx.primaryMuscles)) {
        if (weight >= 0.30 && muscleFatigue[mg] && muscleFatigue[mg].status === 'red') {
          hints.push({
            type: 'fatigue-warning',
            message: `${catalogEx.name} loads ${mg} (high fatigue)`,
          });
          break; // One warning per exercise
        }
      }
    }
  }

  return hints;
}

// ---------------------------------------------------------------------------
// Staleness detection
// ---------------------------------------------------------------------------

/**
 * Check if an exercise has been used in 8+ of the last 10 sessions for a lift.
 * Returns alternative suggestion if stale.
 *
 * @param {string} canonicalId - Canonical exercise ID
 * @param {string} mainLift - Main lift context
 * @returns {{ message: string, alternative: { id: string, name: string } } | null}
 */
function checkStaleness(canonicalId, mainLift) {
  // Get last 10 workout sessions (from accessory log, grouped by date)
  const sessionDates = new Set();
  const exerciseDates = new Set();

  for (const log of store.accessoryLog) {
    const date = new Date(log.timestamp).toISOString().split('T')[0];
    sessionDates.add(date);

    const logCanon = resolveCanonicalId(log.exerciseId);
    if (logCanon === canonicalId) {
      exerciseDates.add(date);
    }
  }

  const recentSessions = [...sessionDates].sort().reverse().slice(0, 10);
  if (recentSessions.length < 5) return null; // Not enough data

  const usageCount = recentSessions.filter(d => exerciseDates.has(d)).length;
  if (usageCount < 8) return null;

  // Find alternative: same movement pattern, different exercise
  const ex = EXERCISE_CATALOG[canonicalId];
  if (!ex) return null;

  const equip = store.equipmentProfile || {};
  let best = null;
  for (const [id, altEx] of Object.entries(EXERCISE_CATALOG)) {
    if (id === canonicalId) continue;
    if (altEx.movementPattern !== ex.movementPattern) continue;
    if (equip[altEx.equipment] === false) continue;
    if (!altEx.supportsLifts.includes(mainLift)) continue;
    // Pick first match (could be scored more sophisticatedly)
    best = { id, name: altEx.name };
    break;
  }

  return {
    message: `${ex.name} used ${usageCount}/10 sessions — try ${best ? best.name : 'something new'}?`,
    alternative: best,
  };
}
