/**
 * Intelligent Plateau Breaker — diagnostic engine and mini-cycle generator.
 *
 * When a lift is plateaued (detected by detectPlateau), this system runs
 * six independent analyzers to diagnose the cause and prescribe a specific
 * intervention.  It can also generate a 3-4 week targeted mini-cycle.
 *
 * Analyzers:
 *   1. Intensity distribution — stuck in a narrow % range?
 *   2. Volume trend — flat, declining, or inadequate tonnage?
 *   3. Fatigue interference — other lifts overloading shared muscles?
 *   4. Training frequency — too few or too many sessions?
 *   5. Weak-point coverage — configured weak point undertrained?
 *   6. RPE pattern — accumulated fatigue signal (high RPE + flat e1RM)?
 */

import store from '../state/store.js';
import { MS_PER_DAY, WINDOW_4_WEEKS, WINDOW_8_WEEKS } from '../constants/time.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { detectPlateau } from '../formulas/progression.js';
import { calcFatigueByMuscle, calcFatigueDetail, calcFatigueLift } from '../systems/fatigue.js';
import { MAIN_LIFT_WEIGHTS } from '../data/muscle-groups.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { selectSmartAccessories } from '../systems/workout-builder.js';
import { roundToPlate } from '../formulas/plates.js';
import { displayWeight, formatWeight } from '../formulas/units.js';

// ---------------------------------------------------------------------------
// Intervention type definitions
// ---------------------------------------------------------------------------

export const INTERVENTION_TYPES = {
  intensity_stale: {
    id: 'intensity_stale',
    label: 'Intensity Variation Needed',
    icon: '\u2B06',
    color: 'var(--orange)',
  },
  volume_needed: {
    id: 'volume_needed',
    label: 'Volume Accumulation Needed',
    icon: '\uD83D\uDCCA',
    color: 'var(--bench)',
  },
  fatigue_interference: {
    id: 'fatigue_interference',
    label: 'Fatigue Interference',
    icon: '\u26A0',
    color: 'var(--red)',
  },
  weak_point_undertrained: {
    id: 'weak_point_undertrained',
    label: 'Weak Point Undertrained',
    icon: '\uD83C\uDFAF',
    color: 'var(--yellow)',
  },
  deload_needed: {
    id: 'deload_needed',
    label: 'Deload Recommended',
    icon: '\uD83D\uDCA4',
    color: 'var(--green)',
  },
  frequency_low: {
    id: 'frequency_low',
    label: 'Frequency Too Low',
    icon: '\uD83D\uDCC5',
    color: 'var(--text-dim)',
  },
  frequency_high: {
    id: 'frequency_high',
    label: 'Frequency Too High',
    icon: '\uD83D\uDCC5',
    color: 'var(--orange)',
  },
};

// ---------------------------------------------------------------------------
// Helper: get TM for a lift (training max or 90% of best e1RM)
// ---------------------------------------------------------------------------

function getTM(lift) {
  const tm = store.programConfig.trainingMaxes[lift];
  if (tm) return tm;
  const best = bestE1RM(lift);
  return best ? best * 0.9 : null;
}

// ---------------------------------------------------------------------------
// Analyzer 1: Intensity distribution
// ---------------------------------------------------------------------------

function analyzeIntensity(lift, entries8w) {
  const best = bestE1RM(lift);
  if (!best || entries8w.length < 3) return { score: 0, evidence: [], data: {} };

  const bins = { '50-60': 0, '60-70': 0, '70-80': 0, '80-90': 0, '90+': 0 };
  entries8w.forEach(e => {
    const pct = (e.weight / best) * 100;
    if (pct >= 90) bins['90+']++;
    else if (pct >= 80) bins['80-90']++;
    else if (pct >= 70) bins['70-80']++;
    else if (pct >= 60) bins['60-70']++;
    else bins['50-60']++;
  });

  const total = entries8w.length;
  const avgIntensity = entries8w.reduce((s, e) => s + (e.weight / best) * 100, 0) / total;

  let score = 0;
  const evidence = [];

  // Check if sets are concentrated in one band
  const maxBin = Math.max(...Object.values(bins));
  const maxBinPct = maxBin / total;
  if (maxBinPct >= 0.80) {
    score = 85;
    const dominant = Object.entries(bins).find(([, v]) => v === maxBin)[0];
    evidence.push(`${Math.round(maxBinPct * 100)}% of sets in the ${dominant}% range`);
  } else if (maxBinPct >= 0.60) {
    score = 55;
  }

  // No heavy work
  if (bins['90+'] === 0) {
    score += 15;
    const weeksWithout = countWeeksWithoutHeavy(lift, entries8w, best);
    evidence.push(`No sets above 90% in ${weeksWithout}+ weeks`);
  }

  // Stuck in "grinder zone"
  if (avgIntensity >= 73 && avgIntensity <= 82) {
    score += 10;
    evidence.push(`Average intensity: ${avgIntensity.toFixed(1)}% (moderate grind zone)`);
  }

  // Already has recent heavy work — suppress
  const now = Date.now();
  const recent2w = entries8w.filter(e => (now - e.timestamp) <= 14 * MS_PER_DAY);
  const hasRecentHeavy = recent2w.some(e => (e.weight / best) * 100 >= 90);
  if (hasRecentHeavy) score -= 40;

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    evidence,
    data: { bins, avgIntensity },
    actions: score > 40 ? [
      `Add 1-2 heavy singles at 90-95% on your next ${LIFT_NAMES[lift]} day`,
      'Include 2-3 sets of doubles at 87-92% weekly',
      'Try pin work or pause variations for supramaximal exposure',
    ] : [],
  };
}

function countWeeksWithoutHeavy(lift, entries8w, best) {
  const now = Date.now();
  for (let w = 1; w <= 8; w++) {
    const weekEntries = entries8w.filter(e =>
      (now - e.timestamp) <= w * 7 * MS_PER_DAY &&
      (now - e.timestamp) > (w - 1) * 7 * MS_PER_DAY
    );
    if (weekEntries.some(e => (e.weight / best) * 100 >= 90)) return w - 1;
  }
  return 8;
}

// ---------------------------------------------------------------------------
// Analyzer 2: Volume trend
// ---------------------------------------------------------------------------

function analyzeVolume(lift, entries8w) {
  if (entries8w.length < 4) return { score: 0, evidence: [], data: {} };

  const now = Date.now();
  const weeklyTonnage = [];
  for (let w = 0; w < 8; w++) {
    const weekEntries = entries8w.filter(e => {
      const daysAgo = (now - e.timestamp) / MS_PER_DAY;
      return daysAgo >= w * 7 && daysAgo < (w + 1) * 7;
    });
    weeklyTonnage.push(weekEntries.reduce((s, e) => s + e.weight * e.reps, 0));
  }

  // Reverse so index 0 = oldest week
  weeklyTonnage.reverse();

  // Remove trailing zero weeks (no data)
  const activeWeeks = weeklyTonnage.filter(t => t > 0);
  if (activeWeeks.length < 3) return { score: 0, evidence: [], data: { weeklyTonnage } };

  // Coefficient of variation
  const mean = activeWeeks.reduce((s, v) => s + v, 0) / activeWeeks.length;
  const variance = activeWeeks.reduce((s, v) => s + (v - mean) ** 2, 0) / activeWeeks.length;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

  let score = 0;
  const evidence = [];

  // Flat volume
  if (cv < 0.10) {
    score = 70;
    evidence.push('Volume has been nearly flat for 8 weeks');
  } else if (cv < 0.15) {
    score = 45;
    evidence.push('Volume has been steady with little variation');
  }

  // Declining trend (compare first half vs second half)
  const firstHalf = activeWeeks.slice(0, Math.ceil(activeWeeks.length / 2));
  const secondHalf = activeWeeks.slice(Math.ceil(activeWeeks.length / 2));
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
  if (avgSecond < avgFirst * 0.85) {
    score = Math.max(score, 60);
    evidence.push('Volume has been declining over recent weeks');
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    evidence,
    data: { weeklyTonnage, cv, mean },
    actions: score > 40 ? [
      `Back off to 65-70% for higher rep sets (4x8) for 3-4 weeks`,
      'Gradually increase weekly tonnage by 10-15% each week',
      `Focus on accumulating volume before pushing intensity`,
    ] : [],
  };
}

// ---------------------------------------------------------------------------
// Analyzer 3: Fatigue interference
// ---------------------------------------------------------------------------

function analyzeFatigueInterference(lift) {
  const liftFatigue = calcFatigueLift(lift);
  const muscleFatigue = calcFatigueByMuscle();
  if (!muscleFatigue) return { score: 0, evidence: [], data: {} };

  const liftMuscles = MAIN_LIFT_WEIGHTS[lift];
  let score = 0;
  const evidence = [];
  const interferingLifts = new Set();

  // Check lift-level ACWR
  if (liftFatigue) {
    if (liftFatigue.status === 'red') {
      score = 80;
      evidence.push(`${LIFT_NAMES[lift]} ACWR is in the red zone`);
    } else if (liftFatigue.status === 'yellow') {
      score = 40;
    }
  }

  // Check muscle groups relevant to this lift
  Object.entries(liftMuscles).forEach(([mg, weight]) => {
    if (weight < 0.15) return; // Skip minor contributors
    const mf = muscleFatigue[mg];
    if (!mf) return;

    if (mf.status === 'red' || mf.status === 'yellow') {
      // Check what's driving this fatigue
      const detail = calcFatigueDetail(mg);
      if (!detail) return;

      detail.contributors.forEach(c => {
        if (c.lift !== lift && c.type === 'Main' && c.load7 > 0) {
          interferingLifts.add(c.lift);
        }
      });

      if (mf.status === 'red') {
        score += 15;
        evidence.push(`${mg} is in red status (heavily fatigued)`);
      } else {
        score += 5;
      }
    }
  });

  if (interferingLifts.size > 0) {
    const names = [...interferingLifts].map(l => LIFT_NAMES[l]).join(' and ');
    evidence.push(`${names} training is loading shared muscle groups`);
  }

  score = Math.max(0, Math.min(100, score));

  const actions = score > 40 ? [] : [];
  if (score > 40 && interferingLifts.size > 0) {
    const names = [...interferingLifts].map(l => LIFT_NAMES[l]).join('/');
    actions.push(`Reduce ${names} volume by 30-40% for 2-3 weeks`);
    actions.push(`Space ${LIFT_NAMES[lift]} and ${names} sessions further apart`);
    actions.push('Focus on recovery between sessions');
  } else if (score > 40) {
    actions.push(`Reduce overall training volume for 1-2 weeks`);
    actions.push(`Prioritize ${LIFT_NAMES[lift]} in your session order`);
  }

  return {
    score,
    evidence,
    data: { liftFatigue, interferingLifts: [...interferingLifts] },
    actions,
  };
}

// ---------------------------------------------------------------------------
// Analyzer 4: Training frequency
// ---------------------------------------------------------------------------

function analyzeFrequency(lift, entries4w) {
  const trainingDays = new Set(entries4w.map(e => e.date));
  const frequency = trainingDays.size;

  let score = 0;
  let causeId = null;
  const evidence = [];

  if (frequency <= 1) {
    score = 80;
    causeId = 'frequency_low';
    evidence.push(`Only ${frequency} ${LIFT_NAMES[lift]} session in the last 4 weeks`);
  } else if (frequency <= 3) {
    score = 50;
    causeId = 'frequency_low';
    evidence.push(`Only ${frequency} ${LIFT_NAMES[lift]} sessions in 4 weeks`);
  } else if (frequency >= 9) {
    score = 60;
    causeId = 'frequency_high';
    evidence.push(`${frequency} sessions in 4 weeks may be excessive`);
  } else if (frequency >= 7) {
    score = 30;
    causeId = 'frequency_high';
    evidence.push(`${frequency} sessions in 4 weeks is on the high side`);
  }

  const actions = [];
  if (causeId === 'frequency_low' && score > 40) {
    actions.push(`Add one more ${LIFT_NAMES[lift]} session per week`);
    actions.push('Use a lighter variation day (65-75%) as the second session');
    actions.push('Even a brief session maintains the motor pattern');
  } else if (causeId === 'frequency_high' && score > 40) {
    actions.push(`Drop to 1-2 ${LIFT_NAMES[lift]} sessions per week`);
    actions.push('Use the freed recovery capacity for weak-point accessories');
  }

  return { score, causeId, evidence, data: { frequency }, actions };
}

// ---------------------------------------------------------------------------
// Analyzer 5: Weak-point coverage
// ---------------------------------------------------------------------------

function analyzeWeakPointCoverage(lift) {
  const weakPoint = store.workoutConfig.weakPoints[lift];
  if (!weakPoint) return { score: 0, evidence: [], data: {} };

  const now = Date.now();
  const recentAcc = store.accessoryLog.filter(
    a => (now - a.timestamp) <= WINDOW_4_WEEKS * MS_PER_DAY
  );

  let targetingSessions = 0;
  recentAcc.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (ex && ex.weakPoints && ex.weakPoints.includes(weakPoint)) {
      targetingSessions++;
    }
  });

  let score = 0;
  const evidence = [];

  if (targetingSessions === 0) {
    score = 85;
    evidence.push(`No accessory sessions targeting "${weakPoint}" in 4 weeks`);
  } else if (targetingSessions <= 2) {
    score = 60;
    evidence.push(`Only ${targetingSessions} sessions targeting "${weakPoint}" in 4 weeks`);
  } else if (targetingSessions <= 4) {
    score = 30;
  }

  // Find recommended exercises
  const targeting = Object.entries(ACCESSORY_DB)
    .filter(([, ex]) => ex.mainLift === lift && ex.weakPoints.includes(weakPoint))
    .map(([id, ex]) => ex.name);

  const actions = score > 40 ? [
    `Add 2-3 weekly sets targeting "${weakPoint}"`,
    `Recommended: ${targeting.slice(0, 3).join(', ')}`,
    'Maintain this for at least 4 weeks to see results',
  ] : [];

  return {
    score,
    evidence,
    data: { weakPoint, targetingSessions, targetingExercises: targeting },
    actions,
  };
}

// ---------------------------------------------------------------------------
// Analyzer 6: RPE pattern (accumulated fatigue)
// ---------------------------------------------------------------------------

function analyzeRPEPattern(lift, entries4w) {
  const withRPE = entries4w.filter(e => e.rpe != null);
  if (withRPE.length < 4) return { score: 0, evidence: [], data: {} };

  const avgRPE = withRPE.reduce((s, e) => s + e.rpe, 0) / withRPE.length;
  const rpe9PlusPct = withRPE.filter(e => e.rpe >= 9).length / withRPE.length;

  // RPE trend (simple linear regression on timestamp vs RPE)
  const sorted = [...withRPE].sort((a, b) => a.timestamp - b.timestamp);
  const n = sorted.length;
  const xMean = sorted.reduce((s, e) => s + e.timestamp, 0) / n;
  const yMean = avgRPE;
  let num = 0, den = 0;
  sorted.forEach(e => {
    num += (e.timestamp - xMean) * (e.rpe - yMean);
    den += (e.timestamp - xMean) ** 2;
  });
  const slopePerMs = den > 0 ? num / den : 0;
  const slopePerWeek = slopePerMs * (7 * MS_PER_DAY);

  let score = 0;
  const evidence = [];

  if (avgRPE >= 9.0) {
    score = 85;
    evidence.push(`Average RPE is ${avgRPE.toFixed(1)} — consistently grinding`);
  } else if (avgRPE >= 8.5 && rpe9PlusPct >= 0.40) {
    score = 70;
    evidence.push(`Average RPE ${avgRPE.toFixed(1)} with ${Math.round(rpe9PlusPct * 100)}% of sets at RPE 9+`);
  } else if (avgRPE >= 8.5) {
    score = 45;
    evidence.push(`Average RPE is elevated at ${avgRPE.toFixed(1)}`);
  }

  // Rising RPE trend = accumulating fatigue
  if (slopePerWeek > 0.3) {
    score += 20;
    evidence.push('RPE has been rising while e1RM stays flat');
  }

  // Cross-reference with global fatigue
  const globalFatigue = calcFatigueLift(lift);
  if (globalFatigue && globalFatigue.status === 'red') {
    score += 10;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    evidence,
    data: { avgRPE, rpe9PlusPct, slopePerWeek },
    actions: score > 40 ? [
      'Take a structured deload: 3x5 at 55% for one week',
      'Then ramp back up over 2 weeks (70% -> 80%)',
      'Reduce RPE targets by 0.5-1.0 for the next training block',
    ] : [],
  };
}

// ---------------------------------------------------------------------------
// Main diagnosis function
// ---------------------------------------------------------------------------

/**
 * Run all analyzers on a plateaued lift and return a ranked diagnosis.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {PlateauDiagnosis|null} Null if the lift is not plateaued
 */
export function diagnosePlateau(lift) {
  if (!detectPlateau(lift)) return null;

  const now = Date.now();
  const entries8w = store.entries.filter(
    e => e.lift === lift && (now - e.timestamp) <= WINDOW_8_WEEKS * MS_PER_DAY
  );
  const entries4w = entries8w.filter(
    e => (now - e.timestamp) <= WINDOW_4_WEEKS * MS_PER_DAY
  );

  // Get plateau context
  const recent4w = entries4w;
  const older4w = entries8w.filter(
    e => (now - e.timestamp) > WINDOW_4_WEEKS * MS_PER_DAY
  );
  const recentBest = recent4w.length > 0 ? Math.max(...recent4w.map(e => e.e1rm)) : 0;
  const olderBest = older4w.length > 0 ? Math.max(...older4w.map(e => e.e1rm)) : 0;

  // Run all analyzers
  const intensity = analyzeIntensity(lift, entries8w);
  const volume = analyzeVolume(lift, entries8w);
  const fatigue = analyzeFatigueInterference(lift);
  const freq = analyzeFrequency(lift, entries4w);
  const weakPoint = analyzeWeakPointCoverage(lift);
  const rpe = analyzeRPEPattern(lift, entries4w);

  // Build cause list
  const rawCauses = [
    { id: 'intensity_stale', ...intensity },
    { id: 'volume_needed', ...volume },
    { id: 'fatigue_interference', ...fatigue },
    { id: freq.causeId || 'frequency_low', score: freq.score, evidence: freq.evidence, actions: freq.actions, data: freq.data },
    { id: 'weak_point_undertrained', ...weakPoint },
    { id: 'deload_needed', ...rpe },
  ];

  // Cross-cutting adjustments
  const deloadScore = rpe.score;
  const fatigueScore = fatigue.score;
  if (deloadScore > 50 && fatigueScore > 50) {
    rawCauses.find(c => c.id === 'deload_needed').score += 10;
    rawCauses.find(c => c.id === 'fatigue_interference').score += 10;
  }
  if (intensity.score > 60 && volume.score > 60) {
    // Somewhat exclusive — reduce the lower one
    if (intensity.score >= volume.score) {
      rawCauses.find(c => c.id === 'volume_needed').score -= 15;
    } else {
      rawCauses.find(c => c.id === 'intensity_stale').score -= 15;
    }
  }
  if (freq.score > 40 && volume.score > 40 && freq.causeId === 'frequency_low') {
    rawCauses.find(c => c.id === freq.causeId).score += 10;
  }

  // Clamp and sort
  rawCauses.forEach(c => { c.score = Math.max(0, Math.min(100, c.score)); });
  rawCauses.sort((a, b) => b.score - a.score);

  // Filter to causes above threshold
  const causes = rawCauses
    .filter(c => c.score > 40)
    .map(c => ({
      id: c.id,
      label: INTERVENTION_TYPES[c.id] ? INTERVENTION_TYPES[c.id].label : c.id,
      score: c.score,
      evidence: c.evidence || [],
      actions: c.actions || [],
    }));

  // If no cause scored above threshold, give a generic "flat" diagnosis
  if (causes.length === 0) {
    causes.push({
      id: 'intensity_stale',
      label: INTERVENTION_TYPES.intensity_stale.label,
      score: 40,
      evidence: ['Training has been consistent but progress has stalled'],
      actions: [
        'Introduce variety: different rep ranges, tempos, or variations',
        `Try a 3-week block with ascending intensity`,
      ],
    });
  }

  const primaryCause = causes[0].id;
  const confidence = Math.min(1, causes[0].score / 100);

  return {
    lift,
    plateaued: true,
    recentBest,
    olderBest,
    delta: recentBest - olderBest,
    primaryCause,
    confidence,
    causes,
    analysisData: {
      intensityBins: intensity.data.bins || {},
      avgIntensity: intensity.data.avgIntensity || 0,
      volumeTrend: volume.data.weeklyTonnage || [],
      volumeCV: volume.data.cv || 0,
      frequency: freq.data.frequency || 0,
      avgRPE: rpe.data.avgRPE || 0,
      rpe9PlusPct: rpe.data.rpe9PlusPct || 0,
      fatigueStatus: fatigue.data.liftFatigue || null,
      interferingLifts: fatigue.data.interferingLifts || [],
      weakPoint: weakPoint.data.weakPoint || null,
      weakPointCoverage: weakPoint.data.targetingSessions || 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Mini-cycle generator
// ---------------------------------------------------------------------------

/**
 * Generate a targeted mini-cycle to break through a plateau.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @param {PlateauDiagnosis} diagnosis - Output of diagnosePlateau
 * @returns {PlateauMiniCycle|null} Null if no TM available
 */
export function generatePlateauMiniCycle(lift, diagnosis) {
  const tm = getTM(lift);
  if (!tm) return null;

  const intervention = diagnosis.primaryCause;
  const generators = {
    intensity_stale: () => generateIntensityCycle(lift, tm),
    volume_needed: () => generateVolumeCycle(lift, tm),
    fatigue_interference: () => generateFatigueCycle(lift, tm, diagnosis),
    deload_needed: () => generateDeloadCycle(lift, tm),
    frequency_low: () => generateFrequencyCycle(lift, tm),
    frequency_high: () => generateFrequencyCycle(lift, tm),
    weak_point_undertrained: () => generateWeakPointCycle(lift, tm, diagnosis),
  };

  const gen = generators[intervention] || generators.intensity_stale;
  const cycle = gen();

  return {
    lift,
    intervention,
    ...cycle,
  };
}

// --- Intensity cycle: 4wk ascending from moderate to heavy singles ---

function generateIntensityCycle(lift, tm) {
  const acc = selectSmartAccessories(lift, 2);
  return {
    durationWeeks: 4,
    summary: 'Reintroduces intensity variation with ascending heavy work over 4 weeks, building to a test single.',
    weeks: [
      makeWeek(1, 'Accumulation', lift, tm, [
        { pct: 0.70, reps: 5 }, { pct: 0.75, reps: 5 },
        { pct: 0.75, reps: 5 }, { pct: 0.80, reps: 3 },
        { pct: 0.80, reps: 3 },
      ], 7.0, acc, 'Build a base with moderate volume'),
      makeWeek(2, 'Intensification', lift, tm, [
        { pct: 0.75, reps: 3 }, { pct: 0.80, reps: 3 },
        { pct: 0.85, reps: 2 }, { pct: 0.88, reps: 1 },
      ], 8.0, acc, 'Introduce heavier doubles and singles'),
      makeWeek(3, 'Realization', lift, tm, [
        { pct: 0.80, reps: 2 }, { pct: 0.85, reps: 2 },
        { pct: 0.90, reps: 1 }, { pct: 0.93, reps: 1 },
      ], 8.5, acc, 'Push to heavy singles near your max'),
      makeWeek(4, 'Test', lift, tm, [
        { pct: 0.70, reps: 3 }, { pct: 0.80, reps: 2 },
        { pct: 0.88, reps: 1 }, { pct: 0.95, reps: 1 },
        { pct: 0.80, reps: 3 },
      ], 9.0, acc, 'Work up to a heavy single, then back off'),
    ],
  };
}

// --- Volume cycle: 4wk accumulation block ---

function generateVolumeCycle(lift, tm) {
  const acc = selectSmartAccessories(lift, 3);
  return {
    durationWeeks: 4,
    summary: 'Accumulates training volume with higher reps at moderate intensity, then transitions back to heavier work.',
    weeks: [
      makeWeek(1, 'High Volume', lift, tm, [
        { pct: 0.65, reps: 8 }, { pct: 0.65, reps: 8 },
        { pct: 0.65, reps: 8 }, { pct: 0.65, reps: 8 },
      ], 6.0, acc, 'Build work capacity with high reps'),
      makeWeek(2, 'Volume + Load', lift, tm, [
        { pct: 0.70, reps: 6 }, { pct: 0.70, reps: 6 },
        { pct: 0.70, reps: 6 }, { pct: 0.70, reps: 6 },
        { pct: 0.70, reps: 6 },
      ], 7.0, acc, 'Increase load while maintaining volume'),
      makeWeek(3, 'Transition', lift, tm, [
        { pct: 0.725, reps: 5 }, { pct: 0.725, reps: 5 },
        { pct: 0.725, reps: 5 }, { pct: 0.725, reps: 5 },
        { pct: 0.725, reps: 5 },
      ], 7.5, acc, 'Bridge to heavier training'),
      makeWeek(4, 'Realize', lift, tm, [
        { pct: 0.80, reps: 3 }, { pct: 0.80, reps: 3 },
        { pct: 0.80, reps: 3 },
      ], 7.0, acc, 'Reduced volume, heavier weights — feel the carryover'),
    ],
  };
}

// --- Fatigue management: 3wk reduce interfering volume ---

function generateFatigueCycle(lift, tm, diagnosis) {
  const acc = selectSmartAccessories(lift, 2);
  const interfering = diagnosis.analysisData.interferingLifts
    .map(l => LIFT_NAMES[l]).join('/') || 'other lifts';
  return {
    durationWeeks: 3,
    summary: `Manages fatigue by reducing ${interfering} volume while maintaining ${LIFT_NAMES[lift]} work.`,
    weeks: [
      makeWeek(1, 'Fatigue Reduction', lift, tm, [
        { pct: 0.75, reps: 3 }, { pct: 0.75, reps: 3 },
        { pct: 0.80, reps: 2 }, { pct: 0.80, reps: 2 },
      ], 7.0, acc, `Maintain ${LIFT_NAMES[lift]}. Cut ${interfering} volume by 50%`),
      makeWeek(2, 'Recovery Push', lift, tm, [
        { pct: 0.78, reps: 3 }, { pct: 0.82, reps: 2 },
        { pct: 0.85, reps: 2 }, { pct: 0.85, reps: 2 },
      ], 7.5, acc, `Slight push on ${LIFT_NAMES[lift]}. ${interfering} at 65% volume`),
      makeWeek(3, 'Normalize', lift, tm, [
        { pct: 0.80, reps: 3 }, { pct: 0.85, reps: 2 },
        { pct: 0.88, reps: 1 }, { pct: 0.88, reps: 1 },
      ], 8.0, acc, 'Return to normal across all lifts'),
    ],
  };
}

// --- Deload + rebound: 3wk recovery ---

function generateDeloadCycle(lift, tm) {
  const acc = selectSmartAccessories(lift, 1);
  return {
    durationWeeks: 3,
    summary: 'Structured deload followed by a controlled ramp-up to let accumulated fatigue dissipate.',
    weeks: [
      makeWeek(1, 'Deload', lift, tm, [
        { pct: 0.55, reps: 5 }, { pct: 0.55, reps: 5 },
        { pct: 0.55, reps: 5 },
      ], 5.0, acc, 'True deload — light and easy, focus on technique'),
      makeWeek(2, 'Re-acclimate', lift, tm, [
        { pct: 0.70, reps: 3 }, { pct: 0.70, reps: 3 },
        { pct: 0.75, reps: 3 }, { pct: 0.75, reps: 3 },
      ], 6.5, acc, 'Ramp back up gradually'),
      makeWeek(3, 'Rebound', lift, tm, [
        { pct: 0.80, reps: 3 }, { pct: 0.85, reps: 2 },
        { pct: 0.85, reps: 2 }, { pct: 0.88, reps: 1 },
        { pct: 0.80, reps: 3 },
      ], 8.0, acc, 'Push for a PR attempt — fatigue should be cleared'),
    ],
  };
}

// --- Frequency builder: 4wk add sessions ---

function generateFrequencyCycle(lift, tm) {
  const acc = selectSmartAccessories(lift, 2);
  return {
    durationWeeks: 4,
    summary: `Adds a second weekly ${LIFT_NAMES[lift]} session with a lighter variation to increase motor pattern exposure.`,
    weeks: [
      makeWeek(1, 'Add Light Day', lift, tm, [
        { pct: 0.80, reps: 3 }, { pct: 0.80, reps: 3 },
        { pct: 0.85, reps: 2 }, { pct: 0.85, reps: 2 },
      ], 7.5, acc, 'Main day as normal. Add a 2nd day at 65-70% for 3x6'),
      makeWeek(2, 'Build Pattern', lift, tm, [
        { pct: 0.80, reps: 3 }, { pct: 0.82, reps: 3 },
        { pct: 0.85, reps: 2 }, { pct: 0.87, reps: 2 },
      ], 8.0, acc, 'Slight push on main day. Light day at 70% for 3x5'),
      makeWeek(3, 'Push', lift, tm, [
        { pct: 0.82, reps: 3 }, { pct: 0.85, reps: 2 },
        { pct: 0.88, reps: 2 }, { pct: 0.90, reps: 1 },
      ], 8.5, acc, 'Main day peaks. Light day at 72% for 3x4'),
      makeWeek(4, 'Test', lift, tm, [
        { pct: 0.80, reps: 2 }, { pct: 0.85, reps: 1 },
        { pct: 0.90, reps: 1 }, { pct: 0.93, reps: 1 },
      ], 9.0, acc, 'Work to a heavy single. Light day is optional recovery'),
    ],
  };
}

// --- Weak point cycle: 4wk targeted accessories ---

function generateWeakPointCycle(lift, tm, diagnosis) {
  const weakPoint = diagnosis.analysisData.weakPoint;
  // Get accessories specifically targeting the weak point
  const allAcc = Object.entries(ACCESSORY_DB)
    .filter(([, ex]) => ex.mainLift === lift && ex.weakPoints && ex.weakPoints.includes(weakPoint))
    .slice(0, 3)
    .map(([id, ex]) => ({ id, ...ex }));

  // Fall back to smart selection if not enough targeting accessories
  const acc = allAcc.length >= 2 ? allAcc : selectSmartAccessories(lift, 3);

  return {
    durationWeeks: 4,
    summary: `Doubles accessory volume targeting "${weakPoint}" while maintaining main lift intensity.`,
    weeks: [
      makeWeek(1, 'Baseline + Accessories', lift, tm, [
        { pct: 0.75, reps: 3 }, { pct: 0.80, reps: 3 },
        { pct: 0.80, reps: 3 }, { pct: 0.82, reps: 2 },
      ], 7.5, acc, `Focus on ${weakPoint} accessories with higher volume`),
      makeWeek(2, 'Build', lift, tm, [
        { pct: 0.78, reps: 3 }, { pct: 0.82, reps: 2 },
        { pct: 0.82, reps: 2 }, { pct: 0.85, reps: 2 },
      ], 8.0, acc, 'Push accessory weights up slightly'),
      makeWeek(3, 'Intensify', lift, tm, [
        { pct: 0.80, reps: 2 }, { pct: 0.85, reps: 2 },
        { pct: 0.85, reps: 2 }, { pct: 0.88, reps: 1 },
      ], 8.0, acc, 'Heavier main work + maintained accessory volume'),
      makeWeek(4, 'Test', lift, tm, [
        { pct: 0.80, reps: 2 }, { pct: 0.85, reps: 1 },
        { pct: 0.90, reps: 1 }, { pct: 0.80, reps: 3 },
      ], 8.5, acc, 'Test if the weak point work has paid off'),
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWeek(weekNum, phase, lift, tm, sets, targetRPE, accessories, notes) {
  return {
    weekNum,
    phase,
    targetRPE,
    mainSets: sets.map(s => ({
      pct: Math.round(s.pct * 100),
      weight: roundToPlate(displayWeight(tm * s.pct)),
      reps: s.reps,
    })),
    accessories: accessories.map(a => ({
      exerciseId: a.id,
      name: a.name,
      sets: a.sets || 3,
      repRange: a.repRange || [8, 12],
    })),
    notes,
  };
}
