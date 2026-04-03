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
import { getProgramWorkout, findFirstIncompleteWeek } from '../systems/programs.js';
import {
  analyzeWeeklyVolume,
  analyzePushPullRatio,
  getGapReport,
  estimateWorkoutDuration,
} from '../systems/gap-analysis.js';
import { checkGuardrails } from '../systems/workout-guardrails.js';
import { showToast } from '../ui/toast.js';
import { displayWeight } from '../formulas/units.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _builderMainLift = null;
let _gapPanelOpen = false;

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
export function closeBuilder() {
  $('builder-overlay').style.display = 'none';
  document.body.style.overflow = '';
  store.builderExercises = [];
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
    if (!isMain && ex.weightValue > 0) {
      weightDisplay = `<span class="slot-weight">${displayWeight(ex.weightValue)}</span>`;
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

    html += `<div class="builder-exercise${isMain ? ` main-lift ${mainLift}` : ''}" data-slot="${i}">
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
        ${!isMain ? `<button class="slot-btn" data-swap="${i}">Swap</button>` : ''}
        ${!isMain ? `<button class="slot-btn danger" data-remove="${i}">&times;</button>` : ''}
      </div>
    </div>`;
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
  renderBuilder(mainLift);
}

// ---------------------------------------------------------------------------
// Add exercise from browser or gap panel
// ---------------------------------------------------------------------------

function addExerciseFromCatalog(exId) {
  const catalogEx = EXERCISE_CATALOG[exId];
  if (!catalogEx) return;
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
    accessories,
    completed: false,
    source: 'guided-builder',
  };
  const workout = getProgramWorkout(mainLift, session.programWeek);
  if (workout) {
    session.mainSets = workout.sets.map(s => ({
      num: s.num, weight: s.weight, reps: s.reps, pct: s.pct,
      tier: s.tier, day: s.day, completed: s.completed
    }));
  }
  return session;
}

// ---------------------------------------------------------------------------
// Template management
// ---------------------------------------------------------------------------

export function saveAsTemplate(mainLift) {
  const name = prompt('Template name:');
  if (!name) return;

  const gapReport = getGapReport(mainLift);
  const pushPull = analyzePushPullRatio();

  const template = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    mainLift,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    exercises: store.builderExercises.map(e => ({ ...e })),
    metadata: {
      gapCount: gapReport.length,
      pushPullRatio: pushPull.ratio,
      slotRoles: store.builderExercises.map(e => e.slotRole || 'accessory'),
    },
  };
  store.customTemplates.push(template);
  store.saveCustomTemplates();
  showToast('Template saved: ' + name);
}

export function showTemplateList() {
  const lift = store.currentLift;
  const liftTemplates = store.customTemplates.filter(t => t.mainLift === lift).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  if (liftTemplates.length === 0) {
    showToast('No templates for ' + LIFT_NAMES[lift]);
    return;
  }

  const body = $('choice-sheet-body');
  $('choice-sheet-title').textContent = 'Saved Templates';
  let html = '<div class="template-list">';
  liftTemplates.forEach(t => {
    const accCount = t.exercises.filter(e => e.type !== 'main').length;
    const lastUsed = t.lastUsed ? new Date(t.lastUsed).toLocaleDateString() : 'Never';
    html += `<div class="template-card" data-tid="${t.id}">
      <div class="template-card-info">
        <div class="template-card-name">${escapeHTML(t.name)}</div>
        <div class="template-card-meta">${accCount} exercises &bull; Last used: ${lastUsed}</div>
      </div>
      <div class="template-card-actions">
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

  body.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-template]') || e.target.closest('[data-del-template]') || e.target.closest('[data-dup-template]')) return;
      const tid = card.dataset.tid;
      const template = store.customTemplates.find(t => t.id === tid);
      if (!template) return;
      template.lastUsed = Date.now();
      store.saveCustomTemplates();
      _closeChoiceSheet();
      // Re-evaluate weights on load (not frozen)
      const exercises = (template.exercises || []).map(e => {
        const copy = { ...e };
        if (copy.type !== 'main' && copy.weightMode === 'auto') {
          copy.weightValue = getAccessoryWeight(copy.exerciseId, lift);
        }
        return copy;
      });
      openBuilder(lift, exercises);
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

export function setBuilderDeps(deps) {
  if (deps.closeChoiceSheet) _closeChoiceSheet = deps.closeChoiceSheet;
}

// ---------------------------------------------------------------------------
// Init — delegation (attached once)
// ---------------------------------------------------------------------------

export function initBuilderOverlay() {
  const body = $('builder-body');

  body.addEventListener('click', (e) => {
    const mainLift = _builderMainLift;
    if (!mainLift) return;

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

      store.builderExercises.push({
        type: 'accessory',
        exerciseId: 'custom-' + Date.now(),
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
    closeBuilder();
    $('workout-overlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  });

  // Builder save template button
  $('builder-save-template')?.addEventListener('click', () => {
    if (!_builderMainLift) return;
    saveAsTemplate(_builderMainLift);
  });
}
