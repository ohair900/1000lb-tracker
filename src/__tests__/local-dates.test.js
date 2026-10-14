/**
 * Regression tests for local-wall-clock dates (the "evening shift" bug).
 *
 * Bug: logged sets / streaks / chart buckets used `toISOString()` (UTC),
 * which is already tomorrow after ~5-6 PM in US timezones. The fix routes
 * all "what day is it" computation through localDateStr(), which reads the
 * device's local wall clock (getFullYear/getMonth/getDate).
 *
 * TZ REQUIREMENT: the divergence assertion in the first test only holds
 * when the process timezone is America/Denver, so run this file with
 *   TZ=America/Denver npx vitest run src/__tests__/local-dates.test.js
 * The localDateStr assertions themselves hold in any timezone.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { localDateStr, localDateKey } from '../utils/date.js';

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

import { calcStreak } from '../systems/streak.js';

const DENVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Denver';

beforeEach(() => {
  mockStore.entries = [];
  mockStore.accessoryLog = [];
});

describe('localDateStr', () => {
  it('keeps a Denver evening time on the local day (never shifts to UTC tomorrow)', () => {
    const evening = new Date(2026, 9, 13, 22, 30);
    expect(localDateStr(evening)).toBe('2026-10-13');
    if (DENVER_TZ) {
      // toISOString() — the old buggy source — would report 2026-10-14 here.
      expect(evening.toISOString().split('T')[0]).toBe('2026-10-14');
    }
  });

  it('returns today as a YYYY-MM-DD local date with no argument', () => {
    expect(localDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pads month and day with leading zeros', () => {
    expect(localDateStr(new Date(2026, 0, 5, 9, 15))).toBe('2026-01-05');
  });

  it('localDateKey is the same local-wall-clock function', () => {
    const d = new Date(2026, 4, 9, 12, 0);
    expect(localDateKey(d)).toBe(localDateStr(d));
    expect(localDateKey(d)).toBe('2026-05-09');
  });
});

describe('calcStreak today boundary (consumer spot-check)', () => {
  it('counts an entry dated with localDateStr() as today', () => {
    mockStore.entries = [
      {
        id: 'e-today',
        lift: 'squat',
        weight: 225,
        reps: 5,
        e1rm: 262.5,
        date: localDateStr(),
        timestamp: Date.now(),
        isPR: false,
        tags: [],
      },
    ];
    const s = calcStreak();
    expect(s.current).toBe(1);
    expect(s.longest).toBe(1);
  });
});
