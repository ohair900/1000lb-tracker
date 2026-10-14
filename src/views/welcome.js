/**
 * Welcome screen — shown on first launch when no entries exist.
 *
 * Three-step onboarding flow:
 *   1. Introduction (what the app is) — Get Started, or explicit Skip
 *   2. Quick setup (units, gender, bodyweight, goal) — all optional
 *   3. First-set prompt (how logging works) — Back or Let's Go
 *
 * Rules:
 *   - Back navigation between every step.
 *   - No backdrop-tap / Escape accidental dismiss: only the explicit
 *     Skip / Let's Go buttons dismiss, and every dismiss stores the
 *     WELCOME_KEY "seen" flag so the flow never reappears.
 *   - Deep-link safety: if the URL carries a shared-workout join intent
 *     (#workout/CODE or ?join=), the welcome flow defers — it returns
 *     early WITHOUT setting the seen flag, so it shows on the next cold
 *     boot instead of swallowing the join.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { readPendingJoinCode } from '../firebase/shared-workout.js';
import { WELCOME_KEY, UNIT_KEY } from '../constants/storage-keys.js';
import { LBS_PER_KG } from '../constants/formulas.js';
import { trapFocus, releaseFocus } from '../ui/focus-trap.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

const _deps = {};

export function setWelcomeDeps(deps) {
  Object.assign(_deps, deps);
}

// Re-entrancy guard: showWelcomeScreen binds its listeners exactly once,
// even if called again before dismissal (e.g. the deferred deep-link case).
let _listenersBound = false;

// ---------------------------------------------------------------------------
// Deep-link guard
// ---------------------------------------------------------------------------

/**
 * True when the current URL carries a shared-workout join intent.
 * The welcome overlay must not cover that flow.
 */
function hasPendingJoinIntent() {
  if (typeof location === 'undefined') return false;
  if (location.hash && /^#workout\//.test(location.hash)) return true;
  try {
    if (new URLSearchParams(location.search).get('join')) return true;
  } catch {
    /* ignore — defensive only */
  }
  // Legacy ?join= links are scrubbed by main.js before welcome runs; the
  // intent survives in sessionStorage — honor it here too.
  try {
    if (readPendingJoinCode()) return true;
  } catch {
    /* ignore — defensive only */
  }
  return false;
}

// ---------------------------------------------------------------------------
// Show welcome screen
// ---------------------------------------------------------------------------

/**
 * Show the welcome/onboarding overlay if the user has no entries
 * and hasn't previously dismissed the screen.
 */
export function showWelcomeScreen() {
  if (store.entries.length > 0 || localStorage.getItem(WELCOME_KEY)) return;
  // Defer — don't set the seen flag, so welcome shows on the next boot
  // once the join intent is resolved.
  if (hasPendingJoinIntent()) return;

  const overlay = $('welcome-overlay');
  if (!overlay || overlay.dataset.flowOpen === '1') return;
  overlay.dataset.flowOpen = '1';
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Escape does NOT dismiss — dismissal requires an explicit Skip / Let's Go.
  trapFocus(overlay, () => {});

  let selectedGender = store.profile.gender || null;
  let selectedUnit = store.unit || 'lbs';

  function showStep(n) {
    overlay.querySelectorAll('.welcome-step').forEach((s) => (s.style.display = 'none'));
    const step = $(`welcome-step-${n}`);
    if (step) {
      step.style.display = '';
      // Move keyboard focus into the new step (announces it to SR users).
      const first = step.querySelector('.welcome-start-btn, .welcome-back-btn, input, button');
      if (first) first.focus();
    }
  }

  function syncUnitUI() {
    // Dashboard unit toggle + every unit label in the app
    document.querySelectorAll('.unit-btn').forEach((b) => {
      const active = b.dataset.unit === selectedUnit;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    document.querySelectorAll('.unit-label').forEach((el) => (el.textContent = selectedUnit));
    overlay.querySelectorAll('.welcome-unit-pills .welcome-pill').forEach((p) => {
      const active = p.dataset.unit === selectedUnit;
      p.classList.toggle('active', active);
      p.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function applySetup() {
    // Units always apply (default is whatever the app had).
    store.unit = selectedUnit;
    localStorage.setItem(UNIT_KEY, selectedUnit);
    syncUnitUI();
    if (selectedGender) {
      store.profile.gender = selectedGender;
      store.saveProfile();
    }
    const bw = parseFloat($('welcome-bw')?.value);
    if (bw > 0) {
      const bwLbs = selectedUnit === 'kg' ? bw * LBS_PER_KG : bw;
      store.profile.bodyweight = bwLbs;
      store.profile.bodyweightHistory.push({
        date: new Date().toISOString().split('T')[0],
        value: bwLbs,
      });
      store.saveProfile();
    }
    const goalVal = parseInt($('welcome-goal')?.value);
    if (goalVal > 0) {
      const goalLbs = selectedUnit === 'kg' ? goalVal * LBS_PER_KG : goalVal;
      store.goals.total = goalLbs;
      store.saveGoals();
    }
    _deps.updateDashboard?.();
  }

  function dismiss() {
    localStorage.setItem(WELCOME_KEY, '1');
    releaseFocus(overlay);
    overlay.classList.add('fade-out');
    document.body.style.overflow = '';
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  }

  if (!_listenersBound) {
    _listenersBound = true;

    // Step 1 -> 2, and explicit skip from step 1
    $('welcome-next-1').addEventListener('click', () => showStep(2));
    $('welcome-skip-1').addEventListener('click', dismiss);

    // Step 2 back -> 1
    $('welcome-back-2').addEventListener('click', () => showStep(1));

    // Units pills
    overlay.querySelectorAll('.welcome-unit-pills .welcome-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        selectedUnit = pill.dataset.unit;
        syncUnitUI();
      });
    });

    // Gender pills
    overlay.querySelectorAll('.welcome-gender-pills .welcome-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        overlay
          .querySelectorAll('.welcome-gender-pills .welcome-pill')
          .forEach((p) => {
            p.classList.remove('active');
            p.setAttribute('aria-pressed', 'false');
          });
        pill.classList.add('active');
        pill.setAttribute('aria-pressed', 'true');
        selectedGender = pill.dataset.gender;
      });
    });

    // Step 2 -> 3 (Continue applies setup; Skip jumps without applying)
    $('welcome-next-2').addEventListener('click', () => {
      applySetup();
      showStep(3);
    });
    $('welcome-skip-2').addEventListener('click', () => showStep(3));

    // Step 3 back -> 2, finish
    $('welcome-back-3').addEventListener('click', () => showStep(2));
    $('welcome-finish').addEventListener('click', dismiss);

    // NOTE: no backdrop-tap dismiss — dismissal requires Skip / Let's Go.
  }

  // Reflect any pre-existing profile values into the pills
  if (selectedGender) {
    overlay
      .querySelectorAll(`.welcome-gender-pills .welcome-pill[data-gender="${selectedGender}"]`)
      .forEach((p) => {
        p.classList.add('active');
        p.setAttribute('aria-pressed', 'true');
      });
  }
  syncUnitUI();
  showStep(1);
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
