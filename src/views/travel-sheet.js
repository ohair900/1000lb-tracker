/**
 * Travel workout wizard — two-step sheet (equipment → grouping).
 *
 * Step 1: Choose which equipment is available this session (never persists
 *         to store.equipmentProfile — purely in-memory override).
 * Step 2: Choose a workout grouping (Push / Pull / Legs / Full Body) with
 *         per-muscle fatigue freshness chips so the user can see what's ready.
 *
 * On completion calls the injected deps.createTravelSession + openTravelWorkoutView.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { openTravelSheet, closeTravelSheet } from '../ui/sheet.js';
import {
  TRAVEL_GROUPINGS,
  TRAVEL_DEFAULT_EQUIPMENT,
  EQUIPMENT_LABELS,
} from '../constants/travel-config.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

const _deps = {};

export function setTravelSheetDeps(deps) {
  Object.assign(_deps, deps);
}

// ---------------------------------------------------------------------------
// Internal state for the current wizard flow
// ---------------------------------------------------------------------------

let _currentEquipment = null;

// ---------------------------------------------------------------------------
// Step 1: Equipment picker
// ---------------------------------------------------------------------------

function renderEquipmentStep() {
  const equipment = _currentEquipment || store.travelEquipmentPreset || { ...TRAVEL_DEFAULT_EQUIPMENT };
  _currentEquipment = { ...equipment };

  $('travel-sheet-title').textContent = 'Available Equipment';

  const body = $('travel-sheet-body');
  const keys = Object.keys(TRAVEL_DEFAULT_EQUIPMENT);

  let html = `<p class="travel-sheet-hint">What's available in this gym? Your global equipment settings are unchanged.</p>`;
  html += `<div class="travel-equip-toggles">`;
  for (const key of keys) {
    const on = _currentEquipment[key] !== false;
    html += `<button class="travel-equip-btn${on ? ' active' : ''}" data-equip="${key}">
      ${EQUIPMENT_LABELS[key] || key}
    </button>`;
  }
  html += `</div>`;
  html += `<button class="travel-continue-btn" id="travel-equip-continue">Continue &#8250;</button>`;

  body.innerHTML = html;

  // Toggle handlers
  body.querySelectorAll('.travel-equip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.equip;
      _currentEquipment[k] = !_currentEquipment[k];
      btn.classList.toggle('active', !!_currentEquipment[k]);
    });
  });

  $('travel-equip-continue').addEventListener('click', () => {
    store.travelEquipmentPreset = { ..._currentEquipment };
    store.saveTravelEquipmentPreset();
    renderGroupingStep();
  });
}

// ---------------------------------------------------------------------------
// Step 2: Grouping picker with fatigue chips
// ---------------------------------------------------------------------------

const STATUS_DOT_COLOR = {
  green: 'var(--green)',
  lime: '#a8e063',
  yellow: 'var(--yellow)',
  orange: 'var(--orange)',
  red: 'var(--red)',
};

function renderGroupingStep() {
  $('travel-sheet-title').textContent = 'Workout Type';

  const muscleFatigue = calcFatigueByMuscle() || {};
  const body = $('travel-sheet-body');

  let html = `<p class="travel-sheet-hint">Dots show muscle freshness. Red muscles will be skipped.</p>`;
  html += `<div class="travel-grouping-cards">`;

  for (const [key, cfg] of Object.entries(TRAVEL_GROUPINGS)) {
    const dots = cfg.muscles.map((m) => {
      const status = muscleFatigue[m]?.displayStatus || 'green';
      const color = STATUS_DOT_COLOR[status] || 'var(--green)';
      return `<span class="fatigue-dot" style="background:${color}" title="${m}: ${status}"></span>`;
    }).join('');

    html += `<div class="travel-group-card" data-grouping="${key}">
      <div class="travel-group-icon">${cfg.icon}</div>
      <div class="travel-group-info">
        <div class="travel-group-name">${cfg.label}</div>
        <div class="travel-group-muscles">${cfg.muscles.join(' · ')}</div>
      </div>
      <div class="travel-group-dots">${dots}</div>
    </div>`;
  }

  html += `</div>`;
  html += `<button class="travel-back-btn" id="travel-grouping-back">&#8249; Back</button>`;

  body.innerHTML = html;

  body.querySelectorAll('.travel-group-card').forEach((card) => {
    card.addEventListener('click', () => {
      const grouping = card.dataset.grouping;
      closeTravelSheet();
      _deps.createTravelSession?.(grouping, _currentEquipment);
      _deps.openTravelWorkoutView?.();
    });
  });

  $('travel-grouping-back').addEventListener('click', renderEquipmentStep);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Open the travel workout wizard at step 1 (equipment).
 */
export function startTravelFlow() {
  _currentEquipment = null;
  openTravelSheet();
  renderEquipmentStep();
}
