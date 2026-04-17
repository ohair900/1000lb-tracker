/**
 * PR (Personal Record) detection and tracking system.
 *
 * - rebuildPRs()              — rebuild the entire PR list from entries
 * - checkPR(lift, e1rm)       — quick check if a value beats the current best
 * - getMilestone(lift, e1rm)  — check if a PR crosses a plate milestone
 * - getRepPRs()               — build a map of best weight per rep count per lift
 * - checkRepPR(lift, weight, reps) — check if a weight is a new rep-PR
 */

import store from '../state/store.js';
import { PLATE_MILESTONES, REP_RANGES } from '../constants/lift-config.js';

let _rebuildScheduled = false;

/**
 * Schedule a PR rebuild for the next microtask, coalescing multiple
 * calls in the same tick into one execution.
 */
export function schedulePRRebuild() {
  if (_rebuildScheduled) return;
  _rebuildScheduled = true;
  queueMicrotask(() => {
    _rebuildScheduled = false;
    rebuildPRs();
  });
}

/**
 * Rebuild the entire PR list from scratch by scanning all entries
 * in chronological order.  Marks each entry's `isPR` flag and
 * populates `store.prs` with milestone info.
 *
 * Call after any edit/delete that might invalidate existing PRs.
 */
export function rebuildPRs() {
  const sorted = [...store.entries].sort((a, b) => a.timestamp - b.timestamp);
  const best = { squat: 0, bench: 0, deadlift: 0 };
  const achieved = { squat: new Set(), bench: new Set(), deadlift: new Set() };
  store.prs = [];
  store.entries.forEach(e => { e.isPR = false; });

  sorted.forEach(e => {
    if (e.e1rm > best[e.lift]) {
      best[e.lift] = e.e1rm;
      e.isPR = true;
      const crossed = PLATE_MILESTONES.filter(m => e.e1rm >= m);
      const fresh = crossed.filter(m => !achieved[e.lift].has(m));
      const milestone = fresh.length > 0 ? fresh[fresh.length - 1].toString() : null;
      crossed.forEach(m => achieved[e.lift].add(m));
      store.prs.push({
        lift: e.lift,
        e1rm: e.e1rm,
        entryId: e.id,
        date: e.date,
        timestamp: e.timestamp,
        milestone,
      });
    }
  });

  store.saveEntries();
}

/**
 * Quick check whether a given e1RM value would be a new PR for a lift.
 *
 * @param {string} lift  - 'squat' | 'bench' | 'deadlift'
 * @param {number} e1rm  - Estimated 1RM to test
 * @returns {boolean} True if this beats all existing entries for the lift
 */
export function checkPR(lift, e1rm) {
  const prev = store.entries
    .filter(e => e.lift === lift)
    .reduce((mx, e) => Math.max(mx, e.e1rm), 0);
  return e1rm > prev;
}

/**
 * Check if a PR crosses a plate milestone that has not been achieved before.
 *
 * @param {string} lift  - 'squat' | 'bench' | 'deadlift'
 * @param {number} e1rm  - The new e1RM value
 * @returns {string|null} The milestone value as a string, or null
 */
export function getMilestone(lift, e1rm) {
  const crossed = PLATE_MILESTONES.filter(m => e1rm >= m);
  const achieved = new Set(
    store.prs
      .filter(p => p.lift === lift)
      .map(p => p.milestone)
      .filter(Boolean)
      .map(Number)
  );
  const fresh = crossed.filter(m => !achieved.has(m));
  return fresh.length > 0 ? fresh[fresh.length - 1].toString() : null;
}

/**
 * Build a map of the best weight at each rep count for every lift.
 * Processes entries chronologically so the "best" is the all-time heaviest.
 *
 * @returns {{ squat: Object, bench: Object, deadlift: Object }}
 *   Each lift maps rep-count (number) to { weight, date, entryId }.
 */
export function getRepPRs() {
  const repBest = { squat: {}, bench: {}, deadlift: {} };
  const sorted = [...store.entries].sort((a, b) => a.timestamp - b.timestamp);
  sorted.forEach(e => {
    if (!repBest[e.lift]) return;
    // Entries can have AMRAP-style "5+" rep strings — coerce to int.
    const reps = parseInt(e.reps, 10);
    if (!Number.isFinite(reps) || reps < 1) return;
    // A set of `reps` at `weight` implicitly proves the lifter can do every
    // smaller rep count at that weight. Backfill all REP_RANGES slots <= reps,
    // but only if the entry weight beats whatever's currently in that slot.
    REP_RANGES.forEach(r => {
      if (r > reps) return;
      if (!repBest[e.lift][r] || e.weight > repBest[e.lift][r].weight) {
        repBest[e.lift][r] = { weight: e.weight, date: e.date, entryId: e.id };
      }
    });
  });
  return repBest;
}

/**
 * Check if a weight at a given rep count is a new rep-PR for a lift.
 *
 * @param {string} lift    - 'squat' | 'bench' | 'deadlift'
 * @param {number} weight  - Weight lifted
 * @param {number} reps    - Rep count
 * @returns {boolean} True if this is a new rep-PR
 */
export function checkRepPR(lift, weight, reps) {
  const prev = store.entries
    .filter(e => e.lift === lift && e.reps === reps)
    .reduce((mx, e) => Math.max(mx, e.weight), 0);
  return weight > prev;
}
