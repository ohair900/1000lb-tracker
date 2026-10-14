/**
 * Regression tests for the gap-analysis / guardrail copy fixes.
 *
 * 1. Never-trained muscle groups report `daysSince: null` (NOT Infinity) —
 *    the old contract rendered the literal text "Infinity days" in the UI.
 * 2. Guardrail copy names the never-trained state ("not trained yet") and
 *    never contains "Infinity".
 * 3. analyzeSessionPushPull — the builder's push:pull verdict — stays
 *    balanced for the Barbell Row + Pull-ups vs bench-main case from the
 *    QA report, and flags a genuinely push-heavy session.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { analyzeRecencyGaps, analyzeSessionPushPull } from '../systems/gap-analysis.js';
import { checkGuardrails } from '../systems/workout-guardrails.js';

beforeEach(() => {
  mockStore.entries = [];
  mockStore.accessoryLog = [];
});

describe('analyzeRecencyGaps — never-trained contract', () => {
  it('returns daysSince: null (not Infinity) for never-trained groups', () => {
    const result = analyzeRecencyGaps();
    expect(result.Core.daysSince).toBeNull();
    expect(result.Chest.daysSince).toBeNull();
  });

  it('marks never-trained groups as stale', () => {
    const result = analyzeRecencyGaps();
    expect(result.Core.status).toBe('stale');
  });

  it('still returns numeric daysSince once a group is trained', () => {
    mockStore.entries = [
      {
        id: 'e-1',
        lift: 'squat',
        weight: 225,
        reps: 5,
        e1rm: 262.5,
        date: '2026-10-10',
        timestamp: Date.now() - 3 * 86400000,
        isPR: false,
        tags: [],
      },
    ];
    const result = analyzeRecencyGaps();
    expect(typeof result.Quads.daysSince).toBe('number');
  });
});

describe('checkGuardrails — never-trained copy', () => {
  it('says "not trained yet" for null daysSince, never "Infinity"', () => {
    const hints = checkGuardrails('squat', []);
    const core = hints.find((h) => h.type === 'core-neglect');
    expect(core).toBeDefined();
    expect(core.message.toLowerCase()).toContain('not trained yet');
    for (const h of hints) {
      expect(h.message).not.toContain('Infinity');
    }
  });
});

describe('analyzeSessionPushPull — builder verdict', () => {
  it('is balanced for bench main + barbell row + pull-ups (the QA-report case)', () => {
    const result = analyzeSessionPushPull('bench', [
      { type: 'main', sets: 5 },
      { exerciseId: 'barbell-row', sets: 3 },
      { exerciseId: 'wide-pullup', sets: 3 },
    ]);
    // 5 push vs 6 pull → ratio ~0.83, inside the 0.67–1.5 balanced band.
    expect(result.pushSets).toBe(5);
    expect(result.pullSets).toBe(6);
    expect(result.status).toBe('balanced');
  });

  it('flags a push-heavy session with no pulls', () => {
    const result = analyzeSessionPushPull('bench', [
      { type: 'main', sets: 5 },
      { exerciseId: 'overhead-press', sets: 3 },
    ]);
    expect(result.status).toBe('push-heavy');
    expect(result.pullSets).toBe(0);
  });

  it('excludes squat/deadlift mains from push:pull entirely', () => {
    const result = analyzeSessionPushPull('squat', [{ type: 'main', sets: 5 }]);
    expect(result.status).toBe('balanced');
    expect(result.pushSets).toBe(0);
  });
});
