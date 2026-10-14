/**
 * Overhaul regression tests for the shared-workout join path.
 *
 * Covers the P1 hang regression: every Firestore await in the join path is
 * bounded by withTimeout, and errors are typed ShareJoinError with a
 * machine-readable `.kind`. Also locks in the share-code normalization
 * contract and the sessionStorage pending-code round-trip.
 *
 * Firebase is fully mocked (db is a stub object, never a real project);
 * Firestore functions are vi.fn()s so fetch attempts are countable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — Firebase and UI kept out of the module graph
// ---------------------------------------------------------------------------

const { mockAuth, mockInit } = vi.hoisted(() => ({
  mockAuth: { currentUser: { uid: 'test-uid', displayName: 'Tom Tester' } },
  mockInit: {
    db: { _fake: true },
    doc: (...args) => ({ __docRef: args }),
    setDoc: vi.fn(),
    getDoc: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(() => 'SERVER_TS'),
    updateDoc: vi.fn(),
    arrayUnion: (...args) => ({ _union: args }),
  },
}));

vi.mock('../firebase/init.js', () => mockInit);
vi.mock('../firebase/auth.js', () => mockAuth);
vi.mock('../ui/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../state/store.js', () => ({
  default: { entries: [], programConfig: {}, unit: 'lbs' },
}));
vi.mock('../data/exercise-catalog.js', () => ({ EXERCISE_CATALOG: {} }));

import {
  SHARE_CODE_RE,
  normalizeShareCode,
  savePendingJoinCode,
  readPendingJoinCode,
  clearPendingJoinCode,
  ShareJoinError,
  withTimeout,
  fetchSharedWorkout,
  joinSharedWorkout,
} from '../firebase/shared-workout.js';
import { buildShareLink, buildShareSummary } from '../ui/share.js';

const validSnap = (data = {}) => ({
  exists: () => true,
  data: () => ({ status: 'active', hostUid: 'host-1', hostName: 'Host', mainLift: 'bench', ...data }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.currentUser = { uid: 'test-uid', displayName: 'Tom Tester' };
  window.sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// Share-code format contract
// ---------------------------------------------------------------------------

describe('SHARE_CODE_RE', () => {
  it('is exactly six alphanumeric characters', () => {
    expect(SHARE_CODE_RE.source).toBe('^[A-Za-z0-9]{6}$');
    expect(SHARE_CODE_RE.test('KX7Q2M')).toBe(true);
    expect(SHARE_CODE_RE.test('ABC123')).toBe(true);
    expect(SHARE_CODE_RE.test('ABC12')).toBe(false); // too short
    expect(SHARE_CODE_RE.test('ABC1234')).toBe(false); // too long
    expect(SHARE_CODE_RE.test('AB-123')).toBe(false); // non-alphanumeric
  });
});

describe('normalizeShareCode', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalizeShareCode(' ab-12 34 ')).toBe('AB1234');
  });

  it('returns null for a 5-char code (strict length)', () => {
    expect(normalizeShareCode('ABC12')).toBeNull();
  });

  it('returns null for "squat!" — SQUAT is 5 chars after stripping', () => {
    expect(normalizeShareCode('squat!')).toBeNull();
  });

  it('returns null for null input and passes through valid codes', () => {
    expect(normalizeShareCode(null)).toBeNull();
    expect(normalizeShareCode('KX7Q2M')).toBe('KX7Q2M');
  });
});

// ---------------------------------------------------------------------------
// Pending join code round-trip (sessionStorage)
// ---------------------------------------------------------------------------

describe('pending join code', () => {
  it('round-trips save → read → clear', () => {
    expect(savePendingJoinCode(' ab-12 34 ')).toBe('AB1234');
    expect(readPendingJoinCode()).toBe('AB1234');
    clearPendingJoinCode();
    expect(readPendingJoinCode()).toBeNull();
  });

  it('never stores an invalid code', () => {
    expect(savePendingJoinCode('ABC12')).toBeNull();
    expect(readPendingJoinCode()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// withTimeout — the bounded-await primitive
// ---------------------------------------------------------------------------

describe('withTimeout', () => {
  it('resolves with the promise value when fast', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it('rejects with a typed timeout ShareJoinError on a hung promise', async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(new Promise(() => {}), 10000);
      const settled = p.then(
        () => 'resolved',
        (e) => e
      );
      await vi.advanceTimersByTimeAsync(10000);
      const err = await settled;
      expect(err).toBeInstanceOf(ShareJoinError);
      expect(err.kind).toBe('timeout');
      expect(err.message).toMatch(/timed out/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// fetchSharedWorkout — typed errors
// ---------------------------------------------------------------------------

describe('fetchSharedWorkout', () => {
  it('throws invalid for a malformed code without touching Firestore', async () => {
    await expect(fetchSharedWorkout('ABC12')).rejects.toMatchObject({
      name: 'ShareJoinError',
      kind: 'invalid',
    });
    expect(mockInit.getDoc).not.toHaveBeenCalled();
  });

  it('throws signed-out when there is no current user', async () => {
    mockAuth.currentUser = null;
    await expect(fetchSharedWorkout('ABC123')).rejects.toMatchObject({ kind: 'signed-out' });
    expect(mockInit.getDoc).not.toHaveBeenCalled();
  });

  it('throws invalid when the doc does not exist', async () => {
    mockInit.getDoc.mockResolvedValue({ exists: () => false });
    await expect(fetchSharedWorkout('ABC123')).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('throws finished when the workout already completed', async () => {
    mockInit.getDoc.mockResolvedValue(validSnap({ status: 'completed' }));
    await expect(fetchSharedWorkout('ABC123')).rejects.toMatchObject({ kind: 'finished' });
  });

  it('returns the doc info for an active workout', async () => {
    mockInit.getDoc.mockResolvedValue(validSnap());
    const info = await fetchSharedWorkout('ABC123');
    expect(info).toMatchObject({
      code: 'ABC123',
      hostUid: 'host-1',
      hostName: 'Host',
      mainLift: 'bench',
    });
  });
});

// ---------------------------------------------------------------------------
// P1 REGRESSION — the join path always terminates
// ---------------------------------------------------------------------------

describe('joinSharedWorkout termination (P1 regression)', () => {
  it('settles with a timeout error when Firestore hangs forever', async () => {
    vi.useFakeTimers();
    try {
      // Firestore never responds — the original hang.
      mockInit.getDoc.mockReturnValue(new Promise(() => {}));
      const p = joinSharedWorkout('ABC123');
      const settled = p.then(
        () => 'resolved',
        (e) => e
      );
      await vi.advanceTimersByTimeAsync(12000);
      const err = await settled;

      expect(err).toBeInstanceOf(ShareJoinError);
      expect(err.kind).toBe('timeout');
      // No unbounded retry: the join path makes exactly one read attempt.
      expect(mockInit.getDoc.mock.calls.length).toBeLessThanOrEqual(2);
      expect(mockInit.updateDoc).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// share.js link/summary helpers
// ---------------------------------------------------------------------------

describe('buildShareLink / buildShareSummary', () => {
  it('builds the canonical share link', () => {
    expect(buildShareLink('KX7Q2M')).toBe('https://1000lbtracker.com/#workout/KX7Q2M');
  });

  it('summarizes the session as one line of lift + exercise/set counts', () => {
    const summary = buildShareSummary({
      mainLift: 'bench',
      mainSets: [{}, {}, {}],
      bbbSets: [],
      accessories: [{}, {}],
    });
    expect(summary).toBe('Bench workout · 3 exercises · 3 sets');
  });

  it('handles a null session without throwing', () => {
    expect(buildShareSummary(null)).toBe('Workout');
  });
});
