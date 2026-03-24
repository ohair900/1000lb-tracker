/**
 * DOM helpers and cached element references.
 *
 * `$` is re-exported from utils/helpers.js for convenience.
 * `initDOMRefs()` caches the most frequently accessed DOM elements
 * so the rest of the app can import `dom.weightInput` etc. without
 * repeated getElementById calls.
 */

import { $ } from '../utils/helpers.js';

// Re-export $ so consumers can `import { $ } from '../ui/dom.js'`
export { $ };

// ---------------------------------------------------------------------------
// Cached DOM references — populated by initDOMRefs()
// ---------------------------------------------------------------------------

/** @type {HTMLInputElement|null} */
export let weightInput = null;

/** @type {HTMLInputElement|null} */
export let repsInput = null;

/** @type {HTMLInputElement|null} */
export let notesInput = null;

/** @type {HTMLElement|null} */
export let previewEl = null;

/** @type {HTMLButtonElement|null} */
export let logBtn = null;

/** @type {HTMLCanvasElement|null} */
export let canvas = null;

/** @type {CanvasRenderingContext2D|null} */
export let ctx = null;

/** @type {HTMLElement|null} */
export let tooltip = null;

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Cache commonly used DOM elements.
 * Call once after DOMContentLoaded / initial render.
 */
export function initDOMRefs() {
  weightInput = $('input-weight');
  repsInput   = $('input-reps');
  notesInput  = $('input-notes');
  previewEl   = $('e1rm-preview');
  logBtn      = $('log-btn');
  canvas      = $('chart-canvas');
  ctx         = canvas ? canvas.getContext('2d') : null;
  tooltip     = $('chart-tooltip');
}
