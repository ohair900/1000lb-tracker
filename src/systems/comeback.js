/**
 * Comeback detection system.
 *
 * - checkComeback() — detect if the user is returning after a 14+ day break
 *
 * Returns structured data about the break and last session.
 * The caller (UI layer) is responsible for displaying the toast / message.
 */

import store from '../state/store.js';
import { MS_PER_DAY } from '../constants/time.js';
import { LIFT_NAMES } from '../constants/lift-config.js';

/**
 * Group an array of entries into sessions (separated by >2 hour gaps).
 * Entries should already be sorted newest-first.
 *
 * @param {Object[]} filteredEntries - Entries sorted by timestamp descending
 * @returns {Object[]} Array of session objects with { entries, lifts, date, timestamp, volume, sets }
 */
function groupSessions(filteredEntries) {
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
    sets: s.entries.length,
  }));
}

/**
 * Check if the user is coming back after a 14+ day break.
 *
 * Returns a data object with break information, or null if the user has not
 * been away long enough (or has no entries).  The caller is responsible for
 * displaying the welcome-back message (use `formatWeight` on the e1RM values
 * for unit-aware display).
 *
 * @returns {{ daysSince: number, lastSessionLifts: Array<{lift: string, name: string, bestE1RM: number}> }|null}
 */
export function checkComeback() {
  if (store.entries.length === 0) return null;

  const sorted = [...store.entries].sort((a, b) => b.timestamp - a.timestamp);
  const lastDate = sorted[0].timestamp;
  const daysSince = Math.floor((Date.now() - lastDate) / MS_PER_DAY);

  if (daysSince < 14) return null;

  const lastSession = groupSessions(sorted)[0];
  if (!lastSession) return null;

  const lastSessionLifts = lastSession.lifts.map(l => {
    const liftEntries = lastSession.entries.filter(e => e.lift === l);
    const best = Math.max(...liftEntries.map(e => e.e1rm));
    return { lift: l, name: LIFT_NAMES[l], bestE1RM: best };
  });

  return {
    daysSince,
    lastSessionLifts,
  };
}
