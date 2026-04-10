/**
 * History tab view — session-grouped history list, search/filter/sort,
 * infinite scroll, swipe-to-delete/edit, bulk select, edit modal,
 * sticky date separators, and delete confirmation.
 */

import store from '../state/store.js';
import { HISTORY_PAGE_SIZE } from '../constants/thresholds.js';
import { INFINITE_SCROLL_MARGIN_PX, LONG_PRESS_MS } from '../constants/ui.js';
import { $, escapeHTML, fmtNum, debounce } from '../utils/helpers.js';
import { LIFTS, COLORS, LIFT_SHORT, LIFT_NAMES } from '../constants/lift-config.js';
import { displayWeight, formatWeight, inputToLbs } from '../formulas/units.js';
import { groupSessions } from '../systems/volume.js';
import { deleteEntry, editEntry } from '../state/actions.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showToastWithUndo } from '../ui/toast.js';
import { MS_PER_DAY, SAME_SESSION_MS } from '../constants/time.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { resolveExercise } from '../data/exercise-compat.js';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const expandedSessions = new Set();
let _scrollObserver = null;
let _deps = {};
let selectionMode = false;
const selectedIds = new Set();

export function injectHistoryDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Bulk select helpers
// ---------------------------------------------------------------------------

function showBulkBar() {
  let bar = document.getElementById('bulk-action-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'bulk-action-bar';
    bar.className = 'bulk-action-bar';
    document.body.appendChild(bar);
  }
  updateBulkBar();
  bar.style.display = 'flex';
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-action-bar');
  if (!bar) return;
  const n = selectedIds.size;
  bar.innerHTML = `<span class="bulk-count">${n} selected</span>` +
    `<button class="bulk-delete-btn" id="bulk-delete"${n === 0 ? ' disabled' : ''}>Delete</button>` +
    `<button class="bulk-cancel-btn" id="bulk-cancel">Cancel</button>`;
}

function hideBulkBar() {
  const bar = document.getElementById('bulk-action-bar');
  if (bar) bar.style.display = 'none';
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  hideBulkBar();
  renderHistory();
}

// ---------------------------------------------------------------------------
// Render history list
// ---------------------------------------------------------------------------

export function renderHistory() {
  const container = $('history-list');
  let filtered = [...store.entries];
  if (store.historyFilter !== 'all') filtered = filtered.filter(e => e.lift === store.historyFilter);
  if (store.historyFrom) filtered = filtered.filter(e => e.date >= store.historyFrom);
  if (store.historyTo) filtered = filtered.filter(e => e.date <= store.historyTo);

  // Search filter
  if (store.historySearch) {
    const q = store.historySearch;
    const rangeMatch = q.match(/^(\d+)-(\d+)$/);
    const rpeMatch = q.match(/^rpe\s*(\d+\.?\d*)$/);
    filtered = filtered.filter(e => {
      if (rangeMatch) {
        const lo = parseFloat(rangeMatch[1]), hi = parseFloat(rangeMatch[2]);
        const w = displayWeight(e.weight);
        return w >= lo && w <= hi;
      }
      if (rpeMatch) return e.rpe !== null && e.rpe === parseFloat(rpeMatch[1]);
      const searchStr = `${LIFT_NAMES[e.lift]} ${e.lift} ${formatWeight(e.weight)} ${e.notes || ''} ${(e.tags || []).join(' ')}`.toLowerCase();
      return searchStr.includes(q);
    });
  }

  if (filtered.length === 0) {
    const hasFilters = store.historyFilter !== 'all' || store.historyFrom || store.historyTo || store.historySearch;
    container.innerHTML = '<div class="empty-state"><div class="icon">&#127947;&#65039;</div>No entries' +
      (hasFilters ? ' match filters.<button class="clear-filters-btn" id="clear-all-filters">Clear all filters</button>' : ' yet.<br>Log your first set!') + '</div>';
    if (hasFilters) {
      $('clear-all-filters').addEventListener('click', () => {
        store.historyFilter = 'all'; store.historySearch = ''; store.historyFrom = ''; store.historyTo = ''; store.historyPage = 1;
        $('history-search').value = '';
        $('filter-from').value = '';
        $('filter-to').value = '';
        $('history-filter-pills').querySelectorAll('.filter-pill').forEach(b => {
          b.classList.toggle('active', b.dataset.filter === 'all');
        });
        renderHistory();
      });
    }
    return;
  }

  // Precompute best e1RM per lift for strength indicator
  const bestE1rm = {};
  LIFTS.forEach(l => {
    const vals = store.entries.filter(e => e.lift === l).map(e => e.e1rm);
    bestE1rm[l] = vals.length > 0 ? Math.max(...vals) : 0;
  });

  // Session grouping + sorting
  const allSessions = groupSessions(filtered);

  // Attach accessory log entries to their sessions (within SAME_SESSION_MS of session timestamp)
  const accLog = store.accessoryLog || [];
  const remainingAcc = new Set(accLog.map(a => a.id));
  allSessions.forEach(session => {
    session.accessories = accLog.filter(a => {
      // Match by date first (fast), then by time proximity
      if (a.date !== session.date) return false;
      const timeDelta = Math.abs(a.timestamp - session.timestamp);
      if (timeDelta > SAME_SESSION_MS * 2) return false;
      // Filter by lift if history filter is set
      if (store.historyFilter !== 'all' && a.mainLift !== store.historyFilter) return false;
      return true;
    });
    session.accessories.forEach(a => remainingAcc.delete(a.id));
  });

  // Create accessory-only sessions for orphans (accessories logged without a main lift session)
  const orphanAcc = accLog.filter(a => remainingAcc.has(a.id));
  if (orphanAcc.length > 0 && store.historyFilter === 'all') {
    // Group orphans by date + time window
    const sortedOrphans = [...orphanAcc].sort((a, b) => b.timestamp - a.timestamp);
    let currentGroup = null;
    sortedOrphans.forEach(a => {
      if (!currentGroup || (currentGroup.accessories[currentGroup.accessories.length - 1].timestamp - a.timestamp) > SAME_SESSION_MS) {
        currentGroup = {
          entries: [],
          lifts: [],
          accessories: [a],
          date: a.date,
          timestamp: a.timestamp,
          volume: 0,
          sets: 0,
          _accessoryOnly: true,
        };
        allSessions.push(currentGroup);
      } else {
        currentGroup.accessories.push(a);
      }
    });
  }

  if (store.historySort === 'oldest') {
    allSessions.reverse();
  } else if (store.historySort === 'heaviest') {
    allSessions.sort((a, b) => {
      const aMax = Math.max(...a.entries.map(e => e.e1rm));
      const bMax = Math.max(...b.entries.map(e => e.e1rm));
      return bMax - aMax;
    });
  } else if (store.historySort === 'volume') {
    allSessions.sort((a, b) => b.volume - a.volume);
  }
  // 'newest' is the default from groupSessions

  const visibleCount = store.historyPage * HISTORY_PAGE_SIZE;
  const sessions = allSessions.slice(0, visibleCount);
  const hasMore = allSessions.length > visibleCount;
  const maxSessionVol = allSessions.length > 0 ? Math.max(...allSessions.map(s => s.volume)) : 1;
  const showDateSeps = store.historySort === 'newest' || store.historySort === 'oldest';

  let html = '';
  let lastDate = '';

  sessions.forEach((session, si) => {
    // Sticky date separator
    if (showDateSeps && session.date !== lastDate) {
      lastDate = session.date;
      const sepDate = new Date(session.date + 'T12:00:00');
      const sepLabel = sepDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      html += `<div class="date-separator">${sepLabel}</div>`;
    }

    const d = new Date(session.date + 'T12:00:00');
    const time = new Date(session.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const liftTags = session.lifts.map(l => `<span class="session-tag ${l}">${LIFT_SHORT[l]}</span>`).join('');
    const volStr = fmtNum(displayWeight(session.volume)) + ' ' + store.unit;
    const isExpanded = expandedSessions.has(session.timestamp);
    const expanded = isExpanded ? ' expanded' : '';

    // Richer header stats (guarded for accessory-only sessions)
    const sessionBest = session.entries.length > 0 ? Math.max(...session.entries.map(e => e.e1rm)) : 0;
    const prCount = session.entries.filter(e => e.isPR).length;
    const rpEntries = session.entries.filter(e => e.rpe !== null && e.rpe !== undefined);
    const avgRpe = rpEntries.length > 0 ? (rpEntries.reduce((s, e) => s + e.rpe, 0) / rpEntries.length).toFixed(1) : null;
    const firstNote = session.entries.find(e => e.notes)?.notes || '';
    const accSetCount = (session.accessories || []).reduce((s, a) => s + a.setsCompleted.length, 0);
    const totalSetCount = session.sets + accSetCount;

    // Volume comparison bar
    const volPct = maxSessionVol > 0 ? Math.round((session.volume / maxSessionVol) * 100) : 0;

    const accOnlyLabel = session._accessoryOnly ? '<span class="session-tag acc">ACC</span>' : '';
    html += `<div class="session-card${expanded}" data-ts="${session.timestamp}" data-session="${si}">
      <div class="session-header" tabindex="0" role="button" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <div style="flex:1;min-width:0">
          <div class="session-date">${showDateSeps ? time : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + time}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap">
            ${liftTags || accOnlyLabel}
            <span class="session-vol">${totalSetCount} sets${session.volume > 0 ? ' &middot; ' + volStr : ''}</span>
            ${sessionBest > 0 ? `<span class="session-best">${formatWeight(sessionBest)} e1RM</span>` : ''}
            ${avgRpe ? `<span class="session-rpe">RPE ${avgRpe}</span>` : ''}
            ${prCount > 0 ? `<span class="session-pr-badge">PR &times;${prCount}</span>` : ''}
            ${accSetCount > 0 && session.entries.length > 0 ? `<span class="session-acc-count">+${accSetCount} acc</span>` : ''}
          </div>
          ${firstNote ? `<div class="session-note-preview">"${escapeHTML(firstNote.slice(0, 45))}${firstNote.length > 45 ? '...' : ''}"</div>` : ''}
          <div class="session-vol-bar"><div class="session-vol-fill" style="width:${volPct}%"></div></div>
        </div>
        <span class="session-chevron">&#9656;</span>
      </div>
      <div class="session-entries">`;

    session.entries.forEach(e => {
      const metaParts = [];
      if (e.rpe !== null && e.rpe !== undefined) metaParts.push(`RPE ${e.rpe}`);
      if (e.notes) metaParts.push(`"${escapeHTML(e.notes)}"`);
      const repPRBadgeHtml = (e.repPRs && e.repPRs.length > 0) ? ' <span class="pr-badge" style="font-size:0.55rem">REP PR</span>' : '';

      // Strength indicator
      const pct = bestE1rm[e.lift] > 0 ? Math.round((e.e1rm / bestE1rm[e.lift]) * 100) : 0;

      // Selection checkbox
      const checkboxHtml = selectionMode
        ? `<div class="select-checkbox${selectedIds.has(e.id) ? ' checked' : ''}" data-select-id="${e.id}"></div>`
        : '';

      html += `<div class="swipe-container" data-id="${e.id}">
        <div class="swipe-edit-bg"><span class="swipe-edit-label">Edit</span></div>
        <div class="swipe-delete-bg"><span class="swipe-delete-label">Delete</span></div>
        <div class="session-entry" data-lift="${e.lift}">
          <div class="strength-bar" style="width:${pct}%"></div>
          ${checkboxHtml}
          <span class="history-lift" style="color:${COLORS[e.lift]};font-size:0.65rem;min-width:20px">${LIFT_SHORT[e.lift]}</span>
          <div class="history-detail" style="flex:1">
            <div><span class="history-main" style="font-size:0.8rem">${formatWeight(e.weight)} ${store.unit} &times; ${e.reps}</span>
            <span class="history-e1rm" style="font-size:0.7rem"> = ${formatWeight(e.e1rm)} e1RM</span>
            <span class="strength-pct">${pct}%</span>
            ${e.isPR ? ' <span class="pr-badge">PR</span>' : ''}${repPRBadgeHtml}</div>
            ${metaParts.length ? `<div class="history-meta" style="font-size:0.65rem">${metaParts.join(' &middot; ')}</div>` : ''}
            ${(e.tags && e.tags.length) ? e.tags.map(t => `<span class="tag-chip">${escapeHTML(t)}</span>`).join('') : ''}
          </div>
          ${!selectionMode ? `<div class="history-actions">
            <button class="edit-btn" data-id="${e.id}" title="Edit">&#9998;</button>
            <button class="delete-btn" data-id="${e.id}">Del</button>
          </div>` : ''}
        </div>
      </div>`;
    });

    // Render accessory entries for this session
    if (session.accessories && session.accessories.length > 0) {
      if (session.entries.length > 0) {
        html += `<div class="session-acc-separator">Accessories</div>`;
      }
      session.accessories.forEach(a => {
        const legacyEx = ACCESSORY_DB[a.exerciseId];
        const catalogEx = resolveExercise(a.exerciseId);
        const isTimeBased = !!((legacyEx && legacyEx.timeBased) || (catalogEx && catalogEx.progressionType === 'time'));
        const setsStr = a.setsCompleted.join('/') + (isTimeBased ? 's' : '');
        const hasWeight = a.setWeights && a.setWeights.some(w => w > 0);
        const weightDisplay = hasWeight
          ? `${formatWeight(a.setWeights[0])} ${store.unit} &times; `
          : '';
        const mainLiftColor = a.mainLift ? COLORS[a.mainLift] : 'var(--text-dim)';
        html += `<div class="swipe-container" data-acc-id="${a.id}">
          <div class="swipe-edit-bg"><span class="swipe-edit-label">Edit</span></div>
          <div class="swipe-delete-bg"><span class="swipe-delete-label">Delete</span></div>
          <div class="session-entry session-entry-acc" data-acc-id="${a.id}">
            <span class="history-lift acc-badge" style="color:${mainLiftColor};font-size:0.6rem;min-width:24px">ACC</span>
            <div class="history-detail" style="flex:1">
              <div><span class="history-main" style="font-size:0.75rem">${escapeHTML(a.name)}</span></div>
              <div class="history-meta" style="font-size:0.65rem">${weightDisplay}${setsStr}</div>
            </div>
            ${!selectionMode ? `<div class="history-actions">
              <button class="edit-btn" data-acc-id="${a.id}" title="Edit">&#9998;</button>
              <button class="delete-btn" data-acc-id="${a.id}">Del</button>
            </div>` : ''}
          </div>
        </div>`;
      });
    }

    html += '</div></div>';
  });

  // Infinite scroll sentinel
  if (hasMore) {
    html += `<div id="history-sentinel" class="history-sentinel"></div>`;
  }

  container.innerHTML = html;

  // Set up infinite scroll observer
  if (_scrollObserver) _scrollObserver.disconnect();
  if (hasMore) {
    const sentinel = document.getElementById('history-sentinel');
    if (sentinel) {
      _scrollObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          store.historyPage++;
          renderHistory();
        }
      }, { rootMargin: `${INFINITE_SCROLL_MARGIN_PX}px` });
      _scrollObserver.observe(sentinel);
    }
  }

  // Update bulk bar if in selection mode
  if (selectionMode) updateBulkBar();
}

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

function openEditModal(id) {
  const entry = store.entries.find(e => e.id === id);
  if (!entry) return;
  store.editingEntryId = id;
  const body = $('edit-body');

  body.innerHTML = `
    <div class="lift-selector" id="edit-lift-selector">
      ${LIFTS.map(l =>
        `<button class="lift-btn${entry.lift === l ? ' active' : ''}" data-lift="${l}">${LIFT_NAMES[l]}</button>`
      ).join('')}
    </div>
    <div class="input-row">
      <div class="input-group"><label>Weight (<span class="unit-label">${store.unit}</span>)</label>
        <input type="number" id="edit-weight" value="${displayWeight(entry.weight)}" inputmode="decimal" step="any">
      </div>
      <div class="input-group"><label>Reps</label>
        <input type="number" id="edit-reps" value="${entry.reps}" inputmode="numeric" min="1" step="1">
      </div>
    </div>
    <div class="rpe-section">
      <label class="rpe-label">RPE <span class="optional">(optional)</span></label>
      <div class="rpe-row" id="edit-rpe-row">
        <button class="rpe-pill${entry.rpe === null ? ' active' : ''}" data-rpe="">--</button>
        ${[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map(v =>
          `<button class="rpe-pill${entry.rpe === v ? ' active' : ''}" data-rpe="${v}">${v}</button>`
        ).join('')}
      </div>
    </div>
    <div class="input-group" style="margin-top:12px">
      <label>Notes</label>
      <input type="text" class="notes-input" id="edit-notes" value="${escapeHTML(entry.notes || '')}" placeholder="How did it feel?" style="display:block">
    </div>
    <button class="modal-save-btn" id="edit-save">Save Changes</button>
  `;
  openModal('edit-modal');
}

// ---------------------------------------------------------------------------
// Accessory edit modal
// ---------------------------------------------------------------------------

function openAccessoryEditModal(id) {
  const entry = store.accessoryLog.find(a => a.id === id);
  if (!entry) return;
  store.editingEntryId = null;
  store.editingAccId = id;
  const body = $('edit-body');
  const legacyEx = ACCESSORY_DB[entry.exerciseId];
  const catalogEx = resolveExercise(entry.exerciseId);
  const isTimeBased = !!((legacyEx && legacyEx.timeBased) || (catalogEx && catalogEx.progressionType === 'time'));
  const numSets = entry.setsCompleted.length;
  const uniformWeight = entry.setWeights && entry.setWeights.length > 0 ? entry.setWeights[0] : 0;
  const allSameWeight = (entry.setWeights || []).every(w => w === uniformWeight);

  const setRows = entry.setsCompleted.map((val, i) => {
    const w = entry.setWeights?.[i] ?? uniformWeight;
    return `<div class="input-row" style="margin-bottom:6px">
      <div class="input-group">
        <label>Set ${i + 1} weight</label>
        <input type="number" class="edit-acc-weight" data-idx="${i}" value="${displayWeight(w)}" inputmode="decimal" step="any">
      </div>
      <div class="input-group">
        <label>${isTimeBased ? 'Seconds' : 'Reps'}</label>
        <input type="number" class="edit-acc-val" data-idx="${i}" value="${val}" inputmode="numeric" min="1" step="1">
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="section-label" style="margin-bottom:8px">${escapeHTML(entry.name)} (${isTimeBased ? 'time-based' : 'reps'})</div>
    ${setRows || '<div style="color:var(--text-dim);font-size:0.75rem">No sets logged</div>'}
    <button class="modal-save-btn" id="edit-acc-save">Save Changes</button>
  `;
  openModal('edit-modal');
}

// ---------------------------------------------------------------------------
// History click handler
// ---------------------------------------------------------------------------

let recentSwipe = false;

function handleHistoryClick(e) {
  if (recentSwipe) return;

  // Bulk select mode: toggle selection on entry click
  if (selectionMode) {
    const container = e.target.closest('.swipe-container');
    if (container) {
      const id = container.dataset.id;
      if (id) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        renderHistory();
      }
      return;
    }
  }

  const del = e.target.closest('.delete-btn');
  if (del) {
    // Accessory delete
    const accId = del.dataset.accId;
    if (accId) {
      const accEntry = store.accessoryLog.find(a => a.id === accId);
      if (!accEntry) return;
      const body = $('edit-body');
      body.dataset.deleteAccId = accId;
      const dateStr = new Date(accEntry.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      body.innerHTML = `<div class="confirm-dialog">
        <div style="font-size:1.3rem">&#128465;&#65039;</div>
        <p>Delete this accessory entry?</p>
        <div class="confirm-entry">${escapeHTML(accEntry.name)} &mdash; ${accEntry.setsCompleted.join('/')} sets</div>
        <p>${dateStr}</p>
        <div class="confirm-actions">
          <button class="confirm-cancel" id="confirm-cancel-btn">Cancel</button>
          <button class="confirm-delete" id="confirm-delete-btn">Delete</button>
        </div>
      </div>`;
      openModal('edit-modal');
      return;
    }
    // Main lift delete
    const id = del.dataset.id;
    const entry = store.entries.find(en => en.id === id);
    if (!entry) return;
    const body = $('edit-body');
    body.dataset.deleteId = id;
    const dateStr = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    body.innerHTML = `<div class="confirm-dialog">
      <div style="font-size:1.3rem">&#128465;&#65039;</div>
      <p>Delete this entry?</p>
      <div class="confirm-entry" style="color:${COLORS[entry.lift]}">${LIFT_NAMES[entry.lift]} &mdash; ${formatWeight(entry.weight)} ${store.unit} &times; ${entry.reps}</div>
      <p>${dateStr}</p>
      <div class="confirm-actions">
        <button class="confirm-cancel" id="confirm-cancel-btn">Cancel</button>
        <button class="confirm-delete" id="confirm-delete-btn">Delete</button>
      </div>
    </div>`;
    openModal('edit-modal');
    return;
  }
  const edit = e.target.closest('.edit-btn');
  if (edit) {
    if (edit.dataset.accId) { openAccessoryEditModal(edit.dataset.accId); }
    else { openEditModal(edit.dataset.id); }
  }
}

// ---------------------------------------------------------------------------
// Quick date helpers
// ---------------------------------------------------------------------------

function getMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

function getFirstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}

function getDaysAgo(n) {
  return new Date(Date.now() - n * MS_PER_DAY).toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// initHistoryTab — wire up all event listeners
// ---------------------------------------------------------------------------

export function initHistoryTab() {
  // Create sort select dynamically
  const filterBar = document.querySelector('#tab-history .filter-bar');
  if (filterBar) {
    const sortSelect = document.createElement('select');
    sortSelect.id = 'history-sort';
    sortSelect.className = 'history-sort';
    sortSelect.innerHTML = '<option value="newest">Newest</option><option value="oldest">Oldest</option><option value="heaviest">Heaviest</option><option value="volume">Most Vol</option>';
    filterBar.appendChild(sortSelect);
  }

  // Create quick date chips
  const dateFilters = $('date-filters');
  if (dateFilters) {
    const chips = document.createElement('div');
    chips.className = 'quick-date-chips';
    chips.id = 'quick-date-chips';
    chips.innerHTML = '<button class="quick-date-chip" data-range="week">This Week</button>' +
      '<button class="quick-date-chip" data-range="month">This Month</button>' +
      '<button class="quick-date-chip" data-range="30">Last 30d</button>';
    dateFilters.appendChild(chips);
  }

  // Filter pills
  $('history-filter-pills').addEventListener('click', e => {
    const btn = e.target.closest('.filter-pill');
    if (!btn) return;
    $('history-filter-pills').querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    store.historyFilter = btn.dataset.filter;
    store.historyPage = 1;
    renderHistory();
  });

  // History search
  $('history-search').addEventListener('input', debounce(e => {
    store.historySearch = e.target.value.trim().toLowerCase();
    store.historyPage = 1;
    renderHistory();
  }, 200));

  // Sort select
  document.getElementById('history-sort')?.addEventListener('change', e => {
    store.historySort = e.target.value;
    store.historyPage = 1;
    renderHistory();
  });

  // Date filter toggle
  $('date-toggle-btn').addEventListener('click', () => {
    store.showDateFilters = !store.showDateFilters;
    $('date-filters').style.display = store.showDateFilters ? 'flex' : 'none';
    $('date-toggle-btn').classList.toggle('active', store.showDateFilters);
  });
  $('filter-from').addEventListener('change', e => { store.historyFrom = e.target.value; store.historyPage = 1; renderHistory(); });
  $('filter-to').addEventListener('change', e => { store.historyTo = e.target.value; store.historyPage = 1; renderHistory(); });

  // Quick date chips
  document.getElementById('quick-date-chips')?.addEventListener('click', e => {
    const chip = e.target.closest('.quick-date-chip');
    if (!chip) return;
    const range = chip.dataset.range;
    const today = new Date().toISOString().split('T')[0];
    if (range === 'week') { store.historyFrom = getMonday(); store.historyTo = today; }
    else if (range === 'month') { store.historyFrom = getFirstOfMonth(); store.historyTo = today; }
    else if (range === '30') { store.historyFrom = getDaysAgo(30); store.historyTo = ''; }
    $('filter-from').value = store.historyFrom;
    $('filter-to').value = store.historyTo;
    store.historyPage = 1;
    renderHistory();
  });

  // Click delegation for edit/delete/expand/selection
  $('history-list').addEventListener('click', handleHistoryClick);
  $('history-list').addEventListener('click', (e) => {
    if (selectionMode) return; // handled in handleHistoryClick

    // Session expand/collapse
    const hdr = e.target.closest('.session-header');
    if (hdr) {
      const card = hdr.parentElement;
      card.classList.toggle('expanded');
      const isNowExpanded = card.classList.contains('expanded');
      hdr.setAttribute('aria-expanded', isNowExpanded);
      const ts = parseInt(card.dataset.ts);
      if (ts) {
        if (isNowExpanded) expandedSessions.add(ts);
        else expandedSessions.delete(ts);
      }
    }
  });
  $('history-list').addEventListener('keydown', (e) => {
    const hdr = e.target.closest('.session-header');
    if (hdr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const card = hdr.parentElement;
      card.classList.toggle('expanded');
      const isNowExpanded = card.classList.contains('expanded');
      hdr.setAttribute('aria-expanded', isNowExpanded);
      const ts = parseInt(card.dataset.ts);
      if (ts) {
        if (isNowExpanded) expandedSessions.add(ts);
        else expandedSessions.delete(ts);
      }
    }
  });

  // Bulk action bar delegation
  document.addEventListener('click', (e) => {
    if (e.target.closest('#bulk-delete')) {
      if (selectedIds.size === 0) return;
      selectedIds.forEach(id => deleteEntry(id));
      _deps.updateDashboard?.();
      showToastWithUndo(`${selectedIds.size} entries deleted`);
      exitSelectionMode();
      return;
    }
    if (e.target.closest('#bulk-cancel')) {
      exitSelectionMode();
    }
  });

  // Swipe-to-delete (left) and swipe-to-edit (right) for touch
  (function initSwipeGestures() {
    const list = $('history-list');
    let startX = 0, startY = 0, currentContainer = null, dirLocked = false, isHorizontal = false;
    let longPressTimer = null;

    list.addEventListener('touchstart', (e) => {
      const container = e.target.closest('.swipe-container');
      if (!container) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentContainer = container;
      dirLocked = false;
      isHorizontal = false;

      // Long-press for bulk select
      if (!selectionMode) {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          selectionMode = true;
          const id = container.dataset.id;
          if (id) selectedIds.add(id);
          renderHistory();
          showBulkBar();
          // Prevent further swipe processing
          currentContainer = null;
        }, LONG_PRESS_MS);
      }
    }, { passive: true });

    list.addEventListener('touchmove', (e) => {
      // Cancel long-press on any movement
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

      if (!currentContainer || selectionMode) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (!dirLocked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        dirLocked = true;
        isHorizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (!isHorizontal) return;

      e.preventDefault();
      const entry = currentContainer.querySelector('.session-entry');
      if (!entry) return;

      if (dx < 0) {
        // Swipe left — delete
        entry.style.transform = `translateX(${Math.min(0, dx)}px)`;
        if (dx < -10) currentContainer.classList.add('swiping');
        currentContainer.classList.remove('swiping-right');
      } else {
        // Swipe right — edit
        entry.style.transform = `translateX(${Math.max(0, dx)}px)`;
        if (dx > 10) currentContainer.classList.add('swiping-right');
        currentContainer.classList.remove('swiping');
      }
    }, { passive: false });

    list.addEventListener('touchend', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      if (!currentContainer || selectionMode) { currentContainer = null; return; }

      const entry = currentContainer.querySelector('.session-entry');
      if (!entry) { currentContainer = null; return; }

      const currentX = parseFloat(entry.style.transform.replace(/[^-\d.]/g, '')) || 0;
      currentContainer.classList.remove('swiping');
      currentContainer.classList.remove('swiping-right');

      if (currentX <= -80) {
        // Swipe left — delete
        recentSwipe = true;
        setTimeout(() => { recentSwipe = false; }, 300);
        const id = currentContainer.dataset.id;
        currentContainer.classList.add('removing');
        currentContainer.style.maxHeight = currentContainer.offsetHeight + 'px';
        requestAnimationFrame(() => { currentContainer.style.maxHeight = '0'; });
        setTimeout(() => {
          deleteEntry(id);
          renderHistory();
          showToastWithUndo('Entry deleted');
        }, 350);
      } else if (currentX >= 80) {
        // Swipe right — edit
        recentSwipe = true;
        setTimeout(() => { recentSwipe = false; }, 300);
        entry.style.transform = '';
        const id = currentContainer.dataset.id;
        openEditModal(id);
      } else {
        // Snap back
        entry.style.transform = '';
      }
      currentContainer = null;
    }, { passive: true });
  })();

  // Edit-body delegation — handles confirm dialog + edit modal
  (function initEditBodyDelegation() {
    const body = $('edit-body');
    body.addEventListener('click', (e) => {
      if (e.target.closest('#confirm-cancel-btn')) {
        closeModal('edit-modal');
        return;
      }
      if (e.target.closest('#confirm-delete-btn')) {
        const accId = body.dataset.deleteAccId;
        if (accId) {
          store.accessoryLog = store.accessoryLog.filter(a => a.id !== accId);
          store.saveNow('accessoryLog');
          delete body.dataset.deleteAccId;
          closeModal('edit-modal');
          _deps.updateDashboard?.();
          renderHistory();
          showToastWithUndo('Accessory deleted');
          return;
        }
        const id = body.dataset.deleteId;
        if (id) {
          deleteEntry(id);
          delete body.dataset.deleteId;
          closeModal('edit-modal');
          _deps.updateDashboard?.();
          renderHistory();
          showToastWithUndo('Entry deleted');
        }
        return;
      }
      const liftBtn = e.target.closest('#edit-lift-selector .lift-btn');
      if (liftBtn) {
        body.querySelectorAll('#edit-lift-selector .lift-btn').forEach(b => b.classList.remove('active'));
        liftBtn.classList.add('active');
        return;
      }
      const rpeBtn = e.target.closest('#edit-rpe-row .rpe-pill');
      if (rpeBtn) {
        body.querySelectorAll('#edit-rpe-row .rpe-pill').forEach(b => b.classList.remove('active'));
        rpeBtn.classList.add('active');
        return;
      }
      if (e.target.closest('#edit-save')) {
        const activeBtn = body.querySelector('#edit-lift-selector .lift-btn.active');
        if (!activeBtn) return;
        const lift = activeBtn.dataset.lift;
        const w = parseFloat($('edit-weight').value);
        const r = parseInt($('edit-reps').value);
        const rpePill = body.querySelector('#edit-rpe-row .rpe-pill.active');
        const rpe = rpePill && rpePill.dataset.rpe ? parseFloat(rpePill.dataset.rpe) : null;
        const notes = $('edit-notes').value.trim();
        if (!(w > 0 && r > 0)) return;
        editEntry(store.editingEntryId, lift, inputToLbs(w), r, rpe, notes);
        closeModal('edit-modal');
        _deps.updateDashboard?.();
        renderHistory();
        showToastWithUndo('Entry updated');
        return;
      }
      if (e.target.closest('#edit-acc-save')) {
        const accId = store.editingAccId;
        if (!accId) return;
        const entry = store.accessoryLog.find(a => a.id === accId);
        if (!entry) return;
        const weightInputs = body.querySelectorAll('.edit-acc-weight');
        const valInputs = body.querySelectorAll('.edit-acc-val');
        const newWeights = [];
        const newVals = [];
        let valid = true;
        weightInputs.forEach((input) => {
          const v = parseFloat(input.value);
          if (isNaN(v) || v < 0) valid = false;
          else newWeights.push(inputToLbs(v));
        });
        valInputs.forEach((input) => {
          const v = parseInt(input.value);
          if (isNaN(v) || v < 0) valid = false;
          else newVals.push(v);
        });
        if (!valid || newWeights.length === 0) return;
        entry.setWeights = newWeights;
        entry.setsCompleted = newVals;
        entry.weight = newWeights[newWeights.length - 1];
        entry.updatedAt = Date.now();
        store.saveNow('accessoryLog');
        store.editingAccId = null;
        closeModal('edit-modal');
        _deps.updateDashboard?.();
        renderHistory();
        showToastWithUndo('Accessory updated');
        return;
      }
    });
  })();
}
