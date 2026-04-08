// src/data/exercise-compat.js — Backward compatibility layer for exercise IDs
//
// Maps all 57 legacy ACCESSORY_DB IDs to canonical EXERCISE_CATALOG IDs.
// Existing accessoryLog entries keep their original IDs forever.
// New entries use canonical IDs. This layer resolves at read time.

import { EXERCISE_CATALOG } from './exercise-catalog.js';
import { ACCESSORY_DB } from './accessories.js';
import store from '../state/store.js';

// ---------------------------------------------------------------------------
// Legacy ID → canonical ID mapping
// ---------------------------------------------------------------------------

export const LEGACY_ID_MAP = {
  // Squat accessories
  'sq-pause':      'pause-squat',
  'sq-front':      'front-squat',
  'sq-legpress':   'leg-press',
  'sq-goodmorning':'good-morning',
  'sq-hipthrust':  'hip-thrust',
  'sq-glutebridge':'glute-bridge',
  'sq-rdl':        'rdl',
  'sq-legext':     'leg-extension',
  'sq-bss':        'bulgarian-split-squat',
  'sq-lunge':      'lunges',
  'sq-abwheel':    'ab-wheel',
  'sq-pallof':     'pallof-press',
  'sq-plank':      'plank',
  'sq-wallsit':    'wall-sit',
  'sq-calfraise':  'calf-raise',

  // Bench accessories
  'bn-pause':      'pause-bench',
  'bn-spoto':      'spoto-press',
  'bn-dbpress':    'dumbbell-press',
  'bn-flies':      'chest-flies',
  'bn-cgbp':       'close-grip-bench',
  'bn-tricepext':  'tricep-extension',
  'bn-skulls':     'skull-crushers',
  'bn-jmpress':    'jm-press',
  'bn-ohp':        'overhead-press',
  'bn-incline':    'incline-bench',
  'bn-latraise':   'lateral-raises',
  'bn-facepull':   'face-pull',
  'bn-row':        'barbell-row',
  'bn-dbrow':      'dumbbell-row',
  'bn-reardelt':   'rear-delt-flies',
  'bn-pullup':     'pullup',
  'bn-widepullup': 'wide-pullup',
  'bn-chinup':     'chinup',

  // Deadlift accessories
  'dl-deficit':    'deficit-deadlift',
  'dl-frontsquat': 'front-squat',
  'dl-legpress':   'leg-press',
  'dl-blockpull':  'block-pull',
  'dl-hipthrust':  'hip-thrust',
  'dl-goodmorning':'good-morning',
  'dl-glutebridge':'glute-bridge',
  'dl-farmerwalk': 'farmers-walk',
  'dl-deadhang':   'dead-hang',
  'dl-shrugs':     'barbell-shrugs',
  'dl-row':        'barbell-row',
  'dl-latpulldown':'lat-pulldown',
  'dl-facepull':   'face-pull',
  'dl-dbshrugs':   'dumbbell-shrugs',
  'dl-pullup':     'pullup',
  'dl-calfraise':  'calf-raise',
  'dl-widepullup': 'wide-pullup',
  'dl-chinup':     'chinup',
};

// ---------------------------------------------------------------------------
// Reverse map: canonical ID → all legacy IDs that point to it
// ---------------------------------------------------------------------------

const _reverseMap = {};
for (const [legacyId, canonicalId] of Object.entries(LEGACY_ID_MAP)) {
  if (!_reverseMap[canonicalId]) _reverseMap[canonicalId] = [];
  _reverseMap[canonicalId].push(legacyId);
}

/**
 * Get all legacy IDs that map to a canonical ID.
 * @param {string} canonicalId
 * @returns {string[]} Legacy IDs (empty array if none)
 */
export function getLegacyIds(canonicalId) {
  return _reverseMap[canonicalId] || [];
}

// ---------------------------------------------------------------------------
// Resolution functions
// ---------------------------------------------------------------------------

/**
 * Resolve any exercise ID (old or new) to a canonical catalog ID.
 * @param {string} id - Legacy or canonical exercise ID
 * @returns {string} Canonical ID
 */
export function resolveCanonicalId(id) {
  if (EXERCISE_CATALOG[id]) return id;
  return LEGACY_ID_MAP[id] || id;
}

/**
 * Resolve any exercise ID to its EXERCISE_CATALOG entry.
 * @param {string} id - Legacy or canonical exercise ID
 * @returns {Object|null} Catalog entry or null if not found
 */
export function resolveExercise(id) {
  const canonical = resolveCanonicalId(id);
  return EXERCISE_CATALOG[canonical] || null;
}

/**
 * Resolve any exercise ID to a full exercise object with user overrides applied.
 * Checks custom accessories, then EXERCISE_CATALOG, then legacy ACCESSORY_DB.
 * @param {string} id - Any exercise ID
 * @returns {Object|null} Merged exercise entry or null
 */
export function resolveAccessory(id) {
  const custom = (store.customAccessories || []).find(c => c.id === id);
  if (custom) return { ...custom, ...(store.accessoryOverrides?.[id] || {}) };

  const canonical = resolveCanonicalId(id);
  const catalog = EXERCISE_CATALOG[canonical];
  if (catalog) return { ...catalog, ...(store.accessoryOverrides?.[canonical] || {}) };

  const legacy = ACCESSORY_DB[id];
  if (legacy) return { ...legacy, ...(store.accessoryOverrides?.[canonical] || {}) };

  return null;
}

/**
 * Get all unique exercise IDs (canonical catalog + custom).
 * Excludes legacy IDs that map to canonical ones.
 * @returns {string[]}
 */
export function getAllExerciseIds() {
  const ids = new Set(Object.keys(EXERCISE_CATALOG));
  for (const c of (store.customAccessories || [])) ids.add(c.id);
  return [...ids];
}

/**
 * Merge accessory log history from all legacy IDs that share a canonical ID.
 * Returns log entries sorted newest-first.
 *
 * @param {string} canonicalId - Canonical exercise ID
 * @param {Object[]} accessoryLog - The full accessory log array (store.accessoryLog)
 * @returns {Object[]} Merged log entries sorted by timestamp descending
 */
export function getExerciseHistory(canonicalId, accessoryLog) {
  const allIds = new Set([canonicalId, ...getLegacyIds(canonicalId)]);
  return accessoryLog
    .filter(entry => allIds.has(entry.exerciseId))
    .sort((a, b) => b.timestamp - a.timestamp);
}
