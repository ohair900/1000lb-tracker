/**
 * Unit tests for src/systems/fatigue.js
 *
 * Focuses on the public API (calcFatigueByMuscle, calcFatigueLift,
 * calcFatigueDetail, invalidateThresholds) rather than the internal EWMA
 * machinery. Tests are shape-and-invariant focused since the exact ACWR
 * numbers depend on personal history which is hard to fixture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    entries: [],
    accessoryLog: [],
    prs: [],
    customAccessories: [],
    customTemplates: [],
    accessoryOverrides: {},
    disabledAccessories: [],
    reasonTagCounts: {},
    workoutSession: null,
    goals: { squat: 405, bench: 315, deadlift: 495 },
    profile: { bodyweight: 180, gender: 'male', bodyweightHistory: [] },
    workoutConfig: { weakPoints: {}, setupComplete: true },
    unit: 'lbs',
    recoveryCalibration: {},
    equipmentProfile: { barbell: true, dumbbell: true, cable: true, machine: true, bodyweight: true },
    programConfig: { activeProgram: null },
    save: () => {},
    saveNow: () => {},
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { resetMockStore, buildEntry, buildAccessoryLog } from './helpers/fixtures.js';
import {
  calcFatigueByMuscle,
  calcFatigueLift,
  calcFatigueDetail,
  invalidateThresholds,
} from '../systems/fatigue.js';
import { MUSCLE_GROUPS } from '../data/muscle-groups.js';

beforeEach(() => {
  resetMockStore(mockStore);
  invalidateThresholds(); // clear any cached threshold state
});

/**
 * Build a realistic fatigue-able history: regular squats across 4 weeks so
 * the ACWR calculation has enough data to seed (requires 3+ entries per
 * muscle in the 28-day window).
 */
function buildSeededHistory() {
  const entries = [];
  for (let w = 0; w < 4; w++) {
    // 2 sessions per week
    entries.push(buildEntry({ lift: 'squat', weight: 315, reps: 5, daysAgo: w * 7 + 1 }));
    entries.push(buildEntry({ lift: 'squat', weight: 275, reps: 5, daysAgo: w * 7 + 4 }));
  }
  return entries;
}

describe('calcFatigueByMuscle', () => {
  it('returns null when store has insufficient data', () => {
    // Empty store → no valid muscles → returns null (not empty object)
    expect(calcFatigueByMuscle()).toBeNull();
  });

  it('with seeded history, returns an object keyed by all muscle groups', () => {
    mockStore.entries = buildSeededHistory();
    const result = calcFatigueByMuscle();
    expect(result).not.toBeNull();
    for (const mg of MUSCLE_GROUPS) {
      expect(mg in result, `missing muscle ${mg}`).toBe(true);
    }
  });

  it('regression (cffb2f8): includes Forearms and Calves keys when seeded', () => {
    mockStore.entries = buildSeededHistory();
    // Seed some grip work to make Forearms appear
    mockStore.accessoryLog = Array.from({ length: 4 }).map((_, i) =>
      buildAccessoryLog({ exerciseId: 'barbell-row', weight: 135, setsCompleted: [8, 8, 8], daysAgo: i * 5 + 2 })
    );
    const result = calcFatigueByMuscle();
    expect(result).not.toBeNull();
    expect('Forearms' in result).toBe(true);
    expect('Calves' in result).toBe(true);
  });

  it('with seeded history: Quads has a non-null fatigue object', () => {
    mockStore.entries = buildSeededHistory();
    const result = calcFatigueByMuscle();
    expect(result.Quads).not.toBeNull();
    expect(result.Quads).toHaveProperty('status');
    expect(result.Quads).toHaveProperty('displayStatus');
    expect(['green', 'lime', 'yellow', 'orange', 'red']).toContain(result.Quads.displayStatus);
  });

  it('with seeded history: recoveryPct (if present) is in [0, 1]', () => {
    mockStore.entries = buildSeededHistory();
    const result = calcFatigueByMuscle();
    const quads = result.Quads;
    if (quads && quads.recoveryPct !== null && quads.recoveryPct !== undefined) {
      expect(quads.recoveryPct).toBeGreaterThanOrEqual(0);
      expect(quads.recoveryPct).toBeLessThanOrEqual(1);
    }
  });

  it('untrained muscles remain null even with history on other muscles', () => {
    mockStore.entries = buildSeededHistory(); // Only squats
    const result = calcFatigueByMuscle();
    expect(result).not.toBeNull();
    // Chest has no squat contribution → should be null (no data)
    expect(result.Chest).toBeNull();
  });
});

describe('calcFatigueLift', () => {
  it('returns null or an object shape for each lift', () => {
    for (const lift of ['squat', 'bench', 'deadlift']) {
      const result = calcFatigueLift(lift);
      if (result !== null) {
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('displayStatus');
      }
    }
  });

  it('returns safe default when no entries exist', () => {
    const result = calcFatigueLift('squat');
    // Should not throw and should have sensible defaults
    expect(result).toBeDefined();
    if (result) expect(['green', 'lime', 'yellow', 'orange', 'red']).toContain(result.displayStatus);
  });
});

describe('calcFatigueDetail', () => {
  it('returns null for muscles with no loading history', () => {
    const detail = calcFatigueDetail('Quads');
    // Empty store → no data → null
    expect(detail).toBeNull();
  });

  it('returns a detail shape when there is enough history', () => {
    mockStore.entries = buildSeededHistory();
    const detail = calcFatigueDetail('Quads');
    expect(detail).not.toBeNull();
    if (detail) {
      expect(detail).toHaveProperty('status');
      expect(detail).toHaveProperty('acwr');
      expect(detail).toHaveProperty('label');
    }
  });

  it('does not throw when called for Forearms or Calves (regression for cffb2f8)', () => {
    expect(() => calcFatigueDetail('Forearms')).not.toThrow();
    expect(() => calcFatigueDetail('Calves')).not.toThrow();
  });
});

describe('invalidateThresholds', () => {
  it('can be called without throwing', () => {
    expect(() => invalidateThresholds()).not.toThrow();
  });

  it('does not break subsequent fatigue calls', () => {
    mockStore.entries = buildSeededHistory();
    invalidateThresholds();
    const result = calcFatigueByMuscle();
    expect(result).not.toBeNull();
    expect('Quads' in result).toBe(true);
  });
});
