/**
 * Plateau analysis view — renders plateau diagnosis cards on the dashboard,
 * inline analysis in the lift-detail sheet, and a standalone bottom sheet.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { formatWeight } from '../formulas/units.js';
import {
  diagnosePlateau,
  generatePlateauMiniCycle,
  INTERVENTION_TYPES,
} from '../systems/plateau-breaker.js';
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
  if (_cache[lift] && now - _cache[lift].ts < 5000) return _cache[lift].data;
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
  return (
    `<div class="pb-card" data-lift="${lift}">` +
    `<span class="pb-card-icon">${type.icon}</span>` +
    `<div class="pb-card-body">` +
    `<div class="pb-card-lift ${lift}">${LIFT_NAMES[lift]} Plateaued</div>` +
    `<div class="pb-card-summary">${type.label}</div>` +
    `</div>` +
    `<span class="pb-card-arrow">\u203A</span>` +
    `</div>`
  );
}

/**
 * Update all plateau cards in the dashboard container.
 */
export function updatePlateauCards() {
  const el = $('plateau-cards');
  if (!el) return;
  let html = '';
  LIFTS.forEach((lift) => {
    html += renderPlateauCard(lift);
  });
  if (html) {
    el.innerHTML = `<div class="pb-cards">${html}</div>`;
    el.style.display = '';
    el.querySelectorAll('.pb-card[data-lift]').forEach((card) => {
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
  let html = '';
  let sectionIdx = 0;
  html += `<div class="sheet-section" style="--i:${sectionIdx++}">${renderDiagnosisBlock(d, false)}</div>`;
  if (d.analysisData) {
    html += `<div class="sheet-section" style="--i:${sectionIdx++}">${renderIntensityChart(d.analysisData)}</div>`;
  }
  if (d.causes.length > 1) {
    html += `<div class="sheet-section" style="--i:${sectionIdx++}">${renderSecondaryCauses(d.causes)}</div>`;
  }
  $('plateau-sheet-body').innerHTML = html;

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
  html +=
    `<div class="pb-diagnosis-header">` +
    `<span class="pb-diagnosis-icon">${type.icon}</span>` +
    `<span class="pb-diagnosis-label">${type.label}</span>` +
    `</div>`;

  // Confidence bar
  html +=
    `<div class="pb-confidence">` +
    `<div class="pb-confidence-label">Confidence: ${Math.round(d.confidence * 100)}%</div>` +
    `<div class="pb-confidence-track">` +
    `<div class="pb-confidence-fill" style="width:${Math.round(d.confidence * 100)}%"></div>` +
    `</div>` +
    `</div>`;

  // Evidence
  if (primary.evidence.length > 0) {
    html += `<div class="pb-evidence">`;
    primary.evidence.forEach((e) => {
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

  let html = `<div class="sheet-section-title">Intensity Distribution (8 wks)</div>`;
  html += `<div class="pb-intensity-chart">`;
  Object.entries(bins).forEach(([_range, count]) => {
    const pct = (count / max) * 100;
    html +=
      `<div class="pb-intensity-bar">` +
      `<div class="pb-intensity-bar-fill" style="height:${Math.max(4, pct)}%"></div>` +
      `</div>`;
  });
  html += `</div>`;
  html += `<div class="pb-intensity-labels">`;
  Object.keys(bins).forEach((range) => {
    html += `<span>${range}%</span>`;
  });
  html += `</div>`;
  return html;
}

function renderSecondaryCauses(causes) {
  if (causes.length <= 1) return '';
  let html = `<div class="pb-secondary">`;
  html += `<div class="pb-secondary-title">Other Contributing Factors</div>`;
  causes.slice(1).forEach((c) => {
    const type = INTERVENTION_TYPES[c.id];
    const icon = type ? type.icon : '';
    html +=
      `<div class="pb-secondary-item">` +
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

  // Cycle-level injury notice — mild/moderate tempering on the plateaued
  // lift, or the severe-injury rest message for alternative-focus blocks.
  if (cycle.injuryNotice) {
    html += `<div class="pb-injury-notice" style="font-size:var(--text-xs);color:var(--orange);margin:6px 0 8px;line-height:1.4">${escapeHtml(cycle.injuryNotice)}</div>`;
  }

  // Alternative-focus messaging: the injured lift is rested, the other two
  // lifts are trained instead.
  if (cycle.alternativeFocus) {
    const rested = LIFT_NAMES[cycle.restedLift] || cycle.restedLift;
    html += `<div class="pb-alt-focus-banner" style="font-size:var(--text-sm);font-weight:700;color:var(--danger, #e53935);margin:8px 0;padding:8px 10px;border:1px solid var(--danger, #e53935);border-radius:var(--radius-md);line-height:1.4">Resting ${escapeHtml(rested)} &mdash; training the other two lifts while it heals</div>`;
  }

  cycle.weeks.forEach((week) => {
    html += `<div class="pb-week">`;
    html +=
      `<div class="pb-week-header">` +
      `<span class="pb-week-num">Week ${week.weekNum}</span>` +
      `<span class="pb-week-phase">${escapeHtml(week.phase)}</span>` +
      `</div>`;

    if (week.injuryNotice) {
      html += `<div class="pb-injury-notice" style="font-size:var(--text-xs);color:var(--orange);margin:6px 0;line-height:1.4">${escapeHtml(week.injuryNotice)}</div>`;
    }

    if (week.alternativeFocus) {
      html += renderFocusWorkouts(week);
    } else {
      const setsStr = (week.mainSets || [])
        .map((s) => `${s.reps}@${formatWeight(s.weight)}`)
        .join(', ');
      if (setsStr) html += `<div class="pb-week-sets">${setsStr}</div>`;
      html += `<div class="pb-week-rpe">Target RPE ${week.targetRPE}</div>`;
      if (week.accessories && week.accessories.length > 0) {
        html += `<div class="pb-week-accessories">+ ${week.accessories.map((a) => escapeHtml(a.name)).join(', ')}</div>`;
      }
      // The other two lifts, programmed at maintenance (or rested).
      html += renderMaintenanceBlocks(week.maintenance);
    }

    // Injury substitution badges for the week's accessories.
    html += renderInjurySubBadges(week.injurySubstitutions);

    if (week.notes) {
      html += `<div class="pb-week-notes">${escapeHtml(week.notes)}</div>`;
    }
    html += `</div>`;
  });

  if (cycle.alternativeFocus) {
    // No single-lift activation path exists for rest blocks (see
    // generateAlternativeFocusCycle) — resume the lift when cleared, then
    // generate a fresh plan.
    const rested = LIFT_NAMES[cycle.restedLift] || cycle.restedLift;
    html += `<div class="pb-week-notes">No activation for rest blocks &mdash; resume ${escapeHtml(rested)} only when cleared, then generate a new plan.</div>`;
  } else {
    html += `<button class="pb-activate-btn" data-action="activate">Activate This Plan</button>`;
  }
  html += `</div>`;
  return html;
}

/**
 * Render the `focusWorkouts` map of an alternative-focus week: each trained
 * lift gets its own main-sets + accessories block.
 */
function renderFocusWorkouts(week) {
  const lifts = Object.keys(week.focusWorkouts || {});
  if (lifts.length === 0) {
    return `<div class="pb-week-notes">No trainable lifts this week &mdash; every other pattern also conflicts with a severe injury. Rest.</div>`;
  }
  let html = '';
  lifts.forEach((l) => {
    const fw = week.focusWorkouts[l];
    const setsStr = (fw.mainSets || [])
      .map((s) => `${s.reps}@${formatWeight(s.weight)}`)
      .join(', ');
    html += `<div class="pb-focus-lift">`;
    html += `<div class="pb-focus-lift-name" style="font-size:var(--text-xs);font-weight:700;color:var(--text-strong);text-transform:uppercase;letter-spacing:0.04em;margin-top:6px">${escapeHtml(LIFT_NAMES[l] || l)}</div>`;
    if (setsStr) html += `<div class="pb-week-sets">${setsStr}</div>`;
    if (fw.accessories && fw.accessories.length > 0) {
      html += `<div class="pb-week-accessories">+ ${fw.accessories.map((a) => escapeHtml(a.name)).join(', ')}</div>`;
    }
    html += `</div>`;
  });
  return html;
}

/**
 * Render `week.maintenance` — the two non-focus lifts programmed at
 * maintenance (2x5 @ 70%), or marked rested when a severe injury applies.
 */
function renderMaintenanceBlocks(maintenance) {
  if (!maintenance) return '';
  const lifts = Object.keys(maintenance);
  if (lifts.length === 0) return '';
  let html = `<div class="pb-maintenance">`;
  html += `<div class="pb-maintenance-title" style="font-size:var(--text-xs);font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-dim);margin:8px 0 4px">Maintenance &mdash; other lifts</div>`;
  lifts.forEach((l) => {
    const m = maintenance[l];
    const name = LIFT_NAMES[l] || l;
    if (m.rested) {
      html += `<div class="pb-maintenance-row" style="font-size:var(--text-xs);color:var(--text-dim);margin-top:4px"><span class="pb-maintenance-name" style="font-weight:700;color:var(--text)">${escapeHtml(name)}</span> <span class="pb-maintenance-rested" style="color:var(--danger, #e53935)">Rested &mdash; severe injury</span></div>`;
    } else {
      const setsStr = (m.mainSets || [])
        .map((s) => `${s.reps}@${formatWeight(s.weight)}`)
        .join(', ');
      html += `<div class="pb-maintenance-row" style="font-size:var(--text-xs);color:var(--text-dim);margin-top:4px"><span class="pb-maintenance-name" style="font-weight:700;color:var(--text)">${escapeHtml(name)}</span> <span class="pb-maintenance-sets">${setsStr}</span></div>`;
    }
    if (m.injuryNotice) {
      html += `<div class="pb-injury-notice" style="font-size:var(--text-xs);color:var(--orange);margin:4px 0;line-height:1.4">${escapeHtml(m.injuryNotice)}</div>`;
    }
  });
  html += `</div>`;
  return html;
}

/**
 * Render `week.injurySubstitutions` records as severity-styled badges.
 * Records follow the injury.js substitution shape ({ originalId,
 * exerciseId, substituted, reason, injuryRegion, injurySeverity, dropped,
 * name }).
 */
function renderInjurySubBadges(substitutions) {
  const subs = (substitutions || []).filter((s) => s.substituted || s.dropped || s.reason);
  if (subs.length === 0) return '';
  let html = `<div class="pb-substitutions">`;
  subs.forEach((s) => {
    const sev = s.injurySeverity || 'mild';
    const sevColor =
      sev === 'severe'
        ? 'var(--danger, #e53935)'
        : sev === 'moderate'
          ? 'var(--orange)'
          : 'var(--yellow)';
    const style = `display:block;margin-top:6px;font-size:var(--text-xs);line-height:1.4;padding:5px 8px;border:1px solid ${sevColor};border-radius:var(--radius-sm);color:${sevColor}`;
    if (s.dropped) {
      html += `<div class="pb-sub-badge" data-severity="severe" style="${style}">&#9888; Dropped ${escapeHtml(s.name || s.originalId || '')} &mdash; rest this pattern while your ${escapeHtml(s.injuryRegion || 'injury')} injury is severe</div>`;
    } else if (s.substituted) {
      html += `<div class="pb-sub-badge" data-severity="${sev}" title="${escapeHtml(s.reason || '')}" style="${style}">&#8646; ${escapeHtml(s.name || s.originalId || '')} swapped &mdash; ${escapeHtml(s.injuryRegion || '')} injury</div>`;
    } else {
      html += `<div class="pb-sub-badge" data-severity="${sev}" style="${style}">&#9888; ${escapeHtml(s.reason || 'Conflicts with an active injury')}</div>`;
    }
  });
  html += `</div>`;
  return html;
}

// ---------------------------------------------------------------------------
// Button wiring (generate + activate)
// ---------------------------------------------------------------------------

function wireButtons(containerId, lift, diagnosis) {
  const container = $(containerId);
  if (!container) return;

  container.addEventListener('click', (e) => {
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
  // Alternative-focus (rest) blocks have no single-lift activation path —
  // their weeks carry focusWorkouts instead of mainSets. The preview hides
  // the Activate button for these; this guard is belt-and-braces.
  if (!cycle || cycle.alternativeFocus) return;
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
    weeks: cycle.weeks.map((w) => ({
      weekNum: w.weekNum,
      label: `Week ${w.weekNum}`,
      phase: w.phase,
      targetRPE: w.targetRPE,
      workouts: {
        [lift]: {
          mainSets: w.mainSets.map((s) => ({
            reps: s.reps,
            pct: s.pct,
            weight: s.weight,
            completed: false,
          })),
          accessories: w.accessories,
        },
      },
      completed: {},
      performance: {},
      adapted: false,
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
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
