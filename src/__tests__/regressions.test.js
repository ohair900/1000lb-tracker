/**
 * Regression tests for historical production bugs.
 *
 * Each test is paired to a commit SHA so the bug history is traceable.
 * These tests encode the exact scenario that broke in production and
 * guard against reintroducing the same class of issue.
 *
 * Format:
 *   describe('SHA — bug description', () => { ... })
 *
 * When a new production bug is fixed, add a regression test here before
 * (or alongside) the fix commit. This file becomes the long-term memory
 * of what has broken in the past.
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
    programConfig: { activeProgram: null, trainingMaxes: { squat: 350, bench: 250, deadlift: 400 }, completedSets: {}, amrapResults: {}, liftWeeks: {} },
    save: () => {},
    saveNow: () => {},
    saveEntries: () => {},
    saveWorkoutSession: () => {},
    saveCustomTemplates: () => {},
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { resetMockStore, buildEntry, buildAccessoryLog } from './helpers/fixtures.js';
import { MUSCLE_GROUPS, MAIN_LIFT_WEIGHTS, ACCESSORY_CAT_WEIGHTS } from '../data/muscle-groups.js';
import { EXERCISE_CATALOG } from '../data/exercise-catalog.js';
import { LEGACY_ID_MAP, resolveExercise, getLegacyIds } from '../data/exercise-compat.js';
import { migrateAccessoryIds } from '../systems/accessory-migration.js';
import { ACCESSORY_MIGRATION_KEY } from '../constants/storage-keys.js';
import { calcWeeklyCoverage } from '../systems/weekly-coverage.js';
import { analyzeWeeklyVolume } from '../systems/gap-analysis.js';

beforeEach(() => {
  resetMockStore(mockStore);
  // Re-set training maxes for workout-builder code paths
  mockStore.programConfig.trainingMaxes = { squat: 350, bench: 250, deadlift: 400 };
  localStorage.clear();
});

// ============================================================================
// 5c56583 — Accessory migration idempotence
// ============================================================================

describe('5c56583 — accessory migration idempotence', () => {
  it('running the migration twice does not corrupt data', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'sq-front' }),
      buildAccessoryLog({ exerciseId: 'bn-row' }),
    ];
    migrateAccessoryIds();
    const afterFirst = mockStore.accessoryLog.map(e => e.exerciseId);
    migrateAccessoryIds();
    const afterSecond = mockStore.accessoryLog.map(e => e.exerciseId);
    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond).toEqual(['front-squat', 'barbell-row']);
  });

  it('version flag prevents re-running even with fresh legacy data', () => {
    localStorage.setItem(ACCESSORY_MIGRATION_KEY, '1');
    mockStore.accessoryLog = [buildAccessoryLog({ exerciseId: 'sq-front' })];
    const result = migrateAccessoryIds();
    expect(result.skipped).toBe(true);
    expect(mockStore.accessoryLog[0].exerciseId).toBe('sq-front'); // untouched
  });
});

// ============================================================================
// cffb2f8 — Forearms and Calves muscle group expansion
// ============================================================================

describe('cffb2f8 — Forearms/Calves rebalance', () => {
  it('MUSCLE_GROUPS contains exactly 12 muscles including Forearms and Calves', () => {
    expect(MUSCLE_GROUPS).toHaveLength(12);
    expect(MUSCLE_GROUPS).toContain('Forearms');
    expect(MUSCLE_GROUPS).toContain('Calves');
  });

  it('every MAIN_LIFT_WEIGHTS lift still sums to 1.0 after adding the new muscles', () => {
    for (const lift of ['squat', 'bench', 'deadlift']) {
      const total = Object.values(MAIN_LIFT_WEIGHTS[lift]).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(0.99);
      expect(total).toBeLessThanOrEqual(1.01);
    }
  });

  it('calf-raise has Calves as its dominant primary muscle', () => {
    // Pre-fix: calf-raise had { Quads: 0.30, Hams: 0.30, Glutes: 0.40 }
    const calfRaise = EXERCISE_CATALOG['calf-raise'];
    expect(calfRaise.primaryMuscles.Calves).toBeGreaterThanOrEqual(0.80);
    expect(calfRaise.primaryMuscles.Quads || 0).toBeLessThan(0.15);
    expect(calfRaise.primaryMuscles.Hams || 0).toBeLessThan(0.15);
  });

  it('farmers-walk has Forearms as primary and Calves as secondary', () => {
    // Pre-fix: farmers-walk was Core-heavy with no Forearms/Calves at all
    const fw = EXERCISE_CATALOG['farmers-walk'];
    expect(fw.primaryMuscles.Forearms).toBeGreaterThanOrEqual(0.15);
    expect(fw.primaryMuscles.Calves).toBeGreaterThan(0);
  });

  it("ACCESSORY_CAT_WEIGHTS.grip isn't dominated by Core", () => {
    // Pre-fix: grip category was { UpperBack: 0.10, LowerBack: 0.20, Core: 0.70 }
    // which was wrong — farmer's walks are grip/forearms, not abs
    const grip = ACCESSORY_CAT_WEIGHTS['grip'];
    expect(grip.Forearms).toBeGreaterThan(grip.Core);
    expect(grip.Forearms).toBeGreaterThanOrEqual(0.30);
  });
});

// ============================================================================
// LEGACY_ID_MAP integrity (structural)
// ============================================================================

describe('exercise-compat — LEGACY_ID_MAP structural integrity', () => {
  it('every legacy ID resolves to an existing catalog entry (no dangling references)', () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_ID_MAP)) {
      expect(EXERCISE_CATALOG[canonical], `${legacy} → ${canonical} dangling`).toBeDefined();
    }
  });

  it('duplicate-pair canonicals have multiple legacy IDs (sq-front AND dl-frontsquat → front-squat)', () => {
    // This is the exact scenario that produced the visible duplicates
    // that the migration fixed.
    const legacyIds = getLegacyIds('front-squat');
    expect(legacyIds).toContain('sq-front');
    expect(legacyIds).toContain('dl-frontsquat');
  });

  it('resolveExercise returns the same catalog entry for canonical and every legacy variant', () => {
    const canonical = resolveExercise('front-squat');
    const legacy1 = resolveExercise('sq-front');
    const legacy2 = resolveExercise('dl-frontsquat');
    expect(legacy1).toBe(canonical);
    expect(legacy2).toBe(canonical);
  });
});

// ============================================================================
// 80f773c — Bodyweight / time exercises invisible in fatigue contributors
// ============================================================================

describe('80f773c — bodyweight/time exercise fatigue invisibility', () => {
  it('pullup accessory entries contribute to weekly coverage', () => {
    // Pre-fix: bodyweight accessories with weight=0 got skipped in coverage
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'pullup',
        weight: 0, // bodyweight
        setsCompleted: [8, 8, 8],
        daysAgo: 1,
      }),
    ];
    const coverage = calcWeeklyCoverage(new Date(Date.now() - 7 * 86400000), null);
    // Pullup targets Upper Back primarily — should register
    expect(coverage['Upper Back'].sets).toBeGreaterThan(0);
  });

  it('dead-hang entries (bodyweight + time) contribute to gap analysis', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'dead-hang',
        weight: 0,
        setsCompleted: [30, 30, 30], // seconds per set
        daysAgo: 1,
      }),
    ];
    const result = analyzeWeeklyVolume();
    // Dead-hang primaryMuscles includes Upper Back and Forearms
    expect(result['Upper Back'].sets + result.Forearms.sets).toBeGreaterThan(0);
  });
});

// ============================================================================
// 18af263 / d8a6889 — This Week coverage badge + modal title
// ============================================================================

describe('18af263 — coverage badge thresholds scaled for 12 muscles', () => {
  it('coverage thresholds work with the current MUSCLE_GROUPS.length', () => {
    // The hitCount thresholds (8 for high, 5 for mid) should be sensible
    // relative to the total muscle count. A >67% hit rate should be "high".
    const total = MUSCLE_GROUPS.length;
    const highThreshold = 8;
    const midThreshold = 5;
    // Sanity: high > 50% and mid > 30%
    expect(highThreshold / total).toBeGreaterThan(0.5);
    expect(midThreshold / total).toBeGreaterThan(0.3);
  });
});

// ============================================================================
// Cross-check: data doesn't drift between muscle-groups.js and exercise-catalog.js
// ============================================================================

describe('cross-data integrity', () => {
  it('every exercise-catalog primaryMuscles key is a valid MUSCLE_GROUPS entry', () => {
    const muscleSet = new Set(MUSCLE_GROUPS);
    for (const [id, ex] of Object.entries(EXERCISE_CATALOG)) {
      for (const mg of Object.keys(ex.primaryMuscles || {})) {
        expect(muscleSet.has(mg), `${id}.primaryMuscles has unknown muscle "${mg}"`).toBe(true);
      }
    }
  });

  it('every MAIN_LIFT_WEIGHTS muscle key is a valid MUSCLE_GROUPS entry', () => {
    const muscleSet = new Set(MUSCLE_GROUPS);
    for (const lift of ['squat', 'bench', 'deadlift']) {
      for (const mg of Object.keys(MAIN_LIFT_WEIGHTS[lift])) {
        expect(muscleSet.has(mg), `MAIN_LIFT_WEIGHTS.${lift}.${mg} not a valid muscle`).toBe(true);
      }
    }
  });
});
