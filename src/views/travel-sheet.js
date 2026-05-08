/**
 * Travel workout wizard — single-sheet flow.
 *
 * Equipment tiles at the top, grouping cards below. Tap a grouping card
 * to preview the exercise list; tap "Start" inside to commit and open
 * the workout overlay.
 *
 * No "Continue" button — everything visible on one screen.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { openTravelSheet, closeTravelSheet } from '../ui/sheet.js';
import {
  TRAVEL_GROUPINGS,
  TRAVEL_DEFAULT_EQUIPMENT,
  EQUIPMENT_META,
  TRAVEL_BUILTIN_PRESETS,
} from '../constants/travel-config.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';
import { renderBodyMapCompact } from './body-map.js';
import { selectTravelWorkout } from '../systems/workout-builder.js';
import { EXERCISE_CATALOG } from '../data/exercise-catalog.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

const _deps = {};

export function setTravelSheetDeps(deps) {
  Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _equipment = null;
let _expandedGrouping = null;
let _previewCache = {};
let _fatigue = {};

// ---------------------------------------------------------------------------
// Freshness scoring
// ---------------------------------------------------------------------------

const STATUS_SCORE = { green: 4, lime: 3, yellow: 2, orange: 1, red: 0 };
const SCORE_TO_STATUS = ['red', 'orange', 'yellow', 'lime', 'green'];
const STATUS_BORDER_COLOR = {
  green: 'var(--green)',
  lime: '#7cb342',
  yellow: 'var(--yellow)',
  orange: 'var(--orange)',
  red: 'var(--red)',
};

function aggregateFreshness(muscles) {
  const scores = muscles.map((m) => STATUS_SCORE[_fatigue[m]?.displayStatus] ?? 4);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const idx = Math.min(Math.round(avg), 4);
  return { score: avg, status: SCORE_TO_STATUS[idx] };
}

// ---------------------------------------------------------------------------
// Exercise preview helpers
// ---------------------------------------------------------------------------

function getPreview(grouping) {
  if (!_previewCache[grouping]) {
    try {
      _previewCache[grouping] = selectTravelWorkout(grouping, _equipment);
    } catch {
      _previewCache[grouping] = [];
    }
  }
  return _previewCache[grouping];
}

function countAvailableExercises() {
  const disabled = new Set(store.disabledAccessories || []);
  return Object.values(EXERCISE_CATALOG).filter(
    (ex) => _equipment[ex.equipment] === true && !disabled.has(ex.id)
  ).length;
}

// ---------------------------------------------------------------------------
// Preset helpers
// ---------------------------------------------------------------------------

function allPresets() {
  return [...TRAVEL_BUILTIN_PRESETS, ...(store.travelPresets || [])];
}

function presetMatches(preset) {
  return Object.keys(TRAVEL_DEFAULT_EQUIPMENT).every((k) => preset.equipment[k] === _equipment[k]);
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderPresetRow() {
  const presets = allPresets();
  let html = `<div class="travel-preset-row">`;
  for (const p of presets) {
    const active = presetMatches(p) ? ' active' : '';
    const deletable = !p.builtin ? ` data-preset-delete="${p.id}" title="Hold to delete"` : '';
    html += `<button class="travel-preset-chip${active}" data-preset-id="${p.id}"${deletable}>${p.name}</button>`;
  }
  html += `<button class="travel-preset-chip travel-preset-chip--save" id="travel-save-preset">+ Save</button>`;
  html += `</div>`;
  return html;
}

function renderEquipmentRow() {
  let html = `<div class="travel-equip-row">`;
  for (const [key, meta] of Object.entries(EQUIPMENT_META)) {
    const on = _equipment[key] === true;
    html += `<button class="travel-equip-tile${on ? ' active' : ''}" data-equip="${key}" aria-pressed="${on}">
      <span class="travel-equip-icon">${meta.icon}</span>
      <span class="travel-equip-label">${meta.label}</span>
    </button>`;
  }
  html += `</div>`;
  return html;
}

function renderExerciseCount() {
  const n = countAvailableExercises();
  const minCount = Math.min(...Object.values(TRAVEL_GROUPINGS).map((g) => g.count));
  const low = n < minCount;
  return `<div class="travel-exercise-count${low ? ' travel-exercise-count--low' : ''}">${n} exercises available</div>`;
}

function renderGroupingList() {
  // Sort groupings by freshness descending (freshest first)
  const entries = Object.entries(TRAVEL_GROUPINGS).map(([key, cfg]) => {
    const { score, status } = aggregateFreshness(cfg.muscles);
    return { key, cfg, score, status };
  });
  entries.sort((a, b) => b.score - a.score);
  const topKey = entries[0]?.key;

  let html = `<div class="travel-grouping-list">`;
  for (const { key, cfg, status } of entries) {
    const isRecommended = key === topKey;
    const isExpanded = _expandedGrouping === key;
    const borderColor = STATUS_BORDER_COLOR[status] || 'var(--border)';

    const miniMap = renderBodyMapCompact(cfg.muscles, _fatigue);
    const muscleList = cfg.muscles.join(' · ');
    const duration = `~${cfg.count * 8} min · ${cfg.count} exercises`;

    html += `<div class="travel-group-card${isExpanded ? ' expanded' : ''}" data-grouping="${key}" style="border-left-color:${borderColor}">`;

    // Recommended badge
    if (isRecommended) {
      html += `<div class="travel-group-recommended">Recommended</div>`;
    }

    // Card header row
    html += `<div class="travel-group-header">`;
    html += `<div class="travel-bodymap-mini">${miniMap}</div>`;
    html += `<div class="travel-group-info">
      <div class="travel-group-name">${cfg.label}</div>
      <div class="travel-group-muscles">${muscleList}</div>
      <div class="travel-group-duration">${duration}</div>
    </div>`;
    html += `<div class="travel-group-chevron">›</div>`;
    html += `</div>`; // .travel-group-header

    // Expandable preview
    if (isExpanded) {
      const exercises = getPreview(key);
      html += `<div class="travel-group-preview">`;
      if (exercises.length === 0) {
        html += `<div class="travel-preview-empty">No exercises available with current equipment. Try adding more gear above.</div>`;
      } else {
        html += `<div class="travel-preview-list">`;
        for (const ex of exercises) {
          const sets = ex.targetSets;
          const [rLo, rHi] = ex.repRange || [8, 12];
          const repStr = rLo === rHi ? `${rLo}` : `${rLo}–${rHi}`;
          const downTag = ex._downweighted
            ? `<span class="travel-preview-tag travel-preview-tag--light">lighter</span>`
            : '';
          html += `<div class="travel-preview-row">
            <span class="travel-preview-name">${ex.name}</span>
            <span class="travel-preview-sets">${sets}×${repStr}${downTag}</span>
          </div>`;
        }
        html += `</div>`; // .travel-preview-list
        html += `<div class="travel-preview-actions">
          <button class="travel-start-btn" data-start="${key}">Start Workout</button>
          <button class="travel-shuffle-btn" data-shuffle="${key}">Shuffle</button>
        </div>`;
      }
      html += `</div>`; // .travel-group-preview
    }

    html += `</div>`; // .travel-group-card
  }
  html += `</div>`; // .travel-grouping-list
  return html;
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------

function render() {
  $('travel-sheet-body').innerHTML =
    renderPresetRow() + renderEquipmentRow() + renderExerciseCount() + renderGroupingList();
  attachHandlers();
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function attachHandlers() {
  const body = $('travel-sheet-body');

  // Preset chips
  body.querySelectorAll('.travel-preset-chip[data-preset-id]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.presetId;
      const preset = allPresets().find((p) => p.id === id);
      if (!preset) return;
      _equipment = { ...preset.equipment };
      _previewCache = {};
      persistEquipment();
      render();
    });

    // Long-press to delete user presets
    if (chip.dataset.presetDelete) {
      let pressTimer;
      chip.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => {
          const id = chip.dataset.presetDelete;
          if (confirm('Delete this preset?')) {
            store.travelPresets = (store.travelPresets || []).filter((p) => p.id !== id);
            store.saveTravelPresets();
            render();
          }
        }, 600);
      });
      chip.addEventListener('pointerup', () => clearTimeout(pressTimer));
      chip.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    }
  });

  // Save preset
  const saveBtn = $('travel-save-preset');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const name = prompt('Name this preset:');
      if (!name || !name.trim()) return;
      const newPreset = {
        id: crypto.randomUUID(),
        name: name.trim(),
        builtin: false,
        equipment: { ..._equipment },
      };
      store.travelPresets = [...(store.travelPresets || []), newPreset];
      store.saveTravelPresets();
      render();
    });
  }

  // Equipment tiles
  body.querySelectorAll('.travel-equip-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const k = tile.dataset.equip;
      _equipment[k] = !_equipment[k];
      _previewCache = {};
      persistEquipment();
      render();
    });
  });

  // Grouping cards — expand/collapse
  body.querySelectorAll('.travel-group-card').forEach((card) => {
    const header = card.querySelector('.travel-group-header');
    if (!header) return;
    header.addEventListener('click', () => {
      const key = card.dataset.grouping;
      _expandedGrouping = _expandedGrouping === key ? null : key;
      render();
    });
  });

  // Start workout
  body.querySelectorAll('[data-start]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const grouping = btn.dataset.start;
      closeTravelSheet();
      _deps.createTravelSession?.(grouping, _equipment);
      _deps.openTravelWorkoutView?.();
    });
  });

  // Shuffle exercises
  body.querySelectorAll('[data-shuffle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const grouping = btn.dataset.shuffle;
      delete _previewCache[grouping];
      render();
    });
  });
}

function persistEquipment() {
  store.travelEquipmentPreset = { ..._equipment };
  store.saveTravelEquipmentPreset();
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Open the travel workout wizard. Equipment tiles at top, grouping cards below.
 */
export function startTravelFlow() {
  _equipment = { ...(store.travelEquipmentPreset || TRAVEL_DEFAULT_EQUIPMENT) };
  _expandedGrouping = null;
  _previewCache = {};
  _fatigue = calcFatigueByMuscle() || {};
  openTravelSheet();
  render();
}
