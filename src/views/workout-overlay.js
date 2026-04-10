/**
 * Workout overlay — full-screen workout view with main sets
 * and accessory exercises.
 *
 * Manages session lifecycle: create, resume, render, complete, discard.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { WEIGHT_INCREMENT_KG, WEIGHT_INCREMENT_LBS } from '../constants/thresholds.js';
import { LBS_PER_KG } from '../constants/formulas.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { EXERCISE_CATALOG, PROGRESSION_MODELS } from '../data/exercise-catalog.js';
import { resolveExercise, resolveCanonicalId, getExerciseHistory } from '../data/exercise-compat.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { formatWeight, displayWeight } from '../formulas/units.js';
import { formatPlates, roundToPlate } from '../formulas/plates.js';
import {
  getProgramWorkout,
  findFirstIncompleteWeek,
  checkAutoProgression,
  applyProgression,
} from '../systems/programs.js';
import {
  selectAccessories,
  selectSmartAccessories,
  computeSetWeights,
  getAccessoryWeight,
  checkAccessoryProgression,
  scoreAccessories,
} from '../systems/workout-builder.js';
import {
  generateSessionPlan,
  evaluateSetCompletion,
  gradeSession,
  applyAdjustments,
  applyBBBAdjustment,
} from '../systems/session-optimizer.js';
import { renderCoachingCard, renderSetEvaluationChip, renderSessionGrade } from '../views/session-coach-ui.js';
import { showToast } from '../ui/toast.js';
import {
  startTimer,
  ensureAudioContext,
  startExerciseTimer,
  stopExerciseTimer,
  cancelExerciseTimer,
} from '../ui/timer.js';

// ---------------------------------------------------------------------------
// Progression badge text (category-specific)
// ---------------------------------------------------------------------------

function getProgressionBadgeText(acc) {
  const catalogEx = resolveExercise(acc.exerciseId);
  if (!catalogEx) return 'WEIGHT UP';
  const pType = catalogEx.progressionType;
  const model = PROGRESSION_MODELS[pType];
  if (!model) return 'WEIGHT UP';

  if (pType === 'close-variation') return `${Math.round((catalogEx.pctOfTM[store.workoutSession?.mainLift] || 0.65) * 100)}% TM`;
  if (pType === 'isolation') {
    const inc = store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
    return `+${inc}${store.unit}`;
  }
  if (pType === 'compound') {
    const inc = store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
    return `+${inc}${store.unit}`;
  }
  if (pType === 'bodyweight') {
    // Check current weight context
    const weight = acc.setWeights ? acc.setWeights[0] : 0;
    if (weight < 0) return 'Less assist';
    if (weight === 0) {
      const topReps = catalogEx.repRange ? catalogEx.repRange[1] : 12;
      return `Hit ${topReps}? Add weight`;
    }
    const inc = store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
    return `+${inc}${store.unit}`;
  }
  if (pType === 'time') return `+${model.increment}s`;
  return 'WEIGHT UP';
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = {};

/**
 * Inject dependencies to avoid circular imports.
 */
export function setWorkoutOverlayDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLastMainPerformance(lift) {
  const recent = store.entries.filter(e => e.lift === lift).sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!recent) return null;
  return { weight: recent.weight, reps: recent.reps, e1rm: recent.e1rm, date: recent.date };
}

function getLastAccPerformance(exerciseId) {
  const canonId = resolveCanonicalId(exerciseId);
  const history = getExerciseHistory(canonId, store.accessoryLog);
  const recent = history[0];
  if (!recent) return null;
  return { weight: recent.weight, setWeights: recent.setWeights, setsCompleted: recent.setsCompleted, date: recent.date };
}

function createWorkoutSession(mainLift) {
  const now = new Date();
  const workout = getProgramWorkout(mainLift, findFirstIncompleteWeek(mainLift));

  // Check if program has BBB supplemental sets — reduce accessories accordingly
  const hasBBB = workout ? workout.sets.some(s => s.tier === 'BBB') : false;
  const accCount = hasBBB ? 3 : 5;
  const accessories = hasBBB ? selectSmartAccessories(mainLift, accCount) : selectAccessories(mainLift);

  const session = {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    mainLift,
    programWeek: findFirstIncompleteWeek(mainLift),
    date: now.toISOString().split('T')[0],
    startTime: now.getTime(),
    mainSets: [],
    bbbSets: [],
    accessories: accessories.map(ex => ({
      exerciseId: ex.id,
      name: ex.name,
      setWeights: computeSetWeights(getAccessoryWeight(ex.id, mainLift), ex.sets),
      targetSets: ex.sets,
      repRange: ex.repRange,
      equipment: ex.equipment,
      setsCompleted: [],
      progressed: checkAccessoryProgression(ex.id, mainLift)
    })),
    completed: false
  };
  // Clone program sets if active, separating BBB supplemental
  if (workout) {
    const mainOnly = workout.sets.filter(s => s.tier !== 'BBB');
    const bbbOnly = workout.sets.filter(s => s.tier === 'BBB');
    session.mainSets = mainOnly.map(s => ({
      num: s.num, weight: s.weight, reps: s.reps, pct: s.pct,
      tier: s.tier, day: s.day, completed: s.completed
    }));
    session.bbbSets = bbbOnly.map((s, i) => ({
      num: i + 1, weight: s.weight, reps: s.reps, pct: s.pct,
      tier: 'BBB', completed: false
    }));
  }
  store.workoutSession = session;
  store.saveWorkoutSession();

  // Session Optimizer: generate coaching plan
  generateSessionPlan(mainLift, session);

  return session;
}

function updateCompleteButton() {
  const btn = $('workout-complete-btn');
  if (!store.workoutSession) { btn.disabled = true; return; }
  const hasProgress = store.workoutSession.mainSets.some(s => s.completed) ||
    (store.workoutSession.bbbSets && store.workoutSession.bbbSets.some(s => s.completed)) ||
    store.workoutSession.accessories.some(a => a.setsCompleted.length > 0);
  btn.disabled = !hasProgress;
}

// ---------------------------------------------------------------------------
// Complete main set (logs immediately, RPE slider shown after)
// ---------------------------------------------------------------------------

// Track the entry ID of the last completed main set (for RPE slider update)
let _lastMainEntryId = null;

function _completeMainSet(idx) {
  const set = store.workoutSession.mainSets[idx];
  if (!set || set.completed) return;
  const week = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[store.workoutSession.mainLift] || 1);
  const isAmrap = typeof set.reps === 'string' && set.reps.toString().includes('+');
  let repsToLog = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
  if (isAmrap) {
    const amrapInput = document.querySelector(`[data-main-amrap="${idx}"]`);
    if (amrapInput && amrapInput.value) repsToLog = parseInt(amrapInput.value);
  }
  const result = _deps.addEntry?.(store.workoutSession.mainLift, set.weight, repsToLog, null, '', []) ?? null;
  _lastMainEntryId = result ? result.entry.id : null;
  // Track entry for discard rollback
  if (result && result.entry) {
    if (!store.workoutSession.loggedEntryIds) store.workoutSession.loggedEntryIds = [];
    store.workoutSession.loggedEntryIds.push(result.entry.id);
  }
  _deps.updateDashboard?.();
  set.completed = true;
  set.rpe = null;
  set.entryId = _lastMainEntryId;
  store.programConfig.completedSets[`${store.workoutSession.mainLift}-${week}-${idx}`] = true;
  if (isAmrap && repsToLog) {
    store.programConfig.amrapResults[`${store.workoutSession.mainLift}-${week}-${idx}`] = repsToLog;
  }
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  if (tmpl && tmpl.progression && tmpl.progression.type === 'session') {
    const progResult = checkAutoProgression(store.workoutSession.mainLift);
    if (progResult) applyProgression(progResult);
  }
  store.saveProgramConfig();
  store.saveWorkoutSession();
  startTimer(store.timerDuration);
  if (navigator.vibrate) navigator.vibrate(50);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Re-render the workout overlay body (main sets + accessories).
 */
export function renderWorkoutView() {
  if (!store.workoutSession) return;
  const body = $('workout-body');
  const lift = store.workoutSession.mainLift;
  $('workout-title').textContent = LIFT_NAMES[lift] + ' Workout';
  const weekLabel = store.workoutSession.programWeek ? ` \u2014 Week ${store.workoutSession.programWeek}` : '';
  $('workout-subtitle').textContent = store.workoutSession.date + weekLabel;
  let html = '';

  // Session Optimizer coaching card
  if (store._sessionOptimizer && store._sessionOptimizer.plan) {
    html += renderCoachingCard(store._sessionOptimizer.plan);
  }

  // Main lift section
  html += `<div class="workout-exercise main-lift ${lift}">`;
  html += `<div class="workout-exercise-name">${LIFT_NAMES[lift]}</div>`;
  const lastMain = getLastMainPerformance(lift);
  if (lastMain) {
    html += `<div class="prev-perf">Last: ${formatWeight(lastMain.weight)} ${store.unit} &times; ${lastMain.reps} = ${formatWeight(lastMain.e1rm)} e1RM <span class="prev-perf-date">${lastMain.date}</span></div>`;
  }
  if (store.workoutSession.mainSets.length > 0) {
    html += `<div class="workout-exercise-meta">Program sets \u2014 tap to log</div>`;
    store.workoutSession.mainSets.forEach((s, i) => {
      if (s._dropped) return; // Dropped by session optimizer
      const isAmrap = typeof s.reps === 'string' && s.reps.toString().includes('+');
      const repDisplay = s.reps;
      const plateStr = formatPlates(s.weight);
      const rpeLabel = s.completed && s.rpe ? ` @ RPE ${s.rpe}` : '';
      html += `<div class="workout-set-row${s.completed ? ' completed' : ''}" data-type="main" data-idx="${i}">
        <div class="workout-set-check">${s.completed ? '&#10003;' : ''}</div>
        <div class="workout-set-info">
          Set ${s.num}: ${formatWeight(s.weight)} ${store.unit} &times; ${repDisplay}${rpeLabel}
          ${s.pct ? `<span style="color:var(--text-dim);font-size:var(--text-xs)"> (${s.pct}%)</span>` : ''}
          ${isAmrap ? '<span class="amrap-badge">AMRAP</span>' : ''}
          ${plateStr ? `<div class="plate-display">${plateStr} /side</div>` : ''}
        </div>
        ${isAmrap ? `<input type="number" class="workout-set-input" data-main-amrap="${i}" placeholder="${parseInt(s.reps)}" min="1" inputmode="numeric" ${s.completed ? 'disabled' : ''}>` : ''}
      </div>`;
    });
    html += `<button class="workout-add-set-btn" data-add-main-set>+ Add Set</button>`;
  } else {
    html += `<div class="workout-no-program">No active program. Log your main lift from the Log tab, then come back for accessories.</div>`;
  }
  html += `</div>`;

  // BBB supplemental section (between main lifts and accessories)
  if (store.workoutSession.bbbSets && store.workoutSession.bbbSets.length > 0) {
    html += `<div class="workout-exercise bbb-section">`;
    html += `<div class="workout-exercise-name" style="color:var(--text-dim)">Supplemental (BBB)</div>`;
    const activeBBB = store.workoutSession.bbbSets.filter(s => !s._dropped);
    html += `<div class="workout-exercise-meta">${activeBBB.length}&times;${store.workoutSession.bbbSets[0].reps} at ${store.workoutSession.bbbSets[0].pct}%</div>`;
    activeBBB.forEach((s, i) => {
      const plateStr = formatPlates(s.weight);
      const origIdx = store.workoutSession.bbbSets.indexOf(s);
      html += `<div class="workout-set-row${s.completed ? ' completed' : ''}" data-type="bbb" data-idx="${origIdx}">
        <div class="workout-set-check">${s.completed ? '&#10003;' : ''}</div>
        <div class="workout-set-info">
          Set ${i + 1}: ${formatWeight(s.weight)} ${store.unit} &times; ${s.reps}
          <span style="color:var(--text-dim);font-size:var(--text-xs)"> (${s.pct}%)</span>
          ${plateStr ? `<div class="plate-display">${plateStr} /side</div>` : ''}
        </div>
      </div>`;
    });
    html += `<button class="workout-add-set-btn" data-add-bbb-set>+ Add Set</button>`;
    html += `</div>`;
  }

  // Accessory sections — #20: group supersets visually
  store.workoutSession.accessories.forEach((acc, ai) => {
    const prevAcc = ai > 0 ? store.workoutSession.accessories[ai - 1] : null;
    const nextAcc = ai < store.workoutSession.accessories.length - 1 ? store.workoutSession.accessories[ai + 1] : null;
    if (acc.groupId && (!prevAcc || prevAcc.groupId !== acc.groupId)) {
      html += `<div class="superset-group"><div class="superset-label">Superset</div>`;
    }
    const ex = ACCESSORY_DB[acc.exerciseId];
    const catalogEx = resolveExercise(acc.exerciseId);
    const isBodyweight = catalogEx ? catalogEx.progressionType === 'bodyweight' : (!ex || ex.pctOfTM === 0);
    const isTimeBased = catalogEx ? !!catalogEx.timeBased : !!(ex && ex.timeBased);
    const targetReps = acc.repRange[1];
    html += `<div class="workout-exercise">`;
    html += `<div class="workout-exercise-name" data-exid="${acc.exerciseId}" data-acc-toggle="${ai}">${acc.name}${acc.progressed ? `<span class="acc-progression-badge">${getProgressionBadgeText(acc)}</span>` : ''}</div>`;
    html += `<div class="acc-action-bar" id="acc-action-bar-${ai}" style="display:none">
      <button class="acc-swap-btn" data-acc-swap="${ai}">&#8644; Swap</button>
      <button class="acc-remove-btn" data-acc-remove="${ai}">&times; Remove</button>
    </div>`;
    const accLogs = store.accessoryLog.filter(l => l.exerciseId === acc.exerciseId);
    const accLogCount = new Set(accLogs.map(l => l.date)).size;
    const accBestWeight = isBodyweight
      ? accLogs.reduce((best, l) => Math.max(best, l.weight), -Infinity)
      : accLogs.reduce((max, l) => Math.max(max, l.weight), 0);
    const hasBestWeight = accLogs.length > 0 && (isBodyweight || accBestWeight > 0);
    const currentTopWeight = acc.setWeights ? acc.setWeights[acc.setWeights.length - 1] : 0;
    const isNewHigh = hasBestWeight && currentTopWeight > accBestWeight;
    let metaParts = [acc.equipment];
    metaParts.push(`hit ${targetReps}${isTimeBased ? 's' : ' reps'} on all sets to progress`);
    if (accLogCount > 0) metaParts.push(`${accLogCount} session${accLogCount !== 1 ? 's' : ''}`);
    if (hasBestWeight && !isNewHigh) {
      if (isBodyweight) {
        const bestLabel = accBestWeight < 0 ? `Assisted ${formatWeight(Math.abs(accBestWeight))}` : accBestWeight === 0 ? 'BW' : `BW +${formatWeight(accBestWeight)}`;
        metaParts.push(`best: ${bestLabel} ${store.unit}`);
      } else {
        metaParts.push(`best: ${formatWeight(accBestWeight)} ${store.unit}`);
      }
    }
    html += `<div class="workout-exercise-meta">${metaParts.join(' &bull; ')}${isNewHigh ? ' <span class="acc-new-high">New High!</span>' : ''}</div>`;
    const lastAcc = getLastAccPerformance(acc.exerciseId);
    if (lastAcc) {
      let lastWeight;
      if (isBodyweight && lastAcc.weight < 0) {
        lastWeight = `Assisted ${formatWeight(Math.abs(lastAcc.weight))} ${store.unit}`;
      } else if (isBodyweight && lastAcc.weight === 0) {
        lastWeight = 'BW';
      } else if (isBodyweight && lastAcc.weight > 0) {
        lastWeight = `BW +${formatWeight(lastAcc.weight)} ${store.unit}`;
      } else if (lastAcc.weight === 0) {
        lastWeight = 'BW';
      } else if (lastAcc.setWeights && lastAcc.setWeights.length > 1 && new Set(lastAcc.setWeights).size > 1) {
        lastWeight = lastAcc.setWeights.map(w => formatWeight(w)).join('/') + ' ' + store.unit;
      } else {
        lastWeight = formatWeight(lastAcc.weight) + ' ' + store.unit;
      }
      const lastReps = lastAcc.setsCompleted.join('/');
      html += `<div class="prev-perf">Last: ${lastWeight} &times; ${lastReps}${isTimeBased ? 's' : ' reps'} <span class="prev-perf-date">${lastAcc.date}</span></div>`;
    }

    // Set rows with per-set weights
    for (let si = 0; si < acc.targetSets; si++) {
      const done = si < acc.setsCompleted.length;
      const repsVal = done ? acc.setsCompleted[si] : '';
      const repTarget = isTimeBased ? `${targetReps}s` : targetReps;
      let setWeight;
      if (isBodyweight) {
        const w = acc.setWeights ? acc.setWeights[si] : 0;
        if (w < 0) setWeight = `Assisted ${formatWeight(Math.abs(w))} ${store.unit}`;
        else if (w === 0) setWeight = 'BW';
        else setWeight = `BW +${formatWeight(w)} ${store.unit}`;
      } else {
        setWeight = `${formatWeight(acc.setWeights[si])} ${store.unit}`;
      }
      const isCountingDown = isTimeBased && store.exerciseTimer && store.exerciseTimer.accIdx === ai && store.exerciseTimer.setIdx === si;
      html += `<div class="workout-set-row${done ? ' completed' : ''}${isCountingDown ? ' counting-down' : ''}" data-type="acc" data-acc="${ai}" data-set="${si}"${isTimeBased ? ' data-time-based="true"' : ''}>
        <div class="workout-set-check">${done ? '&#10003;' : ''}</div>
        <div class="workout-set-info">
          Set ${si + 1}: ${isTimeBased
            ? (isBodyweight
              ? (done ? repsVal + 's' : repTarget)
              : `${setWeight} &times; ${done ? repsVal + 's' : repTarget}`)
            : `${setWeight} &times; ${done ? repsVal : repTarget}${done ? ' reps' : ''}`}
        </div>
        ${!done && isTimeBased ? (isCountingDown
          ? `<div class="exercise-countdown">
              <span class="exercise-countdown-display" id="exercise-cd-${ai}-${si}">${store.exerciseTimer.remaining}s</span>
              <button class="exercise-countdown-cancel">&times;</button>
            </div>`
          : `<button class="exercise-start-btn">&#9201; Start</button>
            <div class="acc-set-weight-controls">
              <button class="acc-time-adj-btn" data-acc="${ai}" data-dir="-1">&minus;</button>
              <button class="acc-time-adj-btn" data-acc="${ai}" data-dir="1">+</button>
            </div>`)
        : ''}
        ${!done && !isTimeBased ? `<div class="acc-set-weight-controls">
          <button class="acc-set-weight-btn" data-acc="${ai}" data-set="${si}" data-dir="-1">&minus;</button>
          <button class="acc-set-weight-btn" data-acc="${ai}" data-set="${si}" data-dir="1">+</button>
        </div>` : ''}
        ${!done && !isTimeBased ? `<input type="number" class="workout-set-input" data-acc-input="${ai}-${si}" placeholder="${targetReps}" min="1" inputmode="numeric">` : ''}
      </div>`;
    }
    html += `<button class="workout-add-set-btn small" data-add-acc-set="${ai}">+ Set</button>`;
    html += `</div>`;
    // #20: Close superset group container
    if (acc.groupId && (!nextAcc || nextAcc.groupId !== acc.groupId)) {
      html += `</div>`;
    }
  });

  // Add Exercise button
  html += `<button class="workout-add-exercise-btn" id="workout-add-exercise">+ Add Exercise</button>`;
  html += `<div id="workout-exercise-picker" style="display:none"></div>`;

  body.innerHTML = html;
  updateCompleteButton();
}

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

/**
 * Open the workout overlay — resume or create a session.
 * @param {string} mainLift - 'squat' | 'bench' | 'deadlift'
 */
export function openWorkoutView(mainLift) {
  // Check if weak points configured
  if (!store.workoutConfig.weakPoints[mainLift]) {
    _deps.showWeakPointSetupModal?.(mainLift);
    return;
  }
  // Resume or create session
  if (store.workoutSession && store.workoutSession.mainLift === mainLift && !store.workoutSession.completed) {
    // Sync main set completion state
    const sessionWeek = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[mainLift] || 1);
    if (store.workoutSession.mainSets.length > 0) {
      store.workoutSession.mainSets.forEach((s, i) => {
        s.completed = !!store.programConfig.completedSets[`${mainLift}-${sessionWeek}-${i}`];
      });
    }
    // Migrate old-format sessions
    store.workoutSession.accessories.forEach(acc => {
      if (acc.weight !== undefined && !acc.setWeights) {
        acc.setWeights = computeSetWeights(acc.weight, acc.targetSets);
        delete acc.weight;
      }
    });
  } else {
    // Warn if there's an in-progress session for a different lift
    if (store.workoutSession && !store.workoutSession.completed && store.workoutSession.mainLift !== mainLift) {
      const hasProgress = store.workoutSession.mainSets.some(s => s.completed) ||
        store.workoutSession.accessories.some(a => a.setsCompleted.length > 0);
      if (hasProgress && !confirm(`You have an in-progress ${LIFT_NAMES[store.workoutSession.mainLift]} workout. Discard it and start ${LIFT_NAMES[mainLift]}?`)) return;
    }
    createWorkoutSession(mainLift);
  }
  $('workout-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderWorkoutView();
}

/**
 * Close the workout overlay.
 */
export function closeWorkoutView() {
  stopExerciseTimer();
  $('workout-overlay').style.display = 'none';
  document.body.style.overflow = '';
  _deps.updateWorkoutButton?.();
}

// ---------------------------------------------------------------------------
// Complete workout
// ---------------------------------------------------------------------------

/**
 * Complete the current workout session — log accessories,
 * record mesocycle performance, and show summary.
 */
export function completeWorkout() {
  if (!store.workoutSession) return;
  const now = new Date();
  // Save each accessory's results to log
  // #18: Track source and template in accessory log
  const sessionSource = store.workoutSession.source || 'quick';
  const sessionTemplateId = store.workoutSession.templateId || null;
  store.workoutSession.accessories.forEach(acc => {
    if (acc.setsCompleted.length === 0) return;
    store.accessoryLog.push({
      id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6) + acc.exerciseId,
      exerciseId: acc.exerciseId,
      name: acc.name,
      weight: acc.setWeights[acc.setWeights.length - 1],
      setWeights: [...acc.setWeights],
      setsCompleted: [...acc.setsCompleted],
      targetSets: acc.targetSets,
      repRange: [...acc.repRange],
      date: store.workoutSession.date,
      timestamp: now.getTime(),
      mainLift: store.workoutSession.mainLift,
      source: sessionSource,
      templateId: sessionTemplateId,
    });
  });
  store.saveNow('accessoryLog');

  // #16: Offer weight updates back to template
  if (sessionTemplateId) {
    const template = store.customTemplates.find(t => t.id === sessionTemplateId);
    if (template) {
      const changed = store.workoutSession.accessories.filter(acc => {
        const tmplEx = template.exercises.find(e => e.exerciseId === acc.exerciseId);
        return tmplEx && tmplEx.weightMode === 'manual' && acc.setWeights
          && Math.abs(tmplEx.weightValue - acc.setWeights[acc.setWeights.length - 1]) > 0.1;
      });
      if (changed.length > 0) {
        setTimeout(() => {
          showToast(`${changed.length} weight${changed.length > 1 ? 's' : ''} changed`, {
            action: 'Update Template', onAction: () => {
              changed.forEach(acc => {
                const tmplEx = template.exercises.find(e => e.exerciseId === acc.exerciseId);
                if (tmplEx) tmplEx.weightValue = acc.setWeights[acc.setWeights.length - 1];
              });
              store.saveCustomTemplates();
              showToast('Template weights updated');
            }, duration: 8000,
          });
        }, 2000);
      }
    }
  }

  // Mesocycle performance recording & adaptation
  let mesoAdaptation = null;
  const completedSession = store.workoutSession;
  if (store.workoutSession.source === 'mesocycle' && store.activeMesocycle && store.activeMesocycle.status === 'active') {
    _deps.recordMesocyclePerformance?.(store.workoutSession);
    mesoAdaptation = _deps.adaptRemainingWeeks?.(store.workoutSession.mainLift) ?? null;
  }

  // Session Optimizer: grade the session
  const sessionGrade = gradeSession(completedSession);

  store.workoutSession = null;
  store._sessionOptimizer = null; // Clear ephemeral optimizer state
  store.saveWorkoutSession();
  closeWorkoutView();
  showToast('Workout complete!');
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  _deps.updateWorkoutButton?.();
  setTimeout(() => {
    _deps.showWorkoutSummary?.(completedSession, mesoAdaptation, sessionGrade);
  }, 300);
}

// ---------------------------------------------------------------------------
// Update workout button
// ---------------------------------------------------------------------------

/**
 * Update the "Start/Resume Workout" button text based on session state.
 */
export function updateWorkoutButton() {
  const btn = $('create-workout-btn');
  if (!btn) return;
  if (store.workoutSession && !store.workoutSession.completed && store.workoutSession.mainLift === store.currentLift) {
    btn.textContent = `Resume ${LIFT_NAMES[store.currentLift]} Workout`;
    btn.classList.add('has-session');
  } else if (store.activeMesocycle && store.activeMesocycle.status === 'active') {
    const week = store.activeMesocycle.weeks[store.activeMesocycle.currentWeek - 1];
    const liftDone = week && week.performance[store.currentLift];
    btn.textContent = liftDone ? `${LIFT_NAMES[store.currentLift]} - Week ${store.activeMesocycle.currentWeek} Done` : `Start ${LIFT_NAMES[store.currentLift]} Workout`;
    btn.classList.remove('has-session');
  } else {
    btn.textContent = `Start ${LIFT_NAMES[store.currentLift]} Workout`;
    btn.classList.remove('has-session');
  }
}

// ---------------------------------------------------------------------------
// Init — delegation (attached once)
// ---------------------------------------------------------------------------

/**
 * Attach event delegation for the workout overlay.
 * Call once after DOMContentLoaded.
 */
export function initWorkoutOverlay() {
  const body = $('workout-body');

  body.addEventListener('click', (e) => {
    if (!store.workoutSession) return;

    // Session Optimizer: coaching card toggle
    if (e.target.closest('[data-coach-toggle]')) {
      const card = document.getElementById('coach-card');
      if (card) card.classList.toggle('collapsed');
      return;
    }
    // Session Optimizer: Apply mid-session adjustment
    if (e.target.closest('[data-coach-apply]')) {
      const evalIdx = parseInt(e.target.closest('[data-coach-apply]').dataset.coachApply);
      const optimizer = store._sessionOptimizer;
      if (optimizer && optimizer.evaluations) {
        const evaluation = optimizer.evaluations.find(ev => ev.setIndex === evalIdx);
        if (evaluation) {
          applyAdjustments(evaluation);
          renderWorkoutView();
          showToast('Adjustments applied');
        }
      }
      return;
    }
    // Session Optimizer: Dismiss coaching chip
    if (e.target.closest('[data-coach-dismiss]')) {
      const chip = e.target.closest('.coach-chip');
      if (chip) chip.remove();
      return;
    }

    // Prevent set-input clicks from toggling the row
    if (e.target.closest('.workout-set-input')) return;

    // Toggle accessory action bar (swap/remove)
    const accNameEl = e.target.closest('[data-acc-toggle]');
    if (accNameEl) {
      const ai = accNameEl.dataset.accToggle;
      const bar = $('acc-action-bar-' + ai);
      if (bar) {
        // Close any other open action bars and alternatives
        body.querySelectorAll('.acc-action-bar').forEach(b => {
          if (b.id !== 'acc-action-bar-' + ai) b.style.display = 'none';
        });
        body.querySelectorAll('.acc-swap-alternatives').forEach(el => el.remove());
        bar.style.display = bar.style.display === 'none' ? '' : 'none';
      }
      return;
    }

    // Remove accessory
    const removeBtn = e.target.closest('.acc-remove-btn');
    if (removeBtn) {
      e.stopPropagation();
      const ai = parseInt(removeBtn.dataset.accRemove);
      const acc = store.workoutSession.accessories[ai];
      if (!confirm(`Remove ${acc.name}?`)) return;
      // Cancel/adjust timer BEFORE splicing to avoid race condition
      if (store.exerciseTimer) {
        if (store.exerciseTimer.accIdx === ai) {
          stopExerciseTimer();
        } else if (store.exerciseTimer.accIdx > ai) {
          store.exerciseTimer.accIdx--;
        }
      }
      store.workoutSession.accessories.splice(ai, 1);
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Swap accessory — show alternatives
    const swapBtn = e.target.closest('.acc-swap-btn');
    if (swapBtn) {
      e.stopPropagation();
      const ai = parseInt(swapBtn.dataset.accSwap);
      const acc = store.workoutSession.accessories[ai];
      const ex = ACCESSORY_DB[acc.exerciseId];
      const container = swapBtn.closest('.workout-exercise');
      // Toggle off if already showing
      const existing = container.querySelector('.acc-swap-alternatives');
      if (existing) { existing.remove(); return; }
      // Get alternatives excluding current equipment
      const allScored = scoreAccessories(store.workoutSession.mainLift, ex ? ex.equipment : null);
      const usedIds = new Set(store.workoutSession.accessories.map(a => a.exerciseId));
      const alternatives = allScored.filter(a => !usedIds.has(a.id)).slice(0, 5);
      if (alternatives.length === 0) {
        showToast('No alternatives available');
        return;
      }
      const altDiv = document.createElement('div');
      altDiv.className = 'acc-swap-alternatives';
      alternatives.forEach(alt => {
        const item = document.createElement('div');
        item.className = 'acc-swap-alt-item';
        const lastPerf = getLastAccPerformance(alt.id);
        const estWeight = getAccessoryWeight(alt.id, store.workoutSession.mainLift);
        let perfHtml;
        if (lastPerf) {
          const w = lastPerf.weight === 0 ? 'BW' : formatWeight(lastPerf.weight) + ' ' + store.unit;
          const reps = lastPerf.setsCompleted.join('/');
          const days = Math.round((Date.now() - new Date(lastPerf.date).getTime()) / 86400000);
          const ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : days + 'd ago';
          perfHtml = `<span class="acc-swap-alt-perf">${w} &times; ${reps} &bull; ${ago}</span>`;
        } else {
          perfHtml = estWeight > 0
            ? `<span class="acc-swap-alt-perf">No history &mdash; est. ${formatWeight(estWeight)} ${store.unit}</span>`
            : `<span class="acc-swap-alt-perf">No history</span>`;
        }
        item.innerHTML = `<div><span>${alt.name}</span><span class="acc-swap-alt-meta">${alt.equipment}</span></div><div>${perfHtml}</div>`;
        item.addEventListener('click', () => {
          const newWeight = getAccessoryWeight(alt.id, store.workoutSession.mainLift);
          const newSetWeights = computeSetWeights(newWeight, alt.sets);
          const progressed = checkAccessoryProgression(alt.id, store.workoutSession.mainLift);
          store.workoutSession.accessories[ai] = {
            exerciseId: alt.id,
            name: alt.name,
            setWeights: newSetWeights,
            targetSets: alt.sets,
            repRange: [...alt.repRange],
            equipment: alt.equipment,
            setsCompleted: [],
            progressed: !!progressed,
          };
          store.saveWorkoutSession();
          renderWorkoutView();
          showToast(`Swapped to ${alt.name}`);
        });
        altDiv.appendChild(item);
      });
      container.appendChild(altDiv);
      return;
    }

    // Per-set weight +/- buttons
    const weightBtn = e.target.closest('.acc-set-weight-btn');
    if (weightBtn) {
      e.stopPropagation();
      const ai = parseInt(weightBtn.dataset.acc);
      const si = parseInt(weightBtn.dataset.set);
      const dir = parseInt(weightBtn.dataset.dir);
      const acc = store.workoutSession.accessories[ai];
      const increment = store.unit === 'kg' ? WEIGHT_INCREMENT_KG * LBS_PER_KG : WEIGHT_INCREMENT_LBS;
      const accCatalogEx = resolveExercise(acc.exerciseId);
      const isBWExercise = accCatalogEx ? accCatalogEx.progressionType === 'bodyweight' : false;
      const newWeight = acc.setWeights[si] + dir * increment;
      acc.setWeights[si] = isBWExercise ? roundToPlate(newWeight) : roundToPlate(Math.max(0, newWeight));
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Time-based +/- buttons
    const timeBtn = e.target.closest('.acc-time-adj-btn');
    if (timeBtn) {
      e.stopPropagation();
      const ai = parseInt(timeBtn.dataset.acc);
      const dir = parseInt(timeBtn.dataset.dir);
      const acc = store.workoutSession.accessories[ai];
      acc.repRange[1] = Math.max(5, acc.repRange[1] + dir * 5);
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Add Set — Main lift
    if (e.target.closest('[data-add-main-set]')) {
      const sets = store.workoutSession.mainSets;
      if (sets.length > 0) {
        const last = sets[sets.length - 1];
        sets.push({ ...last, num: sets.length + 1, completed: false });
        store.saveWorkoutSession();
        renderWorkoutView();
      }
      return;
    }

    // Add Set — BBB
    if (e.target.closest('[data-add-bbb-set]')) {
      const sets = store.workoutSession.bbbSets;
      if (sets && sets.length > 0) {
        const last = sets[sets.length - 1];
        sets.push({ ...last, num: sets.length + 1, completed: false });
        store.saveWorkoutSession();
        renderWorkoutView();
      }
      return;
    }

    // Add Set — Accessory
    const addAccSetBtn = e.target.closest('[data-add-acc-set]');
    if (addAccSetBtn) {
      const ai = parseInt(addAccSetBtn.dataset.addAccSet);
      const acc = store.workoutSession.accessories[ai];
      acc.targetSets += 1;
      const lastWeight = acc.setWeights[acc.setWeights.length - 1] || 0;
      acc.setWeights.push(lastWeight);
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Add Exercise — show picker
    if (e.target.closest('#workout-add-exercise')) {
      const picker = document.getElementById('workout-exercise-picker');
      if (picker.style.display !== 'none') {
        picker.style.display = 'none';
        return;
      }
      const mainLift = store.workoutSession.mainLift;
      const usedIds = new Set(store.workoutSession.accessories.map(a => a.exerciseId));
      const scored = scoreAccessories(mainLift).filter(ex => !usedIds.has(ex.id) && ex.equipAvailable !== false);
      const picks = scored.slice(0, 8);
      if (picks.length === 0) {
        showToast('No more exercises available');
        return;
      }
      let pickerHtml = '<div class="workout-exercise-picker-list">';
      picks.forEach(ex => {
        const weight = getAccessoryWeight(ex.id, mainLift);
        const weightStr = (ex.progressionType === 'bodyweight') ? 'BW'
          : (ex.progressionType === 'time') ? 'Timed'
          : weight > 0 ? `${formatWeight(weight)} ${store.unit}` : '—';
        pickerHtml += `<div class="workout-exercise-pick" data-pick-exercise="${ex.id}">
          <span class="pick-name">${ex.name}</span>
          <span class="pick-meta">${ex.equipment} &bull; ${ex.sets}x${ex.repRange[1]} &bull; ${weightStr}</span>
        </div>`;
      });
      pickerHtml += '</div>';
      picker.innerHTML = pickerHtml;
      picker.style.display = '';
      return;
    }

    // Pick exercise from picker
    const pickEx = e.target.closest('[data-pick-exercise]');
    if (pickEx) {
      const exId = pickEx.dataset.pickExercise;
      const mainLift = store.workoutSession.mainLift;
      const catalogEx = EXERCISE_CATALOG[exId];
      if (!catalogEx) return;
      const weight = getAccessoryWeight(exId, mainLift);
      const sets = catalogEx.sets || 3;
      const progressed = checkAccessoryProgression(exId, mainLift);
      store.workoutSession.accessories.push({
        exerciseId: exId,
        name: catalogEx.name,
        setWeights: computeSetWeights(weight, sets),
        targetSets: sets,
        repRange: catalogEx.repRange ? [...catalogEx.repRange] : [8, 12],
        equipment: catalogEx.equipment,
        setsCompleted: [],
        progressed: !!progressed,
      });
      store.saveWorkoutSession();
      renderWorkoutView();
      showToast(`Added ${catalogEx.name}`);
      return;
    }

    // RPE slider input (update entry RPE in real-time)
    if (e.target.classList.contains('rpe-slider')) return; // handled by input event below

    // Main set row clicks
    const mainRow = e.target.closest('.workout-set-row[data-type="main"]');
    if (mainRow) {
      const idx = parseInt(mainRow.dataset.idx);
      const set = store.workoutSession.mainSets[idx];
      const week = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[store.workoutSession.mainLift] || 1);
      if (set.completed) {
        set.completed = false;
        delete set.rpe;
        delete set.entryId;
        delete store.programConfig.completedSets[`${store.workoutSession.mainLift}-${week}-${idx}`];
        delete store.programConfig.amrapResults[`${store.workoutSession.mainLift}-${week}-${idx}`];
        store.saveProgramConfig();
        store.saveWorkoutSession();
        renderWorkoutView();
        if (_renderProgramSection) _renderProgramSection();
      } else {
        // Log immediately, then show RPE slider
        _completeMainSet(idx);
        // Remove any existing slider
        const existing = document.querySelector('.workout-rpe-row');
        if (existing) existing.remove();
        // Re-render to show completed state
        renderWorkoutView();
        if (_renderProgramSection) _renderProgramSection();
        // Insert slider after the now-completed row
        const completedRow = document.querySelector(`.workout-set-row[data-type="main"][data-idx="${idx}"]`);
        if (completedRow) {
          const rpeRow = document.createElement('div');
          rpeRow.className = 'workout-rpe-row';
          rpeRow.dataset.idx = idx;
          rpeRow.innerHTML = `<span class="rpe-row-label">1</span>` +
            `<input type="range" class="rpe-slider" min="1" max="10" step="1" value="8">` +
            `<span class="rpe-row-label">10</span>` +
            `<span class="rpe-slider-value">8</span>`;
          completedRow.after(rpeRow);
          // Attach slider input event
          const slider = rpeRow.querySelector('.rpe-slider');
          const valueDisplay = rpeRow.querySelector('.rpe-slider-value');
          slider.addEventListener('input', () => {
            const rpeVal = parseInt(slider.value);
            valueDisplay.textContent = rpeVal;
            // Update the entry's RPE
            set.rpe = rpeVal;
            if (set.entryId) {
              const entry = store.entries.find(e => e.id === set.entryId);
              if (entry) { entry.rpe = rpeVal; store.saveEntries(); }
            }
            store.saveWorkoutSession();
            // Update the set row display
            const infoEl = completedRow.querySelector('.workout-set-info');
            if (infoEl) {
              infoEl.innerHTML = infoEl.innerHTML.replace(/ @ RPE \d+/g, '').replace(/(×\s*\d+)/,  `$1 @ RPE ${rpeVal}`);
            }
          });
          // Session Optimizer: evaluate after RPE is set (debounced on change)
          slider.addEventListener('change', () => {
            const rpeVal = parseInt(slider.value);
            const reps = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
            const evaluation = evaluateSetCompletion(idx, rpeVal, reps, set.weight);
            if (evaluation && evaluation.drift !== 'on-track') {
              // Remove any existing chip for this set
              const existingChip = document.querySelector(`.coach-chip[data-eval-idx="${idx}"]`);
              if (existingChip) existingChip.remove();
              // Insert coaching chip after RPE row
              const chipHtml = renderSetEvaluationChip(evaluation);
              if (chipHtml) {
                const chipContainer = document.createElement('div');
                chipContainer.innerHTML = chipHtml;
                rpeRow.after(chipContainer.firstElementChild);
              }
            }
          });
        }
      }
      return;
    }

    // BBB supplemental set row clicks
    const bbbRow = e.target.closest('.workout-set-row[data-type="bbb"]');
    if (bbbRow) {
      const idx = parseInt(bbbRow.dataset.idx);
      const set = store.workoutSession.bbbSets[idx];
      if (set.completed) {
        set.completed = false;
      } else {
        set.completed = true;
        // Log as an entry for volume tracking
        const reps = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
        const bbbResult = _addEntry ? _addEntry(store.workoutSession.mainLift, set.weight, reps, null, '', ['BBB']) : null;
        if (bbbResult && bbbResult.entry) {
          if (!store.workoutSession.loggedEntryIds) store.workoutSession.loggedEntryIds = [];
          store.workoutSession.loggedEntryIds.push(bbbResult.entry.id);
        }
        if (_updateDashboard) _updateDashboard();
        startTimer(store.timerDuration);
        if (navigator.vibrate) navigator.vibrate(50);
      }
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Accessory set row clicks
    const accRow = e.target.closest('.workout-set-row[data-type="acc"]');
    if (accRow) {
      const ai = parseInt(accRow.dataset.acc);
      const si = parseInt(accRow.dataset.set);
      const acc = store.workoutSession.accessories[ai];
      const ex = ACCESSORY_DB[acc.exerciseId];
      const isTimeBased = !!(ex && ex.timeBased);

      if (e.target.closest('.exercise-countdown-cancel')) {
        e.stopPropagation();
        cancelExerciseTimer();
        return;
      }

      if (e.target.closest('.exercise-start-btn')) {
        e.stopPropagation();
        ensureAudioContext();
        if (si === acc.setsCompleted.length) {
          startExerciseTimer(ai, si);
        }
        return;
      }

      if (isTimeBased && si >= acc.setsCompleted.length) return;

      if (si < acc.setsCompleted.length) {
        if (si === acc.setsCompleted.length - 1) {
          acc.setsCompleted.pop();
        }
      } else if (si === acc.setsCompleted.length) {
        const input = accRow.querySelector('.workout-set-input');
        const reps = input && input.value ? parseInt(input.value) : acc.repRange[1];
        acc.setsCompleted.push(reps);
        startTimer(store.timerDuration);
        if (navigator.vibrate) navigator.vibrate(50);
      }
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }
  });

  // Complete & discard buttons
  $('workout-complete-btn').addEventListener('click', completeWorkout);
  $('workout-close').addEventListener('click', closeWorkoutView);
  $('workout-discard-btn').addEventListener('click', () => {
    if (!confirm('Discard this workout? All progress will be lost.')) return;
    stopExerciseTimer();
    // Remove any entries logged during this session
    if (store.workoutSession && store.workoutSession.loggedEntryIds) {
      const idsToRemove = new Set(store.workoutSession.loggedEntryIds);
      store.entries = store.entries.filter(e => !idsToRemove.has(e.id));
      store.prs = store.prs.filter(p => !idsToRemove.has(p.entryId));
      store.saveEntries();
      store.savePRs();
    }
    // Undo any completed set flags in program config
    if (store.workoutSession && store.workoutSession.mainSets) {
      const lift = store.workoutSession.mainLift;
      const week = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[lift] || 1);
      store.workoutSession.mainSets.forEach((s, i) => {
        if (s.completed) {
          delete store.programConfig.completedSets[`${lift}-${week}-${i}`];
          delete store.programConfig.amrapResults[`${lift}-${week}-${i}`];
        }
      });
      store.saveProgramConfig();
    }
    store.workoutSession = null;
    store.saveWorkoutSession();
    closeWorkoutView();
    if (_updateDashboard) _updateDashboard();
    showToast('Workout discarded');
  });
}
