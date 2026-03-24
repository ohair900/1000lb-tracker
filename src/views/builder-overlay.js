/**
 * Workout builder overlay — exercise browser, custom form,
 * template save/load, and session creation from builder state.
 */

import store from '../state/store.js';
import { $, escapeHTML } from '../utils/helpers.js';
import { LIFT_NAMES } from '../constants/lift-config.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import {
  computeSetWeights,
  getAccessoryWeight,
  checkAccessoryProgression,
} from '../systems/workout-builder.js';
import { getProgramWorkout, findFirstIncompleteWeek } from '../systems/programs.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _builderMainLift = null;

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

/**
 * Open the builder overlay, optionally preloaded with exercises.
 * @param {string} mainLift
 * @param {Object[]} [preloadExercises]
 */
export function openBuilder(mainLift, preloadExercises) {
  store.builderExercises = preloadExercises || [];
  // Always add main lift as first exercise if not present
  if (!store.builderExercises.some(e => e.type === 'main')) {
    store.builderExercises.unshift({
      type: 'main', exerciseId: mainLift, name: LIFT_NAMES[mainLift],
      sets: 5, reps: 5, weightMode: 'program', weightValue: 0,
      equipment: 'barbell', repRange: [1, 5], order: 0
    });
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
}

// ---------------------------------------------------------------------------
// Exercise browser list
// ---------------------------------------------------------------------------

function renderExerciseBrowserList(mainLift, query) {
  const addedIds = new Set(store.builderExercises.filter(e => e.type !== 'main').map(e => e.exerciseId));
  const allForLift = Object.entries(ACCESSORY_DB).filter(([, ex]) => ex.mainLift === mainLift);
  const filtered = query
    ? allForLift.filter(([, ex]) => ex.name.toLowerCase().includes(query.toLowerCase()) || ex.category.toLowerCase().includes(query.toLowerCase()))
    : allForLift;

  // Group by category
  const groups = {};
  filtered.forEach(([id, ex]) => {
    if (!groups[ex.category]) groups[ex.category] = [];
    groups[ex.category].push({ id, ...ex });
  });

  let html = '';
  Object.keys(groups).sort().forEach(cat => {
    html += `<div class="exercise-browser-cat">${cat.replace(/-/g, ' ')}</div>`;
    groups[cat].forEach(ex => {
      const added = addedIds.has(ex.id);
      html += `<div class="exercise-browser-item${added ? ' added' : ''}" data-exid="${ex.id}">
        <span class="exercise-browser-item-name">${ex.name}</span>
        <span class="exercise-browser-item-equip">${ex.equipment}</span>
      </div>`;
    });
  });
  return html || '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:var(--text-sm)">No exercises found</div>';
}

// ---------------------------------------------------------------------------
// Render builder body
// ---------------------------------------------------------------------------

/**
 * Render the builder exercise list + browser.
 * @param {string} mainLift
 */
export function renderBuilder(mainLift) {
  _builderMainLift = mainLift;
  const body = $('builder-body');
  let html = '';

  // Exercise list
  store.builderExercises.forEach((ex, i) => {
    const isMain = ex.type === 'main';
    html += `<div class="builder-exercise${isMain ? ` main-lift ${mainLift}` : ''}">
      <div class="builder-exercise-info">
        <div class="builder-exercise-name">${escapeHTML(ex.name)}</div>
        <div class="builder-exercise-meta">${ex.equipment}${!isMain ? ` &bull; ${ex.sets}x${Array.isArray(ex.repRange) ? ex.repRange.join('-') : ex.reps}` : ''}</div>
      </div>
      <div class="builder-exercise-controls">
        <input type="number" value="${ex.sets}" min="1" max="10" data-field="sets" data-idx="${i}" inputmode="numeric" title="Sets">
        <span style="color:var(--text-dim);font-size:0.7rem;align-self:center">x</span>
        <input type="number" value="${Array.isArray(ex.repRange) ? ex.repRange[1] : ex.reps}" min="1" max="30" data-field="reps" data-idx="${i}" inputmode="numeric" title="Reps">
      </div>
      ${!isMain ? `<div style="display:flex;flex-direction:column;gap:2px">
        <button class="builder-btn-sm" data-move="up" data-idx="${i}" title="Move up">&uarr;</button>
        <button class="builder-btn-sm" data-move="down" data-idx="${i}" title="Move down">&darr;</button>
      </div>
      <button class="builder-btn-sm danger" data-remove="${i}" title="Remove">&times;</button>` : ''}
    </div>`;
  });

  // Exercise browser
  html += `<div class="exercise-browser">
    <div class="exercise-browser-header">
      <input type="text" class="exercise-browser-search" id="builder-search" placeholder="Search exercises...">
    </div>
    <div class="exercise-browser-list" id="builder-exercise-list">`;
  html += renderExerciseBrowserList(mainLift, '');
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
      <button class="btn-primary" id="custom-ex-add" style="padding:8px 16px;font-size:var(--text-sm)">Add</button>
    </div>
  </div>`;

  html += `<button class="btn-dashed" id="builder-toggle-custom">+ Add Custom Exercise</button>`;
  html += `</div>`;

  body.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Convert builder to session
// ---------------------------------------------------------------------------

/**
 * Convert the current builder exercise list into a workout session object.
 * @param {string} mainLift
 * @returns {Object} Session object
 */
export function builderToSession(mainLift) {
  const now = new Date();
  const accessories = store.builderExercises.filter(e => e.type !== 'main').map(ex => {
    const dbEx = ACCESSORY_DB[ex.exerciseId];
    const weight = dbEx ? getAccessoryWeight(ex.exerciseId, mainLift) : 0;
    return {
      exerciseId: ex.exerciseId,
      name: ex.name,
      setWeights: computeSetWeights(weight, ex.sets),
      targetSets: ex.sets,
      repRange: Array.isArray(ex.repRange) ? [...ex.repRange] : [ex.reps, ex.reps],
      equipment: ex.equipment,
      setsCompleted: [],
      progressed: dbEx ? checkAccessoryProgression(ex.exerciseId, mainLift) : false
    };
  });
  const session = {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    mainLift,
    programWeek: findFirstIncompleteWeek(mainLift),
    date: now.toISOString().split('T')[0],
    startTime: now.getTime(),
    mainSets: [],
    accessories,
    completed: false,
    source: 'custom'
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

/**
 * Save the current builder exercises as a named template.
 * @param {string} mainLift
 */
export function saveAsTemplate(mainLift) {
  const name = prompt('Template name:');
  if (!name) return;
  const template = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim(),
    mainLift,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    exercises: store.builderExercises.map(e => ({ ...e }))
  };
  store.customTemplates.push(template);
  store.saveCustomTemplates();
  showToast('Template saved: ' + name);
}

/**
 * Show the template list in the choice sheet body.
 */
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

  // Load template
  body.querySelectorAll('.template-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-template]') || e.target.closest('[data-del-template]') || e.target.closest('[data-dup-template]')) return;
      const tid = card.dataset.tid;
      const template = store.customTemplates.find(t => t.id === tid);
      if (!template) return;
      template.lastUsed = Date.now();
      store.saveCustomTemplates();
      _closeChoiceSheet();
      openBuilder(lift, (template.exercises || []).map(e => ({ ...e })));
    });
  });

  // Edit template
  body.querySelectorAll('[data-edit-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = btn.dataset.editTemplate;
      const template = store.customTemplates.find(t => t.id === tid);
      if (!template) return;
      _closeChoiceSheet();
      openBuilder(lift, (template.exercises || []).map(e => ({ ...e })));
      // Override save to update this template
      $('builder-save-template')._templateId = tid;
    });
  });

  // Duplicate template
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
      showTemplateList(); // Refresh
      showToast('Template duplicated');
    });
  });

  // Delete template
  body.querySelectorAll('[data-del-template]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tid = btn.dataset.delTemplate;
      const idx = store.customTemplates.findIndex(t => t.id === tid);
      if (idx === -1) return;
      const removed = store.customTemplates.splice(idx, 1)[0];
      store.saveCustomTemplates();
      showTemplateList(); // Refresh
      // Undo toast
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

/**
 * Attach event delegation for the builder overlay.
 * Call once after DOMContentLoaded.
 */
export function initBuilderOverlay() {
  const body = $('builder-body');

  body.addEventListener('click', (e) => {
    const mainLift = _builderMainLift;
    if (!mainLift) return;

    // Move buttons
    const moveBtn = e.target.closest('[data-move]');
    if (moveBtn) {
      const idx = parseInt(moveBtn.dataset.idx);
      const dir = moveBtn.dataset.move === 'up' ? -1 : 1;
      const newIdx = idx + dir;
      if (newIdx < 1 || newIdx >= store.builderExercises.length) return;
      [store.builderExercises[idx], store.builderExercises[newIdx]] = [store.builderExercises[newIdx], store.builderExercises[idx]];
      renderBuilder(mainLift);
      return;
    }

    // Remove buttons
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn) {
      store.builderExercises.splice(parseInt(removeBtn.dataset.remove), 1);
      renderBuilder(mainLift);
      return;
    }

    // Exercise browser items
    const browserItem = e.target.closest('.exercise-browser-item:not(.added)');
    if (browserItem) {
      const exId = browserItem.dataset.exid;
      const ex = ACCESSORY_DB[exId];
      if (!ex) return;
      store.builderExercises.push({
        type: 'accessory', exerciseId: exId, name: ex.name,
        sets: ex.sets, reps: ex.repRange[1], weightMode: 'auto', weightValue: 0,
        equipment: ex.equipment, repRange: [...ex.repRange], order: store.builderExercises.length
      });
      renderBuilder(mainLift);
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
      store.builderExercises.push({
        type: 'accessory', exerciseId: 'custom-' + Date.now(), name,
        sets, reps, weightMode: 'manual', weightValue: 0,
        equipment: equip, repRange: [reps, reps], order: store.builderExercises.length, custom: true
      });
      $('custom-ex-name').value = '';
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
  });

  // Delegated search input
  body.addEventListener('input', (e) => {
    if (e.target.id === 'builder-search') {
      $('builder-exercise-list').innerHTML = renderExerciseBrowserList(_builderMainLift, e.target.value);
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
    // renderWorkoutView will be called by the caller after import
  });

  // Builder save template button
  $('builder-save-template')?.addEventListener('click', () => {
    if (!_builderMainLift) return;
    saveAsTemplate(_builderMainLift);
  });
}
