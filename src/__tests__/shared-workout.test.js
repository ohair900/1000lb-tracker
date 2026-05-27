/**
 * Unit tests for shared workout pure functions.
 *
 * Tests buildSharedPayload (firebase/shared-workout.js) and the
 * partner session scaling logic (_scaleSessionForPartner extracted
 * into a test-friendly helper here).
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — keep Firebase and store out of the module graph
// ---------------------------------------------------------------------------

vi.mock('../firebase/init.js', () => ({
  db: null,
  doc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  updateDoc: vi.fn(),
  arrayUnion: (...args) => ({ _union: args }), // lightweight stand-in
}));

vi.mock('../firebase/auth.js', () => ({
  currentUser: { uid: 'host-uid', displayName: 'Tom Host' },
}));

vi.mock('../state/store.js', () => ({
  default: {
    programConfig: { trainingMaxes: { squat: 315, bench: 225, deadlift: 405 } },
    entries: [],
    unit: 'lbs',
  },
}));

vi.mock('../data/exercise-catalog.js', () => ({
  EXERCISE_CATALOG: {
    rdl: { id: 'rdl', name: 'Romanian Deadlift', equipment: 'barbell' },
    'cable-row': { id: 'cable-row', name: 'Cable Row', equipment: 'cable' },
  },
}));

import { buildSharedPayload } from '../firebase/shared-workout.js';
import { roundToPlate } from '../formulas/plates.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSession(overrides = {}) {
  return {
    mainLift: 'squat',
    programWeek: 2,
    date: '2026-05-27',
    mainSets: [
      { num: 1, weight: 220, reps: 5, pct: 70, tier: null, day: null, completed: true },
      { num: 2, weight: 245, reps: 3, pct: 80, tier: null, day: null, completed: false },
    ],
    bbbSets: [
      { num: 1, weight: 155, reps: 10, pct: 50, tier: 'BBB', completed: false },
      { num: 2, weight: 155, reps: 10, pct: 50, tier: 'BBB', completed: true },
    ],
    accessories: [
      {
        exerciseId: 'rdl',
        name: 'Romanian Deadlift',
        setWeights: [135, 155, 155],
        targetSets: 3,
        repRange: [8, 12],
        equipment: 'barbell',
        setsCompleted: [10, 10],
        progressed: false,
      },
      {
        exerciseId: 'cable-row',
        name: 'Cable Row',
        setWeights: [100, 110, 110],
        targetSets: 3,
        repRange: [10, 15],
        equipment: 'cable',
        setsCompleted: [],
        progressed: false,
        _localOnly: true, // should be stripped from payload
      },
    ],
    completed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildSharedPayload
// ---------------------------------------------------------------------------

describe('buildSharedPayload', () => {
  it('strips absolute weights from mainSets and keeps _hostWeight fallback', () => {
    const payload = buildSharedPayload(makeSession());
    expect(payload.mainSets).toHaveLength(2);
    payload.mainSets.forEach((s) => {
      expect(s).not.toHaveProperty('weight');
      expect(typeof s._hostWeight).toBe('number');
    });
    expect(payload.mainSets[0]._hostWeight).toBe(220);
    expect(payload.mainSets[1]._hostWeight).toBe(245);
  });

  it('preserves pct, reps, num, tier, completed on each main set', () => {
    const payload = buildSharedPayload(makeSession());
    expect(payload.mainSets[0]).toMatchObject({ num: 1, pct: 70, reps: 5, completed: true });
    expect(payload.mainSets[1]).toMatchObject({ num: 2, pct: 80, reps: 3, completed: false });
  });

  it('strips absolute weights from bbbSets and keeps _hostWeight', () => {
    const payload = buildSharedPayload(makeSession());
    expect(payload.bbbSets).toHaveLength(2);
    payload.bbbSets.forEach((s) => expect(s).not.toHaveProperty('weight'));
    expect(payload.bbbSets[0]._hostWeight).toBe(155);
    expect(payload.bbbSets[1].completed).toBe(true);
  });

  it('filters out _localOnly accessories', () => {
    const payload = buildSharedPayload(makeSession());
    expect(payload.accessories).toHaveLength(1);
    expect(payload.accessories[0].exerciseId).toBe('rdl');
  });

  it('converts setWeights to _hostWeights on accessories', () => {
    const payload = buildSharedPayload(makeSession());
    const acc = payload.accessories[0];
    expect(acc._hostWeights).toEqual([135, 155, 155]);
    expect(acc).not.toHaveProperty('setWeights');
  });

  it('includes host setsCompleted for progress display', () => {
    const payload = buildSharedPayload(makeSession());
    expect(payload.accessories[0].setsCompleted).toEqual([10, 10]);
  });

  it('sets customDef null for catalog exercises', () => {
    const payload = buildSharedPayload(makeSession());
    expect(payload.accessories[0].customDef).toBeNull();
  });

  it('sets customDef for custom exercises not in catalog', () => {
    const session = makeSession();
    session.accessories[0] = {
      ...session.accessories[0],
      exerciseId: 'custom-abc123',
      name: 'My Custom Move',
    };
    const payload = buildSharedPayload(session);
    expect(payload.accessories[0].customDef).toMatchObject({
      id: 'custom-abc123',
      name: 'My Custom Move',
    });
  });

  it('handles empty mainSets and bbbSets gracefully', () => {
    const payload = buildSharedPayload({ mainSets: [], bbbSets: undefined, accessories: [] });
    expect(payload.mainSets).toEqual([]);
    expect(payload.bbbSets).toEqual([]);
    expect(payload.accessories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Partner weight scaling logic (inline, mirrors _scaleSessionForPartner)
// ---------------------------------------------------------------------------

describe('partner weight scaling (_setWeight)', () => {
  // Mirror the scaling formula used in both choice-sheet and workout-overlay.
  // When no TM and no e1RM exist, returns hostW directly (avoids double-applying pct).
  function setWeight(pct, hostW, partnerTM, partnerE1RM) {
    if (!pct) return hostW ?? 0;
    const refTM = partnerTM ?? (partnerE1RM != null ? partnerE1RM * 0.9 : null);
    return refTM != null ? roundToPlate((refTM * pct) / 100) : (hostW ?? 0);
  }

  it('uses partner TM when available', () => {
    // 315 TM * 70% = 220.5 → rounds to 220
    expect(setWeight(70, 245, 315, null)).toBe(220);
  });

  it('falls back to e1RM * 0.9 when no TM', () => {
    // e1RM 350, effective TM = 315, 80% of 315 = 252 → rounds to 250
    expect(setWeight(80, 245, null, 350)).toBe(250);
  });

  it('falls back to host weight when partner has no TM and no e1RM', () => {
    expect(setWeight(80, 245, null, null)).toBe(245);
  });

  it('returns host weight directly when pct is null/0 (non-pct set)', () => {
    expect(setWeight(null, 135, 315, 350)).toBe(135);
    expect(setWeight(0, 135, 315, 350)).toBe(135);
  });

  it('returns 0 when pct is null and no host weight provided', () => {
    expect(setWeight(null, null, 315, 350)).toBe(0);
  });

  it('rounds to nearest loadable plate', () => {
    // 315 * 65% = 204.75 → nearest plate multiple
    const w = setWeight(65, 200, 315, null);
    expect(w % 5).toBe(0); // must be plate-loadable
  });
});

// ---------------------------------------------------------------------------
// buildSharedPayload — host progress chips source-of-truth
// ---------------------------------------------------------------------------

describe('buildSharedPayload hostProgress source', () => {
  it('host completed chips derive from mainSets[i].completed in payload', () => {
    const session = makeSession();
    const payload = buildSharedPayload(session);
    // Partner reads mainSets[i].completed to build hostProgress
    const hostMainProgress = payload.mainSets.map((s) => s.completed);
    expect(hostMainProgress).toEqual([true, false]);
  });

  it('accessory host progress derives from setsCompleted.length', () => {
    const payload = buildSharedPayload(makeSession());
    const hostAccProgress = payload.accessories.map((a) => a.setsCompleted.length);
    expect(hostAccProgress).toEqual([2]); // rdl has 2 completed sets
  });
});
