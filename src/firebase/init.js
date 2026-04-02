/**
 * Firebase SDK initialisation — lazy-loaded.
 *
 * The Firebase SDKs are NOT imported at module parse time. Instead,
 * they are dynamically imported inside initFirebase(), so the app
 * can boot and render without waiting for the Firebase CDN.
 *
 * All SDK symbols are exported as mutable `let` variables. They start
 * as null and are populated after initFirebase() resolves. ES module
 * live bindings ensure consumers see the updated values.
 */

// ===== Instance references (mutable singletons) =====
export let firebaseApp = null;
export let db = null;
export let auth = null;
export let authProvider = null;
export let firebaseReady = false;

// ===== SDK function references (populated lazily) =====
export let doc = null;
export let getDoc = null;
export let setDoc = null;
export let onSnapshot = null;
export let serverTimestamp = null;
export let collection = null;
export let getDocs = null;
export let query = null;
export let orderBy = null;
export let limit = null;
export let deleteDoc = null;
export let signInWithPopup = null;
export let signInWithRedirect = null;
export let getRedirectResult = null;
export let firebaseSignOut = null;
export let onAuthStateChanged = null;
export let GoogleAuthProvider = null;

/**
 * Initialise Firebase with the given config object.
 * Dynamically imports the Firebase SDK on first call.
 * Returns `true` on success, `false` on failure.
 * @param {object} config - Firebase project configuration
 * @returns {Promise<boolean>}
 */
export async function initFirebase(config) {
  if (!config || !config.apiKey) return false;
  try {
    // Lazy-load SDK modules from CDN (only on first init)
    if (!GoogleAuthProvider) {
      const [appMod, fsMod, authMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js'),
      ]);

      // Populate Firestore symbols
      doc = fsMod.doc;
      getDoc = fsMod.getDoc;
      setDoc = fsMod.setDoc;
      onSnapshot = fsMod.onSnapshot;
      serverTimestamp = fsMod.serverTimestamp;
      collection = fsMod.collection;
      getDocs = fsMod.getDocs;
      query = fsMod.query;
      orderBy = fsMod.orderBy;
      limit = fsMod.limit;
      deleteDoc = fsMod.deleteDoc;

      // Populate Auth symbols
      signInWithPopup = authMod.signInWithPopup;
      signInWithRedirect = authMod.signInWithRedirect;
      getRedirectResult = authMod.getRedirectResult;
      firebaseSignOut = authMod.signOut;
      onAuthStateChanged = authMod.onAuthStateChanged;
      GoogleAuthProvider = authMod.GoogleAuthProvider;

      // Init app
      firebaseApp = appMod.initializeApp(config);
      db = fsMod.getFirestore(firebaseApp);
      auth = authMod.getAuth(firebaseApp);
      authProvider = new GoogleAuthProvider();
    } else {
      // SDK already loaded, just re-init (e.g. config change)
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js');
      const { getFirestore } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js');
      const { getAuth } = await import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js');
      firebaseApp = initializeApp(config);
      db = getFirestore(firebaseApp);
      auth = getAuth(firebaseApp);
      authProvider = new GoogleAuthProvider();
    }

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
