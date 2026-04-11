/**
 * Lifecycle regression tests for the Session Optimizer.
 *
 * Background: a user discarded a squat workout, started a bench workout, and
 * the coach card appeared to carry squat feedback over. Root cause: the
 * discard handler never cleared store._sessionOptimizer, and the render path
 * didn't verify plan.lift matched the current workout's lift.
 *
 * These tests lock in:
 *  1. generateSessionPlan('bench', ...) after generateSessionPlan('squat', ...)
 *     replaces the plan's lift tag cleanly (no carryover in the state itself).
 *  2. The render guard (plan.lift === session.mainLift) is how the view
 *     prevents a stale plan from appearing, so we simulate it here.
 *  3. A "discard" simulation clears both workoutSession and _sessionOptimizer.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockStore, mockFatigueLift, mockFatigueByMuscle, mockGapReport } = vi.hoisted(() => ({
  mockStore: {
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
  suggestMainLift: () => ({ lift: 'squat', reasons: {}, scores: {} }),
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

import { generateSessionPlan } from '../systems/session-optimizer.js';
import { renderCoachingCard } from '../views/session-coach-ui.js';

beforeEach(() => {
  mockStore.entries = [];
  mockStore.accessoryLog = [];
  mockStore.workoutSession = null;
  mockStore._sessionOptimizer = null;
  mockFatigueLift.current = { status: 'green' };
  mockFatigueByMuscle.current = {};
  mockGapReport.current = [];
});

describe('Session Optimizer — lifecycle', () => {
  it('stores plan.lift === the lift it was generated for', () => {
    const session = buildSession('squat');
    const plan = generateSessionPlan('squat', session);
    expect(plan.lift).toBe('squat');
    expect(mockStore._sessionOptimizer.plan.lift).toBe('squat');
  });

  it('replaces plan.lift when a new plan is generated for a different lift', () => {
    // Plan a squat session, then immediately plan a bench session.
    const squatSession = buildSession('squat');
    generateSessionPlan('squat', squatSession);
    expect(mockStore._sessionOptimizer.plan.lift).toBe('squat');

    const benchSession = buildSession('bench');
    generateSessionPlan('bench', benchSession);
    expect(mockStore._sessionOptimizer.plan.lift).toBe('bench');
    // Evaluations are reset on fresh plan.
    expect(mockStore._sessionOptimizer.evaluations).toEqual([]);
  });

  it('a discard-then-new-workout sequence gives the new lift a fresh plan', () => {
    // 1. Start squat
    generateSessionPlan('squat', buildSession('squat'));
    expect(mockStore._sessionOptimizer.plan.lift).toBe('squat');

    // 2. Discard (simulated — matches the workout-overlay discard handler's
    //    effect on store fields after our fix)
    mockStore.workoutSession = null;
    mockStore._sessionOptimizer = null;

    // 3. Start bench
    mockStore.workoutSession = buildSession('bench');
    generateSessionPlan('bench', mockStore.workoutSession);

    expect(mockStore._sessionOptimizer).not.toBeNull();
    expect(mockStore._sessionOptimizer.plan.lift).toBe('bench');
  });

  it('regenerates the plan when a stale plan from another lift is present', () => {
    // Simulate the situation renderWorkoutView catches: current session is
    // bench, but _sessionOptimizer still carries the previous lift's plan.
    mockStore.workoutSession = buildSession('bench');
    mockStore._sessionOptimizer = {
      plan: { lift: 'squat', insights: [] },
      evaluations: [],
    };

    const isStale =
      !mockStore._sessionOptimizer.plan ||
      mockStore._sessionOptimizer.plan.lift !== mockStore.workoutSession.mainLift;
    expect(isStale).toBe(true);

    // The renderWorkoutView ensure-fresh block calls generateSessionPlan,
    // which replaces the stored plan cleanly.
    generateSessionPlan('bench', mockStore.workoutSession);
    expect(mockStore._sessionOptimizer.plan.lift).toBe('bench');
  });

  it('regenerates the plan when _sessionOptimizer is null at render time', () => {
    // Simulate the situation where the first-open attempt failed silently
    // and left _sessionOptimizer null. The renderWorkoutView ensure-fresh
    // block must still produce a plan for the current session.
    mockStore.workoutSession = buildSession('bench');
    mockStore._sessionOptimizer = null;

    expect(mockStore._sessionOptimizer).toBeNull();

    generateSessionPlan('bench', mockStore.workoutSession);
    expect(mockStore._sessionOptimizer).not.toBeNull();
    expect(mockStore._sessionOptimizer.plan.lift).toBe('bench');
  });

  it('leaves a matching plan untouched if regen is unnecessary', () => {
    // When the stored plan already matches, we still want generateSessionPlan
    // to be callable and produce a fresh plan with the same lift — this is
    // the "regen is idempotent from the user's perspective" invariant.
    mockStore.workoutSession = buildSession('bench');
    generateSessionPlan('bench', mockStore.workoutSession);
    const firstPlan = mockStore._sessionOptimizer.plan;
    expect(firstPlan.lift).toBe('bench');

    // Regen again — plan.lift is still 'bench'.
    generateSessionPlan('bench', mockStore.workoutSession);
    expect(mockStore._sessionOptimizer.plan.lift).toBe('bench');
  });

  it('renders an empty-state card when insights is empty (coach never silent)', () => {
    // All-green upstream state — no fatigue, no gaps, no plateau, no comeback.
    mockFatigueLift.current = { status: 'green' };
    mockFatigueByMuscle.current = {};
    mockGapReport.current = [];

    const session = buildSession('bench');
    const plan = generateSessionPlan('bench', session);
    expect(plan.insights).toEqual([]);

    const html = renderCoachingCard(plan);
    expect(html).not.toBe('');
    expect(html).toMatch(/Bench notes/);
    expect(html).toMatch(/nothing to flag/i);
    expect(html).toMatch(/coach-note-empty/);
  });

  it('renders a full-intensity card (no empty class) when there are real insights', () => {
    // Red fatigue on chest → triggers a fatigue insight.
    mockFatigueLift.current = { status: 'red' };
    mockFatigueByMuscle.current = {
      Chest: { displayStatus: 'red' },
    };

    const session = buildSession('bench');
    const plan = generateSessionPlan('bench', session);
    expect(plan.insights.length).toBeGreaterThan(0);

    const html = renderCoachingCard(plan);
    expect(html).toMatch(/Bench notes/);
    expect(html).not.toMatch(/coach-note-empty/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSession(mainLift) {
  const session = {
    id: `test-${mainLift}`,
    mainLift,
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
