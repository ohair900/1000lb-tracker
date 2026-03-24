/**
 * Modal open / close helpers.
 *
 * Modals in this app are simple backdrop elements (`<div class="modal-backdrop">`)
 * that are toggled via `display: none`.  Opening a modal locks body scroll;
 * closing it restores it.
 */

import { $ } from '../utils/helpers.js';

/**
 * Show a modal by its container element ID.
 * Locks body scroll while the modal is visible.
 *
 * @param {string} id - The element ID of the `.modal-backdrop` wrapper
 */
export function openModal(id) {
  $(id).style.display = '';
  document.body.style.overflow = 'hidden';
}

/**
 * Hide a modal by its container element ID.
 * Restores body scroll.
 *
 * @param {string} id - The element ID of the `.modal-backdrop` wrapper
 */
export function closeModal(id) {
  $(id).style.display = 'none';
  document.body.style.overflow = '';
}

/**
 * Attach backdrop-click-to-close behaviour on the given modal IDs,
 * and wire up their close buttons.
 *
 * Call once after DOMContentLoaded.
 */
export function initModalListeners() {
  ['edit-modal', 'settings-modal'].forEach(id => {
    $(id).addEventListener('click', e => {
      if (e.target === $(id)) closeModal(id);
    });
  });

  $('edit-close').addEventListener('click', () => closeModal('edit-modal'));
  $('settings-close').addEventListener('click', () => closeModal('settings-modal'));
}
