/**
 * Volume calculations, session grouping, meet-prep projections,
 * and attempt suggestions.
 */

import store from '../state/store.js';
import { LIFTS } from '../constants/lift-config.js';
import { MS_PER_DAY } from '../constants/time.js';
import { getWeekKey, getMonthKey } from '../utils/date.js';

// ---------------------------------------------------------------------------
// Volume summaries
// ---------------------------------------------------------------------------

/**
 * Calculate volume (tonnage) summaries grouped by period.
 * Returns the most recent 12 periods in reverse chronological order,
 * each with per-lift tonnage, total tonnage, sets, reps, and
 * percentage change from the previous period.
 *
 * @param {'weekly'|'monthly'} period - Grouping period
 * @returns {Object[]} Array of summary objects, newest first
 */
export function calcVolumeSummaries(period) {
  const keyFn = period === 'weekly' ? getWeekKey : getMonthKey;
  const byPeriod = {};

  store.entries.forEach(e => {
    const k = keyFn(e.date);
    if (!byPeriod[k]) byPeriod[k] = { squat: 0, bench: 0, deadlift: 0, sets: 0, reps: 0, total: 0 };
    byPeriod[k][e.lift] += e.weight * e.reps;
    byPeriod[k].total += e.weight * e.reps;
    byPeriod[k].sets++;
    byPeriod[k].reps += e.reps;
  });

  const keys = Object.keys(byPeriod).sort().reverse().slice(0, 12);
  return keys.map((k, i) => {
    const d = byPeriod[k];
    const prevKey = keys[i + 1];
    const prev = prevKey ? byPeriod[prevKey] : null;
    const change = prev ? ((d.total - prev.total) / prev.total * 100) : null;
    return { key: k, ...d, change };
  });
}

// ---------------------------------------------------------------------------
// Meet prep — projected total and attempt suggestions
// ---------------------------------------------------------------------------

/**
 * Project a conservative meet total based on the best e1RM
 * from the last 8 weeks for each lift, multiplied by 0.95.
 *
 * @returns {{ squat: number|null, bench: number|null, deadlift: number|null, total: number|null }}
 */
export function getProjectedTotal() {
  const weeksAgo8 = Date.now() - 56 * MS_PER_DAY;
  const recent = store.entries.filter(e => e.timestamp >= weeksAgo8);
  const proj = {};
  LIFTS.forEach(l => {
    const best = recent.filter(e => e.lift === l).reduce((m, e) => Math.max(m, e.e1rm), 0);
    proj[l] = best > 0 ? Math.round(best * 0.95 * 10) / 10 : null;
  });
  proj.total = (proj.squat && proj.bench && proj.deadlift)
    ? proj.squat + proj.bench + proj.deadlift
    : null;
  return proj;
}

/**
 * Suggest second and third attempts from a given opener weight.
 * Second = opener * 1.025, third = opener * 1.065, both rounded
 * to the nearest 2.5 increment.
 *
 * @param {number} opener - First-attempt weight
 * @returns {{ second: number, third: number }}
 */
export function suggestAttempts(opener) {
  return {
    second: Math.round(opener * 1.025 / 2.5) * 2.5,
    third: Math.round(opener * 1.065 / 2.5) * 2.5
  };
}

// ---------------------------------------------------------------------------
// Session grouping
// ---------------------------------------------------------------------------

/**
 * Group an array of entries into sessions.  Entries that are more than
 * 2 hours apart (by timestamp) are treated as separate sessions.
 *
 * Each returned session contains:
 *  - entries: the raw entries in that session
 *  - lifts:   array of unique lift names
 *  - date:    ISO date string of the first entry
 *  - timestamp: timestamp of the first entry
 *  - volume:  total tonnage (weight * reps)
 *  - sets:    total number of sets
 *
 * @param {Object[]} filteredEntries - Array of entry objects (with timestamp, lift, weight, reps, date)
 * @returns {Object[]} Sessions sorted newest-first
 */
export function groupSessions(filteredEntries) {
  const sorted = [...filteredEntries].sort((a, b) => b.timestamp - a.timestamp);
  const sessions = [];
  let current = null;

  sorted.forEach(e => {
    if (!current || (current.entries[current.entries.length - 1].timestamp - e.timestamp) > 7200000) {
      current = { entries: [e], lifts: new Set([e.lift]) };
      sessions.push(current);
    } else {
      current.entries.push(e);
      current.lifts.add(e.lift);
    }
  });

  return sessions.map(s => ({
    entries: s.entries,
    lifts: [...s.lifts],
    date: s.entries[0].date,
    timestamp: s.entries[0].timestamp,
    volume: s.entries.reduce((sum, e) => sum + e.weight * e.reps, 0),
    sets: s.entries.length
  }));
}
