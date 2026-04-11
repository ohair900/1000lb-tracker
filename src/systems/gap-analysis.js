/**
 * Gap analysis engine — three-layer analysis of training balance.
 *
 * Layer 1: Weekly set volume per muscle group vs evidence-based targets
 * Layer 2: Weekly push:pull ratio
 * Layer 3: Recency gaps (days since muscle group was trained)
 *
 * Also provides duration estimation and exercise suggestions to fill gaps.
 */

import store from '../state/store.js';
import {
  MUSCLE_GROUPS,
  MAIN_LIFT_WEIGHTS,
  WEEKLY_SET_TARGETS,
  MUSCLE_REGION,
  LIFT_REGION,
} from '../data/muscle-groups.js';
import { EXERCISE_CATALOG, MOVEMENT_PATTERNS } from '../data/exercise-catalog.js';
import { resolveExercise, resolveCanonicalId, getExerciseHistory } from '../data/exercise-compat.js';
import { ACCESSORY_CAT_WEIGHTS } from '../data/muscle-groups.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { MS_PER_DAY } from '../constants/time.js';

// ---------------------------------------------------------------------------
// Layer 1: Weekly set volume per muscle group
// ---------------------------------------------------------------------------

/**
 * Count effective sets per muscle group over the last 7 days.
 * Main lifts count fully via MAIN_LIFT_WEIGHTS.
 * Accessories count via primaryMuscles weights:
 *   >= 0.20 = 1 direct set per set completed
 *   0.10-0.19 = 0.5 sets per set completed
 *
 * @returns {{ [muscleGroup: string]: { sets: number, target: { min: number, max: number }, status: 'under'|'optimal'|'over' } }}
 */
export function analyzeWeeklyVolume() {
  const now = Date.now();
  const weekAgo = now - 7 * MS_PER_DAY;
  const result = {};

  MUSCLE_GROUPS.forEach(mg => {
    result[mg] = { sets: 0, target: WEEKLY_SET_TARGETS[mg] || { min: 6, max: 16 }, status: 'under' };
  });

  // Count main lift sets
  const recentEntries = store.entries.filter(e => e.timestamp >= weekAgo);
  for (const entry of recentEntries) {
    const weights = MAIN_LIFT_WEIGHTS[entry.lift];
    if (!weights) continue;
    for (const mg of MUSCLE_GROUPS) {
      if (weights[mg] >= 0.20) result[mg].sets += 1;
      else if (weights[mg] >= 0.10) result[mg].sets += 0.5;
    }
  }

  // Count accessory sets
  const recentAccessories = store.accessoryLog.filter(l => l.timestamp >= weekAgo);
  for (const log of recentAccessories) {
    const setsCompleted = log.setsCompleted ? log.setsCompleted.length : 0;
    if (setsCompleted === 0) continue;

    // Try catalog first
    const catalogEx = resolveExercise(log.exerciseId);
    if (catalogEx && catalogEx.primaryMuscles) {
      for (const [mg, weight] of Object.entries(catalogEx.primaryMuscles)) {
        if (weight >= 0.20) result[mg].sets += setsCompleted;
        else if (weight >= 0.10) result[mg].sets += setsCompleted * 0.5;
      }
      continue;
    }

    // Fallback to legacy category weights
    const legacyEx = ACCESSORY_DB[log.exerciseId];
    if (legacyEx) {
      const catWeights = ACCESSORY_CAT_WEIGHTS[legacyEx.category];
      if (catWeights) {
        for (const mg of MUSCLE_GROUPS) {
          if (catWeights[mg] >= 0.20) result[mg].sets += setsCompleted;
          else if (catWeights[mg] >= 0.10) result[mg].sets += setsCompleted * 0.5;
        }
      }
    }
  }

  // Determine status
  for (const mg of MUSCLE_GROUPS) {
    const r = result[mg];
    r.sets = Math.round(r.sets * 10) / 10; // Round to 1 decimal
    if (r.sets >= r.target.min) {
      r.status = r.sets > r.target.max ? 'over' : 'optimal';
    } else {
      r.status = 'under';
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Layer 2: Weekly push:pull ratio
// ---------------------------------------------------------------------------

/**
 * Compute push vs pull set counts over the last 7 days.
 * Uses MOVEMENT_PATTERNS pushPull classification.
 *
 * @returns {{ pushSets: number, pullSets: number, ratio: number, target: number, status: 'balanced'|'push-heavy'|'pull-heavy' }}
 */
export function analyzePushPullRatio() {
  const now = Date.now();
  const weekAgo = now - 7 * MS_PER_DAY;
  let pushSets = 0;
  let pullSets = 0;

  // Count main lift contribution
  const recentEntries = store.entries.filter(e => e.timestamp >= weekAgo);
  for (const entry of recentEntries) {
    // Squat and deadlift are primarily push (quad-driven), bench is push
    if (entry.lift === 'squat') pushSets += 1;
    else if (entry.lift === 'bench') pushSets += 1;
    else if (entry.lift === 'deadlift') pushSets += 0.5; // DL is mixed push/pull
  }

  // Count accessory contribution
  const recentAccessories = store.accessoryLog.filter(l => l.timestamp >= weekAgo);
  for (const log of recentAccessories) {
    const setsCompleted = log.setsCompleted ? log.setsCompleted.length : 0;
    if (setsCompleted === 0) continue;

    const catalogEx = resolveExercise(log.exerciseId);
    if (catalogEx) {
      const pattern = MOVEMENT_PATTERNS[catalogEx.movementPattern];
      if (pattern) {
        if (pattern.pushPull === 'push') pushSets += setsCompleted;
        else if (pattern.pushPull === 'pull') pullSets += setsCompleted;
        // 'neutral' doesn't count toward either
      }
      continue;
    }

    // Fallback: legacy category classification
    const legacyEx = ACCESSORY_DB[log.exerciseId];
    if (legacyEx) {
      const cat = legacyEx.category;
      const isPull = ['back'].includes(cat);
      const isPush = ['press-variation', 'chest-accessory', 'tricep', 'shoulder',
                       'squat-variation', 'quad-compound', 'quad-isolation'].includes(cat);
      if (isPull) pullSets += setsCompleted;
      else if (isPush) pushSets += setsCompleted;
    }
  }

  const ratio = pullSets > 0 ? pushSets / pullSets : (pushSets > 0 ? Infinity : 1);
  let status = 'balanced';
  // Target: push:pull should be 1:1 to 1:1.5 (ratio 0.67-1.0)
  if (ratio > 2) status = 'push-heavy';
  else if (ratio < 0.5) status = 'pull-heavy';

  return {
    pushSets: Math.round(pushSets),
    pullSets: Math.round(pullSets),
    ratio: Math.round(ratio * 100) / 100,
    target: 1.0, // Target push:pull ratio (1:1)
    status,
  };
}

// ---------------------------------------------------------------------------
// Layer 3: Recency gaps
// ---------------------------------------------------------------------------

/**
 * Days since each muscle group was directly trained.
 *
 * @returns {{ [muscleGroup: string]: { daysSince: number, status: 'fresh'|'due'|'stale' } }}
 */
export function analyzeRecencyGaps() {
  const now = Date.now();
  const result = {};

  MUSCLE_GROUPS.forEach(mg => {
    result[mg] = { daysSince: Infinity, status: 'stale' };
  });

  // Check main lift entries
  for (const entry of store.entries) {
    const weights = MAIN_LIFT_WEIGHTS[entry.lift];
    if (!weights) continue;
    const days = Math.floor((now - entry.timestamp) / MS_PER_DAY);
    for (const mg of MUSCLE_GROUPS) {
      if (weights[mg] >= 0.15 && days < result[mg].daysSince) {
        result[mg].daysSince = days;
      }
    }
  }

  // Check accessory log
  for (const log of store.accessoryLog) {
    if (!log.setsCompleted || log.setsCompleted.length === 0) continue;
    const days = Math.floor((now - log.timestamp) / MS_PER_DAY);

    const catalogEx = resolveExercise(log.exerciseId);
    if (catalogEx && catalogEx.primaryMuscles) {
      for (const [mg, weight] of Object.entries(catalogEx.primaryMuscles)) {
        if (weight >= 0.20 && days < result[mg].daysSince) {
          result[mg].daysSince = days;
        }
      }
      continue;
    }

    const legacyEx = ACCESSORY_DB[log.exerciseId];
    if (legacyEx) {
      const catWeights = ACCESSORY_CAT_WEIGHTS[legacyEx.category];
      if (catWeights) {
        for (const mg of MUSCLE_GROUPS) {
          if (catWeights[mg] >= 0.20 && days < result[mg].daysSince) {
            result[mg].daysSince = days;
          }
        }
      }
    }
  }

  // Classify
  for (const mg of MUSCLE_GROUPS) {
    const d = result[mg].daysSince;
    if (d < 3) result[mg].status = 'fresh';
    else if (d < 7) result[mg].status = 'due';
    else result[mg].status = 'stale';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Combined gap report
// ---------------------------------------------------------------------------

/**
 * Combine all three layers into a prioritized gap list with exercise suggestions.
 *
 * Key rules (enforced to match how a real strength coach reasons):
 *  - A muscle's region must match today's lift region, OR be 'core'. Otherwise
 *    the gap is non-actionable — we don't suggest calf work on bench day even
 *    if calves are undertrained globally.
 *  - MEV tolerance: sets within 75% of target.min aren't "deficient," just
 *    lightly-fed. Only flag `high` severity when sets < 50% of min.
 *  - Cross-region chronic undertraining (2+ consecutive weeks) surfaces as a
 *    passive `deferred-gap` insight with no suggestedExercise — a coach would
 *    mention it, not try to fix it today.
 *
 * @param {string} mainLift - Current main lift for context
 * @returns {Object[]} Sorted array of gaps
 */
export function getGapReport(mainLift) {
  const volume = analyzeWeeklyVolume();
  const pushPull = analyzePushPullRatio();
  const recency = analyzeRecencyGaps();
  const gaps = [];
  const liftRegion = LIFT_REGION[mainLift];

  // Volume gaps
  for (const mg of MUSCLE_GROUPS) {
    const v = volume[mg];
    if (v.status !== 'under') continue;

    const mgRegion = MUSCLE_REGION[mg];
    const regionMatch = mgRegion === liftRegion || mgRegion === 'core';
    const ratio = v.target.min > 0 ? v.sets / v.target.min : 1;

    if (!regionMatch) {
      // Wrong region for today — don't generate actionable work, only a
      // passive insight if chronically undertrained (2+ consecutive weeks).
      if (isChronicallyUnderVolume(mg)) {
        gaps.push({
          type: 'deferred-gap',
          muscleGroup: mg,
          severity: 'low',
          message: `${mg} chronically undertrained — prioritize on your next ${mgRegion === 'lower' ? 'leg' : 'upper'} day.`,
          suggestedExercise: null,
        });
      }
      continue;
    }

    // Region-matched — emit actionable gap, with MEV-aware severity.
    let severity;
    if (ratio < 0.5) severity = 'high';
    else if (ratio < 0.75) severity = 'medium';
    else severity = 'low'; // MEV-adjacent, not truly deficient

    gaps.push({
      type: 'volume',
      muscleGroup: mg,
      severity,
      message: `${mg}: ${v.sets}/${v.target.min} sets`,
      suggestedExercise: findExerciseForMuscle(mg, mainLift),
    });
  }

  // Push:pull ratio gap
  if (pushPull.status === 'push-heavy') {
    gaps.push({
      type: 'ratio',
      muscleGroup: null,
      severity: pushPull.ratio > 3 ? 'high' : 'medium',
      message: `Push:Pull ${pushPull.pushSets}:${pushPull.pullSets}`,
      suggestedExercise: findPullExercise(mainLift),
    });
  }

  // Recency gaps (only flag stale muscles in today's region, 7+ days)
  for (const mg of MUSCLE_GROUPS) {
    const r = recency[mg];
    if (r.status !== 'stale' || r.daysSince === Infinity) continue;
    const mgRegion = MUSCLE_REGION[mg];
    if (mgRegion !== liftRegion && mgRegion !== 'core') continue;

    gaps.push({
      type: 'recency',
      muscleGroup: mg,
      severity: r.daysSince >= 10 ? 'high' : 'medium',
      message: `${mg}: ${r.daysSince}d since last`,
      suggestedExercise: findExerciseForMuscle(mg, mainLift),
    });
  }

  // Sort by severity (high first), then by type (volume > ratio > recency > deferred)
  const severityOrder = { high: 0, medium: 1, low: 2 };
  const typeOrder = { volume: 0, ratio: 1, recency: 2, 'deferred-gap': 3 };
  gaps.sort((a, b) => {
    const sd = severityOrder[a.severity] - severityOrder[b.severity];
    if (sd !== 0) return sd;
    return typeOrder[a.type] - typeOrder[b.type];
  });

  return gaps;
}

/**
 * Has a given muscle been under its minimum weekly target for 2+ consecutive
 * weeks? Used to decide whether to surface a cross-region "chronic" FYI.
 *
 * Looks at the last 14 days of activity split into two 7-day windows. The
 * check is rough on purpose — a single dip doesn't qualify, but a sustained
 * shortfall does.
 */
function isChronicallyUnderVolume(muscleGroup) {
  const now = Date.now();
  const weekMs = 7 * MS_PER_DAY;
  const target = WEEKLY_SET_TARGETS[muscleGroup];
  if (!target) return false;

  // Trivial baseline: count direct sets in each window.
  const countWindow = (startMs, endMs) => {
    let sets = 0;
    for (const entry of store.entries) {
      if (entry.timestamp < startMs || entry.timestamp >= endMs) continue;
      const w = MAIN_LIFT_WEIGHTS[entry.lift];
      if (!w) continue;
      if (w[muscleGroup] >= 0.20) sets += 1;
      else if (w[muscleGroup] >= 0.10) sets += 0.5;
    }
    for (const log of store.accessoryLog) {
      if (log.timestamp < startMs || log.timestamp >= endMs) continue;
      const count = log.setsCompleted ? log.setsCompleted.length : 0;
      if (count === 0) continue;
      const ex = resolveExercise(log.exerciseId);
      if (ex && ex.primaryMuscles) {
        const mw = ex.primaryMuscles[muscleGroup] || 0;
        if (mw >= 0.20) sets += count;
        else if (mw >= 0.10) sets += count * 0.5;
        continue;
      }
      const legacy = ACCESSORY_DB[log.exerciseId];
      if (legacy) {
        const cw = ACCESSORY_CAT_WEIGHTS[legacy.category];
        if (cw) {
          const mw = cw[muscleGroup] || 0;
          if (mw >= 0.20) sets += count;
          else if (mw >= 0.10) sets += count * 0.5;
        }
      }
    }
    return sets;
  };

  const thisWeek = countWindow(now - weekMs, now);
  const lastWeek = countWindow(now - 2 * weekMs, now - weekMs);
  return thisWeek < target.min && lastWeek < target.min;
}

// ---------------------------------------------------------------------------
// Exercise suggestion helpers
// ---------------------------------------------------------------------------

/**
 * Find the best exercise from the catalog that targets a specific muscle group
 * AND supports today's main lift. Hard-filters on `supportsLifts` — if nothing
 * matches, returns null and the gap is deferred upstream.
 */
function findExerciseForMuscle(muscleGroup, mainLift) {
  // Region gate: calves should never be suggested on bench day, even if some
  // calf exercise happened to include 'bench' in supportsLifts. This is a
  // belt-and-braces check on top of getGapReport's region filter.
  const mgRegion = MUSCLE_REGION[muscleGroup];
  const liftRegion = LIFT_REGION[mainLift];
  if (mgRegion !== liftRegion && mgRegion !== 'core') return null;

  const equip = store.equipmentProfile || {};
  let best = null;
  let bestScore = -Infinity;

  for (const [id, ex] of Object.entries(EXERCISE_CATALOG)) {
    // Hard filter — must directly support today's main lift.
    if (!ex.supportsLifts.includes(mainLift)) continue;
    const muscleWeight = ex.primaryMuscles[muscleGroup] || 0;
    if (muscleWeight < 0.20) continue;
    if (equip[ex.equipment] === false) continue;

    const score = muscleWeight * 100;
    if (score > bestScore) {
      bestScore = score;
      best = { id, name: ex.name, equipment: ex.equipment };
    }
  }

  return best;
}

/**
 * Find the best pulling exercise for push:pull balance. Hard-filters on
 * supportsLifts so we never suggest a deadlift-day row on a bench day.
 */
function findPullExercise(mainLift) {
  const equip = store.equipmentProfile || {};
  let best = null;
  let bestScore = -Infinity;

  for (const [id, ex] of Object.entries(EXERCISE_CATALOG)) {
    if (!ex.supportsLifts.includes(mainLift)) continue;
    const pattern = MOVEMENT_PATTERNS[ex.movementPattern];
    if (!pattern || pattern.pushPull !== 'pull') continue;
    if (equip[ex.equipment] === false) continue;

    let score = 50;
    if (ex.progressionType === 'compound') score += 10;

    if (score > bestScore) {
      bestScore = score;
      best = { id, name: ex.name, equipment: ex.equipment };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Duration estimation
// ---------------------------------------------------------------------------

/**
 * Estimate workout duration in minutes based on exercise list.
 *
 * @param {Object[]} exercises - Array with { type, progressionType } fields
 * @returns {number} Estimated minutes
 */
export function estimateWorkoutDuration(exercises) {
  let minutes = 0;
  for (const ex of exercises) {
    if (ex.type === 'main') minutes += 20;
    else {
      const catalogEx = resolveExercise(ex.exerciseId || ex.id);
      const pType = catalogEx ? catalogEx.progressionType : (ex.progressionType || 'compound');
      if (pType === 'close-variation') minutes += 12;
      else if (pType === 'compound') minutes += 8;
      else minutes += 5; // isolation, bodyweight, time
    }
  }
  return minutes;
}
