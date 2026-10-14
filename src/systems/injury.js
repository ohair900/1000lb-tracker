/**
 * Injury-aware workout logic — pure functions, no UI.
 *
 * Pipeline:
 *   getActiveInjuries()            → injuries the user has marked active
 *   findConflicts(exerciseIds)     → which exercises load an injured region
 *   substituteExercise(exerciseId) → wrist-safe (etc.) swap, or rest notice
 *   substituteExerciseList(ids)   → batch version used by workout builders;
 *                                    returns the adjusted id list PLUS a
 *                                    substitutions[] record for UI display.
 *
 * Severity escalation:
 *   mild / moderate → look up SUBSTITUTES for the injury region.
 *   severe          → rest the whole movement pattern; NO substitute is
 *                     offered (substituted: false, reason explains).
 *
 * UI CONTRACT (for the workout view — implemented by the view owner):
 *   Each entry in `substitutions[]` carries everything needed to render a
 *   badge/notice on the substituted exercise:
 *     { originalId, exerciseId, substituted, reason, injuryRegion,
 *       injurySeverity, dropped }
 *   Suggested badge copy:
 *     "Swapped due to your {region} injury — tap to keep original"
 *   Suggested dropped (severe) copy:
 *     "Dropped — rest this pattern while your {region} injury is severe"
 *   Manual override: tapping the badge reverts the exercise to `originalId`
 *   for that session only (the injury record itself is unchanged).
 *   This is deliberately the simplest robust override: session-scoped,
 *   one tap, no extra state.
 */

import store from '../state/store.js';
import {
  EXERCISE_LOADS,
  SUBSTITUTES,
  REGION_LABELS,
} from '../data/injury-map.js';
import { resolveCanonicalId } from '../data/exercise-compat.js';

// ---------------------------------------------------------------------------
// Injury access
// ---------------------------------------------------------------------------

/**
 * All injuries the user currently has marked active.
 * @returns {Object[]} Array of { id, region, side, severity, onsetDate, notes, active }
 */
export function getActiveInjuries() {
  // Defensive: some test doubles / partial store shapes omit getInjuries.
  if (typeof store.getInjuries !== 'function') return [];
  return store.getInjuries().filter((i) => i && i.active);
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Does an exercise's loading profile conflict with an injury region?
 * @param {Object} load - EXERCISE_LOADS entry
 * @param {string} region - injury region
 * @returns {boolean}
 */
function conflictsWithRegion(load, region) {
  if (!load) return false;
  if (region === 'wrist') {
    return load.grip === 'heavy' || load.wristFlexion || load.wristExtension;
  }
  return Array.isArray(load.joints) && load.joints.includes(region);
}

/**
 * Human-readable reason an exercise conflicts with an injury.
 * @param {string} exerciseId
 * @param {Object} injury
 * @returns {string}
 */
function conflictReason(exerciseId, injury) {
  const load = EXERCISE_LOADS[resolveCanonicalId(exerciseId)];
  const regionLabel = (REGION_LABELS[injury.region] || injury.region).toLowerCase();
  const bits = [];
  if (injury.region === 'wrist' && load) {
    if (load.grip === 'heavy') bits.push('heavy grip');
    if (load.wristFlexion) bits.push('loaded wrist flexion');
    if (load.wristExtension) bits.push('loaded wrist extension');
  } else if (load?.note) {
    bits.push(load.note);
  }
  const detail = bits.length ? ` (${bits.join(', ')})` : '';
  return `Loads your injured ${regionLabel}${detail}`;
}

/**
 * Find every exercise in a list that conflicts with an active injury.
 * Exercises missing from EXERCISE_LOADS are skipped (unknown loading —
 * we flag nothing rather than guess).
 *
 * @param {string[]} exerciseIds - canonical or legacy exercise ids
 * @returns {Object[]} [{ exerciseId, canonicalId, injury, region, severity, reason }]
 */
export function findConflicts(exerciseIds) {
  const injuries = getActiveInjuries();
  if (!injuries.length) return [];
  const out = [];
  for (const exerciseId of exerciseIds || []) {
    const canonicalId = resolveCanonicalId(exerciseId);
    const load = EXERCISE_LOADS[canonicalId];
    if (!load) continue;
    for (const injury of injuries) {
      if (conflictsWithRegion(load, injury.region)) {
        out.push({
          exerciseId,
          canonicalId,
          injury,
          region: injury.region,
          severity: injury.severity,
          reason: conflictReason(exerciseId, injury),
        });
        break; // one record per exercise (first matching injury)
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

/**
 * Look up the substitution table for a region: exact match first,
 * then a '*' wildcard, then nothing.
 * @param {string} canonicalId
 * @param {string} region
 * @returns {{use: string, note: string}|null}
 */
function lookupSubstitute(canonicalId, region) {
  const table = SUBSTITUTES[region] || [];
  const exact = table.find((s) => s.insteadOf === canonicalId);
  if (exact) return exact;
  const wild = table.find((s) => s.insteadOf === '*');
  return wild || null;
}

/**
 * Substitute a single exercise for the user's active injuries.
 *
 * @param {string} exerciseId - canonical or legacy exercise id
 * @returns {{ exerciseId: string, substituted: boolean, reason: string,
 *            originalId: string, injuryRegion: string|null,
 *            injurySeverity: string|null, dropped: boolean }}
 *   - substituted=false, dropped=false → no conflict; exercise unchanged.
 *   - substituted=true  → `exerciseId` is the safe swap; `originalId` kept
 *                          for the manual-override tap.
 *   - substituted=false, dropped=true → severe injury: rest this pattern.
 *   - substituted=false, dropped=false, reason set → conflicts but no safe
 *                          swap is listed; the UI should surface the reason.
 */
export function substituteExercise(exerciseId) {
  const canonicalId = resolveCanonicalId(exerciseId);
  const conflicts = findConflicts([exerciseId]);
  const base = {
    originalId: exerciseId,
    injuryRegion: null,
    injurySeverity: null,
    dropped: false,
  };
  if (!conflicts.length) {
    return {
      ...base,
      exerciseId,
      substituted: false,
      reason: '',
    };
  }
  const c = conflicts[0];
  const regionLabel = (REGION_LABELS[c.region] || c.region).toLowerCase();

  // Severe injuries rest the pattern — no substitute offered.
  if (c.severity === 'severe') {
    return {
      ...base,
      exerciseId,
      substituted: false,
      dropped: true,
      injuryRegion: c.region,
      injurySeverity: c.severity,
      reason: `Severe ${regionLabel} injury — rest this movement pattern rather than substituting. ${c.reason}.`,
    };
  }

  const sub = lookupSubstitute(canonicalId, c.region);
  if (!sub) {
    return {
      ...base,
      exerciseId,
      substituted: false,
      injuryRegion: c.region,
      injurySeverity: c.severity,
      reason: `${c.reason}. No safe substitute is listed for this movement — consider resting it while your ${regionLabel} injury heals.`,
    };
  }
  return {
    ...base,
    exerciseId: sub.use,
    substituted: true,
    injuryRegion: c.region,
    injurySeverity: c.severity,
    reason: `Swapped due to your ${regionLabel} injury — ${sub.note}`,
  };
}

/**
 * Batch version for workout builders: run conflicts → auto-substitute over
 * a whole plan, returning the adjusted id list PLUS a substitutions record
 * the UI can render as badges.
 *
 * Dedupe guard: if two different originals map to the same substitute,
 * the second keeps its original and is flagged (reason explains the
 * collision) rather than duplicating an exercise in the plan.
 *
 * @param {string[]} exerciseIds
 * @returns {{ ids: string[], substitutions: Object[] }}
 */
export function substituteExerciseList(exerciseIds) {
  const ids = [];
  const substitutions = [];
  const used = new Set();
  for (const id of exerciseIds || []) {
    const sub = substituteExercise(id);
    if (sub.substituted && used.has(sub.exerciseId)) {
      substitutions.push({
        ...sub,
        exerciseId: sub.originalId,
        substituted: false,
        reason: `${sub.reason} (already in this workout as another swap — kept the original to avoid a duplicate)`,
      });
      ids.push(id);
      used.add(resolveCanonicalId(id));
      continue;
    }
    substitutions.push(sub);
    ids.push(sub.exerciseId);
    used.add(resolveCanonicalId(sub.exerciseId));
  }
  return { ids, substitutions };
}
