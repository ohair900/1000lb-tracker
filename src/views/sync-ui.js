/**
 * Sync UI — sync button update, sync menu rendering, and
 * Firebase setup wizard.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { currentUser, signInWithGoogle, signOutUser, setCurrentUser } from '../firebase/auth.js';
import {
  initFirebase,
  auth,
  firebaseReady,
  firebaseSignOut,
  resetFirebaseInstances,
} from '../firebase/init.js';
import {
  saveFirebaseConfig,
  clearFirebaseConfig,
} from '../firebase/config.js';
import { syncState, pushToCloud } from '../firebase/sync.js';
import { setupAuthListener } from '../firebase/auth.js';
import { openModal, closeModal } from '../ui/modal.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Sync button
// ---------------------------------------------------------------------------

/**
 * Update the sync button appearance based on auth/sync status.
 */
export function updateSyncButton() {
  const btn = $('sync-btn');
  if (!btn) return;
  const user = currentUser;
  const status = syncState.status;
  btn.className = 'sync-btn' + (user ? (status === 'synced' ? ' synced' : status === 'syncing' ? ' syncing' : status === 'error' ? ' error' : '') : '');
  btn.title = user ? `Synced as ${user.displayName || user.email}` : 'Cloud sync (sign in)';
}

// ---------------------------------------------------------------------------
// Sync menu
// ---------------------------------------------------------------------------

/**
 * Render the sync dropdown menu content.
 */
export function renderSyncMenu() {
  const menu = $('sync-menu');
  if (!menu) return;
  const user = currentUser;
  if (user) {
    menu.innerHTML = `
      <div class="sync-menu-status">Signed in as<br><strong>${user.displayName || user.email}</strong></div>
      <button class="sync-menu-item" id="sync-now-btn">Sync now</button>
      <button class="sync-menu-item" id="sync-signout-btn">Sign out</button>
      <button class="sync-menu-item" id="sync-disconnect-btn" style="color:var(--danger)">Disconnect Firebase</button>`;
  } else if (firebaseReady) {
    menu.innerHTML = `
      <div class="sync-menu-status">Sign in to sync across devices</div>
      <button class="sync-menu-item" id="sync-signin-btn">Sign in with Google</button>`;
  } else {
    menu.innerHTML = `
      <div class="sync-menu-status">Set up cloud sync to save across devices</div>
      <button class="sync-menu-item" id="sync-setup-btn">Set up Firebase</button>`;
  }
}

// ---------------------------------------------------------------------------
// Firebase setup wizard
// ---------------------------------------------------------------------------

/**
 * Show the Firebase setup wizard modal for first-time configuration.
 */
export function showSetupWizard() {
  const body = $('edit-body');
  body.innerHTML = `
    <div style="font-size:0.85rem;color:var(--text-dim);line-height:1.6">
      <p style="margin-bottom:12px"><strong style="color:var(--text)">One-time setup</strong> \u2014 takes about 3 minutes:</p>
      <ol style="padding-left:20px;margin-bottom:16px">
        <li style="margin-bottom:8px">Go to <a href="https://console.firebase.google.com" target="_blank" rel="noopener" style="color:var(--bench)">console.firebase.google.com</a> \u2192 <strong>Create project</strong></li>
        <li style="margin-bottom:8px"><strong>Authentication</strong> \u2192 Sign-in method \u2192 Enable <strong>Google</strong></li>
        <li style="margin-bottom:8px">Auth \u2192 Settings \u2192 Authorized domains \u2192 Add <strong>ohair900.github.io</strong></li>
        <li style="margin-bottom:8px"><strong>Firestore Database</strong> \u2192 Create database (production mode)</li>
        <li style="margin-bottom:8px">Firestore \u2192 Rules \u2192 paste this and <strong>Publish</strong>:</li>
      </ol>
      <div style="background:var(--surface2);border-radius:8px;padding:10px 12px;font-family:monospace;font-size:0.7rem;margin-bottom:16px;white-space:pre;overflow-x:auto;color:var(--text)">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null
        && request.auth.uid == userId;
    }
    match /leaderboard/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
        && request.auth.uid == userId;
    }
  }
}</div>
      <ol start="6" style="padding-left:20px;margin-bottom:16px">
        <li style="margin-bottom:8px">Project Settings (gear icon) \u2192 Your apps \u2192 <strong>Add web app</strong> \u2192 Copy the <code style="background:var(--surface2);padding:1px 4px;border-radius:3px">firebaseConfig</code> object</li>
        <li>Paste it below:</li>
      </ol>
    </div>
    <textarea id="firebase-config-input" style="width:100%;height:140px;padding:10px;border:2px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font-family:monospace;font-size:0.75rem;resize:vertical;outline:none" placeholder='Paste the firebaseConfig here, e.g.:

{
  apiKey: "AIza...",
  authDomain: "my-app.firebaseapp.com",
  projectId: "my-app",
  ...
}'></textarea>
    <div id="config-error" style="color:var(--danger);font-size:0.75rem;margin-top:4px;display:none"></div>
    <button class="modal-save-btn" id="save-firebase-config">Connect</button>`;
  $('edit-modal').querySelector('h3').textContent = 'Cloud Sync Setup';
  openModal('edit-modal');

  $('save-firebase-config').addEventListener('click', async () => {
    const saveBtn = $('save-firebase-config');
    const raw = $('firebase-config-input').value.trim();
    const errEl = $('config-error');
    errEl.style.display = 'none';
    try {
      // Parse: handle both JSON and JS object literal formats
      let config;
      try {
        config = JSON.parse(raw);
      } catch {
        // Try wrapping bare JS object or extracting from assignment
        let cleaned = raw;
        cleaned = cleaned.replace(/^(const|let|var)\s+\w+\s*=\s*/, '');
        cleaned = cleaned.replace(/;\s*$/, '');
        cleaned = cleaned.replace(/(\w+)\s*:/g, '"$1":');
        cleaned = cleaned.replace(/""/g, '"');
        config = JSON.parse(cleaned);
      }
      if (!config.apiKey || !config.projectId) {
        throw new Error('Missing apiKey or projectId');
      }
      const required = ['apiKey', 'authDomain', 'projectId'];
      for (const key of required) {
        if (!config[key]) throw new Error('Missing field: ' + key);
      }
      // Save and initialize
      saveFirebaseConfig(config);
      saveBtn.disabled = true;
      saveBtn.textContent = 'Connecting...';
      const success = await initFirebase(config);
      if (success) {
        closeModal('edit-modal');
        showToast('Firebase connected!');
        updateSyncButton();
        setupAuthListener();
        // Auto-open sign-in
        setTimeout(() => {
          renderSyncMenu();
          $('sync-menu').classList.add('open');
        }, 500);
      } else {
        throw new Error('Firebase initialization failed. Check your config.');
      }
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Connect';
      errEl.textContent = err.message;
      errEl.style.display = '';
    }
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * Attach sync button, menu, and action listeners.
 * Call once after DOMContentLoaded.
 */
export function initSyncUI() {
  // Sync button click — toggle menu
  $('sync-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('sync-menu');
    renderSyncMenu();
    menu.classList.toggle('open');
  });

  // Close sync menu on outside click
  document.addEventListener('click', (e) => {
    const menu = $('sync-menu');
    if (menu && !e.target.closest('#sync-menu') && !e.target.closest('#sync-btn')) {
      menu.classList.remove('open');
    }
  });

  // Delegate sync menu actions
  document.addEventListener('click', (e) => {
    if (e.target.closest('#sync-setup-btn')) { $('sync-menu').classList.remove('open'); showSetupWizard(); return; }
    if (e.target.closest('#sync-signin-btn')) { signInWithGoogle(); $('sync-menu').classList.remove('open'); return; }
    if (e.target.closest('#sync-signout-btn')) { signOutUser(); $('sync-menu').classList.remove('open'); return; }
    if (e.target.closest('#sync-now-btn')) { pushToCloud(); $('sync-menu').classList.remove('open'); return; }
    if (e.target.closest('#sync-disconnect-btn')) {
      if (syncState.unsubSnapshot) { syncState.unsubSnapshot(); syncState.unsubSnapshot = null; }
      if (auth && currentUser) firebaseSignOut(auth).catch(() => {});
      setCurrentUser(null);
      resetFirebaseInstances();
      clearFirebaseConfig();
      syncState.status = 'disconnected';
      updateSyncButton();
      $('sync-menu').classList.remove('open');
      showToast('Firebase disconnected');
      return;
    }
  });
}
