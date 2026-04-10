/**
 * Accent-color management.
 *
 * `applyAccentColor()` converts the named accent (`store.accentColor`)
 * into CSS custom properties (`--gold` and `--gold-bg`).
 */

import store from '../state/store.js';
import { ACCENT_COLORS } from '../constants/ui.js';

// ---------------------------------------------------------------------------
// Dependency injection — optional cloud-sync trigger
// ---------------------------------------------------------------------------

let _deps = {};

export function setThemeDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Accent color
// ---------------------------------------------------------------------------

/**
 * Apply the current accent color from `store.accentColor` to CSS custom properties.
 */
export function applyAccentColor() {
  const color = ACCENT_COLORS[store.accentColor] || ACCENT_COLORS.gold;
  document.documentElement.style.setProperty('--gold', color);

  // Proper rgba conversion for the background tint
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  document.documentElement.style.setProperty('--gold-bg', `rgba(${r},${g},${b},0.08)`);

  _deps.scheduleCloudSync?.();
}
