/**
 * Regression tests for checkCycleBoundaryProgression.
 *
 * The workout overlay only records `completedSets` for MAIN sets — supplemental
 * (BBB/T2) sets just flip an in-session flag. So the cycle-boundary gate must
 * require only PRIMARY sets to be complete, or programs with back-off volume
 * (nSuns, 5/3/1, GZCL) could never auto-progress from the overlay.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    unit: 'lbs',
    programConfig: {
      activeProgram: 'nSuns',
      trainingMaxes: { squat: 400, bench: 250, deadlift: 450 },
      liftWeeks: { squat: 1, bench: 1, deadlift: 1 },
      completedSets: {},
      amrapResults: {},
      tmHistory: [],
    },
    saveProgramConfig: vi.fn(),
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { checkCycleBoundaryProgression } from '../systems/programs.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';

beforeEach(() => {
  mockStore.unit = 'lbs';
  mockStore.programConfig.completedSets = {};
  mockStore.programConfig.amrapResults = {};
  mockStore.programConfig.trainingMaxes = { squat: 400, bench: 250, deadlift: 450 };
});

describe('nSuns cycle progression (supplemental sets not required)', () => {
  const tmpl = PROGRAM_TEMPLATES.nSuns; // weeks:1, 3 primary + 6 T2, amrap

  it('progresses with only the 3 primary sets marked complete', () => {
    // Mark ONLY the primary top sets (template indices 0,1,2) for week 1.
    mockStore.programConfig.completedSets = {
      'squat-1-0': true,
      'squat-1-1': true,
      'squat-1-2': true,
    };
    // AMRAP top set (idx 2 is "95% 1+") hit minimum reps.
    mockStore.programConfig.amrapResults = { 'squat-1-2': 3 };

    const result = checkCycleBoundaryProgression('squat', 1, tmpl);
    expect(result).not.toBeNull();
    expect(result.oldTM).toBe(400);
    expect(result.newTM).toBe(410); // lowerIncrement = 10
  });

  it('does not progress when a primary set is missing', () => {
    mockStore.programConfig.completedSets = {
      'squat-1-0': true,
      'squat-1-1': true,
      // idx 2 (the AMRAP top set) not completed
    };
    mockStore.programConfig.amrapResults = { 'squat-1-2': 3 };

    expect(checkCycleBoundaryProgression('squat', 1, tmpl)).toBeNull();
  });

  it('does not require the T2 back-off sets to be marked complete', () => {
    // Only primaries marked, no T2 (idx 3-8) keys at all → still progresses.
    mockStore.programConfig.completedSets = {
      'bench-1-0': true,
      'bench-1-1': true,
      'bench-1-2': true,
    };
    mockStore.programConfig.amrapResults = { 'bench-1-2': 2 };

    const result = checkCycleBoundaryProgression('bench', 1, tmpl);
    expect(result).not.toBeNull();
    expect(result.newTM).toBe(255); // bench uses upperIncrement = 5
  });
});
