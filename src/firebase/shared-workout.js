/**
 * Shared workouts — real-time lobby where a host's session structure
 * is mirrored to all joined partners, scaled to each partner's own TMs.
 *
 * Firestore collection: sharedWorkouts/{shareCode}
 * Host writes session structure; partners subscribe read-only.
 */

import { db, doc, setDoc, getDoc, onSnapshot, serverTimestamp, updateDoc } from './init.js';
import { currentUser } from './auth.js';
import { EXERCISE_CATALOG } from '../data/exercise-catalog.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _unsub = null;
let _pushTimer = null;

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
      .filter((a) => !a._localOnly)
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

  // Generate a unique code (retry up to 5 times on collision)
  let code;
  for (let i = 0; i < 5; i++) {
    code = _genShareCode();
    const existing = await getDoc(doc(db, 'sharedWorkouts', code));
    if (!existing.exists()) break;
  }

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

  await setDoc(doc(db, 'sharedWorkouts', code), sharedDoc);
  return code;
}

// ---------------------------------------------------------------------------
// Join (partner)
// ---------------------------------------------------------------------------

/**
 * Join an existing shared workout by code.
 * Adds self to memberUids and members map, returns the doc data.
 * @param {string} rawCode
 * @returns {Promise<{ code, hostUid, hostName, mainLift, session }>}
 */
export async function joinSharedWorkout(rawCode) {
  if (!currentUser || !db) throw new Error('Sign in to join a shared workout');

  const code = String(rawCode)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
  if (code.length !== 6) throw new Error('Code must be 6 characters');

  const ref = doc(db, 'sharedWorkouts', code);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Workout not found — check the code and try again');
  const data = snap.data();
  if (data.status !== 'active') throw new Error('This workout has already finished');

  const memberName = currentUser.displayName?.split(' ')[0] || 'You';
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
  };

  // Add to memberUids if not already present
  if (!data.memberUids?.includes(currentUser.uid)) {
    memberUpdate.memberUids = [...(data.memberUids || []), currentUser.uid];
  }

  await updateDoc(ref, memberUpdate);

  return {
    code,
    hostUid: data.hostUid,
    hostName: data.hostName,
    mainLift: data.mainLift,
    session: data.session,
  };
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
  _unsub = onSnapshot(doc(db, 'sharedWorkouts', code), (snap) => {
    if (!snap.exists()) return;
    onUpdate(snap.data());
  });
}

/**
 * Tear down the shared workout listener.
 */
export function unsubscribeSharedWorkout() {
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
 * Safe to call on every mutation.
 * @param {object} session
 */
export function pushHostUpdate(session) {
  if (!currentUser || !db || !session?.shared?.code) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => {
    updateDoc(doc(db, 'sharedWorkouts', session.shared.code), {
      session: buildSharedPayload(session),
      updatedAt: serverTimestamp(),
    }).catch((err) => console.warn('[shared] pushHostUpdate failed:', err));
  }, 500);
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
  const expireAt = new Date(Date.now() + 24 * 3600 * 1000);
  updateDoc(doc(db, 'sharedWorkouts', code), {
    status: 'completed',
    completedAt: serverTimestamp(),
    expireAt,
  }).catch((err) => console.warn('[shared] completeSharedWorkout failed:', err));
}
