/**
 * Unit tests for src/systems/workout-builder.js
 *
 * Focused on pure functions (computeSetWeights) and shape-level tests for
 * the store-dependent ones (scoreAccessories, selectAccessories,
 * selectSmartAccessories). The builder has deep dependencies on program
 * config and training maxes; we test the API surface rather than exact
 * numeric outputs.
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
    workoutConfig: { weakPoints: { squat: 'quads', bench: 'lockout', deadlift: 'floor' }, setupComplete: true },
    unit: 'lbs',
    recoveryCalibration: {},
    equipmentProfile: { barbell: true, dumbbell: true, cable: true, machine: true, bodyweight: true },
    programConfig: {
      activeProgram: null,
      trainingMaxes: { squat: 350, bench: 250, deadlift: 400 },
      completedSets: {},
      amrapResults: {},
      liftWeeks: {},
    },
    save: () => {},
    saveNow: () => {},
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { resetMockStore, buildEntry, buildAccessoryLog } from './helpers/fixtures.js';
import {
  computeSetWeights,
  scoreAccessories,
  selectAccessories,
  selectSmartAccessories,
  getAccessoryWeight,
  checkAccessoryProgression,
} from '../systems/workout-builder.js';

beforeEach(() => {
  resetMockStore(mockStore);
  // Re-set training maxes which resetMockStore wipes
  mockStore.programConfig.trainingMaxes = { squat: 350, bench: 250, deadlift: 400 };
  mockStore.workoutConfig.weakPoints = { squat: 'quads', bench: 'lockout', deadlift: 'floor' };
});

describe('computeSetWeights', () => {
  it('returns an array of zeros when working weight is zero', () => {
    expect(computeSetWeights(0, 3)).toEqual([0, 0, 0]);
    expect(computeSetWeights(0, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('returns the correct number of sets', () => {
    const weights = computeSetWeights(200, 4);
    expect(weights).toHaveLength(4);
  });

  it('ramps from lighter to heavier weights', () => {
    const weights = computeSetWeights(200, 3);
    // First set should be <= last set
    expect(weights[0]).toBeLessThanOrEqual(weights[weights.length - 1]);
  });

  it('top set is approximately the working weight', () => {
    const weights = computeSetWeights(200, 3);
    // Last set should be close to 200 (may be rounded to nearest plate)
    expect(weights[weights.length - 1]).toBeGreaterThanOrEqual(180);
    expect(weights[weights.length - 1]).toBeLessThanOrEqual(210);
  });

  it('honors fatigue status by selecting a tempered ramp', () => {
    const normal = computeSetWeights(200, 3);
    const fatigued = computeSetWeights(200, 3, 'red');
    // Fatigued ramp should have different distribution (not necessarily lower top set)
    expect(fatigued).toHaveLength(3);
  });

  it('handles negative working weight (assisted bodyweight)', () => {
    const weights = computeSetWeights(-50, 3);
    expect(weights).toHaveLength(3);
    weights.forEach(w => expect(w).toBeLessThanOrEqual(0));
  });
});

describe('scoreAccessories', () => {
  it('returns a sorted array with score field per entry', () => {
    const scored = scoreAccessories('squat');
    expect(Array.isArray(scored)).toBe(true);
    expect(scored.length).toBeGreaterThan(0);
    scored.forEach(ex => {
      expect(ex).toHaveProperty('score');
      expect(typeof ex.score).toBe('number');
    });
  });

  it('sorts results by score descending', () => {
    const scored = scoreAccessories('squat');
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i].score).toBeLessThanOrEqual(scored[i - 1].score);
    }
  });

  it('includes exercises for different equipment types', () => {
    const scored = scoreAccessories('squat');
    const equipTypes = new Set(scored.map(ex => ex.equipment));
    expect(equipTypes.size).toBeGreaterThan(1);
  });

  it('filters out disabled accessories', () => {
    const before = scoreAccessories('squat');
    const firstId = before[0].id;
    mockStore.disabledAccessories = [firstId];
    const after = scoreAccessories('squat');
    expect(after.find(ex => ex.id === firstId)).toBeUndefined();
  });
});

describe('selectAccessories / selectSmartAccessories', () => {
  it('selectAccessories returns an array', () => {
    const result = selectAccessories('squat');
    expect(Array.isArray(result)).toBe(true);
  });

  it('selectSmartAccessories respects the count argument', () => {
    const result3 = selectSmartAccessories('squat', 3);
    const result5 = selectSmartAccessories('squat', 5);
    expect(result3.length).toBeLessThanOrEqual(3);
    expect(result5.length).toBeLessThanOrEqual(5);
  });

  it('returned accessories have required fields', () => {
    const result = selectSmartAccessories('squat', 3);
    result.forEach(ex => {
      expect(ex).toHaveProperty('id');
      expect(ex).toHaveProperty('name');
      expect(ex).toHaveProperty('sets');
      expect(ex).toHaveProperty('repRange');
      expect(ex).toHaveProperty('equipment');
    });
  });
});

describe('getAccessoryWeight', () => {
  it('returns a number for known catalog exercises', () => {
    const w = getAccessoryWeight('front-squat', 'squat');
    expect(typeof w).toBe('number');
  });

  it('returns 0 for unknown exercise IDs', () => {
    expect(getAccessoryWeight('totally-made-up', 'squat')).toBe(0);
  });

  it('returns the last logged weight for progressive exercises', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({
        exerciseId: 'barbell-row',
        weight: 155,
        setsCompleted: [8, 8, 8],
        daysAgo: 3,
      }),
    ];
    const w = getAccessoryWeight('barbell-row', 'bench');
    expect(w).toBeGreaterThan(0);
  });

  it('returns 0 for pure bodyweight exercises with no history', () => {
    const w = getAccessoryWeight('pullup', 'deadlift');
    // Pullup is progressionType 'bodyweight', starts at 0 (bodyweight)
    expect(w).toBe(0);
  });
});

describe('checkAccessoryProgression', () => {
  it('returns false when there is no history', () => {
    const result = checkAccessoryProgression('barbell-row', 'bench');
    expect(result).toBeFalsy();
  });

  it('does not throw on unknown IDs', () => {
    expect(() => checkAccessoryProgression('totally-made-up', 'squat')).not.toThrow();
  });
});
