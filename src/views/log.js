/**
 * Log tab view — e1RM preview, log button, lift selector, RPE pills,
 * notes toggle, repeat button, tag pills, and related event wiring.
 */

import store from '../state/store.js';
import { $, debounce, escapeHTML } from '../utils/helpers.js';
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
import { openBuilder, buildDefaultSlots } from './builder-overlay.js';
import { suggestMainLift, suggestIntensity } from '../systems/smart-workout.js';

// ---------------------------------------------------------------------------
// Late-bound callbacks — set via inject()
// ---------------------------------------------------------------------------

const _deps = {};

export function injectLogDeps(deps) {
  Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// e1RM Preview
// ---------------------------------------------------------------------------

/**
 * Update the e1RM preview based on current weight / reps inputs.
 */
export function updatePreview() {
  const w = parseFloat(weightInput.value),
    r = parseInt(repsInput.value);
  if (w > 0 && r > 0) {
    const wLbs = inputToLbs(w);
    const e = Math.round(calcE1RM(wLbs, r) * 10) / 10;
    const isPR = checkPR(store.currentLift, e);
    const plateStr = formatPlates(w);
    // PR state drives the gold ring/glow on the preview card (log-tab.css)
    previewEl.classList.toggle('is-pr', isPR);
    previewEl.innerHTML =
      `<span class="e1rm-label">Estimated 1RM</span>` +
      `<span class="value">${formatWeight(e)}<span class="e1rm-unit"> ${store.unit}</span></span>` +
      (isPR ? `<span class="pr-indicator">New PR!</span>` : '') +
      (plateStr ? `<div class="plate-display">${plateStr}<span> /side</span></div>` : '');
    logBtn.disabled = false;
  } else {
    previewEl.classList.remove('is-pr');
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
  AVAILABLE_TAGS.forEach((t) => {
    html += `<button class="tag-pill" data-tag="${t}">${t}</button>`;
  });
  container.innerHTML = html;
  container.querySelectorAll('.tag-pill').forEach((pill) => {
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
  weightInput.addEventListener('input', () => {
    clearInputHint(weightHint);
    debouncedPreview();
  });
  repsInput.addEventListener('input', () => {
    clearInputHint(repsHint);
    debouncedPreview();
  });

  // Log button
  logBtn.addEventListener('click', () => {
    const w = parseFloat(weightInput.value),
      r = parseInt(repsInput.value);
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
    const activeTags = [...document.querySelectorAll('#log-tags .tag-pill.active')].map(
      (t) => t.dataset.tag
    );
    const { entry, isPR, isRepPR, milestone, hitMilestones } = addEntry(
      store.currentLift,
      inputToLbs(w),
      r,
      store.currentRPE,
      notes,
      activeTags
    );
    weightInput.value = '';
    repsInput.value = '';
    updatePreview();

    // Repeat last set button
    const rb = $('repeat-btn');
    rb.textContent = `Repeat: ${LIFT_NAMES[store.currentLift]} ${w} ${store.unit} x ${r}`;
    rb.classList.add('visible');

    // Haptic feedback
    if (navigator.vibrate) navigator.vibrate(50);

    // Auto-progression: detect AMRAP program set match
    let progApplied = false;
    if (
      store.programConfig.activeProgram &&
      store.programConfig.autoProgressEnabled &&
      _deps.getProgramWorkout
    ) {
      const workout = _deps.getProgramWorkout(store.currentLift);
      if (workout) {
        const loggedWeight = inputToLbs(w);
        const lw = store.programConfig.liftWeeks?.[store.currentLift] || 1;
        workout.sets.forEach((s, idx) => {
          if (
            typeof s.reps === 'string' &&
            s.reps.includes('+') &&
            Math.abs(s.weight - loggedWeight) <= 3
          ) {
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
      const shareData = {
        lift: store.currentLift,
        weight: entry.weight,
        e1rm: entry.e1rm,
        date: entry.date,
      };
      showToast(
        `NEW PR! ${name} e1RM: ${formatWeight(entry.e1rm)} ${store.unit}`,
        true,
        milestone,
        shareData
      );
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
  document.querySelectorAll('.lift-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lift-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      store.currentLift = btn.dataset.lift;
      updatePreview();
      _deps.renderProgramSection?.();
      _deps.updateWorkoutButton?.();
    });
  });

  // RPE selector
  document.querySelectorAll('.rpe-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rpe-pill').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
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
  [weightInput, repsInput, notesInput].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !logBtn.disabled) logBtn.click();
    });
  });

  // Repeat last set
  $('repeat-btn').addEventListener('click', () => {
    if (!store.lastLoggedSet) return;
    const { lift, weight, reps, rpe, notes } = store.lastLoggedSet;
    const { entry, isPR, milestone } = addEntry(lift, weight, reps, rpe, notes);
    if (isPR) {
      const shareData = { lift, weight: entry.weight, e1rm: entry.e1rm, date: entry.date };
      showToast(
        `NEW PR! ${LIFT_NAMES[lift]} e1RM: ${formatWeight(entry.e1rm)} ${store.unit}`,
        true,
        milestone,
        shareData
      );
    } else {
      showToast('Set repeated');
    }
  });

  // Tag pills
  renderTagPills();

  // "Recommended" entry — the smart-workout engine's proper UI home,
  // next to the Start Workout button.
  _initRecommendedEntry();
}

// ---------------------------------------------------------------------------
// Recommended workout entry
// ---------------------------------------------------------------------------

/**
 * Insert the compact Recommended button next to the Start Workout button.
 * Tapping it shows the smart-workout engine's top recommendation
 * (suggestMainLift + suggestIntensity) with human-readable reasons and a
 * "Start this workout" CTA that opens the builder pre-filled — via
 * openBuilder, so the #builder/<lift> router entry is pushed exactly like
 * every other builder entry point.
 */
function _initRecommendedEntry() {
  const anchor = $('create-workout-btn');
  if (!anchor || $('recommended-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'recommended-btn';
  btn.className = 'btn-dashed';
  btn.textContent = '✨ Recommended';
  anchor.insertAdjacentElement('afterend', btn);
  btn.addEventListener('click', _toggleRecommendedCard);
}

/** Toggle the recommendation card under the Recommended button. */
function _toggleRecommendedCard() {
  const existing = $('recommended-card');
  if (existing) {
    existing.remove();
    return;
  }
  let suggestion;
  try {
    const { lift, reasons } = suggestMainLift();
    const intensity = suggestIntensity(lift);
    suggestion = { lift, reasons: reasons[lift] || [], intensity };
  } catch (err) {
    console.warn('Recommended workout failed:', err);
    showToast('Could not compute a recommendation');
    return;
  }
  const { lift, reasons, intensity } = suggestion;
  const card = document.createElement('div');
  card.id = 'recommended-card';
  card.setAttribute(
    'style',
    'margin-top:8px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)'
  );
  card.innerHTML =
    `<div style="font-weight:700;font-size:var(--text-base)">✨ Recommended: ${escapeHTML(LIFT_NAMES[lift] || lift)}</div>` +
    `<div style="font-size:var(--text-sm);color:var(--text-dim);margin:4px 0">${intensity.sets}×${intensity.reps} @ ${intensity.pctTM}% TM &middot; RPE ${intensity.rpe}</div>` +
    (reasons.length > 0
      ? `<ul style="margin:8px 0;padding-left:18px;font-size:var(--text-sm);color:var(--text-dim);line-height:1.5">${reasons.map((r) => `<li>${escapeHTML(r)}</li>`).join('')}</ul>`
      : '') +
    `<button type="button" id="recommended-start" class="btn-primary" style="width:100%;margin-top:8px">Start this workout</button>`;
  $('recommended-btn').insertAdjacentElement('afterend', card);
  card.querySelector('#recommended-start').addEventListener('click', () => {
    card.remove();
    openBuilder(lift, buildDefaultSlots(lift));
  });
}
