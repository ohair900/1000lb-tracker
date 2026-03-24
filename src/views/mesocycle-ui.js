/**
 * Mesocycle UI — generator modal, workout opening, week detail views,
 * timeline rendering, and abandon flow.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES, COLORS } from '../constants/lift-config.js';
import { MESO_GOALS } from '../data/meso-goals.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { formatWeight } from '../formulas/units.js';
import {
  generateMesocycle,
  recordMesocyclePerformance,
  adaptRemainingWeeks,
} from '../systems/mesocycle.js';
import {
  computeSetWeights,
  getAccessoryWeight,
  checkAccessoryProgression,
} from '../systems/workout-builder.js';
import { openModal, closeModal } from '../ui/modal.js';
import { openFatigueSheet } from '../ui/sheet.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _renderWorkoutView = null;
let _updateWorkoutButton = null;

export function setMesocycleUIDeps(deps) {
  if (deps.renderWorkoutView) _renderWorkoutView = deps.renderWorkoutView;
  if (deps.updateWorkoutButton) _updateWorkoutButton = deps.updateWorkoutButton;
}

// ---------------------------------------------------------------------------
// Mesocycle generator modal
// ---------------------------------------------------------------------------

/**
 * Show the mesocycle generator modal with goal, model, and duration selection.
 */
export function showMesocycleGenerator() {
  const body = $('edit-body');
  let selectedGoal = 'strength', selectedModel = 'linear', selectedDuration = 6;
  let includeOptional = false;

  function renderGenUI() {
    const hasTMs = LIFTS.every(l => store.programConfig.trainingMaxes[l] || bestE1RM(l));
    let html = '<div class="section-label-lg">Goal</div>';
    html += '<div class="meso-pills">';
    ['hypertrophy', 'strength', 'peaking', 'deload'].forEach(g => {
      html += `<button class="meso-pill${selectedGoal === g ? ' active' : ''}" data-goal="${g}">${MESO_GOALS[g].label}</button>`;
    });
    html += '</div>';

    html += '<div class="section-label-lg">Model</div>';
    html += '<div class="meso-pills">';
    ['linear', 'dup', 'block'].forEach(m => {
      const labels = { linear: 'Linear', dup: 'DUP', block: 'Block' };
      html += `<button class="meso-pill${selectedModel === m ? ' active' : ''}" data-model="${m}">${labels[m]}</button>`;
    });
    html += '</div>';

    html += '<div class="section-label-lg">Duration</div>';
    html += '<div class="meso-pills">';
    [4, 6, 8].forEach(d => {
      html += `<button class="meso-pill${selectedDuration === d ? ' active' : ''}" data-duration="${d}">${d} weeks</button>`;
    });
    html += '</div>';

    html += '<div class="section-label-lg" style="margin-top:var(--space-3)">Training Maxes</div>';
    LIFTS.forEach(l => {
      const tm = store.programConfig.trainingMaxes[l];
      const best = bestE1RM(l);
      const val = tm || (best ? Math.round(best * 0.9) : 0);
      html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="color:${COLORS[l]};font-weight:700;font-size:var(--text-sm);width:60px">${LIFT_NAMES[l]}</span>
        <span style="font-size:var(--text-sm);color:var(--text)">${val ? formatWeight(val) + ' ' + store.unit : 'Not set'}</span>
        ${!val ? '<span style="font-size:0.6rem;color:var(--red)">Required</span>' : ''}
      </div>`;
    });
    if (!hasTMs) {
      html += `<div style="font-size:var(--text-xs);color:var(--red);margin-bottom:var(--space-3)">Set training maxes in Program Setup first</div>`;
    }

    html += `<label style="display:flex;align-items:center;gap:8px;font-size:0.8rem;color:var(--text);margin:var(--space-3) 0;cursor:pointer">
      <input type="checkbox" id="meso-optional-days" ${includeOptional ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--bench)">
      Add optional light days
    </label>`;

    html += `<button class="modal-save-btn" id="meso-generate-btn" ${!hasTMs ? 'disabled style="opacity:0.4"' : ''}>Generate Mesocycle</button>`;
    body.innerHTML = html;

    // Pill clicks
    body.querySelectorAll('[data-goal]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedGoal = btn.dataset.goal;
        if (selectedGoal === 'deload') selectedDuration = 1;
        else if (selectedDuration === 1) selectedDuration = MESO_GOALS[selectedGoal].defaultWeeks;
        renderGenUI();
      });
    });
    body.querySelectorAll('[data-model]').forEach(btn => {
      btn.addEventListener('click', () => { selectedModel = btn.dataset.model; renderGenUI(); });
    });
    body.querySelectorAll('[data-duration]').forEach(btn => {
      btn.addEventListener('click', () => { selectedDuration = parseInt(btn.dataset.duration); renderGenUI(); });
    });
    const optToggle = $('meso-optional-days');
    if (optToggle) optToggle.addEventListener('change', () => { includeOptional = optToggle.checked; });

    // Generate button
    const genBtn = $('meso-generate-btn');
    if (genBtn) {
      genBtn.addEventListener('click', () => {
        const meso = generateMesocycle(selectedGoal, selectedModel, selectedDuration, includeOptional);
        if (!meso) { showToast('Set training maxes first'); return; }
        store.activeMesocycle = meso;
        store.saveMesocycle();
        closeModal('edit-modal');
        showToast('Mesocycle generated: ' + meso.name);
        if (_updateWorkoutButton) _updateWorkoutButton();
      });
    }
  }

  $('edit-modal').querySelector('h3').textContent = 'Generate Mesocycle';
  renderGenUI();
  openModal('edit-modal');
}

// ---------------------------------------------------------------------------
// Open mesocycle workout
// ---------------------------------------------------------------------------

/**
 * Start a mesocycle workout session for a specific lift.
 * @param {string} lift
 */
export function openMesocycleWorkout(lift) {
  if (!store.activeMesocycle || store.activeMesocycle.status !== 'active') { showToast('No active mesocycle'); return; }
  const weekIdx = store.activeMesocycle.currentWeek - 1;
  const week = store.activeMesocycle.weeks[weekIdx];
  if (!week) return;
  const liftWorkout = week.workouts[lift];
  if (!liftWorkout) return;

  if (week.performance[lift]) {
    showToast(`${LIFT_NAMES[lift]} already done this week`);
    return;
  }

  const now = new Date();
  const session = {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    mainLift: lift,
    programWeek: store.activeMesocycle.currentWeek,
    date: now.toISOString().split('T')[0],
    startTime: now.getTime(),
    mainSets: liftWorkout.mainSets.map((s, i) => ({
      num: i + 1, weight: s.weight, reps: s.reps, pct: s.pct, completed: false
    })),
    accessories: liftWorkout.accessories.map(a => {
      const dbEx = ACCESSORY_DB[a.exerciseId];
      return {
        exerciseId: a.exerciseId, name: a.name,
        setWeights: computeSetWeights(dbEx ? getAccessoryWeight(a.exerciseId, lift) : 0, a.sets),
        targetSets: a.sets, repRange: [...a.repRange], equipment: a.equipment,
        setsCompleted: [], progressed: dbEx ? checkAccessoryProgression(a.exerciseId, lift) : false
      };
    }),
    completed: false,
    source: 'mesocycle',
    mesocycleId: store.activeMesocycle.id,
    mesocycleWeek: store.activeMesocycle.currentWeek
  };
  store.workoutSession = session;
  store.saveWorkoutSession();
  $('workout-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  if (_renderWorkoutView) _renderWorkoutView();
}

// ---------------------------------------------------------------------------
// Abandon mesocycle
// ---------------------------------------------------------------------------

/**
 * Abandon the currently active mesocycle after user confirmation.
 */
export function abandonMesocycle() {
  if (!store.activeMesocycle) return;
  if (!confirm('Abandon current mesocycle? This cannot be undone.')) return;
  store.activeMesocycle.status = 'abandoned';
  store.mesocycleHistory.push({ ...store.activeMesocycle });
  store.saveMesocycleHistory();
  store.activeMesocycle = null;
  store.saveMesocycle();
  showToast('Mesocycle abandoned');
  if (_updateWorkoutButton) _updateWorkoutButton();
}

// ---------------------------------------------------------------------------
// Meso week detail (shown in fatigue sheet)
// ---------------------------------------------------------------------------

/**
 * Show the detail view for a specific mesocycle week.
 * @param {number} weekIdx - 0-based week index
 */
export function showMesoWeekDetail(weekIdx) {
  if (!store.activeMesocycle) return;
  const week = store.activeMesocycle.weeks[weekIdx];
  if (!week) return;

  const body = $('fatigue-sheet-body');
  $('fatigue-sheet-title').textContent = `${store.activeMesocycle.name} - ${week.label}`;
  let html = `<div class="fatigue-detail-banner ${week.phase === 'Deload' ? 'green' : 'blue'}" style="background:rgba(30,136,229,0.12);color:var(--bench)">
    <span>${week.phase}</span><span style="margin-left:auto">RPE ${week.targetRPE}</span>
  </div>`;

  LIFTS.forEach(l => {
    const w = week.workouts[l];
    if (!w) return;
    const perf = week.performance[l];
    html += `<div class="meso-detail-section">
      <div style="font-weight:700;color:${COLORS[l]};font-size:var(--text-sm);margin-bottom:4px">${LIFT_NAMES[l]}${perf ? ' &#10003;' : ''}</div>`;
    w.mainSets.forEach((s, i) => {
      html += `<div class="meso-detail-set">Set ${i + 1}: ${formatWeight(s.weight)} ${store.unit} x ${s.reps} (${s.pct}%)</div>`;
    });
    if (w.accessories.length > 0) {
      html += `<div class="meso-detail-acc">Accessories: ${w.accessories.map(a => a.name).join(', ')}</div>`;
    }
    if (perf) {
      html += `<div class="meso-detail-perf">RPE ${perf.actualRPE} &bull; ${perf.completedSets} sets &bull; ${perf.totalReps} reps</div>`;
    }
    html += '</div>';
  });

  // Adaptation log for this week
  const adaptations = store.activeMesocycle.adaptationLog.filter(a => a.weekNum === week.weekNum);
  if (adaptations.length > 0) {
    html += '<div class="section-label-lg" style="margin:8px 0 4px">Adaptations</div>';
    adaptations.forEach(a => {
      html += `<div style="font-size:var(--text-xs);color:var(--gold);padding:2px 0">${LIFT_NAMES[a.lift]}: ${a.adjustment} - ${a.reason}</div>`;
    });
  }

  $('fatigue-sheet-body').innerHTML = html;
  openFatigueSheet();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Wire up meso-week-click custom event listener.
 * Call once after DOMContentLoaded.
 */
export function initMesocycleUI() {
  document.addEventListener('meso-week-click', (e) => {
    showMesoWeekDetail(e.detail);
  });
}
