/**
 * Focus management for modal dialogs and bottom sheets.
 *
 * Provides an accessible focus trap: while a container is "trapped",
 * Tab / Shift+Tab cycle within it, Escape invokes the container's close
 * behaviour, and closing restores focus to whatever was focused before
 * the dialog opened. Multiple stacked dialogs are supported — the most
 * recently opened, still-visible container is the active trap.
 *
 * A single capture-phase `keydown` listener is installed lazily on first
 * use and drives every trap, so callers only wire `trapFocus` /
 * `releaseFocus` into their open / close paths.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Insertion-ordered map of container element -> { previouslyFocused, onEscape }.
const _traps = new Map();
let _installed = false;

/** Visible, focusable descendants of `container`, in DOM order. */
function focusableWithin(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

/** The topmost active trap (last inserted, still in the document and visible). */
function topTrap() {
  let top = null;
  for (const [el, data] of _traps) {
    if (document.contains(el) && el.style.display !== 'none') top = { el, data };
  }
  return top;
}

function onKeydown(e) {
  const top = topTrap();
  if (!top) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    top.data.onEscape?.();
    return;
  }

  if (e.key !== 'Tab') return;

  const focusable = focusableWithin(top.el);
  if (focusable.length === 0) {
    e.preventDefault();
    top.el.focus?.();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (!top.el.contains(active)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * Begin trapping focus inside `container`.
 *
 * @param {HTMLElement} container - The dialog / sheet panel element
 * @param {Function} [onEscape]   - Invoked when Escape is pressed while active
 */
export function trapFocus(container, onEscape) {
  if (!container) return;
  if (!_installed) {
    document.addEventListener('keydown', onKeydown, true);
    _installed = true;
  }
  // Re-inserting moves it to the top of the stack; keep the original
  // previouslyFocused so focus restoration still points outside the dialog.
  const existing = _traps.get(container);
  const previouslyFocused = existing ? existing.previouslyFocused : document.activeElement;
  _traps.delete(container);
  _traps.set(container, { previouslyFocused, onEscape });

  requestAnimationFrame(() => {
    if (!document.contains(container) || container.style.display === 'none') return;
    // Don't steal focus if the user already tabbed somewhere inside.
    if (container.contains(document.activeElement)) return;
    const focusable = focusableWithin(container);
    (focusable[0] || container).focus?.();
  });
}

/**
 * Stop trapping focus for `container` and restore focus to the element
 * that was focused before it opened (if still present in the document).
 *
 * @param {HTMLElement} container
 */
export function releaseFocus(container) {
  const data = _traps.get(container);
  if (!data) return;
  _traps.delete(container);
  const prev = data.previouslyFocused;
  if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
    try {
      prev.focus();
    } catch {
      /* element no longer focusable — ignore */
    }
  }
}
