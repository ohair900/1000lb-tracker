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
  computeSetWeights,
  getAccessoryWeight,
  checkAccessoryProgression,
  scoreAccessories,
} from '../systems/workout-builder.js';
import { showToast } from '../ui/toast.js';
import {
  startTimer,
  ensureAudioContext,
  startExerciseTimer,
  stopExerciseTimer,
  cancelExerciseTimer,
} from '../ui/timer.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _updateDashboard = null;
let _addEntry = null;
let _renderProgramSection = null;
let _updateWorkoutButton = null;
let _showWorkoutSummary = null;
let _showWeakPointSetupModal = null;
let _recordMesocyclePerformance = null;
let _adaptRemainingWeeks = null;

/**
 * Inject dependencies to avoid circular imports.
 */
export function setWorkoutOverlayDeps(deps) {
  if (deps.updateDashboard) _updateDashboard = deps.updateDashboard;
  if (deps.addEntry) _addEntry = deps.addEntry;
  if (deps.renderProgramSection) _renderProgramSection = deps.renderProgramSection;
  if (deps.updateWorkoutButton) _updateWorkoutButton = deps.updateWorkoutButton;
  if (deps.showWorkoutSummary) _showWorkoutSummary = deps.showWorkoutSummary;
  if (deps.showWeakPointSetupModal) _showWeakPointSetupModal = deps.showWeakPointSetupModal;
  if (deps.recordMesocyclePerformance) _recordMesocyclePerformance = deps.recordMesocyclePerformance;
  if (deps.adaptRemainingWeeks) _adaptRemainingWeeks = deps.adaptRemainingWeeks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLastMainPerformance(lift) {
  const recent = store.entries.filter(e => e.lift === lift).sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!recent) return null;
  return { weight: recent.weight, reps: recent.reps, e1rm: recent.e1rm, date: recent.date };
}

function getLastAccPerformance(exerciseId) {
  const recent = store.accessoryLog.filter(l => l.exerciseId === exerciseId).sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!recent) return null;
  return { weight: recent.weight, setWeights: recent.setWeights, setsCompleted: recent.setsCompleted, date: recent.date };
}

function createWorkoutSession(mainLift) {
  const now = new Date();
  const accessories = selectAccessories(mainLift);
  const session = {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    mainLift,
    programWeek: findFirstIncompleteWeek(mainLift),
    date: now.toISOString().split('T')[0],
    startTime: now.getTime(),
    mainSets: [],
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
  // Clone program sets if active
  const workout = getProgramWorkout(mainLift, session.programWeek);
  if (workout) {
    session.mainSets = workout.sets.map(s => ({
      num: s.num, weight: s.weight, reps: s.reps, pct: s.pct,
      tier: s.tier, day: s.day, completed: s.completed
    }));
  }
  store.workoutSession = session;
  store.saveWorkoutSession();
  return session;
}

function updateCompleteButton() {
  const btn = $('workout-complete-btn');
  if (!store.workoutSession) { btn.disabled = true; return; }
  const hasProgress = store.workoutSession.mainSets.some(s => s.completed) ||
    store.workoutSession.accessories.some(a => a.setsCompleted.length > 0);
  btn.disabled = !hasProgress;
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
      const isAmrap = typeof s.reps === 'string' && s.reps.toString().includes('+');
      const repDisplay = s.reps;
      const plateStr = formatPlates(s.weight);
      html += `<div class="workout-set-row${s.completed ? ' completed' : ''}" data-type="main" data-idx="${i}">
        <div class="workout-set-check">${s.completed ? '&#10003;' : ''}</div>
        <div class="workout-set-info">
          Set ${s.num}: ${formatWeight(s.weight)} ${store.unit} &times; ${repDisplay}
          ${s.pct ? `<span style="color:var(--text-dim);font-size:var(--text-xs)"> (${s.pct}%)</span>` : ''}
          ${isAmrap ? '<span class="amrap-badge">AMRAP</span>' : ''}
          ${plateStr ? `<div class="plate-display">${plateStr} /side</div>` : ''}
        </div>
        ${isAmrap ? `<input type="number" class="workout-set-input" data-main-amrap="${i}" placeholder="${parseInt(s.reps)}" min="1" inputmode="numeric" ${s.completed ? 'disabled' : ''}>` : ''}
      </div>`;
    });
  } else {
    html += `<div class="workout-no-program">No active program. Log your main lift from the Log tab, then come back for accessories.</div>`;
  }
  html += `</div>`;

  // Accessory sections
  store.workoutSession.accessories.forEach((acc, ai) => {
    const ex = ACCESSORY_DB[acc.exerciseId];
    const isBodyweight = !ex || ex.pctOfTM === 0;
    const isTimeBased = !!(ex && ex.timeBased);
    const targetReps = acc.repRange[1];
    html += `<div class="workout-exercise">`;
    html += `<div class="workout-exercise-name" data-exid="${acc.exerciseId}" data-acc-toggle="${ai}">${acc.name}${acc.progressed ? '<span class="acc-progression-badge">WEIGHT UP</span>' : ''}</div>`;
    html += `<div class="acc-action-bar" id="acc-action-bar-${ai}" style="display:none">
      <button class="acc-swap-btn" data-acc-swap="${ai}">&#8644; Swap</button>
      <button class="acc-remove-btn" data-acc-remove="${ai}">&times; Remove</button>
    </div>`;
    html += `<div class="workout-exercise-meta">${acc.equipment}${!isBodyweight ? ` &bull; hit ${targetReps}${isTimeBased ? 's' : ' reps'} on all sets to increase weight` : ''}</div>`;
    const lastAcc = getLastAccPerformance(acc.exerciseId);
    if (lastAcc) {
      let lastWeight;
      if (lastAcc.weight === 0) {
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
      const setWeight = isBodyweight ? 'BW' : `${formatWeight(acc.setWeights[si])} ${store.unit}`;
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
        ${!done && !isTimeBased && !isBodyweight ? `<div class="acc-set-weight-controls">
          <button class="acc-set-weight-btn" data-acc="${ai}" data-set="${si}" data-dir="-1">&minus;</button>
          <button class="acc-set-weight-btn" data-acc="${ai}" data-set="${si}" data-dir="1">+</button>
        </div>` : ''}
        ${!done && !isTimeBased ? `<input type="number" class="workout-set-input" data-acc-input="${ai}-${si}" placeholder="${targetReps}" min="1" inputmode="numeric">` : ''}
      </div>`;
    }
    html += `</div>`;
  });

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
    if (_showWeakPointSetupModal) _showWeakPointSetupModal(mainLift);
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
  if (_updateWorkoutButton) _updateWorkoutButton();
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
  store.workoutSession.accessories.forEach(acc => {
    if (acc.setsCompleted.length === 0) return;
    store.accessoryLog.push({
      id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6) + acc.exerciseId,
      exerciseId: acc.exerciseId,
      weight: acc.setWeights[acc.setWeights.length - 1],
      setWeights: [...acc.setWeights],
      setsCompleted: [...acc.setsCompleted],
      targetSets: acc.targetSets,
      repRange: [...acc.repRange],
      date: store.workoutSession.date,
      timestamp: now.getTime(),
      mainLift: store.workoutSession.mainLift
    });
  });
  store.saveNow('accessoryLog');

  // Mesocycle performance recording & adaptation
  let mesoAdaptation = null;
  const completedSession = store.workoutSession;
  if (store.workoutSession.source === 'mesocycle' && store.activeMesocycle && store.activeMesocycle.status === 'active') {
    if (_recordMesocyclePerformance) _recordMesocyclePerformance(store.workoutSession);
    if (_adaptRemainingWeeks) mesoAdaptation = _adaptRemainingWeeks(store.workoutSession.mainLift);
  }

  store.workoutSession = null;
  store.saveWorkoutSession();
  closeWorkoutView();
  showToast('Workout complete!');
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  if (_updateWorkoutButton) _updateWorkoutButton();
  setTimeout(() => {
    if (_showWorkoutSummary) _showWorkoutSummary(completedSession, mesoAdaptation);
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
      // Stop exercise timer if running for this accessory
      if (store.exerciseTimer && store.exerciseTimer.accIdx === ai) {
        stopExerciseTimer();
      }
      store.workoutSession.accessories.splice(ai, 1);
      // Fix timer index if it pointed beyond the removed index
      if (store.exerciseTimer && store.exerciseTimer.accIdx > ai) {
        store.exerciseTimer.accIdx--;
      }
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
        item.innerHTML = `<span>${alt.name}</span><span class="acc-swap-alt-meta">${alt.equipment} &bull; ${alt.score}pts</span>`;
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
      acc.setWeights[si] = Math.max(0, acc.setWeights[si] + dir * increment);
      acc.setWeights[si] = roundToPlate(acc.setWeights[si]);
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

    // Main set row clicks
    const mainRow = e.target.closest('.workout-set-row[data-type="main"]');
    if (mainRow) {
      const idx = parseInt(mainRow.dataset.idx);
      const set = store.workoutSession.mainSets[idx];
      const week = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[store.workoutSession.mainLift] || 1);
      if (set.completed) {
        set.completed = false;
        delete store.programConfig.completedSets[`${store.workoutSession.mainLift}-${week}-${idx}`];
        delete store.programConfig.amrapResults[`${store.workoutSession.mainLift}-${week}-${idx}`];
        store.saveProgramConfig();
      } else {
        const isAmrap = typeof set.reps === 'string' && set.reps.toString().includes('+');
        let repsToLog = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
        if (isAmrap) {
          const amrapInput = mainRow.querySelector('.workout-set-input');
          if (amrapInput && amrapInput.value) repsToLog = parseInt(amrapInput.value);
        }
        const weight = set.weight;
        if (_addEntry) _addEntry(store.workoutSession.mainLift, weight, repsToLog, null, '', []);
        if (_updateDashboard) _updateDashboard();
        set.completed = true;
        store.programConfig.completedSets[`${store.workoutSession.mainLift}-${week}-${idx}`] = true;
        if (isAmrap && repsToLog) {
          store.programConfig.amrapResults[`${store.workoutSession.mainLift}-${week}-${idx}`] = repsToLog;
        }
        const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
        if (tmpl && tmpl.progression && tmpl.progression.type === 'session') {
          const progResult = checkAutoProgression(store.workoutSession.mainLift);
          if (progResult) {
            applyProgression(progResult);
          }
        }
        store.saveProgramConfig();
        startTimer(store.timerDuration);
        if (navigator.vibrate) navigator.vibrate(50);
      }
      store.saveWorkoutSession();
      renderWorkoutView();
      if (_renderProgramSection) _renderProgramSection();
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
    store.workoutSession = null;
    store.saveWorkoutSession();
    closeWorkoutView();
    showToast('Workout discarded');
  });
}
