/**
 * Accessory progression engine.
 *
 * Computes the next session's target reps + weight for any accessory exercise
 * based on its progression model and the lifter's last performance. Replaces
 * the dumb "target = repRange[1]" pattern that showed absurd targets like
 * "hit 20 reps" when the lifter had done 8 last time.
 *
 * Five algorithms:
 *   - double          (compound + isolation): last-perf + 1, bump weight at ceiling
 *   - amrap           (bodyweight):           top set + 1, add load after 3 ceiling sessions
 *   - time            (carries, planks):      last + 5s, add load at ceiling
 *   - close-variation (paused/tempo squats):  defer to %-of-TM (existing logic)
 *   - first / reload  (universal fallbacks):  no history / 42+ days off
 *
 * The `message` field is the human-readable line shown in the workout overlay
 * meta row. The `action` field is consumed by the UI to color/badge the row.
 */

import store from '../state/store.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { PROGRESSION_MODELS } from '../data/exercise-catalog.js';
import { resolveExercise, resolveCanonicalId, getExerciseHistory } from '../data/exercise-compat.js';
import { MS_PER_DAY } from '../constants/time.js';
import { roundToPlate } from '../formulas/plates.js';
import { getAccessoryWeight } from './workout-builder.js';

const RELOAD_DAYS = 42;          // 6 weeks off → 80% reload (per plan, locked)
const BUMP_AFTER_CEILING = 3;    // amrap: add load after N consecutive ceiling sessions
const RELOAD_FACTOR = 0.80;
const BACKOFF_FACTOR = 0.92;

// Upper-body bumps +5, lower-body +10 (matches existing heuristic at workout-builder.js:238-241).
function bumpFor(mainLift, catalogEx) {
  const model = catalogEx ? PROGRESSION_MODELS[catalogEx.progressionType] : null;
  if (model?.increment) {
    return store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
  }
  if (mainLift === 'bench') return store.unit === 'kg' ? 2.5 : 5;
  return store.unit === 'kg' ? 5 : 10;
}

function daysSince(timestamp) {
  return Math.floor((Date.now() - timestamp) / MS_PER_DAY);
}

/**
 * Main entry point. Returns the next session's prescription for an accessory.
 *
 * @param {string} exerciseId
 * @param {string} mainLift  'squat' | 'bench' | 'deadlift'
 * @returns {{
 *   targetReps: number[],
 *   targetSets: number,
 *   targetWeight: number,
 *   message: string,
 *   action: 'first'|'reload'|'bump'|'progress'|'hold'|'backoff'|'pct-of-tm'
 * }}
 */
export function computeNextTarget(exerciseId, mainLift) {
  const catalogEx = resolveExercise(exerciseId);
  const legacyEx = ACCESSORY_DB[exerciseId];
  const ex = catalogEx || legacyEx;

  // Defaults if exercise is missing entirely (custom exercise without catalog entry).
  const repRange = ex?.repRange || [8, 12];
  const defaultSets = ex?.sets || 3;
  const progressionType = catalogEx?.progressionType || 'compound';

  const canonId = resolveCanonicalId(exerciseId);
  const history = getExerciseHistory(canonId, store.accessoryLog || []);
  const last = history[0];

  // ---------- First-time: no history ----------
  if (!last) {
    const startWeight = getAccessoryWeight(exerciseId, mainLift);
    return firstTimePrescription({ progressionType, repRange, defaultSets, startWeight });
  }

  // ---------- Returning: 42+ days off ----------
  const gap = daysSince(last.timestamp);
  if (gap >= RELOAD_DAYS) {
    const lastWeight = lastTopWeight(last);
    const weeks = Math.floor(gap / 7);
    return {
      targetReps: Array(defaultSets).fill(repRange[0]),
      targetSets: defaultSets,
      targetWeight: lastWeight > 0 ? roundToPlate(lastWeight * RELOAD_FACTOR) : 0,
      message: `Reload — you haven't done this in ${weeks} weeks. Start at ${formatWt(lastWeight * RELOAD_FACTOR, lastWeight)}.`,
      action: 'reload',
    };
  }

  // ---------- Close-variation: %-of-TM, no per-rep progression ----------
  if (progressionType === 'close-variation') {
    const w = getAccessoryWeight(exerciseId, mainLift);
    return {
      targetReps: Array(defaultSets).fill(repRange[1]),
      targetSets: defaultSets,
      targetWeight: w,
      message: `${repRange[0]}-${repRange[1]} reps at ${w} ${store.unit}. Auto-scaled to your training max.`,
      action: 'pct-of-tm',
    };
  }

  // ---------- Time-based ----------
  if (progressionType === 'time') {
    return timePrescription({ last, repRange, defaultSets, mainLift, catalogEx });
  }

  // ---------- AMRAP / bodyweight ----------
  if (progressionType === 'bodyweight') {
    return amrapPrescription({ last, history, repRange, defaultSets, mainLift, catalogEx });
  }

  // ---------- Double-progression (compound + isolation, default) ----------
  return doubleProgressionPrescription({ last, history, repRange, defaultSets, mainLift, catalogEx });
}

// ---------------------------------------------------------------------------
// First-time
// ---------------------------------------------------------------------------

function firstTimePrescription({ progressionType, repRange, defaultSets, startWeight }) {
  const midReps = Math.round((repRange[0] + repRange[1]) / 2);
  if (progressionType === 'bodyweight') {
    return {
      targetReps: Array(defaultSets).fill(repRange[0]),
      targetSets: defaultSets,
      targetWeight: 0,
      message: `First time — go AMRAP and see what you've got.`,
      action: 'first',
    };
  }
  if (progressionType === 'time') {
    return {
      targetReps: Array(defaultSets).fill(repRange[0] || 30),
      targetSets: defaultSets,
      targetWeight: startWeight,
      message: `First time — hold for ${repRange[0] || 30}s and build from there.`,
      action: 'first',
    };
  }
  return {
    targetReps: Array(defaultSets).fill(midReps),
    targetSets: defaultSets,
    targetWeight: startWeight,
    message: `First time — find an RPE 7 weight for ${midReps} reps.`,
    action: 'first',
  };
}

// ---------------------------------------------------------------------------
// Double progression (compound + isolation)
// ---------------------------------------------------------------------------

function doubleProgressionPrescription({ last, history, repRange, defaultSets, mainLift, catalogEx }) {
  const [low, high] = repRange;
  const lastReps = last.setsCompleted || [];
  const lastWeight = lastTopWeight(last);
  const bump = bumpFor(mainLift, catalogEx);

  // Hit the ceiling on every set → bump weight, reset reps.
  const allAtCeiling = lastReps.length >= last.targetSets &&
    lastReps.every(r => r >= high);
  if (allAtCeiling) {
    const newWeight = roundToPlate(lastWeight + bump);
    return {
      targetReps: Array(defaultSets).fill(low),
      targetSets: defaultSets,
      targetWeight: newWeight,
      message: `Bumping to ${newWeight} ${store.unit} — reset to ${low} reps.`,
      action: 'bump',
    };
  }

  // Miss detection: "missed" means below the rep-range LOW end (the lifter
  // couldn't hold the floor of the prescribed range). This is conservative
  // and won't false-positive on healthy double-progression sessions where
  // the lifter is grinding mid-range reps.
  const setsBelowLow = lastReps.filter(r => r < low).length;
  const lastTwoBothMissed = history.length >= 2 &&
    countSetsBelowLow(history[1], (history[1].repRange && history[1].repRange[0]) || low) > 0 &&
    setsBelowLow > 0;

  // Hard miss → backoff to 92% weight.
  if (setsBelowLow >= 2 || lastTwoBothMissed) {
    const newWeight = roundToPlate(lastWeight * BACKOFF_FACTOR);
    return {
      targetReps: Array(defaultSets).fill(low),
      targetSets: defaultSets,
      targetWeight: newWeight,
      message: `Backing off to ${newWeight} ${store.unit}. Build it back up.`,
      action: 'backoff',
    };
  }

  // Soft miss (1 set below low) → repeat target, hold weight.
  if (setsBelowLow === 1) {
    const target = padToSets(lastReps.map(r => Math.max(r, low)), defaultSets, low);
    return {
      targetReps: target,
      targetSets: defaultSets,
      targetWeight: lastWeight,
      message: `Today: ${formatRepArray(target)} at ${lastWeight} ${store.unit}. Repeat last week's target — you're close.`,
      action: 'hold',
    };
  }

  // Solid session → progress: each set +1 rep, capped at ceiling.
  const target = padToSets(lastReps.map(r => Math.min(r + 1, high)), defaultSets, low);
  const newWeight = roundToPlate(lastWeight + bump);
  return {
    targetReps: target,
    targetSets: defaultSets,
    targetWeight: lastWeight,
    message: `Today: ${formatRepArray(target)} at ${lastWeight} ${store.unit}. Hit ${high}\u00d7${defaultSets} \u2192 ${newWeight} ${store.unit}.`,
    action: 'progress',
  };
}

// ---------------------------------------------------------------------------
// AMRAP / bodyweight
// ---------------------------------------------------------------------------

function amrapPrescription({ last, history, repRange, defaultSets, mainLift, catalogEx }) {
  const [low, high] = repRange;
  const lastReps = last.setsCompleted || [];
  const lastWeight = lastTopWeight(last);    // can be negative (assisted), 0 (BW), or positive (loaded)
  const topSet = lastReps[0] ?? 0;
  const bump = bumpFor(mainLift, catalogEx);

  // Sustained ceiling: 3 consecutive sessions at top → add weight.
  if (topSet >= high) {
    const ceilingStreak = countCeilingStreak(history, high);
    if (ceilingStreak >= BUMP_AFTER_CEILING) {
      const newWeight = lastWeight + bump;
      return {
        targetReps: Array(defaultSets).fill(low),
        targetSets: defaultSets,
        targetWeight: newWeight,
        message: `Adding ${bump} ${store.unit}. Reset to ${low}+ reps.`,
        action: 'bump',
      };
    }
    // First time at ceiling → push for one more.
    return {
      targetReps: Array(defaultSets).fill(topSet + 1),
      targetSets: defaultSets,
      targetWeight: lastWeight,
      message: `Today: ${topSet + 1}+ reps. Hit ${high} for ${BUMP_AFTER_CEILING} sessions \u2192 add ${bump} ${store.unit}.`,
      action: 'progress',
    };
  }

  // Standard: target = last + 1.
  return {
    targetReps: Array(defaultSets).fill(topSet + 1),
    targetSets: defaultSets,
    targetWeight: lastWeight,
    message: `Today: ${topSet + 1} reps (last: ${topSet}). Hit ${high} \u00d7 ${BUMP_AFTER_CEILING} sessions \u2192 add ${bump} ${store.unit}.`,
    action: 'progress',
  };
}

// ---------------------------------------------------------------------------
// Time-based (carries, planks, dead hangs)
// ---------------------------------------------------------------------------

function timePrescription({ last, repRange, defaultSets, mainLift, catalogEx }) {
  const [low, high] = repRange.length === 2 ? repRange : [30, 60];
  const lastTimes = last.setsCompleted || [];
  const lastWeight = lastTopWeight(last);
  const topTime = lastTimes[0] ?? low;
  const bump = bumpFor(mainLift, catalogEx);

  if (topTime >= high) {
    if (lastWeight > 0) {
      const newWeight = roundToPlate(lastWeight + bump);
      return {
        targetReps: Array(defaultSets).fill(low),
        targetSets: defaultSets,
        targetWeight: newWeight,
        message: `Adding ${bump} ${store.unit}. Reset to ${low}s.`,
        action: 'bump',
      };
    }
    // No weight yet — keep extending time.
    return {
      targetReps: Array(defaultSets).fill(topTime + 5),
      targetSets: defaultSets,
      targetWeight: 0,
      message: `Today: ${topTime + 5}s. Once consistent, we'll start adding load.`,
      action: 'progress',
    };
  }

  return {
    targetReps: Array(defaultSets).fill(Math.min(topTime + 5, high)),
    targetSets: defaultSets,
    targetWeight: lastWeight,
    message: `Today: ${Math.min(topTime + 5, high)}s (last: ${topTime}s). Hit ${high}s \u2192 add load.`,
    action: 'progress',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastTopWeight(entry) {
  if (entry.setWeights && entry.setWeights.length > 0) {
    return entry.setWeights[entry.setWeights.length - 1];
  }
  return entry.weight ?? 0;
}

function countSetsBelowLow(entry, low) {
  return (entry.setsCompleted || []).filter(r => r < low).length;
}

function countCeilingStreak(history, ceiling) {
  let count = 0;
  for (const entry of history) {
    const top = (entry.setsCompleted || [])[0] ?? 0;
    if (top >= ceiling) count++;
    else break;
  }
  return count;
}

function padToSets(arr, n, fill) {
  const out = [...arr];
  while (out.length < n) out.push(fill);
  return out.slice(0, n);
}

function formatRepArray(reps) {
  if (reps.every(r => r === reps[0])) return `${reps.length}\u00d7${reps[0]}`;
  return reps.join('/');
}

function formatWt(w, fallback) {
  const v = roundToPlate(w);
  if (!v && fallback) return `${roundToPlate(fallback * RELOAD_FACTOR)} ${store.unit}`;
  return `${v} ${store.unit}`;
}
