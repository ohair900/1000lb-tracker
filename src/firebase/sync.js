/**
 * Cloud sync logic — push, pull, merge, and real-time listener.
 *
 * All Firestore read/write operations live here.  The merge function
 * uses a callback (`onSyncComplete`) instead of importing UI updaters
 * directly, avoiding circular dependencies.
 */

import store from '../state/store.js';
import { generateId } from '../utils/helpers.js';

import {
  db,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  deleteDoc,
  writeBatch,
  updateDoc,
} from './init.js';

import { currentUser } from './auth.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { getClassification, getOverallClassification } from '../formulas/standards.js';
import { calcWilks, calcDOTS } from '../formulas/scoring.js';
import { LBS_PER_KG } from '../constants/formulas.js';
import { IPF_CLASSES } from '../constants/lift-config.js';
import { calcStreak } from '../systems/streak.js';
import { TOTAL_MILESTONES } from '../data/milestones.js';
import { MS_PER_DAY } from '../constants/time.js';

import {
  UNIT_KEY,
  TIMER_KEY,
  BADGES_KEY,
  DASH_WIDGETS_KEY,
  ACCENT_KEY,
  TOTAL_CELEBRATED_KEY,
} from '../constants/storage-keys.js';

// ===== Sync state (mutable, shared) =====
export const syncState = {
  isMergingFromCloud: false,
  syncDebounceTimer: null,
  unsubSnapshot: null,
  status: 'disconnected', // disconnected | syncing | synced | error
  lastPushHash: null,               // #5: skip push if unchanged
  lastLeaderboardScores: null,      // #2: skip leaderboard if scores unchanged
  lastLeaderboardFetch: 0,          // #3: cache leaderboard reads
  cachedLeaderboard: [],            // #3: cached data
  isMergeOriginated: false,         // #6: prevent merge → resync loop
  // Release 2: subcollection migration
  isMigrating: false,               // blocks all pushes during migration
  migrationState: 'idle',           // idle|pre_check|snapshot|writing|updating|verifying|done|error
  dirtyEntries: new Set(),          // entry IDs modified since last v2 push
  lastAccLogPushGen: 0,             // tracks store._accLogGen at last v2 push
};

const SYNC_DEBOUNCE_MS = 10000;     // #1: 10s debounce (was 1.5s)
const LEADERBOARD_CACHE_MS = 300000; // #3: 5-minute cache TTL
const SCHEMA_VERSION = 2;
const V2_MIGRATION_KEY = 'sbd-migration-v2-done';
const BATCH_LIMIT = 450;            // Firestore caps at 500; leave room for parent doc ops

// ===== Schema version guard =====
// Prevents this code from overwriting data written by a newer schema version.
// If the cloud doc has schemaVersion > SCHEMA_VERSION, all pushes and merges
// are blocked and the user is prompted to refresh.

let _schemaBlocked = false;
let _onSchemaBlocked = null;

export function setOnSchemaBlocked(cb) { _onSchemaBlocked = cb; }
export function isSchemaBlocked() { return _schemaBlocked; }

function checkAndBlockIfNewerSchema(cloudData) {
  if (!cloudData) return false;
  const cloudVersion = cloudData.schemaVersion || 1;
  if (cloudVersion > SCHEMA_VERSION) {
    _schemaBlocked = true;
    _onSchemaBlocked?.(cloudVersion);
    return true;
  }
  return false;
}

// ===== Migration rules callback =====
// Fired when the pre-migration rules-access check fails, so the UI
// can prompt the user to update their Firestore security rules.
let _onMigrationNeedsRules = null;
export function setOnMigrationNeedsRules(cb) { _onMigrationNeedsRules = cb; }

// Returns true if local has completed the v2 subcollection migration.
function _isV2() {
  try { return localStorage.getItem(V2_MIGRATION_KEY) != null; }
  catch { return false; }
}

// ===== Callbacks (set by UI layer to avoid circular deps) =====

/**
 * Called after `mergeCloudData` finishes so the UI can refresh
 * (updateDashboard, renderHistory, etc.).
 * @type {Function|null}
 */
let onSyncComplete = null;

/**
 * Register the post-merge UI refresh callback.
 * @param {Function} cb - `() => void`
 */
export function setOnSyncComplete(cb) {
  onSyncComplete = cb;
}

/**
 * Called whenever syncState.status changes so the UI can update the
 * sync button.  Set via the UI layer at boot.
 * @type {Function|null}
 */
let onSyncStatusChange = null;

/**
 * Register the sync-status-change callback.
 * @param {Function} cb - `(status) => void`
 */
export function setOnSyncStatusChange(cb) {
  onSyncStatusChange = cb;
}

function notifyStatusChange() {
  onSyncStatusChange?.(syncState.status);
}

// ===== getLocalData =====

/**
 * Gather all local state into a plain object suitable for writing
 * to the Firestore user document.
 * @returns {object}
 */
export function getLocalData() {
  return {
    entries: store.entries,
    profile: store.profile,
    goals: store.goals,
    prs: store.prs,
    cycles: store.cycles,
    programs: store.programConfig,
    unit: localStorage.getItem(UNIT_KEY) || 'lbs',
    timer: store.timerDuration,
    badges: store.unlockedBadges,
    dashboardWidgets: store.dashboardWidgets,
    accentColor: store.accentColor,
    celebratedTotals: JSON.parse(localStorage.getItem(TOTAL_CELEBRATED_KEY) || '{}'),
    workoutConfig: store.workoutConfig,
    accessoryLog: store.accessoryLog,
    customTemplates: store.customTemplates,
    activeMesocycle: store.activeMesocycle,
    mesocycleHistory: store.mesocycleHistory,
    leaderboardOptedIn: store.leaderboardOptedIn,
    deletedEntryIds: store._deletedEntryRecords,
    schemaVersion: SCHEMA_VERSION,
  };
}

// ===== Data hash for change detection (#5) =====

function computeDataHash(data) {
  // In v2, entries and accessoryLog live in subcollections and are tracked
  // separately via generation counters. Exclude them from the parent-doc hash
  // so entry-only changes don't invalidate the parent-doc push skip.
  if (_isV2()) {
    const { entries, accessoryLog, ...parentFields } = data;
    return JSON.stringify(parentFields);
  }
  return JSON.stringify(data);
}

// ===== pushToCloud =====

/**
 * Write all local data to the current user's Firestore document.
 */
export async function pushToCloud() {
  if (!currentUser || !db || syncState.isMergingFromCloud || _schemaBlocked) return;
  if (syncState.isMigrating) return;

  // Route to v2 path if subcollection migration is complete
  if (_isV2()) return pushToCloudV2();

  try {
    const data = getLocalData();

    // #5: Skip push if data hasn't changed
    const hash = computeDataHash(data);
    if (hash === syncState.lastPushHash) return;

    syncState.status = 'syncing';
    notifyStatusChange();
    data.lastModified = serverTimestamp();
    await setDoc(doc(db, 'users', currentUser.uid), data);
    syncState.lastPushHash = hash;

    // #2: Only update leaderboard if scores changed
    if (store.leaderboardOptedIn !== false) {
      const s = bestE1RM('squat') || 0;
      const b = bestE1RM('bench') || 0;
      const d = bestE1RM('deadlift') || 0;
      const scoreKey = `${s}|${b}|${d}`;
      if (scoreKey !== syncState.lastLeaderboardScores) {
        syncState.lastLeaderboardScores = scoreKey;
        updateLeaderboard(s, b, d).catch(err => console.warn('Leaderboard update failed:', err));
      }
    }

    syncState.status = 'synced';
    notifyStatusChange();
  } catch (err) {
    console.error('Push to cloud failed:', err);
    syncState.status = 'error';
    notifyStatusChange();
  }
}

// ===== scheduleCloudSync =====

/**
 * Debounced cloud sync — waits `SYNC_DEBOUNCE_MS` after the last call
 * before actually pushing.  Safe to call on every local save.
 */
export function scheduleCloudSync() {
  if (!currentUser || !db || syncState.isMergingFromCloud || _schemaBlocked) return;
  if (syncState.isMigrating) return;
  // #6: Skip if this was triggered by a merge save
  if (syncState.isMergeOriginated) return;
  clearTimeout(syncState.syncDebounceTimer);
  syncState.syncDebounceTimer = setTimeout(() => {
    syncState.syncDebounceTimer = null;
    pushToCloud();
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Flush any pending debounced sync immediately.
 * Intended for the `visibilitychange` handler (tab hide / close).
 */
export function flushPendingSync() {
  if (_schemaBlocked || syncState.isMigrating) {
    clearTimeout(syncState.syncDebounceTimer);
    syncState.syncDebounceTimer = null;
    return;
  }
  if (syncState.syncDebounceTimer) {
    clearTimeout(syncState.syncDebounceTimer);
    syncState.syncDebounceTimer = null;
    pushToCloud();
  }
}

// ===== mergeCloudData =====

/**
 * Merge a Firestore user document into local state.
 *
 * Strategy per field:
 *   - entries: union by ID, newer timestamp wins for edits
 *   - profile: cloud wins; bodyweight history merged by timestamp
 *   - goals: cloud wins (last-write-wins)
 *   - cycles: merge by ID
 *   - programs: cloud wins (last-write-wins)
 *   - unit / timer: cloud wins
 *   - badges: union, keep earliest unlock date
 *   - dashboardWidgets / accentColor: cloud wins
 *   - celebratedTotals: union, keep earliest
 *   - workoutConfig: cloud wins
 *   - accessoryLog: union by ID
 *   - customTemplates: union by ID, latest wins
 *   - activeMesocycle: last-write-wins (newer createdAt)
 *   - mesocycleHistory: union by ID
 *
 * After merging, calls `onSyncComplete?.()` so the UI can refresh.
 *
 * @param {object} cloudData - The Firestore document data
 */
export function mergeCloudData(cloudData) {
  if (!cloudData) return;
  if (checkAndBlockIfNewerSchema(cloudData)) return;
  syncState.isMergingFromCloud = true;
  // #6: Flag to prevent merge saves from triggering another cloud push
  syncState.isMergeOriginated = true;
  try {
    // Merge entries: union by ID, newer updatedAt/timestamp wins for edits
    if (cloudData.entries && Array.isArray(cloudData.entries)) {
      const localMap = new Map(store.entries.map(e => [e.id, e]));
      const localDeletedIds = store.deletedEntryIds;
      cloudData.entries.forEach(ce => {
        if (localDeletedIds.has(ce.id)) return; // locally deleted
        const local = localMap.get(ce.id);
        if (!local) {
          store.entries.push(ce);
        } else {
          const cloudTime = ce.updatedAt || ce.timestamp;
          const localTime = local.updatedAt || local.timestamp;
          if (cloudTime > localTime) {
            Object.assign(local, ce);
          }
        }
      });

      // Remove local entries deleted on cloud side
      if (cloudData.deletedEntryIds && Array.isArray(cloudData.deletedEntryIds)) {
        const cloudDeleted = new Set(cloudData.deletedEntryIds.map(r => r.id || r));
        store.entries = store.entries.filter(e => !cloudDeleted.has(e.id));
        // Merge cloud deletions into local set
        cloudData.deletedEntryIds.forEach(r => {
          const id = r.id || r;
          if (!store.deletedEntryIds.has(id)) {
            const rec = typeof r === 'object' ? r : { id: r, deletedAt: Date.now() };
            store._deletedEntryRecords.push(rec);
            store.deletedEntryIds.add(id);
          }
        });
        store.save('deletedEntryIds');
      }
    }

    // Merge profile: cloud wins, bodyweight history merged by timestamp
    if (cloudData.profile) {
      if (cloudData.profile.gender) store.profile.gender = cloudData.profile.gender;
      if (cloudData.profile.bodyweight) store.profile.bodyweight = cloudData.profile.bodyweight;
      if (cloudData.profile.bodyweightHistory && Array.isArray(cloudData.profile.bodyweightHistory)) {
        const localBWMap = new Map((store.profile.bodyweightHistory || []).map(b => [b.timestamp, b]));
        cloudData.profile.bodyweightHistory.forEach(cb => {
          if (!localBWMap.has(cb.timestamp)) {
            store.profile.bodyweightHistory.push(cb);
          }
        });
        store.profile.bodyweightHistory.sort((a, b) => a.timestamp - b.timestamp);
      }
    }

    // Goals: cloud wins (last-write-wins)
    if (cloudData.goals) store.goals = { ...store.goals, ...cloudData.goals };

    // Cycles: merge by ID
    if (cloudData.cycles && Array.isArray(cloudData.cycles)) {
      const localCycleMap = new Map(store.cycles.map(c => [c.id, c]));
      cloudData.cycles.forEach(cc => {
        if (!localCycleMap.has(cc.id)) {
          store.cycles.push(cc);
        } else {
          Object.assign(localCycleMap.get(cc.id), cc);
        }
      });
      store.activeCycleId = (store.cycles.find(c => c.active) || {}).id || null;
    }

    // Programs: cloud wins EXCEPT local-sensitive fields (union/local-wins merge)
    if (cloudData.programs) {
      const localCompleted = { ...store.programConfig.completedSets };
      const localCompletedSetData = { ...store.programConfig.completedSetData };
      const localAmrap = { ...store.programConfig.amrapResults };
      const localCompletedWeeks = { ...store.programConfig.completedWeeks };
      const localTMs = { ...store.programConfig.trainingMaxes };
      const localLiftWeeks = { ...store.programConfig.liftWeeks };
      store.programConfig = { ...store.programConfig, ...cloudData.programs };
      // Union merge — never lose a local completion
      store.programConfig.completedSets = { ...(store.programConfig.completedSets || {}), ...localCompleted };
      store.programConfig.completedSetData = { ...(store.programConfig.completedSetData || {}), ...localCompletedSetData };
      store.programConfig.amrapResults = { ...(store.programConfig.amrapResults || {}), ...localAmrap };
      store.programConfig.completedWeeks = { ...(store.programConfig.completedWeeks || {}), ...localCompletedWeeks };
      // Local wins for TMs and week numbers — prevents stale cloud from reverting progression
      store.programConfig.trainingMaxes = { ...(store.programConfig.trainingMaxes || {}), ...localTMs };
      store.programConfig.liftWeeks = { ...(store.programConfig.liftWeeks || {}), ...localLiftWeeks };
      store._patchProgramConfig();
      store.save('programs');
    }

    // Unit, timer: cloud wins
    if (cloudData.unit) {
      store.unit = cloudData.unit;
      localStorage.setItem(UNIT_KEY, store.unit);
    }
    if (cloudData.timer) {
      store.timerDuration = cloudData.timer;
      localStorage.setItem(TIMER_KEY, store.timerDuration.toString());
    }
    // Merge badges (union, keep earliest unlock date)
    if (cloudData.badges) {
      Object.entries(cloudData.badges).forEach(([id, data]) => {
        if (!store.unlockedBadges[id] || (data.timestamp && data.timestamp < (store.unlockedBadges[id].timestamp || Infinity))) {
          store.unlockedBadges[id] = data;
        }
      });
      localStorage.setItem(BADGES_KEY, JSON.stringify(store.unlockedBadges));
    }

    // Dashboard widgets, accent: cloud wins
    if (cloudData.dashboardWidgets) {
      store.dashboardWidgets = { ...store.dashboardWidgets, ...cloudData.dashboardWidgets };
      localStorage.setItem(DASH_WIDGETS_KEY, JSON.stringify(store.dashboardWidgets));
    }
    if (cloudData.accentColor) {
      store.accentColor = cloudData.accentColor;
      localStorage.setItem(ACCENT_KEY, store.accentColor);
    }

    // Merge celebrated totals (union, keep earliest)
    if (cloudData.celebratedTotals) {
      let localCelebrated = {};
      try { localCelebrated = JSON.parse(localStorage.getItem(TOTAL_CELEBRATED_KEY)) || {}; } catch {}
      Object.entries(cloudData.celebratedTotals).forEach(([ms, ts]) => {
        if (!localCelebrated[ms] || (ts && Number(ts) < Number(localCelebrated[ms]))) {
          localCelebrated[ms] = ts;
        }
      });
      localStorage.setItem(TOTAL_CELEBRATED_KEY, JSON.stringify(localCelebrated));
    }

    // Merge workout config (cloud wins)
    if (cloudData.workoutConfig) {
      store.workoutConfig = { ...store.workoutConfig, ...cloudData.workoutConfig };
      store.save('workoutConfig');
    }

    // Merge accessory log (union by ID)
    if (cloudData.accessoryLog && Array.isArray(cloudData.accessoryLog)) {
      const localAccMap = new Map(store.accessoryLog.map(a => [a.id, a]));
      cloudData.accessoryLog.forEach(ca => {
        if (!localAccMap.has(ca.id)) store.accessoryLog.push(ca);
      });
      store.save('accessoryLog');
    }

    // Merge custom templates (union by ID, latest wins)
    if (cloudData.customTemplates && Array.isArray(cloudData.customTemplates)) {
      const localTmplMap = new Map(store.customTemplates.map(t => [t.id, t]));
      cloudData.customTemplates.forEach(ct => {
        const local = localTmplMap.get(ct.id);
        if (!local) store.customTemplates.push(ct);
        else if (ct.lastUsed > (local.lastUsed || 0)) Object.assign(local, ct);
      });
      store.save('customTemplates');
    }

    // Merge mesocycle (last-write-wins)
    if (cloudData.activeMesocycle) {
      if (!store.activeMesocycle || (cloudData.activeMesocycle.createdAt > store.activeMesocycle.createdAt)) {
        store.activeMesocycle = cloudData.activeMesocycle;
        store.save('mesocycle');
      }
    }

    // Merge mesocycle history (union by ID)
    if (cloudData.mesocycleHistory && Array.isArray(cloudData.mesocycleHistory)) {
      const localMesoMap = new Map(store.mesocycleHistory.map(m => [m.id, m]));
      cloudData.mesocycleHistory.forEach(cm => {
        if (!localMesoMap.has(cm.id)) store.mesocycleHistory.push(cm);
      });
      store.save('mesocycleHistory');
    }

    // Merge leaderboard opt-in (cloud wins)
    if (cloudData.leaderboardOptedIn !== undefined) {
      store.leaderboardOptedIn = cloudData.leaderboardOptedIn;
      store.save('leaderboard');
    }

    // Clear stale undo state
    store.undoStack = null;

    // Save all merged data
    store.saveAll();

    // Notify UI to refresh
    onSyncComplete?.();
  } finally {
    syncState.isMergingFromCloud = false;
    // #6: Clear merge flag after microtask (so the batched save's afterFlush sees it)
    queueMicrotask(() => { syncState.isMergeOriginated = false; });
  }
}

// ===========================================================================
// Release 2: Subcollection migration (v1 → v2)
// ===========================================================================

/**
 * Write + delete a probe doc in the entries subcollection to verify the
 * user's Firestore security rules allow subcollection access.
 * @returns {Promise<boolean>}
 */
async function testSubcollectionAccess() {
  if (!currentUser || !db) return false;
  const probeRef = doc(db, 'users', currentUser.uid, 'entries', '__rules_test__');
  try {
    await setDoc(probeRef, { _test: true, ts: Date.now() });
    await deleteDoc(probeRef);
    return true;
  } catch (err) {
    if (err.code === 'permission-denied') return false;
    // Network or other error — don't block migration, it will surface its own error
    console.warn('[migrate] rules probe inconclusive:', err);
    return true;
  }
}

/**
 * Migrate entries and accessoryLog from the parent doc array into Firestore
 * subcollections. Idempotent: retrying after partial failure is safe because
 * entry.id is used as the subcollection doc ID.
 *
 * Commit point: the parent doc's schemaVersion bump to 2. If anything before
 * that fails, the parent stays at v1 and the migration retries on next boot.
 *
 * Backup arrays (entries, accessoryLog) remain in the parent doc until
 * Release 3 cleanup.
 *
 * @returns {Promise<boolean>} true on success
 */
async function migrateToV2() {
  if (!currentUser || !db) return false;
  if (syncState.isMigrating) return false;

  syncState.isMigrating = true;
  syncState.migrationState = 'pre_check';
  notifyStatusChange();

  try {
    // 1. PRE_CHECK — rules allow subcollection access?
    const hasAccess = await testSubcollectionAccess();
    if (!hasAccess) {
      syncState.migrationState = 'error';
      _onMigrationNeedsRules?.();
      return false;
    }

    // 2. SNAPSHOT — deep-copy local data at this instant
    syncState.migrationState = 'snapshot';
    const entriesSnapshot = JSON.parse(JSON.stringify(store.entries));
    const accLogSnapshot = JSON.parse(JSON.stringify(store.accessoryLog));

    // 3. WRITE SUBCOLLECTIONS — chunked batches
    syncState.migrationState = 'writing';
    for (let i = 0; i < entriesSnapshot.length; i += BATCH_LIMIT) {
      const chunk = entriesSnapshot.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      chunk.forEach(e => batch.set(doc(db, 'users', currentUser.uid, 'entries', e.id), e));
      await batch.commit();
    }
    for (let i = 0; i < accLogSnapshot.length; i += BATCH_LIMIT) {
      const chunk = accLogSnapshot.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      chunk.forEach(a => batch.set(doc(db, 'users', currentUser.uid, 'accLog', a.id), a));
      await batch.commit();
    }

    // 4. Capture anything added DURING migration (by diff against snapshot)
    const snapIds = new Set(entriesSnapshot.map(e => e.id));
    const newEntries = store.entries.filter(e => !snapIds.has(e.id));
    if (newEntries.length > 0) {
      const batch = writeBatch(db);
      newEntries.forEach(e => batch.set(doc(db, 'users', currentUser.uid, 'entries', e.id), e));
      await batch.commit();
    }
    const snapAccIds = new Set(accLogSnapshot.map(a => a.id));
    const newAccLog = store.accessoryLog.filter(a => !snapAccIds.has(a.id));
    if (newAccLog.length > 0) {
      const batch = writeBatch(db);
      newAccLog.forEach(a => batch.set(doc(db, 'users', currentUser.uid, 'accLog', a.id), a));
      await batch.commit();
    }

    // 5. UPDATE PARENT — commit point. Keep arrays as backup for rollback safety.
    syncState.migrationState = 'updating';
    const parentData = getLocalData();
    parentData.schemaVersion = 2;
    parentData.lastEntryModified = serverTimestamp();
    parentData.entryCount = store.entries.length;
    parentData.accLogCount = store.accessoryLog.length;
    parentData.migratedAt = serverTimestamp();
    parentData.lastModified = serverTimestamp();
    await setDoc(doc(db, 'users', currentUser.uid), parentData);

    // 6. VERIFY — spot-check first entry exists in subcollection
    syncState.migrationState = 'verifying';
    if (entriesSnapshot.length > 0) {
      const checkSnap = await getDoc(doc(db, 'users', currentUser.uid, 'entries', entriesSnapshot[0].id));
      if (!checkSnap.exists()) throw new Error('Verification failed: first entry missing in subcollection');
    }

    // 7. DONE
    syncState.migrationState = 'done';
    try { localStorage.setItem(V2_MIGRATION_KEY, Date.now().toString()); } catch { /* quota — migration is idempotent, will retry */ }
    syncState.dirtyEntries.clear();
    syncState.lastAccLogPushGen = store._accLogGen;
    syncState.lastPushHash = null; // Reset so next push computes v2 hash cleanly
    return true;
  } catch (err) {
    console.error('[migrate] failed:', err);
    syncState.migrationState = 'error';
    syncState.status = 'error';
    notifyStatusChange();
    return false;
  } finally {
    syncState.isMigrating = false;
  }
}

/**
 * V2 push: parent doc + incremental entry writes.
 * Only writes entries in syncState.dirtyEntries. AccLog pushes in full when
 * _accLogGen changes (changes are rare and accLog is small).
 */
async function pushToCloudV2() {
  if (!currentUser || !db || syncState.isMergingFromCloud || _schemaBlocked || syncState.isMigrating) return;

  try {
    syncState.status = 'syncing';
    notifyStatusChange();

    // 1. Parent doc (excluding entries/accLog is handled by computeDataHash)
    const data = getLocalData();
    data.schemaVersion = 2;
    data.entryCount = store.entries.length;
    data.accLogCount = store.accessoryLog.length;
    data.lastModified = serverTimestamp();
    const hash = computeDataHash(data);
    const parentChanged = hash !== syncState.lastPushHash;
    if (parentChanged) {
      await setDoc(doc(db, 'users', currentUser.uid), data);
      syncState.lastPushHash = hash;
    }

    // 2. Dirty entries → subcollection (also handles deletes)
    const dirtyIds = syncState.dirtyEntries;
    if (dirtyIds.size > 0) {
      const currentById = new Map(store.entries.map(e => [e.id, e]));
      const toWrite = [];
      const toDelete = [];
      for (const id of dirtyIds) {
        const e = currentById.get(id);
        if (e) toWrite.push(e);
        else toDelete.push(id);
      }
      for (let i = 0; i < toWrite.length; i += BATCH_LIMIT) {
        const chunk = toWrite.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        chunk.forEach(e => batch.set(doc(db, 'users', currentUser.uid, 'entries', e.id), e));
        await batch.commit();
      }
      for (let i = 0; i < toDelete.length; i += BATCH_LIMIT) {
        const chunk = toDelete.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        chunk.forEach(id => batch.delete(doc(db, 'users', currentUser.uid, 'entries', id)));
        await batch.commit();
      }
      // Update sentinel so other devices know to re-fetch
      await updateDoc(doc(db, 'users', currentUser.uid), {
        lastEntryModified: serverTimestamp(),
        entryCount: store.entries.length,
      });
      syncState.dirtyEntries.clear();
    }

    // 3. AccLog full-push on gen change (rare — only on workout completion)
    if (store._accLogGen !== syncState.lastAccLogPushGen) {
      for (let i = 0; i < store.accessoryLog.length; i += BATCH_LIMIT) {
        const chunk = store.accessoryLog.slice(i, i + BATCH_LIMIT);
        const batch = writeBatch(db);
        chunk.forEach(a => batch.set(doc(db, 'users', currentUser.uid, 'accLog', a.id), a));
        await batch.commit();
      }
      syncState.lastAccLogPushGen = store._accLogGen;
    }

    // 4. Leaderboard (unchanged from v1 path)
    if (store.leaderboardOptedIn !== false) {
      const s = bestE1RM('squat') || 0;
      const b = bestE1RM('bench') || 0;
      const d = bestE1RM('deadlift') || 0;
      const scoreKey = `${s}|${b}|${d}`;
      if (scoreKey !== syncState.lastLeaderboardScores) {
        syncState.lastLeaderboardScores = scoreKey;
        updateLeaderboard(s, b, d).catch(err => console.warn('Leaderboard update failed:', err));
      }
    }

    syncState.status = 'synced';
    notifyStatusChange();
  } catch (err) {
    console.error('Push to cloud (v2) failed:', err);
    syncState.status = 'error';
    notifyStatusChange();
  }
}

/**
 * Fetch entries subcollection and union-merge into store.entries.
 */
async function pullEntriesFromSubcollection() {
  if (!currentUser || !db) return;
  try {
    const entriesRef = collection(db, 'users', currentUser.uid, 'entries');
    const snap = await getDocs(entriesRef);
    const cloudEntries = [];
    snap.forEach(d => {
      const data = d.data();
      if (data && !data._test) cloudEntries.push(data);
    });

    const localMap = new Map(store.entries.map(e => [e.id, e]));
    const localDeleted = store.deletedEntryIds;
    cloudEntries.forEach(ce => {
      if (localDeleted.has(ce.id)) return;
      const local = localMap.get(ce.id);
      if (!local) {
        store.entries.push(ce);
      } else {
        const cloudTime = ce.updatedAt || ce.timestamp;
        const localTime = local.updatedAt || local.timestamp;
        if (cloudTime > localTime) Object.assign(local, ce);
      }
    });
    store.saveEntries();
  } catch (err) {
    console.error('[v2] pullEntriesFromSubcollection failed:', err);
  }
}

/**
 * Fetch accessoryLog subcollection and union-merge into store.accessoryLog.
 */
async function pullAccLogFromSubcollection() {
  if (!currentUser || !db) return;
  try {
    const ref = collection(db, 'users', currentUser.uid, 'accLog');
    const snap = await getDocs(ref);
    const cloud = [];
    snap.forEach(d => { const data = d.data(); if (data) cloud.push(data); });

    const localMap = new Map(store.accessoryLog.map(a => [a.id, a]));
    cloud.forEach(ca => {
      if (!localMap.has(ca.id)) store.accessoryLog.push(ca);
    });
    store.saveAccessoryLog();
  } catch (err) {
    console.error('[v2] pullAccLogFromSubcollection failed:', err);
  }
}

/**
 * V2 merge: same as mergeCloudData but skips the entries/accessoryLog array
 * blocks (those live in subcollections now). All other fields merge identically.
 */
function mergeCloudDataV2(cloudData) {
  if (!cloudData) return;
  if (checkAndBlockIfNewerSchema(cloudData)) return;

  syncState.isMergingFromCloud = true;
  syncState.isMergeOriginated = true;
  try {
    // Profile (same as v1)
    if (cloudData.profile) {
      if (cloudData.profile.gender) store.profile.gender = cloudData.profile.gender;
      if (cloudData.profile.bodyweight) store.profile.bodyweight = cloudData.profile.bodyweight;
      if (cloudData.profile.bodyweightHistory && Array.isArray(cloudData.profile.bodyweightHistory)) {
        const localBWMap = new Map((store.profile.bodyweightHistory || []).map(b => [b.timestamp, b]));
        cloudData.profile.bodyweightHistory.forEach(cb => {
          if (!localBWMap.has(cb.timestamp)) store.profile.bodyweightHistory.push(cb);
        });
        store.profile.bodyweightHistory.sort((a, b) => a.timestamp - b.timestamp);
      }
    }
    if (cloudData.goals) store.goals = { ...store.goals, ...cloudData.goals };
    if (cloudData.cycles && Array.isArray(cloudData.cycles)) {
      const localCycleMap = new Map(store.cycles.map(c => [c.id, c]));
      cloudData.cycles.forEach(cc => {
        if (!localCycleMap.has(cc.id)) store.cycles.push(cc);
        else Object.assign(localCycleMap.get(cc.id), cc);
      });
      store.activeCycleId = (store.cycles.find(c => c.active) || {}).id || null;
    }
    if (cloudData.programs) {
      const localCompleted = { ...store.programConfig.completedSets };
      const localAmrap = { ...store.programConfig.amrapResults };
      const localCompletedWeeks = { ...store.programConfig.completedWeeks };
      const localTMs = { ...store.programConfig.trainingMaxes };
      const localLiftWeeks = { ...store.programConfig.liftWeeks };
      store.programConfig = { ...store.programConfig, ...cloudData.programs };
      store.programConfig.completedSets = { ...(store.programConfig.completedSets || {}), ...localCompleted };
      store.programConfig.amrapResults = { ...(store.programConfig.amrapResults || {}), ...localAmrap };
      store.programConfig.completedWeeks = { ...(store.programConfig.completedWeeks || {}), ...localCompletedWeeks };
      store.programConfig.trainingMaxes = { ...(store.programConfig.trainingMaxes || {}), ...localTMs };
      store.programConfig.liftWeeks = { ...(store.programConfig.liftWeeks || {}), ...localLiftWeeks };
      store._patchProgramConfig();
      store.save('programs');
    }
    if (cloudData.unit) { store.unit = cloudData.unit; localStorage.setItem(UNIT_KEY, store.unit); }
    if (cloudData.timer) { store.timerDuration = cloudData.timer; localStorage.setItem(TIMER_KEY, store.timerDuration.toString()); }
    if (cloudData.badges) {
      Object.entries(cloudData.badges).forEach(([id, data]) => {
        if (!store.unlockedBadges[id] || (data.timestamp && data.timestamp < (store.unlockedBadges[id].timestamp || Infinity))) {
          store.unlockedBadges[id] = data;
        }
      });
      localStorage.setItem(BADGES_KEY, JSON.stringify(store.unlockedBadges));
    }
    if (cloudData.dashboardWidgets) {
      store.dashboardWidgets = { ...store.dashboardWidgets, ...cloudData.dashboardWidgets };
      localStorage.setItem(DASH_WIDGETS_KEY, JSON.stringify(store.dashboardWidgets));
    }
    if (cloudData.accentColor) { store.accentColor = cloudData.accentColor; localStorage.setItem(ACCENT_KEY, store.accentColor); }
    if (cloudData.celebratedTotals) {
      let localCelebrated = {};
      try { localCelebrated = JSON.parse(localStorage.getItem(TOTAL_CELEBRATED_KEY)) || {}; } catch {}
      Object.entries(cloudData.celebratedTotals).forEach(([ms, ts]) => {
        if (!localCelebrated[ms] || (ts && Number(ts) < Number(localCelebrated[ms]))) localCelebrated[ms] = ts;
      });
      localStorage.setItem(TOTAL_CELEBRATED_KEY, JSON.stringify(localCelebrated));
    }
    if (cloudData.workoutConfig) {
      store.workoutConfig = { ...store.workoutConfig, ...cloudData.workoutConfig };
      store.save('workoutConfig');
    }
    if (cloudData.customTemplates && Array.isArray(cloudData.customTemplates)) {
      const localTmplMap = new Map(store.customTemplates.map(t => [t.id, t]));
      cloudData.customTemplates.forEach(ct => {
        const local = localTmplMap.get(ct.id);
        if (!local) store.customTemplates.push(ct);
        else if (ct.lastUsed > (local.lastUsed || 0)) Object.assign(local, ct);
      });
      store.save('customTemplates');
    }
    if (cloudData.activeMesocycle) {
      if (!store.activeMesocycle || (cloudData.activeMesocycle.createdAt > store.activeMesocycle.createdAt)) {
        store.activeMesocycle = cloudData.activeMesocycle;
        store.save('mesocycle');
      }
    }
    if (cloudData.mesocycleHistory && Array.isArray(cloudData.mesocycleHistory)) {
      const localMesoMap = new Map(store.mesocycleHistory.map(m => [m.id, m]));
      cloudData.mesocycleHistory.forEach(cm => {
        if (!localMesoMap.has(cm.id)) store.mesocycleHistory.push(cm);
      });
      store.save('mesocycleHistory');
    }
    if (cloudData.leaderboardOptedIn !== undefined) {
      store.leaderboardOptedIn = cloudData.leaderboardOptedIn;
      store.save('leaderboard');
    }

    // Handle cross-device deletes (deletedEntryIds still in parent doc)
    if (cloudData.deletedEntryIds && Array.isArray(cloudData.deletedEntryIds)) {
      const cloudDeleted = new Set(cloudData.deletedEntryIds.map(r => r.id || r));
      store.entries = store.entries.filter(e => !cloudDeleted.has(e.id));
      cloudData.deletedEntryIds.forEach(r => {
        const id = r.id || r;
        if (!store.deletedEntryIds.has(id)) {
          const rec = typeof r === 'object' ? r : { id: r, deletedAt: Date.now() };
          store._deletedEntryRecords.push(rec);
          store.deletedEntryIds.add(id);
        }
      });
      store.save('deletedEntryIds');
    }

    store.undoStack = null;
    store.saveAll();
    onSyncComplete?.();
  } finally {
    syncState.isMergingFromCloud = false;
    queueMicrotask(() => { syncState.isMergeOriginated = false; });
  }
}

/**
 * V2 realtime sync: listen only to the parent doc. When lastEntryModified
 * changes, pull the subcollection. Avoids the quota-killing N-reads-per-attach
 * cost of subcollection listeners.
 */
function startRealtimeSyncV2() {
  if (!currentUser || !db) return;
  if (syncState.unsubSnapshot) {
    syncState.unsubSnapshot();
    syncState.unsubSnapshot = null;
  }
  let lastKnownEntryModified = null;
  const userDocRef = doc(db, 'users', currentUser.uid);
  syncState.unsubSnapshot = onSnapshot(userDocRef, async (snapshot) => {
    if (!snapshot.exists()) return;
    const cloudData = snapshot.data();
    if (checkAndBlockIfNewerSchema(cloudData)) { stopRealtimeSync(); return; }
    if (syncState.isMergingFromCloud || syncState.isMigrating) return;
    if (syncState.syncDebounceTimer) return;

    mergeCloudDataV2(cloudData);

    // If entries changed on another device, fetch them from subcollection
    const cloudEntryMod = cloudData.lastEntryModified?.toMillis?.() || cloudData.lastEntryModified || 0;
    if (lastKnownEntryModified !== null && cloudEntryMod > lastKnownEntryModified) {
      await pullEntriesFromSubcollection();
      await pullAccLogFromSubcollection();
    }
    lastKnownEntryModified = cloudEntryMod;

    syncState.status = 'synced';
    notifyStatusChange();
  }, (err) => {
    console.error('Snapshot listener error (v2):', err);
    syncState.status = 'error';
    notifyStatusChange();
  });
}

/**
 * Delete every document in a named subcollection (users/{uid}/{name}).
 * Firestore does not cascade deletes, so we must do this explicitly.
 */
async function deleteSubcollection(name) {
  if (!currentUser || !db) return;
  const colRef = collection(db, 'users', currentUser.uid, name);
  const snap = await getDocs(colRef);
  const refs = [];
  snap.forEach(d => refs.push(d.ref));
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const chunk = refs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    chunk.forEach(r => batch.delete(r));
    await batch.commit();
  }
}

// ===== startRealtimeSync =====

/**
 * Subscribe to real-time updates on the current user's Firestore
 * document via `onSnapshot`.
 */
export function startRealtimeSync() {
  if (!currentUser || !db) return;
  if (_isV2()) return startRealtimeSyncV2();
  if (syncState.unsubSnapshot) {
    syncState.unsubSnapshot();
    syncState.unsubSnapshot = null;
  }
  const userDocRef = doc(db, 'users', currentUser.uid);
  syncState.unsubSnapshot = onSnapshot(userDocRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const cloudData = snapshot.data();
    // Block if cloud has a newer schema than we understand
    if (checkAndBlockIfNewerSchema(cloudData)) { stopRealtimeSync(); return; }
    // Skip if this was triggered by our own write
    if (syncState.isMergingFromCloud) return;
    // Skip if we have pending local changes not yet pushed
    if (syncState.syncDebounceTimer) return;
    mergeCloudData(cloudData);
    syncState.status = 'synced';
    notifyStatusChange();
  }, (err) => {
    console.error('Snapshot listener error:', err);
    syncState.status = 'error';
    notifyStatusChange();
  });
}

/**
 * #4: Detach the real-time listener (call when app goes to background).
 */
export function stopRealtimeSync() {
  if (syncState.unsubSnapshot) {
    syncState.unsubSnapshot();
    syncState.unsubSnapshot = null;
  }
}

// ===== Leaderboard =====

/**
 * Write the current user's leaderboard summary to `/leaderboard/{uid}`.
 * Called from `pushToCloud()` only when scores have changed.
 */
async function updateLeaderboard(s, b, d) {
  if (!currentUser || !db) return;

  const total = (s && b && d) ? s + b + d : 0;

  // Don't publish if user has no lifts
  if (total === 0) return;

  // Build best 3 sets per lift (highest e1RM)
  const bestByLift = {};
  ['squat', 'bench', 'deadlift'].forEach(lift => {
    bestByLift[lift] = [...store.entries]
      .filter(e => e.lift === lift)
      .sort((a, b) => b.e1rm - a.e1rm)
      .slice(0, 3)
      .map(e => ({ weight: e.weight, reps: e.reps, e1rm: e.e1rm, date: e.date }));
  });

  // Pre-compute strength classifications
  const classifications = {
    squat: getClassification('squat', s),
    bench: getClassification('bench', b),
    deadlift: getClassification('deadlift', d),
    overall: getOverallClassification(),
  };

  // Bodyweight, gender, weight class
  const bodyweight = store.profile?.bodyweight || null;
  const gender = store.profile?.gender || null;
  const bwKg = bodyweight ? Math.round((bodyweight / LBS_PER_KG) * 10) / 10 : null;
  const totalKg = total / LBS_PER_KG;
  const weightClass = (bwKg && gender && IPF_CLASSES[gender])
    ? _resolveWeightClass(bwKg, IPF_CLASSES[gender])
    : null;

  // Wilks / DOTS — null if missing bodyweight/gender
  const wilks = (bwKg && gender) ? Math.round((calcWilks(totalKg, bwKg, gender) || 0) * 10) / 10 : null;
  const dots = (bwKg && gender) ? Math.round((calcDOTS(totalKg, bwKg, gender) || 0) * 10) / 10 : null;

  // Streaks
  const streak = calcStreak();
  const currentStreak = streak?.current || 0;
  const longestStreak = streak?.longest || 0;

  // Most-improved: total at 30 days ago (best e1RM per lift using only entries
  // logged on or before 30 days ago).
  const totalAt30dAgo = _bestTotalAtCutoff(Date.now() - 30 * MS_PER_DAY);

  // 7-day tonnage (for future weekly volume contests)
  const sevenDaysAgo = Date.now() - 7 * MS_PER_DAY;
  const volume7d = store.entries
    .filter(e => e.timestamp >= sevenDaysAgo)
    .reduce((sum, e) => sum + e.weight * e.reps, 0);

  // Hall of Fame: first time the user crossed each total milestone.
  // Build by sorting entries chronologically and tracking running PR per lift.
  const milestones = _computeTotalMilestones();

  // Last training timestamp (for "active in last 7d" filter)
  const lastTrainedAt = store.entries.length > 0
    ? Math.max(...store.entries.map(e => e.timestamp))
    : null;

  const leaderboardDoc = {
    displayName: currentUser.displayName?.split(' ')[0] || 'Lifter',
    squat: s,
    bench: b,
    deadlift: d,
    total,
    classifications,
    bestByLift,
    bodyweight,
    gender,
    weightClass,
    wilks,
    dots,
    currentStreak,
    longestStreak,
    totalAt30dAgo,
    volume7d,
    milestones,
    lastTrainedAt,
    lastUpdated: serverTimestamp(),
  };

  await setDoc(doc(db, 'leaderboard', currentUser.uid), leaderboardDoc);
}

// Resolve which IPF class bucket a bodyweight (kg) falls into.
function _resolveWeightClass(bwKg, classes) {
  const maxClass = classes[classes.length - 1];
  if (bwKg > maxClass) return maxClass + '+';
  for (const limit of classes) {
    if (bwKg <= limit) return String(limit);
  }
  return null;
}

// Best e1RM per lift counting only entries logged on or before cutoffMs.
// Returns the total of those bests, or 0 if no entries qualify.
function _bestTotalAtCutoff(cutoffMs) {
  const bestPer = { squat: 0, bench: 0, deadlift: 0 };
  for (const e of store.entries) {
    if (e.timestamp > cutoffMs) continue;
    if (bestPer[e.lift] === undefined) continue;
    if (e.e1rm > bestPer[e.lift]) bestPer[e.lift] = e.e1rm;
  }
  const t = bestPer.squat + bestPer.bench + bestPer.deadlift;
  return t > 0 ? Math.round(t) : 0;
}

// Walk entries chronologically, tracking running e1RM per lift, and emit
// the first date the running total crossed each TOTAL_MILESTONES threshold.
function _computeTotalMilestones() {
  const sorted = [...store.entries].sort((a, b) => a.timestamp - b.timestamp);
  const bestPer = { squat: 0, bench: 0, deadlift: 0 };
  const hit = new Set();
  const out = [];
  for (const e of sorted) {
    if (bestPer[e.lift] === undefined) continue;
    if (e.e1rm > bestPer[e.lift]) bestPer[e.lift] = e.e1rm;
    const running = bestPer.squat + bestPer.bench + bestPer.deadlift;
    for (const m of TOTAL_MILESTONES) {
      if (running >= m && !hit.has(m)) {
        hit.add(m);
        out.push({ total: m, achievedAt: e.date });
      }
    }
  }
  return out;
}

/**
 * Delete all cloud data for the current user (user doc + leaderboard).
 */
export async function clearCloudData() {
  if (!currentUser || !db) return;
  try {
    // Firestore does not cascade subcollection deletes — clear them first
    if (_isV2()) {
      try { await deleteSubcollection('entries'); } catch (e) { console.warn('[clear] entries subcollection:', e); }
      try { await deleteSubcollection('accLog'); } catch (e) { console.warn('[clear] accLog subcollection:', e); }
    }
    await deleteDoc(doc(db, 'users', currentUser.uid));
    await removeFromLeaderboard();
    syncState.lastPushHash = null;
    syncState.lastLeaderboardScores = null;
    try { localStorage.removeItem(V2_MIGRATION_KEY); } catch {}
  } catch (err) {
    console.warn('Failed to clear cloud data:', err);
  }
}

/**
 * Remove the current user's leaderboard document (opt-out).
 */
export async function removeFromLeaderboard() {
  if (!currentUser || !db) return;
  try {
    await deleteDoc(doc(db, 'leaderboard', currentUser.uid));
  } catch (err) {
    console.warn('Failed to remove leaderboard entry:', err);
  }
}

/**
 * Fetch the leaderboard collection, ordered by total descending.
 * #3: Returns cached data if fetched within the last 5 minutes.
 * @returns {Promise<Array>} Array of leaderboard entries with uid
 */
export async function fetchLeaderboard() {
  if (!db) return [];

  // #3: Return cached data if still fresh
  if (Date.now() - syncState.lastLeaderboardFetch < LEADERBOARD_CACHE_MS && syncState.cachedLeaderboard.length > 0) {
    return syncState.cachedLeaderboard;
  }

  try {
    const q = query(collection(db, 'leaderboard'), orderBy('total', 'desc'), limit(100));
    const snapshot = await getDocs(q);
    syncState.cachedLeaderboard = snapshot.docs.map(d => ({ uid: d.id, ...d.data() }));
    syncState.lastLeaderboardFetch = Date.now();
    return syncState.cachedLeaderboard;
  } catch (err) {
    console.error('Fetch leaderboard failed:', err);
    return syncState.cachedLeaderboard.length > 0 ? syncState.cachedLeaderboard : [];
  }
}

// ===== handleFirstSignIn =====

/**
 * Called once when the user first authenticates.  If no cloud document
 * exists, pushes all local data up.  If one does exist, merges it into
 * local state and then pushes the merged result back.
 */
export async function handleFirstSignIn() {
  if (!currentUser || !db) return;
  const userDocRef = doc(db, 'users', currentUser.uid);
  try {
    const snapshot = await getDoc(userDocRef);
    if (!snapshot.exists()) {
      // No cloud doc — push all local data up (v1 format initially; migration
      // will happen on next boot when cloud doc is read back)
      await pushToCloud();
      return;
    }

    const cloudData = snapshot.data();
    const cloudVersion = cloudData.schemaVersion || 1;

    // Safety: if cloud is newer than we understand (future v3+), block
    if (cloudVersion > SCHEMA_VERSION) {
      checkAndBlockIfNewerSchema(cloudData);
      return;
    }

    if (cloudVersion >= 2) {
      // Cloud is v2. Merge parent-doc fields, then pull subcollections.
      mergeCloudDataV2(cloudData);
      await pullEntriesFromSubcollection();
      await pullAccLogFromSubcollection();

      // Mark local as v2 if not already
      if (!_isV2()) {
        try { localStorage.setItem(V2_MIGRATION_KEY, Date.now().toString()); } catch {}
        syncState.dirtyEntries.clear();
        syncState.lastAccLogPushGen = store._accLogGen;
        syncState.lastPushHash = null;
      }

      // Push merged result back via v2 path
      await pushToCloudV2();
    } else {
      // Cloud is v1. Merge then attempt migration.
      mergeCloudData(cloudData);
      const migrated = await migrateToV2();
      if (!migrated) {
        // Migration failed (e.g. rules). Fall back to a v1 push so local
        // changes aren't lost.
        await pushToCloud();
      }
    }
  } catch (err) {
    console.error('First sign-in sync failed:', err);
    syncState.status = 'error';
    notifyStatusChange();
  }
}

// ===== Data integrity pre-checks =====

/**
 * Scan entries and accessoryLog for missing or duplicate IDs.
 * Fixes issues in place and saves. Run before migration to ensure
 * every record has a unique ID suitable for use as a Firestore doc ID.
 *
 * @returns {Array<{type: string, count: number, fixed: boolean}>}
 */
export function runDataIntegrityChecks() {
  const issues = [];

  // Entries: missing IDs
  const noId = store.entries.filter(e => !e.id);
  if (noId.length > 0) {
    noId.forEach(e => { e.id = generateId(); });
    store.saveEntries();
    issues.push({ type: 'entries-missing-id', count: noId.length, fixed: true });
  }

  // Entries: duplicate IDs
  const idCounts = {};
  store.entries.forEach(e => { idCounts[e.id] = (idCounts[e.id] || 0) + 1; });
  const dupes = Object.entries(idCounts).filter(([, c]) => c > 1);
  if (dupes.length > 0) {
    const seen = new Set();
    store.entries.forEach(e => {
      if (seen.has(e.id)) e.id = generateId();
      seen.add(e.id);
    });
    store.saveEntries();
    issues.push({ type: 'duplicate-entry-ids', count: dupes.length, fixed: true });
  }

  // AccessoryLog: missing IDs
  const noAccId = store.accessoryLog.filter(a => !a.id);
  if (noAccId.length > 0) {
    noAccId.forEach(a => { a.id = generateId(); });
    store.saveAccessoryLog();
    issues.push({ type: 'acclog-missing-id', count: noAccId.length, fixed: true });
  }

  // AccessoryLog: duplicate IDs
  const accIdCounts = {};
  store.accessoryLog.forEach(a => { accIdCounts[a.id] = (accIdCounts[a.id] || 0) + 1; });
  const accDupes = Object.entries(accIdCounts).filter(([, c]) => c > 1);
  if (accDupes.length > 0) {
    const seen = new Set();
    store.accessoryLog.forEach(a => {
      if (seen.has(a.id)) a.id = generateId();
      seen.add(a.id);
    });
    store.saveAccessoryLog();
    issues.push({ type: 'duplicate-acclog-ids', count: accDupes.length, fixed: true });
  }

  return issues;
}

// ===== Crews (invite-only groups) =====

// Cache crew docs to avoid refetching on every Ranks tab open.
let _crewCache = { ts: 0, byId: {} };
const CREW_CACHE_MS = 5 * 60 * 1000;

const CREW_LIMIT_PER_USER = 5;
const CREW_LIMIT_PER_CREW = 20;

function _genInviteCode() {
  // 8-char alphanumeric, no I/O/0/1 to avoid confusion
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/**
 * Create a new crew with the current user as owner + sole member.
 * @param {string} name
 * @returns {Promise<{ id: string, name: string, inviteCode: string }>}
 */
export async function createCrew(name) {
  if (!currentUser || !db) throw new Error('Not signed in');
  const userCrews = (store.userCrews || []);
  if (userCrews.length >= CREW_LIMIT_PER_USER) {
    throw new Error(`Max ${CREW_LIMIT_PER_USER} crews per user`);
  }

  const inviteCode = _genInviteCode();
  const crewId = `crew_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const crewDoc = {
    name: String(name).slice(0, 40).trim() || 'Crew',
    inviteCode,
    ownerUid: currentUser.uid,
    memberUids: [currentUser.uid],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'crews', crewId), crewDoc);

  // Update local user list
  store.userCrews = [...userCrews, { id: crewId, ...crewDoc, createdAt: Date.now(), updatedAt: Date.now() }];
  _crewCache.byId[crewId] = store.userCrews[store.userCrews.length - 1];
  return { id: crewId, name: crewDoc.name, inviteCode };
}

/**
 * Join a crew by invite code. Looks up the code in /crews and adds the
 * current user to memberUids if there's room.
 * @param {string} code
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function joinCrew(code) {
  if (!currentUser || !db) throw new Error('Not signed in');
  const cleanCode = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  if (cleanCode.length !== 8) throw new Error('Invalid invite code');

  const userCrews = (store.userCrews || []);
  if (userCrews.length >= CREW_LIMIT_PER_USER) {
    throw new Error(`Max ${CREW_LIMIT_PER_USER} crews per user`);
  }

  // Look up crew by inviteCode
  const q = query(collection(db, 'crews'));
  const snap = await getDocs(q);
  let match = null;
  snap.forEach(d => {
    const data = d.data();
    if (data.inviteCode === cleanCode) match = { id: d.id, ...data };
  });
  if (!match) throw new Error('Invite code not found');

  if (match.memberUids.includes(currentUser.uid)) {
    throw new Error('Already a member of this crew');
  }
  if (match.memberUids.length >= CREW_LIMIT_PER_CREW) {
    throw new Error(`Crew is full (max ${CREW_LIMIT_PER_CREW})`);
  }

  // Add user to crew
  const updated = {
    ...match,
    memberUids: [...match.memberUids, currentUser.uid],
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'crews', match.id), updated);

  store.userCrews = [...userCrews, { ...updated, updatedAt: Date.now() }];
  _crewCache.byId[match.id] = store.userCrews[store.userCrews.length - 1];
  return { id: match.id, name: match.name };
}

/**
 * Leave a crew. Removes the current user from memberUids. If the user was the
 * last member, deletes the crew doc entirely.
 */
export async function leaveCrew(crewId) {
  if (!currentUser || !db) throw new Error('Not signed in');
  const ref = doc(db, 'crews', crewId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Crew not found');
  const data = snap.data();
  const remaining = data.memberUids.filter(u => u !== currentUser.uid);
  if (remaining.length === 0) {
    await deleteDoc(ref);
  } else {
    // If owner left, hand ownership to the next remaining member
    const ownerUid = data.ownerUid === currentUser.uid ? remaining[0] : data.ownerUid;
    await setDoc(ref, { ...data, memberUids: remaining, ownerUid, updatedAt: serverTimestamp() });
  }
  store.userCrews = (store.userCrews || []).filter(c => c.id !== crewId);
  delete _crewCache.byId[crewId];
}

/**
 * Fetch all crews the current user is a member of. Uses 5-minute cache.
 * @returns {Promise<Array<{ id, name, inviteCode, ownerUid, memberUids }>>}
 */
export async function fetchUserCrews() {
  if (!currentUser || !db) return [];
  if (Date.now() - _crewCache.ts < CREW_CACHE_MS && Object.keys(_crewCache.byId).length > 0) {
    return Object.values(_crewCache.byId);
  }
  // Scan all crews and filter by membership. Acceptable for small N.
  // Could optimize later with a per-user crewIds index.
  const snap = await getDocs(query(collection(db, 'crews')));
  const mine = [];
  snap.forEach(d => {
    const data = d.data();
    if (data.memberUids && data.memberUids.includes(currentUser.uid)) {
      mine.push({ id: d.id, ...data });
    }
  });
  _crewCache.ts = Date.now();
  _crewCache.byId = Object.fromEntries(mine.map(c => [c.id, c]));
  store.userCrews = mine;
  return mine;
}
