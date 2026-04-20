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
import { recoverProgramHistory } from '../systems/program-migration.js';

function entry(id, timestamp, weight, reps = 5) {
  return {
    id,
    lift: 'squat',
    weight,
    reps,
    e1rm: weight * (1 + reps / 30),
    date: `2026-05-${String(timestamp).padStart(2, '0')}`,
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
      entry('e1', 1, 315),
      entry('e2', 2, 315),
      entry('e3', 3, 315),
      entry('e4', 4, 315),
      entry('e5', 5, 315),
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
});
