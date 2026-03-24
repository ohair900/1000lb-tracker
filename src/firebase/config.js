/**
 * Firebase configuration management.
 *
 * Owns the default (hardcoded) Firebase config and the helpers that
 * persist / retrieve a user-supplied config from localStorage.
 */

import { FIREBASE_CONFIG_KEY } from '../constants/storage-keys.js';

// Firebase config — API key is restricted to ohair900.github.io via HTTP referrer policy
// Security enforced by Firestore rules (authenticated users can only access their own data)
export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDpVCUuXRI_nM_ZpvqX-duP6nizFazGjx4",
  authDomain: "lb-club-tracker.firebaseapp.com",
  projectId: "lb-club-tracker",
  storageBucket: "lb-club-tracker.firebasestorage.app",
  messagingSenderId: "702922778039",
  appId: "1:702922778039:web:86d265866c9b10763e7432"
};

export function loadFirebaseConfig() {
  try {
    const stored = localStorage.getItem(FIREBASE_CONFIG_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return null;
}

export function saveFirebaseConfig(config) {
  localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(config));
}

export function clearFirebaseConfig() {
  localStorage.removeItem(FIREBASE_CONFIG_KEY);
}
