/**
 * Log tab view — e1RM preview, log button, lift selector, RPE pills,
 * notes toggle, repeat button, tag pills, and related event wiring.
 */

import store from '../state/store.js';
import { $, debounce } from '../utils/helpers.js';
import { weightInput, repsInput, notesInput, previewEl, logBtn } from '../ui/dom.js';
import { LIFT_NAMES } from '../constants/lift-config.js';
import { AVAILABLE_TAGS } from '../data/milestones.js';
import { calcE1RM } from '../formulas/e1rm.js';
import { formatWeight, inputToLbs } from '../formulas/units.js';
import { formatPlates } from '../formulas/plates.js';
import { checkPR } from '../systems/pr-tracking.js';
import { setKey } from '../systems/programs.js';
import { addEntry } from '../state/actions.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Late-bound callbacks — set via inject()
// ---------------------------------------------------------------------------

let _updateDashboard = null;
let _renderHistory = null;
let _renderChart = null;
let _renderProgramSection = null;
let _updateWorkoutButton = null;
let _getProgramWorkout = null;
let _checkAutoProgression = null;
let _applyProgression = null;
let _startTimer = null;
let _dismissTimer = null;

/**
 * Inject view-level dependencies to avoid circular imports.
 * Called once during app boot.
 *
 * @param {object} deps
 */
export function injectLogDeps(deps) {
  if (deps.updateDashboard) _updateDashboard = deps.updateDashboard;
  if (deps.renderHistory) _renderHistory = deps.renderHistory;
  if (deps.renderChart) _renderChart = deps.renderChart;
  if (deps.renderProgramSection) _renderProgramSection = deps.renderProgramSection;
  if (deps.updateWorkoutButton) _updateWorkoutButton = deps.updateWorkoutButton;
  if (deps.getProgramWorkout) _getProgramWorkout = deps.getProgramWorkout;
  if (deps.checkAutoProgression) _checkAutoProgression = deps.checkAutoProgression;
  if (deps.applyProgression) _applyProgression = deps.applyProgression;
  if (deps.startTimer) _startTimer = deps.startTimer;
  if (deps.dismissTimer) _dismissTimer = deps.dismissTimer;
}

// ---------------------------------------------------------------------------
// e1RM Preview
// ---------------------------------------------------------------------------

/**
 * Update the e1RM preview based on current weight / reps inputs.
 */
export function updatePreview() {
  const w = parseFloat(weightInput.value), r = parseInt(repsInput.value);
  if (w > 0 && r > 0) {
    const wLbs = inputToLbs(w);
    const e = Math.round(calcE1RM(wLbs, r) * 10) / 10;
    const isPR = checkPR(store.currentLift, e);
    const plateStr = formatPlates(w);
    previewEl.innerHTML = `Estimated 1RM: <span class="value">${formatWeight(e)} ${store.unit}</span>`
      + (isPR ? ` <span class="pr-indicator">NEW PR!</span>` : '')
      + (plateStr ? `<div class="plate-display">${plateStr} /side</div>` : '');
    logBtn.disabled = false;
  } else {
    previewEl.textContent = 'Enter weight and reps';
    logBtn.disabled = true;
  }
}

// ---------------------------------------------------------------------------
// Tag pills rendering
// ---------------------------------------------------------------------------

function renderTagPills() {
  const container = $('log-tags');
  let html = '<span style="font-size:0.6rem;color:var(--text-dim);margin-right:2px">Tags:</span>';
  AVAILABLE_TAGS.forEach(t => {
    html += `<button class="tag-pill" data-tag="${t}">${t}</button>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.tag-pill').forEach(pill => {
    pill.addEventListener('click', () => pill.classList.toggle('active'));
  });
}

// ---------------------------------------------------------------------------
// initLogTab — wire up all Log tab event listeners
// ---------------------------------------------------------------------------

/**
 * Set up all event listeners for the Log tab.
 * Call once after DOMContentLoaded.
 */
export function initLogTab() {
  const debouncedPreview = debounce(updatePreview, 150);
  weightInput.addEventListener('input', debouncedPreview);
  repsInput.addEventListener('input', debouncedPreview);

  // Log button
  logBtn.addEventListener('click', () => {
    const w = parseFloat(weightInput.value), r = parseInt(repsInput.value);
    if (!(w > 0 && r > 0)) {
      if (!(w > 0)) { weightInput.classList.add('input-shake'); setTimeout(() => weightInput.classList.remove('input-shake'), 300); }
      if (!(r > 0)) { repsInput.classList.add('input-shake'); setTimeout(() => repsInput.classList.remove('input-shake'), 300); }
      return;
    }
    const notes = notesInput.value.trim();
    const activeTags = [...document.querySelectorAll('#log-tags .tag-pill.active')].map(t => t.dataset.tag);
    const { entry, isPR, isRepPR, milestone } = addEntry(store.currentLift, inputToLbs(w), r, store.currentRPE, notes, activeTags);
    weightInput.value = ''; repsInput.value = '';
    updatePreview();
    if (_updateDashboard) _updateDashboard();
    if (store.currentTab === 'history' && _renderHistory) _renderHistory();
    if (store.currentTab === 'charts' && _renderChart) _renderChart();

    // Repeat last set button
    const rb = $('repeat-btn');
    rb.textContent = `Repeat: ${LIFT_NAMES[store.currentLift]} ${w} ${store.unit} x ${r}`;
    rb.classList.add('visible');

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(50);

    // Auto-progression: detect AMRAP program set match
    let progApplied = false;
    if (store.programConfig.activeProgram && store.programConfig.autoProgressEnabled && _getProgramWorkout) {
      const workout = _getProgramWorkout(store.currentLift);
      if (workout) {
        const loggedWeight = inputToLbs(w);
        workout.sets.forEach((s, idx) => {
          if (typeof s.reps === 'string' && s.reps.includes('+') && Math.abs(s.weight - loggedWeight) <= 3) {
            const key = setKey(store.currentLift, store.programConfig.currentCycle || 1, store.programConfig.currentWeek, idx);
            if (!store.programConfig.amrapResults[key]) {
              store.programConfig.amrapResults[key] = r;
              store.programConfig.completedSets[key] = true;
              store.saveProgramConfig();
              if (_renderProgramSection) _renderProgramSection();
              if (_checkAutoProgression) {
                const result = _checkAutoProgression(store.currentLift);
                if (result) {
                  progApplied = true;
                  if (_applyProgression) setTimeout(() => _applyProgression(result), 300);
                }
              }
            }
          }
        });
      }
    }

    if (isPR) {
      const name = LIFT_NAMES[store.currentLift];
      const shareData = { lift: store.currentLift, weight: entry.weight, e1rm: entry.e1rm, date: entry.date };
      showToast(`NEW PR! ${name} e1RM: ${formatWeight(entry.e1rm)} ${store.unit}`, true, milestone, shareData);
    } else if (isRepPR) {
      showToast(`${r}-Rep PR! ${LIFT_NAMES[store.currentLift]} ${w} ${store.unit}`);
    } else if (!progApplied) {
      showToast('Set logged');
    }
    weightInput.focus();
  });

  // Lift selector
  document.querySelectorAll('.lift-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lift-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      store.currentLift = btn.dataset.lift;
      updatePreview();
      if (_renderProgramSection) _renderProgramSection();
      if (_updateWorkoutButton) _updateWorkoutButton();
    });
  });

  // RPE selector
  document.querySelectorAll('.rpe-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rpe-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      store.currentRPE = btn.dataset.rpe ? parseFloat(btn.dataset.rpe) : null;
    });
  });

  // Notes toggle
  $('notes-toggle').addEventListener('click', () => {
    store.notesVisible = !store.notesVisible;
    notesInput.style.display = store.notesVisible ? '' : 'none';
    $('notes-toggle').textContent = store.notesVisible ? '- Hide note' : '+ Add note';
    if (store.notesVisible) notesInput.focus();
  });

  // Enter key
  [weightInput, repsInput, notesInput].forEach(el => {
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && !logBtn.disabled) logBtn.click(); });
  });

  // Repeat last set
  $('repeat-btn').addEventListener('click', () => {
    if (!store.lastLoggedSet) return;
    const { lift, weight, reps, rpe, notes } = store.lastLoggedSet;
    const { entry, isPR, isRepPR, milestone } = addEntry(lift, weight, reps, rpe, notes);
    if (_updateDashboard) _updateDashboard();
    if (store.currentTab === 'history' && _renderHistory) _renderHistory();
    if (store.currentTab === 'charts' && _renderChart) _renderChart();
    if (isPR) {
      const shareData = { lift, weight: entry.weight, e1rm: entry.e1rm, date: entry.date };
      showToast(`NEW PR! ${LIFT_NAMES[lift]} e1RM: ${formatWeight(entry.e1rm)} ${store.unit}`, true, milestone, shareData);
    } else { showToast('Set repeated'); }
  });

  // Tag pills
  renderTagPills();
}
