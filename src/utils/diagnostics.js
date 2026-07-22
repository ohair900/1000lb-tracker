/**
 * Lightweight, privacy-respecting error observability.
 *
 * The app is localStorage-first and mostly offline, so there is no server
 * to receive crash reports. Instead we keep a small in-memory ring buffer
 * of recent errors and expose:
 *
 *   - `installGlobalErrorHandlers()` — catch otherwise-silent `error` and
 *     `unhandledrejection` events so a thrown render or a rejected sync
 *     promise surfaces a reassuring toast instead of a frozen screen.
 *   - `recordError(context, err)` — record a handled failure (wired into
 *     `safeCall`) so the buffer captures near-misses too.
 *   - `getDiagnosticsText()` / `copyDiagnostics()` — a "Copy diagnostics"
 *     payload (app version, environment, storage footprint, recent errors)
 *     the user can paste into a bug report. No personal training data is
 *     included — only key names and byte sizes.
 */

import { CURRENT_VERSION } from '../constants/time.js';

const MAX_LOG = 30;
const TOAST_THROTTLE_MS = 8000;

/** @type {{ t: string, kind: string, message: string, detail?: string }[]} */
const _log = [];
let _toastFn = null;
let _lastToast = 0;

/**
 * Provide the toast function used to surface uncaught errors.
 * Wired from the boot layer once the toast UI is available.
 * @param {(msg: string) => void} fn
 */
export function setDiagnosticsToast(fn) {
  _toastFn = fn;
}

function push(kind, message, detail) {
  _log.push({
    t: new Date().toISOString(),
    kind,
    message: String(message ?? 'Unknown').slice(0, 500),
    detail: detail ? String(detail).slice(0, 1200) : undefined,
  });
  if (_log.length > MAX_LOG) _log.shift();
}

function notifyUser() {
  const now = Date.now();
  if (now - _lastToast < TOAST_THROTTLE_MS) return;
  _lastToast = now;
  _toastFn?.('Something went wrong — your data is safe. See Settings ▸ Copy Diagnostics.');
}

/**
 * Record a handled error (does not toast). Used by `safeCall`.
 * @param {string} context
 * @param {*} err
 */
export function recordError(context, err) {
  const message = err && err.message ? err.message : String(err);
  push('handled', `[${context}] ${message}`, err && err.stack);
}

/** Install window-level handlers for uncaught errors and promise rejections. */
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    // Ignore resource-load errors (img/script 404s) — they have no `error`.
    if (!e.error && !e.message) return;
    const msg = e.message || (e.error && e.error.message) || 'Unknown error';
    push('uncaught', msg, (e.error && e.error.stack) || `${e.filename}:${e.lineno}:${e.colno}`);
    notifyUser();
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    push('rejection', (reason && reason.message) || String(reason), reason && reason.stack);
    notifyUser();
  });
}

function localStorageFootprint() {
  let total = 0;
  const byKey = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const size = (k ? k.length : 0) + (localStorage.getItem(k) || '').length;
      total += size;
      byKey[k] = size;
    }
  } catch {
    /* access denied / disabled — ignore */
  }
  return { total, byKey };
}

/** Build the human-readable diagnostics report. */
export function getDiagnosticsText() {
  const fp = localStorageFootprint();
  const topKeys =
    Object.entries(fp.byKey)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, s]) => `  ${k}: ${(s / 1024).toFixed(1)} KB`)
      .join('\n') || '  (none)';

  const errs = _log.length
    ? _log
        .map((e) => {
          const firstLine = e.detail ? '\n    ' + e.detail.split('\n')[0] : '';
          return `  ${e.t} [${e.kind}] ${e.message}${firstLine}`;
        })
        .join('\n')
    : '  (none logged this session)';

  return [
    '1000lb Tracker — diagnostics',
    `Generated:   ${new Date().toISOString()}`,
    `Data version: ${CURRENT_VERSION}`,
    `User agent:  ${navigator.userAgent}`,
    `Viewport:    ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
    `Online:      ${navigator.onLine}`,
    `Standalone:  ${window.matchMedia?.('(display-mode: standalone)').matches || false}`,
    `Storage:     ${(fp.total / 1024).toFixed(1)} KB total`,
    'Largest keys:',
    topKeys,
    '',
    `Recent errors (${_log.length}):`,
    errs,
  ].join('\n');
}

/**
 * Copy the diagnostics report to the clipboard.
 * @returns {Promise<boolean>} true on success
 */
export async function copyDiagnostics() {
  const text = getDiagnosticsText();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
