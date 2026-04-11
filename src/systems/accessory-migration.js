/**
 * One-time migration: rewrite legacy accessory exerciseIds to canonical IDs.
 *
 * Eliminates duplicate accessory entries caused by the old scheme that keyed
 * exercises by which main-lift day they appeared on (e.g. `sq-front` and
 * `dl-frontsquat` both being Front Squat). After this migration runs, every
 * exerciseId reference in persistent storage uses canonical catalog IDs.
 *
 * Idempotent via a localStorage version flag — safe to re-run on every boot.
 * Uses the explicit LEGACY_ID_MAP in exercise-compat.js as the authoritative
 * source of truth for legacy → canonical mapping.
 */

import store from '../state/store.js';
import { resolveCanonicalId } from '../data/exercise-compat.js';
import { ACCESSORY_MIGRATION_KEY } from '../constants/storage-keys.js';

const CURRENT_VERSION = 1;

/**
 * Run the accessory ID migration if it hasn't been run yet on this device.
 *
 * Must be called AFTER deferred stores (accessoryLog, customTemplates,
 * accessoryOverrides, disabledAccessories, reasonTagCounts) have finished
 * loading. In main.js this is scheduled via setTimeout inside the existing
 * requestIdleCallback block to guarantee the store's own deferred load has
 * completed first.
 *
 * @returns {{ migrated: number, breakdown?: object, skipped: boolean }}
 */
export function migrateAccessoryIds() {
  const stored = parseInt(localStorage.getItem(ACCESSORY_MIGRATION_KEY) || '0', 10);
  if (stored >= CURRENT_VERSION) return { migrated: 0, skipped: true };

  const counts = { log: 0, templates: 0, session: 0, overrides: 0, disabled: 0, reasons: 0 };

  // 1. accessoryLog — the historical set log (primary target)
  if (Array.isArray(store.accessoryLog)) {
    store.accessoryLog.forEach(entry => {
      if (!entry || !entry.exerciseId) return;
      const canon = resolveCanonicalId(entry.exerciseId);
      if (canon && canon !== entry.exerciseId) {
        entry.exerciseId = canon;
        counts.log++;
      }
    });
    if (counts.log > 0) store.saveNow('accessoryLog');
  }

  // 2. customTemplates — saved templates reference exerciseIds in their
  // exercise lists. Rewrite so future workouts from these templates use
  // canonical IDs going forward.
  if (Array.isArray(store.customTemplates)) {
    store.customTemplates.forEach(tmpl => {
      if (!tmpl || !Array.isArray(tmpl.exercises)) return;
      tmpl.exercises.forEach(ex => {
        if (!ex || !ex.exerciseId) return;
        const canon = resolveCanonicalId(ex.exerciseId);
        if (canon && canon !== ex.exerciseId) {
          ex.exerciseId = canon;
          counts.templates++;
        }
      });
    });
    if (counts.templates > 0) store.saveCustomTemplates();
  }

  // 3. workoutSession — in-progress workout, if any. Covers the edge case
  // where a user is mid-session when the migration runs.
  if (store.workoutSession && Array.isArray(store.workoutSession.accessories)) {
    store.workoutSession.accessories.forEach(acc => {
      if (!acc || !acc.exerciseId) return;
      const canon = resolveCanonicalId(acc.exerciseId);
      if (canon && canon !== acc.exerciseId) {
        acc.exerciseId = canon;
        counts.session++;
      }
    });
    if (counts.session > 0) store.saveNow('workoutSession');
  }

  // 4. accessoryOverrides — object keyed by exerciseId. Rename legacy keys
  // to canonical. If both legacy and canonical keys exist, canonical wins
  // (the user's newer override takes precedence).
  if (store.accessoryOverrides && typeof store.accessoryOverrides === 'object') {
    const newOverrides = {};
    Object.entries(store.accessoryOverrides).forEach(([id, val]) => {
      const canon = resolveCanonicalId(id) || id;
      if (canon !== id) counts.overrides++;
      // Canonical wins on collision — only set if not already present
      if (!newOverrides[canon]) newOverrides[canon] = val;
    });
    store.accessoryOverrides = newOverrides;
    if (counts.overrides > 0) store.save('accessoryOverrides');
  }

  // 5. disabledAccessories — array of exerciseIds the user hid from picks.
  // Map each to canonical and deduplicate.
  if (Array.isArray(store.disabledAccessories)) {
    const newDisabled = [];
    const seen = new Set();
    store.disabledAccessories.forEach(id => {
      if (!id) return;
      const canon = resolveCanonicalId(id) || id;
      if (canon !== id) counts.disabled++;
      if (!seen.has(canon)) { seen.add(canon); newDisabled.push(canon); }
    });
    store.disabledAccessories = newDisabled;
    if (counts.disabled > 0) store.save('disabledAccessories');
  }

  // 6. reasonTagCounts — object keyed by exerciseId, values are integer
  // counts. Sum on collision.
  if (store.reasonTagCounts && typeof store.reasonTagCounts === 'object') {
    const newCounts = {};
    Object.entries(store.reasonTagCounts).forEach(([id, val]) => {
      const canon = resolveCanonicalId(id) || id;
      if (canon !== id) counts.reasons++;
      const n = typeof val === 'number' ? val : 0;
      newCounts[canon] = (newCounts[canon] || 0) + n;
    });
    store.reasonTagCounts = newCounts;
    if (counts.reasons > 0) store.save('reasonTagCounts');
  }

  localStorage.setItem(ACCESSORY_MIGRATION_KEY, String(CURRENT_VERSION));

  const total = counts.log + counts.templates + counts.session
    + counts.overrides + counts.disabled + counts.reasons;
  return { migrated: total, breakdown: counts, skipped: false };
}
