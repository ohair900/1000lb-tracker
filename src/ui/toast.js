/**
 * Toast notification system.
 *
 * Provides three flavours:
 *   - `showToast(msg, isPR, milestone, shareData)` — general / PR toast
 *   - `showToastWithUndo(msg, duration)` — toast with an Undo button
 *   - `executeUndo()` — process the pending undo action
 *
 * The undo stack and the PR-share callback are injected via
 * `setToastDeps()` so this module stays decoupled from heavy
 * business-logic modules.
 */

import { $ } from '../utils/helpers.js';
import store from '../state/store.js';
import { PLATE_MILESTONES } from '../constants/lift-config.js';

// ---------------------------------------------------------------------------
// Dependency injection — set by the boot / wiring layer
// ---------------------------------------------------------------------------

/** @type {Function|null} sharePRCard(lift, weight, e1rm, date) */
let _sharePRCard = null;

/** @type {Function|null} Called after undo to refresh dashboard */
let _onAfterUndo = null;

/**
 * Wire up external dependencies that the toast module cannot import
 * directly without creating circular imports.
 *
 * @param {object} deps
 * @param {Function} deps.sharePRCard
 * @param {Function} deps.onAfterUndo - callback(type) after executeUndo runs
 */
export function setToastDeps(deps) {
  if (deps.sharePRCard) _sharePRCard = deps.sharePRCard;
  if (deps.onAfterUndo) _onAfterUndo = deps.onAfterUndo;
}

// ---------------------------------------------------------------------------
// Undo helpers
// ---------------------------------------------------------------------------

/**
 * Push an undoable action onto the stack.
 * Only the most recent action is kept; it expires after 10 seconds.
 *
 * @param {'delete'|'edit'|'add'} type
 * @param {object} data
 */
export function pushUndo(type, data) {
  clearTimeout(store.undoTimer);
  store.undoStack = { type, data };
  store.undoTimer = setTimeout(() => { store.undoStack = null; }, 10000);
}

/**
 * Execute the pending undo action (if any).
 * After processing, calls the `onAfterUndo` callback so the caller
 * can refresh dashboard / history / chart as needed.
 */
export function executeUndo() {
  if (!store.undoStack) return;
  clearTimeout(store.undoTimer);
  const { type, data } = store.undoStack;
  store.undoStack = null;

  // Hide current toast immediately
  $('toast').classList.remove('show');

  // The actual undo mutation is delegated to the wiring layer
  // because it needs rebuildPRs / entries manipulation.
  if (_onAfterUndo) _onAfterUndo(type, data);

  showToast('Undone');
}

// ---------------------------------------------------------------------------
// Toast display
// ---------------------------------------------------------------------------

/**
 * Show a toast notification.
 *
 * @param {string}  msg       - Message text
 * @param {boolean} [isPR]    - If true, use the PR styling and show share button
 * @param {string}  [milestone] - Plate milestone value (e.g. "225")
 * @param {object}  [shareData] - { lift, weight, e1rm, date } for the Share PR button
 */
export function showToast(msg, isPR, milestone, shareData) {
  const el = $('toast');
  el.className = 'toast' + (isPR ? ' pr-toast' : '');
  el.textContent = '';

  el.appendChild(document.createTextNode(msg));

  if (milestone) {
    const idx = PLATE_MILESTONES.indexOf(parseInt(milestone));
    const plates = idx + 1;
    const span = document.createElement('span');
    span.className = 'toast-milestone';
    span.textContent = `${plates} PLATE MILESTONE!`;
    el.appendChild(span);
  }

  if (isPR && shareData) {
    store.pendingSharePR = shareData;
    const btn = document.createElement('button');
    btn.className = 'toast-share';
    btn.textContent = 'Share PR Card';
    btn.addEventListener('click', () => {
      if (_sharePRCard) {
        _sharePRCard(shareData.lift, shareData.weight, shareData.e1rm, shareData.date);
      }
    });
    el.appendChild(btn);
  }

  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), isPR ? 3500 : 1500);
}

/**
 * Show a toast with an Undo button.
 *
 * @param {string} msg
 * @param {number} [duration=4000] - Auto-dismiss time in ms
 */
export function showToastWithUndo(msg, duration) {
  const el = $('toast');
  el.className = 'toast';
  el.textContent = '';

  el.appendChild(document.createTextNode(msg + ' '));

  const btn = document.createElement('button');
  btn.className = 'toast-undo';
  btn.textContent = 'Undo';
  btn.addEventListener('click', executeUndo);
  el.appendChild(btn);

  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration || 4000);
}
