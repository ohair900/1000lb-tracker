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

let _deps = {};

export function setTimerDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Screen Wake Lock — keeps the screen on during timed exercises
// ---------------------------------------------------------------------------

let _wakeLock = null;

async function requestWakeLock() {
  try {
    if (navigator.wakeLock) _wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* best-effort */ }
}

function releaseWakeLock() {
  if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
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
 * Play a pleasant three-note ascending chime (C5-E5-G5) to signal
 * timer completion.  Each note layers a fundamental + octave harmonic
 * with a smooth attack/decay envelope so it sounds warm, not harsh.
 */
export function playBeep() {
  try {
    ensureAudioContext();
    const ac = store.sharedAudioCtx;
    if (!ac) return;

    const notes = [
      { freq: 523.25, start: 0,    dur: 0.3  },  // C5
      { freq: 659.25, start: 0.2,  dur: 0.3  },  // E5
      { freq: 783.99, start: 0.4,  dur: 0.45 },  // G5 (held slightly longer)
    ];

    notes.forEach(({ freq, start, dur }) => {
      const t = ac.currentTime + start;

      // Fundamental
      const osc = ac.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.45, t + 0.04);
      g.gain.linearRampToValueAtTime(0, t + dur);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(t);
      osc.stop(t + dur);

      // Octave harmonic for shimmer
      const osc2 = ac.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = freq * 2;
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(0.15, t + 0.04);
      g2.gain.linearRampToValueAtTime(0, t + dur);
      osc2.connect(g2);
      g2.connect(ac.destination);
      osc2.start(t);
      osc2.stop(t + dur);
    });
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
  ensureAudioContext();
  store.timerDuration = secs || store.timerDuration;
  localStorage.setItem(TIMER_KEY, store.timerDuration.toString());
  _deps.scheduleCloudSync?.();
  store.timerRemaining = store.timerDuration;
  store.timerStartTime = Date.now();
  store.timerRunning = true;
  $('timer-container').classList.add('active');
  updateTimerDisplay();

  store.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - store.timerStartTime) / 1000);
    store.timerRemaining = Math.max(0, store.timerDuration - elapsed);
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
  _deps.saveWorkoutSession?.();
  _deps.renderWorkoutView?.();
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
  requestWakeLock();
  const acc = store.workoutSession.accessories[accIdx];
  const duration = acc.repRange[1];
  store.exerciseTimer = {
    accIdx, setIdx,
    remaining: duration,
    duration,
    startTime: Date.now(),
    interval: null,
  };

  _deps.renderWorkoutView?.();

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
  releaseWakeLock();
}

/**
 * Cancel the exercise timer and re-render the workout view.
 */
export function cancelExerciseTimer() {
  stopExerciseTimer();
  _deps.renderWorkoutView?.();
}

// ---------------------------------------------------------------------------
// Background recovery — fire missed notifications when page becomes visible
// ---------------------------------------------------------------------------

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  // Rest timer: check if it should have completed while backgrounded
  if (store.timerRunning && store.timerStartTime) {
    const elapsed = Math.floor((Date.now() - store.timerStartTime) / 1000);
    store.timerRemaining = Math.max(0, store.timerDuration - elapsed);
    if (store.timerRemaining <= 0) {
      stopTimer();
      playBeep();
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      const display = $('timer-display');
      if (display) {
        display.textContent = 'DONE';
        display.className = 'timer-display done';
      }
    } else {
      updateTimerDisplay();
    }
  }

  // Exercise timer: check if it should have completed while backgrounded
  if (store.exerciseTimer && store.exerciseTimer.startTime) {
    const elapsed = Math.floor((Date.now() - store.exerciseTimer.startTime) / 1000);
    store.exerciseTimer.remaining = Math.max(0, store.exerciseTimer.duration - elapsed);
    if (store.exerciseTimer.remaining <= 0) {
      completeExerciseTimer();
    }
  }
});
