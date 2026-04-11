/**
 * Session Optimizer — adaptive daily autocoaching engine.
 *
 * Orchestrates fatigue, recovery, plateau detection, gap analysis,
 * mesocycle prescriptions, and comeback detection into a single
 * adaptive coaching loop with three phases:
 *
 *  1. Pre-session:  generateSessionPlan(lift)
 *  2. Mid-session:  evaluateSetCompletion(plan, idx, rpe, reps, weight)
 *  3. Post-session: gradeSession(plan, session)
 *
 * Program interaction rules:
 * - Main sets are sacred (program-prescribed sets are never modified)
 * - Supplemental volume (BBB etc.) is adjustable by fatigue
 * - Accessories are fully managed (swaps, reductions)
 * - RPE targets are assigned for drift detection
 */

import store from '../state/store.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { calcFatigueLift, calcFatigueByMuscle } from './fatigue.js';
import { suggestMainLift, suggestIntensity } from './smart-workout.js';
import {
  selectSmartAccessories,
  computeSetWeights,
  getAccessoryWeight,
  checkAccessoryProgression,
} from './workout-builder.js';
import { diagnosePlateau } from './plateau-breaker.js';
import { getGapReport } from './gap-analysis.js';
import { checkComeback } from './comeback.js';
import { getCalibratedRecovery } from './recovery-calibration.js';
import { MAIN_LIFT_WEIGHTS } from '../data/muscle-groups.js';
import { EXERCISE_CATALOG } from '../data/exercise-catalog.js';
import { resolveExercise } from '../data/exercise-compat.js';
import { roundToPlate } from '../formulas/plates.js';

// ---------------------------------------------------------------------------
// Pre-session plan generation
// ---------------------------------------------------------------------------

/**
 * Generate an adaptive coaching plan for a workout session.
 *
 * Reads from all existing systems, synthesizes insights, and returns
 * a structured plan with adjustments and reasons.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @param {Object} session - The session object from createWorkoutSession
 * @returns {Object} SessionPlan
 */
export function generateSessionPlan(lift, session) {
  // Cache expensive calculations once per session
  const cache = {
    fatigueLift: calcFatigueLift(lift),
    fatigueByMuscle: calcFatigueByMuscle(),
    plateauDiagnosis: diagnosePlateau(lift),
    gapReport: getGapReport(lift),
    comebackInfo: checkComeback(),
    cachedAt: Date.now(),
  };

  const insights = [];
  const adjustments = [];
  const accessorySwaps = [];
  let supplementalAdjustment = null;

  // --- Fatigue analysis ---
  const liftStatus = cache.fatigueLift ? cache.fatigueLift.status : 'green';
  const muscleFatigue = cache.fatigueByMuscle;

  // Find worst display status among primary muscles for this lift
  let worstMuscle = null;
  let worstDisplay = 'green';
  const displayOrder = { green: 0, lime: 1, yellow: 2, orange: 3, red: 4 };
  if (muscleFatigue) {
    const liftWeights = MAIN_LIFT_WEIGHTS[lift] || {};
    for (const [mg, mw] of Object.entries(liftWeights)) {
      if (mw >= 0.15 && muscleFatigue[mg]) {
        const ds = muscleFatigue[mg].displayStatus || 'green';
        if (displayOrder[ds] > displayOrder[worstDisplay]) {
          worstDisplay = ds;
          worstMuscle = mg;
        }
      }
    }
  }

  if (liftStatus === 'red' || worstDisplay === 'red') {
    insights.push({
      priority: 1, type: 'fatigue', icon: 'fatigue',
      text: `${worstMuscle || LIFT_NAMES[lift]} is hot — keep today light.`,
    });
  } else if (liftStatus === 'yellow' || worstDisplay === 'orange') {
    insights.push({
      priority: 2, type: 'fatigue', icon: 'fatigue',
      text: `${worstMuscle || LIFT_NAMES[lift]} is warm — watch RPE closely.`,
    });
  } else if (worstDisplay === 'yellow') {
    insights.push({
      priority: 4, type: 'fatigue', icon: 'fatigue',
      text: `Moderate fatigue — don't chase PRs today.`,
    });
  }

  // --- Comeback detection ---
  let comebackProtocol = null;
  if (cache.comebackInfo) {
    const days = cache.comebackInfo.daysSince;
    const reductionPct = days > 28 ? 40 : 30;
    comebackProtocol = {
      reductionPct,
      message: `Back from ${days} days off — starting at ${100 - reductionPct}%.`,
    };
    insights.push({
      priority: 1, type: 'comeback', icon: 'comeback',
      text: comebackProtocol.message,
      actionable: true,
    });
  }

  // --- Plateau detection ---
  if (cache.plateauDiagnosis && cache.plateauDiagnosis.score >= 30) {
    const topIssue = cache.plateauDiagnosis.diagnostics
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score)[0];
    if (topIssue) {
      insights.push({
        priority: 2, type: 'plateau', icon: 'plateau',
        text: `${LIFT_NAMES[lift]} e1RM flat — watch RPE today.`,
      });
    }
  }

  // --- Gap analysis → accessory swaps + deferred FYI insights ---
  if (cache.gapReport && cache.gapReport.length > 0) {
    // Deferred (cross-region) gaps render as passive insights only.
    cache.gapReport
      .filter(g => g.type === 'deferred-gap')
      .slice(0, 1)  // at most one FYI — don't crowd the note
      .forEach(gap => {
        insights.push({
          priority: 4, type: 'gap', icon: 'gap',
          text: gap.message,
        });
      });

    // Actionable gaps — top 2 high/medium severity in-region items.
    const actionableGaps = cache.gapReport
      .filter(g => (g.severity === 'high' || g.severity === 'medium') && g.suggestedExercise)
      .slice(0, 2);

    actionableGaps.forEach(gap => {
      // Recent-stimulus dampening: if the target muscle is already at orange
      // or red fatigue, don't add more volume — emit a soft insight instead.
      const mgFatigue = muscleFatigue && muscleFatigue[gap.muscleGroup];
      const ds = mgFatigue && mgFatigue.displayStatus;
      if (ds === 'red' || ds === 'orange') {
        insights.push({
          priority: 3, type: 'gap', icon: 'gap',
          text: `${gap.muscleGroup} fatigue is elevated — skipping added volume today.`,
        });
        return;
      }

      // Coach-voice copy: action-first, reason-trailing.
      const shortReason = gap.message.replace(`${gap.muscleGroup}: `, '').trim();
      insights.push({
        priority: 3, type: 'gap', icon: 'gap',
        text: `Swap in ${gap.suggestedExercise.name} — ${gap.muscleGroup.toLowerCase()} is ${shortReason}.`,
        actionable: true,
        swapIndex: accessorySwaps.length,
      });
      accessorySwaps.push({
        suggestedId: gap.suggestedExercise.id || null,
        suggestedName: gap.suggestedExercise.name,
        reason: gap.message,
        muscleGroup: gap.muscleGroup,
      });
    });
  }

  // --- Supplemental volume adjustment (BBB, T2, etc.) ---
  if (session.bbbSets && session.bbbSets.length > 0) {
    const originalCount = session.bbbSets.length;
    const suppTier = session.bbbSets[0].tier || 'BBB';
    let newCount = originalCount;

    if (liftStatus === 'red' || worstDisplay === 'red') {
      newCount = Math.max(2, originalCount - 3);
    } else if (worstDisplay === 'orange') {
      newCount = Math.max(3, originalCount - 2);
    } else if (liftStatus === 'yellow' || worstDisplay === 'yellow') {
      newCount = Math.max(4, originalCount - 1);
    }

    if (comebackProtocol) {
      newCount = Math.min(newCount, 3);
    }

    if (newCount < originalCount) {
      const reasonClause = liftStatus === 'red' || worstDisplay === 'red'
        ? `${worstMuscle || 'ACWR'} is red`
        : comebackProtocol
          ? 'you\u2019re back from a break'
          : `${worstMuscle || 'fatigue'} is warm`;

      supplementalAdjustment = {
        from: originalCount,
        to: newCount,
        tier: suppTier,
        reason: `Drop ${suppTier} to ${newCount} sets. ${reasonClause}.`,
      };
      adjustments.push({
        type: 'supplemental',
        from: `${originalCount}x${session.bbbSets[0].reps}`,
        to: `${newCount}x${session.bbbSets[0].reps}`,
        reason: supplementalAdjustment.reason,
      });
      insights.push({
        priority: 2, type: 'volume', icon: 'volume',
        text: supplementalAdjustment.reason,
        actionable: true,
      });
    }
  }

  // --- Assign RPE targets to each main set ---
  const setTargets = [];
  const baseFatigueRPE = liftStatus === 'red' ? -1.5
    : (worstDisplay === 'orange' ? -1.0
      : worstDisplay === 'yellow' ? -0.5 : 0);
  const comebackRPEAdj = comebackProtocol ? -1.0 : 0;

  session.mainSets.forEach((s, i) => {
    const isAmrap = typeof s.reps === 'string' && String(s.reps).includes('+');
    // Base expected RPE: ramps across sets, with adjustments
    let expectedRPE;
    if (isAmrap) {
      expectedRPE = 9.0 + baseFatigueRPE + comebackRPEAdj;
    } else {
      // Non-AMRAP: estimate from percentage
      const pct = s.pct || 75;
      if (pct >= 90) expectedRPE = 8.5;
      else if (pct >= 80) expectedRPE = 7.5;
      else if (pct >= 70) expectedRPE = 6.5;
      else expectedRPE = 5.5;
      expectedRPE += baseFatigueRPE + comebackRPEAdj;
    }
    expectedRPE = Math.max(4, Math.min(10, Math.round(expectedRPE * 2) / 2));
    setTargets.push({
      setIndex: i,
      expectedRPE,
      isAmrap,
      weight: s.weight,
      reps: typeof s.reps === 'string' ? parseInt(s.reps) : s.reps,
    });
  });

  // Sort insights by priority
  insights.sort((a, b) => a.priority - b.priority);

  const plan = {
    lift,
    timestamp: Date.now(),
    insights,
    adjustments,
    accessorySwaps,
    setTargets,
    supplementalAdjustment,
    comebackProtocol,
    cache,
  };

  // Store on ephemeral optimizer state
  store._sessionOptimizer = {
    plan,
    evaluations: [],
  };

  return plan;
}

/**
 * Generate a freestyle coaching plan when no program is active.
 * The optimizer becomes the program.
 *
 * @returns {{ lift: string, plan: Object, session: Object }}
 */
export function generateFreestylePlan() {
  const suggestion = suggestMainLift();
  const lift = suggestion.lift;
  const intensity = suggestIntensity(lift);
  const reasons = suggestion.reasons[lift] || [];

  return {
    lift,
    intensity,
    reasons,
    liftScores: suggestion.scores,
  };
}

// ---------------------------------------------------------------------------
// Mid-session evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a completed set against the plan's targets.
 *
 * @param {number} setIdx - Index of the completed set
 * @param {number} actualRPE - RPE reported by the athlete
 * @param {number} actualReps - Reps completed
 * @param {number} actualWeight - Weight used
 * @returns {Object|null} SetEvaluation, or null if no plan/target
 */
export function evaluateSetCompletion(setIdx, actualRPE, actualReps, actualWeight) {
  const optimizer = store._sessionOptimizer;
  if (!optimizer || !optimizer.plan) return null;

  const plan = optimizer.plan;
  const target = plan.setTargets[setIdx];
  if (!target) return null;

  // Don't evaluate if no RPE was logged
  if (actualRPE == null || actualRPE === 0) return null;

  const rpeDrift = actualRPE - target.expectedRPE;

  // Compute cumulative drift across all evaluated sets
  const allEvals = optimizer.evaluations || [];
  const pastDrifts = allEvals
    .filter(e => e && e.rpeDrift != null)
    .map(e => e.rpeDrift);
  pastDrifts.push(rpeDrift);
  const avgDrift = pastDrifts.reduce((s, d) => s + d, 0) / pastDrifts.length;

  let drift = 'on-track';
  if (avgDrift > 0.5) drift = 'over';
  else if (avgDrift < -0.5) drift = 'under';

  const adjustments = [];
  let message = '';
  let severity = 'info';

  const remainingSets = plan.setTargets.filter(t => t.setIndex > setIdx);

  if (drift === 'over') {
    if (avgDrift >= 2.0) {
      // Severe drift: recommend weight reduction + drop last set
      severity = 'alert';
      const reductionPct = Math.min(15, Math.round(avgDrift * 5));
      remainingSets.forEach(t => {
        const newWeight = roundToPlate(t.weight * (1 - reductionPct / 100));
        if (newWeight !== t.weight) {
          adjustments.push({
            setIndex: t.setIndex, field: 'weight',
            from: t.weight, to: newWeight,
            reason: `RPE drift +${avgDrift.toFixed(1)} — reducing ${reductionPct}%`,
          });
        }
      });
      // Drop last set if > 3 remaining
      if (remainingSets.length > 1) {
        const lastTarget = remainingSets[remainingSets.length - 1];
        adjustments.push({
          setIndex: lastTarget.setIndex, action: 'drop',
          reason: 'Cumulative fatigue — dropping final set',
        });
      }
      message = `RPE ${actualRPE} (target ${target.expectedRPE}). Drift +${avgDrift.toFixed(1)} — reduce weight ${reductionPct}% and drop last set`;

    } else if (avgDrift >= 1.0) {
      // Moderate drift: recommend weight reduction
      severity = 'warn';
      const reductionPct = Math.min(10, Math.round(avgDrift * 5));
      remainingSets.forEach(t => {
        const newWeight = roundToPlate(t.weight * (1 - reductionPct / 100));
        if (newWeight !== t.weight) {
          adjustments.push({
            setIndex: t.setIndex, field: 'weight',
            from: t.weight, to: newWeight,
            reason: `RPE trending high — reducing ${reductionPct}%`,
          });
        }
      });
      message = `RPE ${actualRPE} (target ${target.expectedRPE}). Reducing remaining sets by ${reductionPct}%`;

    } else {
      // Mild drift: just inform
      message = `RPE ${actualRPE} (target ${target.expectedRPE}). Slightly high — monitor next set`;
    }

    // Special case: set 1 RPE 9+ when target ≤ 7 → recommend light day
    if (setIdx === 0 && actualRPE >= 9 && target.expectedRPE <= 7) {
      severity = 'alert';
      message = `RPE ${actualRPE} on set 1 (target ${target.expectedRPE}). Consider switching to a light day`;
      adjustments.length = 0; // Clear other adjustments
      remainingSets.forEach(t => {
        const lightWeight = roundToPlate(t.weight * 0.80);
        adjustments.push({
          setIndex: t.setIndex, field: 'weight',
          from: t.weight, to: lightWeight,
          reason: 'Light day — 80% of prescribed',
        });
      });
    }

  } else if (drift === 'under' && avgDrift <= -1.5) {
    // Under-target: nudge increase (capped at 5%)
    severity = 'info';
    const increasePct = Math.min(5, Math.round(Math.abs(avgDrift) * 2.5));
    remainingSets.forEach(t => {
      const newWeight = roundToPlate(t.weight * (1 + increasePct / 100));
      if (newWeight !== t.weight) {
        adjustments.push({
          setIndex: t.setIndex, field: 'weight',
          from: t.weight, to: newWeight,
          reason: `RPE low — could increase ${increasePct}%`,
        });
      }
    });
    message = `RPE ${actualRPE} (target ${target.expectedRPE}). Moving well — consider +${increasePct}%`;
  } else {
    message = `RPE ${actualRPE} (target ${target.expectedRPE}). On track`;
  }

  const evaluation = {
    setIndex: setIdx,
    rpeDrift,
    avgDrift,
    drift,
    adjustments,
    message,
    severity,
    actualRPE,
    targetRPE: target.expectedRPE,
  };

  // Store evaluation
  optimizer.evaluations.push(evaluation);

  return evaluation;
}

// ---------------------------------------------------------------------------
// Post-session grading
// ---------------------------------------------------------------------------

/**
 * Grade a completed workout session.
 *
 * @param {Object} session - The completed workout session
 * @returns {Object} SessionGrade
 */
export function gradeSession(session) {
  const optimizer = store._sessionOptimizer;
  const plan = optimizer ? optimizer.plan : null;

  // --- Completion rate ---
  const mainCompleted = session.mainSets.filter(s => s.completed).length;
  const mainTotal = session.mainSets.length;
  const bbbCompleted = session.bbbSets ? session.bbbSets.filter(s => s.completed).length : 0;
  const bbbTotal = session.bbbSets
    ? (plan && plan.supplementalAdjustment ? plan.supplementalAdjustment.to : session.bbbSets.length)
    : 0;
  const accCompleted = session.accessories.reduce((s, a) => s + a.setsCompleted.length, 0);
  const accTotal = session.accessories.reduce((s, a) => s + a.targetSets, 0);

  const totalCompleted = mainCompleted + bbbCompleted + accCompleted;
  const totalPrescribed = mainTotal + bbbTotal + accTotal;
  const completionPct = totalPrescribed > 0
    ? Math.round((totalCompleted / totalPrescribed) * 100)
    : 100;

  // --- RPE accuracy ---
  const evaluations = optimizer ? optimizer.evaluations : [];
  let rpeDriftAvg = 0;
  let rpeDriftTrend = 'stable';
  if (evaluations.length > 0) {
    const drifts = evaluations.filter(e => e.rpeDrift != null).map(e => e.rpeDrift);
    rpeDriftAvg = drifts.length > 0
      ? Math.round(drifts.reduce((s, d) => s + d, 0) / drifts.length * 10) / 10
      : 0;
    if (drifts.length >= 2) {
      const firstHalf = drifts.slice(0, Math.ceil(drifts.length / 2));
      const secondHalf = drifts.slice(Math.ceil(drifts.length / 2));
      const firstAvg = firstHalf.reduce((s, d) => s + d, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, d) => s + d, 0) / secondHalf.length;
      if (secondAvg > firstAvg + 0.5) rpeDriftTrend = 'rising';
      else if (secondAvg < firstAvg - 0.5) rpeDriftTrend = 'falling';
    }
  }

  // --- Tonnage ---
  const mainTonnage = session.mainSets
    .filter(s => s.completed)
    .reduce((sum, s) => {
      const reps = typeof s.reps === 'string' ? parseInt(s.reps) : s.reps;
      return sum + (s.weight * (reps || 0));
    }, 0);
  const bbbTonnage = session.bbbSets
    ? session.bbbSets.filter(s => s.completed).reduce((sum, s) => sum + s.weight * s.reps, 0)
    : 0;

  // --- Compute grade ---
  let gradePoints = 0;
  // Completion component (0-50 points)
  gradePoints += Math.min(50, completionPct * 0.5);
  // RPE accuracy component (0-30 points)
  const rpeAccuracy = Math.max(0, 30 - Math.abs(rpeDriftAvg) * 10);
  gradePoints += rpeAccuracy;
  // Volume component (0-20 points): main sets completed
  gradePoints += mainTotal > 0 ? (mainCompleted / mainTotal) * 20 : 20;

  let grade;
  if (gradePoints >= 95) grade = 'A+';
  else if (gradePoints >= 90) grade = 'A';
  else if (gradePoints >= 85) grade = 'B+';
  else if (gradePoints >= 80) grade = 'B';
  else if (gradePoints >= 75) grade = 'C+';
  else if (gradePoints >= 70) grade = 'C';
  else if (gradePoints >= 60) grade = 'D';
  else grade = 'F';

  // --- Impact flags ---
  const impacts = [];

  // TM hold recommendation
  if (rpeDriftAvg > 1.0 && evaluations.length >= 2) {
    impacts.push({
      type: 'tm-hold',
      icon: 'warn',
      message: 'RPE consistently high — consider holding training max this cycle',
    });
  }

  // Fatigue warning for next session
  const fatigue = plan ? plan.cache.fatigueByMuscle : null;
  if (fatigue) {
    const liftWeights = MAIN_LIFT_WEIGHTS[session.mainLift] || {};
    for (const [mg, mw] of Object.entries(liftWeights)) {
      if (mw >= 0.15 && fatigue[mg] && (fatigue[mg].displayStatus === 'red' || fatigue[mg].displayStatus === 'orange')) {
        impacts.push({
          type: 'fatigue-warning',
          icon: 'fatigue',
          message: `${mg} recovery may be limited tomorrow`,
        });
        break; // Only show one
      }
    }
  }

  // Rising RPE trend
  if (rpeDriftTrend === 'rising') {
    impacts.push({
      type: 'rpe-trend',
      icon: 'info',
      message: 'RPE increased through the session — fatigue accumulated faster than expected',
    });
  }

  // Plateau persistence
  if (plan && plan.cache.plateauDiagnosis && plan.cache.plateauDiagnosis.score >= 30) {
    impacts.push({
      type: 'plateau',
      icon: 'plateau',
      message: `${LIFT_NAMES[session.mainLift]} plateau ongoing — consider a variation block`,
    });
  }

  return {
    grade,
    gradePoints: Math.round(gradePoints),
    completionPct,
    rpeDrift: { avg: rpeDriftAvg, trend: rpeDriftTrend },
    impacts,
    tonnage: Math.round(mainTonnage + bbbTonnage),
    volumeCompleted: {
      main: mainCompleted,
      bbb: bbbCompleted,
      accessory: accCompleted,
    },
  };
}

/**
 * Apply mid-session adjustments to the workout session.
 * Called when the athlete taps "Apply" on a coaching chip.
 *
 * @param {Object} evaluation - The SetEvaluation with adjustments
 */
export function applyAdjustments(evaluation) {
  if (!store.workoutSession || !evaluation || !evaluation.adjustments) return;

  evaluation.adjustments.forEach(adj => {
    if (adj.action === 'drop') {
      // Mark set as skipped by removing it from the view
      const set = store.workoutSession.mainSets[adj.setIndex];
      if (set) set._dropped = true;
    } else if (adj.field === 'weight') {
      const set = store.workoutSession.mainSets[adj.setIndex];
      if (set && !set.completed) {
        set.weight = adj.to;
      }
    }
  });

  // Also update plan targets to reflect new weights
  const optimizer = store._sessionOptimizer;
  if (optimizer && optimizer.plan) {
    evaluation.adjustments.forEach(adj => {
      if (adj.field === 'weight') {
        const target = optimizer.plan.setTargets.find(t => t.setIndex === adj.setIndex);
        if (target) target.weight = adj.to;
      }
    });
  }

  store.saveWorkoutSession();
}

/**
 * Apply supplemental set reduction (BBB, T2, etc.) from the pre-session plan.
 * Called when the athlete taps "Accept" on the supplemental coach row.
 *
 * @param {Object} adjustment - { from, to, tier, reason }
 */
export function applySupplementalAdjustment(adjustment) {
  if (!store.workoutSession || !adjustment) return;
  const supp = store.workoutSession.bbbSets;
  if (!supp || supp.length <= adjustment.to) return;

  // Mark excess supplemental sets as dropped (undisplayed in the workout view)
  for (let i = adjustment.to; i < supp.length; i++) {
    supp[i]._dropped = true;
  }
  store.saveWorkoutSession();
}

/**
 * Swap an accessory slot for a coach-recommended exercise. Called when the
 * athlete taps "Accept" on a swap row in the coaching card.
 *
 * Strategy: find the lowest-priority accessory currently in the workout that
 * targets a *different* muscle group than the suggestion (avoid double-dipping
 * on the same muscle), and replace it. If none match that rule, replace the
 * last accessory in the list.
 *
 * @param {Object} swap - { suggestedId, suggestedName, reason, muscleGroup }
 */
export function applyAccessorySwap(swap) {
  if (!store.workoutSession || !swap || !swap.suggestedId) return;

  const suggested = resolveExercise(swap.suggestedId) || EXERCISE_CATALOG[swap.suggestedId];
  if (!suggested) return;

  const accessories = store.workoutSession.accessories;
  if (!accessories || accessories.length === 0) return;

  // Skip if the suggestion is already loaded.
  if (accessories.some(a => a.exerciseId === swap.suggestedId)) return;

  // Pick a replacement slot: prefer an accessory whose primary muscle differs
  // from the swap's target (so we're not doubling up on one muscle).
  let replaceIdx = accessories.length - 1;
  for (let i = accessories.length - 1; i >= 0; i--) {
    const acc = accessories[i];
    const accEx = resolveExercise(acc.exerciseId);
    if (!accEx || !accEx.primaryMuscles) continue;
    const overlapsTarget = (accEx.primaryMuscles[swap.muscleGroup] || 0) >= 0.20;
    if (!overlapsTarget) { replaceIdx = i; break; }
  }

  const targetSets = suggested.sets || 3;
  const workingWeight = getAccessoryWeight(swap.suggestedId, store.workoutSession.mainLift);
  const previousId = accessories[replaceIdx].exerciseId;

  accessories[replaceIdx] = {
    exerciseId: swap.suggestedId,
    name: suggested.name,
    setWeights: computeSetWeights(workingWeight, targetSets),
    targetSets,
    repRange: suggested.repRange || [8, 12],
    equipment: suggested.equipment || 'barbell',
    setsCompleted: [],
    progressed: false,
    _swappedFrom: previousId,
  };

  store.saveWorkoutSession();
}
