/**
 * Shared workouts — real-time lobby where a host's session structure
 * is mirrored to all joined partners, scaled to each partner's own TMs.
 *
 * Firestore collection: sharedWorkouts/{shareCode}
 * Host writes session structure; partners subscribe read-only.
 */

import {
  db,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  arrayUnion,
} from './init.js';
import { currentUser } from './auth.js';
import { EXERCISE_CATALOG } from '../data/exercise-catalog.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _unsub = null;
let _pushTimer = null;
let _pendingSession = null;

// ---------------------------------------------------------------------------
// Share code format
// ---------------------------------------------------------------------------

/**
 * Standardized share-code format: exactly 6 alphanumeric characters.
 * Generated codes use a restricted alphabet (no 0/O/1/I to reduce read-aloud
 * confusion), but validation is lenient on input — strict on length only.
 */
export const SHARE_CODE_RE = /^[A-Za-z0-9]{6}$/;

/** sessionStorage key for a pending join code (survives reloads, not tabs). */
export const PENDING_JOIN_CODE_KEY = 'sharedWorkout.pendingJoinCode';

/**
 * Normalize a raw code: uppercase, strip non-alphanumerics.
 * @returns {string|null} the normalized 6-char code, or null if invalid.
 */
export function normalizeShareCode(raw) {
  if (raw == null) return null;
  const code = String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return SHARE_CODE_RE.test(code) ? code : null;
}

/**
 * Persist a pending join code to sessionStorage. The code is stored
 * IMMEDIATELY on link arrival and cleared ONLY on terminal resolution
 * (success, invalid/expired, or user dismissal) — a network failure or a
 * signed-out recipient keeps it so the link is never lost.
 * @returns {string|null} the normalized code that was stored.
 */
export function savePendingJoinCode(raw) {
  const code = normalizeShareCode(raw);
  if (!code) return null;
  try {
    window.sessionStorage.setItem(PENDING_JOIN_CODE_KEY, code);
  } catch (_) {
    /* storage unavailable — caller still has the in-memory code */
  }
  return code;
}

/** @returns {string|null} the pending join code, or null if none/invalid. */
export function readPendingJoinCode() {
  try {
    return normalizeShareCode(window.sessionStorage.getItem(PENDING_JOIN_CODE_KEY));
  } catch (_) {
    return null;
  }
}

/** Clear the pending join code after terminal resolution. */
export function clearPendingJoinCode() {
  try {
    window.sessionStorage.removeItem(PENDING_JOIN_CODE_KEY);
  } catch (_) {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Bounded async helpers
// ---------------------------------------------------------------------------

/** Typed error for the shared-workout join path. */
export class ShareJoinError extends Error {
  /**
   * @param {'invalid'|'finished'|'network'|'timeout'|'signed-out'} kind
   * @param {string} message - user-facing message
   */
  constructor(kind, message) {
    super(message);
    this.name = 'ShareJoinError';
    this.kind = kind;
  }
}

/**
 * Race a promise against a timeout. Every Firestore await in the join path
 * goes through this — no await-without-timeout, no unbounded retries.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [message]
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new ShareJoinError('timeout', message || 'Request timed out')),
      ms
    );
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => {
      if (timer) clearTimeout(timer);
    }),
    timeout,
  ]);
}

const JOIN_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Share code generator
// ---------------------------------------------------------------------------

// Omit 0/O/1/I to reduce read-aloud confusion
const _CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function _genShareCode() {
  return Array.from(
    { length: 6 },
    () => _CODE_CHARS[Math.floor(Math.random() * _CODE_CHARS.length)]
  ).join('');
}

// ---------------------------------------------------------------------------
// Payload builder — strips absolute weights for wire format
// ---------------------------------------------------------------------------

/**
 * Convert a local workoutSession into the Firestore payload.
 * Absolute weights are stripped; only pct + _hostWeight (fallback) are kept.
 * @param {object} session
 * @returns {object}
 */
export function buildSharedPayload(session) {
  return {
    mainSets: (session.mainSets || []).map((s) => ({
      num: s.num,
      pct: s.pct ?? null,
      reps: s.reps,
      tier: s.tier ?? null,
      day: s.day ?? null,
      completed: s.completed,
      _hostWeight: s.weight ?? 0,
    })),
    bbbSets: (session.bbbSets || []).map((s) => ({
      num: s.num,
      pct: s.pct ?? null,
      reps: s.reps,
      tier: s.tier ?? null,
      completed: s.completed,
      _hostWeight: s.weight ?? 0,
    })),
    accessories: (session.accessories || [])
      .filter((a) => !a._localOnly && !a._removed)
      .map((a) => ({
        exerciseId: a.exerciseId,
        name: a.name,
        targetSets: a.targetSets,
        repRange: a.repRange,
        equipment: a.equipment ?? null,
        pctOfTM: null,
        setsCompleted: [...(a.setsCompleted || [])],
        _hostWeights: [...(a.setWeights || [])],
        customDef:
          a.exerciseId.startsWith('custom-') || !EXERCISE_CATALOG[a.exerciseId]
            ? {
                id: a.exerciseId,
                name: a.name,
                equipment: a.equipment ?? null,
                repRange: a.repRange,
              }
            : null,
      })),
  };
}

// ---------------------------------------------------------------------------
// Create (host)
// ---------------------------------------------------------------------------

/**
 * Create a new shared workout doc in Firestore and return the share code.
 * @param {object} session - current workoutSession
 * @returns {Promise<string>} 6-char share code
 */
export async function createSharedWorkout(session) {
  if (!currentUser || !db) throw new Error('Sign in to share a workout');

  // Generate a unique code (retry up to 5 times on collision).
  // Every Firestore await races the join timeout so a stalled network can
  // never hang the host share flow (or strand the _shareInFlight guard).
  let code;
  let codeFound = false;
  for (let i = 0; i < 5; i++) {
    code = _genShareCode();
    let existing;
    try {
      existing = await withTimeout(
        getDoc(doc(db, 'sharedWorkouts', code)),
        JOIN_TIMEOUT_MS,
        'checking share code'
      );
    } catch (_err) {
      throw new ShareJoinError('network', 'Could not reach the server — check your connection and try again');
    }
    if (!existing.exists()) {
      codeFound = true;
      break;
    }
  }
  if (!codeFound) throw new Error('Could not generate a unique share code — please try again');

  const hostName = currentUser.displayName?.split(' ')[0] || 'Host';
  const sharedDoc = {
    shareCode: code,
    hostUid: currentUser.uid,
    hostName,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
    expireAt: null,
    memberUids: [currentUser.uid],
    members: {
      [currentUser.uid]: {
        name: hostName,
        role: 'host',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
        currentExerciseIdx: 0,
        currentSetIdx: 0,
      },
    },
    mainLift: session.mainLift,
    session: buildSharedPayload(session),
  };

  try {
    await withTimeout(
      setDoc(doc(db, 'sharedWorkouts', code), sharedDoc),
      JOIN_TIMEOUT_MS,
      'creating shared workout'
    );
  } catch (_err) {
    throw new ShareJoinError('network', 'Could not reach the server — check your connection and try again');
  }
  return code;
}

// ---------------------------------------------------------------------------
// Join (partner)
// ---------------------------------------------------------------------------

/**
 * Read-only fetch of a shared workout doc — no membership write, no local
 * data required. Used by the recipient preview sheet.
 * Bounded: the Firestore read races a 10s timeout.
 *
 * @param {string} rawCode
 * @returns {Promise<{ code, hostUid, hostName, mainLift, session, members }>}
 * @throws {ShareJoinError} kind: 'invalid' | 'finished' | 'network' | 'timeout' | 'signed-out'
 */
export async function fetchSharedWorkout(rawCode) {
  const code = normalizeShareCode(rawCode);
  if (!code) throw new ShareJoinError('invalid', 'This link is invalid or expired');
  if (!currentUser || !db)
    throw new ShareJoinError('signed-out', 'Sign in to join this shared workout');

  const ref = doc(db, 'sharedWorkouts', code);
  let snap;
  try {
    snap = await withTimeout(
      getDoc(ref),
      JOIN_TIMEOUT_MS,
      'Timed out loading the shared workout — check your connection and retry'
    );
  } catch (err) {
    if (err instanceof ShareJoinError) throw err;
    if (err?.code === 'permission-denied')
      throw new ShareJoinError('signed-out', 'Sign in to join this shared workout');
    throw new ShareJoinError(
      'network',
      'Couldn\u2019t load this workout — check your connection and try again'
    );
  }

  if (!snap.exists()) throw new ShareJoinError('invalid', 'This link is invalid or expired');
  const data = snap.data();
  if (data.status !== 'active')
    throw new ShareJoinError('finished', 'This workout has already finished');

  return {
    code,
    hostUid: data.hostUid,
    hostName: data.hostName || 'Host',
    mainLift: data.mainLift,
    session: data.session || {},
    members: data.members || {},
  };
}

/**
 * Join an existing shared workout by code.
 * Adds self to memberUids and members map, returns the doc data.
 * @param {string} rawCode
 * @returns {Promise<{ code, hostUid, hostName, mainLift, session }>}
 */
export async function joinSharedWorkout(rawCode) {
  // Read + validate first (bounded, typed errors); requires sign-in.
  const info = await fetchSharedWorkout(rawCode);

  const memberName = currentUser.displayName?.split(' ')[0] || 'You';
  const ref = doc(db, 'sharedWorkouts', info.code);
  const memberUpdate = {
    [`members.${currentUser.uid}`]: {
      name: memberName,
      role: 'partner',
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      currentExerciseIdx: 0,
      currentSetIdx: 0,
    },
    updatedAt: serverTimestamp(),
    // Use arrayUnion so concurrent joins don't race-overwrite each other's UID
    memberUids: arrayUnion(currentUser.uid),
  };

  try {
    await withTimeout(
      updateDoc(ref, memberUpdate),
      JOIN_TIMEOUT_MS,
      'Timed out joining the workout — check your connection and retry'
    );
  } catch (err) {
    if (err instanceof ShareJoinError) throw err;
    throw new ShareJoinError(
      'network',
      'Couldn\u2019t join — check your connection and try again'
    );
  }

  return info;
}

// ---------------------------------------------------------------------------
// Real-time subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to updates on a shared workout doc.
 * @param {string} code
 * @param {function} onUpdate - called with full doc data on each change
 */
export function subscribeSharedWorkout(code, onUpdate) {
  if (_unsub) {
    _unsub();
    _unsub = null;
  }
  if (!db || !code) return;
  _unsub = onSnapshot(
    doc(db, 'sharedWorkouts', code),
    (snap) => {
      if (!snap.exists()) {
        console.warn('[shared/partner] snapshot: doc missing', code);
        return;
      }
      const data = snap.data();
      console.log('[shared/partner] snapshot received', code, {
        updatedAt: data.updatedAt?.toMillis?.() ?? data.updatedAt,
        mainSets: data.session?.mainSets?.length,
        accessories: data.session?.accessories?.length,
      });
      onUpdate(data);
    },
    (err) => {
      // Subscription error (permissions, network, etc.) — log and re-subscribe
      // after a brief delay so transient failures self-heal.
      console.error('[shared] onSnapshot error — will retry in 3s:', err);
      _unsub = null;
      setTimeout(() => subscribeSharedWorkout(code, onUpdate), 3000);
    }
  );
}

/**
 * Tear down the shared workout listener.
 * Flushes any pending host write first so no final mutation is lost.
 */
export function unsubscribeSharedWorkout() {
  flushHostUpdate();
  if (_unsub) {
    _unsub();
    _unsub = null;
  }
}

// ---------------------------------------------------------------------------
// Host: push structural updates
// ---------------------------------------------------------------------------

/**
 * Debounced push of the host's session structure to Firestore (500ms).
 * Safe to call on every mutation. Stores a reference to the session so
 * flushHostUpdate() can fire the write synchronously before teardown.
 * @param {object} session
 */
export function pushHostUpdate(session) {
  const code = session?.shared?.code;
  if (!currentUser || !db || !code) {
    console.warn('[shared/host] pushHostUpdate skipped', {
      hasUser: !!currentUser,
      hasDb: !!db,
      code,
    });
    return;
  }
  _pendingSession = session;
  clearTimeout(_pushTimer);
  console.log('[shared/host] pushHostUpdate queued', code);
  _pushTimer = setTimeout(_flushPendingWrite, 500);
}

function _flushPendingWrite() {
  if (!_pendingSession) return;
  const session = _pendingSession;
  const code = session.shared.code;
  _pendingSession = null;
  _pushTimer = null;
  console.log('[shared/host] pushHostUpdate firing', code, {
    mainSets: session.mainSets?.length,
    bbbSets: session.bbbSets?.length,
    accessories: session.accessories?.length,
  });
  updateDoc(doc(db, 'sharedWorkouts', code), {
    session: buildSharedPayload(session),
    updatedAt: serverTimestamp(),
  })
    .then(() => console.log('[shared/fb] write OK', code))
    .catch((err) => {
      console.error('[shared/fb] write FAILED', code, err);
      showToast('Shared sync failed — check console');
    });
}

/**
 * Flush any debounced host write immediately.
 * Call before unsubscribing or completing to avoid losing the last mutation.
 */
export function flushHostUpdate() {
  if (!_pushTimer) return;
  clearTimeout(_pushTimer);
  _flushPendingWrite();
}

// ---------------------------------------------------------------------------
// Partner: push presence cursor
// ---------------------------------------------------------------------------

/**
 * Update this partner's cursor (which exercise/set they're on).
 * @param {string} code
 * @param {{ exerciseIdx: number, setIdx: number }} cursor
 */
export function pushMemberPresence(code, { exerciseIdx, setIdx }) {
  if (!currentUser || !db || !code) return;
  updateDoc(doc(db, 'sharedWorkouts', code), {
    [`members.${currentUser.uid}.currentExerciseIdx`]: exerciseIdx,
    [`members.${currentUser.uid}.currentSetIdx`]: setIdx,
    [`members.${currentUser.uid}.lastSeen`]: Date.now(),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Host: mark workout complete
// ---------------------------------------------------------------------------

/**
 * Mark the shared workout as completed and set the expiry timestamp (24h).
 * @param {string} code
 */
export function completeSharedWorkout(code) {
  if (!currentUser || !db || !code) return;
  flushHostUpdate();
  const expireAt = new Date(Date.now() + 24 * 3600 * 1000);
  updateDoc(doc(db, 'sharedWorkouts', code), {
    status: 'completed',
    completedAt: serverTimestamp(),
    expireAt,
  }).catch((err) => console.warn('[shared] completeSharedWorkout failed:', err));
}
