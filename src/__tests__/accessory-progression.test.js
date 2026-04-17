/**
 * Tests for src/systems/accessory-progression.js — the smart progression engine
 * that replaced the dumb "target = repRange[1]" pattern.
 *
 * Lock-in tests:
 *  - The pull-up "did 8, target was showing 20" bug must never regress.
 *  - First-time, returning, bump, hold, backoff branches all behave correctly.
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
    goals: { squat: 405, bench: 315, deadlift: 495 },
    profile: { bodyweight: 180, gender: 'male', bodyweightHistory: [] },
    workoutConfig: { weakPoints: {}, setupComplete: true },
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

import { buildAccessoryLog, MS_PER_DAY } from './helpers/fixtures.js';
import { computeNextTarget } from '../systems/accessory-progression.js';

beforeEach(() => {
  mockStore.accessoryLog = [];
  mockStore.unit = 'lbs';
  mockStore.programConfig.trainingMaxes = { squat: 350, bench: 250, deadlift: 400 };
});

// ---------------------------------------------------------------------------
// The pull-up bug — never regress
// ---------------------------------------------------------------------------

describe('AMRAP / bodyweight (pull-up bug fix)', () => {
  it('shows last+1 target, not the rep-range ceiling', () => {
    // pullup catalog repRange is [8, 20]. User did 8 last time.
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'pullup',
      weight: 0,
      setsCompleted: [8],
      daysAgo: 3,
    }));

    const px = computeNextTarget('pullup', 'bench');

    expect(px.targetReps[0]).toBe(9);
    expect(px.targetReps[0]).not.toBe(20);    // the bug
    expect(px.message).toContain('9');
    expect(px.message).not.toMatch(/^hit 20/);
    expect(px.action).toBe('progress');
  });

  it('targets last+1 even when the lifter is far below the ceiling', () => {
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'pullup',
      weight: 0,
      setsCompleted: [3],
      daysAgo: 4,
    }));

    const px = computeNextTarget('pullup', 'bench');
    expect(px.targetReps[0]).toBe(4);
  });

  it('does not bump weight on a single ceiling session', () => {
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'pullup',
      weight: 0,
      setsCompleted: [20],
      daysAgo: 3,
    }));

    const px = computeNextTarget('pullup', 'bench');
    expect(px.action).toBe('progress');
    expect(px.targetWeight).toBe(0);
  });

  it('bumps weight after 3 consecutive ceiling sessions', () => {
    for (let i = 1; i <= 3; i++) {
      mockStore.accessoryLog.push(buildAccessoryLog({
        exerciseId: 'pullup',
        weight: 0,
        setsCompleted: [20],
        daysAgo: i * 3,
      }));
    }

    const px = computeNextTarget('pullup', 'bench');
    expect(px.action).toBe('bump');
    expect(px.targetWeight).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Double progression (compound + isolation)
// ---------------------------------------------------------------------------

describe('double progression', () => {
  it('first time → midpoint of rep range, no history', () => {
    const px = computeNextTarget('rdl', 'deadlift');
    expect(px.action).toBe('first');
    expect(px.message).toMatch(/first time/i);
  });

  it('hits last target → progress: each set +1', () => {
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'rdl',
      weight: 185,
      setWeights: [185, 185, 185],
      setsCompleted: [10, 10, 10],
      daysAgo: 4,
    }));

    const px = computeNextTarget('rdl', 'deadlift');
    expect(px.action).toBe('progress');
    expect(px.targetReps).toEqual([11, 11, 11]);
    expect(px.targetWeight).toBe(185);
  });

  it('hits ceiling on every set → bump weight, reset reps', () => {
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'rdl',
      weight: 185,
      setWeights: [185, 185, 185],
      setsCompleted: [12, 12, 12],   // catalog rdl repRange ends at 12
      daysAgo: 4,
    }));

    const px = computeNextTarget('rdl', 'deadlift');
    expect(px.action).toBe('bump');
    expect(px.targetWeight).toBeGreaterThan(185);
    expect(px.targetReps[0]).toBe(8);   // reset to low end
  });

  it('soft miss (1 set below low end) → hold weight, repeat target', () => {
    // rdl repRange [8, 12]. One set fell below 8.
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'rdl',
      weight: 185,
      setWeights: [185, 185, 185],
      setsCompleted: [10, 10, 7],
      daysAgo: 4,
    }));

    const px = computeNextTarget('rdl', 'deadlift');
    expect(px.action).toBe('hold');
    expect(px.targetWeight).toBe(185);
  });

  it('hard miss (2+ sets below low end) → backoff to 92%', () => {
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'rdl',
      weight: 200,
      setWeights: [200, 200, 200],
      setsCompleted: [8, 7, 6],   // 2 sets below low end (8)
      daysAgo: 4,
    }));

    const px = computeNextTarget('rdl', 'deadlift');
    expect(px.action).toBe('backoff');
    expect(px.targetWeight).toBeLessThan(200);
    expect(px.targetWeight).toBeGreaterThan(180);
  });

  it('above-floor session (e.g., 11/11/11) → progress, target [12,12,12]', () => {
    // Solid mid-range work — should progress, never trigger miss.
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'rdl',
      weight: 185,
      setWeights: [185, 185, 185],
      setsCompleted: [12, 12, 11],
      daysAgo: 4,
    }));

    const px = computeNextTarget('rdl', 'deadlift');
    expect(px.action).toBe('progress');
    expect(px.targetReps).toEqual([12, 12, 12]);
  });
});

// ---------------------------------------------------------------------------
// Returning after a long break
// ---------------------------------------------------------------------------

describe('returning after gap', () => {
  it('42+ days off → 80% reload', () => {
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'rdl',
      weight: 200,
      setWeights: [200, 200, 200],
      setsCompleted: [10, 10, 10],
      daysAgo: 50,
    }));

    const px = computeNextTarget('rdl', 'deadlift');
    expect(px.action).toBe('reload');
    expect(px.targetWeight).toBeLessThanOrEqual(200 * 0.85);
    expect(px.message).toMatch(/reload/i);
    expect(px.message).toMatch(/weeks/i);
  });

  it('41 days off → still progresses, no reload', () => {
    mockStore.accessoryLog.push(buildAccessoryLog({
      exerciseId: 'rdl',
      weight: 200,
      setWeights: [200, 200, 200],
      setsCompleted: [10, 10, 10],
      daysAgo: 41,
    }));

    const px = computeNextTarget('rdl', 'deadlift');
    expect(px.action).not.toBe('reload');
  });
});
