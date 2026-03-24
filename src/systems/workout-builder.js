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
import { MS_PER_DAY } from '../constants/time.js';
import { roundToPlate } from '../formulas/plates.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { calcFatigueByMuscle } from '../formulas/fatigue.js';

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
 * Priority order:
 *  1. Most recent accessory log entry (with double-progression bump if earned)
 *  2. Percentage of the main lift's training max
 *  3. Percentage of the main lift's best e1RM * 0.9
 *  4. Zero (bodyweight exercises or no data)
 *
 * @param {string} exerciseId - Key in ACCESSORY_DB
 * @param {string} mainLift   - 'squat' | 'bench' | 'deadlift'
 * @returns {number} Working weight (rounded to nearest plate increment)
 */
export function getAccessoryWeight(exerciseId, mainLift) {
  const ex = ACCESSORY_DB[exerciseId];
  if (!ex || ex.pctOfTM === 0) return 0; // bodyweight

  // Check log for most recent entry
  const recent = store.accessoryLog
    .filter(l => l.exerciseId === exerciseId)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  if (recent) {
    // Check double progression: did all sets hit top of rep range?
    const allHitTop = recent.setsCompleted.length >= recent.targetSets &&
      recent.setsCompleted.every(reps => reps >= ex.repRange[1]);
    if (allHitTop) {
      const bump = (mainLift === 'bench')
        ? (store.unit === 'kg' ? 2.5 : 5)
        : (store.unit === 'kg' ? 5 : 10);
      return roundToPlate(recent.weight + bump);
    }
    return recent.weight;
  }

  // Initial weight from TM
  const tm = store.programConfig.trainingMaxes[mainLift];
  if (tm) return roundToPlate(tm * ex.pctOfTM);

  // Fallback to e1RM
  const e1rm = bestE1RM(mainLift);
  if (e1rm) return roundToPlate(e1rm * 0.9 * ex.pctOfTM);

  return 0;
}

// ---------------------------------------------------------------------------
// Accessory progression check
// ---------------------------------------------------------------------------

/**
 * Check whether an accessory exercise is ready for a weight increase
 * (double progression: all prescribed sets completed at the top of the rep range).
 *
 * @param {string} exerciseId - Key in ACCESSORY_DB
 * @param {string} mainLift   - 'squat' | 'bench' | 'deadlift'
 * @returns {boolean}
 */
export function checkAccessoryProgression(exerciseId, mainLift) {
  const ex = ACCESSORY_DB[exerciseId];
  if (!ex || ex.pctOfTM === 0) return false;
  const recent = store.accessoryLog
    .filter(l => l.exerciseId === exerciseId)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!recent) return false;
  return recent.setsCompleted.length >= recent.targetSets &&
    recent.setsCompleted.every(reps => reps >= ex.repRange[1]);
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
 *
 * @param {string} mainLift - 'squat' | 'bench' | 'deadlift'
 * @returns {Object[]} Scored accessories sorted by score descending
 */
export function scoreAccessories(mainLift) {
  const weakPoint = store.workoutConfig.weakPoints[mainLift];
  const now = Date.now();
  const muscleFatigue = calcFatigueByMuscle();

  return Object.entries(ACCESSORY_DB)
    .filter(([, ex]) => ex.mainLift === mainLift)
    .map(([id, ex]) => {
      let score = 0;
      const r = [];

      // Weak point alignment
      if (weakPoint && ex.weakPoints.includes(weakPoint)) {
        score += 25;
        r.push('Targets weak point');
      }

      // Recency
      const recentLogs = store.accessoryLog
        .filter(l => l.exerciseId === id)
        .sort((a, b) => b.timestamp - a.timestamp);
      const recent = recentLogs[0];
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
      if (muscleFatigue) {
        const catWeights = ACCESSORY_CAT_WEIGHTS[ex.category];
        if (catWeights) {
          MUSCLE_GROUPS.forEach(mg => {
            if (catWeights[mg] > 0 && muscleFatigue[mg]) {
              if (muscleFatigue[mg].status === 'green') { score += 5; }
              else if (muscleFatigue[mg].status === 'red') { score -= 10; r.push(`${mg} fatigued`); }
            }
          });
        }
      }

      // Progression signal
      if (recent && checkAccessoryProgression(id, mainLift)) {
        score += 10;
        r.push('Ready for weight increase');
      }

      // Completion rate penalty
      const last5 = recentLogs.slice(0, 5);
      if (last5.length >= 2) {
        const avgCompletion = last5.reduce(
          (sum, log) => sum + (log.setsCompleted.length / log.targetSets), 0
        ) / last5.length;
        if (avgCompletion < 0.5) { score -= 15; r.push('Low completion rate'); }
        else if (avgCompletion < 0.75) { score -= 5; r.push('Moderate completion'); }
      }

      return { id, ...ex, score, reasons: r };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Smart accessory selection
// ---------------------------------------------------------------------------

/**
 * Pick `count` accessories using a multi-pass strategy:
 *  1. One per category (highest scorer)
 *  2. Equipment diversity
 *  3. Pure score fill
 *
 * @param {string} mainLift - 'squat' | 'bench' | 'deadlift'
 * @param {number} [count=5] - Number of accessories to select
 * @returns {Object[]} Selected accessories (subset of scoreAccessories output)
 */
export function selectSmartAccessories(mainLift, count) {
  count = count || 5;
  const scored = scoreAccessories(mainLift);
  const picked = [];
  const usedCategories = new Set();
  const usedEquip = new Set();

  // Pass 1: one per category (highest scorer)
  for (const ex of scored) {
    if (picked.length >= count) break;
    if (!usedCategories.has(ex.category)) {
      picked.push(ex);
      usedCategories.add(ex.category);
      usedEquip.add(ex.equipment);
    }
  }

  // Pass 2: equipment diversity
  for (const ex of scored) {
    if (picked.length >= count) break;
    if (!picked.some(p => p.id === ex.id) && !usedEquip.has(ex.equipment)) {
      picked.push(ex);
      usedEquip.add(ex.equipment);
    }
  }

  // Pass 3: pure score
  for (const ex of scored) {
    if (picked.length >= count) break;
    if (!picked.some(p => p.id === ex.id)) picked.push(ex);
  }

  return picked;
}
