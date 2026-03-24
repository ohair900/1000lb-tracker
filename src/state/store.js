/**
 * Centralised application state store.
 *
 * This is the single source of truth for the entire app.  It owns:
 *
 *  1. **Persistent stores** — data that round-trips through localStorage
 *     (entries, profile, goals, prs, cycles, programs, workoutConfig,
 *      accessoryLog, workoutSession, customTemplates, mesocycle,
 *      mesocycleHistory).
 *
 *  2. **Ephemeral UI state** — in-memory variables that do NOT persist
 *     across page loads (currentLift, currentTab, timerRunning, etc.).
 *
 *  3. **Batched save system** — identical to the original monolith logic:
 *     `save(name)` marks a store dirty and schedules a single
 *     `queueMicrotask(flush)` that writes all dirty stores in one shot.
 *     `saveNow(name)` bypasses the batch and writes immediately (used for
 *     workoutSession to avoid data loss on crash).
 *
 * The module exports a *singleton* instance as the default export so every
 * other module can `import store from './store.js'` and share the same state.
 */

import {
  STORAGE_KEY,
  UNIT_KEY,
  PROFILE_KEY,
  GOALS_KEY,
  PRS_KEY,
  VERSION_KEY,
  CYCLES_KEY,
  TIMER_KEY,
  THEME_KEY,
  PROGRAMS_KEY,
  AUTO_THEME_KEY,
  BADGES_KEY,
  DASH_WIDGETS_KEY,
  ACCENT_KEY,
  WORKOUT_KEY,
  ACCESSORY_LOG_KEY,
  WORKOUT_SESSION_KEY,
  CUSTOM_TEMPLATES_KEY,
  MESOCYCLE_KEY,
  MESOCYCLE_HISTORY_KEY,
  STATS_COLLAPSED_KEY,
} from '../constants/storage-keys.js';

import { CURRENT_VERSION } from '../constants/time.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-clone a JSON-safe value (used to snapshot default objects). */
function clone(v) {
  return v == null ? null : JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// Store class
// ---------------------------------------------------------------------------

class Store {
  constructor() {
    // -----------------------------------------------------------------------
    // Persistent stores — these are synced to localStorage via STORES registry
    // -----------------------------------------------------------------------
    this.entries = [];
    this.profile = { gender: null, bodyweight: null, bodyweightHistory: [] };
    this.goals = { squat: null, bench: null, deadlift: null, total: null };
    this.prs = [];
    this.cycles = [];
    this.programConfig = {
      activeProgram: null,
      trainingMaxes: {},
      currentWeek: 1,
      currentCycle: 1,
      completedSets: {},
      amrapResults: {},
      tmHistory: [],
      autoProgressEnabled: true,
      completedWeeks: {},
      weekStreak: 0,
    };
    this.workoutConfig = {
      weakPoints: { squat: null, bench: null, deadlift: null },
      setupComplete: false,
    };
    this.accessoryLog = [];
    this.workoutSession = null;
    this.customTemplates = [];
    this.activeMesocycle = null;
    this.mesocycleHistory = [];

    // -----------------------------------------------------------------------
    // Ephemeral UI state — NOT persisted via the STORES registry.
    // Some values are seeded from individual localStorage keys on init().
    // -----------------------------------------------------------------------
    this.currentLift = 'squat';
    this.currentTab = 'log';
    this.viewingCycle = null;  // null = viewing current cycle
    this.viewingWeek = null;   // null = viewing current week
    this.currentRPE = null;
    this.chartFilter = 'all';
    this.chartType = 'e1rm';
    this.chartDateRange = 'all';
    this.historyFilter = 'all';
    this.historyFrom = '';
    this.historyTo = '';
    this.historySearch = '';
    this.historyPage = 1;
    this.showDateFilters = false;
    this.notesVisible = false;
    this.editingEntryId = null;
    this.clearConfirm = false;
    this.lastLoggedSet = null;
    this.timerDuration = 180;
    this.timerRemaining = 0;
    this.timerInterval = null;
    this.timerRunning = false;
    this.exerciseTimer = null; // { accIdx, setIdx, remaining, duration, startTime, interval }
    this.sharedAudioCtx = null;
    this.activeCycleId = null;
    this.volPeriod = 'weekly';
    this.pendingSharePR = null;
    this.undoStack = null;
    this.undoTimer = null;
    this.statsCollapsed = {};
    this.unlockedBadges = {};
    this.dashboardWidgets = { ratios: true, fatigue: true, streak: true, recap: true, prStreak: true };
    this.builderExercises = [];
    this.calendarMonth = new Date();
    this.chartPoints = [];

    // Unit / theme / accent — persisted individually (not via STORES)
    this.unit = 'lbs';
    this.theme = 'dark';
    this.autoTheme = false;
    this.accentColor = 'gold';

    // -----------------------------------------------------------------------
    // STORES registry — maps logical names to localStorage keys, getters,
    // setters, defaults, and optional postLoad patches.
    // -----------------------------------------------------------------------
    this.STORES = {
      entries: {
        key: STORAGE_KEY,
        get: () => this.entries,
        set: (v) => { this.entries = v; },
        default: [],
      },
      profile: {
        key: PROFILE_KEY,
        get: () => this.profile,
        set: (v) => { this.profile = v; },
        default: { gender: null, bodyweight: null, bodyweightHistory: [] },
      },
      goals: {
        key: GOALS_KEY,
        get: () => this.goals,
        set: (v) => { this.goals = v; },
        default: { squat: null, bench: null, deadlift: null, total: null },
      },
      prs: {
        key: PRS_KEY,
        get: () => this.prs,
        set: (v) => { this.prs = v; },
        default: [],
      },
      cycles: {
        key: CYCLES_KEY,
        get: () => this.cycles,
        set: (v) => { this.cycles = v; },
        default: [],
      },
      programs: {
        key: PROGRAMS_KEY,
        get: () => this.programConfig,
        set: (v) => { this.programConfig = v; },
        default: {
          activeProgram: null,
          trainingMaxes: {},
          currentWeek: 1,
          currentCycle: 1,
          completedSets: {},
          amrapResults: {},
          tmHistory: [],
          autoProgressEnabled: true,
          completedWeeks: {},
          weekStreak: 0,
        },
        postLoad: () => this._patchProgramConfig(),
      },
      workoutConfig: {
        key: WORKOUT_KEY,
        get: () => this.workoutConfig,
        set: (v) => { this.workoutConfig = v; },
        default: {
          weakPoints: { squat: null, bench: null, deadlift: null },
          setupComplete: false,
        },
        postLoad: () => this._patchWorkoutConfig(),
      },
      accessoryLog: {
        key: ACCESSORY_LOG_KEY,
        get: () => this.accessoryLog,
        set: (v) => { this.accessoryLog = v; },
        default: [],
      },
      workoutSession: {
        key: WORKOUT_SESSION_KEY,
        get: () => this.workoutSession,
        set: (v) => { this.workoutSession = v; },
        default: null,
        nullable: true,
      },
      customTemplates: {
        key: CUSTOM_TEMPLATES_KEY,
        get: () => this.customTemplates,
        set: (v) => { this.customTemplates = v; },
        default: [],
      },
      mesocycle: {
        key: MESOCYCLE_KEY,
        get: () => this.activeMesocycle,
        set: (v) => { this.activeMesocycle = v; },
        default: null,
        nullable: true,
      },
      mesocycleHistory: {
        key: MESOCYCLE_HISTORY_KEY,
        get: () => this.mesocycleHistory,
        set: (v) => { this.mesocycleHistory = v; },
        default: [],
      },
    };

    // -----------------------------------------------------------------------
    // Batched-save internals
    // -----------------------------------------------------------------------
    this._dirtyStores = new Set();
    this._flushScheduled = false;

    /**
     * Optional callback invoked after any flush writes to localStorage.
     * The sync module sets this to `scheduleCloudSync`.
     * @type {Function|null}
     */
    this.onAfterFlush = null;

    /**
     * Optional callback for storage-full errors.
     * The UI layer sets this to `showToast`.
     * @type {Function|null}
     */
    this.onStorageFull = null;
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  /**
   * Load all persistent stores from localStorage, seed ephemeral state
   * from individual keys, and run migrations if needed.
   *
   * Call this once at app startup, *before* rendering.
   * Note: `rebuildPRs` and accessory-log pruning are intentionally NOT
   * called here — they depend on formulas/systems that may not be
   * imported yet.  The caller (boot / main) is responsible for calling
   * `rebuildPRs()` after `store.init()`.
   */
  init() {
    // 1. Load all registered persistent stores
    Object.keys(this.STORES).forEach((name) => this._loadStore(name));

    // Ensure bodyweightHistory always exists
    if (!this.profile.bodyweightHistory) this.profile.bodyweightHistory = [];

    // Derive activeCycleId from cycles
    this.activeCycleId = (this.cycles.find((c) => c.active) || {}).id || null;

    // 2. Seed ephemeral values that have their own localStorage keys
    this.unit = localStorage.getItem(UNIT_KEY) || 'lbs';
    this.timerDuration = parseInt(localStorage.getItem(TIMER_KEY)) || 180;
    this.theme = localStorage.getItem(THEME_KEY) || 'dark';
    this.autoTheme = localStorage.getItem(AUTO_THEME_KEY) === 'true';
    this.accentColor = localStorage.getItem(ACCENT_KEY) || 'gold';

    try {
      this.statsCollapsed = JSON.parse(localStorage.getItem(STATS_COLLAPSED_KEY)) || {};
    } catch {
      this.statsCollapsed = {};
    }

    try {
      this.unlockedBadges = JSON.parse(localStorage.getItem(BADGES_KEY)) || {};
    } catch {
      this.unlockedBadges = {};
    }

    try {
      const dw = JSON.parse(localStorage.getItem(DASH_WIDGETS_KEY));
      if (dw) this.dashboardWidgets = { ...this.dashboardWidgets, ...dw };
    } catch { /* keep defaults */ }

    // 3. Check schema version and migrate if needed
    const version = parseInt(localStorage.getItem(VERSION_KEY)) || 0;
    if (version < CURRENT_VERSION) {
      this._migrate(version);
    }
  }

  // -------------------------------------------------------------------------
  // Save — batched (default) and immediate
  // -------------------------------------------------------------------------

  /**
   * Mark a store as dirty and schedule a batched flush via queueMicrotask.
   * Multiple `save()` calls in the same microtask tick coalesce into one write.
   * @param {string} name - Store name from STORES registry
   */
  save(name) {
    this._dirtyStores.add(name);
    if (!this._flushScheduled) {
      this._flushScheduled = true;
      queueMicrotask(() => this._flush());
    }
  }

  /**
   * Write a single store to localStorage immediately, bypassing the batch.
   * Used for workoutSession where data loss on crash is unacceptable.
   * @param {string} name - Store name from STORES registry
   */
  saveNow(name) {
    this._dirtyStores.delete(name);
    const s = this.STORES[name];
    const val = s.get();
    try {
      if (val == null && s.nullable) localStorage.removeItem(s.key);
      else localStorage.setItem(s.key, JSON.stringify(val));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        if (this.onStorageFull) this.onStorageFull('Storage full! Export your data.');
      }
    }
  }

  /**
   * Mark every registered store as dirty and schedule a flush.
   */
  saveAll() {
    Object.keys(this.STORES).forEach((name) => this.save(name));
  }

  // -------------------------------------------------------------------------
  // Convenience save shortcuts (match original function names)
  // -------------------------------------------------------------------------

  saveEntries()        { this.save('entries'); }
  saveProfile()        { this.save('profile'); }
  saveGoals()          { this.save('goals'); }
  savePRs()            { this.save('prs'); }
  saveCycles()         { this.save('cycles'); }
  saveProgramConfig()  { this.save('programs'); }
  saveWorkoutConfig()  { this.save('workoutConfig'); }
  saveAccessoryLog()   { this.save('accessoryLog'); }
  saveWorkoutSession() { this.saveNow('workoutSession'); }
  saveCustomTemplates(){ this.save('customTemplates'); }
  saveMesocycle()      { this.save('mesocycle'); }
  saveMesocycleHistory() { this.save('mesocycleHistory'); }

  // -------------------------------------------------------------------------
  // Private: load, flush, migrate, patches
  // -------------------------------------------------------------------------

  /** @private Load a single store from localStorage. */
  _loadStore(name) {
    const s = this.STORES[name];
    try {
      const raw = localStorage.getItem(s.key);
      s.set(raw ? JSON.parse(raw) : (s.nullable ? null : clone(s.default)));
    } catch {
      s.set(s.nullable ? null : clone(s.default));
    }
    if (s.postLoad) s.postLoad();
  }

  /** @private Flush all dirty stores to localStorage in one shot. */
  _flush() {
    this._flushScheduled = false;
    const names = [...this._dirtyStores];
    this._dirtyStores.clear();

    names.forEach((name) => {
      const s = this.STORES[name];
      const val = s.get();
      try {
        if (val == null && s.nullable) localStorage.removeItem(s.key);
        else localStorage.setItem(s.key, JSON.stringify(val));
      } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22) {
          if (this.onStorageFull) this.onStorageFull('Storage full! Export your data.');
        }
      }
    });

    if (names.length > 0 && this.onAfterFlush) {
      this.onAfterFlush();
    }
  }

  /**
   * @private Run schema migrations from `fromVersion` to CURRENT_VERSION.
   * This patches every entry to ensure all expected fields exist.
   */
  _migrate(fromVersion) {
    this.entries.forEach((e) => {
      if (e.rpe === undefined) e.rpe = null;
      if (e.notes === undefined) e.notes = '';
      if (e.isPR === undefined) e.isPR = false;
      if (e.bodyweight === undefined) e.bodyweight = null;
      if (e.cycleId === undefined) e.cycleId = null;
      if (e.repPRs === undefined) e.repPRs = [];
      if (e.tags === undefined) e.tags = [];
    });
    // NOTE: rebuildPRs() must be called by the caller after init(),
    // since it depends on formula functions not imported here.
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION.toString());
    this.saveAll();
  }

  /** @private Ensure programConfig has all expected sub-fields. */
  _patchProgramConfig() {
    const pc = this.programConfig;
    if (!pc.completedSets) pc.completedSets = {};
    if (!pc.amrapResults) pc.amrapResults = {};
    if (!pc.tmHistory) pc.tmHistory = [];
    if (pc.autoProgressEnabled === undefined) pc.autoProgressEnabled = true;
    if (!pc.completedWeeks) pc.completedWeeks = {};
    if (!pc.weekStreak) pc.weekStreak = 0;
    // Migrate to cycle-aware keys
    if (!pc.currentCycle) pc.currentCycle = 1;
    const oldSetKeys = Object.keys(pc.completedSets).filter(k => !k.includes('-c'));
    if (oldSetKeys.length > 0) {
      const newSets = {};
      for (const [k, v] of Object.entries(pc.completedSets)) {
        if (k.includes('-c')) { newSets[k] = v; continue; }
        const parts = k.split('-');
        if (parts.length === 3) newSets[`${parts[0]}-c1-w${parts[1]}-${parts[2]}`] = v;
        else newSets[k] = v;
      }
      pc.completedSets = newSets;
    }
    const oldAmrapKeys = Object.keys(pc.amrapResults).filter(k => !k.includes('-c'));
    if (oldAmrapKeys.length > 0) {
      const newAmrap = {};
      for (const [k, v] of Object.entries(pc.amrapResults)) {
        if (k.includes('-c')) { newAmrap[k] = v; continue; }
        const parts = k.split('-');
        if (parts.length === 3) newAmrap[`${parts[0]}-c1-w${parts[1]}-${parts[2]}`] = v;
        else newAmrap[k] = v;
      }
      pc.amrapResults = newAmrap;
    }
    const oldWeekKeys = Object.keys(pc.completedWeeks).filter(k => !k.includes('c'));
    if (oldWeekKeys.length > 0) {
      const newWeeks = {};
      for (const [k, v] of Object.entries(pc.completedWeeks)) {
        if (k.includes('c')) { newWeeks[k] = v; continue; }
        newWeeks[`c1-w${k}`] = v;
      }
      pc.completedWeeks = newWeeks;
    }
  }

  /** @private Ensure workoutConfig has all expected sub-fields. */
  _patchWorkoutConfig() {
    if (!this.workoutConfig.weakPoints) {
      this.workoutConfig.weakPoints = { squat: null, bench: null, deadlift: null };
    }
  }
}

// ---------------------------------------------------------------------------
// Constants also owned by this module
// ---------------------------------------------------------------------------

/** Number of history entries per page in the history tab. */
export const HISTORY_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

const store = new Store();
export default store;
