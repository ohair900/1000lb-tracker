/**
 * History tab view — session-grouped history list, search/filter,
 * pagination, swipe-to-delete, edit modal, and delete confirmation.
 */

import store, { HISTORY_PAGE_SIZE } from '../state/store.js';
import { $, escapeHTML, fmtNum, debounce } from '../utils/helpers.js';
import { LIFTS, COLORS, LIFT_SHORT, LIFT_NAMES } from '../constants/lift-config.js';
import { displayWeight, formatWeight, inputToLbs } from '../formulas/units.js';
import { groupSessions } from '../systems/volume.js';
import { deleteEntry, editEntry } from '../state/actions.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showToastWithUndo } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Expansion state — survives re-renders, keyed by session timestamp
// ---------------------------------------------------------------------------

const expandedSessions = new Set();

// ---------------------------------------------------------------------------
// Late-bound callbacks
// ---------------------------------------------------------------------------

let _updateDashboard = null;

/**
 * Inject view-level dependencies.
 * @param {object} deps
 */
export function injectHistoryDeps(deps) {
  if (deps.updateDashboard) _updateDashboard = deps.updateDashboard;
}

// ---------------------------------------------------------------------------
// Render history list
// ---------------------------------------------------------------------------

/**
 * Render the full history list into #history-list, applying current filters.
 */
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

  // Session grouping
  const allSessions = groupSessions(filtered);
  const visibleCount = store.historyPage * HISTORY_PAGE_SIZE;
  const sessions = allSessions.slice(0, visibleCount);
  const hasMore = allSessions.length > visibleCount;
  let html = '';
  sessions.forEach((session, si) => {
    const d = new Date(session.date + 'T12:00:00');
    const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const time = new Date(session.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const liftTags = session.lifts.map(l => `<span class="session-tag ${l}">${LIFT_SHORT[l]}</span>`).join('');
    const volStr = fmtNum(displayWeight(session.volume)) + ' ' + store.unit;
    const isExpanded = expandedSessions.has(session.timestamp);
    const expanded = isExpanded ? ' expanded' : '';

    html += `<div class="session-card${expanded}" data-ts="${session.timestamp}" data-session="${si}">
      <div class="session-header" tabindex="0" role="button" aria-expanded="${isExpanded ? 'true' : 'false'}">
        <div style="flex:1">
          <div class="session-date">${label} ${time}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:3px">
            ${liftTags}
            <span class="session-vol">${session.sets} sets &middot; ${volStr}</span>
          </div>
        </div>
        <span class="session-chevron">&#9656;</span>
      </div>
      <div class="session-entries">`;

    session.entries.forEach(e => {
      const metaParts = [];
      if (e.rpe !== null && e.rpe !== undefined) metaParts.push(`RPE ${e.rpe}`);
      if (e.notes) metaParts.push(`"${escapeHTML(e.notes)}"`);
      const repPRBadgeHtml = (e.repPRs && e.repPRs.length > 0) ? ' <span class="pr-badge" style="font-size:0.55rem">REP PR</span>' : '';

      html += `<div class="swipe-container" data-id="${e.id}">
        <div class="swipe-delete-bg"><span class="swipe-delete-label">Delete</span></div>
        <div class="session-entry" data-lift="${e.lift}">
          <span class="history-lift" style="color:${COLORS[e.lift]};font-size:0.65rem;min-width:20px">${LIFT_SHORT[e.lift]}</span>
          <div class="history-detail" style="flex:1">
            <div><span class="history-main" style="font-size:0.8rem">${formatWeight(e.weight)} ${store.unit} &times; ${e.reps}</span>
            <span class="history-e1rm" style="font-size:0.7rem"> = ${formatWeight(e.e1rm)} e1RM</span>
            ${e.isPR ? ' <span class="pr-badge">PR</span>' : ''}${repPRBadgeHtml}</div>
            ${metaParts.length ? `<div class="history-meta" style="font-size:0.65rem">${metaParts.join(' &middot; ')}</div>` : ''}
            ${(e.tags && e.tags.length) ? e.tags.map(t => `<span class="tag-chip">${escapeHTML(t)}</span>`).join('') : ''}
          </div>
          <div class="history-actions">
            <button class="edit-btn" data-id="${e.id}" title="Edit">&#9998;</button>
            <button class="delete-btn" data-id="${e.id}">Del</button>
          </div>
        </div>
      </div>`;
    });

    html += '</div></div>';
  });
  if (hasMore) {
    html += `<button class="load-more-btn" id="history-load-more">Load More (${allSessions.length - visibleCount} remaining)</button>`;
  }
  container.innerHTML = html;
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
// History click handler
// ---------------------------------------------------------------------------

let recentSwipe = false;

function handleHistoryClick(e) {
  if (recentSwipe) return;
  const del = e.target.closest('.delete-btn');
  if (del) {
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
  if (edit) { openEditModal(edit.dataset.id); }
}

// ---------------------------------------------------------------------------
// initHistoryTab — wire up all History tab event listeners
// ---------------------------------------------------------------------------

/**
 * Set up all event listeners for the History tab.
 * Call once after DOMContentLoaded.
 */
export function initHistoryTab() {
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

  // Date filter toggle
  $('date-toggle-btn').addEventListener('click', () => {
    store.showDateFilters = !store.showDateFilters;
    $('date-filters').style.display = store.showDateFilters ? 'flex' : 'none';
    $('date-toggle-btn').classList.toggle('active', store.showDateFilters);
  });
  $('filter-from').addEventListener('change', e => { store.historyFrom = e.target.value; store.historyPage = 1; renderHistory(); });
  $('filter-to').addEventListener('change', e => { store.historyTo = e.target.value; store.historyPage = 1; renderHistory(); });

  // Click delegation for edit/delete
  $('history-list').addEventListener('click', handleHistoryClick);
  $('history-list').addEventListener('click', (e) => {
    // Load More button
    if (e.target.closest('#history-load-more')) {
      store.historyPage++;
      renderHistory();
      return;
    }
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

  // Swipe-to-delete for touch devices
  (function initSwipeToDelete() {
    const list = $('history-list');
    let startX = 0, startY = 0, currentContainer = null, dirLocked = false, isHorizontal = false;

    list.addEventListener('touchstart', (e) => {
      const container = e.target.closest('.swipe-container');
      if (!container) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentContainer = container;
      dirLocked = false;
      isHorizontal = false;
    }, { passive: true });

    list.addEventListener('touchmove', (e) => {
      if (!currentContainer) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;

      if (!dirLocked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        dirLocked = true;
        isHorizontal = Math.abs(dx) > Math.abs(dy);
      }
      if (!isHorizontal) return;

      e.preventDefault();
      const offset = Math.min(0, dx);
      const entry = currentContainer.querySelector('.session-entry');
      if (entry) entry.style.transform = `translateX(${offset}px)`;
      if (offset < -10) {
        currentContainer.classList.add('swiping');
      }
    }, { passive: false });

    list.addEventListener('touchend', () => {
      if (!currentContainer) return;
      const entry = currentContainer.querySelector('.session-entry');
      if (!entry) { currentContainer = null; return; }

      const currentX = parseFloat(entry.style.transform.replace(/[^-\d.]/g, '')) || 0;
      currentContainer.classList.remove('swiping');

      if (currentX <= -80) {
        // Swipe threshold met — delete
        recentSwipe = true;
        setTimeout(() => { recentSwipe = false; }, 300);
        const id = currentContainer.dataset.id;
        currentContainer.classList.add('removing');
        currentContainer.style.maxHeight = currentContainer.offsetHeight + 'px';
        requestAnimationFrame(() => {
          currentContainer.style.maxHeight = '0';
        });
        setTimeout(() => {
          deleteEntry(id);
          renderHistory();
          showToastWithUndo('Entry deleted');
        }, 350);
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
      // Confirm cancel
      if (e.target.closest('#confirm-cancel-btn')) {
        closeModal('edit-modal');
        return;
      }
      // Confirm delete
      if (e.target.closest('#confirm-delete-btn')) {
        const id = body.dataset.deleteId;
        if (id) {
          deleteEntry(id);
          closeModal('edit-modal');
          if (_updateDashboard) _updateDashboard();
          renderHistory();
          showToastWithUndo('Entry deleted');
        }
        return;
      }
      // Edit lift selector
      const liftBtn = e.target.closest('#edit-lift-selector .lift-btn');
      if (liftBtn) {
        body.querySelectorAll('#edit-lift-selector .lift-btn').forEach(b => b.classList.remove('active'));
        liftBtn.classList.add('active');
        return;
      }
      // Edit RPE
      const rpeBtn = e.target.closest('#edit-rpe-row .rpe-pill');
      if (rpeBtn) {
        body.querySelectorAll('#edit-rpe-row .rpe-pill').forEach(b => b.classList.remove('active'));
        rpeBtn.classList.add('active');
        return;
      }
      // Save edit
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
        if (_updateDashboard) _updateDashboard();
        renderHistory();
        showToastWithUndo('Entry updated');
        return;
      }
    });
  })();
}
