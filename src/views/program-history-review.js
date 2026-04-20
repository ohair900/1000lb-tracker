/**
 * Program History Review overlay.
 *
 * Shows all completedSets keys with candidate entries so the user can
 * manually select the correct entry for each completed set, fixing the
 * issue where changing the training max rewrites past set weights.
 */

import store from '../state/store.js';
import { formatWeight, displayWeight } from '../formulas/units.js';
import { showToast } from '../ui/toast.js';
import { buildSetCandidates } from '../systems/program-migration.js';

// Selections made in the current review session: { [key]: { weight, reps, entryId, date } | 'skip' }
let _selections = {};
let _setData = [];

function _lift_color(lift) {
  return lift === 'squat' ? 'var(--squat)' : lift === 'bench' ? 'var(--bench)' : 'var(--deadlift)';
}

function _fmt_date(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _renderSetCard(item) {
  const { key, label, expectedWeight, pct, prescribedReps, isAmrap, existingData, candidates } = item;
  const current = _selections[key];
  const color = _lift_color(item.lift);

  const statusBadge = current === 'skip'
    ? `<span class="hr-badge hr-badge-skip">Skipped</span>`
    : current
      ? `<span class="hr-badge hr-badge-set">&#10003; Selected</span>`
      : existingData && !existingData.recovered
        ? `<span class="hr-badge hr-badge-set">&#10003; Already set</span>`
        : existingData && existingData.recovered
          ? `<span class="hr-badge hr-badge-auto">Auto-matched</span>`
          : `<span class="hr-badge hr-badge-pending">Needs review</span>`;

  const prescription = expectedWeight
    ? `${displayWeight(expectedWeight)} ${store.unit} &times; ${prescribedReps}${isAmrap ? ' AMRAP' : ''} &nbsp;<span style="color:var(--text-dim)">(${pct}%)</span>`
    : `&times; ${prescribedReps}${isAmrap ? ' AMRAP' : ''} &nbsp;<span style="color:var(--text-dim)">(${pct}%)</span>`;

  const currentFrozen = current && current !== 'skip' && current !== '__manual__'
    ? current
    : (!current && existingData) ? existingData : null;

  const frozenLine = currentFrozen
    ? `<div class="hr-frozen">Currently: <strong>${displayWeight(currentFrozen.weight)} ${store.unit} &times; ${currentFrozen.reps} reps</strong>${currentFrozen.date ? ` &mdash; ${_fmt_date(currentFrozen.date)}` : ''}</div>`
    : '';

  const candidateRows = candidates.length > 0
    ? candidates.map(c => {
      const isSelected = current && current !== 'skip' && current.entryId === c.id;
      return `<div class="hr-candidate${isSelected ? ' selected' : ''}" data-key="${key}" data-entry-id="${c.id}">
        <div class="hr-cand-check">${isSelected ? '&#9679;' : '&#9675;'}</div>
        <div class="hr-cand-info">
          <span class="hr-cand-date">${_fmt_date(c.date)}</span>
          <span class="hr-cand-weight">${displayWeight(c.weight)} ${store.unit}</span>
          <span class="hr-cand-reps">&times; ${c.reps}</span>
          ${c.rpe ? `<span class="hr-cand-rpe">RPE ${c.rpe}</span>` : ''}
          ${c.e1rm ? `<span class="hr-cand-e1rm">${displayWeight(c.e1rm)} e1RM</span>` : ''}
        </div>
      </div>`;
    }).join('')
    : `<div class="hr-no-candidates">No entries within &plusmn;20 lbs of prescription</div>`;

  const skipSelected = current === 'skip';

  return `<div class="hr-set-card" data-key="${key}">
    <div class="hr-set-header" style="border-left:3px solid ${color}">
      <div class="hr-set-title">${label}</div>
      ${statusBadge}
    </div>
    <div class="hr-set-prescription">${prescription}</div>
    ${frozenLine}
    <div class="hr-candidates">
      ${candidateRows}
      <div class="hr-candidate hr-candidate-manual${current === '__manual__' ? ' selected' : ''}" data-key="${key}" data-entry-id="__manual__">
        <div class="hr-cand-check">${current === '__manual__' ? '&#9679;' : '&#9675;'}</div>
        <div class="hr-cand-info">
          <span class="hr-cand-date" style="color:var(--text-dim)">Manual entry</span>
          <input type="number" class="hr-manual-weight" data-key="${key}" placeholder="lbs" min="1" inputmode="decimal" style="width:64px;${current === '__manual__' ? '' : 'display:none'}">
          <span style="${current === '__manual__' ? '' : 'display:none'}"> &times; </span>
          <input type="number" class="hr-manual-reps" data-key="${key}" placeholder="reps" min="1" inputmode="numeric" style="width:48px;${current === '__manual__' ? '' : 'display:none'}">
        </div>
      </div>
      <div class="hr-candidate hr-skip${skipSelected ? ' selected' : ''}" data-key="${key}" data-entry-id="__skip__">
        <div class="hr-cand-check">${skipSelected ? '&#9679;' : '&#9675;'}</div>
        <div class="hr-cand-info"><span style="color:var(--text-dim)">Skip — leave as recomputed from current TM</span></div>
      </div>
    </div>
  </div>`;
}

function _countPending() {
  return _setData.filter(item => {
    const sel = _selections[item.key];
    if (sel) return false;
    if (item.existingData && !item.existingData.recovered) return false;
    return true;
  }).length;
}

function _renderOverlay() {
  const overlay = document.getElementById('history-review-overlay');
  if (!overlay) return;

  const total = _setData.length;
  const pending = _countPending();
  const selectedCount = Object.values(_selections).filter(v => v && v !== 'skip').length;

  const summary = total === 0
    ? `<div class="hr-summary">No completed program sets found.</div>`
    : `<div class="hr-summary">${total} completed set${total !== 1 ? 's' : ''} &mdash; <strong>${pending}</strong> need${pending !== 1 ? '' : 's'} review</div>`;

  const cards = _setData.length > 0
    ? _setData.map(_renderSetCard).join('')
    : `<div class="hr-empty">No completed program sets to review.</div>`;

  const applyCount = Object.values(_selections).filter(v => v && v !== 'skip').length;
  const applyLabel = applyCount > 0 ? `Apply ${applyCount} Selection${applyCount !== 1 ? 's' : ''}` : 'Apply Selections';

  overlay.innerHTML = `
    <div class="hr-overlay-header">
      <button class="hr-close" id="hr-close-btn">&#8592; Back</button>
      <span class="hr-overlay-title">Program History Review</span>
    </div>
    <div class="hr-overlay-body" id="hr-body">
      <div class="hr-intro">Match each completed set to the entry you actually logged. Tap a row to select it. Changes only apply when you tap Apply.</div>
      ${summary}
      <div class="hr-cards">${cards}</div>
    </div>
    <div class="hr-overlay-footer">
      <button class="hr-apply-btn" id="hr-apply-btn">${applyLabel}</button>
    </div>
  `;

  overlay.querySelectorAll('.hr-skip .hr-cand-info span').forEach(el => {
    el.textContent = 'Skip for now';
  });
  _attachEvents(overlay);
}

function _attachEvents(overlay) {
  overlay.querySelector('#hr-close-btn').addEventListener('click', closeHistoryReview);
  overlay.querySelector('#hr-apply-btn').addEventListener('click', _applySelections);

  // Candidate row clicks
  overlay.addEventListener('click', e => {
    const cand = e.target.closest('.hr-candidate');
    if (!cand) return;
    const key = cand.dataset.key;
    const entryId = cand.dataset.entryId;
    if (!key) return;

    if (entryId === '__skip__') {
      _selections[key] = 'skip';
      _patchCard(overlay, key);
      return;
    }

    if (entryId === '__manual__') {
      _selections[key] = '__manual__';
      _patchCard(overlay, key);
      // Show inputs
      const card = overlay.querySelector(`.hr-set-card[data-key="${key}"]`);
      if (card) {
        card.querySelectorAll('.hr-manual-weight, .hr-manual-reps, .hr-manual-weight + span').forEach(el => {
          el.style.display = '';
        });
        card.querySelector('.hr-manual-weight')?.focus();
      }
      return;
    }

    // Entry selection
    const item = _setData.find(i => i.key === key);
    if (!item) return;
    const entry = item.candidates.find(c => c.id === entryId);
    if (!entry) return;

    _selections[key] = {
      weight: entry.weight,
      reps: entry.reps,
      tm: item.expectedTM,
      date: entry.date,
      entryId: entry.id,
    };
    _patchCard(overlay, key);
  });
}

function _patchCard(overlay, key) {
  // Re-render just the changed card in place
  const card = overlay.querySelector(`.hr-set-card[data-key="${key}"]`);
  if (!card) return;
  const item = _setData.find(i => i.key === key);
  if (!item) return;
  const newCard = document.createElement('div');
  newCard.innerHTML = _renderSetCard(item);
  const newEl = newCard.firstElementChild;
  card.replaceWith(newEl);

  // Update apply button count
  const applyBtn = overlay.querySelector('#hr-apply-btn');
  if (applyBtn) {
    const applyCount = Object.values(_selections).filter(v => v && v !== 'skip').length;
    applyBtn.textContent = applyCount > 0 ? `Apply ${applyCount} Selection${applyCount !== 1 ? 's' : ''}` : 'Apply Selections';
  }
}

function _applySelections() {
  const pc = store.programConfig;
  if (!pc.completedSetData) pc.completedSetData = {};

  let applied = 0;

  Object.entries(_selections).forEach(([key, sel]) => {
    if (!sel || sel === 'skip') return;
    if (sel === '__manual__') {
      // Read manual inputs from DOM
      const overlay = document.getElementById('history-review-overlay');
      if (!overlay) return;
      const wInput = overlay.querySelector(`.hr-manual-weight[data-key="${key}"]`);
      const rInput = overlay.querySelector(`.hr-manual-reps[data-key="${key}"]`);
      const w = parseFloat(wInput?.value);
      const r = parseInt(rInput?.value);
      if (!w || !r) return;
      const item = _setData.find(i => i.key === key);
      pc.completedSetData[key] = {
        weight: w,
        reps: r,
        tm: item?.expectedTM || 0,
        date: new Date().toISOString().split('T')[0],
        entryId: null,
      };
      applied++;
      return;
    }
    pc.completedSetData[key] = { ...sel };
    applied++;
  });

  pc.completedSetDataReviewDismissed = true;
  store.saveProgramConfig();

  showToast(`${applied} set${applied !== 1 ? 's' : ''} updated`);
  closeHistoryReview();
}

/**
 * Open the history review overlay.
 */
export function openHistoryReview() {
  _selections = {};
  _setData = buildSetCandidates();

  let overlay = document.getElementById('history-review-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'history-review-overlay';
    overlay.className = 'history-review-overlay';
    document.body.appendChild(overlay);
  }
  overlay.style.display = 'flex';
  _renderOverlay();
}

/**
 * Close the history review overlay.
 */
export function closeHistoryReview() {
  const overlay = document.getElementById('history-review-overlay');
  if (overlay) overlay.style.display = 'none';
}
