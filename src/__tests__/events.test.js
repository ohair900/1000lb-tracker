import { describe, it, expect, vi, beforeEach } from 'vitest';
import { on, off, emit, once, clear } from '../ui/events.js';

beforeEach(() => clear());

describe('on / emit', () => {
  it('calls a registered handler with the payload', () => {
    const h = vi.fn();
    on('test', h);
    emit('test', { x: 1 });
    expect(h).toHaveBeenCalledWith({ x: 1 });
  });

  it('calls multiple handlers for the same event', () => {
    const a = vi.fn();
    const b = vi.fn();
    on('multi', a);
    on('multi', b);
    emit('multi', 42);
    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it('does not call handlers for a different event', () => {
    const h = vi.fn();
    on('other', h);
    emit('test', {});
    expect(h).not.toHaveBeenCalled();
  });

  it('emitting an event with no handlers is a no-op', () => {
    expect(() => emit('no-handlers', {})).not.toThrow();
  });
});

describe('off', () => {
  it('removes a specific handler', () => {
    const h = vi.fn();
    on('ev', h);
    off('ev', h);
    emit('ev', {});
    expect(h).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function from on()', () => {
    const h = vi.fn();
    const unsub = on('ev', h);
    unsub();
    emit('ev', {});
    expect(h).not.toHaveBeenCalled();
  });

  it('does not affect other handlers when one is removed', () => {
    const a = vi.fn();
    const b = vi.fn();
    on('ev', a);
    on('ev', b);
    off('ev', a);
    emit('ev', {});
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe('once', () => {
  it('fires only once', () => {
    const h = vi.fn();
    once('ev', h);
    emit('ev', 1);
    emit('ev', 2);
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(1);
  });

  it('can be unsubscribed before it fires', () => {
    const h = vi.fn();
    const unsub = once('ev', h);
    unsub();
    emit('ev', {});
    expect(h).not.toHaveBeenCalled();
  });
});

describe('clear', () => {
  it('clears all handlers for a specific event', () => {
    const h = vi.fn();
    on('ev', h);
    clear('ev');
    emit('ev', {});
    expect(h).not.toHaveBeenCalled();
  });

  it('clears all handlers for all events when called with no args', () => {
    const a = vi.fn();
    const b = vi.fn();
    on('ev1', a);
    on('ev2', b);
    clear();
    emit('ev1', {});
    emit('ev2', {});
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});

describe('error isolation', () => {
  it('continues calling subsequent handlers after one throws', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    on('ev', bad);
    on('ev', good);
    expect(() => emit('ev', {})).not.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good).toHaveBeenCalledTimes(1);
  });
});
