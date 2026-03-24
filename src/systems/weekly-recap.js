/**
 * Weekly recap system.
 *
 * - calcWeeklyRecap() — generate a data summary for the current training week
 * - checkAutoRecap()  — determine if an auto-recap should be shown (returns data, not HTML)
 *
 * NOTE: These functions return plain data objects.  All HTML rendering and
 * modal presentation logic lives in the UI / view layer.
 */

import store from '../state/store.js';
import { MS_PER_DAY } from '../constants/time.js';
import { LIFTS } from '../constants/lift-config.js';
import { RECAP_WEEK_KEY } from '../constants/storage-keys.js';
import { calcFatigue } from './fatigue.js';
import { calcStreak } from './streak.js';

/**
 * Generate a weekly recap data object summarising the current training week.
 *
 * @returns {Object|null} Recap data, or null if there is no data at all.
 *   Fields: sets, reps, volume, prevSets, prevVolume, setsChange, volChange,
 *           trainingDays, prsThisWeek, topSet, liftVolume, fatigue, streak,
 *           weekLabel
 */
export function calcWeeklyRecap() {
  const now = new Date();
  const day = MS_PER_DAY;
  const startOfWeek = new Date(now.getTime() - ((now.getDay() + 6) % 7) * day);
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfLastWeek = new Date(startOfWeek.getTime() - 7 * day);
  const thisWeekStart = startOfWeek.toISOString().split('T')[0];
  const lastWeekStart = startOfLastWeek.toISOString().split('T')[0];

  const thisWeek = store.entries.filter(e => e.date >= thisWeekStart);
  const lastWeek = store.entries.filter(e => e.date >= lastWeekStart && e.date < thisWeekStart);

  if (thisWeek.length === 0 && lastWeek.length === 0) return null;

  const sets = thisWeek.length;
  const reps = thisWeek.reduce((s, e) => s + e.reps, 0);
  const volume = thisWeek.reduce((s, e) => s + e.weight * e.reps, 0);
  const prevSets = lastWeek.length;
  const prevVolume = lastWeek.reduce((s, e) => s + e.weight * e.reps, 0);
  const trainingDays = new Set(thisWeek.map(e => e.date)).size;
  const prsThisWeek = thisWeek.filter(e => e.isPR);

  // Top set (highest e1RM this week)
  let topSet = null;
  if (thisWeek.length > 0) {
    topSet = thisWeek.reduce((best, e) => e.e1rm > (best?.e1rm || 0) ? e : best, null);
  }

  // Per-lift volume
  const liftVolume = {};
  LIFTS.forEach(l => {
    liftVolume[l] = thisWeek.filter(e => e.lift === l).reduce((s, e) => s + e.weight * e.reps, 0);
  });

  const setsChange = prevSets > 0 ? ((sets - prevSets) / prevSets * 100) : null;
  const volChange = prevVolume > 0 ? ((volume - prevVolume) / prevVolume * 100) : null;

  const fatigue = calcFatigue();
  const streak = calcStreak();

  return {
    sets, reps, volume, prevSets, prevVolume, setsChange, volChange,
    trainingDays, prsThisWeek, topSet, liftVolume, fatigue, streak,
    weekLabel: thisWeekStart,
  };
}

/**
 * Check whether an automatic weekly recap should be shown.
 *
 * Returns the recap data if the conditions are met (new week, has last week's
 * data, and it's Sunday or Monday), or null if no auto-recap should be shown.
 *
 * The caller is responsible for displaying the recap and calling any modal /
 * toast UI.  This function only writes the "already shown" key to localStorage
 * to prevent duplicate auto-shows.
 *
 * @returns {Object|null} Recap data object (same shape as calcWeeklyRecap), or null
 */
export function checkAutoRecap() {
  const now = new Date();
  const startOfWeek = new Date(now.getTime() - ((now.getDay() + 6) % 7) * MS_PER_DAY);
  const weekKey = startOfWeek.toISOString().split('T')[0];
  const lastShown = localStorage.getItem(RECAP_WEEK_KEY);
  if (lastShown === weekKey) return null;

  // Only auto-show if it's a new week and we have last week data
  const recap = calcWeeklyRecap();
  if (recap && recap.prevSets > 0 && now.getDay() <= 1) {
    localStorage.setItem(RECAP_WEEK_KEY, weekKey);
    return recap;
  }
  return null;
}
