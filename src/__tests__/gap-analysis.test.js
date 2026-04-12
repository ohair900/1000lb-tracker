/**
 * Unit tests for src/systems/gap-analysis.js
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
import { analyzeWeeklyVolume, analyzePushPullRatio, analyzeRecencyGaps } from '../systems/gap-analysis.js';
import { MUSCLE_GROUPS, WEEKLY_SET_TARGETS } from '../data/muscle-groups.js';

beforeEach(() => {
  resetMockStore(mockStore);
});

describe('analyzeWeeklyVolume', () => {
  it('returns an entry for every muscle group', () => {
    const result = analyzeWeeklyVolume();
    for (const mg of MUSCLE_GROUPS) {
      expect(result[mg]).toBeDefined();
      expect(result[mg].sets).toBe(0);
      expect(result[mg].target).toBeDefined();
      expect(result[mg].status).toBe('under');
    }
  });

  it('attaches the WEEKLY_SET_TARGETS for each muscle', () => {
    const result = analyzeWeeklyVolume();
    for (const mg of MUSCLE_GROUPS) {
      if (WEEKLY_SET_TARGETS[mg]) {
        expect(result[mg].target.min).toBe(WEEKLY_SET_TARGETS[mg].min);
        expect(result[mg].target.max).toBe(WEEKLY_SET_TARGETS[mg].max);
      }
    }
  });

  it('counts squat entries toward Quads (via MAIN_LIFT_WEIGHTS ≥0.20)', () => {
    // Squat weights Quads 0.32, Glutes 0.20 — both cross the 0.20 bar
    mockStore.entries = Array.from({ length: 5 }, () =>
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 2 })
    );
    const result = analyzeWeeklyVolume();
    expect(result.Quads.sets).toBeGreaterThanOrEqual(5);
    expect(result.Glutes.sets).toBeGreaterThanOrEqual(5);
  });

  it('counts accessory sets by primaryMuscles ≥0.20 as full sets', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'calf-raise', // 0.85 Calves
        setsCompleted: [15, 15, 15],
        daysAgo: 1,
      }),
    ];
    const result = analyzeWeeklyVolume();
    expect(result.Calves.sets).toBeGreaterThanOrEqual(3);
  });

  it('marks muscle as optimal when within target range', () => {
    // Load Quads with enough squat sets to hit min target (8 for Quads)
    mockStore.entries = Array.from({ length: 10 }, () =>
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 2 })
    );
    const result = analyzeWeeklyVolume();
    expect(['optimal', 'over']).toContain(result.Quads.status);
  });

  it('ignores entries older than 7 days', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 10 })];
    const result = analyzeWeeklyVolume();
    expect(result.Quads.sets).toBe(0);
  });

  it('silently skips custom exercises without primaryMuscles (documented behavior)', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'custom-abc123', setsCompleted: [10, 10, 10] }),
    ];
    const result = analyzeWeeklyVolume();
    for (const mg of MUSCLE_GROUPS) {
      expect(result[mg].sets).toBe(0);
    }
  });

  it('regression (cffb2f8): Forearms and Calves are tracked', () => {
    const result = analyzeWeeklyVolume();
    expect(result.Forearms).toBeDefined();
    expect(result.Calves).toBeDefined();
  });
});

describe('analyzePushPullRatio', () => {
  it('returns zero sets when there are no entries', () => {
    const result = analyzePushPullRatio();
    expect(result.pushSets).toBe(0);
    expect(result.pullSets).toBe(0);
  });

  it('does NOT count squat toward pushSets (push:pull is upper-body only)', () => {
    mockStore.entries = Array.from({ length: 5 }, () =>
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 2 })
    );
    const result = analyzePushPullRatio();
    expect(result.pushSets).toBe(0);
    expect(result.pullSets).toBe(0);
  });

  it('does NOT count deadlift toward pushSets (push:pull is upper-body only)', () => {
    mockStore.entries = Array.from({ length: 5 }, () =>
      buildEntry({ lift: 'deadlift', weight: 315, reps: 5, daysAgo: 2 })
    );
    const result = analyzePushPullRatio();
    expect(result.pushSets).toBe(0);
    expect(result.pullSets).toBe(0);
  });

  it('counts bench toward pushSets (horizontal push)', () => {
    mockStore.entries = Array.from({ length: 5 }, () =>
      buildEntry({ lift: 'bench', weight: 185, reps: 5, daysAgo: 2 })
    );
    const result = analyzePushPullRatio();
    expect(result.pushSets).toBeGreaterThan(0);
    expect(result.pullSets).toBe(0);
  });

  it('counts rows (horizontal-pull) toward pullSets', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'barbell-row',
        setsCompleted: [8, 8, 8],
        daysAgo: 2,
      }),
    ];
    const result = analyzePushPullRatio();
    expect(result.pullSets).toBeGreaterThan(0);
    expect(result.pushSets).toBe(0);
  });

  it('does NOT count squat-pattern accessories toward pushSets', () => {
    // Lunges, split squats, calf raises — all lower body, not push
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'lunges', setsCompleted: [10, 10, 10], daysAgo: 2 }),
      buildAccessoryLog({ exerciseId: 'calf-raise', setsCompleted: [15, 15, 15], daysAgo: 2 }),
    ];
    const result = analyzePushPullRatio();
    expect(result.pushSets).toBe(0);
    expect(result.pullSets).toBe(0);
  });

  it('does NOT count hip-hinge accessories toward pushSets', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'rdl', setsCompleted: [8, 8, 8], daysAgo: 2 }),
    ];
    const result = analyzePushPullRatio();
    expect(result.pushSets).toBe(0);
    expect(result.pullSets).toBe(0);
  });

  it('flags push-heavy at ratio >= 1.5, not the old 2.0 threshold', () => {
    // 6 push sets vs 4 pull sets → ratio 1.5 → push-heavy
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'incline-bench', setsCompleted: [8, 8, 8, 8, 8, 8], daysAgo: 2 }),
      buildAccessoryLog({ exerciseId: 'barbell-row', setsCompleted: [8, 8, 8, 8], daysAgo: 2 }),
    ];
    const result = analyzePushPullRatio();
    expect(result.ratio).toBeCloseTo(1.5, 1);
    expect(result.status).toBe('push-heavy');
  });

  it('stays balanced for 1:1 push:pull volume', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'incline-bench', setsCompleted: [8, 8, 8], daysAgo: 2 }),
      buildAccessoryLog({ exerciseId: 'barbell-row', setsCompleted: [8, 8, 8], daysAgo: 2 }),
    ];
    const result = analyzePushPullRatio();
    expect(result.status).toBe('balanced');
  });

  it('returns a valid status field', () => {
    const result = analyzePushPullRatio();
    expect(['balanced', 'push-heavy', 'pull-heavy']).toContain(result.status);
  });
});

describe('analyzeRecencyGaps', () => {
  it('returns Infinity for muscles that were never trained', () => {
    const result = analyzeRecencyGaps();
    for (const mg of MUSCLE_GROUPS) {
      expect(result[mg].daysSince).toBe(Infinity);
    }
  });

  it('returns days since last squat for Quads', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 3 })];
    const result = analyzeRecencyGaps();
    expect(result.Quads.daysSince).toBeLessThanOrEqual(3);
    expect(result.Quads.daysSince).toBeGreaterThanOrEqual(2);
  });

  it('returns the most recent day for a muscle', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 10 }),
      buildEntry({ lift: 'squat', weight: 275, reps: 5, daysAgo: 2 }),
    ];
    const result = analyzeRecencyGaps();
    expect(result.Quads.daysSince).toBeLessThanOrEqual(2);
  });
});
