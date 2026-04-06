/**
 * Weekly muscle coverage analysis for the prior-week review card.
 *
 * - calcWeeklyCoverage(weekStart) — muscle-by-muscle coverage for a given week
 * - calcWeeklyFocus(coverage, weekEntries) — actionable focus suggestion
 */

import store from '../state/store.js';
import { MS_PER_DAY } from '../constants/time.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { MUSCLE_GROUPS, MAIN_LIFT_WEIGHTS, ACCESSORY_CAT_WEIGHTS } from '../data/muscle-groups.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { resolveExercise } from '../data/exercise-compat.js';

/**
 * Calculate muscle coverage for a given week.
 * Returns the same shape as calcFatigueByMuscle() so renderBodyMap() works directly.
 *
 * @param {Date} weekStart - Monday of the week to analyze
 * @returns {Object} { [muscleGroup]: { displayStatus, displayLabel, sets, exercises } }
 */
export function calcWeeklyCoverage(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const startMs = weekStart.getTime();
  const endMs = weekEnd.getTime();

  const weekEntries = store.entries.filter(e => e.timestamp >= startMs && e.timestamp < endMs);
  const weekAccessories = store.accessoryLog.filter(l => l.timestamp >= startMs && l.timestamp < endMs);

  // Count sets per muscle
  const muscleSets = {};
  const muscleExercises = {};
  MUSCLE_GROUPS.forEach(mg => { muscleSets[mg] = 0; muscleExercises[mg] = []; });

  for (const entry of weekEntries) {
    const weights = MAIN_LIFT_WEIGHTS[entry.lift];
    if (!weights) continue;
    for (const mg of MUSCLE_GROUPS) {
      if (weights[mg] >= 0.15) {
        muscleSets[mg] += 1;
        const name = LIFT_NAMES[entry.lift];
        if (!muscleExercises[mg].includes(name)) muscleExercises[mg].push(name);
      }
    }
  }

  for (const log of weekAccessories) {
    const setsCompleted = log.setsCompleted ? log.setsCompleted.length : 0;
    if (setsCompleted === 0) continue;
    const catalogEx = resolveExercise(log.exerciseId);
    const legacyEx = !catalogEx ? ACCESSORY_DB[log.exerciseId] : null;
    const name = catalogEx ? catalogEx.name : (legacyEx ? legacyEx.name : null);

    if (catalogEx && catalogEx.primaryMuscles) {
      for (const [mg, weight] of Object.entries(catalogEx.primaryMuscles)) {
        if (weight >= 0.15) {
          muscleSets[mg] += setsCompleted;
          if (name && !muscleExercises[mg].includes(name)) muscleExercises[mg].push(name);
        }
      }
    } else if (legacyEx) {
      const catWeights = ACCESSORY_CAT_WEIGHTS[legacyEx.category];
      if (catWeights) {
        for (const mg of MUSCLE_GROUPS) {
          if (catWeights[mg] >= 0.15) {
            muscleSets[mg] += setsCompleted;
            if (name && !muscleExercises[mg].includes(name)) muscleExercises[mg].push(name);
          }
        }
      }
    }
  }

  // Map sets to display status for body map coloring
  const result = {};
  MUSCLE_GROUPS.forEach(mg => {
    const sets = Math.round(muscleSets[mg] * 10) / 10;
    let displayStatus;
    if (sets >= 3) displayStatus = 'green';
    else if (sets >= 2) displayStatus = 'lime';
    else if (sets >= 1) displayStatus = 'yellow';
    else displayStatus = null; // gray/dim on body map
    result[mg] = { displayStatus, displayLabel: `${Math.round(sets)}`, sets, exercises: muscleExercises[mg] };
  });

  return result;
}

/**
 * Generate an actionable focus suggestion based on coverage gaps.
 *
 * @param {Object} coverage - Output of calcWeeklyCoverage
 * @param {Date} weekStart - Monday of the analyzed week
 * @returns {string} Focus suggestion
 */
export function calcWeeklyFocus(coverage, weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const startMs = weekStart.getTime();
  const endMs = weekEnd.getTime();
  const weekEntries = store.entries.filter(e => e.timestamp >= startMs && e.timestamp < endMs);

  // Check which lifts were trained
  const liftsTrained = new Set(weekEntries.map(e => e.lift));
  const missedLifts = LIFTS.filter(l => !liftsTrained.has(l));

  // Find muscle gaps (0-1 sets, Tier 1 only for suggestions)
  const tier1 = ['Quads', 'Chest', 'Glutes', 'Hams', 'Upper Back'];
  const gaps = tier1.filter(mg => coverage[mg] && coverage[mg].sets < 2);

  if (missedLifts.length === 0 && gaps.length === 0) {
    return 'Great balance last week — keep it up';
  }

  const parts = [];
  if (missedLifts.length > 0) {
    parts.push(...missedLifts.map(l => LIFT_NAMES[l]));
  }
  if (gaps.length > 0 && parts.length < 3) {
    const remaining = 3 - parts.length;
    const newGaps = gaps.filter(g => !parts.some(p => p.toLowerCase().includes(g.toLowerCase())));
    parts.push(...newGaps.slice(0, remaining));
  }

  if (parts.length === 0) return 'Good coverage — stay consistent';
  return `Focus this week: ${parts.join(' + ')}`;
}

/**
 * Get prior week recap data (lifts breakdown + coverage + focus).
 *
 * @returns {Object|null} { coverage, liftStats, focus, weekLabel, totalSets, totalVolume, prs }
 */
export function calcPriorWeekReview() {
  const now = new Date();
  const day = MS_PER_DAY;
  const thisWeekStart = new Date(now.getTime() - ((now.getDay() + 6) % 7) * day);
  thisWeekStart.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * day);
  const lastWeekEnd = thisWeekStart;

  const startMs = lastWeekStart.getTime();
  const endMs = lastWeekEnd.getTime();
  const weekEntries = store.entries.filter(e => e.timestamp >= startMs && e.timestamp < endMs);
  const weekAccessories = store.accessoryLog.filter(l => l.timestamp >= startMs && l.timestamp < endMs);

  if (weekEntries.length === 0 && weekAccessories.length === 0) return null;

  const coverage = calcWeeklyCoverage(lastWeekStart);
  const focus = calcWeeklyFocus(coverage, lastWeekStart);

  // Per-lift stats
  const liftStats = {};
  LIFTS.forEach(l => {
    const liftEntries = weekEntries.filter(e => e.lift === l);
    const sets = liftEntries.length;
    const volume = liftEntries.reduce((s, e) => s + e.weight * e.reps, 0);
    const prs = liftEntries.filter(e => e.isPR).length;
    let avgIntensity = 0;
    if (sets > 0) {
      avgIntensity = Math.round(liftEntries.reduce((s, e) => s + (e.e1rm > 0 ? e.weight / e.e1rm : 0), 0) / sets * 100);
    }
    liftStats[l] = { sets, volume, prs, avgIntensity };
  });

  const totalSets = weekEntries.length;
  const totalVolume = weekEntries.reduce((s, e) => s + e.weight * e.reps, 0);
  const prs = weekEntries.filter(e => e.isPR);

  // Prior-prior week for comparison (W-2)
  const priorPriorStart = new Date(lastWeekStart.getTime() - 7 * day);
  const priorPriorEnd = lastWeekStart;
  const ppEntries = store.entries.filter(e => e.timestamp >= priorPriorStart.getTime() && e.timestamp < priorPriorEnd.getTime());
  const priorCoverage = calcWeeklyCoverage(priorPriorStart);
  const priorTotalSets = ppEntries.length;
  const priorTotalVolume = ppEntries.reduce((s, e) => s + e.weight * e.reps, 0);
  const priorDays = new Set(ppEntries.map(e => e.date)).size;
  // Compute prior week avg intensity
  let ppIntSum = 0, ppIntCount = 0;
  ppEntries.forEach(e => {
    if (e.e1rm > 0) { ppIntSum += e.weight / e.e1rm; ppIntCount++; }
  });
  const priorAvgInt = ppIntCount > 0 ? Math.round(ppIntSum / ppIntCount * 100) : 0;

  // Prior week per-lift stats
  const priorLiftStats = {};
  LIFTS.forEach(l => {
    priorLiftStats[l] = { sets: ppEntries.filter(e => e.lift === l).length };
  });

  // Training days (which weekdays had training)
  const trainingDays = new Set(weekEntries.map(e => e.date)).size;
  const trainingDaysList = [];
  for (let d = 0; d < 7; d++) {
    const dayDate = new Date(lastWeekStart.getTime() + d * day);
    const dateStr = dayDate.toISOString().split('T')[0];
    trainingDaysList.push(weekEntries.some(e => e.date === dateStr) || weekAccessories.some(l => {
      const lDate = l.date || new Date(l.timestamp).toISOString().split('T')[0];
      return lDate === dateStr;
    }));
  }

  // Avg intensity for last week
  let lwIntSum = 0, lwIntCount = 0;
  weekEntries.forEach(e => {
    if (e.e1rm > 0) { lwIntSum += e.weight / e.e1rm; lwIntCount++; }
  });
  const avgIntensity = lwIntCount > 0 ? Math.round(lwIntSum / lwIntCount * 100) : 0;

  return {
    coverage, liftStats, focus,
    weekLabel: lastWeekStart.toISOString().split('T')[0],
    totalSets, totalVolume, prs, trainingDays, trainingDaysList, avgIntensity,
    prior: {
      coverage: priorCoverage,
      totalSets: priorTotalSets,
      totalVolume: priorTotalVolume,
      days: priorDays,
      avgIntensity: priorAvgInt,
      liftStats: priorLiftStats,
    }
  };
}
