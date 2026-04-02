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
  const recent = store.entries.filter(
    e => e.lift === lift && (now - e.timestamp) <= 90 * MS_PER_DAY
  );
  if (recent.length < 4) return null;

  const sorted = recent.sort((a, b) => a.timestamp - b.timestamp);
  const third = Math.ceil(sorted.length / 3);
  const firstThird = sorted.slice(0, third);
  const lastThird = sorted.slice(-third);

  const avgFirst = firstThird.reduce((s, e) => s + e.e1rm, 0) / firstThird.length;
  const avgLast = lastThird.reduce((s, e) => s + e.e1rm, 0) / lastThird.length;

  const daySpan = (sorted[sorted.length - 1].timestamp - sorted[0].timestamp) / MS_PER_DAY;
  if (daySpan < 14) return null;

  const monthRate = (avgLast - avgFirst) / (daySpan / 30);
  return {
    monthRate,
    direction: monthRate > 1 ? 'up' : monthRate < -1 ? 'down' : 'flat',
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
