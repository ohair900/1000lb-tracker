/**
 * Firebase authentication helpers.
 *
 * Wraps Google sign-in / sign-out and the `onAuthStateChanged` listener
 * so that the rest of the app can call simple named functions without
 * touching the Firebase SDK directly.
 */

import {
  auth,
  authProvider,
  firebaseReady,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  firebaseSignOut,
  onAuthStateChanged,
} from './init.js';

import { handleFirstSignIn, startRealtimeSync, syncState } from './sync.js';

// ===== Auth state =====
export let currentUser = null;

/**
 * Set currentUser from outside (used during disconnect flow).
 */
export function setCurrentUser(user) {
  currentUser = user;
}

// ===== Callbacks (set by UI layer to avoid circular deps) =====
let onAuthStatusChange = null;

/**
 * Register a callback that fires whenever the user's auth / sync
 * status changes.  The UI layer calls this once at boot with a
 * function that updates the sync button, etc.
 *
 * @param {Function} cb - `(user, syncStatus) => void`
 */
export function setOnAuthStatusChange(cb) {
  onAuthStatusChange = cb;
}

function notifyStatusChange() {
  onAuthStatusChange?.(currentUser, syncState.status);
}

// ===== Sign-in =====

export async function signInWithGoogle() {
  if (!firebaseReady || !auth) return;
  try {
    await signInWithPopup(auth, authProvider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
      try {
        await signInWithRedirect(auth, authProvider);
      } catch (e2) {
        console.error('Redirect sign-in failed:', e2);
        throw e2;
      }
    } else {
      console.error('Sign-in failed:', err);
      throw err;
    }
  }
}

// ===== Sign-out =====

export async function signOutUser() {
  if (!auth) return;
  try {
    if (syncState.unsubSnapshot) {
      syncState.unsubSnapshot();
      syncState.unsubSnapshot = null;
    }
    await firebaseSignOut(auth);
    currentUser = null;
    syncState.status = 'disconnected';
    notifyStatusChange();
  } catch (err) {
    console.error('Sign-out failed:', err);
  }
}

// ===== Auth state listener =====

/**
 * Wire up the `onAuthStateChanged` listener.  Should be called once
 * at boot (after `initFirebase` succeeds).
 */
export function setupAuthListener() {
  if (!firebaseReady || !auth) return;

  // Check for pending redirect result
  getRedirectResult(auth).catch(() => {});

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    if (user) {
      syncState.status = 'syncing';
      notifyStatusChange();
      await handleFirstSignIn();
      startRealtimeSync();
    } else {
      if (syncState.unsubSnapshot) {
        syncState.unsubSnapshot();
        syncState.unsubSnapshot = null;
      }
      syncState.status = 'disconnected';
      notifyStatusChange();
    }
  });
}
