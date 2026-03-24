/**
 * Program section rendering and setup modal.
 *
 * Renders the active program's sets for the current lift and week,
 * handles set click (auto-fill + mark complete), navigation between
 * weeks, and the program setup modal with training max configuration.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES, COLORS } from '../constants/lift-config.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { formatWeight, displayWeight, inputToLbs } from '../formulas/units.js';
import { formatPlates } from '../formulas/plates.js';
import { bestE1RM } from '../formulas/e1rm.js';
import {
  getProgramWorkout,
  isWeekComplete,
  isLiftComplete,
  checkAutoProgression,
  applyProgression,
  setKey,
  weekKey,
} from '../systems/programs.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _updatePreview = null;
let _updateDashboard = null;
let _addEntry = null;
let _startTimer = null;
let _triggerWeekCompleteCelebration = null;
let _triggerLiftCompleteCelebration = null;

/**
 * Inject dependencies that would cause circular imports.
 */
export function setProgramSectionDeps(deps) {
  if (deps.updatePreview) _updatePreview = deps.updatePreview;
  if (deps.updateDashboard) _updateDashboard = deps.updateDashboard;
  if (deps.addEntry) _addEntry = deps.addEntry;
  if (deps.startTimer) _startTimer = deps.startTimer;
  if (deps.triggerWeekCompleteCelebration) _triggerWeekCompleteCelebration = deps.triggerWeekCompleteCelebration;
  if (deps.triggerLiftCompleteCelebration) _triggerLiftCompleteCelebration = deps.triggerLiftCompleteCelebration;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Render the program section in the log tab.
 * Shows current program, week, sets, and completion state.
 */
export function renderProgramSection() {
  const el = $('program-section');
  if (!store.programConfig.activeProgram) {
    el.style.display = 'block';
    el.classList.remove('week-complete');
    el.classList.remove('lift-complete');
    document.querySelectorAll('.lift-btn').forEach(btn => btn.classList.remove('lift-done'));
    $('program-title').textContent = '';
    $('program-week').textContent = '';
    $('program-sets').innerHTML = `<div class="empty-msg">No program active</div>`;
    document.querySelector('.program-actions').style.display = 'flex';
    $('program-prev').style.display = 'none';
    $('program-next').style.display = 'none';
    return;
  }
  $('program-prev').style.display = '';
  $('program-next').style.display = '';
  el.style.display = 'block';

  // Viewing position: use viewingCycle/viewingWeek if set, else current
  const viewCycle = store.viewingCycle || store.programConfig.currentCycle || 1;
  const viewWeek = store.viewingWeek || store.programConfig.currentWeek;
  const isViewingCurrent = viewCycle === (store.programConfig.currentCycle || 1)
    && viewWeek === store.programConfig.currentWeek;

  const workout = getProgramWorkout(store.currentLift, viewWeek, viewCycle);
  if (!workout) {
    const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
    $('program-title').textContent = tmpl ? tmpl.name : store.programConfig.activeProgram;
    $('program-week').textContent = '';
    $('program-sets').innerHTML = `<div class="empty-msg">Set a training max for ${LIFT_NAMES[store.currentLift]} in Setup</div>`;
    el.classList.remove('week-complete');
    el.classList.remove('lift-complete');
    document.querySelectorAll('.lift-btn').forEach(btn => {
      const l = btn.dataset.lift;
      btn.classList.toggle('lift-done', isLiftComplete(l));
    });
    return;
  }
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  $('program-title').textContent = tmpl.name + ' \u2014 ' + LIFT_NAMES[store.currentLift];
  // One-line description (first sentence)
  const desc = tmpl.description || '';
  const firstSentence = desc.split('.')[0];
  const cycleLabel = viewCycle > 1 ? ` (Cycle ${viewCycle})` : '';
  const jumpBtn = !isViewingCurrent ? ` <button class="jump-to-current" style="font-size:0.6rem;padding:2px 8px;margin-left:6px;cursor:pointer;background:var(--accent);color:#000;border:none;border-radius:4px">Current &rarr;</button>` : '';
  $('program-week').innerHTML = workout.label + cycleLabel + jumpBtn + (firstSentence ? `<div style="font-size:0.65rem;color:var(--text-dim);font-weight:400;margin-top:2px">${firstSentence}.</div>` : '');
  const setsEl = $('program-sets');
  setsEl.innerHTML = workout.sets.map(s => {
    const tierLabel = s.tier ? `<span style="font-size:var(--text-xs);color:var(--text-dim);margin-right:4px">${s.tier}</span>` : '';
    const dayLabel = s.day ? `<span style="font-size:var(--text-xs);color:var(--text-dim);margin-right:4px">${s.day}</span>` : '';
    const isAmrap = typeof s.reps === 'string' && s.reps.includes('+');
    const amrapBadge = isAmrap ? `<span style="font-size:var(--text-xs);color:var(--gold);font-weight:600;margin-left:4px">AMRAP</span>` : '';
    const checkmark = s.completed ? '<span class="program-set-check">&#10003;</span>' : '';
    const plateStr = formatPlates(s.weight);
    return `<div class="program-set-row${s.completed ? ' completed' : ''}" data-set-idx="${s.num - 1}">
      ${checkmark}<span class="program-set-num">${s.num}</span>
      ${dayLabel}${tierLabel}<span class="program-set-weight">${formatWeight(s.weight)} ${store.unit} &times; ${s.reps}</span>${amrapBadge}
      <span class="program-set-pct">${s.pct}%</span>
      ${plateStr ? `<div class="plate-display">${plateStr} /side</div>` : ''}
    </div>`;
  }).join('');

  // Week/lift completion visual state — check completion for the VIEWED week
  const allSetsComplete = workout.sets.every(s => s.completed);
  const allLiftsComplete = LIFTS.filter(l => store.programConfig.trainingMaxes[l]).every(l => {
    const w = getProgramWorkout(l, viewWeek, viewCycle);
    return w && w.sets.every(s => s.completed);
  });
  if (allLiftsComplete) {
    el.classList.add('week-complete');
    el.classList.remove('lift-complete');
    $('program-week').innerHTML = workout.label + cycleLabel + ' \u2014 Complete! \u2713' + jumpBtn + (firstSentence ? `<div style="font-size:0.65rem;color:var(--text-dim);font-weight:400;margin-top:2px">${firstSentence}.</div>` : '');
  } else if (allSetsComplete) {
    el.classList.remove('week-complete');
    el.classList.add('lift-complete');
    $('program-week').innerHTML = workout.label + cycleLabel + ' \u2014 Complete! \u2713' + jumpBtn + (firstSentence ? `<div style="font-size:0.65rem;color:var(--text-dim);font-weight:400;margin-top:2px">${firstSentence}.</div>` : '');
  } else {
    el.classList.remove('week-complete');
    el.classList.remove('lift-complete');
  }

  // Lift-done badges on selector buttons (for viewed week)
  document.querySelectorAll('.lift-btn').forEach(btn => {
    const l = btn.dataset.lift;
    const w = getProgramWorkout(l, viewWeek, viewCycle);
    btn.classList.toggle('lift-done', w ? w.sets.every(s => s.completed) : false);
  });

  // Week progress summary
  const liftsWithTM = LIFTS.filter(l => store.programConfig.trainingMaxes[l]);
  const doneCount = liftsWithTM.filter(l => isLiftComplete(l)).length;
  if (liftsWithTM.length > 1 && doneCount > 0 && !weekComplete) {
    const progress = ` (${doneCount}/${liftsWithTM.length} lifts)`;
    $('program-week').innerHTML += `<span style="font-size:0.65rem;color:var(--text-dim);margin-left:4px">${progress}</span>`;
  }

  // Streak badge
  const existingBadge = el.querySelector('.week-streak-badge');
  if (existingBadge) existingBadge.remove();
  if (store.programConfig.weekStreak >= 2) {
    const badge = document.createElement('span');
    badge.className = 'week-streak-badge';
    badge.textContent = '\uD83D\uDD25 ' + store.programConfig.weekStreak + '-week streak';
    el.querySelector('.program-header').appendChild(badge);
  }

  // Jump to current button
  const jumpEl = el.querySelector('.jump-to-current');
  if (jumpEl) {
    jumpEl.addEventListener('click', (e) => {
      e.stopPropagation();
      store.viewingCycle = null;
      store.viewingWeek = null;
      renderProgramSection();
    });
  }

  // Click to auto-fill (disabled for past weeks)
  setsEl.querySelectorAll('.program-set-row').forEach(row => {
    row.addEventListener('click', () => {
      if (!isViewingCurrent) return; // Read-only when viewing past cycles
      const idx = parseInt(row.dataset.setIdx);
      const set = workout.sets[idx];
      const wasLiftComplete = isLiftComplete(store.currentLift);
      const wasComplete = isWeekComplete();
      const cycle = store.programConfig.currentCycle || 1;
      const sk = setKey(store.currentLift, cycle, store.programConfig.currentWeek, idx);
      if (set.completed) {
        // Toggle off completed
        delete store.programConfig.completedSets[sk];
        delete store.programConfig.amrapResults[sk];
      } else {
        // Auto-fill inputs
        const weightInput = $('input-weight');
        const repsInput = $('input-reps');
        const wDisplay = displayWeight(set.weight);
        if (weightInput) weightInput.value = wDisplay;
        const repVal = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
        if (repsInput) repsInput.value = repVal;
        if (_updatePreview) _updatePreview();
        // Mark completed
        store.programConfig.completedSets[sk] = true;
        // Check session-type auto-progression (SL5x5 / SS)
        const tmpl2 = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
        if (tmpl2 && tmpl2.progression && tmpl2.progression.type === 'session') {
          const result = checkAutoProgression(store.currentLift);
          if (result) {
            store.saveProgramConfig();
            renderProgramSection();
            if (!wasComplete && isWeekComplete() && _triggerWeekCompleteCelebration) _triggerWeekCompleteCelebration();
            else if (!wasLiftComplete && isLiftComplete(store.currentLift) && _triggerLiftCompleteCelebration) _triggerLiftCompleteCelebration();
            setTimeout(() => applyProgression(result), 300);
            return;
          }
        }
      }
      store.saveProgramConfig();
      renderProgramSection();
      // Check week/lift completion transitions
      if (!wasComplete && isWeekComplete()) {
        if (_triggerWeekCompleteCelebration) _triggerWeekCompleteCelebration();
        // Auto-advance current position to next week
        const tmpl3 = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
        const maxW = tmpl3 ? tmpl3.weeks : 99;
        if (store.programConfig.currentWeek < maxW) {
          store.programConfig.currentWeek++;
        } else {
          store.programConfig.currentCycle = (store.programConfig.currentCycle || 1) + 1;
          store.programConfig.currentWeek = 1;
        }
        // Reset viewing to current
        store.viewingCycle = null;
        store.viewingWeek = null;
        store.saveProgramConfig();
        setTimeout(() => renderProgramSection(), 300);
      } else if (!wasLiftComplete && isLiftComplete(store.currentLift)) {
        if (_triggerLiftCompleteCelebration) _triggerLiftCompleteCelebration();
      } else if (wasComplete && !isWeekComplete()) {
        const wk = weekKey(store.programConfig.currentCycle || 1, store.programConfig.currentWeek);
        delete store.programConfig.completedWeeks[wk];
        let streak = 0;
        for (let w = store.programConfig.currentWeek; w >= 1; w--) {
          if (store.programConfig.completedWeeks[weekKey(store.programConfig.currentCycle || 1, w)]) streak++;
          else break;
        }
        store.programConfig.weekStreak = streak;
        store.saveProgramConfig();
        renderProgramSection();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Program setup modal
// ---------------------------------------------------------------------------

/**
 * Show the program setup modal for selecting a program,
 * configuring training maxes, and setting the current week.
 */
export function showProgramSetupModal() {
  const body = $('edit-body');
  const programs = Object.keys(PROGRAM_TEMPLATES);
  const current = store.programConfig.activeProgram || '';

  let html = `<div class="input-group" style="margin-bottom:8px"><label>Program</label>
    <select id="program-select" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:0.9rem">
      <option value="">None (disable)</option>
      ${programs.map(p => `<option value="${p}"${p === current ? ' selected' : ''}>${PROGRAM_TEMPLATES[p].name}</option>`).join('')}
    </select>
  </div>`;

  // Description area
  const initDesc = current ? PROGRAM_TEMPLATES[current].description : '';
  html += `<div id="program-desc" style="font-size:0.75rem;color:var(--text-dim);line-height:1.4;margin-bottom:12px;min-height:20px">${initDesc}</div>`;

  html += `<div class="section-label-lg" style="margin-bottom:8px">Training Maxes</div>`;
  LIFTS.forEach(lift => {
    const best = bestE1RM(lift);
    const suggestedTM = best ? Math.round(best * 0.9) : '';
    const currentTM = store.programConfig.trainingMaxes[lift] || '';
    html += `<div class="tm-row">
      <span class="tm-lift-label" style="color:${COLORS[lift]}">${LIFT_NAMES[lift]}</span>
      <input type="number" class="tm-input" id="tm-${lift}" value="${currentTM ? displayWeight(currentTM) : ''}" placeholder="${suggestedTM ? displayWeight(suggestedTM) : '0'}" inputmode="decimal" step="any">
      <span class="tm-unit-label">${store.unit}</span>
      ${best ? `<button class="program-nav-btn tm-suggest-btn" data-suggest="${lift}">90% e1RM</button>` : ''}
    </div>`;
  });

  html += `<div class="input-group" style="margin-top:12px;margin-bottom:8px"><label>Current Week</label>
    <input type="number" id="program-week-input" value="${store.programConfig.currentWeek || 1}" min="1" style="width:80px;padding:10px;border:2px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:0.9rem;text-align:center;outline:none">
  </div>`;

  // Auto-progression toggle
  html += `<label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text);margin-bottom:12px;cursor:pointer">
    <input type="checkbox" id="auto-progress-toggle" ${store.programConfig.autoProgressEnabled ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--green)">
    Auto-progress TM when targets hit
  </label>`;

  html += `<button class="modal-save-btn" id="program-save">Save Program</button>`;

  $('edit-modal').querySelector('h3').textContent = 'Program Setup';
  body.innerHTML = html;
  openModal('edit-modal');

  // Update description on program change
  $('program-select').addEventListener('change', () => {
    const sel = $('program-select').value;
    $('program-desc').textContent = sel ? (PROGRAM_TEMPLATES[sel].description || '') : '';
  });

  // Suggest TM buttons
  body.querySelectorAll('[data-suggest]').forEach(btn => {
    btn.addEventListener('click', () => {
      const lift = btn.dataset.suggest;
      const best2 = bestE1RM(lift);
      if (best2) $('tm-' + lift).value = displayWeight(Math.round(best2 * 0.9));
    });
  });

  // Save
  $('program-save').addEventListener('click', () => {
    const sel = $('program-select').value;
    store.programConfig.activeProgram = sel || null;
    LIFTS.forEach(lift => {
      const v = parseFloat($('tm-' + lift).value);
      if (v > 0 && v < 2000) store.programConfig.trainingMaxes[lift] = inputToLbs(v);
    });
    const tmplForWeek = sel ? PROGRAM_TEMPLATES[sel] : null;
    store.programConfig.currentWeek = Math.max(1, Math.min(parseInt($('program-week-input').value) || 1, tmplForWeek ? tmplForWeek.weeks : 99));
    store.programConfig.autoProgressEnabled = $('auto-progress-toggle').checked;
    // Only clear completion data if the program itself changed
    if (sel !== store.programConfig.activeProgram) {
      store.programConfig.completedSets = {};
      store.programConfig.completedWeeks = {};
      store.programConfig.amrapResults = {};
      store.programConfig.weekStreak = 0;
      store.programConfig.currentCycle = 1;
    }
    store.saveProgramConfig();
    closeModal('edit-modal');
    renderProgramSection();
    showToast(sel ? `Program set: ${PROGRAM_TEMPLATES[sel].name}` : 'Program disabled');
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Attach program section navigation (prev/next week) listeners.
 * Call once after DOMContentLoaded.
 */
export function initProgramSection() {
  $('program-prev').addEventListener('click', () => {
    const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
    const maxWeek = tmpl ? tmpl.weeks : 99;
    let vCycle = store.viewingCycle || store.programConfig.currentCycle || 1;
    let vWeek = store.viewingWeek || store.programConfig.currentWeek;
    if (vWeek > 1) {
      vWeek--;
    } else if (vCycle > 1) {
      vCycle--;
      vWeek = maxWeek;
    } else {
      return; // Already at cycle 1, week 1
    }
    store.viewingCycle = vCycle;
    store.viewingWeek = vWeek;
    renderProgramSection();
  });

  $('program-next').addEventListener('click', () => {
    const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
    const maxWeek = tmpl ? tmpl.weeks : 99;
    let vCycle = store.viewingCycle || store.programConfig.currentCycle || 1;
    let vWeek = store.viewingWeek || store.programConfig.currentWeek;
    const curCycle = store.programConfig.currentCycle || 1;
    const curWeek = store.programConfig.currentWeek;

    if (vWeek < maxWeek) {
      vWeek++;
    } else if (vCycle < curCycle || (vCycle === curCycle && vWeek < curWeek)) {
      vCycle++;
      vWeek = 1;
    } else {
      return; // Already at current position
    }
    // Don't go past the current training position
    if (vCycle > curCycle || (vCycle === curCycle && vWeek > curWeek)) {
      vCycle = curCycle;
      vWeek = curWeek;
    }
    store.viewingCycle = vCycle;
    store.viewingWeek = vWeek;
    renderProgramSection();
  });

  $('program-setup')?.addEventListener('click', showProgramSetupModal);
}
