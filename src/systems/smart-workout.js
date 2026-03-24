/**
 * Smart workout suggestion system — recommends which lift to train
 * and at what intensity, based on recency, fatigue, plateau detection,
 * and active mesocycle prescriptions.
 */

import store from '../state/store.js';
import { LIFTS } from '../constants/lift-config.js';
import { MS_PER_DAY } from '../constants/time.js';
import { calcFatigueLift } from '../formulas/fatigue.js';
import { detectPlateau, calcProgression } from '../formulas/progression.js';

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

    // Recency
    const liftEntries = store.entries
      .filter(e => e.lift === lift)
      .sort((a, b) => b.timestamp - a.timestamp);
    if (liftEntries.length > 0) {
      const daysSince = Math.floor((Date.now() - liftEntries[0].timestamp) / MS_PER_DAY);
      const recencyScore = Math.min(30, daysSince * 5);
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
  // If mesocycle active, use mesocycle prescription
  if (store.activeMesocycle && store.activeMesocycle.status === 'active') {
    const week = store.activeMesocycle.weeks[store.activeMesocycle.currentWeek - 1];
    if (week && week.workouts[lift]) {
      const w = week.workouts[lift];
      const liftFatigue = calcFatigueLift(lift);
      // Temper if red fatigue
      if (liftFatigue && liftFatigue.status === 'red') {
        return {
          pctTM: Math.max(60, (w.mainSets[0]?.pct || 75) - 10),
          rpe: Math.max(6, week.targetRPE - 1),
          sets: Math.max(3, w.mainSets.length - 1),
          reps: w.mainSets[0]?.reps || 5
        };
      }
      return {
        pctTM: w.mainSets[0]?.pct || 75,
        rpe: week.targetRPE,
        sets: w.mainSets.length,
        reps: w.mainSets[0]?.reps || 5
      };
    }
  }

  // Fatigue-based
  const fatigue = calcFatigueLift(lift);
  const status = fatigue ? fatigue.status : 'green';
  if (status === 'red') return { pctTM: 65, rpe: 6, sets: 3, reps: 5 };
  if (status === 'yellow') return { pctTM: 75, rpe: 7, sets: 4, reps: 5 };
  return { pctTM: 82.5, rpe: 8, sets: 5, reps: 3 };
}
