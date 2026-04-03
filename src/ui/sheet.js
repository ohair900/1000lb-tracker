/**
 * Bottom sheet management (choice sheet, fatigue sheet, workout summary).
 *
 * Each sheet consists of a content panel (`.choice-sheet`, `.fatigue-sheet`,
 * etc.) and a backdrop.  This module provides:
 *
 *   - Open / close for each sheet type
 *   - `enableSheetSwipeDismiss()` — touch-based swipe-down-to-dismiss
 *
 * The choice sheet's *content* is built by the workout view module;
 * this module only manages visibility and the swipe gesture.
 */

import { $ } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// Generic sheet helpers
// ---------------------------------------------------------------------------

/**
 * Open a bottom sheet by showing its panel and backdrop, and locking body scroll.
 *
 * @param {string} sheetId   - Element ID of the sheet panel
 * @param {string} backdropId - Element ID of the backdrop
 */
export function openSheet(sheetId, backdropId) {
  $(backdropId).style.display = 'block';
  $(sheetId).style.display = 'block';
  document.body.style.overflow = 'hidden';
}

/**
 * Close a bottom sheet — resets transform/transition, hides elements,
 * and restores body scroll.
 *
 * @param {string} sheetId
 * @param {string} backdropId
 */
export function closeSheet(sheetId, backdropId) {
  const sheet = $(sheetId), backdrop = $(backdropId);
  sheet.style.transform = '';
  sheet.style.transition = '';
  backdrop.style.opacity = '';
  backdrop.style.transition = '';
  backdrop.style.display = 'none';
  sheet.style.display = 'none';
  document.body.style.overflow = '';
}

// ---------------------------------------------------------------------------
// Fatigue sheet
// ---------------------------------------------------------------------------

export function openFatigueSheet() {
  openSheet('fatigue-sheet', 'fatigue-sheet-backdrop');
}

export function closeFatigueSheet() {
  closeSheet('fatigue-sheet', 'fatigue-sheet-backdrop');
}

// ---------------------------------------------------------------------------
// Choice sheet (workout picker)
// ---------------------------------------------------------------------------

export function openChoiceSheetUI() {
  openSheet('choice-sheet', 'choice-sheet-backdrop');
}

export function closeChoiceSheet() {
  closeSheet('choice-sheet', 'choice-sheet-backdrop');
}

// ---------------------------------------------------------------------------
// Workout summary sheet
// ---------------------------------------------------------------------------

export function closeWorkoutSummary() {
  closeSheet('workout-summary-sheet', 'workout-summary-backdrop');
}

// ---------------------------------------------------------------------------
// Swipe-down-to-dismiss
// ---------------------------------------------------------------------------

/**
 * Attach a swipe-down-to-dismiss gesture to a bottom sheet.
 *
 * The user can drag the sheet downward (starting from the handle or
 * when scrolled to the top).  If the drag exceeds 30% of the sheet
 * height or the velocity exceeds 0.5 px/ms, the sheet is dismissed.
 *
 * @param {string}   sheetId    - Element ID of the sheet panel
 * @param {string}   backdropId - Element ID of the backdrop
 * @param {Function} closeFn    - Function to call when the sheet should close
 */
export function enableSheetSwipeDismiss(sheetId, backdropId, closeFn) {
  const sheet = $(sheetId), backdrop = $(backdropId);
  let startY, startTime, offset, swiping;
  const DEAD_ZONE = 8;

  // Swipe-to-dismiss only from the handle. Body scrolls natively
  // with zero JS touch interference — reliable on all platforms.
  const handle = sheet.querySelector('.sheet-handle');
  if (!handle) return;

  handle.addEventListener('touchstart', e => {
    if (sheet.style.display === 'none') return;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    offset = 0;
    swiping = false;
  }, { passive: true });

  handle.addEventListener('touchmove', e => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (!swiping) {
      if (dy < DEAD_ZONE) return;
      swiping = true;
      startY = e.touches[0].clientY;
      offset = 0;
    }
    e.preventDefault();
    offset = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transition = 'none';
    sheet.style.transform = 'translateY(' + offset + 'px)';
    backdrop.style.transition = 'none';
    backdrop.style.opacity = Math.max(0, 1 - offset / sheet.offsetHeight);
  }, { passive: false });

  handle.addEventListener('touchend', () => {
    startY = null;
    if (!swiping) return;
    const elapsed = Date.now() - startTime;
    const velocity = offset / elapsed;
    if (offset > sheet.offsetHeight * 0.3 || velocity > 0.5) {
      sheet.style.transition = 'transform 0.2s ease';
      sheet.style.transform = 'translateY(100%)';
      backdrop.style.transition = 'opacity 0.2s ease';
      backdrop.style.opacity = '0';
      setTimeout(closeFn, 200);
    } else {
      sheet.style.transition = 'transform 0.25s ease';
      sheet.style.transform = 'translateY(0)';
      backdrop.style.transition = 'opacity 0.25s ease';
      backdrop.style.opacity = '1';
      setTimeout(() => {
        sheet.style.transform = '';
        sheet.style.transition = '';
        backdrop.style.opacity = '';
        backdrop.style.transition = '';
      }, 250);
    }
    swiping = false;
  }, { passive: true });
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Attach close-button and backdrop-click listeners for all sheets,
 * and enable swipe-down-to-dismiss on each.
 *
 * Call once after DOMContentLoaded.
 */
export function initSheetListeners() {
  $('fatigue-sheet-close').addEventListener('click', closeFatigueSheet);
  $('fatigue-sheet-backdrop').addEventListener('click', closeFatigueSheet);
  $('workout-summary-close').addEventListener('click', closeWorkoutSummary);
  $('workout-summary-backdrop').addEventListener('click', closeWorkoutSummary);
  $('choice-sheet-close').addEventListener('click', closeChoiceSheet);
  $('choice-sheet-backdrop').addEventListener('click', closeChoiceSheet);

  enableSheetSwipeDismiss('fatigue-sheet', 'fatigue-sheet-backdrop', closeFatigueSheet);
  enableSheetSwipeDismiss('choice-sheet', 'choice-sheet-backdrop', closeChoiceSheet);
  enableSheetSwipeDismiss('workout-summary-sheet', 'workout-summary-backdrop', closeWorkoutSummary);
}
