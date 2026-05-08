/**
 * Training streak calculations.
 */

import { MS_PER_DAY } from '../constants/time.js';
import { getWeekKey } from '../utils/date.js';
import store from '../state/store.js';

export interface StreakResult {
  current: number;
  longest: number;
  weeksActive: number;
}

/**
 * Calculate the current streak, longest streak, and recent weekly activity.
 * Returns null if there are no entries.
 */
export function calcStreak(): StreakResult | null {
  if (store.entries.length === 0) return null;

  const dates = [...new Set(store.entries.map((e: { date: string }) => e.date))].sort().reverse();
  if (dates.length === 0) return null;

  const dayDiff = (a: string, b: string) =>
    Math.round(
      (new Date(a + 'T12:00:00').getTime() - new Date(b + 'T12:00:00').getTime()) / MS_PER_DAY
    );
  const today = new Date().toISOString().split('T')[0];

  let current = 0;
  if (dayDiff(today, dates[0]) <= 2) {
    current = 1;
    for (let i = 1; i < dates.length; i++) {
      if (dayDiff(dates[i - 1], dates[i]) <= 2) current++;
      else break;
    }
  }

  let longest = 1,
    streak = 1;
  for (let i = 1; i < dates.length; i++) {
    if (dayDiff(dates[i - 1], dates[i]) <= 2) {
      streak++;
      longest = Math.max(longest, streak);
    } else {
      streak = 1;
    }
  }
  longest = Math.max(longest, streak);

  const fourWeeksAgo = Date.now() - 28 * MS_PER_DAY;
  const recentDates = dates.filter((d) => new Date(d + 'T12:00:00').getTime() >= fourWeeksAgo);
  const weeks = new Set(recentDates.map((d: string) => getWeekKey(d)));

  return { current, longest, weeksActive: weeks.size };
}
