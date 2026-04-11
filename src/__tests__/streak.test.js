/**
 * Unit tests for src/systems/streak.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { resetMockStore, buildEntry, MS_PER_DAY } from './helpers/fixtures.js';
import { calcStreak } from '../systems/streak.js';

beforeEach(() => {
  resetMockStore(mockStore);
});

describe('calcStreak', () => {
  it('returns null when there are no entries', () => {
    expect(calcStreak()).toBeNull();
  });

  it('returns current=1 and longest=1 for a single entry today', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 0 })];
    const s = calcStreak();
    expect(s.current).toBe(1);
    expect(s.longest).toBe(1);
  });

  it('counts consecutive daily entries as a single streak', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 0 }),
      buildEntry({ lift: 'bench', weight: 185, reps: 5, daysAgo: 1 }),
      buildEntry({ lift: 'deadlift', weight: 315, reps: 5, daysAgo: 2 }),
    ];
    const s = calcStreak();
    expect(s.current).toBe(3);
    expect(s.longest).toBeGreaterThanOrEqual(3);
  });

  it('allows up to a 2-day gap and still counts as a streak', () => {
    // Mon -> Wed -> Fri: gap of 2 days each, all within tolerance
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 0 }),
      buildEntry({ lift: 'bench', weight: 185, reps: 5, daysAgo: 2 }),
      buildEntry({ lift: 'deadlift', weight: 315, reps: 5, daysAgo: 4 }),
    ];
    const s = calcStreak();
    expect(s.current).toBe(3);
  });

  it('breaks the current streak on a 3-day gap', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 0 }),
      // 3 day gap (days 1, 2, 3 missed → streak breaks on day 4)
      buildEntry({ lift: 'bench', weight: 185, reps: 5, daysAgo: 4 }),
    ];
    const s = calcStreak();
    expect(s.current).toBe(1);
  });

  it('returns current=0 if the most recent entry is >2 days old', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 5 }),
    ];
    const s = calcStreak();
    expect(s.current).toBe(0);
  });

  it('longest streak is preserved even if current is 0', () => {
    mockStore.entries = [
      // Old streak of 3 days (days ago 10, 11, 12)
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 10 }),
      buildEntry({ lift: 'bench', weight: 185, reps: 5, daysAgo: 11 }),
      buildEntry({ lift: 'deadlift', weight: 315, reps: 5, daysAgo: 12 }),
    ];
    const s = calcStreak();
    expect(s.current).toBe(0);
    expect(s.longest).toBeGreaterThanOrEqual(3);
  });

  it('deduplicates multiple entries on the same day', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 0 }),
      buildEntry({ lift: 'bench', weight: 185, reps: 5, daysAgo: 0 }),
      buildEntry({ lift: 'deadlift', weight: 315, reps: 5, daysAgo: 0 }),
    ];
    const s = calcStreak();
    // One day of training = streak of 1
    expect(s.current).toBe(1);
  });

  it('counts weeksActive in the last 4 weeks', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 0 }),
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 8 }),  // ~1 week ago
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 15 }), // ~2 weeks ago
    ];
    const s = calcStreak();
    expect(s.weeksActive).toBeGreaterThanOrEqual(2);
    expect(s.weeksActive).toBeLessThanOrEqual(4);
  });
});
