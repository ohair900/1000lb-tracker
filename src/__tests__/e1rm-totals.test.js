/**
 * Unit tests for bestE1RM and getTotal in src/formulas/e1rm.ts.
 *
 * (calcE1RM itself is covered in formulas.test.js; these cover the
 * store-reading aggregation helpers.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock store — must be defined via vi.hoisted so it's available
// before vi.mock() runs (vi.mock is hoisted to top of file).
const { mockStore } = vi.hoisted(() => ({
  mockStore: { unit: 'lbs', entries: [] },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { bestE1RM, getTotal } from '../formulas/e1rm.js';
import { buildEntry } from './helpers/fixtures.js';

beforeEach(() => {
  mockStore.unit = 'lbs';
  mockStore.entries = [];
});

// ---------------------------------------------------------------------------
// bestE1RM
// ---------------------------------------------------------------------------
describe('bestE1RM', () => {
  it('returns null when the lift has no entries', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 315, reps: 5 })];
    expect(bestE1RM('bench')).toBeNull();
  });

  it('returns null when the store has no entries at all', () => {
    expect(bestE1RM('squat')).toBeNull();
  });

  it('returns the stored e1rm for a single set', () => {
    const e = buildEntry({ lift: 'bench', weight: 225, reps: 5 });
    mockStore.entries = [e];
    expect(bestE1RM('bench')).toBe(e.e1rm);
  });

  it('returns the highest e1rm across multiple sets of the same lift', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 315, reps: 3 }),
      buildEntry({ lift: 'squat', weight: 275, reps: 8 }),
      buildEntry({ lift: 'squat', weight: 335, reps: 1 }),
    ];
    const expected = Math.max(...mockStore.entries.map((e) => e.e1rm));
    expect(bestE1RM('squat')).toBe(expected);
  });

  it('weights by e1rm, not raw weight: a high-rep lighter set can win', () => {
    // 225x8 (e1rm 285) beats a 245x1 single (e1rm 245)
    const single = buildEntry({ lift: 'bench', weight: 245, reps: 1 });
    const highRep = buildEntry({ lift: 'bench', weight: 225, reps: 8 });
    mockStore.entries = [single, highRep];
    expect(bestE1RM('bench')).toBe(highRep.e1rm);
    expect(bestE1RM('bench')).toBeGreaterThan(single.e1rm);
  });

  it('ignores entries from other lifts', () => {
    const bench = buildEntry({ lift: 'bench', weight: 225, reps: 5 });
    mockStore.entries = [bench, buildEntry({ lift: 'deadlift', weight: 495, reps: 1 })];
    expect(bestE1RM('bench')).toBe(bench.e1rm);
    expect(bestE1RM('bench')).toBeLessThan(495);
  });

  it('operates on raw stored values regardless of display unit', () => {
    const e = buildEntry({ lift: 'squat', weight: 315, reps: 5 });
    mockStore.entries = [e];
    mockStore.unit = 'kg'; // display unit only — stored entries are canonical
    expect(bestE1RM('squat')).toBe(e.e1rm);
    mockStore.unit = 'lbs';
    expect(bestE1RM('squat')).toBe(e.e1rm);
  });
});

// ---------------------------------------------------------------------------
// getTotal
// ---------------------------------------------------------------------------
describe('getTotal', () => {
  it('returns null when no lift has entries', () => {
    expect(getTotal()).toBeNull();
  });

  it('returns null when any one of the three lifts is missing', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 315, reps: 5 }),
      buildEntry({ lift: 'bench', weight: 225, reps: 5 }),
    ];
    expect(getTotal()).toBeNull();
  });

  it('sums the best e1rm of each lift', () => {
    const s = buildEntry({ lift: 'squat', weight: 315, reps: 5 });
    const sWeak = buildEntry({ lift: 'squat', weight: 225, reps: 5 }); // ignored
    const b = buildEntry({ lift: 'bench', weight: 225, reps: 5 });
    const d = buildEntry({ lift: 'deadlift', weight: 405, reps: 3 });
    mockStore.entries = [s, sWeak, b, d];
    expect(getTotal()).toBeCloseTo(s.e1rm + b.e1rm + d.e1rm, 5);
  });

  it('uses each lift best even when a lift has many sets', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 275, reps: 10 }),
      buildEntry({ lift: 'squat', weight: 315, reps: 5 }),
      buildEntry({ lift: 'bench', weight: 185, reps: 10 }),
      buildEntry({ lift: 'bench', weight: 225, reps: 5 }),
      buildEntry({ lift: 'deadlift', weight: 365, reps: 8 }),
      buildEntry({ lift: 'deadlift', weight: 405, reps: 3 }),
    ];
    const expected = bestE1RM('squat') + bestE1RM('bench') + bestE1RM('deadlift');
    expect(getTotal()).toBeCloseTo(expected, 5);
  });

  it('operates on raw stored values regardless of display unit', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 315, reps: 5 }),
      buildEntry({ lift: 'bench', weight: 225, reps: 5 }),
      buildEntry({ lift: 'deadlift', weight: 405, reps: 3 }),
    ];
    const lbsTotal = getTotal();
    mockStore.unit = 'kg';
    expect(getTotal()).toBe(lbsTotal);
  });
});
