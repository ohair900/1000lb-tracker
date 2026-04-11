/**
 * Unit tests for src/systems/accessory-migration.js
 *
 * Verifies the one-time legacy ID → canonical ID rewrite across all 6
 * affected stores, including idempotence and edge cases.
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
    programConfig: { activeProgram: null, completedSets: {}, amrapResults: {}, liftWeeks: {} },
    save: () => {},
    saveNow: () => {},
    saveEntries: () => {},
    saveWorkoutSession: () => {},
    saveCustomTemplates: () => {},
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { resetMockStore, buildAccessoryLog } from './helpers/fixtures.js';
import { migrateAccessoryIds } from '../systems/accessory-migration.js';
import { ACCESSORY_MIGRATION_KEY } from '../constants/storage-keys.js';

beforeEach(() => {
  resetMockStore(mockStore);
  localStorage.clear();
});

describe('migrateAccessoryIds: happy path', () => {
  it('rewrites legacy exerciseIds in accessoryLog to canonical IDs', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'sq-front', mainLift: 'squat' }),
      buildAccessoryLog({ exerciseId: 'dl-frontsquat', mainLift: 'deadlift' }),
      buildAccessoryLog({ exerciseId: 'bn-row', mainLift: 'bench' }),
    ];
    const result = migrateAccessoryIds();

    expect(result.skipped).toBe(false);
    expect(result.migrated).toBeGreaterThanOrEqual(3);
    expect(mockStore.accessoryLog[0].exerciseId).toBe('front-squat');
    expect(mockStore.accessoryLog[1].exerciseId).toBe('front-squat');
    expect(mockStore.accessoryLog[2].exerciseId).toBe('barbell-row');
  });

  it('leaves canonical exerciseIds unchanged', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'front-squat' }),
      buildAccessoryLog({ exerciseId: 'pause-squat' }),
    ];
    migrateAccessoryIds();
    expect(mockStore.accessoryLog[0].exerciseId).toBe('front-squat');
    expect(mockStore.accessoryLog[1].exerciseId).toBe('pause-squat');
  });

  it('sets the migration version flag in localStorage', () => {
    migrateAccessoryIds();
    expect(localStorage.getItem(ACCESSORY_MIGRATION_KEY)).toBe('1');
  });
});

describe('migrateAccessoryIds: idempotence', () => {
  it('second invocation is a no-op when version flag is already set', () => {
    mockStore.accessoryLog = [buildAccessoryLog({ exerciseId: 'sq-front' })];
    const first = migrateAccessoryIds();
    expect(first.skipped).toBe(false);

    // Re-run
    const second = migrateAccessoryIds();
    expect(second.skipped).toBe(true);
    expect(second.migrated).toBe(0);
  });

  it('running twice does not corrupt already-canonical data', () => {
    mockStore.accessoryLog = [buildAccessoryLog({ exerciseId: 'sq-front' })];
    migrateAccessoryIds();
    const afterFirst = mockStore.accessoryLog[0].exerciseId;
    migrateAccessoryIds();
    expect(mockStore.accessoryLog[0].exerciseId).toBe(afterFirst);
  });
});

describe('migrateAccessoryIds: customTemplates', () => {
  it('rewrites exerciseIds inside saved templates', () => {
    mockStore.customTemplates = [
      {
        id: 'tmpl-1',
        name: 'Squat Day',
        exercises: [
          { exerciseId: 'sq-front', sets: 3, repRange: [8, 12] },
          { exerciseId: 'sq-calfraise', sets: 3, repRange: [12, 20] },
        ],
      },
    ];
    migrateAccessoryIds();
    expect(mockStore.customTemplates[0].exercises[0].exerciseId).toBe('front-squat');
    expect(mockStore.customTemplates[0].exercises[1].exerciseId).toBe('calf-raise');
  });

  it('skips templates without exercises safely', () => {
    mockStore.customTemplates = [
      { id: 'tmpl-1', name: 'Empty' },  // no exercises field
      { id: 'tmpl-2', name: 'Also empty', exercises: [] },
    ];
    expect(() => migrateAccessoryIds()).not.toThrow();
  });
});

describe('migrateAccessoryIds: workoutSession', () => {
  it('rewrites exerciseIds on in-progress session accessories', () => {
    mockStore.workoutSession = {
      id: 'ws1',
      mainLift: 'squat',
      accessories: [
        { exerciseId: 'sq-rdl', setWeights: [135], targetSets: 3, setsCompleted: [] },
      ],
    };
    migrateAccessoryIds();
    expect(mockStore.workoutSession.accessories[0].exerciseId).toBe('rdl');
  });

  it('handles null workoutSession', () => {
    mockStore.workoutSession = null;
    expect(() => migrateAccessoryIds()).not.toThrow();
  });
});

describe('migrateAccessoryIds: accessoryOverrides', () => {
  it('re-keys overrides from legacy to canonical', () => {
    mockStore.accessoryOverrides = {
      'sq-front': { sets: 4, repRange: [6, 10] },
      'bn-row': { sets: 5 },
    };
    migrateAccessoryIds();
    expect(mockStore.accessoryOverrides['sq-front']).toBeUndefined();
    expect(mockStore.accessoryOverrides['bn-row']).toBeUndefined();
    expect(mockStore.accessoryOverrides['front-squat']).toEqual({ sets: 4, repRange: [6, 10] });
    expect(mockStore.accessoryOverrides['barbell-row']).toEqual({ sets: 5 });
  });

  it('when both legacy and canonical overrides exist, canonical wins (deterministic)', () => {
    // This scenario happens if a user edited an override on both legacy and canonical IDs.
    // Canonical is set first (from existing state), legacy is then seen and would try to
    // write, but the implementation guards with `if (!newOverrides[canon])`. So canonical
    // wins when it already exists in the new map.
    mockStore.accessoryOverrides = {
      'front-squat': { sets: 10 }, // canonical wins
      'sq-front': { sets: 3 },
    };
    migrateAccessoryIds();
    // Whichever the iteration visited first and set the canonical key wins. Since
    // Object.entries iterates insertion order, the canonical entry is set first.
    expect(mockStore.accessoryOverrides['front-squat'].sets).toBe(10);
    expect(mockStore.accessoryOverrides['sq-front']).toBeUndefined();
  });
});

describe('migrateAccessoryIds: disabledAccessories', () => {
  it('re-keys disabled list and dedupes', () => {
    mockStore.disabledAccessories = ['sq-front', 'bn-row', 'front-squat'];
    migrateAccessoryIds();
    expect(mockStore.disabledAccessories).toContain('front-squat');
    expect(mockStore.disabledAccessories).toContain('barbell-row');
    expect(mockStore.disabledAccessories).not.toContain('sq-front');
    // Dedupe — front-squat should appear only once
    expect(mockStore.disabledAccessories.filter(id => id === 'front-squat')).toHaveLength(1);
  });
});

describe('migrateAccessoryIds: reasonTagCounts', () => {
  it('re-keys and sums counts on collision', () => {
    mockStore.reasonTagCounts = {
      'sq-front': 3,
      'front-squat': 5,
      'bn-row': 2,
    };
    migrateAccessoryIds();
    // sq-front (3) + front-squat (5) = 8
    expect(mockStore.reasonTagCounts['front-squat']).toBe(8);
    expect(mockStore.reasonTagCounts['sq-front']).toBeUndefined();
    expect(mockStore.reasonTagCounts['barbell-row']).toBe(2);
  });
});

describe('migrateAccessoryIds: edge cases', () => {
  it('handles empty stores without throwing', () => {
    // All stores empty (default after reset)
    const result = migrateAccessoryIds();
    expect(result.skipped).toBe(false);
    expect(result.migrated).toBe(0);
  });

  it('custom exercise IDs (custom-*) pass through unchanged', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'custom-abc123' }),
      buildAccessoryLog({ exerciseId: 'custom-9999' }),
    ];
    migrateAccessoryIds();
    expect(mockStore.accessoryLog[0].exerciseId).toBe('custom-abc123');
    expect(mockStore.accessoryLog[1].exerciseId).toBe('custom-9999');
  });

  it('unknown IDs (neither legacy nor canonical) pass through unchanged', () => {
    mockStore.accessoryLog = [
      buildAccessoryLog({ exerciseId: 'totally-made-up' }),
    ];
    migrateAccessoryIds();
    expect(mockStore.accessoryLog[0].exerciseId).toBe('totally-made-up');
  });

  it('does not touch entries without exerciseId', () => {
    mockStore.accessoryLog = [
      { id: 'a1', date: '2026-01-01', timestamp: Date.now() }, // no exerciseId
    ];
    expect(() => migrateAccessoryIds()).not.toThrow();
  });
});
