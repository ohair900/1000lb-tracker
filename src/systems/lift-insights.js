/**
 * Lift insights — pure data computations for per-lift analytics.
 *
 * Extracted from ai-export.js so the same bucket logic is reused
 * by both the in-app Lift Detail sheet and the AI export prompts.
 * No DOM access. No side effects.
 */

import store from '../state/store.js';
import { MS_PER_DAY } from '../constants/time.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Best e1RM for a lift up to (and including) a given timestamp.
 * Exported so ai-export.js can replace its own copy.
 * @param {string} lift
 * @param {number} beforeTimestamp
 * @returns {number}
 */
export function bestE1RMAsOf(lift, beforeTimestamp) {
  const vals = store.entries
    .filter((e) => e.lift === lift && e.timestamp <= beforeTimestamp && e.e1rm > 0)
    .map((e) => e.e1rm);
  return vals.length > 0 ? Math.max(...vals) : 0;
}

// ---------------------------------------------------------------------------
// Window helper
// ---------------------------------------------------------------------------

/**
 * All entries for a lift within the last N days, sorted oldest → newest.
 * @param {string} lift
 * @param {number} [days=90]
 * @returns {object[]}
 */
export function getLiftWindow(lift, days = 90) {
  const cutoff = Date.now() - days * MS_PER_DAY;
  return store.entries
    .filter((e) => e.lift === lift && e.timestamp >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);
}

// ---------------------------------------------------------------------------
// Distribution buckets (also usable with arbitrary entry arrays)
// ---------------------------------------------------------------------------

/**
 * Intensity zone counts + RPE bucket counts for an array of entries.
 * Called by calcIntensityDistribution and (via re-export) by ai-export.js.
 * @param {object[]} entries
 * @returns {{ zones: object, rpe: object, total: number }}
 */
export function bucketIntensity(entries) {
  const zones = { '<70%': 0, '70-80%': 0, '80-85%': 0, '85-90%': 0, '90%+': 0 };
  const rpe = { '6-7': 0, '7-8': 0, '8-9': 0, '9+': 0, none: 0 };

  entries.forEach((e) => {
    const best = bestE1RMAsOf(e.lift, e.timestamp);
    if (best > 0) {
      const pct = e.weight / best;
      if (pct >= 0.9) zones['90%+']++;
      else if (pct >= 0.85) zones['85-90%']++;
      else if (pct >= 0.8) zones['80-85%']++;
      else if (pct >= 0.7) zones['70-80%']++;
      else zones['<70%']++;
    }
    if (e.rpe) {
      if (e.rpe >= 9) rpe['9+']++;
      else if (e.rpe >= 8) rpe['8-9']++;
      else if (e.rpe >= 7) rpe['7-8']++;
      else rpe['6-7']++;
    } else {
      rpe['none']++;
    }
  });

  return { zones, rpe, total: entries.length };
}

/**
 * Rep range counts for an array of entries.
 * @param {object[]} entries
 * @returns {{ ranges: object, total: number }}
 */
export function bucketRepRange(entries) {
  const ranges = {
    'Singles (1-2)': 0,
    'Strength (3-5)': 0,
    'Volume (6-8)': 0,
    'Hypertrophy (8+)': 0,
  };
  entries.forEach((e) => {
    if (e.reps <= 2) ranges['Singles (1-2)']++;
    else if (e.reps <= 5) ranges['Strength (3-5)']++;
    else if (e.reps <= 8) ranges['Volume (6-8)']++;
    else ranges['Hypertrophy (8+)']++;
  });
  return { ranges, total: entries.length };
}

// ---------------------------------------------------------------------------
// Per-lift distribution wrappers
// ---------------------------------------------------------------------------

/**
 * Intensity and RPE distributions for a lift over a window.
 * @param {string} lift
 * @param {number} [days=90]
 * @returns {{ zones: object, rpe: object, total: number }}
 */
export function calcIntensityDistribution(lift, days = 90) {
  return bucketIntensity(getLiftWindow(lift, days));
}

/**
 * Rep range distribution for a lift over a window.
 * @param {string} lift
 * @param {number} [days=90]
 * @returns {{ ranges: object, total: number }}
 */
export function calcRepRangeDistribution(lift, days = 90) {
  return bucketRepRange(getLiftWindow(lift, days));
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

/**
 * E1RM gain rate (lbs/month) over the last N days.
 * Uses first-week vs last-week e1RM to smooth day-to-day noise.
 * @param {string} lift
 * @param {number} [days=90]
 * @returns {{ startE1RM, endE1RM, delta, days, lbsPerMonth, classification }|null}
 */
export function calcVelocity(lift, days = 90) {
  const entries = getLiftWindow(lift, days);
  if (entries.length < 2) return null;

  const firstTs = entries[0].timestamp;
  const lastTs = entries[entries.length - 1].timestamp;
  const weekMs = 7 * MS_PER_DAY;
  const earlyEnd = Math.min(firstTs + weekMs, lastTs);
  const lateStart = Math.max(lastTs - weekMs, firstTs);

  const earlyBests = entries.filter((e) => e.timestamp <= earlyEnd).map((e) => e.e1rm);
  const lateBests = entries.filter((e) => e.timestamp >= lateStart).map((e) => e.e1rm);
  if (earlyBests.length === 0 || lateBests.length === 0) return null;

  const startE1RM = Math.max(...earlyBests);
  const endE1RM = Math.max(...lateBests);
  const delta = endE1RM - startE1RM;
  const daySpan = Math.max(1, (lastTs - firstTs) / MS_PER_DAY);
  const lbsPerMonth = delta / (daySpan / 30);

  let classification;
  if (lbsPerMonth >= 5) classification = 'strong';
  else if (lbsPerMonth >= 2) classification = 'modest';
  else if (lbsPerMonth >= -2) classification = 'flat';
  else classification = 'declining';

  return { startE1RM, endE1RM, delta, days: daySpan, lbsPerMonth, classification };
}

// ---------------------------------------------------------------------------
// Block-over-block
// ---------------------------------------------------------------------------

/**
 * Split recent history into N equal blocks anchored to today, oldest first.
 * @param {string} lift
 * @param {number} [blocks=3]
 * @param {number} [blockDays=30]
 * @returns {Array<{ startDate, endDate, sets, avgIntensityPct, prCount, daysWithSessions }>}
 */
export function calcBlockOverBlock(lift, blocks = 3, blockDays = 30) {
  const now = Date.now();
  const blockMs = blockDays * MS_PER_DAY;

  const result = [];
  for (let i = 0; i < blocks; i++) {
    const blockEnd = now - (blocks - 1 - i) * blockMs;
    const blockStart = blockEnd - blockMs;
    const entries = store.entries.filter(
      (e) => e.lift === lift && e.timestamp >= blockStart && e.timestamp < blockEnd
    );
    const bestAtEnd = bestE1RMAsOf(lift, blockEnd);
    let totalPct = 0;
    let pctCount = 0;
    entries.forEach((e) => {
      if (bestAtEnd > 0) {
        totalPct += e.weight / bestAtEnd;
        pctCount++;
      }
    });
    result.push({
      startDate: new Date(blockStart).toISOString().split('T')[0],
      endDate: new Date(blockEnd).toISOString().split('T')[0],
      sets: entries.length,
      avgIntensityPct: pctCount > 0 ? Math.round((totalPct / pctCount) * 100) : 0,
      prCount: entries.filter((e) => e.isPR).length,
      daysWithSessions: new Set(entries.map((e) => e.date)).size,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Top sets
// ---------------------------------------------------------------------------

/**
 * Top N sets by e1RM (all-time), deduped on identical {date, weight, reps}.
 * @param {string} lift
 * @param {number} [n=5]
 * @returns {Array<{ date, weight, reps, rpe, e1rm, isPR }>}
 */
export function getTopSets(lift, n = 5) {
  const seen = new Set();
  return store.entries
    .filter((e) => e.lift === lift && e.e1rm > 0)
    .sort((a, b) => b.e1rm - a.e1rm)
    .filter((e) => {
      const key = `${e.date}|${e.weight}|${e.reps}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, n)
    .map((e) => ({
      date: e.date,
      weight: e.weight,
      reps: e.reps,
      rpe: e.rpe || null,
      e1rm: e.e1rm,
      isPR: !!e.isPR,
    }));
}

// ---------------------------------------------------------------------------
// RPE data gate
// ---------------------------------------------------------------------------

/**
 * True if >40% of last-N-day entries for this lift have an rpe value.
 * @param {string} lift
 * @param {number} [days=90]
 * @returns {boolean}
 */
export function hasRpeData(lift, days = 90) {
  const entries = getLiftWindow(lift, days);
  if (entries.length === 0) return false;
  const withRpe = entries.filter((e) => e.rpe != null).length;
  return withRpe / entries.length > 0.4;
}
