/**
 * Welcome screen — shown on first launch when no entries exist.
 *
 * Three-step onboarding flow: introduction, profile setup (gender,
 * bodyweight, goal), and features overview.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { WELCOME_KEY } from '../constants/storage-keys.js';
import { LBS_PER_KG } from '../constants/formulas.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = {};

export function setWelcomeDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Show welcome screen
// ---------------------------------------------------------------------------

/**
 * Show the welcome/onboarding overlay if the user has no entries
 * and hasn't previously dismissed the screen.
 */
export function showWelcomeScreen() {
  if (store.entries.length > 0 || localStorage.getItem(WELCOME_KEY)) return;
  const overlay = $('welcome-overlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  let selectedGender = null;

  function showStep(n) {
    overlay.querySelectorAll('.welcome-step').forEach(s => s.style.display = 'none');
    const step = $(`welcome-step-${n}`);
    if (step) step.style.display = '';
  }

  function applySetup() {
    if (selectedGender) {
      store.profile.gender = selectedGender;
      store.saveProfile();
    }
    const bw = parseFloat($('welcome-bw')?.value);
    if (bw > 0) {
      const bwLbs = store.unit === 'kg' ? bw * LBS_PER_KG : bw;
      store.profile.bodyweight = bwLbs;
      store.profile.bodyweightHistory.push({ date: new Date().toISOString().split('T')[0], value: bwLbs });
      store.saveProfile();
    }
    const goalVal = parseInt($('welcome-goal')?.value);
    if (goalVal > 0) {
      const goalLbs = store.unit === 'kg' ? goalVal * LBS_PER_KG : goalVal;
      store.goals.total = goalLbs;
      store.saveGoals();
    }
    _deps.updateDashboard?.();
  }

  function dismiss() {
    localStorage.setItem(WELCOME_KEY, '1');
    overlay.classList.add('fade-out');
    document.body.style.overflow = '';
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  }

  // Step 1 -> 2
  $('welcome-next-1').addEventListener('click', () => showStep(2));

  // Gender pills
  overlay.querySelectorAll('.welcome-pill[data-gender]').forEach(pill => {
    pill.addEventListener('click', () => {
      overlay.querySelectorAll('.welcome-pill[data-gender]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedGender = pill.dataset.gender;
    });
  });

  // Step 2 -> 3
  $('welcome-next-2').addEventListener('click', () => {
    applySetup();
    showStep(3);
  });
  $('welcome-skip-2').addEventListener('click', () => showStep(3));

  // Finish
  $('welcome-finish').addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Initialise the welcome overlay (no-op if not needed).
 * The actual show logic is in showWelcomeScreen().
 */
export function initWelcomeOverlay() {
  // Nothing to attach — showWelcomeScreen() is called from boot
}
