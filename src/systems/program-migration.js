/**
 * Program history migration helpers.
 *
 * completedSets only says "this program set is done". completedSetData freezes
 * the actual weight/reps used for that completed set. Without completedSetData,
 * old completed rows are recalculated from the newest training max.
 */

import store from '../state/store.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { LIFT_NAMES } from '../constants/lift-config.js';
import { roundToPlate } from '../formulas/plates.js';

export const PROGRAM_HISTORY_MIGRATION_VERSION = 2;

/**
 * Infer the training max that was active when a given absolute week number
 * was being trained, using tmHistory (which only captures auto-progressions).
 *
 * @param {Object} pc - programConfig
 * @param {string} lift
 * @param {number} week - absolute 1-based week number
 * @param {number} cycleLen - template.weeks
 * @returns {number}
 */
export function inferTMAtWeek(pc, lift, week, cycleLen) {
  const history = (pc.tmHistory || [])
    .filter(h => h.lift === lift && h.oldTM && h.newTM && h.source !== 'manual')
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!history.length) return pc.trainingMaxes[lift] || 0;

  const cycleIdx = Math.floor((week - 1) / cycleLen);
  if (cycleIdx === 0) return history[0].oldTM;
  const histIdx = Math.min(cycleIdx - 1, history.length - 1);
  return history[histIdx].newTM;
}

/**
 * Parse a completedSets key of the form "${lift}-${week}-${idx}".
 * Returns null if the key can't be parsed.
 *
 * @param {string} key
 * @returns {{ lift: string, week: number, idx: number }|null}
 */
export function parseSetKey(key) {
  const lastDash = key.lastIndexOf('-');
  const secondLastDash = key.lastIndexOf('-', lastDash - 1);
  if (lastDash < 0 || secondLastDash < 0 || secondLastDash === lastDash) return null;
  const lift = key.substring(0, secondLastDash);
  const week = parseInt(key.substring(secondLastDash + 1, lastDash));
  const idx = parseInt(key.substring(lastDash + 1));
  if (!lift || isNaN(week) || isNaN(idx)) return null;
  return { lift, week, idx };
}

function _hasFrozenData(data) {
  return !!data && Number.isFinite(Number(data.weight)) && Number.isFinite(Number(data.reps));
}

function _isAmrapReps(reps) {
  return typeof reps === 'string' && reps.includes('+');
}

function _prescribedFloor(reps) {
  return typeof reps === 'string' ? parseInt(reps) : reps;
}

function _repMatches(entry, item) {
  if (!entry || entry.reps === undefined || entry.reps === null) return false;
  if (item.isAmrap) return entry.reps >= item.prescribedFloor;
  return entry.reps === item.prescribedFloor;
}

function _entrySort(a, b) {
  const at = a.timestamp || new Date(a.date || 0).getTime() || 0;
  const bt = b.timestamp || new Date(b.date || 0).getTime() || 0;
  if (at !== bt) return at - bt;
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function _itemSort(a, b) {
  if (a.lift !== b.lift) return a.lift.localeCompare(b.lift);
  if (a.week !== b.week) return a.week - b.week;
  return a.idx - b.idx;
}

function _entryKey(entry) {
  return entry.id || `${entry.lift}-${entry.timestamp || entry.date}-${entry.weight}-${entry.reps}`;
}

function _estimateTMFromEntry(item, entry) {
  if (item.pct) return roundToPlate(entry.weight / (item.pct / 100));
  return item.expectedTM || 0;
}

function _setItemFromKey(pc, tmpl, key) {
  const parsed = parseSetKey(key);
  if (!parsed) return null;

  const { lift, week, idx } = parsed;
  const templateWeek = ((week - 1) % tmpl.weeks) + 1;
  const weekData = tmpl.schedule[templateWeek];
  if (!weekData || !weekData.sets[idx]) return null;

  const setSpec = weekData.sets[idx];
  const expectedTM = inferTMAtWeek(pc, lift, week, tmpl.weeks);
  const expectedWeight = expectedTM ? roundToPlate(expectedTM * setSpec.pct / 100) : 0;
  const isAmrap = _isAmrapReps(setSpec.reps);
  const prescribedFloor = _prescribedFloor(setSpec.reps);
  const existingData = pc.completedSetData?.[key] || null;
  const liftName = LIFT_NAMES[lift] || lift;

  return {
    key,
    lift,
    week,
    idx,
    setNum: idx + 1,
    label: `${liftName} - Week ${week}, Set ${idx + 1}`,
    expectedTM,
    expectedWeight,
    pct: setSpec.pct,
    prescribedReps: setSpec.reps,
    isAmrap,
    prescribedFloor,
    existingData,
  };
}

function _buildSetItems() {
  const pc = store.programConfig;
  if (!pc || !pc.activeProgram) return [];

  const tmpl = PROGRAM_TEMPLATES[pc.activeProgram];
  if (!tmpl) return [];

  return Object.keys(pc.completedSets || {})
    .map(key => _setItemFromKey(pc, tmpl, key))
    .filter(Boolean)
    .sort(_itemSort);
}

function _freezeFromEntry(item, entry) {
  return {
    weight: entry.weight,
    reps: entry.reps,
    tm: _estimateTMFromEntry(item, entry),
    date: entry.date,
    entryId: entry.id || null,
    recovered: true,
    recoveryVersion: PROGRAM_HISTORY_MIGRATION_VERSION,
  };
}

function _freezeFromPrescription(item) {
  return {
    weight: item.expectedWeight,
    reps: item.prescribedFloor,
    tm: item.expectedTM,
    date: new Date().toISOString().split('T')[0],
    entryId: null,
    recovered: true,
    prescriptionFallback: true,
    recoveryVersion: PROGRAM_HISTORY_MIGRATION_VERSION,
  };
}

/**
 * Build candidate data for every completedSets key. Uses a loose weight
 * sort so users can identify the real entry.
 *
 * @returns {Array<{
 *   key: string,
 *   lift: string,
 *   week: number,
 *   idx: number,
 *   setNum: number,
 *   label: string,
 *   expectedTM: number,
 *   expectedWeight: number,
 *   pct: number,
 *   prescribedReps: string|number,
 *   isAmrap: boolean,
 *   existingData: Object|null,
 *   candidates: Array
 * }>}
 */
export function buildSetCandidates() {
  const results = _buildSetItems();

  results.forEach(item => {
    let candidates = store.entries.filter(e => e.lift === item.lift && _repMatches(e, item));

    // Score by weight proximity, then date descending for review convenience.
    candidates.sort((a, b) => {
      if (item.expectedWeight) {
        const wd = Math.abs(a.weight - item.expectedWeight) - Math.abs(b.weight - item.expectedWeight);
        if (wd !== 0) return wd;
      }
      return _entrySort(b, a);
    });

    item.candidates = candidates.slice(0, 12);
  });

  // Sort: sets without frozen data first, then by week/idx
  results.sort((a, b) => {
    const aHas = _hasFrozenData(a.existingData) && !a.existingData.recovered;
    const bHas = _hasFrozenData(b.existingData) && !b.existingData.recovered;
    if (aHas !== bHas) return aHas ? 1 : -1;
    return _itemSort(a, b);
  });

  return results;
}

/**
 * Recover/freeze completed program sets that are missing completedSetData.
 *
 * The automatic pass is intentionally chronological rather than weight-first:
 * if a user changed their TM after completing old weeks, current prescription
 * weights are no longer a trustworthy anchor. The actual history entries are.
 *
 * @param {Object} [options]
 * @param {boolean} [options.fallbackToPrescription=false] Freeze unmatched sets
 *   to the current prescription. Only use before changing a TM, while the
 *   current prescription still represents the old completed work.
 * @param {boolean} [options.overwriteRecovered=true] Recompute prior automatic
 *   recoveries, but never overwrite user-confirmed completedSetData.
 * @param {boolean} [options.save=false] Persist immediately.
 * @returns {{ recovered: number, prescriptionFallback: number, unrecoveredKeys: string[], changed: boolean }}
 */
export function recoverProgramHistory({
  fallbackToPrescription = false,
  overwriteRecovered = true,
  save = false,
} = {}) {
  const pc = store.programConfig;
  if (!pc || !pc.activeProgram) {
    return { recovered: 0, prescriptionFallback: 0, unrecoveredKeys: [], changed: false };
  }

  if (!pc.completedSetData) pc.completedSetData = {};

  const allItems = _buildSetItems();
  const targetItems = allItems.filter(item => {
    const data = pc.completedSetData[item.key];
    if (!_hasFrozenData(data)) return true;
    return overwriteRecovered && data.recovered;
  });

  const targetKeys = new Set(targetItems.map(item => item.key));
  const usedEntries = new Set();
  Object.entries(pc.completedSetData || {}).forEach(([key, data]) => {
    if (targetKeys.has(key)) return;
    if (_hasFrozenData(data) && data.entryId) usedEntries.add(data.entryId);
  });

  const entriesByLift = {};
  store.entries.forEach(entry => {
    if (!entriesByLift[entry.lift]) entriesByLift[entry.lift] = [];
    entriesByLift[entry.lift].push(entry);
  });
  Object.values(entriesByLift).forEach(entries => entries.sort(_entrySort));

  let recovered = 0;
  let prescriptionFallback = 0;
  let changed = false;
  const unrecoveredKeys = [];

  targetItems.sort(_itemSort).forEach(item => {
    const entries = entriesByLift[item.lift] || [];
    const match = entries.find(entry => !usedEntries.has(_entryKey(entry)) && _repMatches(entry, item));

    if (match) {
      pc.completedSetData[item.key] = _freezeFromEntry(item, match);
      usedEntries.add(_entryKey(match));
      recovered++;
      changed = true;
      return;
    }

    if (fallbackToPrescription && item.expectedWeight) {
      pc.completedSetData[item.key] = _freezeFromPrescription(item);
      prescriptionFallback++;
      changed = true;
      return;
    }

    unrecoveredKeys.push(item.key);
  });

  if (save && changed) store.saveProgramConfig();

  return { recovered, prescriptionFallback, unrecoveredKeys, changed };
}

/**
 * Run at app startup. The old flag was a one-shot boolean, so users who loaded
 * the partial fix could still be stuck with missing frozen data. Version this
 * pass and rerun whenever completed sets still need recovery.
 */
export function runProgramHistoryMigration() {
  const pc = store.programConfig;
  if (!pc || !pc.activeProgram) return;

  const tmpl = PROGRAM_TEMPLATES[pc.activeProgram];
  if (!tmpl) {
    pc.completedSetDataMigrated = true;
    pc.completedSetDataMigrationVersion = PROGRAM_HISTORY_MIGRATION_VERSION;
    store.saveProgramConfig();
    return;
  }

  if (!pc.completedSetData) pc.completedSetData = {};

  const needsRecovery = Object.keys(pc.completedSets || {}).some(key => {
    const data = pc.completedSetData?.[key];
    return !_hasFrozenData(data) ||
      (data.recovered && (data.recoveryVersion || 0) < PROGRAM_HISTORY_MIGRATION_VERSION);
  });

  if (pc.completedSetDataMigrationVersion >= PROGRAM_HISTORY_MIGRATION_VERSION && !needsRecovery) {
    return;
  }

  const result = recoverProgramHistory({
    fallbackToPrescription: false,
    overwriteRecovered: true,
    save: false,
  });

  pc.completedSetDataMigrated = true;
  pc.completedSetDataMigrationVersion = PROGRAM_HISTORY_MIGRATION_VERSION;
  pc.completedSetDataUnrecoveredKeys = result.unrecoveredKeys;
  pc.completedSetDataReviewDismissed = result.unrecoveredKeys.length === 0;
  store.saveProgramConfig();
}

/**
 * Clear migration flags so the user can re-trigger the review overlay.
 * Removes auto-recovered entries from completedSetData (leaves manually-set ones).
 */
export function resetProgramHistoryMigration() {
  const pc = store.programConfig;
  if (!pc) return;
  pc.completedSetDataMigrated = false;
  pc.completedSetDataMigrationVersion = 0;
  pc.completedSetDataUnrecoveredKeys = [];
  pc.completedSetDataReviewDismissed = false;
  // Clear only auto-recovered entries; preserve entries set by user this session
  if (pc.completedSetData) {
    Object.keys(pc.completedSetData).forEach(k => {
      if (pc.completedSetData[k] && pc.completedSetData[k].recovered) {
        delete pc.completedSetData[k];
      }
    });
  }
  store.saveProgramConfig();
}
