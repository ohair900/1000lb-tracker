/**
 * Tests for src/ui/focus-trap.js — the modal/sheet focus trap.
 *
 * Covers the behaviours the accessibility layer depends on: Escape invokes
 * the topmost trap, focus is restored to the opener on release, and stacked
 * dialogs resolve to the most recently opened visible container.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trapFocus, releaseFocus } from '../ui/focus-trap.js';

function makeDialog(id) {
  const el = document.createElement('div');
  el.id = id;
  const btn = document.createElement('button');
  btn.textContent = 'action';
  el.appendChild(btn);
  document.body.appendChild(el);
  return el;
}

function pressEscape() {
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('focus-trap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('invokes onEscape when Escape is pressed', () => {
    const el = makeDialog('d1');
    const onEscape = vi.fn();
    trapFocus(el, onEscape);
    pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
    releaseFocus(el);
  });

  it('routes Escape to the most recently opened dialog', () => {
    const a = makeDialog('a');
    const b = makeDialog('b');
    const onA = vi.fn();
    const onB = vi.fn();
    trapFocus(a, onA);
    trapFocus(b, onB);

    pressEscape();
    expect(onB).toHaveBeenCalledTimes(1);
    expect(onA).not.toHaveBeenCalled();

    // Closing the top dialog hands control back to the one beneath it.
    releaseFocus(b);
    b.style.display = 'none';
    pressEscape();
    expect(onA).toHaveBeenCalledTimes(1);
    releaseFocus(a);
  });

  it('restores focus to the opener on release', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const el = makeDialog('d2');
    trapFocus(el, () => {});
    releaseFocus(el);
    expect(document.activeElement).toBe(opener);
  });

  it('does nothing when no trap is active', () => {
    // Should not throw with an empty stack.
    expect(() => pressEscape()).not.toThrow();
  });
});
