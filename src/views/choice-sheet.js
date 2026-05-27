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
import { showToast } from '../ui/toast.js';
import { closeChoiceSheet } from '../ui/sheet.js';
import { joinSharedWorkout, subscribeSharedWorkout } from '../firebase/shared-workout.js';
import { confirmSheet } from '../ui/confirm-sheet.js';
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
  const hasProg = !!store.programConfig.activeProgram;
  if (hasMeso) {
    html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:var(--space-3)">Current: ${store.activeMesocycle.name} (Week ${store.activeMesocycle.currentWeek}/${store.activeMesocycle.durationWeeks})</div>`;
  } else if (hasProg) {
    html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:var(--space-3)">Current: ${PROGRAM_TEMPLATES[store.programConfig.activeProgram].name} (Week ${store.programConfig.liftWeeks?.[store.currentLift] || 1})</div>`;
  }

  html += `<div class="choice-card" data-action="setup-program">
    <div class="choice-card-icon green">&#128203;</div>
    <div class="choice-card-text">
      <div class="choice-card-title">${hasProg ? 'Change' : 'Choose a'} Program</div>
      <div class="choice-card-desc">5/3/1, nSuns, GZCL, Texas Method, SL5x5, Starting Strength</div>
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

  if (hasProg || hasMeso) {
    html += `<div class="choice-card" data-action="disable-plan" style="opacity:0.6">
      <div class="choice-card-icon red">&#10005;</div>
      <div class="choice-card-text">
        <div class="choice-card-title">Remove Plan</div>
        <div class="choice-card-desc">Disable active program${hasMeso ? ' and abandon mesocycle' : ''}</div>
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
        store.saveProgramConfig();
        _deps.renderProgramSection?.();
        _deps.updateWorkoutButton?.();
        showToast('Training plan removed');
      }
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

  // --- Active Training Plan section (program OR mesocycle) ---
  const hasMeso = store.activeMesocycle && store.activeMesocycle.status === 'active';
  const hasProg = !!store.programConfig.activeProgram;

  if (hasMeso || hasProg) {
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
  html += `<div class="section-label">${hasMeso || hasProg ? 'Or start a different workout' : 'Choose a workout'}</div>`;

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
  if (!hasProg && !hasMeso) {
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
  if (!hasMeso && !hasProg) {
    html += `<div class="section-label" style="margin:var(--space-3) 0 var(--space-2)">Set up a training plan</div>`;
    html += `<div class="choice-card" data-action="setup-program">
      <div class="choice-card-icon green">&#128203;</div>
      <div class="choice-card-text">
        <div class="choice-card-title">Choose a Program</div>
        <div class="choice-card-desc">5/3/1, nSuns, GZCL, Texas Method, SL5x5, Starting Strength</div>
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
    const refTM =
      partnerTM ?? (bestE1RM(mainLift) != null ? bestE1RM(mainLift) * 0.9 : null) ?? hostW;
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

/**
 * Handle the "Join shared workout" flow:
 * - Check active session conflict (save to templates / discard / cancel)
 * - Prompt for 6-char code
 * - Join the Firestore doc and build partner session
 * - Subscribe to real-time updates
 */
export async function joinSharedWorkoutFlow(prefillCode) {
  return _handleJoinShared(prefillCode);
}

async function _handleJoinShared(prefillCode) {
  // Check for active session conflict
  if (store.workoutSession && !store.workoutSession.completed) {
    const proceed = await confirmSheet({
      title: 'You have an active workout',
      body: 'Leave it to join a shared workout?',
      confirmLabel: 'Leave',
      cancelLabel: 'Cancel',
      tone: 'danger',
    });
    if (!proceed) return;

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
  }

  // Prompt for share code (or use pre-filled code from URL param)
  const code = prefillCode || prompt('Enter the 6-character share code:');
  if (!code || !code.trim()) return;

  try {
    const joinInfo = await joinSharedWorkout(code.trim());
    const session = _scaleSessionForPartner(joinInfo.session, joinInfo.mainLift, joinInfo);
    store.workoutSession = session;
    store.saveNow('workoutSession');

    // Subscribe to real-time updates — the onSharedWorkoutUpdate callback is
    // exported from workout-overlay.js and injected via setChoiceSheetDeps
    subscribeSharedWorkout(joinInfo.code, _deps.onSharedWorkoutUpdate);

    _deps.openWorkoutView?.(joinInfo.mainLift);
    showToast(`Joined ${joinInfo.hostName}'s workout!`);
  } catch (err) {
    showToast('Could not join: ' + (err.message || err));
  }
}
