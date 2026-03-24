/**
 * Cycle bar rendering and cycle creation modal.
 *
 * The cycle bar shows active training cycles as pills.
 * Clicking a pill toggles it as the active cycle for new entries.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { CYCLE_TYPES } from '../constants/lift-config.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Render cycle bar
// ---------------------------------------------------------------------------

/**
 * Render the cycle pill bar. Shows active/open cycles and an "add" button.
 */
export function renderCycleBar() {
  const bar = $('cycle-bar');
  if (store.cycles.length === 0 && !store.activeCycleId) {
    bar.innerHTML = '<button class="cycle-pill add" id="cycle-add">+ Cycle</button>';
  } else {
    let html = '';
    store.cycles.filter(c => c.active || !c.endDate).forEach(c => {
      html += `<button class="cycle-pill${c.id === store.activeCycleId ? ' active' : ''}" data-cycle="${c.id}">${c.name}</button>`;
    });
    html += '<button class="cycle-pill add" id="cycle-add">+</button>';
    bar.innerHTML = html;
  }
  bar.querySelectorAll('.cycle-pill[data-cycle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cycle;
      store.cycles.forEach(c => c.active = (c.id === id && !c.active));
      store.activeCycleId = (store.cycles.find(c => c.active) || {}).id || null;
      store.saveCycles();
      renderCycleBar();
    });
  });
  const addBtn = $('cycle-add');
  if (addBtn) addBtn.addEventListener('click', showCycleModal);
}

// ---------------------------------------------------------------------------
// Cycle creation modal
// ---------------------------------------------------------------------------

/**
 * Show the modal for creating a new training cycle.
 */
export function showCycleModal() {
  const body = $('edit-body');
  body.innerHTML = `
    <div class="input-group" style="margin-bottom:12px"><label>Cycle Name</label>
      <input type="text" id="cycle-name" class="notes-input" placeholder="e.g. Strength Block 1" style="display:block">
    </div>
    <div class="input-group" style="margin-bottom:12px"><label>Type</label>
      <select id="cycle-type" style="width:100%;padding:10px;border:2px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-size:0.9rem">
        ${CYCLE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
    </div>
    <button class="modal-save-btn" id="cycle-save">Create Cycle</button>`;
  $('edit-modal').querySelector('h3').textContent = 'New Training Cycle';
  openModal('edit-modal');
  $('cycle-save').addEventListener('click', () => {
    const name = $('cycle-name').value.trim();
    if (!name) return;
    store.cycles.forEach(c => c.active = false);
    const c = {
      id: Date.now().toString(36),
      name,
      type: $('cycle-type').value,
      startDate: new Date().toISOString().split('T')[0],
      endDate: null,
      active: true
    };
    store.cycles.push(c);
    store.activeCycleId = c.id;
    store.saveCycles();
    closeModal('edit-modal');
    renderCycleBar();
    showToast('Cycle started: ' + name);
  });
}
