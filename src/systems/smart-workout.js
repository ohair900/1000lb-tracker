/**
 * Smart workout suggestion system — recommends which lift to train
 * and at what intensity, based on recency, fatigue, plateau detection,
 * and active mesocycle prescriptions.
 */

import store from '../state/store.js';
import { LIFTS } from '../constants/lift-config.js';
import { MS_PER_DAY } from '../constants/time.js';
import { calcFatigueLift, calcFatigueByMuscle } from '../systems/fatigue.js';
import { detectPlateau, calcProgression } from '../formulas/progression.js';
import { MAIN_LIFT_WEIGHTS } from '../data/muscle-groups.js';
import { getCalibratedRecovery } from '../systems/recovery-calibration.js';

// ---------------------------------------------------------------------------
// Main lift suggestion
// ---------------------------------------------------------------------------

/**
 * Score each of the three competition lifts and suggest which one the
 * lifter should train next.
 *
 * Scoring factors:
 *  - Recency: +5 per day since last session (capped at 30), +30 if never trained
 *  - Fatigue: green +20, yellow +10, red -10
 *  - Plateau detected: +15
 *  - Declining trend: +10
 *
 * @returns {{ lift: string, scores: Object, reasons: Object }}
 *   `lift` is the recommended lift, `scores` maps each lift to its score,
 *   `reasons` maps each lift to an array of human-readable reason strings.
 */
export function suggestMainLift() {
  const scores = {};
  const reasons = {};

  LIFTS.forEach(lift => {
    let score = 0;
    const r = [];

    // Recency — recovery-aware scoring (#9)
    const liftEntries = store.entries
      .filter(e => e.lift === lift)
      .sort((a, b) => b.timestamp - a.timestamp);
    if (liftEntries.length > 0) {
      const daysSince = Math.floor((Date.now() - liftEntries[0].timestamp) / MS_PER_DAY);

      // Find slowest-recovering muscle for this lift (weight >= 0.15)
      const liftWeights = MAIN_LIFT_WEIGHTS[lift] || {};
      let slowestRecoveryDays = 2; // default fallback
      for (const [mg, mw] of Object.entries(liftWeights)) {
        if (mw >= 0.15) {
          const recoveryDays = getCalibratedRecovery(mg) / 24;
          if (recoveryDays > slowestRecoveryDays) slowestRecoveryDays = recoveryDays;
        }
      }
      const optimalGap = slowestRecoveryDays * 1.1; // 10% buffer

      let recencyScore;
      if (daysSince >= optimalGap) {
        // Past recovery: accelerated scoring
        recencyScore = Math.min(30, Math.round((daysSince - optimalGap) * 8));
      } else {
        // Still recovering: reduced scoring
        recencyScore = Math.min(30, Math.round(daysSince * 2));
      }
      score += recencyScore;
      if (daysSince >= 3) r.push(`${daysSince}d since last session`);
    } else {
      score += 30;
      r.push('Never trained');
    }

    // Fatigue
    const liftFatigue = calcFatigueLift(lift);
    if (liftFatigue) {
      if (liftFatigue.status === 'green') { score += 20; r.push('Well recovered'); }
      else if (liftFatigue.status === 'yellow') { score += 10; r.push('Moderate fatigue'); }
      else { score -= 10; r.push('High fatigue'); }
    }

    // Plateau
    if (detectPlateau(lift)) { score += 15; r.push('Plateau detected'); }

    // Declining trend
    const prog = calcProgression(lift);
    if (prog && prog.direction === 'down') { score += 10; r.push('Declining trend'); }

    scores[lift] = score;
    reasons[lift] = r;
  });

  const best = LIFTS.reduce((a, b) => scores[a] >= scores[b] ? a : b);
  return { lift: best, scores, reasons };
}

// ---------------------------------------------------------------------------
// Intensity suggestion
// ---------------------------------------------------------------------------

/**
 * Suggest training intensity for a lift.
 *
 * If a mesocycle is active, uses the mesocycle's prescription (tempered
 * if fatigue is red). Otherwise falls back to a simple fatigue-based
 * recommendation.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ pctTM: number, rpe: number, sets: number, reps: number }}
 */
export function suggestIntensity(lift) {
  // If mesocycle active, use mesocycle prescription with graduated tempering
  if (store.activeMesocycle && store.activeMesocycle.status === 'active') {
    const week = store.activeMesocycle.weeks[store.activeMesocycle.currentWeek - 1];
    if (week && week.workouts[lift]) {
      const w = week.workouts[lift];
      const liftFatigue = calcFatigueLift(lift);
      const basePct = w.mainSets[0]?.pct || 75;
      const baseRPE = week.targetRPE;
      const baseSets = w.mainSets.length;
      const baseReps = w.mainSets[0]?.reps || 5;

      // Peaking blocks tolerate yellow fatigue (intentional overreach)
      const isPeaking = store.activeMesocycle.goal === 'peaking';

      if (liftFatigue) {
        if (liftFatigue.status === 'red') {
          return {
            pctTM: Math.max(60, basePct - 10),
            rpe: Math.max(6, baseRPE - 1),
            sets: Math.max(3, baseSets - 1),
            reps: baseReps
          };
        }
        if (liftFatigue.status === 'yellow' && !isPeaking) {
          // Get display status for finer granularity (orange vs yellow)
          const muscleFatigue = calcFatigueByMuscle();
          const liftWeights = MAIN_LIFT_WEIGHTS[lift] || {};
          let worstDisplay = 'green';
          const displayOrder = { green: 0, lime: 1, yellow: 2, orange: 3, red: 4 };
          if (muscleFatigue) {
            for (const [mg, mw] of Object.entries(liftWeights)) {
              if (mw >= 0.15 && muscleFatigue[mg] && displayOrder[muscleFatigue[mg].displayStatus] > displayOrder[worstDisplay]) {
                worstDisplay = muscleFatigue[mg].displayStatus;
              }
            }
          }
          if (worstDisplay === 'orange') {
            return {
              pctTM: Math.max(60, Math.round(basePct * 0.90)),
              rpe: Math.min(7, baseRPE),
              sets: Math.max(3, baseSets - 1),
              reps: baseReps
            };
          }
          // Yellow: mild tempering
          return {
            pctTM: Math.round(basePct * 0.95),
            rpe: baseRPE,
            sets: baseSets,
            reps: baseReps
          };
        }
      }
      return { pctTM: basePct, rpe: baseRPE, sets: baseSets, reps: baseReps };
    }
  }

  // Fatigue-based fallback (no mesocycle)
  const fatigue = calcFatigueLift(lift);
  const status = fatigue ? fatigue.status : 'green';
  if (status === 'red') return { pctTM: 65, rpe: 6, sets: 3, reps: 5 };
  if (status === 'yellow') return { pctTM: 75, rpe: 7, sets: 4, reps: 5 };
  return { pctTM: 82.5, rpe: 8, sets: 5, reps: 3 };
}
