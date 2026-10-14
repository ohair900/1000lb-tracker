/**
 * Unit tests for the pure injury-aware logic in src/systems/injury.js.
 *
 * The module reads injuries from the store (mocked here, seeded with
 * plain injury objects) and resolves conflicts/substitutes against the
 * static EXERCISE_LOADS / SUBSTITUTES tables in src/data/injury-map.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock store — must be defined via vi.hoisted so it's available
// before vi.mock() runs (vi.mock is hoisted to top of file).
const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    injuries: [],
    getInjuries() {
      return this.injuries;
    },
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import {
  getActiveInjuries,
  findConflicts,
  substituteExercise,
  substituteExerciseList,
} from '../systems/injury.js';

/** Plain-object injury, matching the store's injury shape. */
function buildInjury(overrides = {}) {
  return {
    id: `inj-${Math.random().toString(36).slice(2, 8)}`,
    region: 'wrist',
    side: 'right',
    severity: 'moderate',
    onsetDate: '2026-09-01',
    notes: 'test injury',
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockStore.injuries = [];
});

// ---------------------------------------------------------------------------
// getActiveInjuries
// ---------------------------------------------------------------------------
describe('getActiveInjuries', () => {
  it('returns only injuries marked active', () => {
    mockStore.injuries = [
      buildInjury({ region: 'wrist', active: true }),
      buildInjury({ region: 'knee', active: false }),
    ];
    const active = getActiveInjuries();
    expect(active).toHaveLength(1);
    expect(active[0].region).toBe('wrist');
  });

  it('returns an empty array when no injuries are recorded', () => {
    expect(getActiveInjuries()).toEqual([]);
  });

  it('returns an empty array when all injuries are inactive', () => {
    mockStore.injuries = [buildInjury({ active: false })];
    expect(getActiveInjuries()).toEqual([]);
  });

  it('works with plain injury objects', () => {
    mockStore.injuries = [
      { region: 'shoulder', severity: 'mild', active: true }, // minimal shape
    ];
    const active = getActiveInjuries();
    expect(active).toHaveLength(1);
    expect(active[0].region).toBe('shoulder');
  });
});

// ---------------------------------------------------------------------------
// findConflicts
// ---------------------------------------------------------------------------
describe('findConflicts', () => {
  it('flags pause-bench against a wrist injury (loaded wrist extension)', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    const conflicts = findConflicts(['pause-bench']);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].region).toBe('wrist');
    expect(conflicts[0].severity).toBe('moderate');
    expect(conflicts[0].exerciseId).toBe('pause-bench');
    expect(conflicts[0].reason).toContain('wrist');
    expect(conflicts[0].reason).toContain('loaded wrist extension');
  });

  it('does not flag machine-chest-press against a wrist injury', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    expect(findConflicts(['machine-chest-press'])).toEqual([]);
  });

  it('flags the bare main-lift id "bench" against a wrist injury', () => {
    // The unquoted `bench:` key in EXERCISE_LOADS carries heavy grip +
    // loaded wrist extension, so the main-lift id conflicts too.
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    const conflicts = findConflicts(['bench']);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].region).toBe('wrist');
    expect(conflicts[0].reason).toContain('heavy grip');
    expect(conflicts[0].reason).toContain('loaded wrist extension');
  });

  it('skips unknown exercise ids instead of guessing', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    expect(findConflicts(['not-a-real-exercise'])).toEqual([]);
  });

  it('returns no conflicts when there are no active injuries', () => {
    mockStore.injuries = [buildInjury({ active: false })];
    expect(findConflicts(['pause-bench'])).toEqual([]);
  });

  it('returns an empty array for an empty exercise list', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist' })];
    expect(findConflicts([])).toEqual([]);
  });

  it('flags by joint membership for non-wrist regions', () => {
    mockStore.injuries = [buildInjury({ region: 'elbow', severity: 'mild' })];
    const conflicts = findConflicts(['pause-bench']); // joints include 'elbow'
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].region).toBe('elbow');
  });
});

// ---------------------------------------------------------------------------
// substituteExercise
// ---------------------------------------------------------------------------
describe('substituteExercise', () => {
  it('leaves an exercise unchanged when there is no conflict', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    const res = substituteExercise('machine-chest-press');
    expect(res).toMatchObject({
      exerciseId: 'machine-chest-press',
      originalId: 'machine-chest-press',
      substituted: false,
      dropped: false,
      reason: '',
      injuryRegion: null,
      injurySeverity: null,
    });
  });

  it('leaves everything unchanged when there are no active injuries', () => {
    const res = substituteExercise('pause-bench');
    expect(res).toMatchObject({ exerciseId: 'pause-bench', substituted: false, dropped: false });
  });

  it('swaps bench to machine-chest-press for a moderate wrist injury', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    const res = substituteExercise('bench');
    expect(res).toMatchObject({
      exerciseId: 'machine-chest-press',
      originalId: 'bench',
      substituted: true,
      dropped: false,
      injuryRegion: 'wrist',
      injurySeverity: 'moderate',
    });
    expect(res.reason).toContain('Swapped');
  });

  it('swaps pause-bench to machine-chest-press for a moderate wrist injury', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    const res = substituteExercise('pause-bench');
    expect(res).toMatchObject({
      exerciseId: 'machine-chest-press',
      originalId: 'pause-bench',
      substituted: true,
      dropped: false,
      injuryRegion: 'wrist',
      injurySeverity: 'moderate',
    });
    expect(res.reason).toContain('Swapped');
  });

  it('prefers the specific substitute entry over any generic fallback', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'mild' })];
    // 'bench' variants have exact SUBSTITUTES rows — all land on machine-chest-press
    for (const id of ['pause-bench', 'incline-bench', 'floor-press']) {
      const res = substituteExercise(id);
      expect(res.substituted).toBe(true);
      expect(res.exerciseId).toBe('machine-chest-press');
    }
  });

  it('drops (rest) the pattern with NO substitute for a severe injury', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'severe' })];
    const res = substituteExercise('pause-bench');
    expect(res).toMatchObject({
      exerciseId: 'pause-bench', // original kept — nothing to swap to
      originalId: 'pause-bench',
      substituted: false,
      dropped: true,
      injuryRegion: 'wrist',
      injurySeverity: 'severe',
    });
    expect(res.reason).toContain('Severe');
    expect(res.reason).toContain('rest');
  });

  it('reports a conflict with no listed substitute without swapping or dropping', () => {
    // wrist-curl IS the wrist joint under load — it conflicts by definition
    // and deliberately has no SUBSTITUTES row (there is no safe swap for
    // direct wrist work; the honest answer is to rest it)
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    const res = substituteExercise('wrist-curl');
    expect(res).toMatchObject({
      exerciseId: 'wrist-curl',
      substituted: false,
      dropped: false,
      injuryRegion: 'wrist',
      injurySeverity: 'moderate',
    });
    expect(res.reason).toContain('No safe substitute');
  });
});

// ---------------------------------------------------------------------------
// substituteExerciseList
// ---------------------------------------------------------------------------
describe('substituteExerciseList', () => {
  it('returns adjusted ids plus a substitutions record per exercise', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    const { ids, substitutions } = substituteExerciseList(['pause-bench', 'machine-chest-press']);
    expect(ids).toEqual(['machine-chest-press', 'machine-chest-press']);
    expect(substitutions).toHaveLength(2);
    expect(substitutions[0]).toMatchObject({
      originalId: 'pause-bench',
      exerciseId: 'machine-chest-press',
      substituted: true,
      injuryRegion: 'wrist',
      injurySeverity: 'moderate',
      dropped: false,
    });
    // machine-chest-press had no conflict — recorded as unchanged
    expect(substitutions[1]).toMatchObject({ substituted: false, dropped: false });
  });

  it('dedupes when two originals would map to the same substitute', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'moderate' })];
    const { ids, substitutions } = substituteExerciseList(['pause-bench', 'incline-bench']);
    // second keeps its original to avoid a duplicated exercise in the plan
    expect(ids).toEqual(['machine-chest-press', 'incline-bench']);
    expect(substitutions[1]).toMatchObject({
      exerciseId: 'incline-bench',
      substituted: false,
    });
    expect(substitutions[1].reason).toContain('already in this workout');
  });

  it('carries the severe drop-through with dropped: true', () => {
    mockStore.injuries = [buildInjury({ region: 'wrist', severity: 'severe' })];
    const { ids, substitutions } = substituteExerciseList(['pause-bench']);
    expect(ids).toEqual(['pause-bench']);
    expect(substitutions[0].dropped).toBe(true);
    expect(substitutions[0].substituted).toBe(false);
  });

  it('passes a conflict-free plan through untouched', () => {
    const { ids, substitutions } = substituteExerciseList(['machine-chest-press', 'squat']);
    expect(ids).toEqual(['machine-chest-press', 'squat']);
    expect(substitutions.every((s) => !s.substituted && !s.dropped)).toBe(true);
  });
});
