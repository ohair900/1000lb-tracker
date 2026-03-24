/**
 * Theme and accent-color management.
 *
 * `applyTheme()` reads `store.theme` / `store.autoTheme` and updates
 * the document's `data-theme` attribute, persists to localStorage,
 * and calls `applyAccentColor()`.
 *
 * `applyAccentColor()` converts the named accent (`store.accentColor`)
 * into a CSS custom property (`--gold` and `--gold-bg`).
 */

import store from '../state/store.js';
import { THEME_KEY, AUTO_THEME_KEY } from '../constants/storage-keys.js';
import { ACCENT_COLORS } from '../constants/ui.js';
import { $ } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// Dependency injection — optional cloud-sync trigger
// ---------------------------------------------------------------------------

/** @type {Function|null} */
let _scheduleCloudSync = null;

/** @type {Function|null} */
let _onThemeChanged = null;

/**
 * Wire up optional callbacks.
 *
 * @param {object} deps
 * @param {Function} [deps.scheduleCloudSync]
 * @param {Function} [deps.onThemeChanged] - called after theme applies (e.g. to re-render charts)
 */
export function setThemeDeps(deps) {
  if (deps.scheduleCloudSync) _scheduleCloudSync = deps.scheduleCloudSync;
  if (deps.onThemeChanged) _onThemeChanged = deps.onThemeChanged;
}

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
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

/**
 * Apply the current theme (dark/light) based on `store.theme` and
 * `store.autoTheme`.  Persists to localStorage and updates the
 * theme-button icon.
 */
export function applyTheme() {
  if (store.autoTheme) {
    store.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', store.theme);
  localStorage.setItem(THEME_KEY, store.theme);
  localStorage.setItem(AUTO_THEME_KEY, store.autoTheme.toString());

  if (_scheduleCloudSync) _scheduleCloudSync();

  const btn = $('theme-btn');
  if (btn) {
    btn.innerHTML = store.autoTheme
      ? '\u2699\uFE0F'
      : (store.theme === 'dark' ? '&#9790;' : '&#9728;');
  }

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = store.theme === 'dark' ? '#121212' : '#f5f5f5';

  // Always re-apply accent color when theme changes
  applyAccentColor();
}

/**
 * Toggle between dark and light theme.
 * Disables auto-theme when toggled manually.
 */
export function toggleTheme() {
  store.autoTheme = false;
  store.theme = store.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  if (_onThemeChanged) _onThemeChanged();
}

/**
 * Initialise theme-related event listeners.
 * Call once after DOMContentLoaded.
 */
export function initThemeListeners() {
  // System preference change listener for auto-theme
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (store.autoTheme) {
      applyTheme();
      if (_onThemeChanged) _onThemeChanged();
    }
  });

  // Theme toggle button
  $('theme-btn').addEventListener('click', toggleTheme);
}
