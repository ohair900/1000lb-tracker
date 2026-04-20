/**
 * Program section rendering and setup modal.
 *
 * Renders the active program's sets for the current lift and week,
 * handles set click (auto-fill + mark complete), navigation between
 * weeks, and the program setup modal with training max configuration.
 */

import store from '../state/store.js';
import { $, ensureChild } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES, COLORS } from '../constants/lift-config.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { formatWeight, displayWeight, inputToLbs } from '../formulas/units.js';
import { formatPlates } from '../formulas/plates.js';
import { bestE1RM } from '../formulas/e1rm.js';
import {
  getProgramWorkout,
  getLiftWeek,
  isWeekComplete,
  isLiftComplete,
  checkAutoProgression,
  applyProgression,
  checkCycleBoundaryProgression,
  daysSinceLastLift,
} from '../systems/programs.js';
import { recoverProgramHistory } from '../systems/program-migration.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';
import { openHistoryReview } from './program-history-review.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = {};

export function setProgramSectionDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Update days-since-last-lift badges on all lift selector buttons.
 * 0-2 days = green, 3-4 = yellow, 5+ = red, no entries = red with "-".
 */
export function updateLiftDaysBadges() {
  document.querySelectorAll('.lift-btn').forEach(btn => {
    const lift = btn.dataset.lift;
    if (!lift || lift === 'total') return;
    const days = daysSinceLastLift(lift);
    const badge = ensureChild(btn, 'lift-days-badge', 'span');
    badge.textContent = days === Infinity ? '-' : days + 'd';
    badge.classList.remove('days-green', 'days-yellow', 'days-red');
    if (days <= 2) badge.classList.add('days-green');
    else if (days <= 4) badge.classList.add('days-yellow');
    else badge.classList.add('days-red');
  });
}

/**
 * Render the program section in the log tab.
 * Shows current program, week, sets, and completion state.
 */
export function renderProgramSection() {
  const el = $('program-section');
  $('program-sets').style.opacity = '1';
  if (!store.programConfig.activeProgram) {
    el.style.display = 'block';
    el.classList.remove('week-complete');
    el.classList.remove('lift-complete');
    updateLiftDaysBadges();
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
  const workout = getProgramWorkout(store.currentLift);
  if (!workout) {
    const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
    $('program-title').textContent = tmpl ? tmpl.name : store.programConfig.activeProgram;
    $('program-week').textContent = '';
    $('program-sets').innerHTML = `<div class="empty-msg">Set a training max for ${LIFT_NAMES[store.currentLift]} in Setup</div>`;
    el.classList.remove('week-complete');
    el.classList.remove('lift-complete');
    updateLiftDaysBadges();
    return;
  }
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  $('program-title').textContent = tmpl.name + ' \u2014 ' + LIFT_NAMES[store.currentLift];
  // One-line description (first sentence)
  const desc = tmpl.description || '';
  const firstSentence = desc.split('.')[0];
  const absWeek = getLiftWeek(store.currentLift);
  const cycleNum = Math.ceil(absWeek / tmpl.weeks);
  const cycleLabel = (tmpl.weeks > 1 && cycleNum > 1) ? ` \u2014 Cycle ${cycleNum}` : '';
  $('program-week').innerHTML = workout.label + cycleLabel + (firstSentence ? `<div style="font-size:0.65rem;color:var(--text-dim);font-weight:400;margin-top:2px">${firstSentence}.</div>` : '');
  const setsEl = $('program-sets');
  // Filter BBB supplemental sets — they only show in the workout overlay
  const displaySets = workout.sets.filter(s => s.tier !== 'BBB');
  const hasBBB = workout.sets.some(s => s.tier === 'BBB');
  setsEl.innerHTML = displaySets.map(s => {
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
  }).join('') + (hasBBB ? '<div style="font-size:var(--text-xs);color:var(--text-dim);margin-top:6px;opacity:0.7">+ 5\u00d710 BBB supplemental (shown in workout)</div>' : '');

  // Week/lift completion visual state
  const weekComplete = isWeekComplete(store.currentLift);
  const liftComplete = isLiftComplete(store.currentLift);
  if (weekComplete) {
    el.classList.add('week-complete');
    el.classList.remove('lift-complete');
    $('program-week').innerHTML = workout.label + cycleLabel + ' \u2014 Complete! \u2713' + (firstSentence ? `<div style="font-size:0.65rem;color:var(--text-dim);font-weight:400;margin-top:2px">${firstSentence}.</div>` : '');
  } else if (liftComplete) {
    el.classList.remove('week-complete');
    el.classList.add('lift-complete');
    $('program-week').innerHTML = workout.label + cycleLabel + ' \u2014 Complete! \u2713' + (firstSentence ? `<div style="font-size:0.65rem;color:var(--text-dim);font-weight:400;margin-top:2px">${firstSentence}.</div>` : '');
  } else {
    el.classList.remove('week-complete');
    el.classList.remove('lift-complete');
  }

  // Recovery banner: show when there are completed sets that may need review
  const existingBanner = el.querySelector('.program-recovery-banner');
  if (existingBanner) existingBanner.remove();
  const pc = store.programConfig;
  const hasCompletedSets = Object.keys(pc.completedSets || {}).length > 0;
  if (hasCompletedSets && !pc.completedSetDataReviewDismissed) {
    const unreviewed = Object.keys(pc.completedSets).filter(k => {
      const d = pc.completedSetData?.[k];
      return !d || d.recovered;
    }).length;
    if (unreviewed > 0) {
      const banner = document.createElement('div');
      banner.className = 'program-recovery-banner';
      banner.innerHTML = `<span>${unreviewed} past set${unreviewed !== 1 ? 's' : ''} may have wrong weights from TM changes.</span><div style="display:flex;gap:6px;flex-shrink:0"><button class="program-recovery-review-btn">Review</button><button class="program-recovery-dismiss-btn">&#10005;</button></div>`;
      banner.querySelector('.program-recovery-review-btn').addEventListener('click', openHistoryReview);
      banner.querySelector('.program-recovery-dismiss-btn').addEventListener('click', () => {
        store.programConfig.completedSetDataReviewDismissed = true;
        store.saveProgramConfig();
        banner.remove();
      });
      setsEl.before(banner);
    }
  }

  // Days-since-last-lift badges on selector buttons
  updateLiftDaysBadges();

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

  // Click to auto-fill
  const currentLift = store.currentLift;
  const lw = getLiftWeek(currentLift);
  setsEl.querySelectorAll('.program-set-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.setIdx);
      const set = workout.sets[idx];
      const wasLiftComplete = isLiftComplete(currentLift);
      const wasComplete = isWeekComplete(currentLift);
      const psKey = `${currentLift}-${lw}-${idx}`;
      if (set.completed) {
        // Toggle off completed
        delete store.programConfig.completedSets[psKey];
        delete store.programConfig.amrapResults[psKey];
        delete store.programConfig.completedSetData[psKey];
      } else {
        // Auto-fill inputs
        const weightInput = $('input-weight');
        const repsInput = $('input-reps');
        const wDisplay = displayWeight(set.weight);
        if (weightInput) weightInput.value = wDisplay;
        const repVal = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
        if (repsInput) repsInput.value = repVal;
        _deps.updatePreview?.();
        // Mark completed and freeze prescription at current TM
        store.programConfig.completedSets[psKey] = true;
        if (!store.programConfig.completedSetData) store.programConfig.completedSetData = {};
        store.programConfig.completedSetData[psKey] = {
          weight: set.weight,
          reps: repVal,
          tm: store.programConfig.trainingMaxes[currentLift],
          date: new Date().toISOString().split('T')[0],
          entryId: null,
        };
        // Check session-type auto-progression (SL5x5 / SS)
        const tmpl2 = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
        if (tmpl2 && tmpl2.progression && tmpl2.progression.type === 'session') {
          const result = checkAutoProgression(currentLift);
          if (result) {
            store.saveProgramConfig();
            renderProgramSection();
            if (!wasComplete && isWeekComplete(currentLift)) _deps.triggerWeekCompleteCelebration?.();
            else if (!wasLiftComplete && isLiftComplete(currentLift)) _deps.triggerLiftCompleteCelebration?.();
            setTimeout(() => applyProgression(result), 300);
            return;
          }
        }
      }
      store.saveProgramConfig();
      renderProgramSection();
      // Check week/lift completion transitions
      if (!wasComplete && isWeekComplete(currentLift)) {
        _deps.triggerWeekCompleteCelebration?.();
      } else if (!wasLiftComplete && isLiftComplete(currentLift)) {
        _deps.triggerLiftCompleteCelebration?.();
      } else if (wasComplete && !isWeekComplete(currentLift)) {
        delete store.programConfig.completedWeeks[`${currentLift}-${lw}`];
        let streak = 0;
        for (let w = lw; w >= 1; w--) {
          if (store.programConfig.completedWeeks[`${currentLift}-${w}`]) streak++;
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

  html += `<div class="section-label-lg" style="margin-bottom:8px">Training Maxes <span style="font-size:0.65rem;color:var(--text-dim);font-weight:normal">(auto-updated)</span></div>`;
  LIFTS.forEach(lift => {
    if (lift === 'total') return;
    const best = bestE1RM(lift);
    const suggestedTM = best ? Math.round(best * 0.9) : '';
    const currentTM = store.programConfig.trainingMaxes[lift] || '';
    const lw = getLiftWeek(lift);
    html += `<div class="tm-row">
      <span class="tm-lift-label" style="color:${COLORS[lift]}">${LIFT_NAMES[lift]}</span>
      <input type="number" class="tm-input" id="tm-${lift}" value="${currentTM ? displayWeight(currentTM) : ''}" placeholder="${suggestedTM ? displayWeight(suggestedTM) : '0'}" inputmode="decimal" step="any">
      <span class="tm-unit-label">${store.unit}</span>
      <input type="number" id="week-${lift}" value="${lw}" min="1" style="width:52px;padding:6px;border:2px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:0.75rem;text-align:center;outline:none" title="Week">
      <span style="font-size:0.6rem;color:var(--text-dim)">Wk</span>
      ${best ? `<button class="program-nav-btn tm-suggest-btn" data-suggest="${lift}">90% e1RM</button>` : ''}
    </div>`;
  });

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
    const programChanged = sel !== (store.programConfig.activeProgram || '');
    // Confirm before wiping progress
    if (programChanged && Object.keys(store.programConfig.completedSets || {}).length > 0) {
      if (!confirm('Changing programs will reset your weekly progress. Continue?')) return;
    }
    if (!programChanged) {
      // Freeze any legacy completed rows before changing TMs, so only
      // incomplete workouts are recalculated from the new maxes.
      recoverProgramHistory({
        fallbackToPrescription: true,
        overwriteRecovered: false,
        save: false,
      });
    }
    store.programConfig.activeProgram = sel || null;
    LIFTS.forEach(lift => {
      if (lift === 'total') return;
      const v = parseFloat($('tm-' + lift).value);
      if (v > 0 && v < 2000) store.programConfig.trainingMaxes[lift] = inputToLbs(v);
      const wk = parseInt($('week-' + lift)?.value);
      if (wk >= 1) store.programConfig.liftWeeks[lift] = wk;
    });
    store.programConfig.autoProgressEnabled = $('auto-progress-toggle').checked;
    // Only reset completion data when the program itself changes
    if (programChanged) {
      store.programConfig.completedSets = {};
      store.programConfig.completedWeeks = {};
      store.programConfig.weekStreak = 0;
      store.programConfig.progressedCycles = {};
      store.programConfig.liftWeeks = { squat: 1, bench: 1, deadlift: 1 };
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
    const lift = store.currentLift;
    if (getLiftWeek(lift) > 1) {
      $('program-sets').style.opacity = '0.3';
      store.programConfig.liftWeeks[lift]--;
      store.saveProgramConfig();
      renderProgramSection();
    }
  });

  $('program-next').addEventListener('click', () => {
    const lift = store.currentLift;
    if (!store.programConfig.activeProgram) return;
    const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
    const oldWeek = getLiftWeek(lift);
    const oldCycle = tmpl ? Math.ceil(oldWeek / tmpl.weeks) : 0;

    $('program-sets').style.opacity = '0.3';
    store.programConfig.liftWeeks[lift] = oldWeek + 1;
    const newCycle = tmpl ? Math.ceil((oldWeek + 1) / tmpl.weeks) : 0;

    // Cycle-boundary auto-progression for amrap-type programs
    if (tmpl && newCycle > oldCycle && tmpl.progression?.type === 'amrap'
        && store.programConfig.autoProgressEnabled) {
      const cycleKey = `${lift}-${oldCycle}`;
      if (!store.programConfig.progressedCycles[cycleKey]) {
        const result = checkCycleBoundaryProgression(lift, oldWeek, tmpl);
        if (result) {
          applyProgression(result);
          const name = LIFT_NAMES[lift];
          showToast(`${name} TM: ${formatWeight(result.oldTM)} \u2192 ${formatWeight(result.newTM)} ${store.unit}`);
        }
        store.programConfig.progressedCycles[cycleKey] = true;
      }
    }

    store.saveProgramConfig();
    renderProgramSection();
  });

  $('program-setup')?.addEventListener('click', showProgramSetupModal);
}
