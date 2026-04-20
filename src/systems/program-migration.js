/**
 * One-time migration: back-fill completedSetData from store.entries for existing
 * completedSets that have no frozen data yet. Surfaces an unrecovered-count banner
 * when the program section renders if some sets couldn't be matched.
 */

import store from '../state/store.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { roundToPlate } from '../formulas/plates.js';

/**
 * Infer the training max that was active when a given program week was being done.
 * Uses tmHistory (auto-progression log) ordered by cycle boundaries.
 *
 * @param {{ tmHistory: Array, trainingMaxes: Object }} pc
 * @param {string} lift
 * @param {number} week - absolute week number (1-based)
 * @param {number} cycleLen - template.weeks (length of one full cycle)
 * @returns {number}
 */
function _inferTMAtWeek(pc, lift, week, cycleLen) {
  const history = (pc.tmHistory || [])
    .filter(h => h.lift === lift)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (history.length === 0) return pc.trainingMaxes[lift] || 0;

  // Which cycle (0-indexed) does `week` belong to?
  const cycleIdx = Math.floor((week - 1) / cycleLen);

  if (cycleIdx === 0) {
    return history[0].oldTM;
  }
  // cycleIdx-1 is the index into history for which bump happened at that boundary
  const histIdx = Math.min(cycleIdx - 1, history.length - 1);
  return history[histIdx].newTM;
}

/**
 * Run once at app startup (via requestIdleCallback in main.js).
 * Iterates completedSets, matches each to a store.entries row, and freezes
 * the actual weight/reps into completedSetData.
 *
 * Sets pc.completedSetDataMigrated = true when done (idempotent after that).
 * Sets pc.completedSetDataUnrecoveredKeys + completedSetDataReviewDismissed
 * when some keys couldn't be matched.
 */
export function runProgramHistoryMigration() {
  const pc = store.programConfig;
  if (!pc || !pc.activeProgram || pc.completedSetDataMigrated) return;

  const tmpl = PROGRAM_TEMPLATES[pc.activeProgram];
  if (!tmpl) {
    pc.completedSetDataMigrated = true;
    store.saveProgramConfig();
    return;
  }

  if (!pc.completedSetData) pc.completedSetData = {};

  const unrecoveredKeys = [];

  Object.keys(pc.completedSets).forEach(key => {
    if (pc.completedSetData[key]) return; // already frozen, skip

    // Parse key: "${lift}-${week}-${idx}" — lift names have no hyphens
    const lastDash = key.lastIndexOf('-');
    const secondLastDash = key.lastIndexOf('-', lastDash - 1);
    if (lastDash < 0 || secondLastDash < 0 || secondLastDash === lastDash) {
      unrecoveredKeys.push(key);
      return;
    }
    const lift = key.substring(0, secondLastDash);
    const week = parseInt(key.substring(secondLastDash + 1, lastDash));
    const idx = parseInt(key.substring(lastDash + 1));
    if (!lift || isNaN(week) || isNaN(idx)) {
      unrecoveredKeys.push(key);
      return;
    }

    // Get set specification from template
    const templateWeek = ((week - 1) % tmpl.weeks) + 1;
    const weekData = tmpl.schedule[templateWeek];
    if (!weekData || !weekData.sets[idx]) {
      unrecoveredKeys.push(key);
      return;
    }
    const setSpec = weekData.sets[idx];

    const expectedTM = _inferTMAtWeek(pc, lift, week, tmpl.weeks);
    if (!expectedTM) {
      unrecoveredKeys.push(key);
      return;
    }

    const expectedWeight = roundToPlate(expectedTM * setSpec.pct / 100);
    const isAmrap = typeof setSpec.reps === 'string' && setSpec.reps.includes('+');
    const prescribedFloor = typeof setSpec.reps === 'string' ? parseInt(setSpec.reps) : setSpec.reps;

    // Search entries: same lift, weight within ±2.5lbs, reps match
    const candidates = store.entries.filter(e => {
      if (e.lift !== lift) return false;
      if (Math.abs(e.weight - expectedWeight) > 2.5) return false;
      if (isAmrap) {
        return e.reps >= prescribedFloor;
      }
      return e.reps === prescribedFloor;
    });

    if (candidates.length === 0) {
      unrecoveredKeys.push(key);
      return;
    }

    // Pick closest weight, then most recent
    candidates.sort((a, b) => {
      const wd = Math.abs(a.weight - expectedWeight) - Math.abs(b.weight - expectedWeight);
      return wd !== 0 ? wd : b.timestamp - a.timestamp;
    });
    const best = candidates[0];

    pc.completedSetData[key] = {
      weight: best.weight,
      reps: best.reps,
      tm: expectedTM,
      date: best.date,
      entryId: best.id,
      recovered: true,
    };
  });

  pc.completedSetDataMigrated = true;
  pc.completedSetDataUnrecoveredKeys = unrecoveredKeys;
  pc.completedSetDataReviewDismissed = unrecoveredKeys.length === 0;

  store.saveProgramConfig();
}
