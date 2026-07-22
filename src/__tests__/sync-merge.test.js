/**
 * Tests for mergeCloudData (src/firebase/sync.js) — the highest
 * data-loss-risk function in the app. These lock in the documented merge
 * rules: entry union, last-write-wins on edits, deletion tombstones,
 * cloud-wins scalars, and local-wins program completions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import store from '../state/store.js';
import { mergeCloudData } from '../firebase/sync.js';

function entry(id, overrides = {}) {
  return {
    id,
    lift: 'squat',
    weight: 100,
    reps: 5,
    e1rm: 116,
    date: '2026-01-01',
    timestamp: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  store.init();
  store.entries = [];
  store._deletedEntryRecords = [];
  store.deletedEntryIds = new Set();
});

describe('mergeCloudData — entries', () => {
  it('adds cloud entries that are not present locally (union by id)', () => {
    store.entries = [entry('a')];
    mergeCloudData({ entries: [entry('a'), entry('b')] });
    const ids = store.entries.map((e) => e.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('lets the newer updatedAt win on an edited entry', () => {
    store.entries = [entry('a', { weight: 100, updatedAt: 100 })];
    mergeCloudData({ entries: [entry('a', { weight: 145, updatedAt: 200 })] });
    expect(store.entries.find((e) => e.id === 'a').weight).toBe(145);
  });

  it('keeps the local version when the cloud copy is older', () => {
    store.entries = [entry('a', { weight: 145, updatedAt: 200 })];
    mergeCloudData({ entries: [entry('a', { weight: 100, updatedAt: 100 })] });
    expect(store.entries.find((e) => e.id === 'a').weight).toBe(145);
  });

  it('does not resurrect an entry the user deleted locally', () => {
    store.entries = [];
    store._deletedEntryRecords = [{ id: 'b', deletedAt: 500 }];
    store.deletedEntryIds = new Set(['b']);
    mergeCloudData({ entries: [entry('b')] });
    expect(store.entries.find((e) => e.id === 'b')).toBeUndefined();
  });

  it('removes a locally-present entry that the cloud tombstoned', () => {
    store.entries = [entry('c')];
    mergeCloudData({ entries: [], deletedEntryIds: [{ id: 'c', deletedAt: 700 }] });
    expect(store.entries.find((e) => e.id === 'c')).toBeUndefined();
    expect(store.deletedEntryIds.has('c')).toBe(true);
  });
});

describe('mergeCloudData — scalars and objects', () => {
  it('merges goals with cloud winning on overlap', () => {
    store.goals = { squat: 100, bench: 100 };
    mergeCloudData({ goals: { bench: 225, deadlift: 315 } });
    expect(store.goals).toEqual({ squat: 100, bench: 225, deadlift: 315 });
  });

  it('takes cloud unit (last-write-wins)', () => {
    store.unit = 'lbs';
    mergeCloudData({ unit: 'kg' });
    expect(store.unit).toBe('kg');
  });
});

describe('mergeCloudData — programs (local completions never lost)', () => {
  it('unions completed sets and keeps local training maxes', () => {
    store.programConfig = {
      ...store.programConfig,
      completedSets: { 'squat-w1-s1': true },
      trainingMaxes: { squat: 315 },
    };
    mergeCloudData({
      programs: {
        completedSets: { 'bench-w1-s1': true },
        trainingMaxes: { squat: 300, bench: 225 },
      },
    });
    // Both completions survive the merge.
    expect(store.programConfig.completedSets['squat-w1-s1']).toBe(true);
    expect(store.programConfig.completedSets['bench-w1-s1']).toBe(true);
    // Local TM wins over stale cloud so progression is never reverted.
    expect(store.programConfig.trainingMaxes.squat).toBe(315);
    expect(store.programConfig.trainingMaxes.bench).toBe(225);
  });
});

describe('mergeCloudData — safety', () => {
  it('is a no-op for null cloud data', () => {
    store.entries = [entry('a')];
    mergeCloudData(null);
    expect(store.entries).toHaveLength(1);
  });

  it('blocks the merge when the cloud schema is newer', () => {
    store.entries = [entry('a')];
    mergeCloudData({ schemaVersion: 99, entries: [entry('a'), entry('b')] });
    // Nothing merged — local left untouched.
    expect(store.entries.map((e) => e.id)).toEqual(['a']);
  });
});
