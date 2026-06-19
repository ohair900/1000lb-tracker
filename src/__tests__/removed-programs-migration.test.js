/**
 * Tests for migrateRemovedPrograms — remaps deleted program ids
 * (Starting Strength → StrongLifts 5×5) onto a surviving template.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    programConfig: { activeProgram: null, trainingMaxes: {}, liftWeeks: {} },
    saveProgramConfig: vi.fn(),
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { migrateRemovedPrograms } from '../systems/program-migration.js';

beforeEach(() => {
  mockStore.programConfig = {
    activeProgram: null,
    trainingMaxes: { squat: 200, bench: 150, deadlift: 250 },
    liftWeeks: { squat: 1, bench: 1, deadlift: 1 },
  };
  mockStore.saveProgramConfig.mockClear();
});

describe('migrateRemovedPrograms', () => {
  it('remaps Starting Strength to StrongLifts 5×5 and keeps TMs', () => {
    mockStore.programConfig.activeProgram = 'SS';
    migrateRemovedPrograms();
    expect(mockStore.programConfig.activeProgram).toBe('SL5x5');
    expect(mockStore.programConfig.trainingMaxes).toEqual({
      squat: 200,
      bench: 150,
      deadlift: 250,
    });
    expect(mockStore.saveProgramConfig).toHaveBeenCalled();
  });

  it('leaves a surviving program untouched', () => {
    mockStore.programConfig.activeProgram = '5/3/1';
    migrateRemovedPrograms();
    expect(mockStore.programConfig.activeProgram).toBe('5/3/1');
    expect(mockStore.saveProgramConfig).not.toHaveBeenCalled();
  });

  it('is a no-op when no program is active', () => {
    mockStore.programConfig.activeProgram = null;
    migrateRemovedPrograms();
    expect(mockStore.programConfig.activeProgram).toBe(null);
  });
});
