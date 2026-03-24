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

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _openWorkoutView = null;
let _openSmartRecommendation = null;
let _openBuilder = null;
let _showTemplateList = null;
let _openMesocycleWorkout = null;
let _showMesocycleGenerator = null;
let _showProgramSetupModal = null;
let _showWeakPointSetupModal = null;
let _abandonMesocycle = null;
let _renderProgramSection = null;
let _updateWorkoutButton = null;

/**
 * Inject dependencies to avoid circular imports.
 */
export function setChoiceSheetDeps(deps) {
  if (deps.openWorkoutView) _openWorkoutView = deps.openWorkoutView;
  if (deps.openSmartRecommendation) _openSmartRecommendation = deps.openSmartRecommendation;
  if (deps.openBuilder) _openBuilder = deps.openBuilder;
  if (deps.showTemplateList) _showTemplateList = deps.showTemplateList;
  if (deps.openMesocycleWorkout) _openMesocycleWorkout = deps.openMesocycleWorkout;
  if (deps.showMesocycleGenerator) _showMesocycleGenerator = deps.showMesocycleGenerator;
  if (deps.showProgramSetupModal) _showProgramSetupModal = deps.showProgramSetupModal;
  if (deps.showWeakPointSetupModal) _showWeakPointSetupModal = deps.showWeakPointSetupModal;
  if (deps.abandonMesocycle) _abandonMesocycle = deps.abandonMesocycle;
  if (deps.renderProgramSection) _renderProgramSection = deps.renderProgramSection;
  if (deps.updateWorkoutButton) _updateWorkoutButton = deps.updateWorkoutButton;
}

// ---------------------------------------------------------------------------
// Mesocycle timeline renderer
// ---------------------------------------------------------------------------

function renderMesoTimeline(mesocycle) {
  let html = `<div class="meso-timeline" id="choice-meso-timeline">`;
  mesocycle.weeks.forEach((w, i) => {
    const isCurrent = i === mesocycle.currentWeek - 1;
    const isCompleted = w.completed;
    const liftsDone = LIFTS.filter(l => w.performance[l]).length;
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
    html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:var(--space-3)">Current: ${PROGRAM_TEMPLATES[store.programConfig.activeProgram].name} (Week ${store.programConfig.currentWeek})</div>`;
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

  body.querySelectorAll('.choice-card').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      closeChoiceSheet();
      if (action === 'setup-program') { if (_showProgramSetupModal) _showProgramSetupModal(); }
      else if (action === 'mesogen') {
        if (hasMeso && _abandonMesocycle) _abandonMesocycle();
        if (_showMesocycleGenerator) _showMesocycleGenerator();
      }
      else if (action === 'disable-plan') {
        if (hasMeso && _abandonMesocycle) _abandonMesocycle();
        store.programConfig.activeProgram = null;
        store.saveProgramConfig();
        if (_renderProgramSection) _renderProgramSection();
        if (_updateWorkoutButton) _updateWorkoutButton();
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
  if (store.workoutSession && !store.workoutSession.completed && store.workoutSession.mainLift === lift) {
    if (_openWorkoutView) _openWorkoutView(lift);
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
          <div class="choice-card-title">${tmpl.name} \u2014 Week ${store.programConfig.currentWeek}${liftDone ? ' (Done)' : ''}</div>
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

  // Smart Workout
  html += `<div class="choice-card" data-action="smart">
    <div class="choice-card-icon gold">&#129504;</div>
    <div class="choice-card-text">
      <div class="choice-card-title">Smart Workout</div>
      <div class="choice-card-desc">Auto-suggested based on fatigue, history & progression</div>
    </div>
    <div class="choice-card-arrow">&#8250;</div>
  </div>`;

  // Build Custom
  html += `<div class="choice-card" data-action="custom">
    <div class="choice-card-icon purple">&#9998;</div>
    <div class="choice-card-text">
      <div class="choice-card-title">Build Custom</div>
      <div class="choice-card-desc">Full workout builder with exercise browser</div>
    </div>
    <div class="choice-card-arrow">&#8250;</div>
  </div>`;

  // Saved Templates
  if (store.customTemplates.length > 0) {
    const liftTemplates = store.customTemplates.filter(t => t.mainLift === store.currentLift);
    if (liftTemplates.length > 0) {
      html += `<div class="choice-card" data-action="templates">
        <div class="choice-card-icon blue">&#128196;</div>
        <div class="choice-card-text">
          <div class="choice-card-title">Saved Templates (${liftTemplates.length})</div>
          <div class="choice-card-desc">Load a saved workout template</div>
        </div>
        <div class="choice-card-arrow">&#8250;</div>
      </div>`;
    }
  }

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
  body.querySelectorAll('.choice-card').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      closeChoiceSheet();
      if (action === 'quick') {
        if (!store.workoutConfig.weakPoints[store.currentLift]) {
          if (_showWeakPointSetupModal) _showWeakPointSetupModal(store.currentLift);
          return;
        }
        if (_openWorkoutView) _openWorkoutView(store.currentLift);
      }
      else if (action === 'smart') { if (_openSmartRecommendation) _openSmartRecommendation(); }
      else if (action === 'custom') { if (_openBuilder) _openBuilder(store.currentLift); }
      else if (action === 'templates') { if (_showTemplateList) _showTemplateList(); }
      else if (action === 'mesocycle') { if (_openMesocycleWorkout) _openMesocycleWorkout(store.currentLift); }
      else if (action === 'mesogen') { if (_showMesocycleGenerator) _showMesocycleGenerator(); }
      else if (action === 'setup-program') { if (_showProgramSetupModal) _showProgramSetupModal(); }
    });
  });

  // Plan link handlers
  body.querySelectorAll('.choice-plan-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = link.dataset.action;
      if (action === 'abandon-meso') { closeChoiceSheet(); if (_abandonMesocycle) _abandonMesocycle(); }
      else if (action === 'switch-plan') { closeChoiceSheet(); showPlanSwitcher(); }
    });
  });

  // Week card clicks for mesocycle detail
  body.querySelectorAll('.meso-week-card').forEach(card => {
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
        if (current) current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }, 50);
  }
}
