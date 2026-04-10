/**
 * Celebration and confetti effects.
 *
 * Three distinct celebrations:
 *   1. `showCelebration(total, msTheme)` — full-screen overlay for total milestones
 *   2. `triggerWeekCompleteCelebration()` — checkmark cascade + mini confetti in program section
 *   3. `triggerLiftCompleteCelebration()` — checkmark cascade only
 *
 * The milestone celebration also offers a "Share Achievement" button
 * that delegates to `shareMilestoneCard` (injected via `setConfettiDeps`).
 */

import { $ } from '../utils/helpers.js';
import store from '../state/store.js';
import {
  CONFETTI_COUNT, CELEBRATION_DISMISS_MS,
  CONFETTI_SIZE_MIN, CONFETTI_SIZE_RANGE,
  CONFETTI_DURATION_BASE_S, CONFETTI_DURATION_RANGE_S, CONFETTI_DELAY_RANGE_S,
  MINI_CONFETTI_COUNT, MINI_CONFETTI_CLEANUP_MS
} from '../constants/ui.js';
import { COLORS, LIFT_NAMES } from '../constants/lift-config.js';
import { TOTAL_MILESTONE_THEMES } from '../data/milestones.js';
import { formatWeight } from '../formulas/units.js';
import { bestE1RM } from '../formulas/e1rm.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = {};

export function setConfettiDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Full milestone celebration overlay
// ---------------------------------------------------------------------------

/**
 * Display the full-screen milestone celebration overlay with confetti.
 *
 * @param {number} total - The user's current SBD total (in lbs internally)
 * @param {object} [msTheme] - A theme object from TOTAL_MILESTONE_THEMES
 */
export function showCelebration(total, msTheme) {
  msTheme = msTheme || TOTAL_MILESTONE_THEMES[1000];
  const overlay = document.createElement('div');
  overlay.className = 'celebration-overlay';

  // Confetti particles
  const confettiColors = msTheme.confettiColors;
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'confetti';
    const size = CONFETTI_SIZE_MIN + Math.random() * CONFETTI_SIZE_RANGE;
    p.style.left = Math.random() * 100 + '%';
    p.style.width = size + 'px';
    p.style.height = (Math.random() > 0.5 ? size : size * 2.5) + 'px';
    p.style.background = confettiColors[Math.floor(Math.random() * confettiColors.length)];
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    p.style.animationDuration = (CONFETTI_DURATION_BASE_S + Math.random() * CONFETTI_DURATION_RANGE_S) + 's';
    p.style.animationDelay = (Math.random() * CONFETTI_DELAY_RANGE_S) + 's';
    overlay.appendChild(p);
  }

  const sq = bestE1RM('squat');
  const bp = bestE1RM('bench');
  const dl = bestE1RM('deadlift');

  const content = document.createElement('div');
  content.className = 'celebration-content';
  content.innerHTML = `
    <button class="celebration-close" aria-label="Close">&times;</button>
    <div class="celebration-crown">${msTheme.emoji}</div>
    <div class="celebration-subtitle">WELCOME TO THE</div>
    <div class="celebration-title" style="color:${msTheme.color}">${msTheme.title}</div>
    <div class="celebration-total">${formatWeight(total)} ${store.unit}</div>
    <div class="celebration-breakdown">
      <div class="cb-lift">
        <span class="cb-label" style="color:${COLORS.squat}">SQ</span>
        <span class="cb-value">${sq ? formatWeight(sq) : '\u2014'}</span>
      </div>
      <div class="cb-lift">
        <span class="cb-label" style="color:${COLORS.bench}">BP</span>
        <span class="cb-value">${bp ? formatWeight(bp) : '\u2014'}</span>
      </div>
      <div class="cb-lift">
        <span class="cb-label" style="color:${COLORS.deadlift}">DL</span>
        <span class="cb-value">${dl ? formatWeight(dl) : '\u2014'}</span>
      </div>
    </div>
    <div class="celebration-date">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
    <div class="celebration-actions">
      <button class="celebration-share-btn">\uD83D\uDCE4 Share Achievement</button>
    </div>
  `;

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  function dismiss() {
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 500);
  }

  content.querySelector('.celebration-close').addEventListener('click', dismiss);
  overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });
  const autoDismiss = setTimeout(dismiss, CELEBRATION_DISMISS_MS);

  content.querySelector('.celebration-share-btn').addEventListener('click', () => {
    clearTimeout(autoDismiss);
    _deps.shareMilestoneCard?.(total, sq, bp, dl, msTheme);
  });
}

// ---------------------------------------------------------------------------
// Program-section mini celebrations
// ---------------------------------------------------------------------------

/**
 * Trigger the week-complete celebration:
 *   - Checkmark cascade animation on `.program-set-check` elements
 *   - Mini confetti burst inside the `#program-section` container
 *   - Toast message
 *   - Week-streak update
 */
export function triggerWeekCompleteCelebration() {
  // Checkmark cascade
  const checks = document.querySelectorAll('.program-set-check');
  checks.forEach((el, i) => {
    el.style.animationDelay = (i * 80) + 'ms';
    el.classList.add('cascade');
  });

  // Mini confetti
  const section = $('program-section');
  const prevOverflow = section.style.overflow;
  const prevPosition = section.style.position;
  section.style.position = 'relative';
  section.style.overflow = 'hidden';
  const colors = ['#4caf50', '#ffd700', '#66bb6a', '#ffeb3b', '#81c784', '#fff176'];
  for (let i = 0; i < MINI_CONFETTI_COUNT; i++) {
    const particle = document.createElement('div');
    particle.className = 'mini-confetti';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = '-8px';
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    particle.style.animationDuration = (1.5 + Math.random() * 1.5) + 's';
    particle.style.animationDelay = (Math.random() * 0.5) + 's';
    section.appendChild(particle);
  }
  setTimeout(() => {
    section.querySelectorAll('.mini-confetti').forEach(p => p.remove());
    section.style.overflow = prevOverflow;
    section.style.position = prevPosition;
  }, MINI_CONFETTI_CLEANUP_MS);

  // Toast
  const lw = store.programConfig.liftWeeks?.[store.currentLift] || 1;
  _deps.showToast?.('Week ' + lw + ' complete!');

  // Streak
  _deps.updateWeekStreak?.(store.currentLift);
}

/**
 * Trigger the lift-complete celebration:
 *   - Checkmark cascade animation
 *   - Toast message
 */
export function triggerLiftCompleteCelebration() {
  // Checkmark cascade (reuse same animation)
  const checks = document.querySelectorAll('.program-set-check');
  checks.forEach((el, i) => {
    el.style.animationDelay = (i * 80) + 'ms';
    el.classList.add('cascade');
  });

  // Toast
  _deps.showToast?.(LIFT_NAMES[store.currentLift] + ' complete!');
}
