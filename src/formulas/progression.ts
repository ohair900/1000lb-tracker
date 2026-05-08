/**
 * Progression rate and plateau detection.
 */

import { MS_PER_DAY } from '../constants/time.js';
import store from '../state/store.js';
import type { Lift } from '../types.js';

export type Direction = 'up' | 'down' | 'flat';

export interface ProgressionResult {
  delta: number;
  direction: Direction;
}

export interface PlateauContext {
  plateaued: boolean;
  recentBest: number;
  olderBest: number;
  delta: number;
  recentCount: number;
  olderCount: number;
}

/**
 * Calculate the monthly rate of progression for a lift over the last 90 days.
 * Returns null if fewer than 2 entries or insufficient time span.
 */
export function calcProgression(lift: Lift): ProgressionResult | null {
  const now = Date.now();
  const cutoff = now - 90 * MS_PER_DAY;
  const liftEntries = store.entries.filter((e: { lift: string }) => e.lift === lift);

  if (liftEntries.length < 2) return null;

  const recent = liftEntries.filter((e: { timestamp: number }) => e.timestamp > cutoff);
  const prior = liftEntries.filter((e: { timestamp: number }) => e.timestamp <= cutoff);

  if (prior.length === 0) {
    const sorted = liftEntries.sort(
      (a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp
    );
    const currentBest = Math.max(...liftEntries.map((e: { e1rm: number }) => e.e1rm));
    const delta = currentBest - sorted[0].e1rm;
    return { delta, direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat' };
  }

  const currentBest = Math.max(...recent.map((e: { e1rm: number }) => e.e1rm));
  const priorBest = Math.max(...prior.map((e: { e1rm: number }) => e.e1rm));
  const delta = currentBest - priorBest;
  return { delta, direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat' };
}

/**
 * Detect whether a lift has plateaued.
 * Returns true if improvement over 4 weeks is ≤ 2 lbs.
 */
export function detectPlateau(lift: Lift): boolean {
  const now = Date.now();
  const recent4w = store.entries.filter(
    (e: { lift: string; timestamp: number }) =>
      e.lift === lift && now - e.timestamp <= 28 * MS_PER_DAY
  );
  const older = store.entries.filter(
    (e: { lift: string; timestamp: number }) =>
      e.lift === lift && now - e.timestamp > 28 * MS_PER_DAY && now - e.timestamp <= 56 * MS_PER_DAY
  );
  if (recent4w.length < 3 || older.length < 3) return false;

  const recentBest = Math.max(...recent4w.map((e: { e1rm: number }) => e.e1rm));
  const olderBest = Math.max(...older.map((e: { e1rm: number }) => e.e1rm));
  return recentBest - olderBest <= 2;
}

/**
 * Extended plateau context with intermediate values for diagnostic systems.
 */
export function getPlateauContext(lift: Lift): PlateauContext {
  const now = Date.now();
  const recent4w = store.entries.filter(
    (e: { lift: string; timestamp: number }) =>
      e.lift === lift && now - e.timestamp <= 28 * MS_PER_DAY
  );
  const older = store.entries.filter(
    (e: { lift: string; timestamp: number }) =>
      e.lift === lift && now - e.timestamp > 28 * MS_PER_DAY && now - e.timestamp <= 56 * MS_PER_DAY
  );
  if (recent4w.length < 3 || older.length < 3) {
    return {
      plateaued: false,
      recentBest: 0,
      olderBest: 0,
      delta: 0,
      recentCount: recent4w.length,
      olderCount: older.length,
    };
  }
  const recentBest = Math.max(...recent4w.map((e: { e1rm: number }) => e.e1rm));
  const olderBest = Math.max(...older.map((e: { e1rm: number }) => e.e1rm));
  const delta = recentBest - olderBest;
  return {
    plateaued: delta <= 2,
    recentBest,
    olderBest,
    delta,
    recentCount: recent4w.length,
    olderCount: older.length,
  };
}
