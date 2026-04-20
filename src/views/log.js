/**
 * Log tab view — e1RM preview, log button, lift selector, RPE pills,
 * notes toggle, repeat button, tag pills, and related event wiring.
 */

import store from '../state/store.js';
import { $, debounce } from '../utils/helpers.js';
import { PREVIEW_DEBOUNCE_MS, SHAKE_DURATION_MS } from '../constants/ui.js';
import { weightInput, repsInput, notesInput, previewEl, logBtn } from '../ui/dom.js';
import { LIFT_NAMES } from '../constants/lift-config.js';
import { AVAILABLE_TAGS } from '../data/milestones.js';
import { calcE1RM } from '../formulas/e1rm.js';
import { formatWeight, inputToLbs } from '../formulas/units.js';
import { formatPlates } from '../formulas/plates.js';
import { checkPR } from '../systems/pr-tracking.js';
import { addEntry } from '../state/actions.js';
import { showToast } from '../ui/toast.js';
import { burstMilestoneConfetti } from '../ui/confetti.js';

// ---------------------------------------------------------------------------
// Late-bound callbacks — set via inject()
// ---------------------------------------------------------------------------

let _deps = {};

export function injectLogDeps(deps) { Object.assign(_deps, deps); }

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
  let html = '';
  AVAILABLE_TAGS.forEach(t => {
    html += `<button class="tag-pill" data-tag="${t}">${t}</button>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.tag-pill').forEach(pill => {
    pill.addEventListener('click', () => pill.classList.toggle('active'));
  });
}

// Inline validation hints ------------------------------------------------

function showInputHint(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
}

function clearInputHint(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// initLogTab — wire up all Log tab event listeners
// ---------------------------------------------------------------------------

/**
 * Set up all event listeners for the Log tab.
 * Call once after DOMContentLoaded.
 */
export function initLogTab() {
  const debouncedPreview = debounce(updatePreview, PREVIEW_DEBOUNCE_MS);
  const weightHint = $('weight-hint');
  const repsHint = $('reps-hint');
  weightInput.addEventListener('input', () => { clearInputHint(weightHint); debouncedPreview(); });
  repsInput.addEventListener('input', () => { clearInputHint(repsHint); debouncedPreview(); });

  // Log button
  logBtn.addEventListener('click', () => {
    const w = parseFloat(weightInput.value), r = parseInt(repsInput.value);
    if (!(w > 0 && r > 0)) {
      if (!(w > 0)) {
        weightInput.classList.add('input-shake');
        showInputHint(weightHint, 'Enter a weight');
        setTimeout(() => weightInput.classList.remove('input-shake'), SHAKE_DURATION_MS);
      }
      if (!(r > 0)) {
        repsInput.classList.add('input-shake');
        showInputHint(repsHint, 'Enter reps');
        setTimeout(() => repsInput.classList.remove('input-shake'), SHAKE_DURATION_MS);
      }
      return;
    }
    clearInputHint(weightHint);
    clearInputHint(repsHint);
    const notes = notesInput.value.trim();
    const activeTags = [...document.querySelectorAll('#log-tags .tag-pill.active')].map(t => t.dataset.tag);
    const { entry, isPR, isRepPR, milestone, hitMilestones } = addEntry(store.currentLift, inputToLbs(w), r, store.currentRPE, notes, activeTags);
    weightInput.value = ''; repsInput.value = '';
    updatePreview();
    _deps.updateDashboard?.();
    if (store.currentTab === 'history') _deps.renderHistory?.();
    if (store.currentTab === 'charts') _deps.renderChart?.();

    // Repeat last set button
    const rb = $('repeat-btn');
    rb.textContent = `Repeat: ${LIFT_NAMES[store.currentLift]} ${w} ${store.unit} x ${r}`;
    rb.classList.add('visible');

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(50);

    // Auto-progression: detect AMRAP program set match
    let progApplied = false;
    if (store.programConfig.activeProgram && store.programConfig.autoProgressEnabled && _deps.getProgramWorkout) {
      const workout = _deps.getProgramWorkout(store.currentLift);
      if (workout) {
        const loggedWeight = inputToLbs(w);
        const lw = store.programConfig.liftWeeks?.[store.currentLift] || 1;
        workout.sets.forEach((s, idx) => {
          if (typeof s.reps === 'string' && s.reps.includes('+') && Math.abs(s.weight - loggedWeight) <= 3) {
            const key = `${store.currentLift}-${lw}-${idx}`;
            if (!store.programConfig.amrapResults[key]) {
              store.programConfig.amrapResults[key] = r;
              store.programConfig.completedSets[key] = true;
              if (!store.programConfig.completedSetData) store.programConfig.completedSetData = {};
              store.programConfig.completedSetData[key] = {
                weight: entry.weight,
                reps: r,
                tm: store.programConfig.trainingMaxes[store.currentLift],
                date: entry.date,
                entryId: entry.id,
              };
              store.saveProgramConfig();
              _deps.renderProgramSection?.();
              // Session-type (SL5x5/SS) applies progression immediately
              // Amrap-type uses cycle-boundary progression instead
              if (_deps.checkAutoProgression) {
                const result = _deps.checkAutoProgression(store.currentLift);
                if (result) {
                  progApplied = true;
                  if (_deps.applyProgression) setTimeout(() => _deps.applyProgression(result), 300);
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
    } else if (!progApplied && (!hitMilestones || hitMilestones.length === 0)) {
      showToast('Set logged');
    }

    // Goal milestone celebration — toast + inline confetti burst per hit milestone
    if (hitMilestones && hitMilestones.length > 0) {
      hitMilestones.forEach((ms, i) => {
        setTimeout(() => {
          const isGoal = ms.label === 'Goal';
          const emoji = isGoal ? '\uD83C\uDFC6' : '\uD83C\uDFAF';
          const msg = isGoal
            ? `${emoji} GOAL REACHED! ${LIFT_NAMES[ms.lift]} ${formatWeight(ms.target)} ${store.unit}`
            : `${emoji} ${ms.label}: ${LIFT_NAMES[ms.lift]} ${formatWeight(ms.target)} ${store.unit}`;
          showToast(msg);
          burstMilestoneConfetti(ms.lift);
        }, i * 1500);
      });
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
      _deps.renderProgramSection?.();
      _deps.updateWorkoutButton?.();
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

  // Tags toggle — hidden by default, revealed on tap
  $('tags-toggle').addEventListener('click', () => {
    const tagsEl = $('log-tags');
    const isVisible = tagsEl.style.display !== 'none';
    tagsEl.style.display = isVisible ? 'none' : 'flex';
    $('tags-toggle').textContent = isVisible ? '+ Add tag' : '- Hide tags';
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
    _deps.updateDashboard?.();
    if (store.currentTab === 'history') _deps.renderHistory?.();
    if (store.currentTab === 'charts') _deps.renderChart?.();
    if (isPR) {
      const shareData = { lift, weight: entry.weight, e1rm: entry.e1rm, date: entry.date };
      showToast(`NEW PR! ${LIFT_NAMES[lift]} e1RM: ${formatWeight(entry.e1rm)} ${store.unit}`, true, milestone, shareData);
    } else { showToast('Set repeated'); }
  });

  // Tag pills
  renderTagPills();
}
