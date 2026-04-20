/**
 * Shared test fixtures and helpers.
 *
 * Keeps mock construction DRY across system unit tests. Import like:
 *
 *   import { buildEntry, buildAccessoryLog, MS_PER_DAY } from './helpers/fixtures.js';
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Build a minimally-valid `entries` record for tests.
 *
 * @param {object} opts
 * @param {string} opts.lift      - 'squat' | 'bench' | 'deadlift'
 * @param {number} opts.weight    - Weight in lbs
 * @param {number} opts.reps
 * @param {number} [opts.daysAgo] - Default 0 (today)
 * @param {number} [opts.rpe]
 * @param {string} [opts.id]      - Auto-generated if omitted
 * @returns {object} Entry matching the shape used by store.entries
 */
export function buildEntry({ lift, weight, reps, daysAgo = 0, rpe, id }) {
  const ts = Date.now() - daysAgo * MS_PER_DAY;
  const e1rm = weight * (1 + reps / 30);
  return {
    id: id || `e-${lift}-${weight}-${reps}-${ts}-${Math.random().toString(36).slice(2, 6)}`,
    lift,
    weight,
    reps,
    e1rm: Math.round(e1rm * 10) / 10,
    date: new Date(ts).toISOString().split('T')[0],
    timestamp: ts,
    rpe,
    isPR: false,
    tags: [],
  };
}

/**
 * Build an accessoryLog entry.
 *
 * @param {object} opts
 * @param {string} opts.exerciseId
 * @param {string} [opts.name]
 * @param {number} [opts.weight] - Top-set weight in lbs (default 0 for BW)
 * @param {number[]} [opts.setsCompleted] - Reps per set (default [10,10,10])
 * @param {number[]} [opts.setWeights] - Weight per set (default fills with weight)
 * @param {number} [opts.daysAgo]
 * @param {string} [opts.mainLift]
 * @returns {object}
 */
export function buildAccessoryLog({
  exerciseId,
  name,
  weight = 0,
  setsCompleted = [10, 10, 10],
  setWeights,
  daysAgo = 0,
  mainLift = 'squat',
}) {
  const ts = Date.now() - daysAgo * MS_PER_DAY;
  return {
    id: `a-${exerciseId}-${ts}-${Math.random().toString(36).slice(2, 6)}`,
    exerciseId,
    name: name || exerciseId,
    weight,
    setWeights: setWeights || new Array(setsCompleted.length).fill(weight),
    setsCompleted: [...setsCompleted],
    targetSets: setsCompleted.length,
    repRange: [8, 12],
    date: new Date(ts).toISOString().split('T')[0],
    timestamp: ts,
    mainLift,
    source: 'quick',
  };
}

/**
 * Reset a mock store object to defaults between tests.
 * Use inside beforeEach() with the store returned from a vi.mock call.
 */
export function resetMockStore(store) {
  store.entries = [];
  store.accessoryLog = [];
  store.prs = [];
  store.customAccessories = [];
  store.customTemplates = [];
  store.accessoryOverrides = {};
  store.disabledAccessories = [];
  store.reasonTagCounts = {};
  store.workoutSession = null;
  store.goals = { squat: 405, bench: 315, deadlift: 495 };
  store.profile = { bodyweight: 180, gender: 'male', bodyweightHistory: [] };
  store.workoutConfig = { weakPoints: {}, setupComplete: true };
  store.unit = 'lbs';
  store.recoveryCalibration = {};
  store.equipmentProfile = {
    barbell: true,
    dumbbell: true,
    cable: true,
    machine: true,
    bodyweight: true,
  };
  store.programConfig = { activeProgram: null, completedSets: {}, completedSetData: {}, amrapResults: {}, liftWeeks: {} };
}

/**
 * Default mock store shape used across system tests.
 * Pass this to `vi.mock('../state/store.js', () => ({ default: createMockStore() }))`.
 */
export function createMockStore() {
  const store = {
    save: () => {},
    saveNow: () => {},
    saveEntries: () => {},
    savePRs: () => {},
    saveWorkoutSession: () => {},
    saveProgramConfig: () => {},
    saveCustomTemplates: () => {},
    saveCustomAccessories: () => {},
    saveDisabledAccessories: () => {},
    saveGoals: () => {},
    saveGoalMilestones: () => {},
    onAfterFlush: null,
    onStorageFull: null,
  };
  resetMockStore(store);
  return store;
}
