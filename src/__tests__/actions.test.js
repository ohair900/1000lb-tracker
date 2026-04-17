/**
 * Integration tests for src/state/actions.js
 *
 * Uses the mock store + real formula/PR functions wired via inject(). Tests
 * the full addEntry → PR detection → undo → redo lifecycle.
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
    programConfig: { activeProgram: null, trainingMaxes: {}, completedSets: {}, amrapResults: {}, liftWeeks: {} },
    activeCycleId: null,
    lastLoggedSet: null,
    undoStack: null,
    undoTimer: null,
    deletedEntryIds: new Set(),
    _deletedEntryRecords: [],
    save: () => {},
    saveNow: () => {},
    saveEntries: () => {},
    savePRs: () => {},
  },
}));
vi.mock('../state/store.js', () => ({ default: mockStore }));

import { calcE1RM } from '../formulas/e1rm.js';
import { rebuildPRs, checkPR, checkRepPR, getMilestone, updateBestAfterAdd } from '../systems/pr-tracking.js';
import { addEntry, editEntry, deleteEntry, executeUndo, inject } from '../state/actions.js';

// Wire actions with real dependencies
inject({ calcE1RM, rebuildPRs, checkPR, checkRepPR, getMilestone, updateBestAfterAdd });

function resetForActionsTest() {
  mockStore.entries = [];
  mockStore.prs = [];
  mockStore.undoStack = null;
  mockStore.undoTimer = null;
  mockStore.deletedEntryIds = new Set();
  mockStore._deletedEntryRecords = [];
  mockStore.lastLoggedSet = null;
  mockStore.activeCycleId = null;
}

beforeEach(() => {
  resetForActionsTest();
});

describe('addEntry', () => {
  it('creates a new entry with correct e1rm', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    expect(entry).toBeDefined();
    expect(entry.lift).toBe('squat');
    expect(entry.weight).toBe(225);
    expect(entry.reps).toBe(5);
    // e1rm = 225 * (1 + 5/30) = 262.5
    expect(entry.e1rm).toBeCloseTo(262.5, 1);
  });

  it('appends to store.entries', () => {
    expect(mockStore.entries).toHaveLength(0);
    addEntry('squat', 225, 5, null, '', []);
    expect(mockStore.entries).toHaveLength(1);
  });

  it('marks first entry as a PR', () => {
    const { isPR } = addEntry('squat', 225, 5, null, '', []);
    expect(isPR).toBe(true);
    expect(mockStore.prs).toHaveLength(1);
  });

  it('does not mark a second, lower-e1rm entry as a PR', () => {
    addEntry('squat', 315, 5, null, '', []); // e1rm ~367
    const { isPR } = addEntry('squat', 225, 5, null, '', []); // e1rm ~262
    expect(isPR).toBe(false);
  });

  it('marks a beating-weight entry as a PR', () => {
    addEntry('squat', 225, 5, null, '', []); // e1rm ~262
    const { isPR } = addEntry('squat', 275, 5, null, '', []); // e1rm ~320
    expect(isPR).toBe(true);
  });

  it('persists RPE when provided', () => {
    const { entry } = addEntry('squat', 225, 5, 8, '', []);
    expect(entry.rpe).toBe(8);
  });

  it('persists tags when provided', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', ['belt', 'paused']);
    expect(entry.tags).toEqual(['belt', 'paused']);
  });

  it('captures the notes string', () => {
    const { entry } = addEntry('squat', 225, 5, null, 'felt easy', []);
    expect(entry.notes).toBe('felt easy');
  });

  it('sets lastLoggedSet for Repeat functionality', () => {
    addEntry('squat', 225, 5, 8, 'test', []);
    expect(mockStore.lastLoggedSet).toEqual({
      lift: 'squat', weight: 225, reps: 5, rpe: 8, notes: 'test',
    });
  });
});

describe('editEntry', () => {
  it('mutates the target entry in place', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    editEntry(entry.id, 'squat', 275, 5, null, '');
    const edited = mockStore.entries.find(e => e.id === entry.id);
    expect(edited.weight).toBe(275);
    expect(edited.e1rm).toBeCloseTo(275 * (1 + 5 / 30), 1);
  });

  it('preserves entry ID', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    editEntry(entry.id, 'squat', 300, 3, null, '');
    const edited = mockStore.entries.find(e => e.id === entry.id);
    expect(edited.id).toBe(entry.id);
  });

  it('rebuilds PRs after edit', () => {
    const { entry: e1 } = addEntry('squat', 225, 5, null, '', []); // PR e1rm ~262
    const { entry: e2 } = addEntry('squat', 275, 5, null, '', []); // PR e1rm ~320
    expect(mockStore.entries.filter(e => e.isPR)).toHaveLength(2);
    // Lower e2 so e1 becomes the only PR
    editEntry(e2.id, 'squat', 185, 5, null, '');
    const prs = mockStore.entries.filter(e => e.isPR);
    expect(prs).toHaveLength(1);
    expect(prs[0].id).toBe(e1.id);
  });

  it('sets updatedAt timestamp', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    const before = Date.now();
    editEntry(entry.id, 'squat', 250, 5, null, '');
    const edited = mockStore.entries.find(e => e.id === entry.id);
    expect(edited.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('is a no-op for unknown IDs', () => {
    expect(() => editEntry('nonexistent', 'squat', 225, 5, null, '')).not.toThrow();
  });
});

describe('deleteEntry', () => {
  it('removes the entry from store.entries', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    expect(mockStore.entries).toHaveLength(1);
    deleteEntry(entry.id);
    expect(mockStore.entries).toHaveLength(0);
  });

  it('adds to deletedEntryIds for the cloud sync reaper', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    deleteEntry(entry.id);
    expect(mockStore.deletedEntryIds.has(entry.id)).toBe(true);
  });

  it('records a _deletedEntryRecords entry with timestamp', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    const before = Date.now();
    deleteEntry(entry.id);
    expect(mockStore._deletedEntryRecords).toHaveLength(1);
    expect(mockStore._deletedEntryRecords[0].id).toBe(entry.id);
    expect(mockStore._deletedEntryRecords[0].deletedAt).toBeGreaterThanOrEqual(before);
  });

  it('rebuilds PRs when deleting a PR entry', () => {
    const { entry: e1 } = addEntry('squat', 225, 5, null, '', []); // PR
    const { entry: e2 } = addEntry('squat', 275, 5, null, '', []); // PR
    deleteEntry(e2.id);
    // e1 should still be a PR
    const remaining = mockStore.entries.find(e => e.id === e1.id);
    expect(remaining.isPR).toBe(true);
  });
});

describe('executeUndo', () => {
  it('returns null when there is nothing to undo', () => {
    expect(executeUndo()).toBeNull();
  });

  it('restores a deleted entry', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    deleteEntry(entry.id);
    expect(mockStore.entries).toHaveLength(0);
    const result = executeUndo();
    expect(result.type).toBe('delete');
    expect(mockStore.entries).toHaveLength(1);
    expect(mockStore.entries[0].id).toBe(entry.id);
  });

  it('reverts an edit to the previous state', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    editEntry(entry.id, 'squat', 300, 3, 9, 'changed');
    executeUndo();
    const reverted = mockStore.entries.find(e => e.id === entry.id);
    expect(reverted.weight).toBe(225);
    expect(reverted.reps).toBe(5);
  });

  it('clears the undo stack after execution', () => {
    const { entry } = addEntry('squat', 225, 5, null, '', []);
    deleteEntry(entry.id);
    executeUndo();
    expect(mockStore.undoStack).toBeNull();
    expect(executeUndo()).toBeNull();
  });
});
