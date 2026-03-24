/**
 * Rest timer and exercise (timed-hold) timer.
 *
 * The rest timer counts down from `store.timerDuration` seconds and
 * plays a two-tone beep when it hits zero.
 *
 * The exercise timer counts down a hold duration for timed accessories
 * (e.g. planks) and auto-completes the set, then kicks off a rest timer.
 *
 * Both timers read/write ephemeral state on the store singleton.
 */

import { $ } from '../utils/helpers.js';
import store from '../state/store.js';
import { TIMER_KEY } from '../constants/storage-keys.js';

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/** @type {Function|null} */
let _scheduleCloudSync = null;

/** @type {Function|null} */
let _renderWorkoutView = null;

/** @type {Function|null} */
let _saveWorkoutSession = null;

/**
 * Wire up callbacks that the timer module cannot import directly.
 *
 * @param {object} deps
 * @param {Function} [deps.scheduleCloudSync]
 * @param {Function} [deps.renderWorkoutView]
 * @param {Function} [deps.saveWorkoutSession]
 */
export function setTimerDeps(deps) {
  if (deps.scheduleCloudSync) _scheduleCloudSync = deps.scheduleCloudSync;
  if (deps.renderWorkoutView) _renderWorkoutView = deps.renderWorkoutView;
  if (deps.saveWorkoutSession) _saveWorkoutSession = deps.saveWorkoutSession;
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the shared AudioContext is available and resumed.
 * Must be called from a user-gesture context on iOS/Safari.
 */
export function ensureAudioContext() {
  try {
    if (!store.sharedAudioCtx || store.sharedAudioCtx.state === 'closed') {
      store.sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (store.sharedAudioCtx.state === 'suspended') store.sharedAudioCtx.resume();
  } catch { /* ignore — audio is best-effort */ }
}

/**
 * Play a two-tone beep (800 Hz then 1000 Hz) to signal timer completion.
 */
export function playBeep() {
  try {
    ensureAudioContext();
    const ac = store.sharedAudioCtx;
    if (!ac) return;

    function tone(freq, delay) {
      const t = ac.currentTime + delay;
      const g = ac.createGain();
      g.gain.value = 0.3;
      g.connect(ac.destination);
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.3);
    }

    tone(800, 0);
    tone(1000, 0.35);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Rest timer
// ---------------------------------------------------------------------------

/**
 * Update the timer display element with the current remaining time.
 */
export function updateTimerDisplay() {
  const m = Math.floor(store.timerRemaining / 60);
  const s = store.timerRemaining % 60;
  const display = $('timer-display');
  display.textContent = m + ':' + String(s).padStart(2, '0');
  const pct = ((store.timerDuration - store.timerRemaining) / store.timerDuration * 100);
  display.className = 'timer-display' + (pct > 80 ? ' warning' : '');
}

/**
 * Stop the rest timer interval without hiding the UI.
 */
export function stopTimer() {
  if (store.timerInterval) clearInterval(store.timerInterval);
  store.timerInterval = null;
  store.timerRunning = false;
}

/**
 * Start (or restart) the rest timer.
 *
 * @param {number} [secs] - Duration in seconds; defaults to store.timerDuration
 */
export function startTimer(secs) {
  stopTimer();
  store.timerDuration = secs || store.timerDuration;
  localStorage.setItem(TIMER_KEY, store.timerDuration.toString());
  if (_scheduleCloudSync) _scheduleCloudSync();
  store.timerRemaining = store.timerDuration;
  store.timerRunning = true;
  $('timer-container').classList.add('active');
  updateTimerDisplay();

  store.timerInterval = setInterval(() => {
    store.timerRemaining--;
    updateTimerDisplay();
    if (store.timerRemaining <= 0) {
      stopTimer();
      playBeep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      $('timer-display').textContent = 'DONE';
      $('timer-display').className = 'timer-display done';
    }
  }, 1000);
}

/**
 * Dismiss the rest timer — stops and hides the timer container.
 */
export function dismissTimer() {
  stopTimer();
  $('timer-container').classList.remove('active');
}

// ---------------------------------------------------------------------------
// Exercise (timed-hold) timer
// ---------------------------------------------------------------------------

/**
 * Complete the current exercise timer: record the hold duration,
 * play a beep, start a rest timer, and re-render the workout view.
 */
function completeExerciseTimer() {
  if (!store.exerciseTimer || !store.workoutSession) return;
  const { accIdx, duration } = store.exerciseTimer;
  const acc = store.workoutSession.accessories[accIdx];
  acc.setsCompleted.push(duration);
  stopExerciseTimer();
  playBeep();
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
  startTimer(store.timerDuration);
  if (_saveWorkoutSession) _saveWorkoutSession();
  if (_renderWorkoutView) _renderWorkoutView();
}

/**
 * Start a timed exercise countdown for an accessory set.
 *
 * @param {number} accIdx - Index into workoutSession.accessories
 * @param {number} setIdx - Current set index
 */
export function startExerciseTimer(accIdx, setIdx) {
  stopExerciseTimer();
  ensureAudioContext();
  const acc = store.workoutSession.accessories[accIdx];
  const duration = acc.repRange[1];
  store.exerciseTimer = {
    accIdx, setIdx,
    remaining: duration,
    duration,
    startTime: Date.now(),
    interval: null,
  };

  if (_renderWorkoutView) _renderWorkoutView();

  store.exerciseTimer.interval = setInterval(() => {
    if (!store.exerciseTimer) return;
    const elapsed = Math.floor((Date.now() - store.exerciseTimer.startTime) / 1000);
    store.exerciseTimer.remaining = Math.max(0, store.exerciseTimer.duration - elapsed);

    // Update display directly without full re-render
    const display = document.getElementById(
      `exercise-cd-${store.exerciseTimer.accIdx}-${store.exerciseTimer.setIdx}`
    );
    if (display) {
      display.textContent = store.exerciseTimer.remaining + 's';
      display.className = 'exercise-countdown-display' +
        (store.exerciseTimer.remaining <= 3 ? ' final' :
          store.exerciseTimer.remaining <= 10 ? ' warning' : '');
    }

    if (store.exerciseTimer.remaining <= 0) {
      completeExerciseTimer();
    }
  }, 250);
}

/**
 * Stop the exercise timer and clear state.
 */
export function stopExerciseTimer() {
  if (store.exerciseTimer && store.exerciseTimer.interval) {
    clearInterval(store.exerciseTimer.interval);
  }
  store.exerciseTimer = null;
}

/**
 * Cancel the exercise timer and re-render the workout view.
 */
export function cancelExerciseTimer() {
  stopExerciseTimer();
  if (_renderWorkoutView) _renderWorkoutView();
}
