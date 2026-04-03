/**
 * Unit tests for production formula modules.
 *
 * These import directly from src/ so regressions in production code
 * are caught immediately — no copied formulas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the store module before importing anything that depends on it
vi.mock('../state/store.js', () => ({
  default: { unit: 'lbs', entries: [] },
}));

import { calcE1RM } from '../formulas/e1rm.js';
import { lbsToKg, displayWeight } from '../formulas/units.js';
import { calcWilks, calcDOTS } from '../formulas/scoring.js';
import { roundToPlate, calcPlatesPerSide } from '../formulas/plates.js';
import store from '../state/store.js';

// ---------------------------------------------------------------------------
// calcE1RM
// ---------------------------------------------------------------------------
describe('calcE1RM', () => {
  it('returns weight itself for 1 rep', () => {
    expect(calcE1RM(300, 1)).toBe(300);
  });
  it('calculates 225x5 correctly', () => {
    expect(calcE1RM(225, 5)).toBeCloseTo(225 * (1 + 5 / 30), 2);
  });
  it('calculates 315x3 correctly', () => {
    expect(calcE1RM(315, 3)).toBeCloseTo(315 * (1 + 3 / 30), 2);
  });
  it('calculates 135x10 correctly', () => {
    expect(calcE1RM(135, 10)).toBeCloseTo(135 * (1 + 10 / 30), 2);
  });
  it('returns 0 for 0 weight', () => {
    expect(calcE1RM(0, 5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// lbsToKg
// ---------------------------------------------------------------------------
describe('lbsToKg', () => {
  it('converts 225 lbs to kg', () => {
    expect(lbsToKg(225)).toBeCloseTo(225 / 2.205, 2);
  });
  it('converts 0 lbs to 0 kg', () => {
    expect(lbsToKg(0)).toBeCloseTo(0, 2);
  });
  it('converts 1000 lbs to kg', () => {
    expect(lbsToKg(1000)).toBeCloseTo(1000 / 2.205, 2);
  });
});

// ---------------------------------------------------------------------------
// calcWilks
// ---------------------------------------------------------------------------
describe('calcWilks', () => {
  it('returns null for null total', () => {
    expect(calcWilks(null, 80, 'male')).toBeNull();
  });
  it('returns null for null bodyweight', () => {
    expect(calcWilks(400, null, 'male')).toBeNull();
  });
  it('returns null for null gender', () => {
    expect(calcWilks(400, 80, null)).toBeNull();
  });
  it('returns positive value for valid male input', () => {
    const w = calcWilks(400, 80, 'male');
    expect(w).toBeGreaterThan(0);
    expect(w).toBeCloseTo(300, -2); // within ~100
  });
  it('returns positive value for valid female input', () => {
    expect(calcWilks(300, 60, 'female')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// calcDOTS
// ---------------------------------------------------------------------------
describe('calcDOTS', () => {
  it('returns null for null total', () => {
    expect(calcDOTS(null, 80, 'male')).toBeNull();
  });
  it('returns positive value for valid male input', () => {
    const d = calcDOTS(400, 80, 'male');
    expect(d).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// roundToPlate
// ---------------------------------------------------------------------------
describe('roundToPlate', () => {
  beforeEach(() => { store.unit = 'lbs'; });

  it('rounds 227 to 225 in lbs', () => {
    expect(roundToPlate(227)).toBe(225);
  });
  it('rounds 228 to 230 in lbs', () => {
    expect(roundToPlate(228)).toBe(230);
  });
  it('keeps 135 as 135 in lbs', () => {
    expect(roundToPlate(135)).toBe(135);
  });
  it('keeps 0 as 0', () => {
    expect(roundToPlate(0)).toBe(0);
  });
  it('rounds 101 to 100 in kg', () => {
    store.unit = 'kg';
    expect(roundToPlate(101)).toBe(100);
  });
  it('rounds 102 to 102.5 in kg', () => {
    store.unit = 'kg';
    expect(roundToPlate(102)).toBe(102.5);
  });
});

// ---------------------------------------------------------------------------
// calcPlatesPerSide
// ---------------------------------------------------------------------------
describe('calcPlatesPerSide', () => {
  beforeEach(() => { store.unit = 'lbs'; });

  it('returns null for bar-only weight (lbs)', () => {
    expect(calcPlatesPerSide(45)).toBeNull();
  });
  it('returns null for less than bar weight', () => {
    expect(calcPlatesPerSide(30)).toBeNull();
  });
  it('calculates 135 = 1x45 per side', () => {
    const p = calcPlatesPerSide(135);
    expect(p).toEqual([45]);
  });
  it('calculates 225 = 2x45 per side', () => {
    const p = calcPlatesPerSide(225);
    expect(p).toEqual([45, 45]);
  });
  it('calculates 315 = 3x45 per side', () => {
    const p = calcPlatesPerSide(315);
    expect(p).toEqual([45, 45, 45]);
  });
  it('calculates 185 = 45 + 25 per side', () => {
    const p = calcPlatesPerSide(185);
    expect(p[0]).toBe(45);
    expect(p[1]).toBe(25);
  });
  it('calculates 145 = 45 + 5 per side', () => {
    const p = calcPlatesPerSide(145);
    expect(p[0]).toBe(45);
    expect(p[1]).toBe(5);
  });
  it('returns null for bar-only weight (kg)', () => {
    store.unit = 'kg';
    expect(calcPlatesPerSide(20)).toBeNull();
  });
  it('calculates 60kg = 1x20 per side', () => {
    store.unit = 'kg';
    const p = calcPlatesPerSide(60);
    expect(p).toEqual([20]);
  });
  it('calculates 100kg = 25 + 15 per side', () => {
    store.unit = 'kg';
    const p = calcPlatesPerSide(100);
    expect(p).toEqual([25, 15]);
  });
});

// ---------------------------------------------------------------------------
// displayWeight
// ---------------------------------------------------------------------------
describe('displayWeight', () => {
  beforeEach(() => { store.unit = 'lbs'; });

  it('returns 225 in lbs mode', () => {
    expect(displayWeight(225)).toBe(225);
  });
  it('converts 225 lbs to ~102 kg', () => {
    store.unit = 'kg';
    expect(displayWeight(225)).toBeCloseTo(102, 0);
  });
  it('returns 0 for 0', () => {
    expect(displayWeight(0)).toBe(0);
  });
});
