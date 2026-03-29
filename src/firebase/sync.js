/**
 * Cloud sync logic — push, pull, merge, and real-time listener.
 *
 * All Firestore read/write operations live here.  The merge function
 * uses a callback (`onSyncComplete`) instead of importing UI updaters
 * directly, avoiding circular dependencies.
 */

import store from '../state/store.js';

import {
  db,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from './init.js';

import { currentUser } from './auth.js';

import {
  UNIT_KEY,
  TIMER_KEY,
  THEME_KEY,
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
};

const SYNC_DEBOUNCE_MS = 1500;
const SCHEMA_VERSION = 1;

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
    theme: store.theme,
    badges: store.unlockedBadges,
    dashboardWidgets: store.dashboardWidgets,
    accentColor: store.accentColor,
    celebratedTotals: JSON.parse(localStorage.getItem(TOTAL_CELEBRATED_KEY) || '{}'),
    workoutConfig: store.workoutConfig,
    accessoryLog: store.accessoryLog,
    customTemplates: store.customTemplates,
    activeMesocycle: store.activeMesocycle,
    mesocycleHistory: store.mesocycleHistory,
    schemaVersion: SCHEMA_VERSION,
  };
}

// ===== pushToCloud =====

/**
 * Write all local data to the current user's Firestore document.
 */
export async function pushToCloud() {
  if (!currentUser || !db || syncState.isMergingFromCloud) return;
  try {
    syncState.status = 'syncing';
    notifyStatusChange();
    const data = getLocalData();
    data.lastModified = serverTimestamp();
    await setDoc(doc(db, 'users', currentUser.uid), data);
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
  if (!currentUser || !db || syncState.isMergingFromCloud) return;
  clearTimeout(syncState.syncDebounceTimer);
  syncState.syncDebounceTimer = setTimeout(() => pushToCloud(), SYNC_DEBOUNCE_MS);
}

/**
 * Flush any pending debounced sync immediately.
 * Intended for the `visibilitychange` handler (tab hide / close).
 */
export function flushPendingSync() {
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
 *   - unit / timer / theme: cloud wins
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
  syncState.isMergingFromCloud = true;
  try {
    // Merge entries: union by ID, newer timestamp wins for edits
    if (cloudData.entries && Array.isArray(cloudData.entries)) {
      const localMap = new Map(store.entries.map(e => [e.id, e]));
      cloudData.entries.forEach(ce => {
        const local = localMap.get(ce.id);
        if (!local) {
          store.entries.push(ce);
        } else if (ce.timestamp > local.timestamp) {
          Object.assign(local, ce);
        }
      });
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

    // Programs: cloud wins (last-write-wins)
    if (cloudData.programs) {
      store.programConfig = { ...store.programConfig, ...cloudData.programs };
      store._patchProgramConfig();
      store.save('programs');
    }

    // Unit, timer, theme: cloud wins
    if (cloudData.unit) {
      store.unit = cloudData.unit;
      localStorage.setItem(UNIT_KEY, store.unit);
    }
    if (cloudData.timer) {
      store.timerDuration = cloudData.timer;
      localStorage.setItem(TIMER_KEY, store.timerDuration.toString());
    }
    if (cloudData.theme) {
      store.theme = cloudData.theme;
      localStorage.setItem(THEME_KEY, store.theme);
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

    // Clear stale undo state
    store.undoStack = null;

    // Save all merged data
    store.saveAll();

    // Notify UI to refresh
    onSyncComplete?.();
  } finally {
    syncState.isMergingFromCloud = false;
  }
}

// ===== startRealtimeSync =====

/**
 * Subscribe to real-time updates on the current user's Firestore
 * document via `onSnapshot`.
 */
export function startRealtimeSync() {
  if (!currentUser || !db) return;
  if (syncState.unsubSnapshot) {
    syncState.unsubSnapshot();
    syncState.unsubSnapshot = null;
  }
  const userDocRef = doc(db, 'users', currentUser.uid);
  syncState.unsubSnapshot = onSnapshot(userDocRef, (snapshot) => {
    if (!snapshot.exists()) return;
    const cloudData = snapshot.data();
    // Skip if this was triggered by our own write
    if (syncState.isMergingFromCloud) return;
    mergeCloudData(cloudData);
    syncState.status = 'synced';
    notifyStatusChange();
  }, (err) => {
    console.error('Snapshot listener error:', err);
    syncState.status = 'error';
    notifyStatusChange();
  });
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
      // No cloud doc — push all local data up
      await pushToCloud();
    } else {
      // Cloud doc exists — merge cloud into local, then push merged result back
      mergeCloudData(snapshot.data());
      await pushToCloud();
    }
  } catch (err) {
    console.error('First sign-in sync failed:', err);
    syncState.status = 'error';
    notifyStatusChange();
  }
}
