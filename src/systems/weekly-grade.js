/**
 * Weekly training grade — four-pillar scoring system.
 *
 * Pillars:
 *  1. Compliance (25 pts) — prescribed sets completed (drops out if no program)
 *  2. Muscle Coverage (30 pts) — Tier 1 + Tier 2 muscles, push:pull modifier
 *  3. Intensity Quality (25 pts) — weight accuracy + effective intensity
 *  4. Consistency (20 pts) — training days vs elapsed days, 3 days/week = full marks
 *
 * Bonuses (+15 max): Main lift PRs (+5 each), RPE quality, accessory variety, RPE logging
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
  { min: 95, grade: 'A+', label: 'Peak performance' },
  { min: 90, grade: 'A',  label: 'Strong week' },
  { min: 85, grade: 'A-', label: 'Good week' },
  { min: 80, grade: 'B+', label: 'On track' },
  { min: 75, grade: 'B',  label: 'Decent week' },
  { min: 70, grade: 'B-', label: 'Room to grow' },
  { min: 65, grade: 'C+', label: 'Missing pieces' },
  { min: 58, grade: 'C',  label: 'Incomplete week' },
  { min: 50, grade: 'C-', label: 'Fell short' },
  { min: 35, grade: 'D',  label: 'Minimal training' },
  { min: 0,  grade: 'F',  label: 'Rest week?' },
];

function scoreToGrade(score) {
  for (const g of GRADE_MAP) {
    if (score >= g.min) return { grade: g.grade, label: g.label };
  }
  return { grade: 'F', label: 'Rest week?' };
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

  // Insufficient data: hide grade until at least 1 training day
  const uniqueDays = new Set([
    ...weekEntries.map(e => e.date),
    ...weekAccessories.map(l => new Date(l.timestamp).toISOString().split('T')[0]),
  ]);
  if (uniqueDays.size < 1) {
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
  const consistency = calcConsistency(uniqueDays.size, weekStart);

  // Determine active pillars and redistribute if no program
  const pillars = { compliance, coverage, intensity, consistency };
  let totalScore;

  if (compliance !== null) {
    totalScore = compliance.score + coverage.score + intensity.score + consistency.score;
  } else {
    // No program: redistribute compliance weight (25 pts) proportionally
    const activeMax = 30 + 25 + 20; // 75
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
// Pillar 1: Compliance (25 pts)
// ---------------------------------------------------------------------------

function calcCompliance(weekEntries) {
  let prescribed = 0;
  let completed = 0;

  for (const lift of LIFTS) {
    const week = store.programConfig.liftWeeks?.[lift] || 1;
    const workout = getProgramWorkout(lift, week);
    if (!workout || !workout.sets) continue;
    prescribed += workout.sets.length;
    for (const set of workout.sets) {
      const key = `${lift}-${week}-${set.num}`;
      if (store.programConfig.completedSets[key]) completed++;
    }
  }

  if (prescribed === 0) return { score: 0, detail: 'No sets prescribed', pct: 0 };
  const pct = completed / prescribed;
  let score;
  if (pct >= 1.0) score = 25;
  else if (pct >= 0.9) score = 22;
  else if (pct >= 0.8) score = 19;
  else if (pct >= 0.7) score = 16;
  else if (pct >= 0.6) score = 12;
  else if (pct >= 0.5) score = 9;
  else if (pct >= 0.3) score = 5;
  else score = pct > 0 ? 2 : 0;

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

  function scoreMuscle(mg, maxPts, isTier2) {
    const sets = muscleSets[mg] || 0;
    const fullThreshold = isTier2 ? 2 : 3; // Tier 2: 2 sets = full credit
    let pct;
    if (sets >= fullThreshold) pct = 1.0;
    else if (sets >= 1) pct = 0.7;
    else if (sets >= 0.5) pct = isDeload ? 0.7 : 0.4;
    else pct = isDeload ? 0.4 : 0;
    const pts = maxPts * pct;
    score += pts;
    breakdown[mg] = { sets: Math.round(sets * 10) / 10, pts: Math.round(pts * 10) / 10 };
  }

  TIER1.forEach(mg => scoreMuscle(mg, 4.5, false));
  TIER2.forEach(mg => scoreMuscle(mg, 1.5, true));

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
// Pillar 3: Intensity Quality (25 pts)
// ---------------------------------------------------------------------------

function calcIntensity(weekEntries, hasProg, isDeload) {
  if (weekEntries.length === 0) return { score: 0, avgIntensity: 0, weightAccuracy: null };

  // Sub-component B: Effective intensity (weight / e1RM)
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

  // Intensity scoring — widened sweet zone (65-90% non-deload)
  const sweetLow = isDeload ? 0.50 : 0.65;
  const sweetHigh = isDeload ? 0.65 : 0.90;
  let intensityPts;
  if (avgIntensity >= sweetLow && avgIntensity <= sweetHigh) intensityPts = 10;
  else if ((avgIntensity > 0.55 && avgIntensity < sweetLow) || (avgIntensity > sweetHigh && avgIntensity <= 0.95)) intensityPts = 9;
  else if (avgIntensity >= 0.50) intensityPts = 6;
  else if (avgIntensity > 0.95) intensityPts = 6;
  else intensityPts = 3;

  // Sub-component A: Weight accuracy vs program (15 pts, program users only)
  let weightAccuracy = null;
  if (hasProg) {
    const liftsWithEntries = new Set(weekEntries.map(e => e.lift));
    const programLifts = LIFTS.filter(l => {
      const week = store.programConfig.liftWeeks?.[l] || 1;
      return getProgramWorkout(l, week);
    });
    const accuracyPct = programLifts.length > 0
      ? liftsWithEntries.size / programLifts.length
      : 0;

    let accuracyPts;
    if (accuracyPct >= 0.97) accuracyPts = 15;
    else if (accuracyPct >= 0.90) accuracyPts = 12;
    else if (accuracyPct >= 0.80) accuracyPts = 9;
    else if (accuracyPct >= 0.70) accuracyPts = 5;
    else accuracyPts = 2;

    weightAccuracy = { pts: accuracyPts, pct: Math.round(accuracyPct * 100) };
    return {
      score: intensityPts + accuracyPts,
      avgIntensity: Math.round(avgIntensity * 100),
      weightAccuracy,
    };
  }

  // No program: intensity is worth full 25 pts
  return {
    score: Math.round(intensityPts * 25 / 10),
    avgIntensity: Math.round(avgIntensity * 100),
    weightAccuracy: null,
  };
}

// ---------------------------------------------------------------------------
// Pillar 4: Consistency (20 pts) — elapsed-day aware, 3 days = full marks
// ---------------------------------------------------------------------------

function calcConsistency(trainingDays, weekStart) {
  const now = new Date();
  const daysElapsed = Math.max(1, Math.ceil((now - weekStart) / MS_PER_DAY));
  const targetRate = 3 / 7; // 3 sessions per week
  const currentRate = trainingDays / daysElapsed;
  const ratio = Math.min(1, currentRate / targetRate);
  const score = Math.round(ratio * 20);
  return { score, days: trainingDays };
}

// ---------------------------------------------------------------------------
// Bonuses (+15 max)
// ---------------------------------------------------------------------------

function calcBonuses(weekEntries, weekAccessories) {
  let total = 0;
  const details = {};

  // Main lift PRs (+5 each, max +10) — PRs are a big deal
  const mainPRs = weekEntries.filter(e => e.isPR && LIFTS.includes(e.lift));
  if (mainPRs.length > 0) {
    const prBonus = Math.min(10, mainPRs.length * 5);
    total += prBonus;
    details.pr = true;
    details.prCount = mainPRs.length;
  }

  // RPE quality: avg RPE of main lifts in 7-9 range (+2)
  const withRPE = weekEntries.filter(e => e.rpe != null && e.rpe > 0);
  if (withRPE.length >= 2) {
    const avgRPE = withRPE.reduce((s, e) => s + e.rpe, 0) / withRPE.length;
    if (avgRPE >= 7 && avgRPE <= 9) { total += 2; details.rpeQuality = true; }
  }

  // Accessory variety: 3+ distinct exercises (+2)
  const distinctAccessories = new Set(weekAccessories.map(l => resolveCanonicalId(l.exerciseId)));
  if (distinctAccessories.size >= 3) { total += 2; details.variety = true; }

  // RPE data quality: 50%+ of main sets have RPE (+1)
  if (weekEntries.length > 0 && withRPE.length / weekEntries.length >= 0.5) {
    total += 1; details.rpeLogging = true;
  }

  total = Math.min(15, total);
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
  return false;
}
