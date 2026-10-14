/**
 * Choice sheet — the workout selection menu with options like
 * Quick Workout, Smart Workout, program-based, mesocycle, etc.
 *
 * Also includes the plan-switcher sub-view and mesocycle timeline.
 */

import store from '../state/store.js';
import { $, escapeHTML } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { isLiftComplete } from '../systems/programs.js';
import { isSplitActive, getSplitDay } from '../systems/split-plan.js';
import { showToast } from '../ui/toast.js';
import { openSheet, closeSheet, closeChoiceSheet } from '../ui/sheet.js';
import { currentUser } from '../firebase/auth.js';
import {
  joinSharedWorkout,
  subscribeSharedWorkout,
  normalizeShareCode,
  savePendingJoinCode,
  clearPendingJoinCode,
  fetchSharedWorkout,
  ShareJoinError,
} from '../firebase/shared-workout.js';
import { confirmSheet } from '../ui/confirm-sheet.js';
import { trapFocus, releaseFocus } from '../ui/focus-trap.js';
import { formatWeight } from '../formulas/units.js';
import { getAccessoryWeight, computeSetWeights } from '../systems/workout-builder.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { roundToPlate } from '../formulas/plates.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

const _deps = {};

export function setChoiceSheetDeps(deps) {
  Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// Mesocycle timeline renderer
// ---------------------------------------------------------------------------

function renderMesoTimeline(mesocycle) {
  let html = `<div class="meso-timeline" id="choice-meso-timeline">`;
  mesocycle.weeks.forEach((w, i) => {
    const isCurrent = i === mesocycle.currentWeek - 1;
    const isCompleted = w.completed;
    const liftsDone = LIFTS.filter((l) => w.performance?.[l]).length;
    html += `<div class="meso-week-card${isCurrent ? ' current' : ''}${isCompleted ? ' completed' : ''}${w.adapted ? ' adapted' : ''}" data-week="${i}">
      <div class="meso-week-num">W${w.weekNum}</div>
      <div class="meso-week-phase">${w.phase}</div>
      ${isCompleted ? '<div class="meso-week-check">&#10003; &#10003; &#10003;</div>' : `<div class="meso-week-check">${'&#10003; '.repeat(liftsDone)}</div>`}
      <div class="meso-week-rpe">RPE ${w.targetRPE}</div>
    </div>`;
  });
  html += `</div>`;
  return html;
}

// ---------------------------------------------------------------------------
// Plan switcher (sub-view)
// ---------------------------------------------------------------------------

function showPlanSwitcher() {
  const body = $('choice-sheet-body');
  $('choice-sheet-title').textContent = 'Switch Training Plan';
  let html = '';

  const hasMeso = store.activeMesocycle && store.activeMesocycle.status === 'active';
  const hasSplit = isSplitActive();
  const hasProg = !!store.programConfig.activeProgram && !hasSplit;
  if (hasMeso) {
    html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:var(--space-3)">Current: ${store.activeMesocycle.name} (Week ${store.activeMesocycle.currentWeek}/${store.activeMesocycle.durationWeeks})</div>`;
  } else if (hasSplit) {
    const day = getSplitDay();
    html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:var(--space-3)">Current: Bodybuilding${day ? ` (${day.label}, Day ${day.index + 1}/${day.total})` : ''}</div>`;
  } else if (hasProg) {
    html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:var(--space-3)">Current: ${PROGRAM_TEMPLATES[store.programConfig.activeProgram].name} (Week ${store.programConfig.liftWeeks?.[store.currentLift] || 1})</div>`;
  }

  html += `<div class="choice-card" data-action="setup-program">
    <div class="choice-card-icon green">&#128203;</div>
    <div class="choice-card-text">
      <div class="choice-card-title">${hasProg ? 'Change' : 'Choose a'} Program</div>
      <div class="choice-card-desc">5/3/1, nSuns, GZCL, Texas Method, StrongLifts 5×5, Bodybuilding</div>
    </div>
    <div class="choice-card-arrow">&#8250;</div>
  </div>`;

  html += `<div class="choice-card" data-action="mesogen">
    <div class="choice-card-icon red">&#128197;</div>
    <div class="choice-card-text">
      <div class="choice-card-title">${hasMeso ? 'New' : 'Generate'} Mesocycle</div>
      <div class="choice-card-desc">Create a multi-week periodized plan</div>
    </div>
    <div class="choice-card-arrow">&#8250;</div>
  </div>`;

  if (hasProg || hasMeso || hasSplit) {
    html += `<div class="choice-card" data-action="disable-plan" style="opacity:0.6">
      <div class="choice-card-icon red">&#10005;</div>
      <div class="choice-card-text">
        <div class="choice-card-title">Remove Plan</div>
        <div class="choice-card-desc">Disable active ${hasSplit ? 'bodybuilding plan' : 'program'}${hasMeso ? ' and abandon mesocycle' : ''}</div>
      </div>
      <div class="choice-card-arrow">&#8250;</div>
    </div>`;
  }

  body.innerHTML = html;
  $('choice-sheet-backdrop').style.display = 'block';
  $('choice-sheet').style.display = 'block';
  document.body.style.overflow = 'hidden';

  body.querySelectorAll('.choice-card').forEach((card) => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      closeChoiceSheet();
      if (action === 'setup-program') {
        _deps.showProgramSetupModal?.();
      } else if (action === 'mesogen') {
        if (hasMeso) _deps.abandonMesocycle?.();
        _deps.showMesocycleGenerator?.();
      } else if (action === 'disable-plan') {
        if (hasMeso) _deps.abandonMesocycle?.();
        store.programConfig.activeProgram = null;
        store.programConfig.splitPlan = null;
        store.saveProgramConfig();
        _deps.renderProgramSection?.();
        _deps.updateWorkoutButton?.();
        showToast('Training plan removed');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Split day override picker (sub-view)
// ---------------------------------------------------------------------------

function showSplitDayPicker() {
  const current = getSplitDay();
  if (!current) return;
  const body = $('choice-sheet-body');
  $('choice-sheet-title').textContent = 'Choose a Day';

  let html = `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:var(--space-3)">Start any day without changing your rotation.</div>`;
  for (let i = 0; i < current.total; i++) {
    const day = getSplitDay(i);
    const isCurrent = i === current.index;
    html += `<div class="choice-card" data-split-day="${i}">
      <div class="choice-card-icon purple">&#127947;</div>
      <div class="choice-card-text">
        <div class="choice-card-title">${day.label}${isCurrent ? ' (next up)' : ''}</div>
        <div class="choice-card-desc">${escapeHTML(day.muscles.join(' · '))}</div>
      </div>
      <div class="choice-card-arrow">&#8250;</div>
    </div>`;
  }

  body.innerHTML = html;
  $('choice-sheet-backdrop').style.display = 'block';
  $('choice-sheet').style.display = 'block';
  document.body.style.overflow = 'hidden';

  body.querySelectorAll('[data-split-day]').forEach((card) => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.splitDay);
      closeChoiceSheet();
      _deps.createSplitSession?.(idx);
      _deps.openSplitWorkoutView?.();
    });
  });
}

// ---------------------------------------------------------------------------
// Main choice sheet body renderer
// ---------------------------------------------------------------------------

/**
 * Render the choice sheet body and open it.
 * Called when the user taps the workout button.
 */
export function renderChoiceSheetBody() {
  const lift = store.currentLift;
  // Resume an in-progress bodybuilding split session regardless of lift tab
  if (
    store.workoutSession &&
    !store.workoutSession.completed &&
    store.workoutSession.source === 'split'
  ) {
    _deps.openSplitWorkoutView?.();
    return;
  }
  // If resuming an active session for THIS lift, skip choice sheet
  if (
    store.workoutSession &&
    !store.workoutSession.completed &&
    store.workoutSession.mainLift === lift
  ) {
    _deps.openWorkoutView?.(lift);
    return;
  }
  const body = $('choice-sheet-body');
  $('choice-sheet-title').textContent = `${LIFT_NAMES[lift]} Workout`;
  let html = '';

  // --- Active Training Plan section (program OR mesocycle OR split) ---
  const hasMeso = store.activeMesocycle && store.activeMesocycle.status === 'active';
  const hasSplit = isSplitActive();
  const hasProg = !!store.programConfig.activeProgram && !hasSplit;

  if (hasMeso || hasSplit || hasProg) {
    html += `<div class="section-label">Active Plan</div>`;

    if (hasMeso) {
      const week = store.activeMesocycle.weeks[store.activeMesocycle.currentWeek - 1];
      const phase = week ? week.phase : '';
      const liftDone = week && week.performance[lift];
      html += renderMesoTimeline(store.activeMesocycle);
      html += `<div class="choice-card meso-active" data-action="mesocycle">
        <div class="choice-card-icon blue">&#9776;</div>
        <div class="choice-card-text">
          <div class="choice-card-title">Mesocycle: Week ${store.activeMesocycle.currentWeek}${liftDone ? ' (Done)' : ''}</div>
          <div class="choice-card-desc">${store.activeMesocycle.name} &bull; ${phase}</div>
        </div>
        <div class="choice-card-arrow">&#8250;</div>
      </div>`;
    } else if (hasSplit) {
      const day = getSplitDay();
      if (day) {
        html += `<div class="choice-card" data-action="split">
          <div class="choice-card-icon purple">&#127947;</div>
          <div class="choice-card-text">
            <div class="choice-card-title">Bodybuilding — ${day.label} (Day ${day.index + 1}/${day.total})</div>
            <div class="choice-card-desc">${escapeHTML(day.muscles.join(' · '))}</div>
          </div>
          <div class="choice-card-arrow">&#8250;</div>
        </div>`;
        html += `<button class="choice-plan-link" data-action="split-pick-day" style="display:block;margin-bottom:var(--space-2)">Choose a different day</button>`;
      }
    } else if (hasProg) {
      const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
      const liftDone = isLiftComplete(lift);
      html += `<div class="choice-card" data-action="quick">
        <div class="choice-card-icon green">&#9889;</div>
        <div class="choice-card-text">
          <div class="choice-card-title">${tmpl.name} \u2014 Week ${store.programConfig.liftWeeks?.[lift] || 1}${liftDone ? ' (Done)' : ''}</div>
          <div class="choice-card-desc">Tap to start today's programmed ${LIFT_NAMES[lift]} sets</div>
        </div>
        <div class="choice-card-arrow">&#8250;</div>
      </div>`;
    }

    html += `<div style="display:flex;gap:var(--space-2);margin-bottom:var(--space-3)">`;
    if (hasMeso) {
      html += `<button class="choice-plan-link" data-action="abandon-meso">Abandon Mesocycle</button>`;
    }
    html += `<button class="choice-plan-link" data-action="switch-plan" style="margin-left:auto">Switch Plan</button>`;
    html += `</div>`;
  }

  // --- Workout options ---
  html += `<div class="section-label">${hasMeso || hasProg || hasSplit ? 'Or start a different workout' : 'Choose a workout'}</div>`;

  // Guided Builder
  html += `<div class="choice-card" data-action="custom">
    <div class="choice-card-icon purple">&#9998;</div>
    <div class="choice-card-text">
      <div class="choice-card-title">Guided Builder</div>
      <div class="choice-card-desc">Build a custom workout with smart suggestions</div>
    </div>
    <div class="choice-card-arrow">&#8250;</div>
  </div>`;

  // #14: Repeat Last Workout
  const lastLogs = store.accessoryLog
    .filter((l) => l.mainLift === store.currentLift)
    .sort((a, b) => b.timestamp - a.timestamp);
  if (lastLogs.length > 0) {
    const lastDate = lastLogs[0].date;
    const lastSession = lastLogs.filter((l) => l.date === lastDate);
    const lastNames = [...new Set(lastSession.map((l) => l.name || l.exerciseId))].slice(0, 3);
    const lastDesc = lastNames.join(', ') + (lastSession.length > 3 ? '...' : '');
    html += `<div class="choice-card" data-action="repeat-last">
      <div class="choice-card-icon gold">&#8634;</div>
      <div class="choice-card-text">
        <div class="choice-card-title">Repeat Last (${lastDate})</div>
        <div class="choice-card-desc">${escapeHTML(lastDesc)}</div>
      </div>
      <div class="choice-card-arrow">&#8250;</div>
    </div>`;
  }

  // Saved Templates — #19: show recent template name
  if (store.customTemplates.length > 0) {
    const liftTemplates = store.customTemplates.filter((t) => t.mainLift === store.currentLift);
    if (liftTemplates.length > 0) {
      const sorted = [...liftTemplates].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
      const recentName = sorted[0].name;
      const desc =
        liftTemplates.length === 1
          ? `"${escapeHTML(recentName)}"`
          : `"${escapeHTML(recentName)}" and ${liftTemplates.length - 1} more`;
      html += `<div class="choice-card" data-action="templates">
        <div class="choice-card-icon blue">&#128196;</div>
        <div class="choice-card-text">
          <div class="choice-card-title">Saved Templates (${liftTemplates.length})</div>
          <div class="choice-card-desc">${desc}</div>
        </div>
        <div class="choice-card-arrow">&#8250;</div>
      </div>`;
    }
  }

  // Travel / off-program (always visible)
  html += `<div class="choice-card" data-action="travel">
    <div class="choice-card-icon" style="background:var(--orange-muted,#3a2800);color:var(--orange)">&#9992;</div>
    <div class="choice-card-text">
      <div class="choice-card-title">Off-Program / Travel</div>
      <div class="choice-card-desc">Limited equipment, fatigue-aware — doesn&apos;t touch your program</div>
    </div>
    <div class="choice-card-arrow">&#8250;</div>
  </div>`;

  // Join a shared workout (always visible)
  html += `<div class="choice-card" data-action="join-shared">
    <div class="choice-card-icon" style="background:var(--accent-muted,#1a2a3a);color:var(--accent,#64b5f6)">&#128101;</div>
    <div class="choice-card-text">
      <div class="choice-card-title">Join Shared Workout</div>
      <div class="choice-card-desc">Train along with a friend — enter their 6-char code</div>
    </div>
    <div class="choice-card-arrow">&#8250;</div>
  </div>`;

  // Quick start (only if no active program)
  if (!hasProg && !hasMeso && !hasSplit) {
    html += `<div class="choice-card" data-action="quick">
      <div class="choice-card-icon green">&#9889;</div>
      <div class="choice-card-text">
        <div class="choice-card-title">Quick Start</div>
        <div class="choice-card-desc">Auto-generate based on weak points</div>
      </div>
      <div class="choice-card-arrow">&#8250;</div>
    </div>`;
  }

  // --- Plan setup ---
  if (!hasMeso && !hasProg && !hasSplit) {
    html += `<div class="section-label" style="margin:var(--space-3) 0 var(--space-2)">Set up a training plan</div>`;
    html += `<div class="choice-card" data-action="setup-program">
      <div class="choice-card-icon green">&#128203;</div>
      <div class="choice-card-text">
        <div class="choice-card-title">Choose a Program</div>
        <div class="choice-card-desc">5/3/1, nSuns, GZCL, Texas Method, StrongLifts 5×5, Bodybuilding</div>
      </div>
      <div class="choice-card-arrow">&#8250;</div>
    </div>`;
    html += `<div class="choice-card" data-action="mesogen">
      <div class="choice-card-icon red">&#128197;</div>
      <div class="choice-card-text">
        <div class="choice-card-title">Generate Mesocycle</div>
        <div class="choice-card-desc">Create a multi-week periodized plan</div>
      </div>
      <div class="choice-card-arrow">&#8250;</div>
    </div>`;
  }

  body.innerHTML = html;
  $('choice-sheet-backdrop').style.display = 'block';
  $('choice-sheet').style.display = 'block';
  document.body.style.overflow = 'hidden';

  // Attach click handlers
  body.querySelectorAll('.choice-card').forEach((card) => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      closeChoiceSheet();
      if (action === 'quick') {
        if (!store.workoutConfig.weakPoints[store.currentLift]) {
          _deps.showWeakPointSetupModal?.(store.currentLift);
          return;
        }
        _deps.openWorkoutView?.(store.currentLift);
      } else if (action === 'custom') {
        _deps.openBuilder?.(store.currentLift);
      } else if (action === 'repeat-last') {
        // Reconstruct exercises from last session's accessory log
        const lift = store.currentLift;
        const logs = store.accessoryLog
          .filter((l) => l.mainLift === lift)
          .sort((a, b) => b.timestamp - a.timestamp);
        if (logs.length > 0) {
          const date = logs[0].date;
          const session = logs.filter((l) => l.date === date);
          const exercises = session.map((l, i) => ({
            type: 'accessory',
            exerciseId: l.exerciseId,
            name: l.name || l.exerciseId,
            sets: l.targetSets || l.setsCompleted.length,
            reps: l.repRange ? l.repRange[1] : 10,
            weightMode: 'auto',
            weightValue: l.weight,
            equipment: l.equipment || 'barbell',
            repRange: l.repRange || [8, 12],
            order: i + 1,
            slotRole: 'accessory',
            reasons: [],
          }));
          _deps.openBuilder?.(lift, exercises);
        }
      } else if (action === 'templates') {
        _deps.showTemplateList?.();
      } else if (action === 'mesocycle') {
        _deps.openMesocycleWorkout?.(store.currentLift);
      } else if (action === 'split') {
        _deps.createSplitSession?.();
        _deps.openSplitWorkoutView?.();
      } else if (action === 'mesogen') {
        _deps.showMesocycleGenerator?.();
      } else if (action === 'setup-program') {
        _deps.showProgramSetupModal?.();
      } else if (action === 'travel') {
        _deps.startTravelFlow?.();
      } else if (action === 'join-shared') {
        _handleJoinShared();
      }
    });
  });

  // Plan link handlers
  body.querySelectorAll('.choice-plan-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = link.dataset.action;
      if (action === 'abandon-meso') {
        closeChoiceSheet();
        _deps.abandonMesocycle?.();
      } else if (action === 'switch-plan') {
        closeChoiceSheet();
        showPlanSwitcher();
      } else if (action === 'split-pick-day') {
        showSplitDayPicker();
      }
    });
  });

  // Week card clicks for mesocycle detail
  body.querySelectorAll('.meso-week-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      // showMesoWeekDetail is in mesocycle-ui
      const event = new CustomEvent('meso-week-click', { detail: parseInt(card.dataset.week) });
      document.dispatchEvent(event);
    });
  });

  // Scroll timeline to current week
  if (hasMeso) {
    setTimeout(() => {
      const timeline = $('choice-meso-timeline');
      if (timeline) {
        const current = timeline.querySelector('.current');
        if (current)
          current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }, 50);
  }
}

// ---------------------------------------------------------------------------
// Join shared workout flow
// ---------------------------------------------------------------------------

/**
 * Scale a host's shared session payload to the partner's own training maxes.
 */
function _scaleSessionForPartner(hostPayload, mainLift, shareInfo) {
  const partnerTM = store.programConfig?.trainingMaxes?.[mainLift];

  function _setWeight(pct, hostW) {
    if (!pct) return hostW ?? 0;
    const refTM = partnerTM ?? (bestE1RM(mainLift) != null ? bestE1RM(mainLift) * 0.9 : null);
    // If partner has a TM or e1RM, scale from it; otherwise use host's exact weight directly
    return refTM != null ? roundToPlate((refTM * pct) / 100) : (hostW ?? 0);
  }

  const mainSets = (hostPayload.mainSets || []).map((s) => ({
    num: s.num,
    weight: _setWeight(s.pct, s._hostWeight),
    reps: s.reps,
    pct: s.pct,
    tier: s.tier,
    day: s.day,
    completed: false,
    rpe: null,
  }));

  const bbbSets = (hostPayload.bbbSets || []).map((s) => ({
    num: s.num,
    weight: _setWeight(s.pct, s._hostWeight),
    reps: s.reps,
    pct: s.pct,
    tier: s.tier,
    completed: false,
  }));

  const accessories = (hostPayload.accessories || []).map((a) => {
    const w = getAccessoryWeight(a.exerciseId, mainLift) || (a._hostWeights?.[0] ?? 0);
    return {
      exerciseId: a.exerciseId,
      name: a.name,
      setWeights: computeSetWeights(w, a.targetSets),
      targetSets: a.targetSets,
      repRange: a.repRange,
      equipment: a.equipment,
      setsCompleted: [],
      progressed: false,
    };
  });

  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    mainLift,
    programWeek: null,
    date: new Date().toISOString().split('T')[0],
    startTime: Date.now(),
    mainSets,
    bbbSets,
    accessories,
    completed: false,
    source: 'shared',
    shared: {
      role: 'partner',
      code: shareInfo.code,
      hostUid: shareInfo.hostUid,
      hostName: shareInfo.hostName,
      members: {},
      hostProgress: {
        mainSets: (hostPayload.mainSets || []).map((s) => s.completed),
        bbbSets: (hostPayload.bbbSets || []).map((s) => s.completed),
        accessories: (hostPayload.accessories || []).map((a) => (a.setsCompleted || []).length),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Join shared workout flow
//
// Fully async — no native prompt()/confirm() anywhere in this flow.
// The code-entry sheet is static markup in index.src.html; the recipient
// preview sheet is built dynamically (confirm-sheet lifecycle pattern).
// ---------------------------------------------------------------------------

let _sharedFlowBusy = false;
let _codeSheetWired = false;
let _activePreview = null;

/**
 * Entry point for joining a shared workout with a KNOWN code
 * (from a ?join= link, a #workout/CODE link, or the auth-restore hook).
 * Never throws; never loses the pending code on non-terminal failures.
 * @param {string} prefillCode
 */
export async function joinSharedWorkoutFlow(prefillCode) {
  try {
    await _beginJoinFlow(prefillCode);
  } catch (err) {
    console.error('[shared] join flow failed:', err);
    showToast('Could not join: ' + (err?.message || err));
  }
}

/**
 * Core join flow: validate code → signed-in check → active-session conflict
 * check → recipient preview sheet → "Train along" seeds a local session.
 * @param {string} prefillCode
 */
async function _beginJoinFlow(prefillCode) {
  if (_sharedFlowBusy) return;
  const code = normalizeShareCode(prefillCode);
  if (!code) return;

  _sharedFlowBusy = true;
  try {
    // Logged-out recipient: non-blocking nudge. The code stays in
    // sessionStorage so the auth-restore hook runs the join after sign-in.
    if (!currentUser) {
      savePendingJoinCode(code);
      showToast('Sign in to join this shared workout');
      return;
    }
    const canLeave = await _ensureCanLeaveActiveSession();
    if (!canLeave) {
      clearPendingJoinCode();
      return;
    }
    const outcome = await _openSharedPreviewSheet(code);
    // Terminal outcomes clear the pending code; only a signed-out mid-flow
    // keeps it (the restore hook re-runs the join after sign-in).
    if (outcome !== 'signed-out') clearPendingJoinCode();
  } finally {
    _sharedFlowBusy = false;
  }
}

/**
 * "Join Shared Workout" card tap: conflict check first, then the in-app
 * code-entry sheet (replaces the old native prompt()).
 */
async function _handleJoinShared() {
  const canLeave = await _ensureCanLeaveActiveSession();
  if (!canLeave) return;
  openCodeEntrySheet();
}

/**
 * Active-session conflict check: offer to save the in-progress workout as a
 * template before leaving it. Returns false when the user cancels.
 */
async function _ensureCanLeaveActiveSession() {
  if (!store.workoutSession || store.workoutSession.completed) return true;

  const proceed = await confirmSheet({
    title: 'You have an active workout',
    body: 'Leave it to join a shared workout?',
    confirmLabel: 'Leave',
    cancelLabel: 'Cancel',
    tone: 'danger',
  });
  if (!proceed) return false;

  // Offer to save as template
  const save = await confirmSheet({
    title: 'Save your workout first?',
    body: 'Save it as a template so you can resume later.',
    confirmLabel: 'Save template',
    cancelLabel: 'Discard it',
    tone: 'primary',
  });
  if (save) {
    const sess = store.workoutSession;
    const date = sess.date || new Date().toISOString().split('T')[0];
    store.customTemplates.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: `Resumed ${LIFT_NAMES[sess.mainLift] || sess.mainLift} — ${date}`,
      mainLift: sess.mainLift,
      createdAt: Date.now(),
      lastUsed: null,
      exercises: (sess.accessories || []).map((a) => ({
        type: 'accessory',
        exerciseId: a.exerciseId,
        name: a.name,
        sets: a.targetSets,
        reps: a.repRange?.[1] ?? 10,
        weightMode: 'auto',
        weightValue: a.setWeights?.[a.setWeights.length - 1] ?? 0,
        equipment: a.equipment || 'barbell',
        repRange: a.repRange || [8, 12],
        order: 0,
        slotRole: 'accessory',
        reasons: [],
      })),
    });
    store.saveCustomTemplates();
    showToast('Workout saved to templates');
  }
  store.workoutSession = null;
  store._sessionOptimizer = null;
  store.saveNow('workoutSession');
  return true;
}

// ---------------------------------------------------------------------------
// Code-entry sheet (static markup in index.src.html)
// ---------------------------------------------------------------------------

function _wireCodeEntrySheet() {
  if (_codeSheetWired) return;
  _codeSheetWired = true;
  const input = $('code-entry-input');
  // Uppercase auto-format: strip non-alphanumerics, cap at 6 chars.
  input.addEventListener('input', () => {
    const clean = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (input.value !== clean) input.value = clean;
    _hideCodeEntryError();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      _submitCodeEntry();
    }
  });
  $('code-entry-join').addEventListener('click', _submitCodeEntry);
  $('code-entry-cancel').addEventListener('click', closeCodeEntrySheet);
  $('code-entry-close').addEventListener('click', closeCodeEntrySheet);
  $('code-entry-backdrop').addEventListener('click', closeCodeEntrySheet);
}

/** Open the in-app code-entry sheet and focus the input. */
export function openCodeEntrySheet() {
  _wireCodeEntrySheet();
  const input = $('code-entry-input');
  input.value = '';
  _hideCodeEntryError();
  openSheet('code-entry-sheet', 'code-entry-backdrop');
  // Focus after the sheet animates in so the mobile keyboard opens.
  setTimeout(() => input.focus(), 80);
}

export function closeCodeEntrySheet() {
  closeSheet('code-entry-sheet', 'code-entry-backdrop');
}

function _hideCodeEntryError() {
  const err = $('code-entry-error');
  if (err) {
    err.textContent = '';
    err.style.display = 'none';
  }
}

function _submitCodeEntry() {
  const input = $('code-entry-input');
  const code = normalizeShareCode(input.value);
  if (!code) {
    const err = $('code-entry-error');
    err.textContent = 'Codes are 6 letters/numbers — check the code and try again.';
    err.style.display = 'block';
    input.focus();
    return;
  }
  closeCodeEntrySheet();
  // Fire and forget: _beginJoinFlow is guarded and never rejects outwardly.
  _beginJoinFlow(code).catch((err) => {
    console.error('[shared] code-entry join failed:', err);
    showToast('Could not join: ' + (err?.message || err));
  });
}

// ---------------------------------------------------------------------------
// Recipient preview sheet (dynamic DOM, confirm-sheet lifecycle pattern)
// ---------------------------------------------------------------------------

function _dismissPreviewSheet(outcome = 'dismissed') {
  if (_activePreview) _activePreview.dismiss(outcome);
}

/**
 * Open the recipient preview sheet for a shared workout code.
 * States: loading skeleton → loaded (exercise list, sets/reps/weights, host
 * name, "Train along" CTA) → error states (invalid/expired with an
 * "enter a different code" action; network failure with Retry).
 * The join path is bounded: fetchSharedWorkout races a 10s timeout, retries
 * are user-initiated only — no unbounded loops, no await-without-timeout.
 *
 * @param {string} code - normalized 6-char share code
 * @returns {Promise<'started'|'invalid'|'dismissed'|'signed-out'>}
 */
function _openSharedPreviewSheet(code) {
  // Only one preview at a time; the previous one resolves as dismissed.
  _dismissPreviewSheet('dismissed');

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop shared-preview-backdrop';

    const sheet = document.createElement('div');
    sheet.className = 'sheet-panel shared-preview-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Shared workout');
    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <h3>Shared Workout</h3>
        <button class="modal-close" type="button" id="shared-preview-close" aria-label="Close">&times;</button>
      </div>
      <div class="sheet-body" id="shared-preview-body"></div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';

    let settled = false;
    const dismiss = (outcome = 'dismissed') => {
      if (settled) return;
      settled = true;
      _activePreview = null;
      releaseFocus(sheet);
      backdrop.remove();
      sheet.remove();
      if (!document.querySelector('.sheet-panel')) document.body.style.overflow = '';
      resolve(outcome);
    };
    _activePreview = { dismiss };

    $('shared-preview-close').addEventListener('click', () => dismiss('dismissed'));
    backdrop.addEventListener('click', () => dismiss('dismissed'));
    // Escape dismisses via the focus trap.
    trapFocus(sheet, () => dismiss('dismissed'));

    _loadPreview(code, $('shared-preview-body'), dismiss);
  });
}

async function _loadPreview(code, body, dismiss) {
  _renderPreviewSkeleton(body);
  let info;
  try {
    info = await fetchSharedWorkout(code);
  } catch (err) {
    if (err instanceof ShareJoinError && err.kind === 'signed-out') {
      savePendingJoinCode(code);
      showToast('Sign in to join this shared workout');
      dismiss('signed-out');
      return;
    }
    _renderPreviewError(body, err, () => _loadPreview(code, body, dismiss), dismiss);
    return;
  }

  // Self-tap: the host opened their own link — never join as a partner.
  if (info.hostUid && currentUser && info.hostUid === currentUser.uid) {
    dismiss('dismissed');
    showToast('That\u2019s your own share link — you\u2019re the host');
    if (store.workoutSession?.shared?.code === code) {
      _deps.openWorkoutView?.(info.mainLift);
    }
    return;
  }

  _renderPreviewLoaded(body, info, dismiss);
}

function _renderPreviewSkeleton(body) {
  body.innerHTML = `
    <div class="shared-preview-skel" aria-label="Loading shared workout">
      <div class="skel-line skel-w60"></div>
      <div class="skel-line skel-w40"></div>
      <div class="skel-card"></div>
      <div class="skel-card"></div>
      <div class="skel-card"></div>
    </div>
  `;
}

function _renderPreviewLoaded(body, info, dismiss) {
  const session = info.session || {};
  const mainSets = session.mainSets || [];
  const bbbSets = session.bbbSets || [];
  const accessories = session.accessories || [];
  const liftName = LIFT_NAMES[info.mainLift] || info.mainLift || 'Workout';
  const totalSets = mainSets.length + bbbSets.length;
  const exCount = accessories.length + (mainSets.length > 0 ? 1 : 0);

  const fmtSet = (s) => {
    const w = s._hostWeight != null ? formatWeight(s._hostWeight) + ' ' + store.unit : '';
    const pct = s.pct != null ? ` · ${s.pct}%` : '';
    return `Set ${s.num ?? ''} — ${w} × ${s.reps ?? ''}${pct}`;
  };
  const setRow = (s, tier) =>
    `<div class="shared-ex-row"><span class="shared-ex-name">${escapeHTML(liftName)}${
      tier ? ' · ' + escapeHTML(tier) : ''
    }</span><span class="shared-ex-detail">${escapeHTML(fmtSet(s))}</span></div>`;

  let listHtml = '';
  mainSets.forEach((s) => {
    listHtml += setRow(s, s.tier);
  });
  bbbSets.forEach((s) => {
    listHtml += setRow(s, s.tier || 'BBB');
  });
  accessories.forEach((a) => {
    const rr = Array.isArray(a.repRange) ? a.repRange.join('–') : '';
    listHtml += `<div class="shared-ex-row"><span class="shared-ex-name">${escapeHTML(
      a.name || a.exerciseId
    )}</span><span class="shared-ex-detail">${escapeHTML(
      `${a.targetSets ?? ''} × ${rr}`
    )}</span></div>`;
  });

  body.innerHTML = `
    <div class="shared-host-line"><span class="shared-host-icon">&#128170;</span><span><strong>${escapeHTML(
      info.hostName
    )}</strong> shared a ${escapeHTML(liftName)} workout</span></div>
    <div class="shared-stat-row">
      <div class="shared-stat"><div class="shared-stat-val">${exCount}</div><div class="shared-stat-label">Exercises</div></div>
      <div class="shared-stat"><div class="shared-stat-val">${totalSets}</div><div class="shared-stat-label">Main sets</div></div>
      <div class="shared-stat"><div class="shared-stat-val">${
        accessories.length
      }</div><div class="shared-stat-label">Accessories</div></div>
    </div>
    <div class="shared-ex-list">${
      listHtml || '<div class="shared-ex-empty">No exercises listed.</div>'
    }</div>
    <div class="shared-scale-note">Weights scale to your training maxes when you train along.</div>
    <button class="shared-train-btn" type="button" id="shared-train-along">Train along</button>
    <button class="shared-dismiss-btn" type="button" id="shared-not-now">Not now</button>
  `;

  $('shared-not-now').addEventListener('click', () => dismiss('dismissed'));
  $('shared-train-along').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Joining…';
    try {
      await _startTrainingFromShared(info);
      dismiss('started');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Train along';
      showToast('Could not join: ' + (err?.message || err));
    }
  });
}

function _renderPreviewError(body, err, retry, dismiss) {
  const kind = err instanceof ShareJoinError ? err.kind : 'network';
  const isInvalid = kind === 'invalid' || kind === 'finished';
  const title = isInvalid ? 'This link is invalid or expired' : 'Couldn\u2019t load this workout';
  const detail =
    err?.message ||
    (isInvalid
      ? 'The code may be wrong, or the host may have finished.'
      : 'Check your connection and try again.');

  body.innerHTML = `
    <div class="shared-error">
      <div class="shared-error-icon">${isInvalid ? '&#128279;' : '&#128246;'}</div>
      <div class="shared-error-title">${escapeHTML(title)}</div>
      <div class="shared-error-detail">${escapeHTML(detail)}</div>
      ${
        isInvalid
          ? '<button class="shared-train-btn" type="button" id="shared-retry-code">Enter a different code</button>'
          : '<button class="shared-train-btn" type="button" id="shared-retry-load">Retry</button>'
      }
      <button class="shared-dismiss-btn" type="button" id="shared-err-dismiss">Dismiss</button>
    </div>
  `;

  if (isInvalid) {
    $('shared-retry-code').addEventListener('click', () => {
      dismiss('invalid');
      openCodeEntrySheet();
    });
  } else {
    $('shared-retry-load').addEventListener('click', () => retry());
  }
  $('shared-err-dismiss').addEventListener('click', () => dismiss('dismissed'));
}

/**
 * "Train along": write the membership doc, seed a local partner session
 * (scaled to the partner's TMs, falling back to host weights), subscribe to
 * real-time host updates, and open the workout view.
 */
async function _startTrainingFromShared(info) {
  const joinInfo = await joinSharedWorkout(info.code);
  const session = _scaleSessionForPartner(joinInfo.session, joinInfo.mainLift, joinInfo);
  store.workoutSession = session;
  store.saveNow('workoutSession');

  // Subscribe to real-time updates — the onSharedWorkoutUpdate callback is
  // exported from workout-overlay.js and injected via setChoiceSheetDeps.
  subscribeSharedWorkout(joinInfo.code, _deps.onSharedWorkoutUpdate);

  _deps.openWorkoutView?.(joinInfo.mainLift);
  showToast(`Joined ${joinInfo.hostName}'s workout!`);
}
