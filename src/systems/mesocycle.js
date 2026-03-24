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
    const stimuli = ['hypertrophy', 'strength', 'power'];
    const stimIdx = (weekNum - 1) % 3;
    const stim = stimuli[stimIdx];
    if (stim === 'hypertrophy') { pct = 67; reps = 10; targetRPE = 7; numSets = 4; phase = 'Hypertrophy'; }
    else if (stim === 'strength') { pct = 82; reps = 4; targetRPE = 8; numSets = 5; phase = 'Strength'; }
    else { pct = 75; reps = 3; targetRPE = 7.5; numSets = 4; phase = 'Power'; }
    // Progressive overload across cycles
    const cycleNum = Math.floor((weekNum - 1) / 3);
    pct += cycleNum * 2;
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

  const workouts = {};
  LIFTS.forEach(lift => {
    const tm = baseTMs[lift];
    const mainSets = [];
    for (let s = 0; s < numSets; s++) {
      const setPct = isDeload ? 55 : pct + (s - Math.floor(numSets / 2)) * 2.5;
      mainSets.push({
        pct: Math.round(Math.max(50, Math.min(100, setPct)) * 10) / 10,
        weight: roundToPlate(tm * Math.max(50, Math.min(100, setPct)) / 100),
        reps,
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
      volumeTarget: numSets * reps
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
    const extraReps = amrapReps - minReps;
    actualRPE = Math.max(5, week.targetRPE - extraReps * 0.5);
  } else {
    // Estimate: if all sets done, RPE ~= target; if missed sets, higher RPE
    const prescribed = week.workouts[lift]?.mainSets?.length || 0;
    if (prescribed > 0 && completedMain.length < prescribed) {
      actualRPE = Math.min(10, week.targetRPE + (prescribed - completedMain.length));
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

  if (rpeDiff <= -1.5) {
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
  } else if (rpeDiff >= 1.5) {
    // Missing targets: reduce intensity and volume
    const decrease = 2.5;
    adaptation = { type: 'decrease', pctChange: -decrease, reason: `RPE ${perf.actualRPE} above target ${week.targetRPE}` };
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
      adjustment: `${adaptation.type === 'increase' ? '+' : ''}${adaptation.pctChange}% intensity`,
      timestamp: Date.now()
    });
    store.saveMesocycle();
  }
  return adaptation;
}
