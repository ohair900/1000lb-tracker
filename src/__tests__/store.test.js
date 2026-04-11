/**
 * Integration tests for src/state/store.js
 *
 * Tests the batched save queue, saveNow bypass, and dirty-store tracking.
 * Uses happy-dom's localStorage directly — no mocking. Each test resets
 * localStorage between runs.
 *
 * Note: we import a FRESH store instance in each test via dynamic import +
 * vi.resetModules() because the store is a singleton. Multiple tests
 * sharing the same singleton would pollute state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

async function freshStore() {
  vi.resetModules();
  const mod = await import('../state/store.js');
  return mod.default;
}

/** Initialize the store and drain any pending flushes from migration. */
async function initClean(store) {
  store.init();
  // Migration on fresh localStorage calls saveAll() which marks every store
  // dirty. Drain that flush before testing the save queue itself.
  await new Promise(resolve => queueMicrotask(resolve));
  await new Promise(resolve => queueMicrotask(resolve));
  // Explicitly clear any residual dirty state from migration
  store._dirtyStores.clear();
  store._flushScheduled = false;
}

describe('store: init + basic API', () => {
  it('exports a default instance with a save() method', async () => {
    const store = await freshStore();
    expect(store).toBeDefined();
    expect(typeof store.save).toBe('function');
    expect(typeof store.saveNow).toBe('function');
    expect(typeof store.init).toBe('function');
  });

  it('init() populates default empty stores', async () => {
    const store = await freshStore();
    await initClean(store);
    expect(Array.isArray(store.entries)).toBe(true);
    expect(Array.isArray(store.prs)).toBe(true);
    expect(typeof store.profile).toBe('object');
    expect(typeof store.goals).toBe('object');
  });
});

describe('store: batched save flow', () => {
  it('save() marks a store as dirty and schedules a flush', async () => {
    const store = await freshStore();
    await initClean(store);
    store.entries = [{ id: 'e1', lift: 'squat', weight: 225, reps: 5 }];
    store.save('entries');
    expect(store._dirtyStores.has('entries')).toBe(true);
    expect(store._flushScheduled).toBe(true);
  });

  it('flush writes to localStorage', async () => {
    const store = await freshStore();
    await initClean(store);
    store.entries = [{ id: 'e1', lift: 'squat', weight: 225, reps: 5, timestamp: Date.now(), date: '2026-01-01', e1rm: 262.5, isPR: false, tags: [] }];
    store.save('entries');
    // Wait for microtask flush
    await new Promise(resolve => queueMicrotask(resolve));
    const raw = localStorage.getItem('sbd-tracker-data');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('multiple save() calls in one tick coalesce into one flush', async () => {
    const store = await freshStore();
    await initClean(store);
    store.save('entries');
    store.save('entries');
    store.save('entries');
    // Only one flush was scheduled
    expect(store._dirtyStores.size).toBe(1);
  });

  it('_dirtyStores is cleared after flush', async () => {
    const store = await freshStore();
    await initClean(store);
    store.save('entries');
    await new Promise(resolve => queueMicrotask(resolve));
    expect(store._dirtyStores.size).toBe(0);
  });

  it('different stores can be dirtied simultaneously and all flush', async () => {
    const store = await freshStore();
    await initClean(store);
    store.entries = [];
    store.prs = [];
    store.save('entries');
    store.save('prs');
    expect(store._dirtyStores.size).toBe(2);
    await new Promise(resolve => queueMicrotask(resolve));
    expect(store._dirtyStores.size).toBe(0);
    expect(localStorage.getItem('sbd-tracker-data')).not.toBeNull();
    expect(localStorage.getItem('sbd-tracker-prs')).not.toBeNull();
  });
});

describe('store: saveNow bypass', () => {
  it('saveNow writes immediately without scheduling', async () => {
    const store = await freshStore();
    await initClean(store);
    store.workoutSession = { id: 'ws1', mainLift: 'squat', mainSets: [] };
    store.saveNow('workoutSession');
    // Should be written BEFORE any microtask flush
    const raw = localStorage.getItem('sbd-tracker-workout-session');
    expect(raw).not.toBeNull();
  });

  it('saveNow removes the store from the dirty set if it was pending', async () => {
    const store = await freshStore();
    await initClean(store);
    store.save('workoutSession');
    expect(store._dirtyStores.has('workoutSession')).toBe(true);
    store.saveNow('workoutSession');
    expect(store._dirtyStores.has('workoutSession')).toBe(false);
  });
});

describe('store: load roundtrip', () => {
  it('data written via save() can be read back by a fresh store', async () => {
    // First store: write some entries
    const store1 = await freshStore();
    store1.init();
    store1.entries = [
      { id: 'e1', lift: 'squat', weight: 225, reps: 5, timestamp: Date.now(), date: '2026-01-01', e1rm: 262.5, isPR: true, tags: [] },
    ];
    store1.save('entries');
    await new Promise(resolve => queueMicrotask(resolve));

    // Second store: should find the persisted data
    const store2 = await freshStore();
    store2.init();
    expect(store2.entries).toHaveLength(1);
    expect(store2.entries[0].lift).toBe('squat');
    expect(store2.entries[0].weight).toBe(225);
  });

  it('empty localStorage yields empty default stores', async () => {
    localStorage.clear();
    const store = await freshStore();
    await initClean(store);
    expect(store.entries).toEqual([]);
    expect(store.prs).toEqual([]);
  });
});

describe('store: onAfterFlush callback', () => {
  it('fires onAfterFlush after a batched save completes', async () => {
    const store = await freshStore();
    await initClean(store);
    let called = false;
    store.onAfterFlush = () => { called = true; };
    store.save('entries');
    await new Promise(resolve => queueMicrotask(resolve));
    expect(called).toBe(true);
  });
});
