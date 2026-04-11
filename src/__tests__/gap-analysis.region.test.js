/**
 * Regression tests for the region-aware gap analysis + MEV tolerance added
 * to fix the "coach recommended calf raises on bench day" bug.
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

import { resetMockStore, buildEntry, buildAccessoryLog, MS_PER_DAY } from './helpers/fixtures.js';
import { getGapReport } from '../systems/gap-analysis.js';

beforeEach(() => {
  resetMockStore(mockStore);
});

describe('getGapReport — region-aware filtering', () => {
  it('does NOT surface an actionable calves gap on bench day', () => {
    // Zero lower-body training, zero upper-body training — calves are at 0/8.
    // Historically the coach would have recommended a calf raise.
    const gaps = getGapReport('bench');
    const calfGaps = gaps.filter(g =>
      g.muscleGroup === 'Calves' && g.suggestedExercise
    );
    expect(calfGaps).toHaveLength(0);
  });

  it('does NOT return a calf-raise exercise for a chest gap on bench day', () => {
    const gaps = getGapReport('bench');
    // Every actionable (non-deferred) gap must have a null OR non-lower-body
    // suggested exercise.
    const actionable = gaps.filter(g => g.suggestedExercise);
    for (const g of actionable) {
      // The suggested exercise must be a bench-supporting one. 'calf-raise'
      // is tagged supportsLifts: ['squat','deadlift'] — it must never appear.
      expect(g.suggestedExercise.id).not.toBe('calf-raise');
    }
  });

  it('surfaces a chronic cross-region gap as a deferred-gap insight only', () => {
    // Seed enough history (>14 days) with zero calves work — chronic.
    // There must be SOME main-lift activity so analyzeWeeklyVolume's window logic
    // runs cleanly; let's log bench work only.
    mockStore.entries = [
      buildEntry({ lift: 'bench', weight: 225, reps: 5, daysAgo: 1 }),
      buildEntry({ lift: 'bench', weight: 225, reps: 5, daysAgo: 8 }),
    ];
    const gaps = getGapReport('bench');
    const deferred = gaps.filter(g => g.type === 'deferred-gap' && g.muscleGroup === 'Calves');
    // Chronic calves (zero sets for 2+ weeks) → exactly one passive insight.
    expect(deferred.length).toBeGreaterThanOrEqual(1);
    expect(deferred[0].suggestedExercise).toBeNull();
    expect(deferred[0].severity).toBe('low');
  });

  it('suppresses the deferred-gap insight if undertraining is only this week', () => {
    // Seed prior week with some accessory calves work — so only THIS week is under.
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'calf-raise',
        setsCompleted: [15, 15, 15, 15, 15, 15, 15, 15],
        daysAgo: 10,  // last week
      }),
    ];
    const gaps = getGapReport('bench');
    const deferred = gaps.filter(g => g.type === 'deferred-gap' && g.muscleGroup === 'Calves');
    expect(deferred).toHaveLength(0);
  });
});

describe('getGapReport — MEV tolerance', () => {
  it('rates a 2-of-8 chest deficit as high severity on bench day', () => {
    // Log 2 sets of an accessory that primarily targets chest (0.40 chest weight).
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'incline-bench',
        setsCompleted: [8, 8],
        daysAgo: 1,
      }),
    ];
    const gaps = getGapReport('bench');
    const chestGap = gaps.find(g => g.muscleGroup === 'Chest' && g.type === 'volume');
    // At 2/8, ratio = 0.25 < 0.5 — should be high severity.
    expect(chestGap).toBeDefined();
    expect(chestGap.severity).toBe('high');
  });

  it('rates a near-MEV chest count (6/8) as low severity, not high', () => {
    // 6 sets of chest is within 75% of MEV — not truly deficient.
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'incline-bench',
        setsCompleted: [8, 8, 8, 8, 8, 8],
        daysAgo: 1,
      }),
    ];
    const gaps = getGapReport('bench');
    const chestGap = gaps.find(g => g.muscleGroup === 'Chest' && g.type === 'volume');
    // At 6/8, ratio = 0.75 — not < 0.75, so falls into the low bucket.
    expect(chestGap).toBeDefined();
    expect(chestGap.severity).toBe('low');
  });
});
