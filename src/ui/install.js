/**
 * PWA install prompt management.
 *
 * Chromium fires `beforeinstallprompt` when the app is installable; the
 * default mini-infobar is suppressed so we can offer a deliberate "Install
 * App" affordance in Settings instead. The captured event is single-use, so
 * it is cleared after prompting or once the app reports itself installed.
 */

let _deferredPrompt = null;
let _onChange = null;

/**
 * Start listening for install-related events. Call once during boot.
 */
export function initInstallPrompt() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default mini-infobar; we surface our own button.
    e.preventDefault();
    _deferredPrompt = e;
    _onChange?.();
  });
  window.addEventListener('appinstalled', () => {
    _deferredPrompt = null;
    _onChange?.();
  });
}

/** Whether an install prompt is currently available to show. */
export function canInstall() {
  return !!_deferredPrompt;
}

/**
 * Register a callback fired whenever install availability changes, so an open
 * Settings view can show/hide its button.
 * @param {Function|null} fn
 */
export function setInstallChangeHandler(fn) {
  _onChange = fn;
}

/**
 * Show the native install prompt.
 * @returns {Promise<boolean>} true if the user accepted the install
 */
export async function promptInstall() {
  if (!_deferredPrompt) return false;
  _deferredPrompt.prompt();
  let outcome = 'dismissed';
  try {
    ({ outcome } = await _deferredPrompt.userChoice);
  } catch {
    /* userChoice rejected — treat as dismissed */
  }
  _deferredPrompt = null;
  _onChange?.();
  return outcome === 'accepted';
}
