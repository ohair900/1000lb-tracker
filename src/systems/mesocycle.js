/**
 * Mesocycle generator and performance adaptation system.
 *
 * Supports three periodization models:
 *  - linear  — progressive intensity increase across weeks
 *  - dup     — daily undulating periodization cycling hypertrophy/strength/power
 *  - block   — accumulation / intensification / realization phases
 *
 * The last week of any non-deload mesocycle is automatically a deload week.
 *
 * After each training week, performance data (actual RPE vs. target RPE)
 * drives automatic adaptation of remaining weeks' intensity and volume.
 */

import store from '../state/store.js';
import { MESO_GOALS } from '../data/meso-goals.js';
import { LIFTS } from '../constants/lift-config.js';
import { roundToPlate } from '../formulas/plates.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { selectSmartAccessories } from './workout-builder.js';
import { calcFatigueLift, calcFatigueByMuscle } from './fatigue.js';
import { MAIN_LIFT_WEIGHTS } from '../data/muscle-groups.js';

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate a complete mesocycle with all weeks pre-planned.
 *
 * @param {string} goal - 'hypertrophy' | 'strength' | 'peaking' | 'deload'
 * @param {string} model - 'linear' | 'dup' | 'block'
 * @param {number} durationWeeks - Total number of weeks
 * @param {boolean} includeOptional - Whether to generate optional light days
 * @returns {Object|null} The mesocycle object, or null if TMs are missing
 */
export function generateMesocycle(goal, model, durationWeeks, includeOptional) {
  const goalDef = MESO_GOALS[goal];
  if (!goalDef) return null;

  const baseTMs = {};
  LIFTS.forEach(l => {
    baseTMs[l] = store.programConfig.trainingMaxes[l] || (bestE1RM(l) ? Math.round(bestE1RM(l) * 0.9) : 0);
  });
  if (LIFTS.some(l => !baseTMs[l])) return null;

  const now = new Date();
  const meso = {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    name: `${goalDef.label} ${model.charAt(0).toUpperCase() + model.slice(1)} ${durationWeeks}W`,
    goal, model, durationWeeks,
    startDate: now.toISOString().split('T')[0],
    createdAt: now.getTime(),
    baseTMs: { ...baseTMs },
    currentWeek: 1,
    weeks: [],
    adaptationLog: [],
    status: 'active'
  };

  for (let w = 1; w <= durationWeeks; w++) {
    const isDeload = (goal !== 'deload' && w === durationWeeks);
    const weekData = generateMesoWeek(w, durationWeeks, goal, model, goalDef, baseTMs, isDeload, includeOptional);
    meso.weeks.push(weekData);
  }
  return meso;
}

/**
 * Generate a single week's workout prescription within a mesocycle.
 *
 * @param {number} weekNum - 1-based week number
 * @param {number} totalWeeks - Total weeks in the mesocycle
 * @param {string} goal - Mesocycle goal key
 * @param {string} model - Periodization model
 * @param {Object} goalDef - Goal definition from MESO_GOALS
 * @param {Object} baseTMs - Base training maxes { squat, bench, deadlift }
 * @param {boolean} isDeload - Whether this is a deload week
 * @param {boolean} includeOptional - Whether to include optional light days
 * @returns {Object} Week object with workouts, phase, targetRPE, etc.
 */
export function generateMesoWeek(weekNum, totalWeeks, goal, model, goalDef, baseTMs, isDeload, includeOptional) {
  let phase, targetRPE, pct, reps, numSets;

  if (isDeload) {
    phase = 'Deload';
    targetRPE = 5;
    pct = 55;
    reps = 5;
    numSets = 3;
  } else if (model === 'linear') {
    const progress = (weekNum - 1) / Math.max(1, totalWeeks - 2);
    pct = goalDef.pctRange[0] + (goalDef.pctRange[1] - goalDef.pctRange[0]) * progress;
    reps = Math.round(goalDef.repRange[1] - (goalDef.repRange[1] - goalDef.repRange[0]) * progress);
    targetRPE = goalDef.rpeRange[0] + (goalDef.rpeRange[1] - goalDef.rpeRange[0]) * progress;
    numSets = goal === 'hypertrophy' ? 4 : (goal === 'peaking' ? 3 : 5);
    phase = progress < 0.33 ? 'Accumulation' : progress < 0.66 ? 'Intensification' : 'Realization';
  } else if (model === 'dup') {
    // True Daily Undulating: each week has all 3 stimuli, one per lift.
    // Rotation handled per-lift in the workouts loop below.
    phase = 'DUP';
    pct = 75; reps = 5; targetRPE = 7.5; numSets = 4;
  } else { // block
    const progress = (weekNum - 1) / Math.max(1, totalWeeks - 2);
    if (progress < 0.4) {
      phase = 'Accumulation'; pct = goalDef.pctRange[0]; reps = goalDef.repRange[1]; targetRPE = goalDef.rpeRange[0];
      numSets = goal === 'hypertrophy' ? 5 : 5;
    } else if (progress < 0.7) {
      phase = 'Intensification'; pct = (goalDef.pctRange[0] + goalDef.pctRange[1]) / 2; reps = Math.round((goalDef.repRange[0] + goalDef.repRange[1]) / 2);
      targetRPE = (goalDef.rpeRange[0] + goalDef.rpeRange[1]) / 2; numSets = 4;
    } else {
      phase = 'Realization'; pct = goalDef.pctRange[1]; reps = goalDef.repRange[0]; targetRPE = goalDef.rpeRange[1]; numSets = 3;
    }
  }

  pct = Math.round(pct * 10) / 10;
  targetRPE = Math.round(targetRPE * 10) / 10;
  const accCount = isDeload ? 2 : (phase === 'Accumulation' ? 5 : phase === 'Realization' ? 3 : 4);

  // DUP stimulus definitions
  const DUP_STIMULI = [
    { name: 'Hypertrophy', pct: 67, reps: 10, rpe: 7, sets: 4 },
    { name: 'Strength',    pct: 82, reps: 4,  rpe: 8, sets: 5 },
    { name: 'Power',       pct: 75, reps: 3,  rpe: 7.5, sets: 4 },
  ];

  const workouts = {};
  LIFTS.forEach((lift, liftIdx) => {
    const tm = baseTMs[lift];

    // DUP: assign per-lift stimulus, rotating each week
    let liftPct = pct, liftReps = reps, liftSets = numSets, liftRPE = targetRPE;
    if (model === 'dup' && !isDeload) {
      const stimIdx = (weekNum - 1 + liftIdx) % 3;
      const stim = DUP_STIMULI[stimIdx];
      const cycleNum = Math.floor((weekNum - 1) / 3);
      liftPct = Math.min(stim.pct + cycleNum * 2, goalDef.pctRange[1]);
      liftReps = stim.reps;
      liftSets = stim.sets;
      liftRPE = stim.rpe;
    }

    const mainSets = [];
    for (let s = 0; s < liftSets; s++) {
      const setPct = isDeload ? 55 : liftPct + (s - Math.floor(liftSets / 2)) * 2.5;
      mainSets.push({
        pct: Math.round(Math.max(50, Math.min(100, setPct)) * 10) / 10,
        weight: roundToPlate(tm * Math.max(50, Math.min(100, setPct)) / 100),
        reps: liftReps,
        completed: false
      });
    }
    const smartAccs = selectSmartAccessories(lift, accCount);
    workouts[lift] = {
      mainSets,
      accessories: smartAccs.map(a => ({
        exerciseId: a.id,
        name: a.name,
        sets: a.sets,
        repRange: a.repRange,
        equipment: a.equipment
      })),
      volumeTarget: liftSets * liftReps,
      stimulus: model === 'dup' && !isDeload ? DUP_STIMULI[(weekNum - 1 + liftIdx) % 3].name : null,
    };
  });

  const week = {
    weekNum, label: `Week ${weekNum}`, phase, targetRPE,
    workouts, completed: {}, performance: {}, adapted: false
  };

  // Optional light days
  if (includeOptional && !isDeload) {
    week.optionalDays = LIFTS.map(lift => ({
      lift, pct: 60,
      mainSets: [{ pct: 60, weight: roundToPlate(baseTMs[lift] * 0.6), reps: 5, completed: false }],
      accessories: selectSmartAccessories(lift, 4).map(a => ({
        exerciseId: a.id,
        name: a.name,
        sets: a.sets,
        repRange: a.repRange,
        equipment: a.equipment
      }))
    }));
  }

  return week;
}

// ---------------------------------------------------------------------------
// Performance recording
// ---------------------------------------------------------------------------

/**
 * Record the performance of a completed workout session within the
 * active mesocycle.  Tracks actual RPE based on AMRAP results or
 * set-completion rate.  When all three lifts are done for a week,
 * advances the mesocycle to the next week (or completes it).
 *
 * @param {Object} session - The completed workout session object
 *   Expected shape: { mainLift, mainSets, programWeek }
 */
export function recordMesocyclePerformance(session) {
  if (!store.activeMesocycle || store.activeMesocycle.status !== 'active') return;
  const weekIdx = store.activeMesocycle.currentWeek - 1;
  const week = store.activeMesocycle.weeks[weekIdx];
  if (!week) return;
  const lift = session.mainLift;

  // Estimate actual RPE from AMRAP or completion
  const completedMain = session.mainSets.filter(s => s.completed);
  let actualRPE = week.targetRPE;
  const lastSet = completedMain[completedMain.length - 1];
  if (lastSet && typeof lastSet.reps === 'string' && lastSet.reps.includes('+')) {
    const minReps = parseInt(lastSet.reps);
    const amrapKey = `${lift}-${session.programWeek || 1}-${session.mainSets.indexOf(lastSet)}`;
    const amrapReps = store.programConfig.amrapResults[amrapKey] || minReps;
    const extraReps = Math.max(0, amrapReps - minReps);
    // Diminishing returns: first 2 extra reps = 0.5 each, then log scaling
    const rpeReduction = extraReps <= 2
      ? extraReps * 0.5
      : 1.0 + Math.log2(Math.max(1, extraReps - 1)) * 0.5;
    actualRPE = Math.max(5, Math.min(10, week.targetRPE - rpeReduction));
  } else {
    // Estimate: only penalize if completion rate < 75%
    const prescribed = week.workouts[lift]?.mainSets?.length || 0;
    if (prescribed > 0 && completedMain.length < prescribed) {
      const completionRate = completedMain.length / prescribed;
      if (completionRate < 0.75) {
        actualRPE = Math.min(10, week.targetRPE + (1 - completionRate) * 4);
      }
    }
  }

  const totalReps = completedMain.reduce((s, set) => {
    const r = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
    return s + (r || 0);
  }, 0);

  week.performance[lift] = {
    completedSets: completedMain.length,
    totalReps,
    actualRPE: Math.round(actualRPE * 10) / 10,
    timestamp: Date.now()
  };

  // Check if all 3 lifts done this week
  const allDone = LIFTS.every(l => week.performance[l]);
  if (allDone) {
    week.completed = true;
    if (store.activeMesocycle.currentWeek < store.activeMesocycle.durationWeeks) {
      store.activeMesocycle.currentWeek++;
    } else {
      store.activeMesocycle.status = 'completed';
      store.mesocycleHistory.push({ ...store.activeMesocycle });
      store.saveMesocycleHistory();
      store.activeMesocycle = null;
    }
  }
  store.saveMesocycle();
}

// ---------------------------------------------------------------------------
// Adaptation
// ---------------------------------------------------------------------------

/**
 * Adapt remaining mesocycle weeks based on how the lifter performed
 * relative to the target RPE.
 *
 * - RPE 1.5+ below target -> increase intensity (+2.5 or +5 %)
 * - RPE 1.5+ above target -> decrease intensity (-2.5 %) and trim volume
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ type: string, pctChange: number, reason: string }|null}
 *   The adaptation applied, or null if no change was needed.
 */
export function adaptRemainingWeeks(lift) {
  if (!store.activeMesocycle || store.activeMesocycle.status !== 'active') return null;
  const weekIdx = store.activeMesocycle.currentWeek - 2; // Just completed week (currentWeek already advanced)
  const week = store.activeMesocycle.weeks[weekIdx];
  if (!week || !week.performance[lift]) return null;

  const perf = week.performance[lift];
  const rpeDiff = perf.actualRPE - week.targetRPE;
  let adaptation = null;

  // ACWR-based fatigue check (#8)
  const liftFatigue = calcFatigueLift(lift);
  const muscleFatigue = calcFatigueByMuscle();
  const isPeaking = store.activeMesocycle.goal === 'peaking';

  // Check if any primary muscle is red
  let anyPrimaryRed = false;
  if (muscleFatigue) {
    const liftWeights = MAIN_LIFT_WEIGHTS[lift] || {};
    for (const [mg, mw] of Object.entries(liftWeights)) {
      if (mw >= 0.15 && muscleFatigue[mg] && muscleFatigue[mg].status === 'red') {
        anyPrimaryRed = true;
        break;
      }
    }
  }

  // ACWR override: if fatigue is high but RPE says increase, block the increase
  // (common in intermediates who underrate RPE)
  const acwrIsHigh = liftFatigue && (liftFatigue.status === 'red' || (!isPeaking && liftFatigue.status === 'yellow'));
  const shouldBlockIncrease = acwrIsHigh && rpeDiff <= -1.5;

  // ACWR-triggered volume reduction: red primary muscle triggers decrease
  // regardless of RPE (except during peaking final 2 weeks)
  const weeksRemaining = store.activeMesocycle.durationWeeks - store.activeMesocycle.currentWeek + 1;
  const acwrTriggeredDecrease = anyPrimaryRed && !(isPeaking && weeksRemaining <= 2);

  if (shouldBlockIncrease) {
    // RPE says increase but ACWR says no — log it but don't change
    adaptation = { type: 'blocked', pctChange: 0, reason: `RPE ${perf.actualRPE} below target but ACWR elevated — holding intensity` };
  } else if (rpeDiff <= -1.5 && !acwrTriggeredDecrease) {
    // Exceeding targets: increase intensity
    const increase = rpeDiff <= -2.5 ? 5 : 2.5;
    adaptation = { type: 'increase', pctChange: increase, reason: `RPE ${perf.actualRPE} well below target ${week.targetRPE}` };
    for (let i = store.activeMesocycle.currentWeek - 1; i < store.activeMesocycle.weeks.length; i++) {
      const futureWeek = store.activeMesocycle.weeks[i];
      if (futureWeek.phase === 'Deload') continue;
      if (futureWeek.workouts[lift]) {
        futureWeek.workouts[lift].mainSets.forEach(s => {
          s.pct = Math.min(100, s.pct + increase);
          s.weight = roundToPlate(store.activeMesocycle.baseTMs[lift] * s.pct / 100);
        });
        futureWeek.adapted = true;
      }
    }
  } else if (rpeDiff >= 1.5 || acwrTriggeredDecrease) {
    // Missing targets or ACWR-triggered: reduce intensity and volume
    const decrease = 2.5;
    const reason = acwrTriggeredDecrease && rpeDiff < 1.5
      ? `ACWR high for ${lift} — reducing load to manage fatigue`
      : `RPE ${perf.actualRPE} above target ${week.targetRPE}`;
    adaptation = { type: 'decrease', pctChange: -decrease, reason };
    for (let i = store.activeMesocycle.currentWeek - 1; i < store.activeMesocycle.weeks.length; i++) {
      const futureWeek = store.activeMesocycle.weeks[i];
      if (futureWeek.phase === 'Deload') continue;
      if (futureWeek.workouts[lift]) {
        futureWeek.workouts[lift].mainSets.forEach(s => {
          s.pct = Math.max(50, s.pct - decrease);
          s.weight = roundToPlate(store.activeMesocycle.baseTMs[lift] * s.pct / 100);
        });
        // Reduce volume by removing last set if > 3
        if (futureWeek.workouts[lift].mainSets.length > 3) {
          futureWeek.workouts[lift].mainSets.pop();
        }
        futureWeek.adapted = true;
      }
    }
  }

  if (adaptation) {
    store.activeMesocycle.adaptationLog.push({
      weekNum: week.weekNum, lift, reason: adaptation.reason,
      adjustment: adaptation.type === 'blocked' ? 'Held (ACWR override)' : `${adaptation.type === 'increase' ? '+' : ''}${adaptation.pctChange}% intensity`,
      timestamp: Date.now()
    });
    store.saveMesocycle();
  }
  return adaptation;
}
