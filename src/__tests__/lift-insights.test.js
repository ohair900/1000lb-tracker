/**
 * Tests for src/systems/lift-insights.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getLiftWindow,
  calcVelocity,
  calcBlockOverBlock,
  getTopSets,
  hasRpeData,
  bucketIntensity,
  bucketRepRange,
  bestE1RMAsOf,
} from '../systems/lift-insights.js';

// ---------------------------------------------------------------------------
// Mock store
// ---------------------------------------------------------------------------

const mockStore = vi.hoisted(() => ({ entries: [] }));

vi.mock('../state/store.js', () => ({
  default: mockStore,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(lift, weight, reps, daysAgo, { e1rm, rpe, isPR } = {}) {
  const ts = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  return {
    lift,
    weight,
    reps,
    e1rm: e1rm ?? weight * (1 + reps / 30),
    rpe: rpe ?? null,
    isPR: isPR ?? false,
    date: new Date(ts).toISOString().split('T')[0],
    timestamp: ts,
  };
}

beforeEach(() => {
  mockStore.entries = [];
});

// ---------------------------------------------------------------------------
// getLiftWindow
// ---------------------------------------------------------------------------

describe('getLiftWindow', () => {
  it('filters to the correct lift', () => {
    mockStore.entries = [makeEntry('squat', 200, 5, 10), makeEntry('bench', 150, 5, 10)];
    const result = getLiftWindow('squat', 90);
    expect(result).toHaveLength(1);
    expect(result[0].lift).toBe('squat');
  });

  it('excludes entries outside the day window', () => {
    mockStore.entries = [
      makeEntry('squat', 200, 5, 100), // outside 90d
      makeEntry('squat', 210, 5, 5), // inside 90d
    ];
    const result = getLiftWindow('squat', 90);
    expect(result).toHaveLength(1);
    expect(result[0].weight).toBe(210);
  });

  it('sorts oldest to newest', () => {
    mockStore.entries = [makeEntry('squat', 210, 5, 5), makeEntry('squat', 200, 5, 30)];
    const result = getLiftWindow('squat', 90);
    expect(result[0].weight).toBe(200);
    expect(result[1].weight).toBe(210);
  });
});

// ---------------------------------------------------------------------------
// bestE1RMAsOf
// ---------------------------------------------------------------------------

describe('bestE1RMAsOf', () => {
  it('returns 0 with no entries', () => {
    expect(bestE1RMAsOf('squat', Date.now())).toBe(0);
  });

  it('returns max e1rm up to timestamp', () => {
    const now = Date.now();
    mockStore.entries = [
      { lift: 'squat', weight: 200, reps: 5, e1rm: 233, timestamp: now - 10000 },
      { lift: 'squat', weight: 250, reps: 5, e1rm: 292, timestamp: now + 10000 }, // future
    ];
    expect(bestE1RMAsOf('squat', now)).toBe(233);
  });
});

// ---------------------------------------------------------------------------
// bucketIntensity
// ---------------------------------------------------------------------------

describe('bucketIntensity', () => {
  it('classifies intensity boundary cases correctly', () => {
    const now = Date.now();
    // Entry whose e1rm history has best=100 at the time
    // so 70 lbs = 70%, 80 = 80%, 85 = 85%, 90 = 90%
    const entries = [
      { lift: 'squat', weight: 69, reps: 1, e1rm: 69, timestamp: now }, // <70%
      { lift: 'squat', weight: 70, reps: 1, e1rm: 70, timestamp: now }, // 70% → 70-80%
      { lift: 'squat', weight: 80, reps: 1, e1rm: 80, timestamp: now }, // 80% → 80-85%
      { lift: 'squat', weight: 85, reps: 1, e1rm: 85, timestamp: now }, // 85% → 85-90%
      { lift: 'squat', weight: 90, reps: 1, e1rm: 90, timestamp: now }, // 90% → 90%+
    ];
    // Make bestE1RMAsOf return 100 for these timestamps
    mockStore.entries = [
      { lift: 'squat', weight: 100, reps: 1, e1rm: 100, timestamp: now - 1000 },
      ...entries,
    ];

    const { zones } = bucketIntensity(entries);
    expect(zones['<70%']).toBe(1);
    expect(zones['70-80%']).toBe(1);
    expect(zones['80-85%']).toBe(1);
    expect(zones['85-90%']).toBe(1);
    expect(zones['90%+']).toBe(1);
  });

  it('buckets RPE values correctly', () => {
    const now = Date.now();
    const entries = [
      { lift: 'squat', weight: 100, reps: 5, e1rm: 117, timestamp: now, rpe: 6 },
      { lift: 'squat', weight: 100, reps: 5, e1rm: 117, timestamp: now, rpe: 7 },
      { lift: 'squat', weight: 100, reps: 5, e1rm: 117, timestamp: now, rpe: 8 },
      { lift: 'squat', weight: 100, reps: 5, e1rm: 117, timestamp: now, rpe: 9 },
      { lift: 'squat', weight: 100, reps: 5, e1rm: 117, timestamp: now, rpe: null },
    ];
    const { rpe } = bucketIntensity(entries);
    expect(rpe['6-7']).toBe(1);
    expect(rpe['7-8']).toBe(1);
    expect(rpe['8-9']).toBe(1);
    expect(rpe['9+']).toBe(1);
    expect(rpe['none']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// bucketRepRange
// ---------------------------------------------------------------------------

describe('bucketRepRange', () => {
  it('buckets boundary cases correctly', () => {
    const now = Date.now();
    const entries = [
      { lift: 'squat', weight: 100, reps: 1, e1rm: 100, timestamp: now },
      { lift: 'squat', weight: 100, reps: 2, e1rm: 107, timestamp: now },
      { lift: 'squat', weight: 100, reps: 3, e1rm: 110, timestamp: now },
      { lift: 'squat', weight: 100, reps: 5, e1rm: 117, timestamp: now },
      { lift: 'squat', weight: 100, reps: 6, e1rm: 120, timestamp: now },
      { lift: 'squat', weight: 100, reps: 8, e1rm: 127, timestamp: now },
      { lift: 'squat', weight: 100, reps: 9, e1rm: 130, timestamp: now },
    ];
    const { ranges } = bucketRepRange(entries);
    expect(ranges['Singles (1-2)']).toBe(2);
    expect(ranges['Strength (3-5)']).toBe(2);
    expect(ranges['Volume (6-8)']).toBe(2);
    expect(ranges['Hypertrophy (8+)']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// calcVelocity
// ---------------------------------------------------------------------------

describe('calcVelocity', () => {
  it('returns null with fewer than 2 entries', () => {
    mockStore.entries = [makeEntry('squat', 200, 5, 45)];
    expect(calcVelocity('squat', 90)).toBeNull();
  });

  it('computes positive lbs/month correctly', () => {
    // 90 days span: start e1rm ~233, end ~292 (+59)
    // 59 / (90/30) = ~19.7 lbs/month → strong
    mockStore.entries = [
      makeEntry('squat', 200, 5, 89, { e1rm: 233 }),
      makeEntry('squat', 250, 5, 1, { e1rm: 292 }),
    ];
    const v = calcVelocity('squat', 90);
    expect(v).not.toBeNull();
    expect(v.lbsPerMonth).toBeGreaterThan(0);
    expect(v.classification).toBe('strong');
  });

  it('classifies flat correctly', () => {
    mockStore.entries = [
      makeEntry('squat', 200, 5, 89, { e1rm: 233 }),
      makeEntry('squat', 201, 5, 1, { e1rm: 234 }),
    ];
    const v = calcVelocity('squat', 90);
    expect(v.classification).toBe('flat');
  });

  it('classifies declining correctly', () => {
    mockStore.entries = [
      makeEntry('squat', 220, 5, 89, { e1rm: 257 }),
      makeEntry('squat', 200, 5, 1, { e1rm: 233 }),
    ];
    const v = calcVelocity('squat', 90);
    expect(v.classification).toBe('declining');
  });
});

// ---------------------------------------------------------------------------
// calcBlockOverBlock
// ---------------------------------------------------------------------------

describe('calcBlockOverBlock', () => {
  it('returns 3 blocks', () => {
    mockStore.entries = [makeEntry('squat', 200, 5, 45)];
    const blocks = calcBlockOverBlock('squat', 3, 30);
    expect(blocks).toHaveLength(3);
  });

  it('puts entries in the correct block', () => {
    // Entry 10 days ago → block 3 (last 30 days)
    // Entry 40 days ago → block 2 (30-60 days ago)
    mockStore.entries = [
      makeEntry('squat', 200, 5, 10, { isPR: true }),
      makeEntry('squat', 190, 5, 40),
    ];
    const blocks = calcBlockOverBlock('squat', 3, 30);
    expect(blocks[2].sets).toBe(1);
    expect(blocks[2].prCount).toBe(1);
    expect(blocks[1].sets).toBe(1);
    expect(blocks[0].sets).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getTopSets
// ---------------------------------------------------------------------------

describe('getTopSets', () => {
  it('returns top N sorted by e1rm descending', () => {
    mockStore.entries = [
      makeEntry('squat', 200, 5, 10, { e1rm: 233 }),
      makeEntry('squat', 250, 5, 20, { e1rm: 292 }),
      makeEntry('squat', 175, 5, 30, { e1rm: 204 }),
    ];
    const top = getTopSets('squat', 2);
    expect(top).toHaveLength(2);
    expect(top[0].e1rm).toBe(292);
    expect(top[1].e1rm).toBe(233);
  });

  it('dedupes identical date/weight/reps', () => {
    const entry = makeEntry('squat', 250, 5, 10, { e1rm: 292 });
    mockStore.entries = [entry, { ...entry }]; // duplicate
    const top = getTopSets('squat', 5);
    expect(top).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// hasRpeData
// ---------------------------------------------------------------------------

describe('hasRpeData', () => {
  it('returns true when >40% have rpe', () => {
    mockStore.entries = [
      makeEntry('squat', 200, 5, 10, { rpe: 8 }),
      makeEntry('squat', 200, 5, 20, { rpe: 7 }),
      makeEntry('squat', 200, 5, 30, { rpe: null }),
    ];
    expect(hasRpeData('squat', 90)).toBe(true);
  });

  it('returns false when ≤40% have rpe', () => {
    mockStore.entries = [
      makeEntry('squat', 200, 5, 10, { rpe: 8 }),
      makeEntry('squat', 200, 5, 20, { rpe: null }),
      makeEntry('squat', 200, 5, 30, { rpe: null }),
    ];
    expect(hasRpeData('squat', 90)).toBe(false);
  });

  it('returns false with no entries', () => {
    mockStore.entries = [];
    expect(hasRpeData('squat', 90)).toBe(false);
  });
});
