/**
 * Unit tests for src/systems/weekly-coverage.js
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
    saveEntries: () => {},
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { resetMockStore, buildEntry, buildAccessoryLog, MS_PER_DAY } from './helpers/fixtures.js';
import { calcWeeklyCoverage, calcAverageMuscleCoverage } from '../systems/weekly-coverage.js';
import { MUSCLE_GROUPS } from '../data/muscle-groups.js';

beforeEach(() => {
  resetMockStore(mockStore);
});

function getMonday(daysAgo = 0) {
  const now = new Date();
  const thisMonday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * MS_PER_DAY);
  thisMonday.setHours(0, 0, 0, 0);
  return new Date(thisMonday.getTime() - daysAgo * MS_PER_DAY);
}

describe('calcWeeklyCoverage', () => {
  it('returns one entry per MUSCLE_GROUPS muscle', () => {
    const coverage = calcWeeklyCoverage(getMonday(), null);
    for (const mg of MUSCLE_GROUPS) {
      expect(coverage[mg]).toBeDefined();
      expect(coverage[mg]).toHaveProperty('sets');
      expect(coverage[mg]).toHaveProperty('volume');
      expect(coverage[mg]).toHaveProperty('status');
      expect(coverage[mg]).toHaveProperty('displayStatus');
    }
  });

  it('returns all muscles as Skipped when there are no entries', () => {
    const coverage = calcWeeklyCoverage(getMonday(), null);
    for (const mg of MUSCLE_GROUPS) {
      expect(coverage[mg].status).toBe('Skipped');
      expect(coverage[mg].displayStatus).toBe('red');
      expect(coverage[mg].volume).toBe(0);
    }
  });

  it('attributes squat entries to Quads/Glutes/Hams via MAIN_LIFT_WEIGHTS', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 2 }),
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 3 }),
    ];
    const coverage = calcWeeklyCoverage(getMonday(), null);
    expect(coverage.Quads.volume).toBeGreaterThan(0);
    expect(coverage.Glutes.volume).toBeGreaterThan(0);
    expect(coverage.Hams.volume).toBeGreaterThan(0);
    // Quads is the largest squat contributor, should be the highest volume
    expect(coverage.Quads.volume).toBeGreaterThan(coverage.Hams.volume);
  });

  it('attributes bench entries to Chest/Shoulders/Triceps', () => {
    mockStore.entries = [buildEntry({ lift: 'bench', weight: 185, reps: 5, daysAgo: 1 })];
    const coverage = calcWeeklyCoverage(getMonday(), null);
    expect(coverage.Chest.volume).toBeGreaterThan(0);
    expect(coverage.Shoulders.volume).toBeGreaterThan(0);
    expect(coverage.Triceps.volume).toBeGreaterThan(0);
    expect(coverage.Quads.volume).toBe(0); // not a squat day
  });

  it('attributes accessory logs via their primaryMuscles', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'calf-raise',
        weight: 200,
        setsCompleted: [15, 15, 15],
        daysAgo: 2,
      }),
    ];
    const coverage = calcWeeklyCoverage(getMonday(), null);
    expect(coverage.Calves.volume).toBeGreaterThan(0);
    expect(coverage.Calves.sets).toBeGreaterThanOrEqual(3);
    expect(coverage.Calves.status).not.toBe('Skipped');
  });

  it('ignores entries outside the week window', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 20 }), // too old
    ];
    const coverage = calcWeeklyCoverage(getMonday(), null);
    expect(coverage.Quads.volume).toBe(0);
  });

  it('returns vsAvg null when no avgVolume is provided', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 1 })];
    const coverage = calcWeeklyCoverage(getMonday(), null);
    expect(coverage.Quads.vsAvg).toBeNull();
  });

  it('computes vsAvg percentage when avgVolume is provided', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 1 })];
    const avgVolume = {};
    MUSCLE_GROUPS.forEach(mg => { avgVolume[mg] = 500; }); // baseline
    const coverage = calcWeeklyCoverage(getMonday(), avgVolume);
    expect(coverage.Quads.vsAvg).not.toBeNull();
    expect(typeof coverage.Quads.vsAvg).toBe('number');
  });

  it('regression: new muscles (Forearms, Calves) are tracked', () => {
    // This would have failed before cffb2f8
    const coverage = calcWeeklyCoverage(getMonday(), null);
    expect(coverage.Forearms).toBeDefined();
    expect(coverage.Calves).toBeDefined();
  });
});

describe('calcAverageMuscleCoverage', () => {
  it('returns null when there is no historical data', () => {
    const avg = calcAverageMuscleCoverage();
    expect(avg).toBeNull();
  });

  it('averages volume across the 4 prior weeks (W-2 to W-5)', () => {
    // Populate entries from 2-5 weeks ago
    mockStore.entries = [];
    for (let w = 2; w <= 5; w++) {
      mockStore.entries.push(buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: w * 7 }));
    }
    const avg = calcAverageMuscleCoverage();
    expect(avg).not.toBeNull();
    expect(avg.Quads).toBeGreaterThan(0);
  });

  it('returns an object with all muscle groups as keys when there IS history', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 14 })];
    const avg = calcAverageMuscleCoverage();
    expect(avg).not.toBeNull();
    for (const mg of MUSCLE_GROUPS) {
      expect(avg[mg]).toBeDefined();
    }
  });
});
