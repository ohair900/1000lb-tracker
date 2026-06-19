/**
 * Tests for the bodybuilding split plan: day resolution + rotation
 * (split-plan.js) and clean-scheme double progression (computeSplitTargets).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    entries: [],
    accessoryLog: [],
    prs: [],
    customAccessories: [],
    accessoryOverrides: {},
    disabledAccessories: [],
    workoutSession: null,
    unit: 'lbs',
    recoveryCalibration: {},
    equipmentProfile: {
      barbell: true,
      dumbbell: true,
      cable: true,
      machine: true,
      bodyweight: true,
    },
    programConfig: {
      activeProgram: '__split__',
      trainingMaxes: {},
      splitPlan: { type: 'ppl', dayIndex: 0 },
    },
    save: () => {},
    saveNow: () => {},
    saveProgramConfig: () => {},
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import {
  isSplitActive,
  getSplitDay,
  advanceSplitDay,
  startSplitPlan,
} from '../systems/split-plan.js';
import { computeSplitTargets } from '../systems/workout-builder.js';
import { buildAccessoryLog, buildEntry } from './helpers/fixtures.js';

beforeEach(() => {
  mockStore.entries = [];
  mockStore.accessoryLog = [];
  mockStore.unit = 'lbs';
  mockStore.equipmentProfile = {
    barbell: true,
    dumbbell: true,
    cable: true,
    machine: true,
    bodyweight: true,
  };
  mockStore.programConfig = {
    activeProgram: '__split__',
    trainingMaxes: {},
    splitPlan: { type: 'ppl', dayIndex: 0 },
  };
});

describe('split-plan day resolution', () => {
  it('is active when sentinel + splitPlan are set', () => {
    expect(isSplitActive()).toBe(true);
  });

  it('resolves the Push day with a competition bench primary', () => {
    const day = getSplitDay(0);
    expect(day.label).toBe('Push');
    expect(day.total).toBe(3);
    expect(day.slots[0].isCompLift).toBe(true);
    expect(day.slots[0].compLift).toBe('bench');
    expect(day.slots[0].name).toBe('Bench Press');
  });

  it('falls back to a catalog exercise when the barbell is unavailable', () => {
    mockStore.equipmentProfile.barbell = false;
    const day = getSplitDay(0);
    expect(day.slots[0].isCompLift).toBe(false);
    expect(day.slots[0].exerciseId).toBe('dumbbell-press');
  });

  it('rotates Push → Pull → Legs → Push', () => {
    expect(getSplitDay().label).toBe('Push');
    advanceSplitDay();
    expect(getSplitDay().label).toBe('Pull');
    advanceSplitDay();
    expect(getSplitDay().label).toBe('Legs');
    advanceSplitDay();
    expect(getSplitDay().label).toBe('Push');
  });

  it('startSplitPlan resets to day 0', () => {
    mockStore.programConfig.splitPlan.dayIndex = 2;
    startSplitPlan('ppl');
    expect(mockStore.programConfig.splitPlan.dayIndex).toBe(0);
    expect(mockStore.programConfig.activeProgram).toBe('__split__');
  });
});

describe('computeSplitTargets — competition lift', () => {
  it('seeds weight from e1RM and tags the comp lift', () => {
    mockStore.entries.push(buildEntry({ lift: 'bench', weight: 225, reps: 1 }));
    const slot = getSplitDay(0).slots[0]; // bench primary
    const row = computeSplitTargets(slot);
    expect(row.compLift).toBe('bench');
    expect(row.targetSets).toBe(4);
    expect(row.repRange).toEqual([6, 10]);
    expect(row.setWeights[0]).toBeGreaterThan(0);
    expect(row.setWeights).toHaveLength(4);
  });

  it('uses weight 0 when there is no e1RM history', () => {
    const slot = getSplitDay(0).slots[0];
    const row = computeSplitTargets(slot);
    expect(row.setWeights.every((w) => w === 0)).toBe(true);
  });
});

describe('computeSplitTargets — accessory double progression', () => {
  function lateralRaiseSlot() {
    // Push day isolation slot → lateral-raises, scheme 3×12–15
    return getSplitDay(0).slots.find((s) => s.exerciseId === 'lateral-raises');
  }

  it('first time → weight 0, clean scheme', () => {
    const row = computeSplitTargets(lateralRaiseSlot());
    expect(row.exerciseId).toBe('lateral-raises');
    expect(row.targetSets).toBe(3);
    expect(row.repRange).toEqual([12, 15]);
    expect(row.progressed).toBe(false);
    expect(row.setWeights.every((w) => w === 0)).toBe(true);
  });

  it('all sets hit the top of range → bump weight, reset reps to bottom', () => {
    mockStore.accessoryLog.push(
      buildAccessoryLog({
        exerciseId: 'lateral-raises',
        weight: 20,
        setWeights: [20, 20, 20],
        setsCompleted: [15, 15, 15],
        daysAgo: 3,
      })
    );
    const row = computeSplitTargets(lateralRaiseSlot());
    expect(row.progressed).toBe(true);
    expect(row._targetReps[0]).toBe(12); // reset to bottom
    expect(row.setWeights[0]).toBeGreaterThanOrEqual(20);
  });

  it('did not hit the top → keep weight, climb reps', () => {
    mockStore.accessoryLog.push(
      buildAccessoryLog({
        exerciseId: 'lateral-raises',
        weight: 20,
        setWeights: [20, 20, 20],
        setsCompleted: [12, 12, 12],
        daysAgo: 3,
      })
    );
    const row = computeSplitTargets(lateralRaiseSlot());
    expect(row.progressed).toBe(false);
    expect(row.setWeights[0]).toBe(20);
    expect(row._targetReps[0]).toBe(15); // climb toward the top
  });
});
