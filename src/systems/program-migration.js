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
import { SUPPLEMENTAL_TIERS } from '../constants/program-tiers.js';

export const PROGRAM_HISTORY_MIGRATION_VERSION = 3;

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
  const primarySetCount = weekData.sets.filter(s => !SUPPLEMENTAL_TIERS.includes(s.tier)).length;
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
    tier: setSpec.tier || null,
    primarySetCount,
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

function _groupKey(item) {
  return `${item.lift}-${item.week}`;
}

function _groupLabel(group) {
  const liftName = LIFT_NAMES[group.lift] || group.lift;
  return `${liftName} - Week ${group.week}`;
}

function _entryDate(entry) {
  if (entry.date) return entry.date;
  if (entry.timestamp) return new Date(entry.timestamp).toISOString().split('T')[0];
  return '';
}

function _dateLabel(dateStr) {
  if (!dateStr) return 'Unknown date';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _valuesSummary(values) {
  const nums = values.filter(v => Number.isFinite(Number(v))).map(Number);
  if (!nums.length) return '';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return min === max ? `${min}` : `${min}-${max}`;
}

function _buildWorkoutGroups() {
  const groupsByKey = {};
  _buildSetItems().forEach(item => {
    const key = _groupKey(item);
    if (!groupsByKey[key]) {
      groupsByKey[key] = {
        key,
        lift: item.lift,
        week: item.week,
        label: '',
        items: [],
      };
    }
    groupsByKey[key].items.push(item);
  });

  return Object.values(groupsByKey)
    .map(group => {
      group.items.sort((a, b) => a.idx - b.idx);
      group.label = _groupLabel(group);
      group.expectedSetCount = group.items[0]?.primarySetCount || group.items.length;
      group.isCompleteWorkout = group.items.length >= group.expectedSetCount;
      return group;
    })
    .sort((a, b) => {
      if (a.lift !== b.lift) return a.lift.localeCompare(b.lift);
      return a.week - b.week;
    });
}

function _buildEntrySessions(lift) {
  const byDate = {};
  store.entries
    .filter(entry => entry.lift === lift)
    .sort(_entrySort)
    .forEach(entry => {
      const date = _entryDate(entry);
      if (!byDate[date]) {
        byDate[date] = {
          key: `${lift}-${date}`,
          lift,
          date,
          label: _dateLabel(date),
          entries: [],
        };
      }
      byDate[date].entries.push(entry);
    });

  return Object.values(byDate).sort((a, b) => {
    const at = a.entries[0]?.timestamp || new Date(a.date || 0).getTime() || 0;
    const bt = b.entries[0]?.timestamp || new Date(b.date || 0).getTime() || 0;
    return at - bt;
  });
}

function _assignmentScore(group, entries) {
  let weightScore = 0;
  let exactRepMatches = 0;
  group.items.forEach((item, idx) => {
    const entry = entries[idx];
    if (entry.reps === item.prescribedFloor) exactRepMatches++;
    if (item.expectedWeight) {
      weightScore += Math.abs(entry.weight - item.expectedWeight);
    }
  });
  return {
    exactRepMatches,
    weightScore,
    score: exactRepMatches * 1000 - weightScore,
  };
}

function _bestEntryAssignment(group, session, usedEntries = new Set()) {
  const needed = group.items.length;
  const available = session.entries.filter(entry => !usedEntries.has(_entryKey(entry)));
  if (available.length < needed) return null;

  let best = null;
  function search(itemIdx, chosen, remaining) {
    if (itemIdx >= group.items.length) {
      const scored = _assignmentScore(group, chosen);
      const match = { entries: [...chosen], ...scored };
      if (!best || match.score > best.score) best = match;
      return;
    }

    const item = group.items[itemIdx];
    const candidates = remaining
      .filter(entry => _repMatches(entry, item))
      .sort((a, b) => {
        const ad = item.expectedWeight ? Math.abs(a.weight - item.expectedWeight) : 0;
        const bd = item.expectedWeight ? Math.abs(b.weight - item.expectedWeight) : 0;
        if (ad !== bd) return ad - bd;
        return _entrySort(a, b);
      })
      .slice(0, 8);

    candidates.forEach(entry => {
      search(
        itemIdx + 1,
        [...chosen, entry],
        remaining.filter(e => _entryKey(e) !== _entryKey(entry))
      );
    });
  }

  search(0, [], available);
  return best;
}

function _bestSessionMatch(group, session, usedEntries = new Set()) {
  const assignment = _bestEntryAssignment(group, session, usedEntries);
  if (!assignment) return null;
  return {
    sessionKey: session.key,
    date: session.date,
    dateLabel: session.label,
    entries: assignment.entries,
    score: assignment.score,
    exactRepMatches: assignment.exactRepMatches,
    weightScore: assignment.weightScore,
    weightSummary: _valuesSummary(assignment.entries.map(entry => entry.weight)),
    repsSummary: _valuesSummary(assignment.entries.map(entry => entry.reps)),
  };
}

function _buildWorkoutAssignments(groups, reservedEntries = new Set()) {
  const assignments = {};
  const byLift = {};
  groups.filter(group => group.isCompleteWorkout).forEach(group => {
    if (!byLift[group.lift]) byLift[group.lift] = [];
    byLift[group.lift].push(group);
  });

  Object.entries(byLift).forEach(([lift, liftGroups]) => {
    const sessions = _buildEntrySessions(lift);
    const usedEntries = new Set(reservedEntries);
    let cursor = sessions.length - 1;

    [...liftGroups].sort((a, b) => b.week - a.week).forEach(group => {
      let best = null;
      let bestIndex = -1;

      for (let i = cursor; i >= 0; i--) {
        const match = _bestSessionMatch(group, sessions[i], usedEntries);
        if (!match) continue;
        best = match;
        bestIndex = i;
        break;
      }

      if (!best) return;

      assignments[group.key] = best;
      best.entries.forEach(entry => usedEntries.add(_entryKey(entry)));
      cursor = bestIndex - 1;
    });
  });

  return assignments;
}

function _shouldRecoverData(data, overwriteRecovered) {
  if (!_hasFrozenData(data)) return true;
  if (!overwriteRecovered) return false;
  return !!data.recovered || (data.recoveryVersion || 0) < PROGRAM_HISTORY_MIGRATION_VERSION;
}

function _freezeGroupFromMatch(group, match, pc) {
  let applied = 0;
  group.items.forEach((item, idx) => {
    const entry = match.entries[idx];
    if (!entry) return;
    pc.completedSetData[item.key] = _freezeFromEntry(item, entry);
    applied++;
  });
  return applied;
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
  const groups = _buildWorkoutGroups();
  const assignments = _buildWorkoutAssignments(groups);
  const assignedByKey = {};

  groups.forEach(group => {
    const match = assignments[group.key];
    if (!match) return;
    group.items.forEach((item, idx) => {
      const entry = match.entries[idx];
      if (entry) assignedByKey[item.key] = entry;
    });
  });

  results.forEach(item => {
    let candidates = store.entries.filter(e => e.lift === item.lift && _repMatches(e, item));
    const assigned = assignedByKey[item.key];

    // Prefer the workout-level date match, then show nearby same-lift options.
    candidates.sort((a, b) => {
      if (assigned) {
        if (_entryKey(a) === _entryKey(assigned)) return -1;
        if (_entryKey(b) === _entryKey(assigned)) return 1;
      }
      const dateCmp = String(b.date || '').localeCompare(String(a.date || ''));
      if (dateCmp !== 0) return dateCmp;
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

export function buildWorkoutReviewGroups() {
  const groups = _buildWorkoutGroups();
  const assignments = _buildWorkoutAssignments(groups);

  return groups.map(group => {
    const match = assignments[group.key] || null;
    const pendingItems = group.items.filter(item => {
      const data = item.existingData;
      return !_hasFrozenData(data) || data.recovered ||
        (data.recoveryVersion || 0) < PROGRAM_HISTORY_MIGRATION_VERSION;
    });

    return {
      ...group,
      match,
      pendingCount: pendingItems.length,
      status: pendingItems.length === 0
        ? 'set'
        : match
          ? 'matched'
          : group.isCompleteWorkout ? 'unmatched' : 'partial',
    };
  });
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

  const allGroups = _buildWorkoutGroups();
  const allItems = allGroups.flatMap(group => group.items);
  const targetItems = allItems.filter(item => {
    return _shouldRecoverData(pc.completedSetData[item.key], overwriteRecovered);
  });

  const targetKeys = new Set(targetItems.map(item => item.key));
  const usedEntries = new Set();
  Object.entries(pc.completedSetData || {}).forEach(([key, data]) => {
    if (targetKeys.has(key)) return;
    if (_hasFrozenData(data) && data.entryId) usedEntries.add(data.entryId);
  });

  let recovered = 0;
  let prescriptionFallback = 0;
  let changed = false;
  const unrecoveredKeys = [];
  const recoveredKeys = new Set();

  const assignments = _buildWorkoutAssignments(allGroups, usedEntries);
  allGroups.forEach(group => {
    const match = assignments[group.key];
    if (!match) return;

    let groupApplied = 0;
    group.items.forEach((item, idx) => {
      if (!targetKeys.has(item.key)) return;
      const entry = match.entries[idx];
      if (!entry) return;
      pc.completedSetData[item.key] = _freezeFromEntry(item, entry);
      usedEntries.add(_entryKey(entry));
      recoveredKeys.add(item.key);
      groupApplied++;
    });

    if (groupApplied > 0) {
      recovered += groupApplied;
      changed = true;
    }
  });

  targetItems.sort(_itemSort).forEach(item => {
    if (recoveredKeys.has(item.key)) return;

    if (fallbackToPrescription && item.expectedWeight) {
      pc.completedSetData[item.key] = _freezeFromPrescription(item);
      prescriptionFallback++;
      changed = true;
      return;
    }

    if (pc.completedSetData[item.key]?.recovered) {
      delete pc.completedSetData[item.key];
      changed = true;
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
