/**
 * Structural tests for the AI coaching export in src/systems/ai-export.js.
 *
 * These assert the shape of the export (JSON parses, required sections
 * present, prompts are non-empty) rather than exact copy, so wording
 * tweaks don't break the suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock store — must be defined via vi.hoisted so it's available
// before vi.mock() runs (vi.mock is hoisted to top of file).
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
    equipmentProfile: {
      barbell: true,
      dumbbell: true,
      cable: true,
      machine: true,
      bodyweight: true,
    },
    programConfig: { activeProgram: null, completedSets: {}, amrapResults: {}, liftWeeks: {} },
    activeMesocycle: null,
    injuries: [],
    getInjuries() {
      return this.injuries;
    },
    save: () => {},
    saveNow: () => {},
    saveEntries: () => {},
    savePRs: () => {},
    saveWorkoutSession: () => {},
    saveProgramConfig: () => {},
    saveCustomTemplates: () => {},
    saveCustomAccessories: () => {},
    saveDisabledAccessories: () => {},
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import {
  buildCoachingData,
  buildCoachingJSON,
  buildCoachingMarkdown,
  buildWeeklyReviewPrompt,
  buildProgramCheckPrompt,
  buildLiftDeepDivePrompt,
} from '../systems/ai-export.js';
import { resetMockStore, buildEntry } from './helpers/fixtures.js';

const EXPECTED_DATA_KEYS = [
  'exportedAt',
  'app',
  'unit',
  'athlete',
  'program',
  'injuries',
  'currentMaxes',
  'e1rmTrends',
  'prs',
  'plateau',
  'recentSessions',
  'fatigue',
];

/** Seed a realistic multi-lift training history plus one wrist injury. */
function seedTrainingData() {
  mockStore.entries = [
    buildEntry({ lift: 'squat', weight: 315, reps: 5, daysAgo: 21 }),
    buildEntry({ lift: 'squat', weight: 335, reps: 3, daysAgo: 14 }),
    buildEntry({ lift: 'squat', weight: 350, reps: 1, daysAgo: 7 }),
    buildEntry({ lift: 'bench', weight: 225, reps: 5, daysAgo: 20 }),
    buildEntry({ lift: 'bench', weight: 245, reps: 3, daysAgo: 13 }),
    buildEntry({ lift: 'bench', weight: 225, reps: 8, daysAgo: 6 }),
    buildEntry({ lift: 'deadlift', weight: 405, reps: 5, daysAgo: 19 }),
    buildEntry({ lift: 'deadlift', weight: 455, reps: 1, daysAgo: 12 }),
  ];
  mockStore.injuries = [
    {
      id: 'inj-wrist-1',
      region: 'wrist',
      side: 'right',
      severity: 'moderate',
      onsetDate: '2026-09-01',
      notes: 'sore after heavy bench',
      active: true,
    },
  ];
}

beforeEach(() => {
  resetMockStore(mockStore);
  mockStore.injuries = [];
  // resetMockStore doesn't know about the injury list — restore the getter
  // in case a test deleted it.
  if (typeof mockStore.getInjuries !== 'function') {
    mockStore.getInjuries = function () {
      return this.injuries;
    };
  }
  mockStore.activeMesocycle = null;
});

// ---------------------------------------------------------------------------
// buildCoachingData
// ---------------------------------------------------------------------------
describe('buildCoachingData', () => {
  it('returns all required top-level sections', () => {
    seedTrainingData();
    const data = buildCoachingData();
    for (const key of EXPECTED_DATA_KEYS) {
      expect(data).toHaveProperty(key);
    }
    expect(data.app).toBe('1000lb Tracker');
    expect(data.unit).toBe('lbs');
    expect(typeof data.exportedAt).toBe('string');
  });

  it('summarizes current maxes and total from the seeded entries', () => {
    seedTrainingData();
    const data = buildCoachingData();
    expect(data.currentMaxes.squat).toBeGreaterThan(0);
    expect(data.currentMaxes.bench).toBeGreaterThan(0);
    expect(data.currentMaxes.deadlift).toBeGreaterThan(0);
    expect(data.athlete.total).toBeCloseTo(
      data.currentMaxes.squat + data.currentMaxes.bench + data.currentMaxes.deadlift,
      5
    );
    expect(data.athlete.bodyweight).toBe(180);
  });

  it('maps recorded injuries into the export', () => {
    seedTrainingData();
    const data = buildCoachingData();
    expect(data.injuries).toHaveLength(1);
    expect(data.injuries[0]).toMatchObject({ severity: 'moderate' });
  });

  it('works on an empty store — every section degrades, none throws', () => {
    const data = buildCoachingData();
    expect(data.currentMaxes).toEqual({ squat: null, bench: null, deadlift: null });
    expect(data.athlete.total).toBeNull();
    expect(data.injuries).toEqual([]);
    expect(JSON.stringify(data)).toBeTruthy();
  });

  it('survives a store without a getInjuries getter', () => {
    delete mockStore.getInjuries;
    seedTrainingData();
    const data = buildCoachingData();
    expect(data.injuries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCoachingJSON
// ---------------------------------------------------------------------------
describe('buildCoachingJSON', () => {
  it('produces parseable JSON with the same shape as buildCoachingData', () => {
    seedTrainingData();
    const parsed = JSON.parse(buildCoachingJSON());
    for (const key of EXPECTED_DATA_KEYS) {
      expect(parsed).toHaveProperty(key);
    }
    expect(parsed.athlete.bodyweight).toBe(180);
    expect(parsed.currentMaxes.bench).toBeGreaterThan(0);
  });

  it('round-trips cleanly (pretty-printed, re-serializable)', () => {
    seedTrainingData();
    const json = buildCoachingJSON();
    expect(JSON.stringify(JSON.parse(json), null, 2)).toBe(json);
  });
});

// ---------------------------------------------------------------------------
// buildCoachingMarkdown
// ---------------------------------------------------------------------------
describe('buildCoachingMarkdown', () => {
  it('opens with a coaching persona and data sections', () => {
    seedTrainingData();
    const md = buildCoachingMarkdown();
    expect(md).toContain('powerlifting coach');
    expect(md).toContain('=== ATHLETE PROFILE ===');
    expect(md).toContain('=== CURRENT MAXES (e1RM) ===');
    expect(md).toContain('=== CURRENT PROGRAM ===');
    expect(md).toContain('=== INJURY PROFILE ===');
    expect(md).toContain('=== E1RM TRENDS');
    expect(md).toContain('=== RECENT PRs ===');
    expect(md).toContain('=== PLATEAU DIAGNOSIS ===');
    expect(md).toContain('=== FATIGUE STATUS ===');
  });

  it('ends with a response format and guardrails', () => {
    seedTrainingData();
    const md = buildCoachingMarkdown();
    expect(md).toContain('=== RESPONSE FORMAT ===');
    expect(md).toContain('**Executive Summary**');
    expect(md).toContain('=== GUARDRAILS ===');
  });

  it('lists the recorded wrist injury with its severity', () => {
    seedTrainingData();
    const md = buildCoachingMarkdown();
    expect(md).toContain('severity: moderate');
    expect(md).toContain('sore after heavy bench');
  });

  it('appends athlete notes when provided', () => {
    seedTrainingData();
    const md = buildCoachingMarkdown('Bench felt heavy this week.');
    expect(md).toContain('=== ATHLETE NOTES ===');
    expect(md).toContain('Bench felt heavy this week.');
  });

  it('degrades gracefully on an empty store', () => {
    const md = buildCoachingMarkdown();
    expect(typeof md).toBe('string');
    expect(md).toContain('No injuries on record.');
    expect(md).toContain('No data');
  });
});

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------
describe('buildWeeklyReviewPrompt', () => {
  it('returns a non-empty weekly-review prompt with this week sections', () => {
    seedTrainingData();
    const prompt = buildWeeklyReviewPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain("=== THIS WEEK'S SESSIONS ===");
    expect(prompt).toContain('=== MUSCLE COVERAGE ===');
    expect(prompt).toContain("**This Week's Focus**");
  });

  it('appends athlete notes when provided', () => {
    const prompt = buildWeeklyReviewPrompt('Deload next week.');
    expect(prompt).toContain('Deload next week.');
  });
});

describe('buildProgramCheckPrompt', () => {
  it('returns a non-empty 90-day program-check prompt', () => {
    seedTrainingData();
    const prompt = buildProgramCheckPrompt();
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('=== E1RM PROGRESSION (Last 90 Days) ===');
    expect(prompt).toContain('=== STRENGTH RATIOS ===');
    expect(prompt).toContain('**90-Day Summary**');
  });

  it('reports insufficient data per lift when the window is empty', () => {
    const prompt = buildProgramCheckPrompt();
    expect(prompt).toContain('Insufficient data');
  });
});

describe('buildLiftDeepDivePrompt', () => {
  it('returns a non-empty deep-dive prompt for bench', () => {
    seedTrainingData();
    const prompt = buildLiftDeepDivePrompt('bench');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain('=== SESSION LOG ===');
    expect(prompt).toContain('=== FREQUENCY & VOLUME ===');
    expect(prompt).toContain('**Lift Health Score**');
  });

  it('handles a lift with no logged data', () => {
    const prompt = buildLiftDeepDivePrompt('squat');
    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('No data');
  });
});
