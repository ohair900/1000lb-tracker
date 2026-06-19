/**
 * Accessory progress data derivation.
 *
 * All data is computed on demand from store.accessoryLog — no new
 * storage keys needed. Functions return summaries and per-exercise
 * detail suitable for rendering in the stats tab and detail sheet.
 */

import store from '../state/store.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { resolveExercise } from '../data/exercise-compat.js';
import { checkAccessoryProgression } from './workout-builder.js';

/**
 * Get summary stats for every accessory exercise the user has logged.
 * @returns {Map<string, Object>} Map of exerciseId → summary object
 */
export function getAccessorySummaries() {
  const map = new Map();

  for (const entry of store.accessoryLog) {
    let s = map.get(entry.exerciseId);
    if (!s) {
      const db = ACCESSORY_DB[entry.exerciseId];
      const catalogEx = resolveExercise(entry.exerciseId);
      s = {
        exerciseId: entry.exerciseId,
        name: catalogEx?.name || db?.name || entry.name || entry.exerciseId,
        mainLift: entry.mainLift || db?.mainLift || 'squat',
        equipment: catalogEx?.equipment || db?.equipment || entry.equipment || '',
        category: db?.category || catalogEx?.movementPattern || '',
        sessionCount: 0,
        dates: new Set(),
        lastDate: null,
        lastTimestamp: 0,
        lastWeight: 0,
        bestWeight: 0,
        weights: [],
      };
      map.set(entry.exerciseId, s);
    }
    s.dates.add(entry.date);
    if (entry.timestamp > s.lastTimestamp) {
      s.lastTimestamp = entry.timestamp;
      s.lastDate = entry.date;
      s.lastWeight = entry.weight;
      s.lastSetWeights = entry.setWeights || [];
      s.lastSetsCompleted = entry.setsCompleted || [];
    }
    if (entry.weight > s.bestWeight) s.bestWeight = entry.weight;
    s.weights.push({ date: entry.date, weight: entry.weight, timestamp: entry.timestamp });
  }

  // Finalize summaries
  for (const [, s] of map) {
    s.sessionCount = s.dates.size;
    delete s.dates;

    // Trend: compare last 2 distinct weights
    const sorted = s.weights.sort((a, b) => b.timestamp - a.timestamp);
    if (sorted.length >= 2) {
      const last = sorted[0].weight;
      const prev = sorted.find((w) => w.weight !== last);
      if (!prev) s.trend = 'flat';
      else if (last > prev.weight) s.trend = 'up';
      else if (last < prev.weight) s.trend = 'down';
      else s.trend = 'flat';
    } else {
      s.trend = 'flat';
    }
    delete s.weights;

    // Progression readiness
    s.readyToProgress = checkAccessoryProgression(s.exerciseId, s.mainLift);
  }

  // Sort by most recently used
  return new Map([...map.entries()].sort((a, b) => b[1].lastTimestamp - a[1].lastTimestamp));
}

/**
 * Get detailed data for a single accessory exercise.
 * @param {string} exerciseId
 * @returns {Object|null}
 */
export function getAccessoryDetail(exerciseId) {
  const db = ACCESSORY_DB[exerciseId];
  const catalogEx = resolveExercise(exerciseId);
  const entries = store.accessoryLog
    .filter((l) => l.exerciseId === exerciseId)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (entries.length === 0) return null;

  const mainLift = entries[0].mainLift || db?.mainLift || 'squat';
  const fallbackRepRange = db?.repRange || catalogEx?.repRange || [8, 12];
  const fallbackSets = db?.sets || catalogEx?.sets || 3;

  // Sessions (one per date, newest first)
  const sessions = entries.map((e) => {
    const targetSets = e.targetSets || fallbackSets;
    const repRange = e.repRange || fallbackRepRange;
    return {
      date: e.date,
      weight: e.weight,
      setWeights: e.setWeights || [],
      setsCompleted: e.setsCompleted || [],
      targetSets,
      repRange,
      mainLift: e.mainLift,
      allHitTop: e.setsCompleted
        ? e.setsCompleted.length >= targetSets && e.setsCompleted.every((r) => r >= repRange[1])
        : false,
    };
  });

  // Weight history for chart (oldest first)
  const weightHistory = entries
    .map((e) => ({ date: e.date, weight: e.weight, timestamp: e.timestamp }))
    .sort((a, b) => a.timestamp - b.timestamp);

  // Stats
  const totalSets = entries.reduce(
    (sum, e) => sum + (e.setsCompleted ? e.setsCompleted.length : 0),
    0
  );
  const allReps = entries.flatMap((e) => e.setsCompleted || []);
  const avgRepsPerSet =
    allReps.length > 0 ? allReps.reduce((a, b) => a + b, 0) / allReps.length : 0;
  const bestWeight = Math.max(...entries.map((e) => e.weight));
  const dates = new Set(entries.map((e) => e.date));

  // Progression count: how many times weight increased between consecutive sessions
  let progressionCount = 0;
  for (let i = weightHistory.length - 1; i > 0; i--) {
    if (weightHistory[i].weight > weightHistory[i - 1].weight) progressionCount++;
  }

  return {
    exerciseId,
    name: catalogEx?.name || db?.name || entries[0].name || exerciseId,
    mainLift,
    equipment: catalogEx?.equipment || db?.equipment || entries[0].equipment || '',
    category: db?.category || catalogEx?.movementPattern || '',
    repRange: fallbackRepRange,
    timeBased: !!(db?.timeBased || catalogEx?.timeBased),
    sessionCount: dates.size,
    lastDate: sessions[0].date,
    lastWeight: sessions[0].weight,
    bestWeight,
    trend:
      weightHistory.length >= 2
        ? weightHistory[weightHistory.length - 1].weight >
          weightHistory[weightHistory.length - 2].weight
          ? 'up'
          : weightHistory[weightHistory.length - 1].weight <
              weightHistory[weightHistory.length - 2].weight
            ? 'down'
            : 'flat'
        : 'flat',
    readyToProgress: checkAccessoryProgression(exerciseId, mainLift),
    sessions,
    weightHistory,
    totalSets,
    avgRepsPerSet,
    progressionCount,
  };
}
