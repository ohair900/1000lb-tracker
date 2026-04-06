/**
 * Progression rate and plateau detection.
 *
 * - calcProgression — monthly e1RM change rate over the last 90 days
 * - detectPlateau   — flags a lift as stalled when the last 4 weeks
 *                     show no meaningful improvement over the prior 4 weeks
 */

import { MS_PER_DAY } from '../constants/time.js';
import store from '../state/store.js';

/**
 * Calculate the monthly rate of progression for a lift over the last 90 days.
 * Compares the average e1RM of the first third of entries to the last third.
 * Returns null if fewer than 4 entries or the time span is under 14 days.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ monthRate: number, direction: 'up'|'down'|'flat' }|null}
 */
export function calcProgression(lift) {
  const now = Date.now();
  const cutoff = now - 90 * MS_PER_DAY;
  const liftEntries = store.entries.filter(e => e.lift === lift);

  // First ever entry — nothing to compare against
  if (liftEntries.length < 2) return null;

  const recent = liftEntries.filter(e => e.timestamp > cutoff);
  const prior = liftEntries.filter(e => e.timestamp <= cutoff);

  // Under 90 days of history — compare current best vs first entry
  if (prior.length === 0) {
    const sorted = liftEntries.sort((a, b) => a.timestamp - b.timestamp);
    const currentBest = Math.max(...liftEntries.map(e => e.e1rm));
    const delta = currentBest - sorted[0].e1rm;
    return { delta, direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat' };
  }

  // 90+ days of history — compare recent best vs pre-window best
  const currentBest = Math.max(...recent.map(e => e.e1rm));
  const priorBest = Math.max(...prior.map(e => e.e1rm));
  const delta = currentBest - priorBest;

  return {
    delta,
    direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat',
  };
}

/**
 * Detect whether a lift has plateaued.
 * Compares the best e1RM from the last 4 weeks to the best from weeks 4-8.
 * Returns true if the improvement is 2 lbs or less.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {boolean} true if plateaued
 */
export function detectPlateau(lift) {
  const now = Date.now();
  const recent4w = store.entries.filter(
    e => e.lift === lift && (now - e.timestamp) <= 28 * MS_PER_DAY
  );
  const older = store.entries.filter(
    e => e.lift === lift && (now - e.timestamp) > 28 * MS_PER_DAY && (now - e.timestamp) <= 56 * MS_PER_DAY
  );
  if (recent4w.length < 3 || older.length < 3) return false;

  const recentBest = Math.max(...recent4w.map(e => e.e1rm));
  const olderBest = Math.max(...older.map(e => e.e1rm));
  return (recentBest - olderBest) <= 2;
}

/**
 * Extended plateau context — exposes the intermediate values from
 * detectPlateau so diagnostic systems can show richer details.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {{ plateaued: boolean, recentBest: number, olderBest: number, delta: number, recentCount: number, olderCount: number }}
 */
export function getPlateauContext(lift) {
  const now = Date.now();
  const recent4w = store.entries.filter(
    e => e.lift === lift && (now - e.timestamp) <= 28 * MS_PER_DAY
  );
  const older = store.entries.filter(
    e => e.lift === lift && (now - e.timestamp) > 28 * MS_PER_DAY && (now - e.timestamp) <= 56 * MS_PER_DAY
  );
  if (recent4w.length < 3 || older.length < 3) {
    return { plateaued: false, recentBest: 0, olderBest: 0, delta: 0, recentCount: recent4w.length, olderCount: older.length };
  }
  const recentBest = Math.max(...recent4w.map(e => e.e1rm));
  const olderBest = Math.max(...older.map(e => e.e1rm));
  const delta = recentBest - olderBest;
  return { plateaued: delta <= 2, recentBest, olderBest, delta, recentCount: recent4w.length, olderCount: older.length };
}
