/**
 * Tests for the settings backup layer (src/views/settings.js):
 * export completeness, import validation, and export→import round-trip
 * fidelity for the previously-dropped learned/preference stores.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import store from '../state/store.js';
import { buildExportData, validateImportData, applyImportData } from '../views/settings.js';

beforeEach(() => {
  localStorage.clear();
  store.init();
});

describe('buildExportData', () => {
  it('includes the learned/preference stores that were previously dropped', () => {
    store.recoveryCalibration = { chest: { hours: 60, confidence: 0.5, sampleCount: 12 } };
    store.equipmentProfile = {
      barbell: true,
      dumbbell: false,
      cable: true,
      machine: false,
      bodyweight: true,
    };
    store.reasonTagCounts = { rdl: 3 };
    store._deletedEntryRecords = [{ id: 'x1', deletedAt: 123 }];

    const data = buildExportData();
    expect(data.recoveryCalibration).toEqual({
      chest: { hours: 60, confidence: 0.5, sampleCount: 12 },
    });
    expect(data.equipmentProfile.dumbbell).toBe(false);
    expect(data.reasonTagCounts).toEqual({ rdl: 3 });
    expect(data.deletedEntryIds).toEqual([{ id: 'x1', deletedAt: 123 }]);
  });
});

describe('validateImportData', () => {
  it('accepts a minimal valid backup', () => {
    expect(() => validateImportData({ entries: [] })).not.toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => validateImportData(null)).toThrow(/backup/i);
    expect(() => validateImportData('nope')).toThrow(/backup/i);
  });

  it('rejects a missing or non-array entries list', () => {
    expect(() => validateImportData({})).toThrow(/entries/i);
    expect(() => validateImportData({ entries: {} })).toThrow(/entries/i);
  });

  it('rejects a field with the wrong container type', () => {
    expect(() => validateImportData({ entries: [], profile: [] })).toThrow(/profile/i);
    expect(() => validateImportData({ entries: [], prs: {} })).toThrow(/prs/i);
    expect(() => validateImportData({ entries: [], equipmentProfile: [] })).toThrow(
      /equipmentProfile/i
    );
  });

  it('allows optional fields to be absent', () => {
    expect(() => validateImportData({ entries: [{ id: 'a' }] })).not.toThrow();
  });
});

describe('export → import round-trip', () => {
  it('restores the learned/preference stores after they are cleared', () => {
    store.recoveryCalibration = { back: { hours: 72, confidence: 0.8, sampleCount: 20 } };
    store.equipmentProfile = {
      barbell: true,
      dumbbell: true,
      cable: false,
      machine: true,
      bodyweight: true,
    };
    store.reasonTagCounts = { 'good-morning': 2 };
    store._deletedEntryRecords = [{ id: 'gone', deletedAt: 999 }];

    const backup = JSON.parse(JSON.stringify(buildExportData()));

    // Simulate a destructive change.
    store.recoveryCalibration = null;
    store.equipmentProfile = {
      barbell: true,
      dumbbell: true,
      cable: true,
      machine: true,
      bodyweight: true,
    };
    store.reasonTagCounts = {};
    store._deletedEntryRecords = [];
    store.deletedEntryIds = new Set();

    validateImportData(backup);
    applyImportData(backup);

    expect(store.recoveryCalibration).toEqual({
      back: { hours: 72, confidence: 0.8, sampleCount: 20 },
    });
    expect(store.equipmentProfile.cable).toBe(false);
    expect(store.reasonTagCounts).toEqual({ 'good-morning': 2 });
    expect(store._deletedEntryRecords).toEqual([{ id: 'gone', deletedAt: 999 }]);
    // The Set index is rebuilt from the records so undo/redo tombstones survive.
    expect(store.deletedEntryIds.has('gone')).toBe(true);
  });
});
