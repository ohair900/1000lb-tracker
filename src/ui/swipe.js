/**
 * Swipe-to-delete gesture for the history list.
 *
 * Handles touch events on `.swipe-container` elements inside `#history-list`.
 * A left swipe past the threshold (-80 px) triggers deletion with a
 * collapse animation, followed by a toast with undo.
 *
 * Callbacks for the actual data mutation and re-render are injected
 * via `setSwipeDeps()`.
 */

import { $ } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/** @type {Function|null} deleteEntry(id) */
let _deleteEntry = null;

/** @type {Function|null} renderHistory() */
let _renderHistory = null;

/** @type {Function|null} showToastWithUndo(msg) */
let _showToastWithUndo = null;

/**
 * @param {object} deps
 * @param {Function} deps.deleteEntry
 * @param {Function} deps.renderHistory
 * @param {Function} deps.showToastWithUndo
 */
export function setSwipeDeps(deps) {
  if (deps.deleteEntry) _deleteEntry = deps.deleteEntry;
  if (deps.renderHistory) _renderHistory = deps.renderHistory;
  if (deps.showToastWithUndo) _showToastWithUndo = deps.showToastWithUndo;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * True for a short window after a swipe-delete fires, so the tap handler
 * on history entries can ignore the ghost click.
 * @type {boolean}
 */
export let recentSwipe = false;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Attach swipe-to-delete touch listeners to the `#history-list` element.
 * Call once after DOMContentLoaded.
 */
export function initSwipeToDelete() {
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
        if (_deleteEntry) _deleteEntry(id);
        if (_renderHistory) _renderHistory();
        if (_showToastWithUndo) _showToastWithUndo('Entry deleted');
      }, 350);
    } else {
      // Snap back
      entry.style.transform = '';
    }
    currentContainer = null;
  }, { passive: true });
}
