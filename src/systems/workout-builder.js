/**
 * Workout builder — accessory selection, scoring, set-weight ramping,
 * weight progression, and smart accessory picking.
 *
 * The "smart" system scores accessories based on weak-point alignment,
 * recency, muscle-group fatigue, progression readiness, and completion
 * rate, then picks a diverse set across categories and equipment types.
 */

import store from '../state/store.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { ACCESSORY_CAT_WEIGHTS, MUSCLE_GROUPS } from '../data/muscle-groups.js';
import { EXERCISE_CATALOG, MOVEMENT_PATTERNS, PROGRESSION_MODELS } from '../data/exercise-catalog.js';
import { resolveExercise, resolveCanonicalId, getExerciseHistory } from '../data/exercise-compat.js';
import { MS_PER_DAY } from '../constants/time.js';
import { roundToPlate } from '../formulas/plates.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';

// ---------------------------------------------------------------------------
// Accessory selection (simple wrapper)
// ---------------------------------------------------------------------------

/**
 * Select the default number (5) of smart accessories for a main lift.
 *
 * @param {string} mainLift - 'squat' | 'bench' | 'deadlift'
 * @returns {Object[]} Scored and selected accessories
 */
export function selectAccessories(mainLift) {
  return selectSmartAccessories(mainLift, 5);
}

// ---------------------------------------------------------------------------
// Set-weight ramping
// ---------------------------------------------------------------------------

/**
 * Compute ramped set weights for a given working weight and number of sets.
 * Sets ramp from lighter warm-up percentages up to 100 % of working weight.
 * If `workingWeight` is 0, returns an array of zeros.
 *
 * @param {number} workingWeight - Target working weight
 * @param {number} numSets       - Number of sets
 * @returns {number[]} Rounded weights for each set
 */
export function computeSetWeights(workingWeight, numSets) {
  if (workingWeight === 0) return Array(numSets).fill(0);
  const rampPcts = {
    1: [1.00],
    2: [0.85, 1.00],
    3: [0.80, 0.90, 1.00],
    4: [0.70, 0.80, 0.90, 1.00],
    5: [0.65, 0.75, 0.85, 0.95, 1.00]
  };
  const pcts = rampPcts[numSets] || rampPcts[3];
  return pcts.map(p => roundToPlate(workingWeight * p));
}

// ---------------------------------------------------------------------------
// Accessory weight determination
// ---------------------------------------------------------------------------

/**
 * Determine the working weight for an accessory exercise.
 *
 * Uses the new catalog + compat layer when available, falling back to
 * the legacy ACCESSORY_DB for exercises not yet in the catalog.
 *
 * Priority order:
 *  1. Most recent accessory log entry (merged across legacy IDs)
 *     with category-specific progression bump if earned
 *  2. Percentage of the main lift's training max
 *  3. Percentage of the main lift's best e1RM * 0.9
 *  4. Zero (bodyweight exercises or no data)
 *
 * @param {string} exerciseId - Key in EXERCISE_CATALOG or ACCESSORY_DB
 * @param {string} mainLift   - 'squat' | 'bench' | 'deadlift'
 * @returns {number} Working weight (rounded to nearest plate increment)
 */
export function getAccessoryWeight(exerciseId, mainLift) {
  // Try catalog first, then legacy DB
  const catalogEx = resolveExercise(exerciseId);
  const legacyEx = ACCESSORY_DB[exerciseId];
  const ex = catalogEx || legacyEx;
  if (!ex) return 0;

  const progressionType = catalogEx ? catalogEx.progressionType : 'compound';

  // Bodyweight exercises: weight can be negative (assisted), 0 (BW), or positive (weighted)
  if (progressionType === 'bodyweight') {
    const canonId = resolveCanonicalId(exerciseId);
    const history = getExerciseHistory(canonId, store.accessoryLog);
    const recent = history[0];
    if (!recent) return 0; // Default to bodyweight (0)

    const topOfRange = ex.repRange ? ex.repRange[1] : 12;
    const allHitTop = recent.setsCompleted.length >= recent.targetSets &&
      recent.setsCompleted.every(reps => reps >= topOfRange);
    if (allHitTop) {
      const model = PROGRESSION_MODELS['bodyweight'];
      const bump = store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
      // Assisted (negative): reduce assistance toward 0. BW/weighted: add weight.
      return recent.weight + bump;
    }
    return recent.weight;
  }

  // Time-based exercises: no weight
  if (progressionType === 'time') return 0;

  // Legacy bodyweight check (no catalog entry)
  if (!catalogEx && legacyEx && legacyEx.pctOfTM === 0) return 0;

  const pctOfTM = catalogEx
    ? (catalogEx.pctOfTM[mainLift] || 0)
    : (legacyEx ? legacyEx.pctOfTM : 0);

  // Close-variation: always recalculate from TM (auto-scales when TM changes)
  if (progressionType === 'close-variation' && pctOfTM > 0) {
    const tm = store.programConfig.trainingMaxes[mainLift];
    if (tm) return roundToPlate(tm * pctOfTM);
    const e1rm = bestE1RM(mainLift);
    if (e1rm) return roundToPlate(e1rm * 0.9 * pctOfTM);
    return 0;
  }

  // Merge history from all legacy IDs for this exercise
  const canonId = resolveCanonicalId(exerciseId);
  const history = getExerciseHistory(canonId, store.accessoryLog);
  const recent = history[0];

  if (recent) {
    const topOfRange = ex.repRange ? ex.repRange[1] : (recent.repRange ? recent.repRange[1] : 12);
    const allHitTop = recent.setsCompleted.length >= recent.targetSets &&
      recent.setsCompleted.every(reps => reps >= topOfRange);

    if (allHitTop) {
      const model = PROGRESSION_MODELS[progressionType];
      let bump;
      if (model && model.increment) {
        bump = store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
      } else {
        bump = (mainLift === 'bench')
          ? (store.unit === 'kg' ? 2.5 : 5)
          : (store.unit === 'kg' ? 5 : 10);
      }
      return roundToPlate(recent.weight + bump);
    }
    return recent.weight;
  }

  // Initial weight from TM
  if (pctOfTM > 0) {
    const tm = store.programConfig.trainingMaxes[mainLift];
    if (tm) return roundToPlate(tm * pctOfTM);
    const e1rm = bestE1RM(mainLift);
    if (e1rm) return roundToPlate(e1rm * 0.9 * pctOfTM);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Accessory progression check
// ---------------------------------------------------------------------------

/**
 * Check whether an accessory exercise is ready for a weight increase
 * (double progression: all prescribed sets completed at the top of the rep range).
 *
 * @param {string} exerciseId - Key in EXERCISE_CATALOG or ACCESSORY_DB
 * @param {string} mainLift   - 'squat' | 'bench' | 'deadlift'
 * @returns {boolean}
 */
export function checkAccessoryProgression(exerciseId, mainLift) {
  const catalogEx = resolveExercise(exerciseId);
  const legacyEx = ACCESSORY_DB[exerciseId];
  const ex = catalogEx || legacyEx;
  if (!ex) return false;

  const pctOfTM = catalogEx
    ? (catalogEx.pctOfTM[mainLift] || 0)
    : (legacyEx ? legacyEx.pctOfTM : 0);
  if (pctOfTM === 0 && !catalogEx?.pctOfTM) return false;

  const canonId = resolveCanonicalId(exerciseId);
  const history = getExerciseHistory(canonId, store.accessoryLog);
  const recent = history[0];
  if (!recent) return false;
  const topOfRange = ex.repRange ? ex.repRange[1] : 12;
  return recent.setsCompleted.length >= recent.targetSets &&
    recent.setsCompleted.every(reps => reps >= topOfRange);
}

// ---------------------------------------------------------------------------
// Accessory scoring
// ---------------------------------------------------------------------------

/**
 * Score every accessory for a main lift based on:
 *  - Weak-point alignment (+25)
 *  - Recency — days since last performed (up to +20)
 *  - Muscle-group fatigue (green +5, red -10)
 *  - Progression readiness (+10)
 *  - Completion-rate penalty (low -15, moderate -5)
 *  - Equipment availability (available +0, unavailable -50)
 *
 * Uses EXERCISE_CATALOG for cross-lift support. Falls back to legacy
 * ACCESSORY_DB for exercises not yet in the catalog.
 *
 * @param {string} mainLift - 'squat' | 'bench' | 'deadlift'
 * @param {Object} [options]
 * @param {string} [options.excludeEquipment] - Equipment type to exclude
 * @param {boolean} [options.crossLift=true] - Include exercises from other lifts
 * @returns {Object[]} Scored accessories sorted by score descending
 */
export function scoreAccessories(mainLift, options = {}) {
  const { excludeEquipment = null, crossLift = true } = options;
  const weakPoint = store.workoutConfig.weakPoints[mainLift];
  const now = Date.now();
  const muscleFatigue = calcFatigueByMuscle();
  const equip = store.equipmentProfile || {};

  // Build candidate list from EXERCISE_CATALOG (canonical, cross-lift)
  const candidates = [];
  const seenCanonical = new Set();

  for (const [id, ex] of Object.entries(EXERCISE_CATALOG)) {
    if (excludeEquipment && ex.equipment === excludeEquipment) continue;
    const supportsThisLift = ex.supportsLifts.includes(mainLift);
    if (!crossLift && !supportsThisLift) continue;

    let score = 0;
    const r = [];

    // Equipment availability: available is neutral, unavailable is heavily penalized (grayed out)
    const equipAvailable = equip[ex.equipment] !== false;
    if (!equipAvailable) {
      score -= 50;
      r.push('Equipment unavailable');
    }

    // Weak point alignment
    const exerciseWeakPoints = ex.weakPoints[mainLift] || [];
    if (weakPoint && exerciseWeakPoints.includes(weakPoint)) {
      score += 25;
      r.push('Targets weak point');
    }

    // Cross-lift relevance penalty (exercises that don't directly support this lift)
    if (!supportsThisLift) {
      score -= 15;
      r.push('Cross-lift exercise');
    }

    // Recency — merge history from all legacy IDs
    const history = getExerciseHistory(id, store.accessoryLog);
    const recent = history[0];
    if (recent) {
      const daysSince = Math.floor((now - recent.timestamp) / MS_PER_DAY);
      const recencyScore = Math.min(20, daysSince * 2);
      score += recencyScore;
      if (daysSince >= 5) r.push(`${daysSince}d since last`);
    } else {
      score += 20;
      r.push('Not yet performed');
    }

    // Muscle group fatigue
    if (muscleFatigue && ex.primaryMuscles) {
      for (const [mg, weight] of Object.entries(ex.primaryMuscles)) {
        if (weight > 0.15 && muscleFatigue[mg]) {
          if (muscleFatigue[mg].status === 'green') score += 5;
          else if (muscleFatigue[mg].status === 'red') { score -= 10; r.push(`${mg} fatigued`); }
        }
      }
    }

    // Progression readiness
    if (recent && checkAccessoryProgression(id, mainLift)) {
      score += 10;
      r.push('Ready for weight increase');
    }

    // Completion rate penalty
    const last5 = history.slice(0, 5);
    if (last5.length >= 2) {
      const avgCompletion = last5.reduce(
        (sum, log) => sum + (log.setsCompleted.length / Math.max(log.targetSets, 1)), 0
      ) / last5.length;
      if (avgCompletion < 0.5) { score -= 15; r.push('Low completion rate'); }
      else if (avgCompletion < 0.75) { score -= 5; r.push('Moderate completion'); }
    }

    candidates.push({
      id, ...ex, score, reasons: r,
      equipAvailable,
      movementPattern: ex.movementPattern,
      canonicalId: id,
    });
    seenCanonical.add(id);
  }

  // Also include legacy-only exercises not yet in catalog (custom exercises etc.)
  for (const [id, ex] of Object.entries(ACCESSORY_DB)) {
    const canonId = resolveCanonicalId(id);
    if (seenCanonical.has(canonId)) continue; // Already in catalog
    if (ex.mainLift !== mainLift) continue;
    if (excludeEquipment && ex.equipment === excludeEquipment) continue;

    let score = 0;
    const r = [];
    if (weakPoint && ex.weakPoints.includes(weakPoint)) { score += 25; r.push('Targets weak point'); }
    const recentLogs = store.accessoryLog.filter(l => l.exerciseId === id).sort((a, b) => b.timestamp - a.timestamp);
    const recent = recentLogs[0];
    if (recent) {
      const daysSince = Math.floor((now - recent.timestamp) / MS_PER_DAY);
      score += Math.min(20, daysSince * 2);
      if (daysSince >= 5) r.push(`${daysSince}d since last`);
    } else { score += 20; r.push('Not yet performed'); }
    if (muscleFatigue) {
      const catWeights = ACCESSORY_CAT_WEIGHTS[ex.category];
      if (catWeights) {
        MUSCLE_GROUPS.forEach(mg => {
          if (catWeights[mg] > 0 && muscleFatigue[mg]) {
            if (muscleFatigue[mg].status === 'green') score += 5;
            else if (muscleFatigue[mg].status === 'red') { score -= 10; r.push(`${mg} fatigued`); }
          }
        });
      }
    }
    candidates.push({ id, ...ex, score, reasons: r, equipAvailable: true, canonicalId: canonId });
    seenCanonical.add(canonId);
  }

  return candidates.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Smart accessory selection
// ---------------------------------------------------------------------------

/**
 * Pick `count` accessories using a multi-pass strategy:
 *  1. One per movement pattern (highest scorer)
 *  2. Equipment diversity
 *  3. Pure score fill
 *
 * Only includes exercises with available equipment in first two passes.
 * Unavailable-equipment exercises can fill in pass 3 if needed.
 *
 * @param {string} mainLift - 'squat' | 'bench' | 'deadlift'
 * @param {number} [count=5] - Number of accessories to select
 * @returns {Object[]} Selected accessories (subset of scoreAccessories output)
 */
export function selectSmartAccessories(mainLift, count) {
  count = count || 5;
  const scored = scoreAccessories(mainLift);
  const available = scored.filter(ex => ex.equipAvailable !== false);
  const picked = [];
  const usedPatterns = new Set();
  const usedEquip = new Set();

  // Pass 1: one per movement pattern (highest scorer, available equipment only)
  for (const ex of available) {
    if (picked.length >= count) break;
    const pattern = ex.movementPattern || ex.category;
    if (!usedPatterns.has(pattern)) {
      picked.push(ex);
      usedPatterns.add(pattern);
      usedEquip.add(ex.equipment);
    }
  }

  // Pass 2: equipment diversity (available equipment only)
  for (const ex of available) {
    if (picked.length >= count) break;
    if (!picked.some(p => p.id === ex.id) && !usedEquip.has(ex.equipment)) {
      picked.push(ex);
      usedEquip.add(ex.equipment);
    }
  }

  // Pass 3: pure score (includes unavailable equipment as fallback)
  for (const ex of scored) {
    if (picked.length >= count) break;
    if (!picked.some(p => p.id === ex.id)) picked.push(ex);
  }

  return picked;
}
