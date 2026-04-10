/**
 * Guided workout builder overlay — pre-filled exercise slots with
 * smart recommendations, gap analysis panel, swap sheet, guardrails,
 * template save/load, and session creation.
 */

import store from '../state/store.js';
import { $, escapeHTML } from '../utils/helpers.js';
import { LIFT_NAMES, LIFTS } from '../constants/lift-config.js';
import { EXERCISE_CATALOG, MOVEMENT_PATTERNS, PROGRESSION_MODELS } from '../data/exercise-catalog.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { resolveExercise, resolveCanonicalId } from '../data/exercise-compat.js';
import {
  computeSetWeights,
  getAccessoryWeight,
  checkAccessoryProgression,
  selectSmartAccessories,
  scoreAccessories,
} from '../systems/workout-builder.js';
import { getProgramWorkout, findFirstIncompleteWeek, getLiftWeek } from '../systems/programs.js';
import {
  analyzeWeeklyVolume,
  analyzePushPullRatio,
  getGapReport,
  estimateWorkoutDuration,
} from '../systems/gap-analysis.js';
import { checkGuardrails } from '../systems/workout-guardrails.js';
import { showToast } from '../ui/toast.js';
import { displayWeight, formatWeight } from '../formulas/units.js';
import { formatPlates } from '../formulas/plates.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _builderMainLift = null;
let _gapPanelOpen = false;
let _builderDirty = false;

/** Mark builder as dirty and persist draft for crash recovery (#8, #9). */
function _markDirty() {
  _builderDirty = true;
  try {
    localStorage.setItem('sbd-builder-draft', JSON.stringify({
      mainLift: _builderMainLift,
      exercises: store.builderExercises,
      timestamp: Date.now(),
    }));
  } catch { /* quota exceeded — ignore */ }
}

/**
 * Format weight for display, handling bodyweight exercises.
 * Negative = assisted, 0 = BW, positive = weighted or normal weight.
 */
function formatBWWeight(weight, catalogEx) {
  const isBW = catalogEx && catalogEx.progressionType === 'bodyweight';
  if (isBW) {
    if (weight < 0) return `Assisted ${displayWeight(Math.abs(weight))}`;
    if (weight === 0) return 'BW';
    return `BW +${displayWeight(weight)}`;
  }
  if (weight > 0) return displayWeight(weight);
  return '—';
}

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

/**
 * Open the builder overlay, optionally preloaded with exercises.
 * If no preloadExercises, pre-fills with smart recommendations.
 * @param {string} mainLift
 * @param {Object[]} [preloadExercises]
 */
export function openBuilder(mainLift, preloadExercises) {
  _builderMainLift = mainLift;
  _gapPanelOpen = false;
  _builderDirty = false;

  // #9: Recover draft if no preload provided
  if (!preloadExercises) {
    try {
      const raw = localStorage.getItem('sbd-builder-draft');
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && draft.mainLift === mainLift && draft.exercises && draft.exercises.length > 0
            && (Date.now() - draft.timestamp) < 7200000) {
          if (confirm('Recover unsaved builder draft?')) {
            preloadExercises = draft.exercises;
          }
        }
        localStorage.removeItem('sbd-builder-draft');
      }
    } catch { /* corrupt draft — ignore */ }
  }

  if (preloadExercises && preloadExercises.length > 0) {
    store.builderExercises = preloadExercises;
    // Ensure main lift slot
    if (!store.builderExercises.some(e => e.type === 'main')) {
      store.builderExercises.unshift(buildMainLiftSlot(mainLift));
    }
  } else {
    // Pre-fill with smart recommendations
    store.builderExercises = buildDefaultSlots(mainLift);
  }

  $('builder-title').textContent = `Build ${LIFT_NAMES[mainLift]} Workout`;
  $('builder-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  renderBuilder(mainLift);
}

/**
 * Close the builder overlay.
 */
export function closeBuilder(force) {
  if (!force && _builderDirty && store.builderExercises.length > 0) {
    if (!confirm('Discard unsaved changes?')) return;
  }
  $('builder-overlay').style.display = 'none';
  document.body.style.overflow = '';
  store.builderExercises = [];
  _builderDirty = false;
  localStorage.removeItem('sbd-builder-draft');
  if ($('builder-save-template')) $('builder-save-template')._templateId = null;
  closeSwapSheet();
}

// ---------------------------------------------------------------------------
// Default slot building
// ---------------------------------------------------------------------------

function buildMainLiftSlot(mainLift) {
  const programWeek = findFirstIncompleteWeek(mainLift);
  const workout = getProgramWorkout(mainLift, programWeek);
  return {
    type: 'main', exerciseId: mainLift, name: LIFT_NAMES[mainLift],
    sets: workout ? workout.sets.length : 5,
    reps: workout ? (workout.sets[0]?.reps || 5) : 5,
    weightMode: 'program', weightValue: 0,
    equipment: 'barbell', repRange: [1, 5], order: 0,
    slotRole: 'main',
    programSets: workout ? workout.sets : null,
    programLabel: workout ? workout.label : null,
  };
}

function buildDefaultSlots(mainLift) {
  const slots = [buildMainLiftSlot(mainLift)];
  const smart = selectSmartAccessories(mainLift, 4);

  smart.forEach((ex, i) => {
    const catalogEx = EXERCISE_CATALOG[ex.id] || ex;
    const pType = catalogEx.progressionType || 'compound';
    let slotRole = 'accessory';
    if (i === 0 && pType === 'close-variation') slotRole = 'variation';
    else if (i === 0) slotRole = 'compound';
    else if (i === 1 && pType !== 'close-variation') slotRole = 'compound';

    const weight = getAccessoryWeight(ex.id, mainLift);
    slots.push({
      type: 'accessory',
      exerciseId: ex.id,
      canonicalId: ex.canonicalId || ex.id,
      name: ex.name,
      sets: ex.sets || 3,
      reps: Array.isArray(ex.repRange) ? ex.repRange[1] : (ex.reps || 10),
      weightMode: 'auto',
      weightValue: weight,
      equipment: ex.equipment,
      repRange: ex.repRange ? [...ex.repRange] : [8, 12],
      order: i + 1,
      slotRole,
      reasons: ex.reasons || [],
    });
  });

  return slots;
}

// ---------------------------------------------------------------------------
// Render builder body
// ---------------------------------------------------------------------------

/**
 * Render the full builder: summary bar, slot list, guardrails, gap panel, browser.
 */
export function renderBuilder(mainLift) {
  _builderMainLift = mainLift;
  const body = $('builder-body');

  // Summary bar
  const duration = estimateWorkoutDuration(store.builderExercises);
  $('builder-summary-bar').innerHTML =
    `<span class="duration-pill">~${duration}min</span>`;

  let html = '';

  // --- Exercise slot list ---
  store.builderExercises.forEach((ex, i) => {
    const isMain = ex.type === 'main';
    const role = ex.slotRole || (isMain ? 'main' : 'accessory');
    const roleLabel = role === 'main' ? 'main' : role;
    const catalogEx = resolveExercise(ex.exerciseId);

    // Weight display
    let weightDisplay = '';
    if (!isMain) {
      weightDisplay = `<span class="slot-weight">${formatBWWeight(ex.weightValue, catalogEx)}</span>`;
    }

    // Reason tag (first 3 times per exercise)
    let reasonHtml = '';
    if (!isMain && ex.reasons && ex.reasons.length > 0) {
      const canonId = resolveCanonicalId(ex.exerciseId);
      const count = store.reasonTagCounts[canonId] || 0;
      if (count < 3) {
        reasonHtml = `<div class="slot-reason">${escapeHTML(ex.reasons[0])}</div>`;
      }
    }

    // #20: Superset grouping — open group container if this starts a group
    const prevEx = i > 0 ? store.builderExercises[i - 1] : null;
    const nextEx = i < store.builderExercises.length - 1 ? store.builderExercises[i + 1] : null;
    const inGroup = ex.groupId && !isMain;
    const isGroupStart = inGroup && (!prevEx || prevEx.groupId !== ex.groupId);
    const isGroupEnd = inGroup && (!nextEx || nextEx.groupId !== ex.groupId);
    if (isGroupStart) {
      html += `<div class="superset-group"><div class="superset-label">Superset <button class="slot-btn" data-unlink-group="${ex.groupId}" style="font-size:10px;padding:1px 4px">Unlink</button></div>`;
    }

    html += `<div class="builder-exercise${isMain ? ` main-lift ${mainLift}` : ''}${inGroup ? ' in-superset' : ''}" data-slot="${i}">
      <div class="builder-exercise-info">
        <div class="builder-exercise-name">
          <span class="slot-role-tag">${roleLabel}</span>
          ${escapeHTML(ex.name)}${weightDisplay}
        </div>
        <div class="builder-exercise-meta">${ex.equipment} &bull; ${ex.sets}x${Array.isArray(ex.repRange) ? ex.repRange.join('-') : ex.reps}</div>
        ${reasonHtml}
      </div>
      <div class="builder-exercise-controls">
        <input type="number" value="${ex.sets}" min="1" max="10" data-field="sets" data-idx="${i}" inputmode="numeric" title="Sets">
        <span style="color:var(--text-dim);font-size:0.7rem;align-self:center">x</span>
        <input type="number" value="${Array.isArray(ex.repRange) ? ex.repRange[1] : ex.reps}" min="1" max="30" data-field="reps" data-idx="${i}" inputmode="numeric" title="Reps">
      </div>
      <div class="slot-actions">
        ${!isMain && i > 1 ? `<button class="slot-btn" data-move-up="${i}" title="Move up">&uarr;</button>` : ''}
        ${!isMain && i < store.builderExercises.length - 1 ? `<button class="slot-btn" data-move-down="${i}" title="Move down">&darr;</button>` : ''}
        ${!isMain && !inGroup && nextEx && !nextEx.groupId && nextEx.type !== 'main' ? `<button class="slot-btn" data-link-ss="${i}" title="Superset with next">SS</button>` : ''}
        ${!isMain ? `<button class="slot-btn" data-swap="${i}">Swap</button>` : ''}
        ${!isMain ? `<button class="slot-btn danger" data-remove="${i}">&times;</button>` : ''}
      </div>
      ${isMain && ex.programSets ? (() => {
        const displaySets = ex.programSets.filter(s => s.tier !== 'BBB');
        const hasBBB = ex.programSets.some(s => s.tier === 'BBB');
        let setsHtml = '<div class="builder-program-sets">';
        displaySets.forEach(s => {
          const isAmrap = typeof s.reps === 'string' && s.reps.includes('+');
          const amrapBadge = isAmrap ? ' <span style="color:var(--gold);font-weight:600;font-size:0.65rem">AMRAP</span>' : '';
          const checkmark = s.completed ? '<span class="program-set-check">&#10003;</span>' : '';
          const plateStr = formatPlates(s.weight);
          setsHtml += `<div class="program-set-row${s.completed ? ' completed' : ''}">
            ${checkmark}<span class="program-set-num">${s.num}</span>
            <span class="program-set-weight">${formatWeight(s.weight)} ${store.unit} &times; ${s.reps}</span>${amrapBadge}
            <span class="program-set-pct">${s.pct}%</span>
            ${plateStr ? `<div class="plate-display">${plateStr} /side</div>` : ''}
          </div>`;
        });
        if (hasBBB) setsHtml += '<div style="font-size:0.65rem;color:var(--text-dim);margin-top:6px;opacity:0.7">+ 5\u00d710 BBB supplemental (shown in workout)</div>';
        setsHtml += '</div>';
        return setsHtml;
      })() : ''}
    </div>`;
    if (isGroupEnd) html += `</div>`;
  });

  // Add exercise button
  html += `<button class="builder-add-btn" id="builder-add-exercise">+ Add Exercise</button>`;

  // --- Guardrail hints ---
  const guardrails = checkGuardrails(mainLift, store.builderExercises);
  if (guardrails.length > 0) {
    html += `<div class="guardrail-hints">`;
    for (const hint of guardrails) {
      let actionHtml = '';
      if (hint.type === 'staleness' && hint.alternativeExercise) {
        actionHtml = ` <button class="hint-swap" data-stale="${hint.staleExerciseId}" data-alt="${hint.alternativeExercise.id}">${hint.alternativeExercise.name}?</button>`;
      }
      html += `<div class="guardrail-hint">${escapeHTML(hint.message)}${actionHtml}</div>`;
    }
    html += `</div>`;
  }

  // --- Collapsible gap panel ---
  const gapReport = getGapReport(mainLift);
  const pushPull = analyzePushPullRatio();
  const volume = analyzeWeeklyVolume();

  html += `<button class="gap-panel-toggle${_gapPanelOpen ? ' open' : ''}" id="gap-panel-toggle">
    <span>Coverage Analysis (${gapReport.length} gaps)</span>
    <span class="arrow">&#9660;</span>
  </button>`;
  html += `<div class="gap-panel${_gapPanelOpen ? ' open' : ''}" id="gap-panel">`;

  // Muscle group rows
  for (const mg of ['Quads', 'Chest', 'Glutes', 'Hams', 'Upper Back', 'Shoulders', 'Triceps', 'Core', 'Biceps', 'Lower Back']) {
    const v = volume[mg];
    if (!v) continue;
    const statusClass = v.status === 'under' ? 'under' : 'optimal';
    const gap = gapReport.find(g => g.muscleGroup === mg && g.type === 'volume');
    html += `<div class="gap-row">
      <span class="gap-row-label">${mg}</span>
      <span class="gap-row-value ${statusClass}">${v.sets}/${v.target.min}</span>
      ${gap && gap.suggestedExercise ? `<button class="gap-row-btn" data-gap-add="${gap.suggestedExercise.id}">+ ${gap.suggestedExercise.name}</button>` : ''}
    </div>`;
  }

  // Push:pull ratio
  html += `<div class="gap-ratio">
    <span>Push:Pull</span>
    <span class="gap-ratio-value ${pushPull.status === 'balanced' ? 'balanced' : 'imbalanced'}">${pushPull.pushSets}:${pushPull.pullSets}</span>
    ${pushPull.status === 'push-heavy' ? `<button class="gap-row-btn" data-gap-add-pull="1">+ Pull</button>` : ''}
  </div>`;
  html += `</div>`; // end gap-panel

  // --- Exercise browser ---
  html += `<div class="exercise-browser" id="builder-browser" style="display:none">`;
  html += `<div class="exercise-browser-header">
    <input type="text" class="exercise-browser-search" id="builder-search" placeholder="Search exercises...">
  </div>`;
  html += `<div class="browser-tabs">
    <button class="browser-tab active" data-browser-tab="recommended">Recommended</button>
    <button class="browser-tab" data-browser-tab="all">All Exercises</button>
  </div>`;
  html += `<div class="exercise-browser-list" id="builder-exercise-list">`;
  html += renderRecommendedBrowser(mainLift);
  html += `</div>`;

  // Custom exercise form
  html += `<div class="custom-exercise-form" id="builder-custom-form" style="display:none">
    <div class="section-label" style="margin-bottom:0">Custom Exercise</div>
    <input type="text" id="custom-ex-name" placeholder="Exercise name">
    <div class="custom-exercise-row">
      <input type="number" id="custom-ex-sets" placeholder="Sets" value="3" min="1" inputmode="numeric">
      <input type="number" id="custom-ex-reps" placeholder="Reps" value="10" min="1" inputmode="numeric">
    </div>
    <div class="custom-exercise-row">
      <select id="custom-ex-equip">
        <option value="barbell">Barbell</option>
        <option value="dumbbell">Dumbbell</option>
        <option value="cable">Cable</option>
        <option value="machine">Machine</option>
        <option value="bodyweight">Bodyweight</option>
      </select>
      <select id="custom-ex-pattern">
        <option value="">Movement Pattern</option>
        ${Object.entries(MOVEMENT_PATTERNS).map(([id, p]) =>
          `<option value="${id}">${p.label}</option>`
        ).join('')}
      </select>
    </div>
    <div class="custom-exercise-row">
      <input type="number" id="custom-ex-weight" placeholder="Weight (optional)" min="0" step="2.5" inputmode="decimal">
      <button class="btn-primary" id="custom-ex-add" style="padding:8px 16px;font-size:var(--text-sm)">Add</button>
    </div>
  </div>`;
  html += `<button class="btn-dashed" id="builder-toggle-custom" style="margin-top:var(--space-2)">+ Add Custom Exercise</button>`;
  html += `</div>`; // end exercise-browser

  body.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Exercise browser renderers
// ---------------------------------------------------------------------------

function renderRecommendedBrowser(mainLift) {
  const addedIds = new Set(store.builderExercises.filter(e => e.type !== 'main').map(e => resolveCanonicalId(e.exerciseId)));
  const scored = scoreAccessories(mainLift).filter(ex => !addedIds.has(ex.canonicalId || ex.id));
  const equip = store.equipmentProfile || {};

  // Split into recommended (supports this lift) and other
  const recommended = scored.filter(ex => (ex.supportsLifts || []).includes(mainLift)).slice(0, 15);

  let html = '';
  if (recommended.length === 0) {
    html += '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:var(--text-sm)">All recommended exercises added</div>';
    return html;
  }

  // Group by movement pattern
  const groups = {};
  recommended.forEach(ex => {
    const pattern = ex.movementPattern || 'other';
    if (!groups[pattern]) groups[pattern] = [];
    groups[pattern].push(ex);
  });

  for (const [pattern, exercises] of Object.entries(groups)) {
    const patternInfo = MOVEMENT_PATTERNS[pattern] || { label: pattern, pushPull: 'neutral' };
    html += `<div class="pattern-group-header">${patternInfo.label} <span class="pattern-badge ${patternInfo.pushPull}">${patternInfo.pushPull}</span></div>`;
    for (const ex of exercises) {
      const available = equip[ex.equipment] !== false;
      html += `<div class="exercise-browser-item${!available ? ' unavailable' : ''}" data-exid="${ex.id}">
        <div>
          <div class="exercise-browser-item-name">${ex.name}</div>
          <div class="muscle-pills">${renderMusclePills(ex)}</div>
        </div>
        <span class="exercise-browser-item-equip">${ex.equipment}</span>
      </div>`;
    }
  }
  return html;
}

function renderAllBrowser(mainLift, query) {
  const addedIds = new Set(store.builderExercises.filter(e => e.type !== 'main').map(e => resolveCanonicalId(e.exerciseId)));
  const equip = store.equipmentProfile || {};
  let html = '';

  // Group all catalog exercises by movement pattern
  const groups = {};
  for (const [id, ex] of Object.entries(EXERCISE_CATALOG)) {
    if (query && !ex.name.toLowerCase().includes(query.toLowerCase())) continue;
    const pattern = ex.movementPattern || 'other';
    if (!groups[pattern]) groups[pattern] = [];
    groups[pattern].push({ id, ...ex });
  }

  for (const [pattern, exercises] of Object.entries(groups).sort()) {
    const patternInfo = MOVEMENT_PATTERNS[pattern] || { label: pattern, pushPull: 'neutral' };
    html += `<div class="pattern-group-header">${patternInfo.label} <span class="pattern-badge ${patternInfo.pushPull}">${patternInfo.pushPull}</span></div>`;
    for (const ex of exercises) {
      const added = addedIds.has(ex.id);
      const available = equip[ex.equipment] !== false;
      html += `<div class="exercise-browser-item${added ? ' added' : ''}${!available ? ' unavailable' : ''}" data-exid="${ex.id}">
        <div>
          <div class="exercise-browser-item-name">${ex.name}</div>
          <div class="muscle-pills">${renderMusclePills(ex)}</div>
        </div>
        <span class="exercise-browser-item-equip">${ex.equipment}</span>
      </div>`;
    }
  }

  return html || '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:var(--text-sm)">No exercises found</div>';
}

function renderMusclePills(ex) {
  const muscles = ex.primaryMuscles || {};
  return Object.entries(muscles)
    .filter(([, w]) => w >= 0.20)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([mg]) => `<span class="muscle-pill">${mg}</span>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Swap sheet
// ---------------------------------------------------------------------------

function openSwapSheet(slotIdx) {
  const exercise = store.builderExercises[slotIdx];
  if (!exercise) return;

  const mainLift = _builderMainLift;
  const catalogEx = resolveExercise(exercise.exerciseId);
  const pattern = catalogEx ? catalogEx.movementPattern : null;
  const equip = store.equipmentProfile || {};

  // Score all exercises
  const allScored = scoreAccessories(mainLift);
  const addedIds = new Set(store.builderExercises.map(e => resolveCanonicalId(e.exerciseId)));

  // Pass 1: Same pattern (top 4)
  const samePattern = allScored
    .filter(ex => ex.movementPattern === pattern && !addedIds.has(ex.canonicalId || ex.id))
    .slice(0, 4);

  // Pass 2: Gap-based from other patterns (2-4)
  const gapReport = getGapReport(mainLift);
  const gapExerciseIds = new Set(gapReport.filter(g => g.suggestedExercise).map(g => g.suggestedExercise.id));
  const gapBased = allScored
    .filter(ex => ex.movementPattern !== pattern && !addedIds.has(ex.canonicalId || ex.id) && gapExerciseIds.has(ex.id))
    .slice(0, 4);

  let html = '';
  if (samePattern.length > 0) {
    html += `<div class="swap-section-label">Same Movement Pattern</div>`;
    for (const ex of samePattern) {
      const available = equip[ex.equipment] !== false;
      html += renderSwapItem(ex, slotIdx, available);
    }
  }
  if (gapBased.length > 0) {
    html += `<div class="swap-section-label">Addresses Training Gaps</div>`;
    for (const ex of gapBased) {
      const available = equip[ex.equipment] !== false;
      html += renderSwapItem(ex, slotIdx, available);
    }
  }
  if (samePattern.length === 0 && gapBased.length === 0) {
    html = '<div style="padding:16px;text-align:center;color:var(--text-dim)">No alternatives available</div>';
  }

  $('swap-sheet-title').textContent = `Swap: ${exercise.name}`;
  $('swap-sheet-body').innerHTML = html;
  $('swap-sheet-backdrop').style.display = 'block';
  $('swap-sheet').style.display = 'flex';

  // Wire swap clicks
  $('swap-sheet-body').querySelectorAll('.swap-item').forEach(item => {
    item.addEventListener('click', () => {
      const exId = item.dataset.exid;
      const idx = parseInt(item.dataset.slot);
      swapExercise(idx, exId);
      closeSwapSheet();
    });
  });

  $('swap-sheet-backdrop').addEventListener('click', closeSwapSheet);
}

function renderSwapItem(ex, slotIdx, available) {
  const reason = ex.reasons && ex.reasons.length > 0 ? ex.reasons[0] : '';
  return `<div class="swap-item${!available ? ' unavailable' : ''}" data-exid="${ex.id}" data-slot="${slotIdx}">
    <div class="swap-item-info">
      <div class="swap-item-name">${ex.name}</div>
      <div class="swap-item-meta">${ex.sets || 3}x${Array.isArray(ex.repRange) ? ex.repRange.join('-') : '8-12'}</div>
      ${reason ? `<div class="swap-item-reason">${escapeHTML(reason)}</div>` : ''}
    </div>
    <span class="swap-item-equip">${ex.equipment}</span>
  </div>`;
}

function closeSwapSheet() {
  $('swap-sheet-backdrop').style.display = 'none';
  $('swap-sheet').style.display = 'none';
}

function swapExercise(slotIdx, newExId) {
  const catalogEx = EXERCISE_CATALOG[newExId];
  if (!catalogEx) return;
  const mainLift = _builderMainLift;
  const weight = getAccessoryWeight(newExId, mainLift);
  const old = store.builderExercises[slotIdx];

  store.builderExercises[slotIdx] = {
    type: 'accessory',
    exerciseId: newExId,
    canonicalId: newExId,
    name: catalogEx.name,
    sets: catalogEx.sets || old.sets || 3,
    reps: catalogEx.repRange ? catalogEx.repRange[1] : (old.reps || 10),
    weightMode: 'auto',
    weightValue: weight,
    equipment: catalogEx.equipment,
    repRange: catalogEx.repRange ? [...catalogEx.repRange] : [8, 12],
    order: old.order,
    slotRole: old.slotRole || 'accessory',
    reasons: [],
  };
  _markDirty();
  renderBuilder(mainLift);
}

// ---------------------------------------------------------------------------
// Add exercise from browser or gap panel
// ---------------------------------------------------------------------------

function addExerciseFromCatalog(exId) {
  const catalogEx = EXERCISE_CATALOG[exId];
  if (!catalogEx) return;
  // #10: Duplicate detection
  const canonId = resolveCanonicalId(exId);
  if (store.builderExercises.some(e => e.type !== 'main' && resolveCanonicalId(e.exerciseId) === canonId)) {
    showToast('Exercise already in workout');
    return;
  }
  const mainLift = _builderMainLift;
  const weight = getAccessoryWeight(exId, mainLift);

  // Increment reason tag count
  const count = store.reasonTagCounts[exId] || 0;
  store.reasonTagCounts[exId] = count + 1;
  store.saveReasonTagCounts();

  store.builderExercises.push({
    type: 'accessory',
    exerciseId: exId,
    canonicalId: exId,
    name: catalogEx.name,
    sets: catalogEx.sets || 3,
    reps: catalogEx.repRange ? catalogEx.repRange[1] : 10,
    weightMode: 'auto',
    weightValue: weight,
    equipment: catalogEx.equipment,
    repRange: catalogEx.repRange ? [...catalogEx.repRange] : [8, 12],
    order: store.builderExercises.length,
    slotRole: 'accessory',
    reasons: [],
  });
  _markDirty();
  renderBuilder(mainLift);
}

// ---------------------------------------------------------------------------
// Convert builder to session
// ---------------------------------------------------------------------------

/**
 * Convert the current builder exercise list into a workout session object.
 */
export function builderToSession(mainLift) {
  const now = new Date();
  const accessories = store.builderExercises.filter(e => e.type !== 'main').map(ex => {
    const catalogEx = resolveExercise(ex.exerciseId);
    const dbEx = ACCESSORY_DB[ex.exerciseId];
    const weight = ex.weightValue || (catalogEx ? getAccessoryWeight(ex.exerciseId, mainLift) : 0);
    return {
      exerciseId: ex.exerciseId,
      name: ex.name,
      setWeights: computeSetWeights(weight, ex.sets),
      targetSets: ex.sets,
      repRange: Array.isArray(ex.repRange) ? [...ex.repRange] : [ex.reps, ex.reps],
      equipment: ex.equipment,
      setsCompleted: [],
      progressed: catalogEx ? checkAccessoryProgression(ex.exerciseId, mainLift) : (dbEx ? checkAccessoryProgression(ex.exerciseId, mainLift) : false),
      groupId: ex.groupId || null,
      groupType: ex.groupType || null,
    };
  });

  // Increment reason tag counts for pre-filled exercises
  for (const ex of store.builderExercises) {
    if (ex.type === 'main') continue;
    const canonId = resolveCanonicalId(ex.exerciseId);
    store.reasonTagCounts[canonId] = (store.reasonTagCounts[canonId] || 0) + 1;
  }
  store.saveReasonTagCounts();

  const session = {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    mainLift,
    programWeek: findFirstIncompleteWeek(mainLift),
    date: now.toISOString().split('T')[0],
    startTime: now.getTime(),
    mainSets: [],
    bbbSets: [],
    accessories,
    completed: false,
    source: 'guided-builder',
    templateId: $('builder-save-template')?._templateId || null,
  };
  const workout = getProgramWorkout(mainLift, session.programWeek);
  if (workout) {
    const mainOnly = workout.sets.filter(s => s.tier !== 'BBB');
    const bbbOnly = workout.sets.filter(s => s.tier === 'BBB');
    session.mainSets = mainOnly.map(s => ({
      num: s.num, weight: s.weight, reps: s.reps, pct: s.pct,
      tier: s.tier, day: s.day, completed: s.completed
    }));
    session.bbbSets = bbbOnly.map((s, i) => ({
      num: i + 1, weight: s.weight, reps: s.reps, pct: s.pct,
      tier: 'BBB', completed: false
    }));
  }
  return session;
}

// ---------------------------------------------------------------------------
// Template management
// ---------------------------------------------------------------------------

export function saveAsTemplate(mainLift) {
  const editingId = $('builder-save-template')._templateId || null;
  const existing = editingId ? store.customTemplates.find(t => t.id === editingId) : null;

  const name = prompt('Template name:', existing ? existing.name : '');
  if (!name || !name.trim()) return;

  const gapReport = getGapReport(mainLift);
  const pushPull = analyzePushPullRatio();
  const exercises = store.builderExercises.map(e => ({ ...e }));
  const metadata = {
    gapCount: gapReport.length,
    pushPullRatio: pushPull.ratio,
    slotRoles: store.builderExercises.map(e => e.slotRole || 'accessory'),
  };

  // #13: Optional notes
  const notes = prompt('Notes (optional):', existing ? (existing.notes || '') : '') || '';
  // #17: Tags
  const PRESET_TAGS = ['Strength', 'Hypertrophy', 'Recovery', 'Volume', 'Competition'];
  const tagsInput = prompt(`Tags (comma-separated):\n${PRESET_TAGS.join(', ')}`, existing ? (existing.tags || []).join(', ') : '') || '';
  const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);

  if (existing) {
    // Update in-place
    existing.name = name.trim();
    existing.notes = notes.trim();
    existing.tags = tags;
    existing.exercises = exercises;
    existing.metadata = metadata;
    existing.lastUsed = Date.now();
    $('builder-save-template')._templateId = null;
    _builderDirty = false;
    localStorage.removeItem('sbd-builder-draft');
    store.saveCustomTemplates();
    showToast('Template updated: ' + name.trim());
  } else {
    const template = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      notes: notes.trim(),
      tags,
      mainLift,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      exercises,
      metadata,
    };
    store.customTemplates.push(template);
    _builderDirty = false;
    localStorage.removeItem('sbd-builder-draft');
    store.saveCustomTemplates();
    showToast('Template saved: ' + name.trim());
  }
}

export function showTemplateList() {
  const lift = store.currentLift;
  // #11: Pinned templates sort first, then by lastUsed
  const liftTemplates = store.customTemplates.filter(t => t.mainLift === lift).sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.lastUsed || 0) - (a.lastUsed || 0);
  });
  if (liftTemplates.length === 0) {
    showToast('No templates for ' + LIFT_NAMES[lift]);
    return;
  }

  const body = $('choice-sheet-body');
  $('choice-sheet-title').textContent = 'Saved Templates';

  // #17: Tag filter bar
  const allTags = [...new Set(liftTemplates.flatMap(t => t.tags || []))];
  let html = '';
  if (allTags.length > 0) {
    html += `<div class="template-tag-filters" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:var(--space-2)">`;
    html += `<button class="template-tag-filter-btn active" data-tag-filter="">All</button>`;
    allTags.forEach(tag => {
      html += `<button class="template-tag-filter-btn" data-tag-filter="${escapeHTML(tag)}">${escapeHTML(tag)}</button>`;
    });
    html += `</div>`;
  }
  html += '<div class="template-list">';
  liftTemplates.forEach(t => {
    const accExercises = t.exercises.filter(e => e.type !== 'main');
    const accCount = accExercises.length;
    const lastUsed = t.lastUsed ? new Date(t.lastUsed).toLocaleDateString() : 'Never';
    const useCount = t.useCount || 0;
    const totalSets = accExercises.reduce((sum, e) => sum + (e.sets || 3), 0);
    // #6: Exercise name preview pills
    const previewNames = accExercises.slice(0, 4).map(e => escapeHTML(e.name));
    const moreCount = Math.max(0, accCount - 4);
    const previewHtml = previewNames.map(n => `<span class="template-preview-pill">${n}</span>`).join('')
      + (moreCount > 0 ? `<span class="template-preview-more">+${moreCount}</span>` : '');
    html += `<div class="template-card" data-tid="${t.id}">
      <div class="template-card-info">
        <div class="template-card-name">${t.pinned ? '&#9733; ' : ''}${escapeHTML(t.name)}</div>
        <div class="template-card-meta">${accCount} exercises &bull; ${totalSets} sets &bull; Used ${useCount}x &bull; Last: ${lastUsed}</div>
        ${t.notes ? `<div class="template-card-notes">${escapeHTML(t.notes)}</div>` : ''}
        ${(t.tags && t.tags.length > 0) ? `<div class="template-card-tags">${t.tags.map(tag => `<span class="template-tag-pill">${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
        <div class="template-card-preview">${previewHtml}</div>
      </div>
      <div class="template-card-actions">
        <button class="builder-btn-sm" data-pin-template="${t.id}" title="${t.pinned ? 'Unpin' : 'Pin'}">${t.pinned ? '&#9733;' : '&#9734;'}</button>
        <button class="builder-btn-sm" data-rename-template="${t.id}" title="Rename">Aa</button>
        <button class="builder-btn-sm" data-edit-template="${t.id}" title="Edit">&#9998;</button>
        <button class="builder-btn-sm" data-dup-template="${t.id}" title="Duplicate">&#9901;</button>
        <button class="builder-btn-sm danger" data-del-template="${t.id}" title="Delete">&times;</button>
      </div>
    </div>`;
  });
  html += '</div>';
  body.innerHTML = html;

  $('choice-sheet-backdrop').style.display = 'block';
  $('choice-sheet').style.display = 'block';
  document.body.style.overflow = 'hidden';

  // #17: Tag filter click handler
  body.querySelectorAll('.template-tag-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tagFilter;
      body.querySelectorAll('.template-tag-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      body.querySelectorAll('.template-card').forEach(card => {
        const tid = card.dataset.tid;
        const t = store.customTemplates.find(x => x.id === tid);
        if (!tag) { card.style.display = ''; return; }
        card.style.display = (t && t.tags && t.tags.includes(tag)) ? '' : 'none';
      });
    });
  });

  body.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-template]') || e.target.closest('[data-del-template]') || e.target.closest('[data-dup-template]') || e.target.closest('[data-rename-template]') || e.target.closest('[data-pin-template]')) return;
      const tid = card.dataset.tid;
      const template = store.customTemplates.find(t => t.id === tid);
      if (!template) return;
      template.lastUsed = Date.now();
      template.useCount = (template.useCount || 0) + 1;
      store.saveCustomTemplates();
      _closeChoiceSheet();
      // Re-evaluate weights on load; drop stale non-custom exercises
      let staleCount = 0;
      const exercises = (template.exercises || []).map(e => {
        const copy = { ...e };
        if (copy.type !== 'main' && !copy.custom && !resolveExercise(copy.exerciseId)) {
          staleCount++;
          return null;
        }
        if (copy.type !== 'main' && copy.weightMode === 'auto') {
          copy.weightValue = getAccessoryWeight(copy.exerciseId, lift);
        }
        return copy;
      }).filter(Boolean);
      if (staleCount > 0) showToast(`Removed ${staleCount} unavailable exercise${staleCount > 1 ? 's' : ''}`);
      openBuilder(lift, exercises);
    });
  });

  // #11: Pin/unpin handler
  body.querySelectorAll('[data-pin-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = btn.dataset.pinTemplate;
      const template = store.customTemplates.find(t => t.id === tid);
      if (!template) return;
      template.pinned = !template.pinned;
      store.saveCustomTemplates();
      showTemplateList();
    });
  });

  // #7: Rename handler
  body.querySelectorAll('[data-rename-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = btn.dataset.renameTemplate;
      const template = store.customTemplates.find(t => t.id === tid);
      if (!template) return;
      const newName = prompt('New template name:', template.name);
      if (!newName || !newName.trim()) return;
      template.name = newName.trim();
      store.saveCustomTemplates();
      showTemplateList();
      showToast('Template renamed');
    });
  });

  body.querySelectorAll('[data-edit-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = btn.dataset.editTemplate;
      const template = store.customTemplates.find(t => t.id === tid);
      if (!template) return;
      _closeChoiceSheet();
      const exercises = (template.exercises || []).map(e => ({ ...e }));
      openBuilder(lift, exercises);
      $('builder-save-template')._templateId = tid;
    });
  });

  body.querySelectorAll('[data-dup-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = btn.dataset.dupTemplate;
      const template = store.customTemplates.find(t => t.id === tid);
      if (!template) return;
      const dup = {
        ...template,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: template.name + ' (Copy)',
        createdAt: Date.now(),
        lastUsed: null,
        exercises: (template.exercises || []).map(e => ({ ...e }))
      };
      store.customTemplates.push(dup);
      store.saveCustomTemplates();
      showTemplateList();
      showToast('Template duplicated');
    });
  });

  body.querySelectorAll('[data-del-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = btn.dataset.delTemplate;
      const idx = store.customTemplates.findIndex(t => t.id === tid);
      if (idx === -1) return;
      const removed = store.customTemplates.splice(idx, 1)[0];
      store.saveCustomTemplates();
      showTemplateList();
      const el = $('toast');
      el.className = 'toast';
      el.innerHTML = 'Template deleted <button class="toast-undo" id="tmpl-undo-btn">Undo</button>';
      el.classList.add('show');
      setTimeout(() => {
        const undoBtn = $('tmpl-undo-btn');
        if (undoBtn) undoBtn.addEventListener('click', () => {
          store.customTemplates.push(removed);
          store.saveCustomTemplates();
          showToast('Restored');
        });
      }, 0);
      setTimeout(() => el.classList.remove('show'), 10000);
    });
  });
}

// ---------------------------------------------------------------------------
// Dependency injection for closeChoiceSheet
// ---------------------------------------------------------------------------

let _closeChoiceSheet = null;
let _renderWorkoutView = null;

export function setBuilderDeps(deps) {
  if (deps.closeChoiceSheet) _closeChoiceSheet = deps.closeChoiceSheet;
  if (deps.renderWorkoutView) _renderWorkoutView = deps.renderWorkoutView;
}

// ---------------------------------------------------------------------------
// Init — delegation (attached once)
// ---------------------------------------------------------------------------

export function initBuilderOverlay() {
  const body = $('builder-body');

  body.addEventListener('click', (e) => {
    const mainLift = _builderMainLift;
    if (!mainLift) return;

    // #12: Move up/down buttons
    const moveUpBtn = e.target.closest('[data-move-up]');
    if (moveUpBtn) {
      const idx = parseInt(moveUpBtn.dataset.moveUp);
      if (idx > 1) {
        [store.builderExercises[idx], store.builderExercises[idx - 1]] = [store.builderExercises[idx - 1], store.builderExercises[idx]];
        _markDirty();
        renderBuilder(mainLift);
      }
      return;
    }
    const moveDownBtn = e.target.closest('[data-move-down]');
    if (moveDownBtn) {
      const idx = parseInt(moveDownBtn.dataset.moveDown);
      if (idx < store.builderExercises.length - 1) {
        [store.builderExercises[idx], store.builderExercises[idx + 1]] = [store.builderExercises[idx + 1], store.builderExercises[idx]];
        _markDirty();
        renderBuilder(mainLift);
      }
      return;
    }

    // #20: Superset link/unlink
    const linkBtn = e.target.closest('[data-link-ss]');
    if (linkBtn) {
      const idx = parseInt(linkBtn.dataset.linkSs);
      const gid = 'ss-' + Date.now();
      store.builderExercises[idx].groupId = gid;
      store.builderExercises[idx].groupType = 'superset';
      if (store.builderExercises[idx + 1]) {
        store.builderExercises[idx + 1].groupId = gid;
        store.builderExercises[idx + 1].groupType = 'superset';
      }
      _markDirty();
      renderBuilder(mainLift);
      return;
    }
    const unlinkBtn = e.target.closest('[data-unlink-group]');
    if (unlinkBtn) {
      const gid = unlinkBtn.dataset.unlinkGroup;
      store.builderExercises.forEach(ex => {
        if (ex.groupId === gid) { delete ex.groupId; delete ex.groupType; }
      });
      _markDirty();
      renderBuilder(mainLift);
      return;
    }

    // Swap buttons
    const swapBtn = e.target.closest('[data-swap]');
    if (swapBtn) {
      openSwapSheet(parseInt(swapBtn.dataset.swap));
      return;
    }

    // Remove buttons
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      store.builderExercises.splice(parseInt(removeBtn.dataset.remove), 1);
      _markDirty();
      renderBuilder(mainLift);
      return;
    }

    // Add exercise button — show browser
    if (e.target.closest('#builder-add-exercise')) {
      const browser = $('builder-browser');
      browser.style.display = browser.style.display === 'none' ? 'block' : 'none';
      return;
    }

    // Browser tab switching
    const tabBtn = e.target.closest('[data-browser-tab]');
    if (tabBtn) {
      body.querySelectorAll('.browser-tab').forEach(t => t.classList.remove('active'));
      tabBtn.classList.add('active');
      const tab = tabBtn.dataset.browserTab;
      if (tab === 'recommended') {
        $('builder-exercise-list').innerHTML = renderRecommendedBrowser(mainLift);
      } else {
        $('builder-exercise-list').innerHTML = renderAllBrowser(mainLift, $('builder-search')?.value || '');
      }
      return;
    }

    // Exercise browser items
    const browserItem = e.target.closest('.exercise-browser-item:not(.added):not(.unavailable)');
    if (browserItem) {
      addExerciseFromCatalog(browserItem.dataset.exid);
      return;
    }

    // Gap panel toggle
    if (e.target.closest('#gap-panel-toggle')) {
      _gapPanelOpen = !_gapPanelOpen;
      const toggle = $('gap-panel-toggle');
      const panel = $('gap-panel');
      if (_gapPanelOpen) {
        toggle.classList.add('open');
        panel.classList.add('open');
      } else {
        toggle.classList.remove('open');
        panel.classList.remove('open');
      }
      return;
    }

    // Gap panel add buttons
    const gapAddBtn = e.target.closest('[data-gap-add]');
    if (gapAddBtn) {
      addExerciseFromCatalog(gapAddBtn.dataset.gapAdd);
      return;
    }

    // Gap panel add pull
    if (e.target.closest('[data-gap-add-pull]')) {
      const pullEx = Object.entries(EXERCISE_CATALOG).find(([, ex]) => {
        const p = MOVEMENT_PATTERNS[ex.movementPattern];
        return p && p.pushPull === 'pull' && ex.supportsLifts.includes(mainLift) && (store.equipmentProfile || {})[ex.equipment] !== false;
      });
      if (pullEx) addExerciseFromCatalog(pullEx[0]);
      return;
    }

    // Staleness swap hints
    const hintSwap = e.target.closest('.hint-swap');
    if (hintSwap) {
      const staleId = hintSwap.dataset.stale;
      const altId = hintSwap.dataset.alt;
      const idx = store.builderExercises.findIndex(e => resolveCanonicalId(e.exerciseId) === staleId);
      if (idx >= 0) {
        swapExercise(idx, altId);
      }
      return;
    }

    // Toggle custom form
    if (e.target.closest('#builder-toggle-custom')) {
      const form = $('builder-custom-form');
      form.style.display = form.style.display === 'none' ? 'flex' : 'none';
      return;
    }

    // Add custom exercise
    if (e.target.closest('#custom-ex-add')) {
      const name = $('custom-ex-name').value.trim();
      if (!name) { showToast('Enter exercise name'); return; }
      const sets = parseInt($('custom-ex-sets').value) || 3;
      const reps = parseInt($('custom-ex-reps').value) || 10;
      const equip = $('custom-ex-equip').value;
      const pattern = $('custom-ex-pattern').value;
      const weight = parseFloat($('custom-ex-weight').value) || 0;

      // Deterministic ID from name so history consolidates across sessions
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

      store.builderExercises.push({
        type: 'accessory',
        exerciseId: 'custom-' + slug,
        name,
        sets, reps,
        weightMode: 'manual',
        weightValue: weight,
        equipment: equip,
        repRange: [reps, reps],
        order: store.builderExercises.length,
        custom: true,
        slotRole: 'accessory',
        movementPattern: pattern || null,
      });
      $('custom-ex-name').value = '';
      $('custom-ex-weight').value = '';
      $('builder-custom-form').style.display = 'none';
      _markDirty();
      renderBuilder(mainLift);
      return;
    }
  });

  // Delegated change for sets/reps inputs
  body.addEventListener('change', (e) => {
    const inp = e.target.closest('input[data-field]');
    if (!inp) return;
    const idx = parseInt(inp.dataset.idx);
    const field = inp.dataset.field;
    const val = parseInt(inp.value) || 1;
    if (field === 'sets') store.builderExercises[idx].sets = val;
    else if (field === 'reps') {
      store.builderExercises[idx].reps = val;
      if (Array.isArray(store.builderExercises[idx].repRange)) {
        store.builderExercises[idx].repRange[1] = val;
      }
    }
    _markDirty();
    // Update summary bar duration
    const duration = estimateWorkoutDuration(store.builderExercises);
    $('builder-summary-bar').innerHTML = `<span class="duration-pill">~${duration}min</span>`;
  });

  // Delegated search input
  body.addEventListener('input', (e) => {
    if (e.target.id === 'builder-search') {
      const activeTab = body.querySelector('.browser-tab.active');
      const tab = activeTab ? activeTab.dataset.browserTab : 'recommended';
      if (tab === 'all') {
        $('builder-exercise-list').innerHTML = renderAllBrowser(_builderMainLift, e.target.value);
      } else {
        // Filter recommended by search
        $('builder-exercise-list').innerHTML = renderRecommendedBrowser(_builderMainLift);
      }
    }
  });

  // Builder close button
  $('builder-close')?.addEventListener('click', closeBuilder);

  // Builder start workout button
  $('builder-start')?.addEventListener('click', () => {
    if (!_builderMainLift) return;
    const session = builderToSession(_builderMainLift);
    store.workoutSession = session;
    store.saveWorkoutSession();
    closeBuilder(true);
    $('workout-overlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    if (_renderWorkoutView) _renderWorkoutView();
  });

  // Builder save template button
  $('builder-save-template')?.addEventListener('click', () => {
    if (!_builderMainLift) return;
    saveAsTemplate(_builderMainLift);
  });
}
