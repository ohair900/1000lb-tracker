/**
 * Weekly training grade — four-pillar scoring system.
 *
 * Pillars:
 *  1. Compliance (35 pts) — prescribed sets completed (drops out if no program)
 *  2. Muscle Coverage (30 pts) — Tier 1 + Tier 2 muscles, push:pull modifier
 *  3. Intensity Quality (20 pts) — weight accuracy + effective intensity
 *  4. Consistency (15 pts) — training days this week
 *
 * Bonuses (+8 max): PR, all 3 lifts, accessory variety, RPE logging
 *
 * Grade scale: A+ (95-100), A (90-94), A- (85-89), B+ (80-84), B (75-79),
 * B- (70-74), C+ (65-69), C (58-64), C- (50-57), D (35-49), F (0-34)
 */

import store from '../state/store.js';
import { LIFTS } from '../constants/lift-config.js';
import { MUSCLE_GROUPS, MAIN_LIFT_WEIGHTS, WEEKLY_SET_TARGETS } from '../data/muscle-groups.js';
import { ACCESSORY_CAT_WEIGHTS } from '../data/muscle-groups.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { resolveExercise, resolveCanonicalId } from '../data/exercise-compat.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { getProgramWorkout } from '../systems/programs.js';
import { MS_PER_DAY } from '../constants/time.js';

// ---------------------------------------------------------------------------
// Grade mapping
// ---------------------------------------------------------------------------

const GRADE_MAP = [
  { min: 95, grade: 'A+', label: 'Amazing week' },
  { min: 90, grade: 'A',  label: 'Great week' },
  { min: 85, grade: 'A-', label: 'Good week' },
  { min: 80, grade: 'B+', label: 'Solid week' },
  { min: 75, grade: 'B',  label: 'Decent week' },
  { min: 70, grade: 'B-', label: 'Okay week' },
  { min: 65, grade: 'C+', label: 'Below average' },
  { min: 58, grade: 'C',  label: 'Needs improvement' },
  { min: 50, grade: 'C-', label: 'Poor balance' },
  { min: 35, grade: 'D',  label: 'Significant gaps' },
  { min: 0,  grade: 'F',  label: 'Very incomplete' },
];

function scoreToGrade(score) {
  for (const g of GRADE_MAP) {
    if (score >= g.min) return { grade: g.grade, label: g.label };
  }
  return { grade: 'F', label: 'Very incomplete' };
}

// ---------------------------------------------------------------------------
// Week boundary helpers
// ---------------------------------------------------------------------------

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // Shift to Mon=0
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 7);
  return d;
}

// ---------------------------------------------------------------------------
// Main grade function
// ---------------------------------------------------------------------------

/**
 * Calculate the weekly training grade.
 *
 * @param {Object} [options]
 * @param {Date} [options.weekStart] - Start of the week (Monday). Defaults to current week.
 * @returns {{ score: number, grade: string, label: string, insufficient: boolean,
 *             pillars: Object, bonuses: Object, bonusPoints: number, isDeload: boolean }}
 */
export function calcWeeklyGrade(options = {}) {
  const weekStart = options.weekStart || getWeekStart(new Date());
  const weekEnd = getWeekEnd(weekStart);
  const weekStartMs = weekStart.getTime();
  const weekEndMs = weekEnd.getTime();

  // Gather week's data
  const weekEntries = store.entries.filter(e => e.timestamp >= weekStartMs && e.timestamp < weekEndMs);
  const weekAccessories = store.accessoryLog.filter(l => l.timestamp >= weekStartMs && l.timestamp < weekEndMs);

  // Insufficient data check
  const uniqueDays = new Set([
    ...weekEntries.map(e => e.date),
    ...weekAccessories.map(l => new Date(l.timestamp).toISOString().split('T')[0]),
  ]);
  if (weekEntries.length < 3 && uniqueDays.size < 2) {
    return { score: 0, grade: null, label: 'Building baseline...', insufficient: true,
             pillars: {}, bonuses: {}, bonusPoints: 0, isDeload: false };
  }

  // Detect deload week
  const isDeload = detectDeload();

  // Calculate each pillar
  const hasProg = !!store.programConfig.activeProgram;
  const compliance = hasProg ? calcCompliance(weekEntries) : null;
  const coverage = calcCoverage(weekEntries, weekAccessories, isDeload);
  const intensity = calcIntensity(weekEntries, hasProg, isDeload);
  const consistency = calcConsistency(uniqueDays.size);

  // Determine active pillars and redistribute if no program
  const pillars = { compliance, coverage, intensity, consistency };
  let totalScore;

  if (compliance !== null) {
    totalScore = compliance.score + coverage.score + intensity.score + consistency.score;
  } else {
    // No program: redistribute compliance weight (35 pts) proportionally
    const activeMax = 30 + 20 + 15; // 65
    const scale = 100 / activeMax;
    totalScore = (coverage.score + intensity.score + consistency.score) * scale;
  }

  // Bonuses (+8 max)
  const bonuses = calcBonuses(weekEntries, weekAccessories);
  totalScore = Math.min(100, totalScore + bonuses.total);

  const { grade, label } = scoreToGrade(Math.round(totalScore));

  return {
    score: Math.round(totalScore),
    grade,
    label: isDeload ? `${label} (Deload)` : label,
    insufficient: false,
    pillars,
    bonuses: bonuses.details,
    bonusPoints: bonuses.total,
    isDeload,
  };
}

// ---------------------------------------------------------------------------
// Pillar 1: Compliance (35 pts)
// ---------------------------------------------------------------------------

function calcCompliance(weekEntries) {
  let prescribed = 0;
  let completed = 0;

  for (const lift of LIFTS) {
    const week = store.programConfig.liftWeeks?.[lift] || 1;
    const workout = getProgramWorkout(lift, week);
    if (!workout || !workout.sets) continue;
    prescribed += workout.sets.length;
    // Count sets completed this week for this lift
    for (const set of workout.sets) {
      const key = `${lift}-${week}-${set.num}`;
      if (store.programConfig.completedSets[key]) completed++;
    }
  }

  if (prescribed === 0) return { score: 0, detail: 'No sets prescribed', pct: 0 };
  const pct = completed / prescribed;
  // Scoring curve
  let score;
  if (pct >= 1.0) score = 35;
  else if (pct >= 0.9) score = 31;
  else if (pct >= 0.8) score = 27;
  else if (pct >= 0.7) score = 22;
  else if (pct >= 0.6) score = 17;
  else if (pct >= 0.5) score = 12;
  else if (pct >= 0.3) score = 7;
  else score = pct > 0 ? 3 : 0;

  return { score, detail: `${completed}/${prescribed} sets`, pct: Math.round(pct * 100) };
}

// ---------------------------------------------------------------------------
// Pillar 2: Muscle Coverage (30 pts)
// ---------------------------------------------------------------------------

// Tier 1: primary movers (4.5 pts each = 22.5 total)
const TIER1 = ['Quads', 'Chest', 'Glutes', 'Hams', 'Upper Back'];
// Tier 2: supporting muscles (1.5 pts each = 7.5 total)
const TIER2 = ['Lower Back', 'Shoulders', 'Triceps', 'Core', 'Biceps'];

function calcCoverage(weekEntries, weekAccessories, isDeload) {
  // Count direct sets per muscle
  const muscleSets = {};
  MUSCLE_GROUPS.forEach(mg => { muscleSets[mg] = 0; });

  for (const entry of weekEntries) {
    const weights = MAIN_LIFT_WEIGHTS[entry.lift];
    if (!weights) continue;
    for (const mg of MUSCLE_GROUPS) {
      if (weights[mg] >= 0.15) muscleSets[mg] += 1;
    }
  }

  for (const log of weekAccessories) {
    const setsCompleted = log.setsCompleted ? log.setsCompleted.length : 0;
    if (setsCompleted === 0) continue;
    const catalogEx = resolveExercise(log.exerciseId);
    if (catalogEx && catalogEx.primaryMuscles) {
      for (const [mg, weight] of Object.entries(catalogEx.primaryMuscles)) {
        if (weight >= 0.20) muscleSets[mg] += setsCompleted;
        else if (weight >= 0.10) muscleSets[mg] += setsCompleted * 0.5;
      }
    } else {
      const legacyEx = ACCESSORY_DB[log.exerciseId];
      if (legacyEx) {
        const catWeights = ACCESSORY_CAT_WEIGHTS[legacyEx.category];
        if (catWeights) {
          for (const mg of MUSCLE_GROUPS) {
            if (catWeights[mg] >= 0.20) muscleSets[mg] += setsCompleted;
          }
        }
      }
    }
  }

  // Score per muscle
  let score = 0;
  const breakdown = {};

  function scoreMuscle(mg, maxPts) {
    const sets = muscleSets[mg] || 0;
    let pct;
    if (sets >= 3) pct = 1.0;
    else if (sets >= 1) pct = 0.7;
    else if (sets >= 0.5) pct = isDeload ? 0.7 : 0.4;
    else pct = isDeload ? 0.4 : 0;
    const pts = maxPts * pct;
    score += pts;
    breakdown[mg] = { sets: Math.round(sets * 10) / 10, pts: Math.round(pts * 10) / 10 };
  }

  TIER1.forEach(mg => scoreMuscle(mg, 4.5));
  TIER2.forEach(mg => scoreMuscle(mg, 1.5));

  // Push:pull balance modifier
  let pushSets = 0, pullSets = 0;
  for (const mg of ['Chest', 'Shoulders', 'Triceps']) pushSets += muscleSets[mg] || 0;
  for (const mg of ['Upper Back', 'Biceps']) pullSets += muscleSets[mg] || 0;
  pullSets += (muscleSets['Lower Back'] || 0) * 0.5;

  const ratio = pullSets > 0 ? pushSets / pullSets : (pushSets > 0 ? Infinity : 1);
  let modifier = 1.0;
  if (ratio > 2.0 || ratio < 0.5) modifier = 0.85;
  else if (ratio > 1.3 || ratio < 0.7) modifier = 0.93;
  score *= modifier;

  return { score: Math.round(score * 10) / 10, breakdown, pushPullRatio: Math.round(ratio * 100) / 100, modifier };
}

// ---------------------------------------------------------------------------
// Pillar 3: Intensity Quality (20 pts)
// ---------------------------------------------------------------------------

function calcIntensity(weekEntries, hasProg, isDeload) {
  if (weekEntries.length === 0) return { score: 0, avgIntensity: 0, weightAccuracy: null };

  // Sub-component B: Effective intensity (weight / e1RM) — always available
  let intensitySum = 0;
  let intensityCount = 0;
  for (const entry of weekEntries) {
    const e1rm = bestE1RM(entry.lift);
    if (e1rm && e1rm > 0) {
      intensitySum += entry.weight / e1rm;
      intensityCount++;
    }
  }
  const avgIntensity = intensityCount > 0 ? intensitySum / intensityCount : 0;

  // Intensity scoring
  const sweetLow = isDeload ? 0.50 : 0.70;
  const sweetHigh = isDeload ? 0.65 : 0.85;
  let intensityPts;
  if (avgIntensity >= sweetLow && avgIntensity <= sweetHigh) intensityPts = 8;
  else if (avgIntensity > sweetHigh && avgIntensity <= 0.95) intensityPts = 7;
  else if (avgIntensity >= 0.60 && avgIntensity < sweetLow) intensityPts = 6;
  else if (avgIntensity >= 0.50) intensityPts = 4;
  else if (avgIntensity > 0.95) intensityPts = 5;
  else intensityPts = 2;

  // Sub-component A: Weight accuracy vs program (12 pts, program users only)
  let weightAccuracy = null;
  if (hasProg) {
    // Simplified: if we have program sets and entries, compare them
    // Full accuracy tracking would require matching individual sets — approximate
    // by checking if entries exist for all 3 lifts
    const liftsWithEntries = new Set(weekEntries.map(e => e.lift));
    const programLifts = LIFTS.filter(l => {
      const week = store.programConfig.liftWeeks?.[l] || 1;
      return getProgramWorkout(l, week);
    });
    const accuracyPct = programLifts.length > 0
      ? liftsWithEntries.size / programLifts.length
      : 0;

    let accuracyPts;
    if (accuracyPct >= 0.97) accuracyPts = 12;
    else if (accuracyPct >= 0.90) accuracyPts = 10;
    else if (accuracyPct >= 0.80) accuracyPts = 7;
    else if (accuracyPct >= 0.70) accuracyPts = 4;
    else accuracyPts = 2;

    weightAccuracy = { pts: accuracyPts, pct: Math.round(accuracyPct * 100) };
    return {
      score: intensityPts + accuracyPts,
      avgIntensity: Math.round(avgIntensity * 100),
      weightAccuracy,
    };
  }

  // No program: intensity is worth full 20 pts
  // Scale 8-pt intensity score to 20 pts
  return {
    score: Math.round(intensityPts * 20 / 8),
    avgIntensity: Math.round(avgIntensity * 100),
    weightAccuracy: null,
  };
}

// ---------------------------------------------------------------------------
// Pillar 4: Consistency (15 pts)
// ---------------------------------------------------------------------------

function calcConsistency(trainingDays) {
  let score;
  if (trainingDays >= 5) score = 15;
  else if (trainingDays >= 4) score = 14;
  else if (trainingDays >= 3) score = 12;
  else if (trainingDays >= 2) score = 8;
  else if (trainingDays >= 1) score = 4;
  else score = 0;
  return { score, days: trainingDays };
}

// ---------------------------------------------------------------------------
// Bonuses (+8 max)
// ---------------------------------------------------------------------------

function calcBonuses(weekEntries, weekAccessories) {
  let total = 0;
  const details = {};

  // PR this week (+3)
  const hasPR = weekEntries.some(e => e.isPR);
  if (hasPR) { total += 3; details.pr = true; }

  // All 3 lifts trained (+2)
  const lifts = new Set(weekEntries.map(e => e.lift));
  if (lifts.size >= 3) { total += 2; details.allLifts = true; }

  // Accessory variety: 3+ distinct exercises (+2)
  const distinctAccessories = new Set(weekAccessories.map(l => resolveCanonicalId(l.exerciseId)));
  if (distinctAccessories.size >= 3) { total += 2; details.variety = true; }

  // RPE data quality: 50%+ of main sets have RPE (+1)
  const withRPE = weekEntries.filter(e => e.rpe != null && e.rpe > 0);
  if (weekEntries.length > 0 && withRPE.length / weekEntries.length >= 0.5) {
    total += 1; details.rpeLogging = true;
  }

  total = Math.min(8, total);
  return { total, details };
}

// ---------------------------------------------------------------------------
// Deload detection
// ---------------------------------------------------------------------------

function detectDeload() {
  // Check mesocycle
  if (store.activeMesocycle && store.activeMesocycle.status === 'active') {
    const week = store.activeMesocycle.weeks[store.activeMesocycle.currentWeek - 1];
    if (week && week.phase && week.phase.toLowerCase().includes('deload')) return true;
  }
  // Could also check program schedule labels in the future
  return false;
}
