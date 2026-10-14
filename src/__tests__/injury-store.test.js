/**
 * Regression tests for the real store's injury persistence contract.
 *
 * store.saveInjuries(arr) normalizes every entry to the contract shape
 * consumed by src/systems/injury.js (and the AI export):
 *   { id, region, side, severity, onsetDate, notes, active }
 *
 * Runs against the real store (no mocks) — happy-dom supplies localStorage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import store from '../state/store.js';

beforeEach(() => {
  store.saveInjuries([]);
});

describe('store.saveInjuries / getInjuries round-trip', () => {
  it('normalizes defaults: side "both", severity "mild", active true, generated id', () => {
    store.saveInjuries([{ region: 'wrist' }]);
    const [inj] = store.getInjuries();
    expect(inj.region).toBe('wrist');
    expect(inj.side).toBe('both');
    expect(inj.severity).toBe('mild');
    expect(inj.active).toBe(true);
    expect(typeof inj.id).toBe('string');
    expect(inj.id.length).toBeGreaterThan(0);
    expect(inj.onsetDate).toBe('');
    expect(inj.notes).toBe('');
  });

  it('filters out entries with unknown regions', () => {
    store.saveInjuries([{ region: 'wrist' }, { region: 'antenna' }, null]);
    const got = store.getInjuries();
    expect(got).toHaveLength(1);
    expect(got[0].region).toBe('wrist');
  });

  it('keeps valid side/severity/id/active values verbatim', () => {
    store.saveInjuries([
      {
        id: 'inj-1',
        region: 'knee',
        side: 'left',
        severity: 'severe',
        onsetDate: '2026-09-01',
        notes: 'soccer',
        active: false,
      },
    ]);
    const [inj] = store.getInjuries();
    expect(inj).toMatchObject({
      id: 'inj-1',
      region: 'knee',
      side: 'left',
      severity: 'severe',
      onsetDate: '2026-09-01',
      notes: 'soccer',
      active: false,
    });
  });

  it('falls back to defaults on invalid side/severity', () => {
    store.saveInjuries([{ region: 'shoulder', side: 'upside', severity: 'extreme' }]);
    const [inj] = store.getInjuries();
    expect(inj.side).toBe('both');
    expect(inj.severity).toBe('mild');
  });

  it('returns copies from getInjuries (no aliasing)', () => {
    store.saveInjuries([{ region: 'wrist' }]);
    const [a] = store.getInjuries();
    a.region = 'mutated';
    const [b] = store.getInjuries();
    expect(b.region).toBe('wrist');
  });
});
