/**
 * Unit tests for src/systems/pr-tracking.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    equipmentProfile: { barbell: true, dumbbell: true, cable: true, machine: true, bodyweight: true },
    programConfig: { activeProgram: null, completedSets: {}, amrapResults: {}, liftWeeks: {} },
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

import { resetMockStore, buildEntry } from './helpers/fixtures.js';
import { rebuildPRs, checkPR, checkRepPR, getMilestone, getRepPRs } from '../systems/pr-tracking.js';

beforeEach(() => {
  resetMockStore(mockStore);
});

describe('rebuildPRs', () => {
  it('marks the first entry of a lift as a PR', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 10 })];
    rebuildPRs();
    expect(mockStore.entries[0].isPR).toBe(true);
    expect(mockStore.prs).toHaveLength(1);
    expect(mockStore.prs[0].lift).toBe('squat');
  });

  it('only marks chronologically-ascending e1RMs as PRs', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 20 }), // e1RM ~262
      buildEntry({ lift: 'squat', weight: 200, reps: 5, daysAgo: 15 }), // ~233, not a PR
      buildEntry({ lift: 'squat', weight: 275, reps: 3, daysAgo: 10 }), // ~302, PR
      buildEntry({ lift: 'squat', weight: 250, reps: 5, daysAgo: 5 }),  // ~291, not a PR (below 302)
    ];
    rebuildPRs();
    const prs = mockStore.entries.filter(e => e.isPR);
    expect(prs).toHaveLength(2);
    expect(mockStore.prs).toHaveLength(2);
  });

  it('tracks PRs per lift independently', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 10 }),
      buildEntry({ lift: 'bench', weight: 185, reps: 5, daysAgo: 10 }),
      buildEntry({ lift: 'deadlift', weight: 315, reps: 5, daysAgo: 10 }),
    ];
    rebuildPRs();
    expect(mockStore.prs.map(p => p.lift).sort()).toEqual(['bench', 'deadlift', 'squat']);
  });

  it('resets isPR flags when rebuilding', () => {
    const entry = buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 20 });
    entry.isPR = true; // stale flag
    const beater = buildEntry({ lift: 'squat', weight: 275, reps: 5, daysAgo: 10 });
    mockStore.entries = [entry, beater];
    rebuildPRs();
    // After rebuild: 225x5 is still first so it's PR, beater is also PR
    expect(mockStore.entries.filter(e => e.isPR)).toHaveLength(2);
  });

  it('assigns plate milestone only on first-time crossing', () => {
    mockStore.entries = [
      // First PR: e1RM = 225 * (1 + 1/30) = 232.5, crosses 225
      buildEntry({ lift: 'squat', weight: 225, reps: 1, daysAgo: 30 }),
      // Second PR: e1RM ~261, still above 225 but already achieved
      buildEntry({ lift: 'squat', weight: 250, reps: 1, daysAgo: 20 }),
      // Third PR: e1RM ~316, crosses 315
      buildEntry({ lift: 'squat', weight: 305, reps: 1, daysAgo: 10 }),
    ];
    rebuildPRs();
    const milestones = mockStore.prs.map(p => p.milestone);
    // First: milestone = '225'
    // Second: no new milestone (already have 225) → null
    // Third: crosses 315 → '315'
    expect(milestones[0]).toBe('225');
    expect(milestones[1]).toBeNull();
    expect(milestones[2]).toBe('315');
  });
});

describe('checkPR', () => {
  it('returns true for empty entries', () => {
    expect(checkPR('squat', 100)).toBe(true);
  });

  it('returns true when e1rm beats the existing best', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5 })]; // e1rm ~262
    expect(checkPR('squat', 270)).toBe(true);
  });

  it('returns false when e1rm is equal to the existing best', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5 })];
    const existing = mockStore.entries[0].e1rm;
    expect(checkPR('squat', existing)).toBe(false);
  });

  it('returns false when e1rm is below the existing best', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 300, reps: 5 })];
    expect(checkPR('squat', 250)).toBe(false);
  });

  it('only considers entries of the matching lift', () => {
    mockStore.entries = [buildEntry({ lift: 'bench', weight: 400, reps: 5 })];
    // Squat has no entries, so any positive e1rm is a PR
    expect(checkPR('squat', 100)).toBe(true);
  });
});

describe('checkRepPR', () => {
  it('returns true when no prior entry at that rep count', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5 })];
    expect(checkRepPR('squat', 250, 3)).toBe(true); // new rep count
  });

  it('returns true when weight exceeds best at that rep count', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5 })];
    expect(checkRepPR('squat', 275, 5)).toBe(true);
  });

  it('returns false when weight equals existing best', () => {
    mockStore.entries = [buildEntry({ lift: 'squat', weight: 225, reps: 5 })];
    expect(checkRepPR('squat', 225, 5)).toBe(false);
  });

  it('is independent across rep counts', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 315, reps: 5 }),
      buildEntry({ lift: 'squat', weight: 225, reps: 10 }),
    ];
    // 300 at 3 reps is a new rep-count bucket
    expect(checkRepPR('squat', 300, 3)).toBe(true);
    // 300 at 10 reps beats 225 → PR
    expect(checkRepPR('squat', 300, 10)).toBe(true);
    // 225 at 10 reps ties existing → not PR
    expect(checkRepPR('squat', 225, 10)).toBe(false);
  });
});

describe('getMilestone', () => {
  it('returns the biggest fresh milestone crossed', () => {
    // No previous PRs → crossing 225 and 135 → biggest is 225
    expect(getMilestone('squat', 260)).toBe('225');
  });

  it('returns null when no plate milestone is crossed', () => {
    expect(getMilestone('squat', 100)).toBeNull();
  });

  it('skips already-achieved milestones', () => {
    // The achieved set is built from store.prs[].milestone, so we need to
    // include every milestone that's been crossed. In rebuildPRs this would
    // happen naturally across multiple entries; here we simulate it.
    mockStore.prs = [
      { lift: 'squat', e1rm: 140, entryId: 'x1', date: '2025-01-01', timestamp: Date.now() - 1000, milestone: '135' },
      { lift: 'squat', e1rm: 260, entryId: 'x2', date: '2026-01-01', timestamp: Date.now(), milestone: '225' },
    ];
    // Crossing 315 for the first time → fresh milestone
    expect(getMilestone('squat', 320)).toBe('315');
    // Re-hitting 270 → 135 and 225 both already achieved → null
    expect(getMilestone('squat', 270)).toBeNull();
  });

  it('only considers milestones for the matching lift', () => {
    mockStore.prs = [
      { lift: 'bench', e1rm: 260, entryId: 'x', date: '2026-01-01', timestamp: Date.now(), milestone: '225' },
    ];
    // Squat has no achieved milestones, so 260 e1rm crosses 225 fresh
    expect(getMilestone('squat', 260)).toBe('225');
  });
});

describe('getRepPRs', () => {
  it('returns empty objects for a fresh store', () => {
    const repPRs = getRepPRs();
    expect(repPRs).toEqual({ squat: {}, bench: {}, deadlift: {} });
  });

  it('tracks best weight per rep count per lift', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5, daysAgo: 20 }),
      buildEntry({ lift: 'squat', weight: 250, reps: 5, daysAgo: 10 }),
      buildEntry({ lift: 'squat', weight: 315, reps: 1, daysAgo: 5 }),
    ];
    const repPRs = getRepPRs();
    expect(repPRs.squat[5].weight).toBe(250);
    expect(repPRs.squat[1].weight).toBe(315);
  });

  it('handles entries for multiple lifts', () => {
    mockStore.entries = [
      buildEntry({ lift: 'squat', weight: 225, reps: 5 }),
      buildEntry({ lift: 'bench', weight: 185, reps: 5 }),
      buildEntry({ lift: 'deadlift', weight: 315, reps: 5 }),
    ];
    const repPRs = getRepPRs();
    expect(repPRs.squat[5].weight).toBe(225);
    expect(repPRs.bench[5].weight).toBe(185);
    expect(repPRs.deadlift[5].weight).toBe(315);
  });

  describe('implicit lower-rep fill', () => {
    it('fills lower rep slots from a heavier higher-rep set', () => {
      mockStore.entries = [
        buildEntry({ lift: 'squat', weight: 350, reps: 5, daysAgo: 1 }),
      ];
      const prs = getRepPRs();
      expect(prs.squat[5].weight).toBe(350);
      expect(prs.squat[3].weight).toBe(350);
      expect(prs.squat[2].weight).toBe(350);
      expect(prs.squat[1].weight).toBe(350);
      // 8 and 10 are higher than the entry's reps — should remain empty
      expect(prs.squat[8]).toBeUndefined();
      expect(prs.squat[10]).toBeUndefined();
    });

    it('does NOT overwrite a higher-rep slot from a lower-rep heavy set', () => {
      mockStore.entries = [
        buildEntry({ lift: 'squat', weight: 350, reps: 5, daysAgo: 2 }),
        buildEntry({ lift: 'squat', weight: 370, reps: 1, daysAgo: 1 }),
      ];
      const prs = getRepPRs();
      expect(prs.squat[1].weight).toBe(370); // 1RM stays at 370
      expect(prs.squat[5].weight).toBe(350); // 5RM stays at 350 (370x1 doesn't backfill upward)
    });

    it('keeps an already-higher lower-rep slot when backfilling from a heavier-rep set', () => {
      mockStore.entries = [
        buildEntry({ lift: 'squat', weight: 370, reps: 1, daysAgo: 2 }),
        buildEntry({ lift: 'squat', weight: 350, reps: 5, daysAgo: 1 }),
      ];
      const prs = getRepPRs();
      expect(prs.squat[1].weight).toBe(370); // 1RM stays at 370 (350 < 370)
      expect(prs.squat[2].weight).toBe(350); // backfilled from 350x5
      expect(prs.squat[3].weight).toBe(350);
      expect(prs.squat[5].weight).toBe(350);
    });

    it('handles AMRAP-style "5+" rep strings as 5 reps', () => {
      mockStore.entries = [
        buildEntry({ lift: 'bench', weight: 225, reps: '5+', daysAgo: 1 }),
      ];
      const prs = getRepPRs();
      // parseInt('5+') === 5, so slots 1-5 fill at 225
      expect(prs.bench[5].weight).toBe(225);
      expect(prs.bench[3].weight).toBe(225);
      expect(prs.bench[1].weight).toBe(225);
      expect(prs.bench[8]).toBeUndefined();
    });
  });
});
