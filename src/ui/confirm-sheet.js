/**
 * Confirm sheet — thumb-zone-friendly replacement for window.confirm().
 *
 * Renders a bottom sheet with a title, optional body text, a primary
 * destructive action, and a cancel action. Returns a promise that resolves
 * to `true` if the primary action was tapped, `false` otherwise.
 *
 * Design constraints (see lifter-ux-designer guidance):
 *   - Bottom-aligned so buttons land in the thumb zone
 *   - Primary action is ALWAYS the safe one (keep going / cancel)
 *   - Destructive action sits below, takes one tap but is never the default
 *   - Backdrop tap and escape key both cancel
 *   - 48pt+ tap targets
 *   - Single-focus: only one confirm sheet at a time
 *
 * Usage:
 *   const ok = await confirmSheet({
 *     title: 'Discard this workout?',
 *     body: '14 sets logged will stay in your history.',
 *     confirmLabel: 'Discard',
 *     cancelLabel: 'Keep going',
 *   });
 *   if (ok) { ... }
 */

let _active = null;

/**
 * Show a confirm sheet and return a promise resolving to true/false.
 *
 * @param {object}  opts
 * @param {string}  opts.title            - Headline question (max ~40 chars)
 * @param {string}  [opts.body]           - Optional reassurance / detail line
 * @param {string}  [opts.confirmLabel]   - Destructive action label (default: 'Confirm')
 * @param {string}  [opts.cancelLabel]    - Safe action label (default: 'Cancel')
 * @param {'danger'|'primary'} [opts.tone] - Visual tone of the confirm button
 * @returns {Promise<boolean>}
 */
export function confirmSheet(opts = {}) {
  // Dismiss any existing sheet first (resolves as cancel)
  if (_active) _active.dismiss(false);

  const {
    title = 'Are you sure?',
    body = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'danger',
  } = opts;

  return new Promise((resolve) => {
    // Build DOM
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-sheet-backdrop';

    const sheet = document.createElement('div');
    sheet.className = 'confirm-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', title);

    sheet.innerHTML = `
      <div class="confirm-sheet-handle"></div>
      <div class="confirm-sheet-title">${escapeHtml(title)}</div>
      ${body ? `<div class="confirm-sheet-body">${escapeHtml(body)}</div>` : ''}
      <div class="confirm-sheet-actions">
        <button type="button" class="confirm-sheet-btn confirm-sheet-cancel">${escapeHtml(cancelLabel)}</button>
        <button type="button" class="confirm-sheet-btn confirm-sheet-confirm confirm-sheet-${tone}">${escapeHtml(confirmLabel)}</button>
      </div>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    document.body.style.overflow = 'hidden';

    // Animate in
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      sheet.classList.add('open');
    });

    const cancelBtn = sheet.querySelector('.confirm-sheet-cancel');
    const confirmBtn = sheet.querySelector('.confirm-sheet-confirm');

    // Cancel button is initially focused (safe default)
    setTimeout(() => cancelBtn.focus(), 50);

    function dismiss(result) {
      if (!_active) return;
      _active = null;
      document.removeEventListener('keydown', onKeydown);
      backdrop.classList.remove('open');
      sheet.classList.remove('open');
      setTimeout(() => {
        backdrop.remove();
        sheet.remove();
        document.body.style.overflow = '';
      }, 220);
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') { e.preventDefault(); dismiss(false); }
      else if (e.key === 'Enter' && document.activeElement === confirmBtn) { e.preventDefault(); dismiss(true); }
    }

    cancelBtn.addEventListener('click', () => dismiss(false));
    confirmBtn.addEventListener('click', () => dismiss(true));
    backdrop.addEventListener('click', () => dismiss(false));
    document.addEventListener('keydown', onKeydown);

    _active = { dismiss };
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
