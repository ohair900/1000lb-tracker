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
import { MAIN_LIFT_WEIGHTS } from '../data/muscle-groups.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';
import { MS_PER_DAY } from '../constants/time.js';
import { checkGuardrails } from '../systems/workout-guardrails.js';
import { showToast } from '../ui/toast.js';
import { displayWeight } from '../formulas/units.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _builderMainLift = null;
let _gapPanelOpen = false;
let _builderDirty = false;
// Slots whose "Why this exercise?" body is currently expanded.
const _openWhyIdx = new Set();

// Browser filter state — reset each time the builder opens.
let _browserFilters = {
  muscle: null,           // string | null — exact muscle group name
  pattern: null,          // string | null — movement pattern key
  equipmentOnly: false,   // boolean — only show exercises with available equipment
  neverTried: false,      // boolean — only show exercises with no accessoryLog history
  search: '',             // last search query (debounced)
};
// Recently used accessory canonical IDs (LRU, oldest first → newest last).
let _recentExerciseIds = [];
const _RECENT_LIMIT = 8;
// Debounce handle for search input.
let _searchDebounceTimer = null;

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

// Movement pattern lookup for an exercise — drives the slot stripe color.
function _patternForExercise(ex) {
  if (ex.movementPattern) return ex.movementPattern;
  const catalogEx = resolveExercise(ex.exerciseId);
  return (catalogEx && catalogEx.movementPattern) || null;
}

// Top-weighted primary muscle for an exercise.
function _primaryMuscleFor(ex) {
  if (ex.type === 'main') {
    const w = MAIN_LIFT_WEIGHTS[ex.exerciseId];
    if (!w) return null;
    return Object.entries(w).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  const catalogEx = resolveExercise(ex.exerciseId);
  if (!catalogEx || !catalogEx.primaryMuscles) return null;
  return Object.entries(catalogEx.primaryMuscles).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Build a once-per-render map: canonicalId → days since last logged set.
function _buildDaysSinceMap() {
  const map = {};
  const now = Date.now();
  for (const log of store.accessoryLog) {
    const id = resolveCanonicalId(log.exerciseId);
    const days = Math.floor((now - log.timestamp) / MS_PER_DAY);
    if (map[id] === undefined || days < map[id]) map[id] = days;
  }
  return map;
}

/**
 * Return a fresh reason list for a slot, blending the original recommendation
 * reasons with current-state coaching signals (fatigue, recency, weekly gaps).
 * Always available — the inline preview line still self-expires after 3 displays
 * but the Why dot exposes this full list on demand.
 */
function _currentReasonsForSlot(ex, ctx) {
  const reasons = [...(ex.reasons || [])];
  const muscle = _primaryMuscleFor(ex);
  if (!muscle) return reasons;

  // Fatigue context
  const f = ctx.fatigueByMuscle && ctx.fatigueByMuscle[muscle];
  if (f && (f.status === 'red' || f.status === 'orange')) {
    reasons.unshift(`Addresses ${f.status} ${muscle.toLowerCase()} fatigue`);
  }

  // Recency context
  const canonId = resolveCanonicalId(ex.exerciseId);
  const days = ctx.daysSince[canonId];
  if (days !== undefined && days >= 14) {
    reasons.unshift(`You haven't done this in ${days} days`);
  } else if (days === undefined && ex.type !== 'main') {
    reasons.push('Never tried — fresh stimulus');
  }

  // Weekly volume context
  const v = ctx.weeklyVolume && ctx.weeklyVolume[muscle];
  if (v && v.status === 'under') {
    reasons.push(`Covers under-trained ${muscle.toLowerCase()} (${v.sets}/${v.target.min} this week)`);
  }

  // Dedupe while preserving order
  const seen = new Set();
  return reasons.filter(r => {
    const k = r.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/**
 * Render the coverage gap panel as a list of one-tap insert actions.
 * Only renders muscles whose status is `under` (with a known suggested
 * exercise) and a push/pull imbalance row when the ratio is off. Whole
 * block is hidden when nothing is actionable.
 */
function _renderGapPanelHTML(mainLift) {
  const gapReport = getGapReport(mainLift);
  const pushPull = analyzePushPullRatio();
  const volume = analyzeWeeklyVolume();

  // Build muscle action rows — under-trained muscles with a recommendation.
  const ORDER = ['Quads', 'Chest', 'Glutes', 'Hams', 'Upper Back',
                 'Shoulders', 'Triceps', 'Core', 'Biceps', 'Lower Back'];
  const actionRows = [];
  for (const mg of ORDER) {
    const v = volume[mg];
    if (!v || v.status !== 'under') continue;
    const gap = gapReport.find(g => g.muscleGroup === mg && g.type === 'volume');
    if (!gap || !gap.suggestedExercise) continue;
    const deficit = Math.max(1, Math.ceil(v.target.min - v.sets));
    actionRows.push({
      muscle: mg,
      deficit,
      sets: v.sets,
      targetMin: v.target.min,
      ex: gap.suggestedExercise,
    });
  }

  // Push/pull imbalance — actionable when push-heavy (suggest a pull).
  const showPushPull = pushPull.status === 'push-heavy' || pushPull.status === 'pull-heavy';

  if (actionRows.length === 0 && !showPushPull) {
    return ''; // Nothing to surface — hide panel entirely.
  }

  const totalCount = actionRows.length + (showPushPull ? 1 : 0);
  let html = `<button class="gap-panel-toggle${_gapPanelOpen ? ' open' : ''}" id="gap-panel-toggle">
    <span>Coverage Gaps (${totalCount})</span>
    <span class="arrow">&#9660;</span>
  </button>`;
  html += `<div class="gap-panel${_gapPanelOpen ? ' open' : ''}" id="gap-panel">`;

  for (const row of actionRows) {
    html += `<button class="gap-action-row" data-gap-add="${row.ex.id}">
      <span class="gap-action-need">Need ${row.deficit} ${row.deficit === 1 ? 'set' : 'sets'} ${row.muscle.toLowerCase()}</span>
      <span class="gap-action-suggest">+ ${escapeHTML(row.ex.name)}</span>
    </button>`;
  }

  if (showPushPull) {
    if (pushPull.status === 'push-heavy') {
      html += `<button class="gap-action-row" data-gap-add-pull="1">
        <span class="gap-action-need">Push-heavy (${pushPull.pushSets}:${pushPull.pullSets}) — add a pull</span>
        <span class="gap-action-suggest">+ Pull</span>
      </button>`;
    } else {
      html += `<button class="gap-action-row" data-gap-add-push="1">
        <span class="gap-action-need">Pull-heavy (${pushPull.pushSets}:${pushPull.pullSets}) — add a push</span>
        <span class="gap-action-suggest">+ Push</span>
      </button>`;
    }
  }

  html += `</div>`;
  return html;
}

/** Render the summary bar HTML from a precomputed summary object. */
function _renderBuilderSummary(mainLift) {
  const s = _calcBuilderSummary(mainLift);
  const stats = `<div class="summary-stats">
    <span class="duration-pill">~${s.minutes}min</span>
    <span class="sets-pill">${s.totalSets} sets</span>
    ${s.muscleLabel ? `<span class="muscles-pill">${escapeHTML(s.muscleLabel)}</span>` : ''}
  </div>`;

  if (s.meters.length === 0) return stats;

  const metersHtml = s.meters.map(m => `
    <div class="muscle-meter" data-status="${m.status}"
         title="${m.after} sets this week (after this session) vs. ${m.target} minimum target">
      <span class="muscle-meter-label">${m.muscle}</span>
      <div class="muscle-meter-bar"><span style="width:${m.pct}%"></span></div>
      <span class="muscle-meter-val">${m.after} / ${m.target} target</span>
    </div>`).join('');

  return stats + `<div class="summary-meters">
    <span class="summary-meters-title">Sets this week (incl. this session)</span>
    ${metersHtml}
  </div>`;
}

/**
 * Compute a richer summary for the header bar:
 *   - minutes (estimated workout duration)
 *   - totalSets (sum across all slots)
 *   - perMuscle: planned sets this session, blended with last 7d weekly volume
 * Returns the top 4 muscles by planned-this-session set count for the meter row.
 */
function _calcBuilderSummary(mainLift) {
  const minutes = estimateWorkoutDuration(store.builderExercises);

  // Planned sets per muscle, this session.
  const planned = {};
  let totalSets = 0;
  for (const ex of store.builderExercises) {
    const sets = ex.sets || 0;
    totalSets += sets;
    if (ex.type === 'main') {
      const w = MAIN_LIFT_WEIGHTS[ex.exerciseId];
      if (!w) continue;
      for (const [mg, weight] of Object.entries(w)) {
        if (weight >= 0.20) planned[mg] = (planned[mg] || 0) + sets;
        else if (weight >= 0.10) planned[mg] = (planned[mg] || 0) + sets * 0.5;
      }
    } else {
      const catalogEx = resolveExercise(ex.exerciseId);
      const muscles = catalogEx && catalogEx.primaryMuscles;
      if (!muscles) continue;
      for (const [mg, weight] of Object.entries(muscles)) {
        if (weight >= 0.20) planned[mg] = (planned[mg] || 0) + sets;
        else if (weight >= 0.10) planned[mg] = (planned[mg] || 0) + sets * 0.5;
      }
    }
  }

  // Pick top muscles by planned set count.
  const ranked = Object.entries(planned)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);
  const topMuscles = ranked.slice(0, 4);
  const muscleLabel = ranked.slice(0, 3).map(([mg]) => mg.toLowerCase()).join(' · ');

  // Blend with weekly volume (last 7d) for the meter row.
  const weekly = analyzeWeeklyVolume();
  const meters = topMuscles.map(([mg, plannedSets]) => {
    const w = weekly[mg] || { sets: 0, target: { min: 6, max: 16 } };
    const after = w.sets + plannedSets;
    const target = w.target.min || 6;
    const pct = Math.min(100, Math.round((after / target) * 100));
    let status = 'under';
    if (after >= target) status = after > (w.target.max || target * 2) ? 'over' : 'optimal';
    return { muscle: mg, planned: Math.round(plannedSets * 10) / 10, after: Math.round(after * 10) / 10, target, pct, status };
  });

  return { minutes, totalSets, muscleLabel, meters };
}

/**
 * Render one slot row (main lift OR accessory) using the unified .builder-slot
 * grid. Inline styles intentionally avoided — every visual is a CSS class.
 *
 * @param {object} ex   the slot
 * @param {number} i    slot index
 * @param {object} [ctx] coaching context shared across all slots in this render
 *                       (fatigueByMuscle, weeklyVolume, daysSince map)
 */
function _slotRowHTML(ex, i, ctx) {
  ctx = ctx || { fatigueByMuscle: {}, weeklyVolume: {}, daysSince: {} };
  const isMain = ex.type === 'main';
  const role = ex.slotRole || (isMain ? 'main' : 'accessory');
  const catalogEx = resolveExercise(ex.exerciseId);
  const pattern = _patternForExercise(ex);
  const primaryMuscle = _primaryMuscleFor(ex);

  // Stripe data attributes (lift accent for main, pattern color otherwise).
  const stripeAttrs = isMain
    ? `data-lift="${ex.exerciseId}"`
    : (pattern ? `data-pattern="${pattern}"` : '');

  // Weight chip (accessories only).
  const weightDisplay = isMain
    ? ''
    : `<span class="slot-weight">${formatBWWeight(ex.weightValue, catalogEx)}</span>`;

  // Inline reason preview — first 3 displays per exercise (existing behavior).
  let reasonHtml = '';
  if (!isMain && ex.reasons && ex.reasons.length > 0) {
    const canonId = resolveCanonicalId(ex.exerciseId);
    const count = store.reasonTagCounts[canonId] || 0;
    if (count < 3) reasonHtml = `<div class="slot-reason">${escapeHTML(ex.reasons[0])}</div>`;
  }

  // Persistent "Why this?" info dot — accessories only.
  const evolvingReasons = isMain ? [] : _currentReasonsForSlot(ex, ctx);
  const whyExpanded = _openWhyIdx.has(i);
  const whyDot = isMain || evolvingReasons.length === 0 ? '' :
    `<button class="slot-why${whyExpanded ? ' open' : ''}" data-why="${i}" aria-label="Why this exercise?" title="Why this exercise?">i</button>`;
  const whyBody = whyExpanded && evolvingReasons.length > 0
    ? `<div class="slot-why-body">${evolvingReasons.map(r => `<div>&bull; ${escapeHTML(r)}</div>`).join('')}</div>`
    : '';

  // Fatigue dot — accessories only, only if primary muscle is red/orange.
  const fStatus = primaryMuscle && ctx.fatigueByMuscle && ctx.fatigueByMuscle[primaryMuscle]
    ? ctx.fatigueByMuscle[primaryMuscle].status : null;
  const fatigueDot = (!isMain && (fStatus === 'red' || fStatus === 'orange'))
    ? `<span class="slot-fatigue-dot" data-status="${fStatus}" data-muscle="${primaryMuscle}" title="${primaryMuscle} fatigue: ${fStatus}"></span>`
    : '';

  // Action buttons — 3 buttons (SS, Swap, ×); ↑/↓ replaced by drag-to-reorder.
  const nextEx = i < store.builderExercises.length - 1 ? store.builderExercises[i + 1] : null;
  const inGroup = !!ex.groupId && !isMain;
  const canLinkSS   = !isMain && !inGroup && nextEx && !nextEx.groupId && nextEx.type !== 'main';
  const canSwap     = !isMain;
  const canRemove   = !isMain;

  let actionsHtml = '';
  if (!isMain) {
    actionsHtml = `
      ${canLinkSS ? `<button class="slot-btn" data-link-ss="${i}" title="Superset with next">SS</button>` : ''}
      ${canSwap   ? `<button class="slot-btn" data-swap="${i}">Swap</button>` : ''}
      ${canRemove ? `<button class="slot-btn danger" data-remove="${i}">&times;</button>` : ''}
    `;
  }

  // Drag handle — accessories only (main lift is pinned at index 0).
  const dragHandle = isMain ? '' : `<span class="builder-slot-drag" data-drag="${i}">&#x2807;</span>`;

  // Compose the slot row.
  const repsDisplay = Array.isArray(ex.repRange) ? ex.repRange.join('-') : ex.reps;
  const repInputVal = Array.isArray(ex.repRange) ? ex.repRange[1] : ex.reps;
  const slotClasses = [
    'builder-slot',
    isMain ? 'is-main' : '',
    inGroup ? 'in-superset' : '',
  ].filter(Boolean).join(' ');

  return `<div class="${slotClasses}" data-slot="${i}">
    <div class="builder-slot-stripe" ${stripeAttrs}></div>
    <div class="builder-slot-body">
      <div class="builder-slot-head">
        ${dragHandle}<span class="slot-role-tag">${role}</span>
        <span class="slot-name">${escapeHTML(ex.name)}</span>${fatigueDot}${weightDisplay}${whyDot}
      </div>
      <div class="builder-slot-meta">${ex.equipment} &bull; ${ex.sets}x${repsDisplay}</div>
      ${reasonHtml}
      ${whyBody}
    </div>
    <div class="builder-slot-controls">
      <input type="number" value="${ex.sets}" min="1" max="10" data-field="sets" data-idx="${i}" inputmode="numeric" title="Sets">
      <span class="x-divider">x</span>
      <input type="number" value="${repInputVal}" min="1" max="30" data-field="reps" data-idx="${i}" inputmode="numeric" title="Reps">
    </div>
    ${actionsHtml ? `<div class="builder-slot-actions">${actionsHtml}</div>` : ''}
  </div>`;
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
  _openWhyIdx.clear();
  _browserFilters = { muscle: null, pattern: null, equipmentOnly: false, neverTried: false, search: '' };

  // Helper that actually mounts the overlay once draft handling has resolved.
  const mount = (initialExercises) => {
    if (initialExercises && initialExercises.length > 0) {
      store.builderExercises = initialExercises;
      if (!store.builderExercises.some(e => e.type === 'main')) {
        store.builderExercises.unshift(buildMainLiftSlot(mainLift));
      }
    } else {
      store.builderExercises = buildDefaultSlots(mainLift);
    }
    $('builder-title').textContent = `Build ${LIFT_NAMES[mainLift]} Workout`;
    $('builder-overlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    renderBuilder(mainLift);
  };

  // Look for a recoverable draft (only when no preloadExercises supplied).
  let draftExercises = null;
  if (!preloadExercises) {
    try {
      const raw = localStorage.getItem('sbd-builder-draft');
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && draft.mainLift === mainLift && draft.exercises && draft.exercises.length > 0
            && (Date.now() - draft.timestamp) < 7200000) {
          draftExercises = draft.exercises;
        }
        localStorage.removeItem('sbd-builder-draft');
      }
    } catch { /* corrupt draft — ignore */ }
  }

  if (draftExercises) {
    // Ask via sheet (replaces native confirm). Mount the overlay first so
    // the sheet appears layered above an empty builder; once user picks,
    // we re-mount with the chosen exercises.
    mount([]);
    _openDraftRecoverySheet({
      onRecover: () => mount(draftExercises),
      onDiscard: () => { /* keep the empty (smart-prefilled) builder */ mount(null); },
    });
  } else {
    mount(preloadExercises);
  }
}

/**
 * Close the builder overlay.
 */
export function closeBuilder(force) {
  if (!force && _builderDirty && store.builderExercises.length > 0) {
    // Sheet-driven discard confirmation (replaces native confirm).
    _openDiscardSheet({ onConfirm: () => closeBuilder(true) });
    return;
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

  // Summary bar — duration + sets + muscle hint + per-muscle weekly meter
  $('builder-summary-bar').innerHTML = _renderBuilderSummary(mainLift);

  let html = '';

  // Coaching context — computed once per render and shared across all slots
  // so the fatigue/weekly/recency lookups don't run N times.
  const ctx = {
    fatigueByMuscle: calcFatigueByMuscle() || {},
    weeklyVolume: analyzeWeeklyVolume() || {},
    daysSince: _buildDaysSinceMap(),
  };

  // --- Exercise slot list ---
  store.builderExercises.forEach((ex, i) => {
    // Superset grouping — open/close a wrapper container around grouped rows.
    const prevEx = i > 0 ? store.builderExercises[i - 1] : null;
    const nextEx = i < store.builderExercises.length - 1 ? store.builderExercises[i + 1] : null;
    const inGroup = !!ex.groupId && ex.type !== 'main';
    const isGroupStart = inGroup && (!prevEx || prevEx.groupId !== ex.groupId);
    const isGroupEnd   = inGroup && (!nextEx || nextEx.groupId !== ex.groupId);

    if (isGroupStart) {
      // Left-gutter bracket — one badge per group, tap to unlink. The
      // per-row SS button is suppressed inside the group (handled in _slotRowHTML).
      html += `<div class="superset-group">
        <button class="superset-gutter" data-unlink-group="${ex.groupId}" title="Unlink superset">
          <span class="superset-badge">SS</span>
          <span class="superset-unlink">&times;</span>
        </button>
        <div class="superset-rows">`;
    }

    html += _slotRowHTML(ex, i, ctx);

    if (isGroupEnd) html += `</div></div>`;
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

  // --- Coverage gaps (directive) ---
  // Only render rows that imply an action: under-trained muscles or push/pull
  // imbalance. Each row is itself the tap target — no separate "+ Add" button
  // hanging at the end. Hide the panel entirely when nothing's actionable.
  html += _renderGapPanelHTML(mainLift);

  // --- Exercise browser ---
  html += `<div class="exercise-browser" id="builder-browser" hidden>`;
  html += `<div class="exercise-browser-header">
    <input type="text" class="exercise-browser-search" id="builder-search" placeholder="Search exercises...">
  </div>`;
  html += `<div class="browser-tabs">
    <button class="browser-tab active" data-browser-tab="recommended">Recommended</button>
    <button class="browser-tab" data-browser-tab="all">All Exercises</button>
  </div>`;
  html += _renderRecentsStrip();
  html += _renderFilterChips();
  html += `<div class="exercise-browser-list" id="builder-exercise-list">`;
  html += renderRecommendedBrowser(mainLift);
  html += `</div>`;

  // Custom exercise form
  html += `<div class="custom-exercise-form" id="builder-custom-form" hidden>
    <div class="section-label section-label--tight">Custom Exercise</div>
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
      <button class="btn-primary custom-ex-add-btn" id="custom-ex-add">Add</button>
    </div>
  </div>`;
  html += `<button class="btn-dashed builder-toggle-custom" id="builder-toggle-custom">+ Add Custom Exercise</button>`;
  html += `</div>`; // end exercise-browser

  body.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Exercise browser renderers
// ---------------------------------------------------------------------------

function renderRecommendedBrowser(mainLift) {
  const addedIds = new Set(store.builderExercises.filter(e => e.type !== 'main').map(e => resolveCanonicalId(e.exerciseId)));
  const scored = scoreAccessories(mainLift).filter(ex => !addedIds.has(ex.canonicalId || ex.id));

  // Apply filters (muscle, pattern, equipment, never-tried, search).
  const filtered = scored
    .filter(ex => (ex.supportsLifts || []).includes(mainLift))
    .filter(ex => _exercisePassesFilters(ex))
    .slice(0, 15);

  if (filtered.length === 0) {
    return '<div class="builder-empty-state">All recommended exercises added</div>';
  }

  return _renderBrowserGroups(filtered, addedIds);
}

function renderAllBrowser(mainLift, query) {
  const addedIds = new Set(store.builderExercises.filter(e => e.type !== 'main').map(e => resolveCanonicalId(e.exerciseId)));
  const items = [];
  for (const [id, ex] of Object.entries(EXERCISE_CATALOG)) {
    const candidate = { id, ...ex };
    if (query && !ex.name.toLowerCase().includes(query.toLowerCase())) continue;
    if (!_exercisePassesFilters(candidate)) continue;
    items.push(candidate);
  }
  if (items.length === 0) return '<div class="builder-empty-state">No exercises found</div>';
  return _renderBrowserGroups(items, addedIds);
}

/** Group filtered exercises by movement pattern + render rows. */
function _renderBrowserGroups(items, addedIds) {
  const equip = store.equipmentProfile || {};
  const groups = {};
  for (const ex of items) {
    const pattern = ex.movementPattern || 'other';
    if (!groups[pattern]) groups[pattern] = [];
    groups[pattern].push(ex);
  }
  let html = '';
  for (const [pattern, exercises] of Object.entries(groups)) {
    const patternInfo = MOVEMENT_PATTERNS[pattern] || { label: pattern, pushPull: 'neutral' };
    html += `<div class="pattern-group-header">${patternInfo.label}
      <button class="pattern-badge ${patternInfo.pushPull}" data-filter-pattern="${pattern}" title="Filter to ${patternInfo.label}">${patternInfo.pushPull}</button>
    </div>`;
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
  return html;
}

function renderMusclePills(ex) {
  const muscles = ex.primaryMuscles || {};
  return Object.entries(muscles)
    .filter(([, w]) => w >= 0.20)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([mg]) => `<button class="muscle-pill" data-filter-muscle="${mg}" title="Filter to ${mg}">${mg}</button>`)
    .join('');
}

/** Whether an exercise passes the active browser filter chip state. */
function _exercisePassesFilters(ex) {
  const f = _browserFilters;
  if (f.muscle) {
    const muscles = ex.primaryMuscles || {};
    const w = muscles[f.muscle] || 0;
    if (w < 0.20) return false;
  }
  if (f.pattern && (ex.movementPattern || 'other') !== f.pattern) return false;
  if (f.equipmentOnly) {
    const available = (store.equipmentProfile || {})[ex.equipment] !== false;
    if (!available) return false;
  }
  if (f.neverTried) {
    const id = ex.canonicalId || ex.id;
    const tried = store.accessoryLog.some(l => resolveCanonicalId(l.exerciseId) === id);
    if (tried) return false;
  }
  if (f.search) {
    const q = f.search.toLowerCase();
    if (!ex.name.toLowerCase().includes(q)) return false;
  }
  return true;
}

/** Recents row above the list — last 8 added accessories. */
function _renderRecentsStrip() {
  if (_recentExerciseIds.length === 0) return '';
  // Newest-first order.
  const ids = [..._recentExerciseIds].reverse();
  let chips = '';
  for (const id of ids) {
    const ex = EXERCISE_CATALOG[id];
    if (!ex) continue;
    chips += `<button class="browser-recent-chip" data-recent-id="${id}" title="Add ${escapeHTML(ex.name)}">${escapeHTML(ex.name)}</button>`;
  }
  if (!chips) return '';
  return `<div class="browser-recents">
    <span class="browser-recents-label">Recent</span>
    <div class="browser-recents-list">${chips}</div>
  </div>`;
}

/** Filter chip row above the list. */
function _renderFilterChips() {
  const f = _browserFilters;
  const active = (cond) => cond ? ' active' : '';
  return `<div class="browser-filters">
    <button class="filter-chip${active(f.equipmentOnly)}" data-filter-toggle="equipmentOnly">My Equipment</button>
    <button class="filter-chip${active(f.neverTried)}" data-filter-toggle="neverTried">Never Tried</button>
    ${f.muscle ? `<button class="filter-chip active" data-filter-clear="muscle">Muscle: ${f.muscle} &times;</button>` : ''}
    ${f.pattern ? `<button class="filter-chip active" data-filter-clear="pattern">Pattern: ${(MOVEMENT_PATTERNS[f.pattern]||{label:f.pattern}).label} &times;</button>` : ''}
  </div>`;
}

/** Re-render only the browser sub-tree (recents + filters + list). */
function _refreshBrowserList() {
  const browser = $('builder-browser');
  if (!browser || browser.hidden) return;
  // Recents strip + filter chips live as siblings before the list.
  const recents = browser.querySelector('.browser-recents');
  const filters = browser.querySelector('.browser-filters');
  const newRecents = _renderRecentsStrip();
  const newFilters = _renderFilterChips();
  if (recents) recents.outerHTML = newRecents || '';
  else if (newRecents) browser.querySelector('.browser-tabs').insertAdjacentHTML('afterend', newRecents);
  if (filters) filters.outerHTML = newFilters;
  else browser.querySelector('.browser-tabs').insertAdjacentHTML('afterend', newFilters);
  // List body
  const activeTab = browser.querySelector('.browser-tab.active');
  const tab = activeTab ? activeTab.dataset.browserTab : 'recommended';
  const list = $('builder-exercise-list');
  if (!list) return;
  list.innerHTML = tab === 'all'
    ? renderAllBrowser(_builderMainLift, _browserFilters.search)
    : renderRecommendedBrowser(_builderMainLift);
}

/** Track that an accessory was added — feeds the recents strip. */
function _trackRecent(exId) {
  const id = resolveCanonicalId(exId);
  if (!EXERCISE_CATALOG[id]) return; // skip custom exercises
  _recentExerciseIds = _recentExerciseIds.filter(x => x !== id);
  _recentExerciseIds.push(id);
  if (_recentExerciseIds.length > _RECENT_LIMIT) {
    _recentExerciseIds = _recentExerciseIds.slice(-_RECENT_LIMIT);
  }
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

  // Comparison context — computed once, passed to each candidate row.
  const ctx = {
    current: exercise,
    currentPattern: pattern,
    fatigueByMuscle: calcFatigueByMuscle() || {},
    daysSince: _buildDaysSinceMap(),
  };

  let html = '';
  if (samePattern.length > 0) {
    html += `<div class="swap-section-label">Same Movement Pattern</div>`;
    for (const ex of samePattern) {
      const available = equip[ex.equipment] !== false;
      html += renderSwapItem(ex, slotIdx, available, ctx);
    }
  }
  if (gapBased.length > 0) {
    html += `<div class="swap-section-label">Addresses Training Gaps</div>`;
    for (const ex of gapBased) {
      const available = equip[ex.equipment] !== false;
      html += renderSwapItem(ex, slotIdx, available, ctx);
    }
  }
  if (samePattern.length === 0 && gapBased.length === 0) {
    html = '<div class="builder-empty-state">No alternatives available</div>';
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

function renderSwapItem(ex, slotIdx, available, ctx) {
  const reason = ex.reasons && ex.reasons.length > 0 ? ex.reasons[0] : '';

  // "vs current" deltas — computed only when ctx is provided.
  let deltas = '';
  if (ctx) {
    const chips = [];
    // Pattern delta: same / different label
    const patternInfo = MOVEMENT_PATTERNS[ex.movementPattern];
    if (patternInfo) {
      const sameP = ex.movementPattern === ctx.currentPattern;
      chips.push(`<span class="delta-chip pattern${sameP ? ' same' : ' different'}">${patternInfo.label}</span>`);
    }
    // Recency: days since last logged set
    const canonId = ex.canonicalId || ex.id;
    const days = ctx.daysSince[canonId];
    if (days === undefined) {
      chips.push(`<span class="delta-chip recency">Never tried</span>`);
    } else if (days === 0) {
      chips.push(`<span class="delta-chip recency hot">Today</span>`);
    } else if (days <= 3) {
      chips.push(`<span class="delta-chip recency hot">${days}d ago</span>`);
    } else {
      chips.push(`<span class="delta-chip recency">${days}d ago</span>`);
    }
    // Fatigue dot — only if candidate's primary muscle is red/orange
    const muscle = _primaryMuscleFor({ exerciseId: ex.id, type: 'accessory' });
    const f = muscle && ctx.fatigueByMuscle[muscle];
    if (f && (f.status === 'red' || f.status === 'orange')) {
      chips.push(`<span class="delta-chip fatigue" data-status="${f.status}" title="${muscle} ${f.status}">${muscle} ${f.status}</span>`);
    }
    deltas = `<div class="swap-item-deltas">${chips.join('')}</div>`;
  }

  return `<div class="swap-item${!available ? ' unavailable' : ''}" data-exid="${ex.id}" data-slot="${slotIdx}">
    <div class="swap-item-info">
      <div class="swap-item-name">${ex.name}</div>
      <div class="swap-item-meta">${ex.sets || 3}x${Array.isArray(ex.repRange) ? ex.repRange.join('-') : '8-12'}</div>
      ${deltas}
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
  _trackRecent(exId);
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

  // Open the template-save sheet; `_openTemplateSaveSheet` calls back with
  // a single { name, notes, tags } object once the user taps Save.
  _openTemplateSaveSheet({
    existing,
    onSave: ({ name, notes, tags }) => {
      const gapReport = getGapReport(mainLift);
      const pushPull = analyzePushPullRatio();
      const exercises = store.builderExercises.map(e => ({ ...e }));
      const metadata = {
        gapCount: gapReport.length,
        pushPullRatio: pushPull.ratio,
        slotRoles: store.builderExercises.map(e => e.slotRole || 'accessory'),
      };

      if (existing) {
        existing.name = name;
        existing.notes = notes;
        existing.tags = tags;
        existing.exercises = exercises;
        existing.metadata = metadata;
        existing.lastUsed = Date.now();
        $('builder-save-template')._templateId = null;
        _builderDirty = false;
        localStorage.removeItem('sbd-builder-draft');
        store.saveCustomTemplates();
        showToast('Template updated: ' + name);
      } else {
        const template = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name,
          notes,
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
        showToast('Template saved: ' + name);
      }
    },
  });
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
      _deps.closeChoiceSheet?.();
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
      _deps.closeChoiceSheet?.();
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

let _deps = {};

export function setBuilderDeps(deps) { Object.assign(_deps, deps); }

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

    // Remove buttons — capture snapshot for undo before splicing.
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.remove);
      const removed = store.builderExercises[idx];
      if (!removed) return;
      // Snapshot is a shallow clone — sufficient for slot data which has no nested refs.
      const snapshot = { idx, ex: { ...removed } };
      store.builderExercises.splice(idx, 1);
      _markDirty();
      renderBuilder(mainLift);
      showToast(`Removed: ${removed.name}`, {
        action: 'Undo',
        duration: 5000,
        onAction: () => {
          // Restore at original index, clamping to current array bounds.
          const restoreAt = Math.min(snapshot.idx, store.builderExercises.length);
          store.builderExercises.splice(restoreAt, 0, snapshot.ex);
          _markDirty();
          renderBuilder(_builderMainLift);
        },
      });
      return;
    }

    // "Why this exercise?" info dot — toggle the inline reason list.
    const whyBtn = e.target.closest('[data-why]');
    if (whyBtn) {
      const idx = parseInt(whyBtn.dataset.why);
      if (_openWhyIdx.has(idx)) _openWhyIdx.delete(idx);
      else _openWhyIdx.add(idx);
      renderBuilder(mainLift);
      return;
    }

    // Fatigue dot — surface the muscle + status as a toast.
    const fatigueDot = e.target.closest('.slot-fatigue-dot');
    if (fatigueDot) {
      const m = fatigueDot.dataset.muscle;
      const s = fatigueDot.dataset.status;
      showToast(`${m}: ${s} fatigue`);
      return;
    }

    // Add exercise button — show browser
    if (e.target.closest('#builder-add-exercise')) {
      const browser = $('builder-browser');
      browser.hidden = !browser.hidden;
      return;
    }

    // Browser tab switching
    const tabBtn = e.target.closest('[data-browser-tab]');
    if (tabBtn) {
      body.querySelectorAll('.browser-tab').forEach(t => t.classList.remove('active'));
      tabBtn.classList.add('active');
      _refreshBrowserList();
      return;
    }

    // Filter chip toggles (My Equipment / Never Tried)
    const filterToggle = e.target.closest('[data-filter-toggle]');
    if (filterToggle) {
      const key = filterToggle.dataset.filterToggle;
      _browserFilters[key] = !_browserFilters[key];
      _refreshBrowserList();
      return;
    }

    // Filter chip clear (active Muscle: / Pattern: chips)
    const filterClear = e.target.closest('[data-filter-clear]');
    if (filterClear) {
      const key = filterClear.dataset.filterClear;
      _browserFilters[key] = null;
      _refreshBrowserList();
      return;
    }

    // Muscle pill in a list item → set muscle filter
    const musclePill = e.target.closest('[data-filter-muscle]');
    if (musclePill) {
      _browserFilters.muscle = musclePill.dataset.filterMuscle;
      _refreshBrowserList();
      return;
    }

    // Pattern badge in a group header → set pattern filter
    const patternBadge = e.target.closest('[data-filter-pattern]');
    if (patternBadge) {
      _browserFilters.pattern = patternBadge.dataset.filterPattern;
      _refreshBrowserList();
      return;
    }

    // Recents chip → add directly
    const recent = e.target.closest('[data-recent-id]');
    if (recent) {
      addExerciseFromCatalog(recent.dataset.recentId);
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

    // Gap panel add pull (push-heavy)
    if (e.target.closest('[data-gap-add-pull]')) {
      const pullEx = Object.entries(EXERCISE_CATALOG).find(([, ex]) => {
        const p = MOVEMENT_PATTERNS[ex.movementPattern];
        return p && p.pushPull === 'pull' && ex.supportsLifts.includes(mainLift) && (store.equipmentProfile || {})[ex.equipment] !== false;
      });
      if (pullEx) addExerciseFromCatalog(pullEx[0]);
      return;
    }

    // Gap panel add push (pull-heavy)
    if (e.target.closest('[data-gap-add-push]')) {
      const pushEx = Object.entries(EXERCISE_CATALOG).find(([, ex]) => {
        const p = MOVEMENT_PATTERNS[ex.movementPattern];
        return p && p.pushPull === 'push' && ex.supportsLifts.includes(mainLift) && (store.equipmentProfile || {})[ex.equipment] !== false;
      });
      if (pushEx) addExerciseFromCatalog(pushEx[0]);
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
      form.hidden = !form.hidden;
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
      $('builder-custom-form').hidden = true;
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
    // Live-update the rich summary as sets/reps change.
    if (_builderMainLift) {
      $('builder-summary-bar').innerHTML = _renderBuilderSummary(_builderMainLift);
    }
  });

  // Delegated search input — debounced 200ms so we don't re-render on every keystroke.
  body.addEventListener('input', (e) => {
    if (e.target.id !== 'builder-search') return;
    const value = e.target.value;
    clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(() => {
      _browserFilters.search = value;
      _refreshBrowserList();
    }, 200);
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
    _deps.renderWorkoutView?.();
  });

  // Builder save template button
  $('builder-save-template')?.addEventListener('click', () => {
    if (!_builderMainLift) return;
    saveAsTemplate(_builderMainLift);
  });

  // Footer discard (replaces the X-in-header for explicit "throw it away").
  $('builder-discard')?.addEventListener('click', () => closeBuilder(false));

  // Wire up the new sheets — backdrops dismiss, buttons resolve callbacks.
  _initBuilderSheets();
}

// ---------------------------------------------------------------------------
// Sheet primitives — replaces native confirm() / prompt() with consistent
// bottom-sheet UI matching the rest of the app.
// ---------------------------------------------------------------------------

let _draftCallback = null;       // { onRecover, onDiscard }
let _discardCallback = null;     // { onConfirm }
let _templateCallback = null;    // { onSave, existing }
let _templateActiveTags = new Set();

function _showSheet(panelId, backdropId) {
  $(backdropId).style.display = 'block';
  $(panelId).style.display = 'block';
  document.body.style.overflow = 'hidden';
}
function _hideSheet(panelId, backdropId) {
  $(backdropId).style.display = 'none';
  $(panelId).style.display = 'none';
  // Don't unlock body scroll — the parent overlay still wants it locked.
}

function _openDraftRecoverySheet({ onRecover, onDiscard }) {
  _draftCallback = { onRecover, onDiscard };
  _showSheet('builder-draft-sheet', 'builder-draft-sheet-backdrop');
}
function _closeDraftSheet(action) {
  const cb = _draftCallback;
  _draftCallback = null;
  _hideSheet('builder-draft-sheet', 'builder-draft-sheet-backdrop');
  if (cb && action === 'recover') cb.onRecover?.();
  if (cb && action === 'discard') cb.onDiscard?.();
}

function _openDiscardSheet({ onConfirm }) {
  _discardCallback = { onConfirm };
  _showSheet('builder-discard-sheet', 'builder-discard-sheet-backdrop');
}
function _closeDiscardSheet(action) {
  const cb = _discardCallback;
  _discardCallback = null;
  _hideSheet('builder-discard-sheet', 'builder-discard-sheet-backdrop');
  if (cb && action === 'confirm') cb.onConfirm?.();
}

function _openTemplateSaveSheet({ existing, onSave }) {
  _templateCallback = { onSave, existing };
  $('builder-template-sheet-title').textContent = existing ? 'Edit Template' : 'Save as Template';
  $('builder-template-name').value = existing ? existing.name : '';
  $('builder-template-notes').value = existing ? (existing.notes || '') : '';
  $('builder-template-tag-extra').value = '';
  _templateActiveTags = new Set(existing ? (existing.tags || []) : []);
  _refreshTemplateTagChips();
  _showSheet('builder-template-sheet', 'builder-template-sheet-backdrop');
  setTimeout(() => $('builder-template-name').focus(), 50);
}
function _closeTemplateSheet(action) {
  const cb = _templateCallback;
  _templateCallback = null;
  _hideSheet('builder-template-sheet', 'builder-template-sheet-backdrop');
  if (cb && action === 'save') {
    const name = ($('builder-template-name').value || '').trim();
    if (!name) { showToast('Template needs a name'); return; }
    const notes = ($('builder-template-notes').value || '').trim();
    const tags = Array.from(_templateActiveTags);
    cb.onSave?.({ name, notes, tags });
  }
}

function _refreshTemplateTagChips() {
  const container = $('builder-template-tags');
  if (!container) return;
  // Reset preset chips to reflect current active set
  container.querySelectorAll('.template-tag-chip[data-tag]').forEach(chip => {
    chip.classList.toggle('active', _templateActiveTags.has(chip.dataset.tag));
  });
  // Render any custom tags (not in the preset list) as chips with .custom
  container.querySelectorAll('.template-tag-chip.custom').forEach(c => c.remove());
  const presets = new Set(['Strength', 'Hypertrophy', 'Recovery', 'Volume', 'Competition']);
  for (const tag of _templateActiveTags) {
    if (presets.has(tag)) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'template-tag-chip custom active';
    chip.dataset.customTag = tag;
    chip.textContent = tag;
    container.appendChild(chip);
  }
}

function _initBuilderSheets() {
  // Draft recovery
  $('builder-draft-recover')?.addEventListener('click', () => _closeDraftSheet('recover'));
  $('builder-draft-discard')?.addEventListener('click', () => _closeDraftSheet('discard'));
  $('builder-draft-sheet-backdrop')?.addEventListener('click', () => _closeDraftSheet('discard'));

  // Discard confirm
  $('builder-discard-confirm')?.addEventListener('click', () => _closeDiscardSheet('confirm'));
  $('builder-discard-cancel')?.addEventListener('click', () => _closeDiscardSheet('cancel'));
  $('builder-discard-sheet-backdrop')?.addEventListener('click', () => _closeDiscardSheet('cancel'));

  // Template save sheet
  $('builder-template-save')?.addEventListener('click', () => _closeTemplateSheet('save'));
  $('builder-template-cancel')?.addEventListener('click', () => _closeTemplateSheet('cancel'));
  $('builder-template-sheet-backdrop')?.addEventListener('click', () => _closeTemplateSheet('cancel'));

  // Tag chip clicks (preset + custom)
  $('builder-template-tags')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.template-tag-chip');
    if (!chip) return;
    const tag = chip.dataset.tag || chip.dataset.customTag;
    if (!tag) return;
    if (_templateActiveTags.has(tag)) _templateActiveTags.delete(tag);
    else _templateActiveTags.add(tag);
    _refreshTemplateTagChips();
  });

  // Custom-tag entry: Enter key adds, then clears the input
  $('builder-template-tag-extra')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v) return;
    _templateActiveTags.add(v);
    e.target.value = '';
    _refreshTemplateTagChips();
  });
}
