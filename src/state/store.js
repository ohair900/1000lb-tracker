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
  PROGRAMS_KEY,
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
  LEADERBOARD_KEY,
  RECOVERY_CALIBRATION_KEY,
  DELETED_IDS_KEY,
  EQUIPMENT_PROFILE_KEY,
  REASON_TAG_COUNTS_KEY,
  ACCESSORY_OVERRIDES_KEY,
  CUSTOM_ACCESSORIES_KEY,
  DISABLED_ACCESSORIES_KEY,
  GOAL_MILESTONES_KEY,
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
      liftWeeks: { squat: 1, bench: 1, deadlift: 1 },
      completedSets: {},
      amrapResults: {},
      tmHistory: [],
      autoProgressEnabled: true,
      completedWeeks: {},
      weekStreak: 0,
      progressedCycles: {},
      failureCounts: { squat: 0, bench: 0, deadlift: 0 },
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
    this.leaderboardOptedIn = true;
    this.recoveryCalibration = null;
    this._deletedEntryRecords = []; // Array of { id, deletedAt }
    this.deletedEntryIds = new Set();
    this.equipmentProfile = { barbell: true, dumbbell: true, cable: true, machine: true, bodyweight: true };
    this.reasonTagCounts = {}; // { [canonicalExerciseId]: number } — tracks how many times reason tag shown
    this.accessoryOverrides = {};   // { [exerciseId]: { sets?, repRange?, pctOfTM? } }
    this.customAccessories = [];    // [{ id, name, mainLift, weakPoints, pctOfTM, sets, repRange, equipment, category }]
    this.disabledAccessories = [];  // [exerciseId, ...]
    // Persistent per-lift milestone tracking tied to goals.
    // Shape: { squat: { goal, startE1RM, createdAt, milestones: [{ target, label, achievedAt, achievedEntryId }] } | null, ... }
    this.goalMilestones = { squat: null, bench: null, deadlift: null };

    // -----------------------------------------------------------------------
    // Ephemeral UI state — NOT persisted via the STORES registry.
    // Some values are seeded from individual localStorage keys on init().
    // -----------------------------------------------------------------------
    this._sessionOptimizer = null; // Ephemeral coaching state — not persisted
    this._deferredLoaded = false;  // Flips true once DEFERRED_STORES finish loading
    this.currentLift = 'squat';
    this.currentTab = 'log';
    this.currentRPE = null;
    this.chartFilter = 'all';
    this.chartType = 'e1rm';
    this.chartDateRange = 'all';
    this.chartOffset = 0;              // pan offset in days (volume histogram only)
    this.heatmapMetric = 'volume';
    this.historyFilter = 'all';
    this.historyFrom = '';
    this.historyTo = '';
    this.historySearch = '';
    this.historySort = 'newest';
    this.historyPage = 1;
    this.showDateFilters = false;
    this.notesVisible = false;
    this.editingEntryId = null;
    this.editingAccId = null;
    this.clearConfirm = false;
    this.lastLoggedSet = null;
    this.timerDuration = 180;
    this.timerRemaining = 0;
    this.timerInterval = null;
    this.timerRunning = false;
    this.timerStartTime = null;
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
    this.leaderboardData = [];
    this.leaderboardFilter = 'total';     // legacy — Strength tab sort field
    this.leaderboardTab = 'strength';      // 'strength' | 'streaks' | 'improved' | 'hall'
    this.leaderboardCrewId = null;         // null = global, else crew id for scoped view
    this.leaderboardWeightClass = null;    // null = all, else IPF class string (e.g. '83')
    this.leaderboardActiveOnly = false;    // true = filter to lifters active in last 7d
    this.leaderboardImprovedRange = 30;    // 30 or 90 days
    this.userCrews = [];                   // [{ id, name, inviteCode, ownerUid, memberUids }]

    // Unit / accent — persisted individually (not via STORES)
    this.unit = 'lbs';
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
          liftWeeks: { squat: 1, bench: 1, deadlift: 1 },
          completedSets: {},
          amrapResults: {},
          tmHistory: [],
          autoProgressEnabled: true,
          completedWeeks: {},
          weekStreak: 0,
          progressedCycles: {},
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
      recoveryCalibration: {
        key: RECOVERY_CALIBRATION_KEY,
        get: () => this.recoveryCalibration,
        set: (v) => { this.recoveryCalibration = v; },
        default: null,
        nullable: true,
      },
      deletedEntryIds: {
        key: DELETED_IDS_KEY,
        get: () => this._deletedEntryRecords,
        set: (v) => {
          this._deletedEntryRecords = v || [];
          this.deletedEntryIds = new Set(this._deletedEntryRecords.map(r => r.id));
        },
        default: [],
      },
      leaderboard: {
        key: LEADERBOARD_KEY,
        get: () => this.leaderboardOptedIn,
        set: (v) => { this.leaderboardOptedIn = v; },
        default: true,
      },
      equipmentProfile: {
        key: EQUIPMENT_PROFILE_KEY,
        get: () => this.equipmentProfile,
        set: (v) => { this.equipmentProfile = v; },
        default: { barbell: true, dumbbell: true, cable: true, machine: true, bodyweight: true },
      },
      reasonTagCounts: {
        key: REASON_TAG_COUNTS_KEY,
        get: () => this.reasonTagCounts,
        set: (v) => { this.reasonTagCounts = v; },
        default: {},
      },
      accessoryOverrides: {
        key: ACCESSORY_OVERRIDES_KEY,
        get: () => this.accessoryOverrides,
        set: (v) => { this.accessoryOverrides = v; },
        default: {},
      },
      customAccessories: {
        key: CUSTOM_ACCESSORIES_KEY,
        get: () => this.customAccessories,
        set: (v) => { this.customAccessories = v; },
        default: [],
      },
      disabledAccessories: {
        key: DISABLED_ACCESSORIES_KEY,
        get: () => this.disabledAccessories,
        set: (v) => { this.disabledAccessories = v; },
        default: [],
      },
      goalMilestones: {
        key: GOAL_MILESTONES_KEY,
        get: () => this.goalMilestones,
        set: (v) => { this.goalMilestones = v || { squat: null, bench: null, deadlift: null }; },
        default: { squat: null, bench: null, deadlift: null },
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
  /** Stores needed for first paint (dashboard, program section, log tab). */
  static ESSENTIAL_STORES = [
    'entries', 'profile', 'goals', 'prs', 'programs', 'workoutConfig', 'workoutSession', 'mesocycle',
    'cycles', 'deletedEntryIds', 'leaderboard', 'goalMilestones',
  ];
  /** Stores that can be loaded after first paint. */
  static DEFERRED_STORES = [
    'accessoryLog', 'customTemplates', 'mesocycleHistory', 'recoveryCalibration',
    'equipmentProfile', 'reasonTagCounts', 'accessoryOverrides', 'customAccessories',
    'disabledAccessories',
  ];

  init() {
    // 1. Load essential stores first (needed for first paint)
    Store.ESSENTIAL_STORES.forEach((name) => { if (this.STORES[name]) this._loadStore(name); });
    // Schedule deferred stores after first paint
    const _ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
    _ric(() => {
      Store.DEFERRED_STORES.forEach((name) => { if (this.STORES[name]) this._loadStore(name); });
      // Mark deferred stores as ready so views can opt into rendering content
      // that depends on them (e.g. fatigue body map).
      this._deferredLoaded = true;
      // Notify subscribers (e.g. dashboard) so they can re-render with the
      // newly-loaded data. Prevents the body map "stale guy" flash.
      if (typeof this.onDeferredLoad === 'function') {
        try { this.onDeferredLoad(); } catch { /* best-effort */ }
      }
    });

    // Ensure bodyweightHistory always exists
    if (!this.profile.bodyweightHistory) this.profile.bodyweightHistory = [];

    // Purge deleted entry records older than 30 days
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const before = this._deletedEntryRecords.length;
    this._deletedEntryRecords = this._deletedEntryRecords.filter(r => Date.now() - r.deletedAt < THIRTY_DAYS);
    this.deletedEntryIds = new Set(this._deletedEntryRecords.map(r => r.id));
    if (this._deletedEntryRecords.length !== before) this.save('deletedEntryIds');

    // Derive activeCycleId from cycles
    this.activeCycleId = (this.cycles.find((c) => c.active) || {}).id || null;

    // 2. Seed ephemeral values that have their own localStorage keys
    this.unit = localStorage.getItem(UNIT_KEY) || 'lbs';
    this.timerDuration = parseInt(localStorage.getItem(TIMER_KEY)) || 180;
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

    // 2b. Restore completedSets from backup if main store lost them
    this._restoreCompletedSetsIfLost();

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
   * Estimate current total localStorage usage in bytes.
   * @returns {number}
   */
  getStorageUsage() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      total += key.length + (localStorage.getItem(key) || '').length;
    }
    return total * 2; // JS strings are UTF-16 (2 bytes per char)
  }

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
    if (!s) return;
    const val = s.get();
    try {
      const json = JSON.stringify(val);
      if (val == null && s.nullable) localStorage.removeItem(s.key);
      else localStorage.setItem(s.key, json);
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
  saveGoalMilestones() { this.save('goalMilestones'); }
  savePRs()            { this.save('prs'); }
  saveCycles()         { this.save('cycles'); }
  saveProgramConfig()  { this.saveNow('programs'); this._backupCompletedSets(); }
  saveWorkoutConfig()  { this.save('workoutConfig'); }
  saveAccessoryLog()   { this.save('accessoryLog'); }
  saveWorkoutSession() { this.saveNow('workoutSession'); }
  saveCustomTemplates(){ this.save('customTemplates'); }
  saveMesocycle()      { this.save('mesocycle'); }
  saveMesocycleHistory() { this.save('mesocycleHistory'); }
  saveEquipmentProfile() { this.save('equipmentProfile'); }
  saveReasonTagCounts()    { this.save('reasonTagCounts'); }
  saveAccessoryOverrides() { this.save('accessoryOverrides'); }
  saveCustomAccessories()  { this.save('customAccessories'); }
  saveDisabledAccessories(){ this.save('disabledAccessories'); }

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

    if (!this._quotaWarned) {
      try {
        const usage = this.getStorageUsage();
        // Warn at 4MB (conservative for Safari's 5MB limit)
        if (usage > 4 * 1024 * 1024 && this.onStorageFull) {
          this._quotaWarned = true;
          this.onStorageFull('Storage nearly full — export your data to avoid data loss.');
        }
      } catch { /* best-effort */ }
    }

    names.forEach((name) => {
      const s = this.STORES[name];
      if (!s) return; // Guard against unknown store names
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
      if (e.updatedAt === undefined) e.updatedAt = e.timestamp;
    });
    // NOTE: rebuildPRs() must be called by the caller after init(),
    // since it depends on formula functions not imported here.
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION.toString());
    this.saveAll();
  }

  /** @private Ensure programConfig has all expected sub-fields. */
  _patchProgramConfig() {
    const pc = this.programConfig;
    if (!pc.trainingMaxes) pc.trainingMaxes = {};
    if (!pc.completedSets) pc.completedSets = {};
    if (!pc.amrapResults) pc.amrapResults = {};
    if (!pc.tmHistory) pc.tmHistory = [];
    if (pc.autoProgressEnabled === undefined) pc.autoProgressEnabled = true;
    if (!pc.completedWeeks) pc.completedWeeks = {};
    if (!pc.weekStreak) pc.weekStreak = 0;
    if (!pc.progressedCycles) pc.progressedCycles = {};
    if (!pc.failureCounts) pc.failureCounts = { squat: 0, bench: 0, deadlift: 0 };

    // Migrate from single currentWeek to per-lift liftWeeks
    if (pc.currentWeek !== undefined && !pc.liftWeeks) {
      const w = pc.currentWeek || 1;
      pc.liftWeeks = { squat: w, bench: w, deadlift: w };
      delete pc.currentWeek;
    }
    if (!pc.liftWeeks) pc.liftWeeks = { squat: 1, bench: 1, deadlift: 1 };
    if (!pc.liftWeeks.squat) pc.liftWeeks.squat = 1;
    if (!pc.liftWeeks.bench) pc.liftWeeks.bench = 1;
    if (!pc.liftWeeks.deadlift) pc.liftWeeks.deadlift = 1;

    // Migrate cycle-aware keys from reverted commits (92c9bd4, 5ee0388)
    // Format: "lift-c{cycle}-w{week}-{idx}" -> "lift-{week}-{idx}"
    const cycleKeyRe = /^(\w+)-c(\d+)-w(\d+)-(\d+)$/;
    [pc.completedSets, pc.amrapResults].forEach(obj => {
      Object.keys(obj).forEach(key => {
        const m = key.match(cycleKeyRe);
        if (m) {
          const newKey = `${m[1]}-${m[3]}-${m[4]}`;
          if (!obj[newKey]) obj[newKey] = obj[key];
          delete obj[key];
        }
      });
    });
    // Migrate completedWeeks: old formats (numeric "3" or cycle-aware "c1-w2")
    // can't be mapped to new per-lift format ("squat-3"). Clear stale keys.
    if (pc.completedWeeks) {
      const liftWeekRe = /^(squat|bench|deadlift)-\d+$/;
      const hasStaleKeys = Object.keys(pc.completedWeeks).some(k => !liftWeekRe.test(k));
      if (hasStaleKeys) {
        const fresh = {};
        Object.keys(pc.completedWeeks).forEach(k => {
          if (liftWeekRe.test(k)) fresh[k] = pc.completedWeeks[k];
        });
        pc.completedWeeks = fresh;
        pc.weekStreak = 0;
      }
    }
  }

  /** @private Write completedSets + trainingMaxes to a separate backup key. */
  _backupCompletedSets() {
    try {
      localStorage.setItem('sbd-completed-backup', JSON.stringify({
        completedSets: this.programConfig.completedSets,
        amrapResults: this.programConfig.amrapResults,
        completedWeeks: this.programConfig.completedWeeks,
        trainingMaxes: this.programConfig.trainingMaxes,
        ts: Date.now(),
      }));
    } catch (e) { /* quota exceeded — ignore */ }
  }

  /** @private Restore from backup only if main store data was lost (not intentionally changed). */
  _restoreCompletedSetsIfLost() {
    const current = this.programConfig.completedSets || {};
    const currentCount = Object.keys(current).length;
    try {
      const raw = localStorage.getItem('sbd-completed-backup');
      if (!raw) return;
      const backup = JSON.parse(raw);
      if (!backup || !backup.completedSets) return;

      // Only restore if the main store appears to have lost data (e.g., cleared to 0)
      // but the backup has data. Don't restore if the user intentionally unchecked sets.
      const backupCount = Object.keys(backup.completedSets).length;
      if (currentCount === 0 && backupCount > 0) {
        this.programConfig.completedSets = { ...backup.completedSets };
        if (backup.amrapResults) {
          this.programConfig.amrapResults = { ...backup.amrapResults };
        }
        if (backup.completedWeeks) {
          this.programConfig.completedWeeks = { ...backup.completedWeeks };
        }
        this.saveNow('programs');
      }

      // Restore training maxes if they were lost
      if (backup.trainingMaxes) {
        const currentTMs = this.programConfig.trainingMaxes || {};
        const hasTMs = Object.values(currentTMs).some(v => v > 0);
        const backupHasTMs = Object.values(backup.trainingMaxes).some(v => v > 0);
        if (!hasTMs && backupHasTMs) {
          this.programConfig.trainingMaxes = { ...backup.trainingMaxes };
          this.saveNow('programs');
        }
      }
    } catch (e) { /* corrupt backup — ignore */ }
  }

  /** @private Ensure workoutConfig has all expected sub-fields. */
  _patchWorkoutConfig() {
    if (!this.workoutConfig.weakPoints) {
      this.workoutConfig.weakPoints = { squat: null, bench: null, deadlift: null };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

const store = new Store();
export default store;
