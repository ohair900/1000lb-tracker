import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    entries: [],
    unit: 'lbs',
    programConfig: {
      activeProgram: null,
      trainingMaxes: {},
      liftWeeks: { squat: 1, bench: 1, deadlift: 1 },
      completedSets: {},
      completedSetData: {},
      amrapResults: {},
      tmHistory: [],
      completedWeeks: {},
      progressedCycles: {},
      autoProgressEnabled: true,
    },
    saveProgramConfig: vi.fn(),
  },
}));

vi.mock('../state/store.js', () => ({ default: mockStore }));

import { getProgramWorkout } from '../systems/programs.js';
import { buildWorkoutReviewGroups, recoverProgramHistory } from '../systems/program-migration.js';

function entry(id, timestamp, weight, reps = 5, lift = 'squat', date = null) {
  return {
    id,
    lift,
    weight,
    reps,
    e1rm: weight * (1 + reps / 30),
    date: date || `2026-05-${String(timestamp).padStart(2, '0')}`,
    timestamp,
    tags: [],
  };
}

beforeEach(() => {
  mockStore.entries = [];
  mockStore.unit = 'lbs';
  mockStore.saveProgramConfig.mockClear();
  mockStore.programConfig = {
    activeProgram: 'SL5x5',
    trainingMaxes: { squat: 405, bench: 250, deadlift: 450 },
    liftWeeks: { squat: 1, bench: 1, deadlift: 1 },
    completedSets: {},
    completedSetData: {},
    amrapResults: {},
    tmHistory: [],
    completedWeeks: {},
    progressedCycles: {},
    autoProgressEnabled: true,
  };
});

describe('program history freezing', () => {
  it('renders completed sets from frozen data while incomplete sets use the current TM', () => {
    mockStore.programConfig.completedSets = { 'squat-1-0': true };
    mockStore.programConfig.completedSetData = {
      'squat-1-0': { weight: 315, reps: 5, tm: 315, date: '2026-05-01', entryId: 'e1' },
    };

    const workout = getProgramWorkout('squat', 1);

    expect(workout.sets[0].weight).toBe(315);
    expect(workout.sets[0].reps).toBe(5);
    expect(workout.sets[1].weight).toBe(405);
    expect(workout.sets[1].reps).toBe(5);
  });

  it('recovers repeated completed sets from distinct logged entries after a TM change', () => {
    mockStore.programConfig.completedSets = {
      'squat-1-0': true,
      'squat-1-1': true,
      'squat-1-2': true,
      'squat-1-3': true,
      'squat-1-4': true,
    };
    mockStore.entries = [
      entry('e1', 1, 315, 5, 'squat', '2026-05-01'),
      entry('e2', 2, 315, 5, 'squat', '2026-05-01'),
      entry('e3', 3, 315, 5, 'squat', '2026-05-01'),
      entry('e4', 4, 315, 5, 'squat', '2026-05-01'),
      entry('e5', 5, 315, 5, 'squat', '2026-05-01'),
    ];

    const result = recoverProgramHistory();
    const recovered = mockStore.programConfig.completedSetData;

    expect(result.recovered).toBe(5);
    expect(Object.values(recovered).map(d => d.weight)).toEqual([315, 315, 315, 315, 315]);
    expect(new Set(Object.values(recovered).map(d => d.entryId))).toEqual(new Set(['e1', 'e2', 'e3', 'e4', 'e5']));
    expect(getProgramWorkout('squat', 1).sets.map(s => s.weight)).toEqual([315, 315, 315, 315, 315]);
  });

  it('preserves user-confirmed frozen rows during recovery', () => {
    mockStore.programConfig.completedSets = { 'squat-1-0': true };
    mockStore.programConfig.completedSetData = {
      'squat-1-0': { weight: 300, reps: 5, tm: 300, date: '2026-05-01', entryId: 'manual' },
    };
    mockStore.entries = [entry('e1', 1, 315)];

    const result = recoverProgramHistory();

    expect(result.recovered).toBe(0);
    expect(mockStore.programConfig.completedSetData['squat-1-0'].weight).toBe(300);
  });

  it('matches real 5/3/1 history by workout date and weights instead of reusing close sets', () => {
    mockStore.programConfig.activeProgram = '5/3/1';
    mockStore.programConfig.trainingMaxes = { bench: 245, squat: 300, deadlift: 385 };
    mockStore.programConfig.completedSets = {};
    for (let week = 1; week <= 6; week++) {
      for (let idx = 0; idx < 3; idx++) {
        mockStore.programConfig.completedSets[`bench-${week}-${idx}`] = true;
      }
    }
    mockStore.programConfig.completedSetData = {};
    mockStore.entries = [
      entry('old1', 1, 215, 3, 'bench', '2026-03-03'),
      entry('old2', 2, 225, 5, 'bench', '2026-03-03'),
      entry('w1a', 10, 155, 5, 'bench', '2026-03-20'),
      entry('w1b', 11, 175, 5, 'bench', '2026-03-20'),
      entry('w1c', 12, 200, 6, 'bench', '2026-03-20'),
      entry('w2a', 20, 165, 3, 'bench', '2026-03-23'),
      entry('w2b', 21, 190, 3, 'bench', '2026-03-23'),
      entry('w2c', 22, 210, 5, 'bench', '2026-03-23'),
      entry('w3a', 30, 175, 5, 'bench', '2026-03-25'),
      entry('w3b', 31, 200, 3, 'bench', '2026-03-25'),
      entry('w3c', 32, 225, 3, 'bench', '2026-03-25'),
      entry('w4a', 40, 95, 5, 'bench', '2026-03-28'),
      entry('w4b', 41, 120, 5, 'bench', '2026-03-28'),
      entry('w4c', 42, 140, 5, 'bench', '2026-03-28'),
      entry('w5a', 50, 165, 5, 'bench', '2026-03-31'),
      entry('w5b', 51, 190, 5, 'bench', '2026-03-31'),
      entry('w5c', 52, 215, 5, 'bench', '2026-03-31'),
      // Same date was logged out of order; recovery should still assign by weight/reps.
      entry('w6b', 61, 205, 3, 'bench', '2026-04-02'),
      entry('w6c', 62, 230, 4, 'bench', '2026-04-02'),
      entry('w6a', 63, 180, 3, 'bench', '2026-04-02'),
    ];

    const result = recoverProgramHistory();

    expect(result.recovered).toBe(18);
    expect(result.unrecoveredKeys).toEqual([]);
    expect(mockStore.programConfig.completedSetData['bench-1-0']).toMatchObject({ date: '2026-03-20', weight: 155, reps: 5 });
    expect(mockStore.programConfig.completedSetData['bench-6-0']).toMatchObject({ date: '2026-04-02', weight: 180, reps: 3 });
    expect(mockStore.programConfig.completedSetData['bench-6-1']).toMatchObject({ date: '2026-04-02', weight: 205, reps: 3 });
    expect(mockStore.programConfig.completedSetData['bench-6-2']).toMatchObject({ date: '2026-04-02', weight: 230, reps: 4 });
  });

  it('surfaces workout-level matches for one-tap review', () => {
    mockStore.programConfig.activeProgram = '5/3/1';
    mockStore.programConfig.trainingMaxes = { bench: 245, squat: 300, deadlift: 385 };
    mockStore.programConfig.completedSets = {
      'bench-1-0': true,
      'bench-1-1': true,
      'bench-1-2': true,
    };
    mockStore.entries = [
      entry('w1a', 10, 155, 5, 'bench', '2026-03-20'),
      entry('w1b', 11, 175, 5, 'bench', '2026-03-20'),
      entry('w1c', 12, 200, 6, 'bench', '2026-03-20'),
    ];

    const groups = buildWorkoutReviewGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0].match.date).toBe('2026-03-20');
    expect(groups[0].match.entries.map(e => `${e.weight}x${e.reps}`)).toEqual(['155x5', '175x5', '200x6']);
  });
});
