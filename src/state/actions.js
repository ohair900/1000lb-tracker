/**
 * Entry CRUD operations and undo system.
 *
 * These functions mutate `store` and trigger saves.  They are the only
 * sanctioned way to add / edit / delete lift entries.  All PR detection
 * and rebuild logic is called through here.
 *
 * Dependencies:
 *  - store          — the singleton state container
 *  - calcE1RM       — e1RM formula (from formulas module, injected at boot)
 *  - rebuildPRs     — full PR rebuild (from systems module, injected at boot)
 *  - checkPR        — quick single-entry PR check (injected at boot)
 *  - checkRepPR     — rep-PR check (injected at boot)
 *  - getMilestone   — plate milestone lookup (injected at boot)
 *
 * We use late-binding via an `inject()` call so that this module has zero
 * circular imports.  The boot / main module calls `inject()` once after
 * all modules are loaded.
 */

import store from './store.js';
import { generateId } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// Late-bound dependencies (set via inject())
// ---------------------------------------------------------------------------

let _calcE1RM    = null;
let _rebuildPRs  = null;
let _checkPR     = null;
let _checkRepPR  = null;
let _getMilestone = null;

/**
 * Provide formula / system functions that this module needs.
 * Call once during app boot, after all modules are imported.
 *
 * @param {Object} deps
 * @param {Function} deps.calcE1RM
 * @param {Function} deps.rebuildPRs
 * @param {Function} deps.checkPR
 * @param {Function} deps.checkRepPR
 * @param {Function} deps.getMilestone
 */
export function inject(deps) {
  _calcE1RM    = deps.calcE1RM;
  _rebuildPRs  = deps.rebuildPRs;
  _checkPR     = deps.checkPR;
  _checkRepPR  = deps.checkRepPR;
  _getMilestone = deps.getMilestone;
}

// ---------------------------------------------------------------------------
// Add / Edit / Delete
// ---------------------------------------------------------------------------

/**
 * Create a new entry, detect PRs, persist, and return the result.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @param {number} weight - Weight in lbs (internal unit)
 * @param {number} reps
 * @param {number|null} rpe
 * @param {string} notes
 * @param {string[]} tags
 * @returns {{ entry: Object, isPR: boolean, isRepPR: boolean, milestone: string|null }}
 */
export function addEntry(lift, weight, reps, rpe, notes, tags) {
  const e1rm = Math.round(_calcE1RM(weight, reps) * 10) / 10;
  const now = new Date();
  const isPR = _checkPR(lift, e1rm);
  const isRepPR = _checkRepPR(lift, weight, reps);
  const milestone = isPR ? _getMilestone(lift, e1rm) : null;

  const entry = {
    id: generateId(),
    lift,
    weight,
    reps,
    e1rm,
    date: now.toISOString().split('T')[0],
    timestamp: now.getTime(),
    rpe,
    notes: notes || '',
    isPR,
    bodyweight: store.profile.bodyweight,
    cycleId: store.activeCycleId,
    repPRs: isRepPR ? [reps] : [],
    tags: tags || [],
  };

  store.entries.push(entry);

  if (isPR) {
    store.prs.push({
      lift,
      e1rm,
      entryId: entry.id,
      date: entry.date,
      timestamp: entry.timestamp,
      milestone,
    });
  }

  store.saveEntries();
  store.lastLoggedSet = { lift, weight, reps, rpe, notes };

  return { entry, isPR, isRepPR, milestone };
}

/**
 * Edit an existing entry in-place.
 * Pushes the previous state onto the undo stack before mutating.
 *
 * @param {string} id - Entry ID
 * @param {string} lift
 * @param {number} weight
 * @param {number} reps
 * @param {number|null} rpe
 * @param {string} notes
 */
export function editEntry(id, lift, weight, reps, rpe, notes) {
  const e = store.entries.find((x) => x.id === id);
  if (!e) return;

  pushUndo('edit', { id, previous: { ...e } });

  e.lift = lift;
  e.weight = weight;
  e.reps = reps;
  e.e1rm = Math.round(_calcE1RM(weight, reps) * 10) / 10;
  e.rpe = rpe;
  e.notes = notes || '';
  e.updatedAt = Date.now();

  _rebuildPRs();
}

/**
 * Delete an entry by ID.
 * Pushes the deleted entry onto the undo stack first.
 *
 * @param {string} id - Entry ID
 */
export function deleteEntry(id) {
  const entry = store.entries.find((e) => e.id === id);
  if (entry) pushUndo('delete', { entry: { ...entry } });

  if (entry) {
    store._deletedEntryRecords.push({ id: entry.id, deletedAt: Date.now() });
    store.deletedEntryIds.add(entry.id);
    store.save('deletedEntryIds');
  }

  const wasPR = entry?.isPR;
  store.entries = store.entries.filter((e) => e.id !== id);

  if (wasPR) _rebuildPRs();
  else store.saveEntries();
}

// ---------------------------------------------------------------------------
// Undo system
// ---------------------------------------------------------------------------

/**
 * Push an undoable action onto the stack.
 * Only one level of undo is supported; a new push replaces any previous.
 * The stack auto-clears after 10 seconds.
 *
 * @param {'add'|'edit'|'delete'} type
 * @param {Object} data - Payload needed to reverse the action
 */
export function pushUndo(type, data) {
  clearTimeout(store.undoTimer);
  store.undoStack = { type, data };
  store.undoTimer = setTimeout(() => {
    store.undoStack = null;
  }, 10000);
}

/**
 * Execute the pending undo (if any).
 *
 * Returns an object describing what happened so the caller can update the
 * UI accordingly (dashboard, history, charts).  Returns `null` if there
 * was nothing to undo.
 *
 * @returns {{ type: string, data: Object }|null}
 */
export function executeUndo() {
  if (!store.undoStack) return null;

  clearTimeout(store.undoTimer);
  const { type, data } = store.undoStack;
  store.undoStack = null;

  if (type === 'delete') {
    store.entries.push(data.entry);
    _rebuildPRs();
  } else if (type === 'edit') {
    const e = store.entries.find((x) => x.id === data.id);
    if (e) {
      Object.assign(e, data.previous);
      _rebuildPRs();
    }
  } else if (type === 'add') {
    store.entries = store.entries.filter((e) => e.id !== data.id);
    _rebuildPRs();
  }

  return { type, data };
}
