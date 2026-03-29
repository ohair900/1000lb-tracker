/**
 * Firebase SDK initialisation.
 *
 * Imports the Firebase SDKs from the Google CDN, exposes the
 * `initFirebase(config)` bootstrap function, and exports mutable
 * references to the Firebase app / Firestore / Auth instances so that
 * other modules can import them.
 */

// ===== Firebase SDK (CDN) =====
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  getFirestore,
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
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';

// ===== Instance references (mutable singletons) =====
export let firebaseApp = null;
export let db = null;
export let auth = null;
export let authProvider = null;
export let firebaseReady = false;

/**
 * Initialise Firebase with the given config object.
 * Returns `true` on success, `false` on failure.
 * @param {object} config - Firebase project configuration
 * @returns {boolean}
 */
export function initFirebase(config) {
  if (!config || !config.apiKey) return false;
  try {
    firebaseApp = initializeApp(config);
    db = getFirestore(firebaseApp);
    auth = getAuth(firebaseApp);
    authProvider = new GoogleAuthProvider();
    firebaseReady = true;
    return true;
  } catch (e) {
    console.warn('Firebase init failed:', e);
    return false;
  }
}

/**
 * Reset all Firebase instance references to null.
 * Called when the user disconnects Firebase.
 */
export function resetFirebaseInstances() {
  firebaseApp = null;
  db = null;
  auth = null;
  authProvider = null;
  firebaseReady = false;
}

// Re-export Firestore / Auth SDK symbols that other modules need
export {
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
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
};
