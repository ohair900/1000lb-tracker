/**
 * Regression tests for the Session Optimizer's coaching filters:
 *  - Calf-on-bench never surfaces as an actionable accessory swap
 *  - GZCL T2 supplemental reduction works the same way 5/3/1 BBB does
 *
 * Upstream systems (fatigue, plateau, gap, comeback) are mocked so the test
 * focuses on the optimizer's own logic: insight + adjustment shaping.
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

import { generateSessionPlan } from '../systems/session-optimizer.js';

beforeEach(() => {
  mockStore.entries = [];
  mockStore.accessoryLog = [];
  mockStore._sessionOptimizer = null;
  mockFatigueLift.current = { status: 'green' };
  mockFatigueByMuscle.current = {};
  mockGapReport.current = [];
});

describe('generateSessionPlan — calf-on-bench never surfaces as swap', () => {
  it('ignores a calf-raise suggestion from gap-analysis (defensive)', () => {
    // Even if gap-analysis somehow returned a calf-raise suggestion for bench
    // day (it shouldn't post-fix), the optimizer's output must never route
    // it into accessorySwaps. The region-filtered gap-analysis makes this
    // unreachable in practice — this guards against a regression.
    mockGapReport.current = [
      // Synthetic deferred gap (no suggestedExercise) — should NOT produce a swap
      {
        type: 'deferred-gap',
        muscleGroup: 'Calves',
        severity: 'low',
        message: 'Calves chronically undertrained — prioritize on your next leg day.',
        suggestedExercise: null,
      },
    ];

    const session = buildBenchSession();
    const plan = generateSessionPlan('bench', session);

    expect(plan.accessorySwaps).toHaveLength(0);
    // But the deferred FYI should show up as an insight (up to 1).
    const deferredInsights = plan.insights.filter(i =>
      i.type === 'gap' && !i.actionable
    );
    expect(deferredInsights.length).toBeGreaterThanOrEqual(1);
  });

  it('turns an in-region gap into an actionable swap insight', () => {
    mockGapReport.current = [
      {
        type: 'volume',
        muscleGroup: 'Chest',
        severity: 'high',
        message: 'Chest: 2/8 sets',
        suggestedExercise: {
          id: 'incline-db-press',
          name: 'Incline DB Press',
          equipment: 'dumbbell',
        },
      },
    ];

    const session = buildBenchSession();
    const plan = generateSessionPlan('bench', session);

    expect(plan.accessorySwaps).toHaveLength(1);
    expect(plan.accessorySwaps[0].suggestedId).toBe('incline-db-press');

    const actionable = plan.insights.find(i => i.type === 'gap' && i.actionable);
    expect(actionable).toBeDefined();
    expect(actionable.swapIndex).toBe(0);
  });

  it('suppresses swap + emits soft insight when target muscle is already red', () => {
    mockFatigueByMuscle.current = {
      Chest: { displayStatus: 'red', status: 'red' },
    };
    mockGapReport.current = [
      {
        type: 'volume',
        muscleGroup: 'Chest',
        severity: 'high',
        message: 'Chest: 2/8 sets',
        suggestedExercise: {
          id: 'incline-db-press',
          name: 'Incline DB Press',
          equipment: 'dumbbell',
        },
      },
    ];

    const session = buildBenchSession();
    const plan = generateSessionPlan('bench', session);

    expect(plan.accessorySwaps).toHaveLength(0);
    const softInsight = plan.insights.find(i =>
      i.type === 'gap' && /fatigue is elevated/i.test(i.text)
    );
    expect(softInsight).toBeDefined();
  });
});

describe('generateSessionPlan — supplemental reduction is tier-aware', () => {
  it('reduces GZCL T2 sets under red fatigue and labels them as T2', () => {
    mockFatigueLift.current = { status: 'red' };
    mockFatigueByMuscle.current = {
      Chest: { displayStatus: 'red' },
    };

    const session = buildBenchSession({ tier: 'T2', setCount: 5 });
    const plan = generateSessionPlan('bench', session);

    expect(plan.supplementalAdjustment).toBeDefined();
    expect(plan.supplementalAdjustment.from).toBe(5);
    expect(plan.supplementalAdjustment.to).toBeLessThan(5);
    expect(plan.supplementalAdjustment.tier).toBe('T2');
    expect(plan.supplementalAdjustment.reason).toMatch(/T2/);
  });

  it('reduces 5/3/1 BBB sets under red fatigue and labels them as BBB', () => {
    mockFatigueLift.current = { status: 'red' };
    mockFatigueByMuscle.current = {
      Quads: { displayStatus: 'red' },
    };

    const session = buildBenchSession({ tier: 'BBB', setCount: 5 });
    const plan = generateSessionPlan('bench', session);

    expect(plan.supplementalAdjustment).toBeDefined();
    expect(plan.supplementalAdjustment.tier).toBe('BBB');
    expect(plan.supplementalAdjustment.reason).toMatch(/BBB/);
  });

  it('does not emit supplementalAdjustment when fatigue is green', () => {
    mockFatigueLift.current = { status: 'green' };
    mockFatigueByMuscle.current = {};

    const session = buildBenchSession({ tier: 'T2', setCount: 5 });
    const plan = generateSessionPlan('bench', session);

    expect(plan.supplementalAdjustment).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBenchSession({ tier = null, setCount = 0 } = {}) {
  const mainSets = [
    { num: 1, weight: 225, reps: 5, pct: 75, tier: 'T1', completed: false },
    { num: 2, weight: 225, reps: 5, pct: 75, tier: 'T1', completed: false },
    { num: 3, weight: 225, reps: 5, pct: 75, tier: 'T1', completed: false },
  ];
  const bbbSets = [];
  if (tier && setCount > 0) {
    for (let i = 0; i < setCount; i++) {
      bbbSets.push({
        num: i + 1,
        weight: 135,
        reps: 10,
        pct: 50,
        tier,
        completed: false,
      });
    }
  }
  const session = {
    id: 'test-session',
    mainLift: 'bench',
    mainSets,
    bbbSets,
    accessories: [],
    completed: false,
  };
  mockStore.workoutSession = session;
  return session;
}
