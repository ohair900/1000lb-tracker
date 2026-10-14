/**
 * Regression tests for injury surfacing in the overhaul UI.
 *
 * Locks in:
 *  - getActiveInjuries() degrades to [] when the store shape has no
 *    getInjuries (the defensive fix — no throw).
 *  - substituteExercise severity contract: mild/moderate → region-safe swap
 *    (substituted: true); severe → dropped (rest the pattern); conflict with
 *    no listed swap → reason set, substituted: false, dropped: false, with
 *    UI-facing copy.
 *  - Session-optimizer gap-fill: a suggested exercise that conflicts with an
 *    active wrist injury is replaced by the safe swap and carries `_injury`
 *    so the UI can render the badge; a severe injury drops it instead.
 *
 * The store is mocked (injury.test.js convention); the gap-analysis and
 * sibling systems feeding the optimizer are stubbed so this file only tests
 * the injury-surfacing contracts, not those systems (covered by their own
 * suites).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockStore, mockFatigueLift, mockFatigueByMuscle, mockGapReport } = vi.hoisted(() => ({
  mockStore: {
    injuries: [],
    getInjuries() {
      return this.injuries;
    },
    entries: [],
    accessoryLog: [],
    prs: [],
    customAccessories: [],
    disabledAccessories: [],
    workoutSession: null,
    goals: { squat: 405, bench: 315, deadlift: 495 },
    profile: { bodyweight: 180, gender: 'male', bodyweightHistory: [] },
    workoutConfig: { weakPoints: {}, setupComplete: true },
    unit: 'lbs',
    equipmentProfile: { barbell: true, dumbbell: true, cable: true, machine: true, bodyweight: true },
    programConfig: { activeProgram: null },
    _sessionOptimizer: null,
    save: () => {},
    saveNow: () => {},
    saveWorkoutSession: () => {},
  },
  mockFatigueLift: { current: null },
  mockFatigueByMuscle: { current: null },
  mockGapReport: { current: [] },
}));

vi.mock('../state/store.js', () => ({ default: mockStore }));
vi.mock('../systems/fatigue.js', () => ({
  calcFatigueLift: () => mockFatigueLift.current,
  calcFatigueByMuscle: () => mockFatigueByMuscle.current,
}));
vi.mock('../systems/plateau-breaker.js', () => ({
  diagnosePlateau: () => ({ score: 0, diagnostics: [] }),
}));
vi.mock('../systems/gap-analysis.js', () => ({
  getGapReport: () => mockGapReport.current,
}));
vi.mock('../systems/comeback.js', () => ({ checkComeback: () => null }));
vi.mock('../systems/smart-workout.js', () => ({
  suggestMainLift: () => ({ lift: 'bench', reasons: {}, scores: {} }),
  suggestIntensity: () => ({ pct: 75 }),
}));
vi.mock('../systems/recovery-calibration.js', () => ({
  getCalibratedRecovery: () => null,
}));
vi.mock('../systems/workout-builder.js', () => ({
  selectSmartAccessories: () => [],
  computeSetWeights: (w, n) => Array(n).fill(w),
  getAccessoryWeight: () => 50,
  checkAccessoryProgression: () => false,
}));

import { getActiveInjuries, findConflicts, substituteExercise } from '../systems/injury.js';
import { generateSessionPlan } from '../systems/session-optimizer.js';

function buildInjury(overrides = {}) {
  return {
    id: 'inj-test-1',
    region: 'wrist',
    side: 'right',
    severity: 'moderate',
    onsetDate: '2026-09-01',
    notes: '',
    active: true,
    ...overrides,
  };
}

function buildBenchSession() {
  const session = {
    id: 'test-session',
    mainLift: 'bench',
    mainSets: [
      { num: 1, weight: 225, reps: 5, pct: 75, tier: 'T1', completed: false },
      { num: 2, weight: 225, reps: 5, pct: 75, tier: 'T1', completed: false },
      { num: 3, weight: 225, reps: 5, pct: 75, tier: 'T1', completed: false },
    ],
    bbbSets: [],
    accessories: [],
    completed: false,
  };
  mockStore.workoutSession = session;
  return session;
}

beforeEach(() => {
  mockStore.injuries = [];
  mockStore.entries = [];
  mockStore.accessoryLog = [];
  mockStore._sessionOptimizer = null;
  mockFatigueLift.current = { status: 'green' };
  mockFatigueByMuscle.current = {};
  mockGapReport.current = [];
});

// ---------------------------------------------------------------------------
// getActiveInjuries — defensive when store lacks getInjuries
// ---------------------------------------------------------------------------

describe('getActiveInjuries', () => {
  it('returns [] (no throw) when the store has no getInjuries', () => {
    const saved = mockStore.getInjuries;
    mockStore.getInjuries = undefined;
    try {
      expect(getActiveInjuries()).toEqual([]);
    } finally {
      mockStore.getInjuries = saved;
    }
  });

  it('returns active injuries from the store', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist' })];
    expect(getActiveInjuries()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// substituteExercise severity contract
// ---------------------------------------------------------------------------

describe('substituteExercise severity contract', () => {
  it('mild/moderate conflict → substituted: true with a region-safe swap', () => {
    mockStore.injuries = [buildInjury({ severity: 'moderate' })];
    const res = substituteExercise('barbell-row');
    expect(res.substituted).toBe(true);
    expect(res.dropped).toBe(false);
    expect(res.exerciseId).toBe('machine-row');
    expect(res.injuryRegion).toBe('wrist');
    // Region-safe: the swap itself must not conflict with the wrist injury.
    expect(findConflicts([res.exerciseId])).toHaveLength(0);
    expect(res.reason).toMatch(/wrist/i);
  });

  it('severe conflict → dropped: true (rest the pattern, no substitute)', () => {
    mockStore.injuries = [buildInjury({ severity: 'severe' })];
    const res = substituteExercise('barbell-row');
    expect(res.dropped).toBe(true);
    expect(res.substituted).toBe(false);
    expect(res.exerciseId).toBe('barbell-row');
    expect(res.reason).toMatch(/rest/i);
  });

  it('conflict with no listed swap → reason set, UI copy path intact', () => {
    // kettlebell-swing loads the wrist (heavy grip) but has no wrist-table entry.
    mockStore.injuries = [buildInjury({ severity: 'moderate' })];
    const res = substituteExercise('kettlebell-swing');
    expect(res.substituted).toBe(false);
    expect(res.dropped).toBe(false);
    expect(res.reason).toMatch(/no safe substitute/i);
    expect(res.injuryRegion).toBe('wrist');
  });

  it('no conflict → unchanged exercise', () => {
    mockStore.injuries = [buildInjury({ severity: 'moderate' })];
    const res = substituteExercise('leg-press');
    expect(res.substituted).toBe(false);
    expect(res.dropped).toBe(false);
    expect(res.exerciseId).toBe('leg-press');
  });
});

// ---------------------------------------------------------------------------
// Session-optimizer gap-fill — _injury surfacing
// ---------------------------------------------------------------------------

describe('session-optimizer gap-fill injury surfacing', () => {
  const rowGap = {
    type: 'volume',
    muscleGroup: 'Upper Back',
    severity: 'high',
    message: 'Upper Back: 2/8 sets',
    suggestedExercise: { id: 'barbell-row', name: 'Barbell Row', equipment: 'barbell' },
  };

  it('replaces a conflicting suggestion with the safe swap carrying _injury', () => {
    mockStore.injuries = [buildInjury({ severity: 'moderate' })];
    mockGapReport.current = [rowGap];

    const plan = generateSessionPlan('bench', buildBenchSession());

    expect(plan.accessorySwaps).toHaveLength(1);
    const swap = plan.accessorySwaps[0];
    expect(swap.suggestedId).toBe('machine-row');
    expect(swap._injury).toMatchObject({ kind: 'swapped', region: 'wrist' });
    expect(swap._injury.from).toBe('Barbell Row');
    expect(swap._injury.reason).toMatch(/wrist/i);
  });

  it('drops the suggestion (no swap) when the injury is severe', () => {
    mockStore.injuries = [buildInjury({ severity: 'severe' })];
    mockGapReport.current = [rowGap];

    const plan = generateSessionPlan('bench', buildBenchSession());

    expect(plan.accessorySwaps).toHaveLength(0);
    const severeInsight = plan.insights.find(
      (i) => i.type === 'gap' && /severe/i.test(i.text)
    );
    expect(severeInsight).toBeDefined();
    expect(severeInsight.text).toMatch(/resting instead/i);
  });

  it('passes through untouched when there are no active injuries', () => {
    mockGapReport.current = [rowGap];

    const plan = generateSessionPlan('bench', buildBenchSession());

    expect(plan.accessorySwaps).toHaveLength(1);
    expect(plan.accessorySwaps[0].suggestedId).toBe('barbell-row');
    expect(plan.accessorySwaps[0]._injury).toBeNull();
  });
});
