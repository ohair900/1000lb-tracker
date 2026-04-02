/**
 * Plateau analysis view — renders plateau diagnosis cards on the dashboard,
 * inline analysis in the lift-detail sheet, and a standalone bottom sheet.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { formatWeight } from '../formulas/units.js';
import { detectPlateau } from '../formulas/progression.js';
import { diagnosePlateau, generatePlateauMiniCycle, INTERVENTION_TYPES } from '../systems/plateau-breaker.js';
import { openSheet, closeSheet, enableSheetSwipeDismiss } from '../ui/sheet.js';

// ---------------------------------------------------------------------------
// DI deps
// ---------------------------------------------------------------------------

let _deps = {};

export function setPlateauDeps(deps) {
  _deps = deps;
}

// ---------------------------------------------------------------------------
// Cache (re-diagnose at most once per render cycle)
// ---------------------------------------------------------------------------

const _cache = {};

function getDiagnosis(lift) {
  const now = Date.now();
  if (_cache[lift] && (now - _cache[lift].ts) < 5000) return _cache[lift].data;
  const d = diagnosePlateau(lift);
  _cache[lift] = { data: d, ts: now };
  return d;
}

// ---------------------------------------------------------------------------
// Dashboard: compact plateau cards
// ---------------------------------------------------------------------------

/**
 * Render a compact tappable card for the dashboard. Returns '' if not plateaued.
 */
export function renderPlateauCard(lift) {
  const d = getDiagnosis(lift);
  if (!d) return '';

  const type = INTERVENTION_TYPES[d.primaryCause] || INTERVENTION_TYPES.intensity_stale;
  return `<div class="pb-card" data-lift="${lift}">` +
    `<span class="pb-card-icon">${type.icon}</span>` +
    `<div class="pb-card-body">` +
      `<div class="pb-card-lift ${lift}">${LIFT_NAMES[lift]} Plateaued</div>` +
      `<div class="pb-card-summary">${type.label}</div>` +
    `</div>` +
    `<span class="pb-card-arrow">\u203A</span>` +
  `</div>`;
}

/**
 * Update all plateau cards in the dashboard container.
 */
export function updatePlateauCards() {
  const el = $('plateau-cards');
  if (!el) return;
  let html = '';
  LIFTS.forEach(lift => { html += renderPlateauCard(lift); });
  if (html) {
    el.innerHTML = `<div class="pb-cards">${html}</div>`;
    el.style.display = '';
    el.querySelectorAll('.pb-card[data-lift]').forEach(card => {
      card.addEventListener('click', () => showPlateauSheet(card.dataset.lift));
    });
  } else {
    el.innerHTML = '';
    el.style.display = 'none';
  }
}

// ---------------------------------------------------------------------------
// Lift-detail: inline plateau section
// ---------------------------------------------------------------------------

/**
 * Render the full plateau analysis section for the lift-detail sheet.
 * Returns '' if not plateaued.
 */
export function renderPlateauSection(lift) {
  const d = getDiagnosis(lift);
  if (!d) return '';
  return renderDiagnosisBlock(d, false);
}

// ---------------------------------------------------------------------------
// Bottom sheet
// ---------------------------------------------------------------------------

export function showPlateauSheet(lift) {
  const d = getDiagnosis(lift);
  if (!d) return;

  $('plateau-sheet-title').textContent = `${LIFT_NAMES[lift]} Plateau Analysis`;
  $('plateau-sheet-body').innerHTML = renderDiagnosisBlock(d, true);

  openSheet('plateau-sheet', 'plateau-sheet-backdrop');

  // Wire buttons inside the sheet
  wireButtons('plateau-sheet-body', lift, d);
}

export function closePlateauSheet() {
  closeSheet('plateau-sheet', 'plateau-sheet-backdrop');
}

export function initPlateauSheet() {
  const closeBtn = $('plateau-sheet-close');
  const backdrop = $('plateau-sheet-backdrop');
  if (closeBtn) closeBtn.addEventListener('click', closePlateauSheet);
  if (backdrop) backdrop.addEventListener('click', closePlateauSheet);
  enableSheetSwipeDismiss('plateau-sheet', 'plateau-sheet-backdrop', closePlateauSheet);
}

// ---------------------------------------------------------------------------
// Shared rendering helpers
// ---------------------------------------------------------------------------

function renderDiagnosisBlock(d, showExtras) {
  const primary = d.causes[0];
  const type = INTERVENTION_TYPES[primary.id] || INTERVENTION_TYPES.intensity_stale;

  let html = `<div class="pb-diagnosis">`;

  // Header
  html += `<div class="pb-diagnosis-header">` +
    `<span class="pb-diagnosis-icon">${type.icon}</span>` +
    `<span class="pb-diagnosis-label">${type.label}</span>` +
  `</div>`;

  // Confidence bar
  html += `<div class="pb-confidence">` +
    `<div class="pb-confidence-label">Confidence: ${Math.round(d.confidence * 100)}%</div>` +
    `<div class="pb-confidence-track">` +
      `<div class="pb-confidence-fill" style="width:${Math.round(d.confidence * 100)}%"></div>` +
    `</div>` +
  `</div>`;

  // Evidence
  if (primary.evidence.length > 0) {
    html += `<div class="pb-evidence">`;
    primary.evidence.forEach(e => {
      html += `<div class="pb-evidence-item">${escapeHtml(e)}</div>`;
    });
    html += `</div>`;
  }

  // Actions
  if (primary.actions.length > 0) {
    html += `<div class="pb-actions-title">What to do</div>`;
    primary.actions.forEach((a, i) => {
      html += `<div class="pb-action-item" data-num="${i + 1}.">${escapeHtml(a)}</div>`;
    });
  }

  // Generate button
  html += `<button class="pb-generate-btn" data-action="generate">Generate Plateau-Breaker Plan</button>`;

  html += `</div>`;

  // Extended sheet content: intensity distribution + secondary causes
  if (showExtras) {
    html += renderIntensityChart(d.analysisData);
    html += renderSecondaryCauses(d.causes);
  }

  return html;
}

function renderIntensityChart(data) {
  if (!data.intensityBins) return '';
  const bins = data.intensityBins;
  const max = Math.max(1, ...Object.values(bins));

  let html = `<div class="ld-section-title">Intensity Distribution (8 wks)</div>`;
  html += `<div class="pb-intensity-chart">`;
  Object.entries(bins).forEach(([range, count]) => {
    const pct = (count / max) * 100;
    html += `<div class="pb-intensity-bar">` +
      `<div class="pb-intensity-bar-fill" style="height:${Math.max(4, pct)}%"></div>` +
    `</div>`;
  });
  html += `</div>`;
  html += `<div class="pb-intensity-labels">`;
  Object.keys(bins).forEach(range => {
    html += `<span>${range}%</span>`;
  });
  html += `</div>`;
  return html;
}

function renderSecondaryCauses(causes) {
  if (causes.length <= 1) return '';
  let html = `<div class="pb-secondary">`;
  html += `<div class="pb-secondary-title">Other Contributing Factors</div>`;
  causes.slice(1).forEach(c => {
    const type = INTERVENTION_TYPES[c.id];
    const icon = type ? type.icon : '';
    html += `<div class="pb-secondary-item">` +
      `<span class="pb-secondary-score">${c.score}</span>` +
      `<span>${icon} ${escapeHtml(c.label)}</span>` +
    `</div>`;
  });
  html += `</div>`;
  return html;
}

// ---------------------------------------------------------------------------
// Mini-cycle rendering
// ---------------------------------------------------------------------------

function renderMiniCyclePreview(cycle) {
  let html = `<div class="pb-mini-cycle">`;
  html += `<div class="pb-mini-cycle-title">Plateau Breaker: ${cycle.durationWeeks}-Week Plan</div>`;
  html += `<div class="pb-mini-cycle-summary">${escapeHtml(cycle.summary)}</div>`;

  cycle.weeks.forEach(week => {
    const setsStr = week.mainSets
      .map(s => `${s.reps}@${formatWeight(s.weight)}`)
      .join(', ');
    html += `<div class="pb-week">`;
    html += `<div class="pb-week-header">` +
      `<span class="pb-week-num">Week ${week.weekNum}</span>` +
      `<span class="pb-week-phase">${escapeHtml(week.phase)}</span>` +
    `</div>`;
    html += `<div class="pb-week-sets">${setsStr}</div>`;
    html += `<div class="pb-week-rpe">Target RPE ${week.targetRPE}</div>`;
    if (week.accessories.length > 0) {
      html += `<div class="pb-week-accessories">+ ${week.accessories.map(a => a.name).join(', ')}</div>`;
    }
    if (week.notes) {
      html += `<div class="pb-week-notes">${escapeHtml(week.notes)}</div>`;
    }
    html += `</div>`;
  });

  html += `<button class="pb-activate-btn" data-action="activate">Activate This Plan</button>`;
  html += `</div>`;
  return html;
}

// ---------------------------------------------------------------------------
// Button wiring (generate + activate)
// ---------------------------------------------------------------------------

function wireButtons(containerId, lift, diagnosis) {
  const container = $(containerId);
  if (!container) return;

  container.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    if (btn.dataset.action === 'generate') {
      const cycle = generatePlateauMiniCycle(lift, diagnosis);
      if (!cycle) return;

      // Replace the diagnosis block with the mini-cycle preview
      const diagnosisEl = container.querySelector('.pb-diagnosis');
      if (diagnosisEl) {
        diagnosisEl.innerHTML = renderMiniCyclePreview(cycle);
        // Store cycle reference on the container for activation
        container._pendingCycle = cycle;
      }
    }

    if (btn.dataset.action === 'activate') {
      const cycle = container._pendingCycle;
      if (!cycle) return;
      activateMiniCycle(lift, cycle);
      closePlateauSheet();
      if (_deps.updateDashboard) _deps.updateDashboard();
    }
  });
}

/**
 * Wire buttons in the lift-detail context (different container).
 */
export function wireLiftDetailButtons(containerId, lift, diagnosis) {
  wireButtons(containerId, lift, diagnosis);
}

// ---------------------------------------------------------------------------
// Activate a mini-cycle as the active mesocycle
// ---------------------------------------------------------------------------

function activateMiniCycle(lift, cycle) {
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Convert to mesocycle format
  const mesocycle = {
    id: 'pb-' + now,
    name: `Plateau Breaker: ${LIFT_NAMES[lift]}`,
    goal: 'strength',
    model: 'linear',
    durationWeeks: cycle.durationWeeks,
    startDate: today,
    createdAt: now,
    baseTMs: {
      squat: store.programConfig.trainingMaxes.squat || 0,
      bench: store.programConfig.trainingMaxes.bench || 0,
      deadlift: store.programConfig.trainingMaxes.deadlift || 0,
    },
    currentWeek: 1,
    weeks: cycle.weeks.map(w => ({
      weekNum: w.weekNum,
      phase: w.phase,
      workouts: {
        [lift]: {
          targetRPE: w.targetRPE,
          sets: w.mainSets.map(s => ({
            reps: s.reps,
            pct: s.pct,
            weight: s.weight,
          })),
          accessories: w.accessories,
        },
      },
      notes: w.notes,
    })),
    adaptationLog: [],
    status: 'active',
    source: 'plateau-breaker',
    intervention: cycle.intervention,
  };

  // Save as active mesocycle
  if (store.activeMesocycle) {
    store.activeMesocycle.status = 'completed';
    store.mesocycleHistory.push(store.activeMesocycle);
    store.save('mesocycleHistory');
  }
  store.activeMesocycle = mesocycle;
  store.save('activeMesocycle');
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
