/**
 * Training streak calculations.
 *
 * A "streak" counts consecutive training days allowing up to a 2-day gap
 * (i.e., training every other day still counts as maintaining the streak).
 */

import { MS_PER_DAY } from '../constants/time.js';
import { getWeekKey } from '../utils/date.js';
import store from '../state/store.js';

/**
 * Calculate the current streak, longest streak, and recent weekly activity.
 *
 * @returns {{ current: number, longest: number, weeksActive: number }|null}
 *   null if there are no entries at all.
 */
export function calcStreak() {
  if (store.entries.length === 0) return null;

  const dates = [...new Set(store.entries.map(e => e.date))].sort().reverse();
  if (dates.length === 0) return null;

  const dayDiff = (a, b) =>
    Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / MS_PER_DAY);
  const today = new Date().toISOString().split('T')[0];

  // Current streak
  let current = 0;
  if (dayDiff(today, dates[0]) <= 2) {
    current = 1;
    for (let i = 1; i < dates.length; i++) {
      if (dayDiff(dates[i - 1], dates[i]) <= 2) current++;
      else break;
    }
  }

  // Longest streak
  let longest = 1, streak = 1;
  for (let i = 1; i < dates.length; i++) {
    if (dayDiff(dates[i - 1], dates[i]) <= 2) {
      streak++;
      longest = Math.max(longest, streak);
    } else {
      streak = 1;
    }
  }
  longest = Math.max(longest, streak);

  // Weeks active in last 4 weeks
  const fourWeeksAgo = Date.now() - 28 * MS_PER_DAY;
  const recentDates = dates.filter(d => new Date(d + 'T12:00:00').getTime() >= fourWeeksAgo);
  const weeks = new Set(recentDates.map(d => getWeekKey(d)));

  return { current, longest, weeksActive: weeks.size };
}
