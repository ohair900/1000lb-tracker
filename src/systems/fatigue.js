/**
 * Fatigue and readiness system.
 *
 * Uses INOL-based EWMA ACWR (Exponentially Weighted Moving Average
 * Acute:Chronic Workload Ratio) with per-muscle-group density multipliers,
 * intensity-scaled recovery, and auto-calibrated thresholds.
 *
 * Key improvements over simple rolling-sum ACWR:
 * - EWMA decouples acute/chronic windows (fixes spurious correlation)
 * - INOL captures intensity (heavy singles register more than light volume)
 * - Session density amplifies fatigue for consecutive training days
 * - Thresholds auto-calibrate from user's training history
 */

import store from '../state/store.js';
import { MS_PER_DAY } from '../constants/time.js';
import {
  FATIGUE_THRESHOLD_HIGH as DEFAULT_THRESHOLD_HIGH,
  FATIGUE_THRESHOLD_MOD as DEFAULT_THRESHOLD_MOD,
  FATIGUE_RECOVERY_MULT,
  ECCENTRIC_RECOVERY_MULT,
} from '../constants/thresholds.js';
import { LIFT_NAMES } from '../constants/lift-config.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { resolveExercise } from '../data/exercise-compat.js';
import { EXERCISE_CATALOG } from '../data/exercise-catalog.js';
import {
  MUSCLE_GROUPS,
  MUSCLE_RECOVERY_HOURS,
  MAIN_LIFT_WEIGHTS,
  ACCESSORY_CAT_WEIGHTS,
  SYNERGIST_MAP,
  SYNERGIST_RECOVERY_PENALTY,
} from '../data/muscle-groups.js';
import { calcINOL, calcAccessoryINOL } from '../formulas/inol.js';

// Variable accessory INOL discount by exercise type (#7)
// Close-variations are nearly as fatiguing as main lifts; isolation is mostly local
const ACC_INOL_DISCOUNT = {
  'close-variation': 0.80,
  compound:          0.55,
  isolation:         0.30,
  bodyweight:        0.35,
  time:              0.20,
};
const DEFAULT_ACC_DISCOUNT = 0.5;

function getAccDiscount(exerciseId) {
  const catalogEx = resolveExercise(exerciseId);
  if (catalogEx && catalogEx.progressionType) {
    return ACC_INOL_DISCOUNT[catalogEx.progressionType] || DEFAULT_ACC_DISCOUNT;
  }
  return DEFAULT_ACC_DISCOUNT;
}

// Eccentric load recovery multiplier (#10)
// Looks at recent accessory exercises for a muscle group and returns
// the worst-case eccentric multiplier from the last session's exercises.
function getEccentricMult(accEntries7, mg) {
  let worst = 'moderate'; // default
  for (const a of accEntries7) {
    const catalogEx = resolveExercise(a.exerciseId);
    if (!catalogEx) continue;
    const cw = catalogEx.primaryMuscles;
    if (!cw || !cw[mg] || cw[mg] < 0.15) continue;
    const ecc = catalogEx.eccentricLoad || 'moderate';
    if (ecc === 'high') { worst = 'high'; break; } // can't get worse
    if (ecc === 'low' && worst === 'moderate') worst = 'low';
  }
  return ECCENTRIC_RECOVERY_MULT[worst] || 1.0;
}
import { getCalibratedRecovery } from '../systems/recovery-calibration.js';

// ---------------------------------------------------------------------------
// EWMA constants
// ---------------------------------------------------------------------------

const LAMBDA_ACUTE = 2 / (7 + 1);    // 0.25 — 7-day equivalent
const LAMBDA_CHRONIC = 2 / (28 + 1); // ~0.069 — 28-day equivalent
const EWMA_WINDOW_DAYS = 42;         // Lookback for EWMA initialization

// ---------------------------------------------------------------------------
// Auto-calibrated thresholds (computed on first use, cached)
// ---------------------------------------------------------------------------

let _calibratedThresholds = null;
let _calibrationTimestamp = 0;

function getThresholds() {
  // Recalibrate at most once per session (or if entries changed significantly)
  const now = Date.now();
  if (_calibratedThresholds && (now - _calibrationTimestamp) < 60000) {
    return _calibratedThresholds;
  }

  const entries = store.entries;
  if (!entries || entries.length < 10) {
    _calibratedThresholds = { high: DEFAULT_THRESHOLD_HIGH, mod: DEFAULT_THRESHOLD_MOD };
    _calibrationTimestamp = now;
    return _calibratedThresholds;
  }

  // Build daily loads for user's full history and compute rolling EWMA ACWR
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const firstDay = new Date(sorted[0].date);
  const today = new Date();
  const totalDays = Math.ceil((today - firstDay) / MS_PER_DAY) + 1;

  if (totalDays < 28) {
    _calibratedThresholds = { high: DEFAULT_THRESHOLD_HIGH, mod: DEFAULT_THRESHOLD_MOD };
    _calibrationTimestamp = now;
    return _calibratedThresholds;
  }

  // Build daily load array
  const dailyLoads = new Array(totalDays).fill(0);
  sorted.forEach(e => {
    const dayIdx = Math.floor((new Date(e.date) - firstDay) / MS_PER_DAY);
    if (dayIdx >= 0 && dayIdx < totalDays) {
      dailyLoads[dayIdx] += calcINOL(e.weight, e.reps, e.e1rm);
    }
  });

  // Run EWMA and collect ACWR values
  const acwrValues = [];
  let acuteEWMA = 0, chronicEWMA = 0;
  let seeded = false;

  for (let i = 0; i < totalDays; i++) {
    const load = dailyLoads[i];
    if (!seeded && load > 0) {
      acuteEWMA = load;
      chronicEWMA = load;
      seeded = true;
      continue;
    }
    if (!seeded) continue;

    acuteEWMA = LAMBDA_ACUTE * load + (1 - LAMBDA_ACUTE) * acuteEWMA;
    chronicEWMA = LAMBDA_CHRONIC * load + (1 - LAMBDA_CHRONIC) * chronicEWMA;

    if (chronicEWMA > 0.001 && i > 14) {
      acwrValues.push(acuteEWMA / chronicEWMA);
    }
  }

  if (acwrValues.length < 7) {
    _calibratedThresholds = { high: DEFAULT_THRESHOLD_HIGH, mod: DEFAULT_THRESHOLD_MOD };
    _calibrationTimestamp = now;
    return _calibratedThresholds;
  }

  // Percentile-based thresholds
  acwrValues.sort((a, b) => a - b);
  const p75 = acwrValues[Math.floor(acwrValues.length * 0.75)];
  const p90 = acwrValues[Math.floor(acwrValues.length * 0.90)];

  _calibratedThresholds = {
    high: Math.max(1.4, p90),
    mod: Math.max(1.1, p75),
  };
  _calibrationTimestamp = now;
  return _calibratedThresholds;
}

/** Force threshold recalibration (e.g. after data import) */
export function invalidateThresholds() {
  _calibratedThresholds = null;
  _calibrationTimestamp = 0;
}

// ---------------------------------------------------------------------------
// Session density helpers
// ---------------------------------------------------------------------------

function getMuscleSessionDays(mainEntries, accEntries, mg) {
  const timestamps = [];
  mainEntries.forEach(e => {
    const w = MAIN_LIFT_WEIGHTS[e.lift];
    if (w && w[mg]) timestamps.push(e.timestamp);
  });
  accEntries.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    if (cw && cw[mg]) timestamps.push(a.timestamp);
  });
  return timestamps;
}

function calcMuscleDensity(mainEntries, accEntries, mg) {
  const trainingDays = new Set();
  mainEntries.forEach(e => {
    const w = MAIN_LIFT_WEIGHTS[e.lift];
    if (w && w[mg]) trainingDays.add(e.date);
  });
  accEntries.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    if (cw && cw[mg]) trainingDays.add(a.date);
  });

  if (trainingDays.size <= 1) return 1.0;

  const sorted = [...trainingDays].sort();
  let maxStreak = 1, streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays = Math.round((curr - prev) / MS_PER_DAY);
    if (diffDays === 1) {
      streak++;
      if (streak > maxStreak) maxStreak = streak;
    } else {
      streak = 1;
    }
  }

  if (maxStreak >= 4) return 1.4;
  if (maxStreak === 3) return 1.25;
  if (maxStreak === 2) return 1.1;
  return 1.0;
}

// ---------------------------------------------------------------------------
// EWMA computation helpers
// ---------------------------------------------------------------------------

/**
 * Build an array of daily INOL loads for the past `dayCount` days.
 * If muscleGroup is provided, loads are weighted by muscle contribution.
 */
function buildDailyLoads(mainEntries, accEntries, muscleGroup, dayCount) {
  const now = Date.now();
  const loads = new Array(dayCount).fill(0);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  mainEntries.forEach(e => {
    const entryDate = new Date(e.date);
    entryDate.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((todayStart - entryDate) / MS_PER_DAY);
    if (daysAgo < 0 || daysAgo >= dayCount) return;
    const idx = dayCount - 1 - daysAgo; // chronological: 0 = oldest
    if (muscleGroup) {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      if (!w || !w[muscleGroup]) return;
      loads[idx] += calcINOL(e.weight, e.reps, e.e1rm) * w[muscleGroup];
    } else {
      loads[idx] += calcINOL(e.weight, e.reps, e.e1rm);
    }
  });

  accEntries.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return;
    const entryDate = new Date(a.date);
    entryDate.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((todayStart - entryDate) / MS_PER_DAY);
    if (daysAgo < 0 || daysAgo >= dayCount) return;
    const idx = dayCount - 1 - daysAgo;
    const discount = getAccDiscount(a.exerciseId);

    if (muscleGroup) {
      const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
      if (!cw || !cw[muscleGroup]) return;
      const sets = a.setsCompleted || [];
      const accLoad = sets.reduce((s, reps, i) => {
        const w = (a.setWeights && a.setWeights[i]) || a.weight || 0;
        return s + calcAccessoryINOL(w, reps, ex.pctOfTM);
      }, 0) * cw[muscleGroup] * discount;
      loads[idx] += accLoad;
    } else {
      const sets = a.setsCompleted || [];
      loads[idx] += sets.reduce((s, reps, i) => {
        const w = (a.setWeights && a.setWeights[i]) || a.weight || 0;
        return s + calcAccessoryINOL(w, reps, ex.pctOfTM);
      }, 0) * discount;
    }
  });

  return loads;
}

/**
 * Compute EWMA from a daily loads array (chronological order).
 * Returns { acute, chronic, seeded, ramping }.
 *
 * Detects extended breaks (>14 days with zero load) and re-seeds the EWMA
 * at the gap boundary to prevent false ACWR spikes on return (#4).
 * Gaps >42 days trigger a full reset with a 2-week ramp-in flag.
 */
function computeEWMA(dailyLoads) {
  let acute = 0, chronic = 0;
  let seeded = false;
  let lastLoadDay = -1;
  let ramping = false; // true during 2-week ramp-in after long break

  for (let i = 0; i < dailyLoads.length; i++) {
    const load = dailyLoads[i];
    if (!seeded && load > 0) {
      acute = load;
      chronic = load;
      seeded = true;
      lastLoadDay = i;
      continue;
    }
    if (!seeded) continue;

    // Detect extended break: gap > 14 days between non-zero loads (#4)
    if (load > 0 && lastLoadDay >= 0) {
      const gapDays = i - lastLoadDay;
      if (gapDays > 42) {
        // Full reset after 6+ week break — re-seed at this load
        acute = load;
        chronic = load;
        ramping = true; // flag: ACWR unreliable for ~14 days
        lastLoadDay = i;
        continue;
      } else if (gapDays > 14) {
        // Partial re-seed: decay chronic through the gap, re-seed acute
        const decayFactor = Math.pow(1 - LAMBDA_CHRONIC, gapDays);
        chronic = chronic * decayFactor;
        acute = load;
        lastLoadDay = i;
        continue;
      }
    }
    if (load > 0) lastLoadDay = i;

    acute = LAMBDA_ACUTE * load + (1 - LAMBDA_ACUTE) * acute;
    chronic = LAMBDA_CHRONIC * load + (1 - LAMBDA_CHRONIC) * chronic;
  }

  // If ramping, check if we have 14+ days of data after the reset
  if (ramping && lastLoadDay >= 0) {
    const daysSinceReset = dailyLoads.length - 1 - lastLoadDay;
    if (daysSinceReset >= 14) ramping = false;
  }

  return { acute, chronic, seeded, ramping };
}

/**
 * Compute ACWR from EWMA values with status classification.
 */
function classifyACWR(acuteEWMA, chronicEWMA, densityMult) {
  const thresholds = getThresholds();
  // Load floor: don't flag muscles with trivial absolute loads
  if (chronicEWMA < 0.15) {
    const acwr = chronicEWMA > 0.001 ? (acuteEWMA * densityMult) / chronicEWMA : null;
    return { acwr, status: 'green', label: 'Low' };
  }
  const acwr = (acuteEWMA * densityMult) / chronicEWMA;
  let status = 'green', label = 'Low';
  if (acwr > thresholds.high) { status = 'red'; label = 'High'; }
  else if (acwr > thresholds.mod) { status = 'yellow'; label = 'Med'; }
  return { acwr, status, label };
}

// ---------------------------------------------------------------------------
// INOL load helpers
// ---------------------------------------------------------------------------

function mainEntryLoad(e, mg) {
  const w = MAIN_LIFT_WEIGHTS[e.lift];
  if (!w || !w[mg]) return 0;
  return calcINOL(e.weight, e.reps, e.e1rm) * w[mg];
}

function mainEntryLoadRaw(e) {
  return calcINOL(e.weight, e.reps, e.e1rm);
}

/**
 * Calculate weighted accessory INOL load for a muscle group.
 */
export function calcAccessoryLoad(accEntries, muscleGroup) {
  let load = 0;
  accEntries.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    if (!cw || !cw[muscleGroup]) return;
    const discount = getAccDiscount(a.exerciseId);
    const sets = a.setsCompleted || [];
    load += sets.reduce((s, reps, i) => {
      const w = (a.setWeights && a.setWeights[i]) || a.weight || 0;
      return s + calcAccessoryINOL(w, reps, ex.pctOfTM);
    }, 0) * cw[muscleGroup] * discount;
  });
  return load;
}

export function countAccessoryEntries(accEntries, muscleGroup) {
  return accEntries.filter(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return false;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    return cw && cw[muscleGroup];
  }).length;
}

// ---------------------------------------------------------------------------
// Global fatigue
// ---------------------------------------------------------------------------

/**
 * Calculate overall fatigue using EWMA INOL-based ACWR and average RPE.
 */
export function calcFatigue() {
  const now = Date.now();
  const day = MS_PER_DAY;
  const e28 = store.entries.filter(e => (now - e.timestamp) <= 28 * day);
  if (e28.length < 3) return null;

  // RPE
  const e7 = store.entries.filter(e => (now - e.timestamp) <= 7 * day);
  const rpe7  = e7.filter(e => e.rpe != null);
  const rpe28 = e28.filter(e => e.rpe != null);
  const avgRPE7  = rpe7.length > 0  ? rpe7.reduce((s, e) => s + e.rpe, 0) / rpe7.length   : null;
  const avgRPE28 = rpe28.length > 0 ? rpe28.reduce((s, e) => s + e.rpe, 0) / rpe28.length : null;

  // EWMA ACWR
  const allMain = store.entries.filter(e => (now - e.timestamp) <= EWMA_WINDOW_DAYS * day);
  const allAcc = store.accessoryLog.filter(a => (now - a.timestamp) <= EWMA_WINDOW_DAYS * day);
  const dailyLoads = buildDailyLoads(allMain, allAcc, null, EWMA_WINDOW_DAYS);
  const { acute, chronic, seeded, ramping } = computeEWMA(dailyLoads);

  if (!seeded) return null;

  const thresholds = getThresholds();
  const acwr = chronic > 0.001 ? acute / chronic : null;
  let status = 'green', label = 'Recovery: Good';
  if (ramping) {
    // During ramp-in after break, suppress ACWR warnings (#4)
    label = 'Returning to training';
  } else if (acwr !== null) {
    if (acwr > thresholds.high) { status = 'red'; label = 'High fatigue'; }
    else if (acwr > thresholds.mod) { status = 'yellow'; label = 'Moderate load'; }
  }

  return { acwr, avgRPE7, avgRPE28, status, label };
}

// ---------------------------------------------------------------------------
// Per-muscle fatigue
// ---------------------------------------------------------------------------

/**
 * Calculate EWMA ACWR for each muscle group with density multiplier.
 */
export function calcFatigueByMuscle() {
  const now = Date.now();
  const day = MS_PER_DAY;
  const results = {};
  let anyValid = false;

  const allMain = store.entries.filter(e => (now - e.timestamp) <= EWMA_WINDOW_DAYS * day);
  const allAcc = store.accessoryLog.filter(a => (now - a.timestamp) <= EWMA_WINDOW_DAYS * day);
  const main7 = allMain.filter(e => (now - e.timestamp) <= 7 * day);
  const acc7 = allAcc.filter(a => (now - a.timestamp) <= 7 * day);

  // Check minimum data (need entries in 28-day window)
  const main28 = allMain.filter(e => (now - e.timestamp) <= 28 * day);
  const acc28 = allAcc.filter(a => (now - a.timestamp) <= 28 * day);

  // Pass 1: compute ACWR status for each muscle group
  const acwrData = {};
  MUSCLE_GROUPS.forEach(mg => {
    let count28 = 0;
    let lastTs = 0;
    main28.forEach(e => {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      if (w && w[mg]) { count28++; if (e.timestamp > lastTs) lastTs = e.timestamp; }
    });
    acc28.forEach(a => {
      const ex = ACCESSORY_DB[a.exerciseId];
      const cw = ex ? ACCESSORY_CAT_WEIGHTS[ex.category] : null;
      if (cw && cw[mg]) { if (a.timestamp > lastTs) lastTs = a.timestamp; }
    });
    count28 += countAccessoryEntries(acc28, mg);

    if (count28 < 3) { results[mg] = null; return; }

    const dailyLoads = buildDailyLoads(allMain, allAcc, mg, EWMA_WINDOW_DAYS);
    const { acute, chronic, seeded, ramping } = computeEWMA(dailyLoads);
    if (!seeded) { results[mg] = null; return; }

    // During ramp-in after extended break, ACWR is unreliable (#4)
    if (ramping) {
      results[mg] = { acwr: null, status: 'green', label: 'Ramping', displayStatus: 'green', displayLabel: '\u2014', recoveryPct: null, hoursSince: null };
      anyValid = true;
      return;
    }

    let maxWeight = 0;
    main7.forEach(e => {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      if (w && w[mg] > maxWeight) maxWeight = w[mg];
    });
    const isDirect = maxWeight >= 0.25;
    const rawDensity = calcMuscleDensity(main7, acc7, mg);
    const density = isDirect ? rawDensity : 1.0 + (rawDensity - 1.0) * 0.3;
    const { acwr, status, label } = classifyACWR(acute, chronic, density);

    acwrData[mg] = { acwr, status, label, lastTs, chronic };
  });

  // Pass 2: compute recovery with synergist cross-recovery penalties (#3)
  MUSCLE_GROUPS.forEach(mg => {
    if (!acwrData[mg]) return; // already set to null in pass 1
    const { acwr, status, label, lastTs, chronic } = acwrData[mg];

    const hoursSince = lastTs > 0 ? (now - lastTs) / (1000 * 60 * 60) : null;
    const baseHours = getCalibratedRecovery(mg);

    // Intensity multiplier
    const intensityEntries = main7.filter(e => {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      return w && w[mg] && e.e1rm > 0;
    });
    let intensityMult = 1.0;
    if (intensityEntries.length > 0) {
      const avgIntensity = intensityEntries.reduce((s, e) => s + e.weight / e.e1rm, 0) / intensityEntries.length;
      if (avgIntensity > 0.85) intensityMult = 1.3;
      else if (avgIntensity >= 0.70) intensityMult = 1.1;
      else intensityMult = 0.85;
    }

    // ACWR multiplier
    const acwrMult = status === 'red'
      ? FATIGUE_RECOVERY_MULT.high
      : status === 'yellow'
        ? FATIGUE_RECOVERY_MULT.mod
        : FATIGUE_RECOVERY_MULT.low;

    // Density penalty
    let densityPenalty = 0;
    const mgSessions = getMuscleSessionDays(main28, acc28, mg);
    if (mgSessions.length >= 3) {
      const sortedSessions = mgSessions.sort((a, b) => b - a);
      const gap01 = (sortedSessions[0] - sortedSessions[1]) / (1000 * 60 * 60);
      const gap12 = (sortedSessions[1] - sortedSessions[2]) / (1000 * 60 * 60);
      if (gap01 < 24 && gap12 < 24) densityPenalty = 18;
      else if (gap01 < 24) densityPenalty = 12;
    } else if (mgSessions.length >= 2) {
      const sortedSessions = mgSessions.sort((a, b) => b - a);
      if ((sortedSessions[0] - sortedSessions[1]) / (1000 * 60 * 60) < 24) densityPenalty = 12;
    }

    // Spike detection
    const load7 = buildDailyLoads(main7, acc7, mg, 7).reduce((s, v) => s + v, 0);
    const spikeMult = (chronic > 0 && load7 > 1.5 * chronic) ? 12 : 0;

    // Synergist cross-recovery penalty (#3)
    let synergistMult = 1.0;
    for (const [sourceMg, targets] of Object.entries(SYNERGIST_MAP)) {
      if (targets.includes(mg) && acwrData[sourceMg]) {
        const sourceStatus = acwrData[sourceMg].status;
        if (sourceStatus === 'red') synergistMult += SYNERGIST_RECOVERY_PENALTY;
        else if (sourceStatus === 'yellow') synergistMult += SYNERGIST_RECOVERY_PENALTY * 0.5;
      }
    }

    // Eccentric load multiplier (#10)
    const eccentricMult = getEccentricMult(acc7, mg);

    const adjustedHours = baseHours * intensityMult * acwrMult * synergistMult * eccentricMult + spikeMult + densityPenalty;
    const recoveryPct = hoursSince !== null
      ? Math.min(1, Math.max(0, hoursSince / adjustedHours))
      : null;

    // Combined display status (ACWR + recovery) — 5-tier color ramp
    let displayStatus;
    if (status === 'red') {
      displayStatus = 'red';
    } else if (status === 'yellow' && recoveryPct !== null && recoveryPct < 0.15) {
      displayStatus = 'red';
    } else if (recoveryPct !== null && recoveryPct < 0.15) {
      displayStatus = 'red';
    } else if (status === 'yellow' && recoveryPct !== null && recoveryPct < 0.4) {
      displayStatus = 'orange';
    } else if (recoveryPct !== null && recoveryPct < 0.4) {
      displayStatus = 'orange';
    } else if (recoveryPct !== null && recoveryPct < 0.7) {
      displayStatus = 'yellow';
    } else if (recoveryPct !== null && recoveryPct < 0.9) {
      displayStatus = 'lime';
    } else {
      displayStatus = 'green';
    }

    const displayLabel = recoveryPct !== null ? Math.round(recoveryPct * 100) + '%' : '\u2014';

    results[mg] = { acwr, status, label, displayStatus, displayLabel, recoveryPct, hoursSince };
    anyValid = true;
  });

  return anyValid ? results : null;
}

// ---------------------------------------------------------------------------
// Detailed fatigue for a single muscle group
// ---------------------------------------------------------------------------

export function calcFatigueDetail(mg) {
  const now = Date.now();
  const day = MS_PER_DAY;
  const allMain = store.entries.filter(e => (now - e.timestamp) <= EWMA_WINDOW_DAYS * day);
  const allAcc = store.accessoryLog.filter(a => (now - a.timestamp) <= EWMA_WINDOW_DAYS * day);
  const main7 = allMain.filter(e => (now - e.timestamp) <= 7 * day);
  const main28 = allMain.filter(e => (now - e.timestamp) <= 28 * day);
  const acc7 = allAcc.filter(a => (now - a.timestamp) <= 7 * day);
  const acc28 = allAcc.filter(a => (now - a.timestamp) <= 28 * day);

  // Count data points
  let count28 = 0;
  main28.forEach(e => {
    const w = MAIN_LIFT_WEIGHTS[e.lift];
    if (w && w[mg]) count28++;
  });
  count28 += countAccessoryEntries(acc28, mg);
  if (count28 < 3) return null;

  // EWMA ACWR
  const dailyLoads = buildDailyLoads(allMain, allAcc, mg, EWMA_WINDOW_DAYS);
  const { acute, chronic, seeded } = computeEWMA(dailyLoads);
  if (!seeded) return null;

  const detailDensity = calcMuscleDensity(main7, acc7, mg);
  const { acwr, status, label } = classifyACWR(acute, chronic, detailDensity);

  // Compute load7 and weeklyAvg for display
  let load7 = 0;
  main7.forEach(e => { load7 += mainEntryLoad(e, mg); });
  load7 += calcAccessoryLoad(acc7, mg);
  const weeklyAvg28 = chronic; // chronic EWMA represents the weekly average baseline

  // Contributors (7-day)
  const contribMap = {};
  function addContrib(key, name, type, lift, muscleWeight, load, sets, timestamp) {
    if (!contribMap[key]) { contribMap[key] = { name, type, lift, muscleWeight, load7: 0, sets: 0, lastTs: 0 }; }
    contribMap[key].load7 += load;
    contribMap[key].sets += sets;
    if (timestamp > contribMap[key].lastTs) contribMap[key].lastTs = timestamp;
  }

  main7.forEach(e => {
    const w = MAIN_LIFT_WEIGHTS[e.lift];
    if (!w || !w[mg]) return;
    const l = calcINOL(e.weight, e.reps, e.e1rm) * w[mg];
    addContrib('main-' + e.lift, LIFT_NAMES[e.lift], 'Main', e.lift, w[mg], l, 1, e.timestamp);
  });
  acc7.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    const catalogEx = !ex ? resolveExercise(a.exerciseId) : null;
    if (!ex && !catalogEx) return;
    const category = ex ? ex.category : (catalogEx.movementPattern || null);
    const cw = ex ? ACCESSORY_CAT_WEIGHTS[ex.category] : (catalogEx ? catalogEx.primaryMuscles : null);
    if (!cw || !cw[mg]) return;
    const sets = a.setsCompleted || [];
    const pctOfTM = ex ? ex.pctOfTM : 0;
    const accDiscount = getAccDiscount(a.exerciseId);
    const accLoad = sets.reduce((s, reps, i) => {
      const w = (a.setWeights && a.setWeights[i]) || a.weight || 0;
      return s + calcAccessoryINOL(w, reps, pctOfTM);
    }, 0) * cw[mg] * accDiscount;
    const name = ex ? ex.name : catalogEx.name;
    const lift = ex ? ex.mainLift : (catalogEx.supportsLifts ? catalogEx.supportsLifts[0] : null);
    addContrib('acc-' + a.exerciseId, name, 'Acc', lift, cw[mg], accLoad, sets.length, a.timestamp);
  });
  const contribArr = Object.values(contribMap)
    .filter(c => c.load7 > 0)
    .sort((a, b) => b.load7 - a.load7);

  // Weekly trend (4 one-week buckets)
  const weeklyTrend = [0, 0, 0, 0];
  const allItems28 = [
    ...main28.map(e => ({ ts: e.timestamp, load: mainEntryLoad(e, mg) })),
    ...acc28.map(a => {
      const ex = ACCESSORY_DB[a.exerciseId];
      const cw = ex ? ACCESSORY_CAT_WEIGHTS[ex.category] : null;
      const mw = cw ? (cw[mg] || 0) : 0;
      const sets = a.setsCompleted || [];
      const disc = getAccDiscount(a.exerciseId);
      return {
        ts: a.timestamp,
        load: sets.reduce((s, r, i) => {
          const w = (a.setWeights && a.setWeights[i]) || a.weight || 0;
          return s + calcAccessoryINOL(w, r, ex ? ex.pctOfTM : 0);
        }, 0) * mw * disc,
      };
    }),
  ];
  allItems28.forEach(item => {
    const daysAgo = (now - item.ts) / day;
    const bucket = Math.min(3, Math.floor(daysAgo / 7));
    weeklyTrend[3 - bucket] += item.load;
  });

  // Last session
  let lastTs = 0;
  main28.forEach(e => {
    const w = MAIN_LIFT_WEIGHTS[e.lift];
    if (w && w[mg] && e.timestamp > lastTs) lastTs = e.timestamp;
  });
  acc28.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    const cw = ex ? ACCESSORY_CAT_WEIGHTS[ex.category] : null;
    if (cw && cw[mg] && a.timestamp > lastTs) lastTs = a.timestamp;
  });
  const hoursSince = lastTs > 0 ? (now - lastTs) / (1000 * 60 * 60) : null;

  // Recovery estimate — intensity-scaled, self-calibrated
  const baseHours = getCalibratedRecovery(mg);

  const intensityEntries = main7.filter(e => {
    const w = MAIN_LIFT_WEIGHTS[e.lift];
    return w && w[mg] && e.e1rm > 0;
  });
  let intensityMult = 1.0;
  if (intensityEntries.length > 0) {
    const avgIntensity = intensityEntries.reduce((s, e) => s + e.weight / e.e1rm, 0) / intensityEntries.length;
    if (avgIntensity > 0.85) intensityMult = 1.3;
    else if (avgIntensity >= 0.70) intensityMult = 1.1;
    else intensityMult = 0.85;
  }

  // Inter-session rest penalty
  let densityPenalty = 0;
  const mgSessions = getMuscleSessionDays(main28, acc28, mg);
  if (mgSessions.length >= 3) {
    const sorted = mgSessions.sort((a, b) => b - a);
    const gap01 = (sorted[0] - sorted[1]) / (1000 * 60 * 60);
    const gap12 = (sorted[1] - sorted[2]) / (1000 * 60 * 60);
    if (gap01 < 24 && gap12 < 24) densityPenalty = 18;
    else if (gap01 < 24) densityPenalty = 12;
  } else if (mgSessions.length >= 2) {
    const sorted = mgSessions.sort((a, b) => b - a);
    if ((sorted[0] - sorted[1]) / (1000 * 60 * 60) < 24) densityPenalty = 12;
  }

  const acwrMult = status === 'red'
    ? FATIGUE_RECOVERY_MULT.high
    : status === 'yellow'
      ? FATIGUE_RECOVERY_MULT.mod
      : FATIGUE_RECOVERY_MULT.low;
  const spikeMult = (weeklyAvg28 > 0 && load7 > 1.5 * weeklyAvg28) ? 12 : 0;
  const eccentricMult = getEccentricMult(acc7, mg);
  const adjustedHours = baseHours * intensityMult * acwrMult * eccentricMult + spikeMult + densityPenalty;
  const percentRecovered = hoursSince !== null
    ? Math.min(1, Math.max(0, hoursSince / adjustedHours))
    : null;

  let readyLabel = 'N/A';
  if (percentRecovered !== null) {
    if (percentRecovered >= 1) {
      readyLabel = 'Ready now';
    } else {
      const hrs = Math.round(adjustedHours - hoursSince);
      if (hrs <= 0) readyLabel = 'Ready now';
      else if (hrs > 24) readyLabel = hrs < 48 ? 'Tomorrow' : `~${Math.round(hrs / 24)}d`;
      else readyLabel = `~${hrs}h`;
    }
  }

  return {
    acwr, status, label, load7, weeklyAvg28, count28, weeklyTrend,
    contributors: contribArr,
    lastSession: lastTs > 0 ? lastTs : null,
    hoursSince,
    recoveryEstimate: {
      baseHours,
      adjustedHours,
      hoursRemaining: Math.max(0, adjustedHours - (hoursSince || 0)),
      percentRecovered,
      readyLabel,
    },
  };
}

// ---------------------------------------------------------------------------
// Recovery advice
// ---------------------------------------------------------------------------

export function getRecoveryAdvice(detail) {
  const { status, recoveryEstimate: r } = detail;
  if (r.percentRecovered === null) return 'Not enough data to estimate recovery.';
  const hrs = Math.round(r.hoursRemaining);
  const timeStr = hrs <= 0
    ? ''
    : hrs > 24
      ? (hrs < 48 ? 'tomorrow' : `in ~${Math.round(hrs / 24)}d`)
      : `in ~${hrs}h`;
  if (r.percentRecovered >= 1 && status === 'green') return 'Fully recovered. Safe to increase volume.';
  if (r.percentRecovered >= 1 && status === 'yellow') return 'Recovered, but load is building. Maintain volume.';
  if (r.percentRecovered >= 1 && status === 'red') return 'Consider deloading. ACWR is high despite recovery.';
  if (r.percentRecovered >= 0.7) return `Light work OK. Full recovery ${timeStr}.`;
  if (status === 'red') return 'Rest recommended. High fatigue + incomplete recovery.';
  return `Recovering. Ready ${timeStr}.`;
}

// ---------------------------------------------------------------------------
// Per-lift fatigue (EWMA-based)
// ---------------------------------------------------------------------------

export function calcFatigueLift(lift) {
  const now = Date.now();
  const day = MS_PER_DAY;
  const liftEntries = store.entries.filter(e => e.lift === lift && (now - e.timestamp) <= EWMA_WINDOW_DAYS * day);
  const e28 = liftEntries.filter(e => (now - e.timestamp) <= 28 * day);
  if (e28.length < 2) return null;

  // Build daily loads for just this lift
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const loads = new Array(EWMA_WINDOW_DAYS).fill(0);
  liftEntries.forEach(e => {
    const entryDate = new Date(e.date);
    entryDate.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((todayStart - entryDate) / MS_PER_DAY);
    if (daysAgo >= 0 && daysAgo < EWMA_WINDOW_DAYS) {
      loads[EWMA_WINDOW_DAYS - 1 - daysAgo] += mainEntryLoadRaw(e);
    }
  });

  const { acute, chronic, seeded, ramping } = computeEWMA(loads);
  if (!seeded) return null;

  // During ramp-in after extended break, suppress warnings (#4)
  if (ramping) return { acwr: null, status: 'green' };

  const thresholds = getThresholds();
  const acwr = chronic > 0.001 ? acute / chronic : null;
  let status = 'green';
  if (acwr !== null) {
    if (acwr > thresholds.high) status = 'red';
    else if (acwr > thresholds.mod) status = 'yellow';
  }
  return { acwr, status };
}

// ---------------------------------------------------------------------------
// Legacy aliases
// ---------------------------------------------------------------------------

/** @deprecated Use calcAccessoryLoad instead */
export const calcAccessoryTonnage = calcAccessoryLoad;
