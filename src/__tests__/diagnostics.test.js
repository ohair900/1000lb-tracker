/**
 * Tests for src/utils/diagnostics.js — the in-memory error ring buffer and
 * the human-readable diagnostics report.
 */

import { describe, it, expect } from 'vitest';
import { recordError, getDiagnosticsText } from '../utils/diagnostics.js';

describe('diagnostics', () => {
  it('records handled errors into the report', () => {
    recordError('unit-test', new Error('boom'));
    const text = getDiagnosticsText();
    expect(text).toContain('[handled] [unit-test] boom');
  });

  it('includes environment and version metadata', () => {
    const text = getDiagnosticsText();
    expect(text).toContain('1000lb Tracker — diagnostics');
    expect(text).toContain('Data version:');
    expect(text).toContain('User agent:');
    expect(text).toContain('Recent errors');
  });

  it('caps the ring buffer at 30 entries', () => {
    for (let i = 0; i < 50; i++) recordError('flood', new Error('e' + i));
    const text = getDiagnosticsText();
    // The very first flooded entries should have been evicted.
    expect(text).not.toContain('flood] e0\n');
    expect(text).toContain('e49');
    // Count of listed error lines should not exceed the cap.
    const header = text.match(/Recent errors \((\d+)\)/);
    expect(Number(header[1])).toBeLessThanOrEqual(30);
  });

  it('accepts non-Error values without throwing', () => {
    expect(() => recordError('weird', 'a plain string')).not.toThrow();
    expect(getDiagnosticsText()).toContain('[weird] a plain string');
  });
});
