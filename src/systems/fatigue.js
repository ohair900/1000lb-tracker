/**
 * Fatigue and readiness system.
 *
 * Uses Acute:Chronic Workload Ratio (ACWR) to estimate fatigue at
 * the global, per-muscle-group, and per-lift levels.
 *
 * - calcFatigue()                              — overall ACWR
 * - calcFatigueByMuscle()                      — per-muscle ACWR summary
 * - calcFatigueDetail(muscleGroup)             — detailed fatigue for one muscle
 * - getRecoveryAdvice(detail)                  — recovery text recommendation
 * - calcFatigueLift(lift)                      — per-lift ACWR
 * - calcAccessoryTonnage(accEntries, mg)       — accessory tonnage contribution
 * - countAccessoryEntries(accEntries, mg)      — count of accessory entries for a muscle
 */

import store from '../state/store.js';
import { MS_PER_DAY } from '../constants/time.js';
import {
  FATIGUE_THRESHOLD_HIGH,
  FATIGUE_THRESHOLD_MOD,
  FATIGUE_RECOVERY_MULT,
} from '../constants/thresholds.js';
import { LIFT_NAMES } from '../constants/lift-config.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import {
  MUSCLE_GROUPS,
  MUSCLE_RECOVERY_HOURS,
  MAIN_LIFT_WEIGHTS,
  ACCESSORY_CAT_WEIGHTS,
} from '../data/muscle-groups.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate weighted accessory tonnage for a muscle group within an array
 * of accessory log entries.  Accessories contribute at a 0.5 multiplier
 * relative to main lifts.
 *
 * @param {Object[]} accEntries - Accessory log entries (pre-filtered by time)
 * @param {string}   muscleGroup - 'Quads' | 'Hams' | 'Back' | 'Chest'
 * @returns {number} Weighted tonnage
 */
export function calcAccessoryTonnage(accEntries, muscleGroup) {
  let tonnage = 0;
  accEntries.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    if (!cw || !cw[muscleGroup]) return;
    const sets = a.setsCompleted || [];
    tonnage += sets.reduce((s, reps, i) =>
      s + ((a.setWeights && a.setWeights[i]) || a.weight || 0) * reps, 0
    ) * cw[muscleGroup] * 0.5;
  });
  return tonnage;
}

/**
 * Count accessory entries that contribute to a given muscle group.
 *
 * @param {Object[]} accEntries - Accessory log entries (pre-filtered by time)
 * @param {string}   muscleGroup
 * @returns {number}
 */
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
 * Calculate overall fatigue using ACWR (tonnage) and average RPE.
 *
 * @returns {{ acwr: number|null, avgRPE7: number|null, avgRPE28: number|null,
 *             status: string, label: string } | null}
 *   null if fewer than 3 entries in the last 28 days.
 */
export function calcFatigue() {
  const now = Date.now();
  const day = MS_PER_DAY;
  const e7  = store.entries.filter(e => (now - e.timestamp) <= 7 * day);
  const e28 = store.entries.filter(e => (now - e.timestamp) <= 28 * day);
  if (e28.length < 3) return null;

  // RPE-based
  const rpe7  = e7.filter(e => e.rpe != null);
  const rpe28 = e28.filter(e => e.rpe != null);
  const avgRPE7  = rpe7.length > 0  ? rpe7.reduce((s, e) => s + e.rpe, 0) / rpe7.length   : null;
  const avgRPE28 = rpe28.length > 0 ? rpe28.reduce((s, e) => s + e.rpe, 0) / rpe28.length : null;

  // ACWR (tonnage-based)
  const ton7  = e7.reduce((s, e) => s + e.weight * e.reps, 0);
  const ton28 = e28.reduce((s, e) => s + e.weight * e.reps, 0);
  const weeklyAvg28 = ton28 / 4;
  const acwr = weeklyAvg28 > 0 ? ton7 / weeklyAvg28 : null;

  let status = 'green', label = 'Recovery: Good';
  if (acwr !== null) {
    if (acwr > FATIGUE_THRESHOLD_HIGH) { status = 'red'; label = 'High fatigue'; }
    else if (acwr > FATIGUE_THRESHOLD_MOD) { status = 'yellow'; label = 'Moderate load'; }
  }

  return { acwr, avgRPE7, avgRPE28, status, label };
}

// ---------------------------------------------------------------------------
// Per-muscle fatigue
// ---------------------------------------------------------------------------

/**
 * Calculate ACWR for each muscle group, combining main-lift and accessory
 * contributions.
 *
 * @returns {Object|null} Map of muscle group name to { acwr, status, label },
 *   or null if no muscle group has enough data.
 */
export function calcFatigueByMuscle() {
  const now = Date.now();
  const day = MS_PER_DAY;
  const results = {};
  let anyValid = false;

  // Pre-filter main lift entries by time window
  const main7  = store.entries.filter(e => (now - e.timestamp) <= 7 * day);
  const main28 = store.entries.filter(e => (now - e.timestamp) <= 28 * day);
  // Pre-filter accessory entries by time window
  const acc7  = store.accessoryLog.filter(a => (now - a.timestamp) <= 7 * day);
  const acc28 = store.accessoryLog.filter(a => (now - a.timestamp) <= 28 * day);

  MUSCLE_GROUPS.forEach(mg => {
    let ton7 = 0, ton28 = 0, count28 = 0;

    // Main lift contributions
    main28.forEach(e => {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      if (!w || !w[mg]) return;
      const ton = e.weight * e.reps * w[mg];
      ton28 += ton;
      count28++;
    });
    main7.forEach(e => {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      if (!w || !w[mg]) return;
      ton7 += e.weight * e.reps * w[mg];
    });

    // Accessory contributions (0.5 multiplier)
    ton28 += calcAccessoryTonnage(acc28, mg);
    count28 += countAccessoryEntries(acc28, mg);
    ton7 += calcAccessoryTonnage(acc7, mg);

    if (count28 < 3) { results[mg] = null; return; }
    const weeklyAvg28 = ton28 / 4;
    const acwr = weeklyAvg28 > 0 ? ton7 / weeklyAvg28 : null;
    let status = 'green', label = 'Low';
    if (acwr !== null) {
      if (acwr > FATIGUE_THRESHOLD_HIGH) { status = 'red'; label = 'High'; }
      else if (acwr > FATIGUE_THRESHOLD_MOD) { status = 'yellow'; label = 'Med'; }
    }
    results[mg] = { acwr, status, label };
    anyValid = true;
  });

  return anyValid ? results : null;
}

// ---------------------------------------------------------------------------
// Detailed fatigue for a single muscle group
// ---------------------------------------------------------------------------

/**
 * Calculate detailed fatigue data for a single muscle group, including
 * weekly trend, contributors, last session, and recovery estimate.
 *
 * @param {string} mg - Muscle group name ('Quads', 'Hams', 'Back', 'Chest')
 * @returns {Object|null} Detailed fatigue object, or null if insufficient data
 */
export function calcFatigueDetail(mg) {
  const now = Date.now();
  const day = MS_PER_DAY;
  const main7  = store.entries.filter(e => (now - e.timestamp) <= 7 * day);
  const main28 = store.entries.filter(e => (now - e.timestamp) <= 28 * day);
  const acc7   = store.accessoryLog.filter(a => (now - a.timestamp) <= 7 * day);
  const acc28  = store.accessoryLog.filter(a => (now - a.timestamp) <= 28 * day);

  let ton7 = 0, ton28 = 0, count28 = 0;
  const contribMap = {};

  // Helper to accumulate contributor tonnage
  function addContrib(key, name, type, lift, muscleWeight, ton) {
    if (!contribMap[key]) { contribMap[key] = { name, type, lift, muscleWeight, ton7: 0 }; }
    contribMap[key].ton7 += ton;
  }

  // Main lift contributions — 28-day
  main28.forEach(e => {
    const w = MAIN_LIFT_WEIGHTS[e.lift];
    if (!w || !w[mg]) return;
    ton28 += e.weight * e.reps * w[mg];
    count28++;
  });
  // Main lift contributions — 7-day
  main7.forEach(e => {
    const w = MAIN_LIFT_WEIGHTS[e.lift];
    if (!w || !w[mg]) return;
    const t = e.weight * e.reps * w[mg];
    ton7 += t;
    addContrib('main-' + e.lift, LIFT_NAMES[e.lift], 'Main', e.lift, w[mg], t);
  });

  // Accessory contributions — 28-day
  acc28.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    if (!cw || !cw[mg]) return;
    const sets = a.setsCompleted || [];
    const accTon = sets.reduce((s, reps, i) =>
      s + ((a.setWeights && a.setWeights[i]) || a.weight || 0) * reps, 0
    ) * cw[mg] * 0.5;
    ton28 += accTon;
    count28++;
  });
  // Accessory contributions — 7-day
  acc7.forEach(a => {
    const ex = ACCESSORY_DB[a.exerciseId];
    if (!ex) return;
    const cw = ACCESSORY_CAT_WEIGHTS[ex.category];
    if (!cw || !cw[mg]) return;
    const sets = a.setsCompleted || [];
    const accTon = sets.reduce((s, reps, i) =>
      s + ((a.setWeights && a.setWeights[i]) || a.weight || 0) * reps, 0
    ) * cw[mg] * 0.5;
    ton7 += accTon;
    addContrib('acc-' + a.exerciseId, ex.name, 'Acc', ex.mainLift, cw[mg], accTon);
  });

  if (count28 < 3) return null;

  const weeklyAvg28 = ton28 / 4;
  const acwr = weeklyAvg28 > 0 ? ton7 / weeklyAvg28 : null;
  let status = 'green', label = 'Low';
  if (acwr !== null) {
    if (acwr > FATIGUE_THRESHOLD_HIGH) { status = 'red'; label = 'High'; }
    else if (acwr > FATIGUE_THRESHOLD_MOD) { status = 'yellow'; label = 'Med'; }
  }

  // Weekly trend (4 one-week buckets)
  const weeklyTrend = [0, 0, 0, 0];
  const allItems28 = [
    ...main28.map(e => ({
      ts: e.timestamp,
      lift: e.lift,
      ton: e.weight * e.reps * (MAIN_LIFT_WEIGHTS[e.lift]?.[mg] || 0),
    })),
    ...acc28.map(a => {
      const ex = ACCESSORY_DB[a.exerciseId];
      const cw = ex ? ACCESSORY_CAT_WEIGHTS[ex.category] : null;
      const mw = cw ? (cw[mg] || 0) : 0;
      const sets = a.setsCompleted || [];
      return {
        ts: a.timestamp,
        lift: ex?.mainLift,
        ton: sets.reduce((s, r, i) =>
          s + ((a.setWeights && a.setWeights[i]) || a.weight || 0) * r, 0
        ) * mw * 0.5,
      };
    }),
  ];
  allItems28.forEach(item => {
    const daysAgo = (now - item.ts) / day;
    const bucket = Math.min(3, Math.floor(daysAgo / 7));
    weeklyTrend[3 - bucket] += item.ton;
  });

  // Contributors sorted by ton7
  const contribArr = Object.values(contribMap)
    .filter(c => c.ton7 > 0)
    .sort((a, b) => b.ton7 - a.ton7);

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

  // Recovery estimate
  const baseHours = MUSCLE_RECOVERY_HOURS[mg];
  const acwrMult = status === 'red'
    ? FATIGUE_RECOVERY_MULT.high
    : status === 'yellow'
      ? FATIGUE_RECOVERY_MULT.mod
      : FATIGUE_RECOVERY_MULT.low;
  const spikeMult = (weeklyAvg28 > 0 && ton7 > 1.5 * weeklyAvg28) ? 12 : 0;
  const adjustedHours = baseHours * acwrMult + spikeMult;
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
    acwr, status, label, ton7, weeklyAvg28, count28, weeklyTrend,
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

/**
 * Generate a plain-text recovery recommendation from a fatigue detail object.
 *
 * @param {Object} detail - Return value of calcFatigueDetail()
 * @returns {string} Human-readable advice
 */
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
// Per-lift fatigue
// ---------------------------------------------------------------------------

/**
 * Calculate ACWR for a single main lift (not muscle-group weighted).
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ acwr: number|null, status: string }|null}
 *   null if fewer than 2 entries in 28 days.
 */
export function calcFatigueLift(lift) {
  const now = Date.now();
  const day = MS_PER_DAY;
  const e7  = store.entries.filter(e => e.lift === lift && (now - e.timestamp) <= 7 * day);
  const e28 = store.entries.filter(e => e.lift === lift && (now - e.timestamp) <= 28 * day);
  if (e28.length < 2) return null;
  const ton7  = e7.reduce((s, e) => s + e.weight * e.reps, 0);
  const ton28 = e28.reduce((s, e) => s + e.weight * e.reps, 0);
  const weeklyAvg28 = ton28 / 4;
  const acwr = weeklyAvg28 > 0 ? ton7 / weeklyAvg28 : null;
  let status = 'green';
  if (acwr !== null) {
    if (acwr > FATIGUE_THRESHOLD_HIGH) status = 'red';
    else if (acwr > FATIGUE_THRESHOLD_MOD) status = 'yellow';
  }
  return { acwr, status };
}
