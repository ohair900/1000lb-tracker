/**
 * Modal open / close helpers.
 *
 * Modals in this app are simple backdrop elements (`<div class="modal-backdrop">`)
 * that are toggled via `display: none`.  Opening a modal locks body scroll;
 * closing it restores it.
 */

import { $ } from '../utils/helpers.js';
import { trapFocus, releaseFocus } from './focus-trap.js';

/**
 * Close a modal via its own close affordance so any router / cleanup
 * listeners wired to that button also run. Falls back to a plain close.
 * @param {HTMLElement} el - The `.modal-backdrop` element
 * @param {string} id
 */
function dismissModal(el, id) {
  const closeBtn = el.querySelector('.modal-close');
  if (closeBtn) closeBtn.click();
  else closeModal(id);
}

/**
 * Show a modal by its container element ID.
 * Locks body scroll and traps keyboard focus while the modal is visible.
 *
 * @param {string} id - The element ID of the `.modal-backdrop` wrapper
 */
export function openModal(id) {
  const el = $(id);
  el.style.display = '';
  document.body.style.overflow = 'hidden';
  trapFocus(el, () => dismissModal(el, id));
}

/**
 * Hide a modal by its container element ID.
 * Restores body scroll and returns focus to the opener.
 *
 * @param {string} id - The element ID of the `.modal-backdrop` wrapper
 */
export function closeModal(id) {
  const el = $(id);
  el.style.display = 'none';
  document.body.style.overflow = '';
  releaseFocus(el);
}

/**
 * Attach backdrop-click-to-close behaviour on the given modal IDs,
 * and wire up their close buttons.
 *
 * Call once after DOMContentLoaded.
 */
export function initModalListeners() {
  ['edit-modal', 'settings-modal'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      if (e.target === $(id)) closeModal(id);
    });
  });

  $('edit-close').addEventListener('click', () => closeModal('edit-modal'));
  $('settings-close').addEventListener('click', () => closeModal('settings-modal'));
}
