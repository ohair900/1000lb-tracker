/**
 * Self-calibrating recovery system.
 *
 * Analyzes inter-session intervals vs. performance outcomes to learn
 * each user's actual recovery rate per muscle group. Gradually blends
 * calibrated values with defaults as confidence grows.
 *
 * Minimum: 6 weeks of training history.
 * Full confidence: 24 interval-performance pairs per muscle group.
 */

import store from '../state/store.js';
import { MS_PER_DAY, SAME_SESSION_MS } from '../constants/time.js';
import {
  MUSCLE_GROUPS,
  MUSCLE_RECOVERY_HOURS,
  MAIN_LIFT_WEIGHTS,
  ACCESSORY_CAT_WEIGHTS,
} from '../data/muscle-groups.js';
import { ACCESSORY_DB } from '../data/accessories.js';

const SIX_WEEKS_MS = 42 * MS_PER_DAY;
const FULL_CONFIDENCE_SAMPLES = 24;
const THROTTLE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Core calibration
// ---------------------------------------------------------------------------

/**
 * Calibrate recovery hours for a single muscle group by analyzing
 * inter-session intervals and subsequent performance.
 *
 * @param {string} mg - Muscle group name
 * @returns {{ hours: number, confidence: number, sampleCount: number }|null}
 */
function calibrateRecovery(mg) {
  const entries = store.entries;
  if (!entries || entries.length === 0) return null;

  const now = Date.now();
  const oldest = entries.reduce((min, e) => Math.min(min, e.timestamp), Infinity);
  if ((now - oldest) < SIX_WEEKS_MS) return null;

  // Find sessions that target this muscle group, ordered chronologically
  const sessions = [];
  entries
    .filter(e => {
      const w = MAIN_LIFT_WEIGHTS[e.lift];
      return w && w[mg];
    })
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach(e => {
      // Group entries within 2 hours as same session
      const last = sessions[sessions.length - 1];
      if (last && (e.timestamp - last.timestamp) < SAME_SESSION_MS) {
        // Update session with best e1rm
        if (e.e1rm > last.e1rm) {
          last.e1rm = e.e1rm;
          last.weight = e.weight;
          last.reps = e.reps;
        }
      } else {
        sessions.push({
          timestamp: e.timestamp,
          e1rm: e.e1rm,
          weight: e.weight,
          reps: e.reps,
          lift: e.lift,
        });
      }
    });

  if (sessions.length < 4) return null;

  // Build interval-performance pairs
  const pairs = [];
  for (let i = 1; i < sessions.length; i++) {
    const intervalHours = (sessions[i].timestamp - sessions[i - 1].timestamp) / (1000 * 60 * 60);
    // Performance delta: positive = maintained or improved
    const delta = sessions[i].e1rm - sessions[i - 1].e1rm;
    // Normalize: percentage change relative to baseline
    const pctDelta = sessions[i - 1].e1rm > 0
      ? delta / sessions[i - 1].e1rm
      : 0;
    pairs.push({ interval: intervalHours, delta: pctDelta });
  }

  if (pairs.length < 3) return null;

  // Find median interval where performance was maintained or improved (delta >= -0.02)
  // Using -2% threshold to account for normal day-to-day variation
  const goodPairs = pairs.filter(p => p.delta >= -0.02);
  if (goodPairs.length === 0) {
    return {
      hours: MUSCLE_RECOVERY_HOURS[mg],
      confidence: 0,
      sampleCount: pairs.length,
    };
  }

  // Median of intervals with good performance
  const sortedIntervals = goodPairs.map(p => p.interval).sort((a, b) => a - b);
  const medianIdx = Math.floor(sortedIntervals.length / 2);
  const calibratedHours = sortedIntervals.length % 2 === 0
    ? (sortedIntervals[medianIdx - 1] + sortedIntervals[medianIdx]) / 2
    : sortedIntervals[medianIdx];

  // Clamp to reasonable bounds (12h - 168h / 1 week)
  const clampedHours = Math.max(12, Math.min(168, calibratedHours));

  const confidence = Math.min(1.0, pairs.length / FULL_CONFIDENCE_SAMPLES);

  return {
    hours: Math.round(clampedHours),
    confidence: Math.round(confidence * 100) / 100,
    sampleCount: pairs.length,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the recovery hours for a muscle group, blending calibrated and default
 * values based on confidence level.
 *
 * @param {string} mg - Muscle group name
 * @returns {number} Recovery hours (blended)
 */
export function getCalibratedRecovery(mg) {
  const defaultHours = MUSCLE_RECOVERY_HOURS[mg];
  const cal = store.recoveryCalibration;
  if (!cal || !cal[mg] || cal[mg].confidence === 0) return defaultHours;

  const { hours: calibratedHours, confidence } = cal[mg];
  // Gradual blend: at confidence 0 → pure default, at 1.0 → pure calibrated
  return Math.round((1 - confidence) * defaultHours + confidence * calibratedHours);
}

/**
 * Get the calibration data for a muscle group (for UI display).
 *
 * @param {string} mg - Muscle group name
 * @returns {{ hours: number, confidence: number, sampleCount: number, isCalibrated: boolean }}
 */
export function getCalibrationInfo(mg) {
  const cal = store.recoveryCalibration;
  if (!cal || !cal[mg]) {
    return {
      hours: MUSCLE_RECOVERY_HOURS[mg],
      confidence: 0,
      sampleCount: 0,
      isCalibrated: false,
    };
  }
  return {
    hours: getCalibratedRecovery(mg),
    confidence: cal[mg].confidence,
    sampleCount: cal[mg].sampleCount,
    isCalibrated: cal[mg].confidence > 0,
  };
}

/**
 * Run calibration for all muscle groups and persist results.
 * Throttled to at most once per 24 hours.
 */
export function runCalibration() {
  const cal = store.recoveryCalibration || {};
  const now = Date.now();

  // Throttle: skip if last calibration was recent
  const anyRecent = MUSCLE_GROUPS.some(mg =>
    cal[mg] && cal[mg].lastCalibrated && (now - cal[mg].lastCalibrated) < THROTTLE_MS
  );
  if (anyRecent) return;

  const updated = {};
  MUSCLE_GROUPS.forEach(mg => {
    const result = calibrateRecovery(mg);
    if (result) {
      updated[mg] = {
        hours: result.hours,
        confidence: result.confidence,
        sampleCount: result.sampleCount,
        lastCalibrated: now,
      };
    } else {
      // Keep existing calibration or initialize with defaults
      updated[mg] = cal[mg] || {
        hours: MUSCLE_RECOVERY_HOURS[mg],
        confidence: 0,
        sampleCount: 0,
        lastCalibrated: null,
      };
    }
  });

  store.recoveryCalibration = updated;
  store.save('recoveryCalibration');
}
