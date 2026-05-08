/**
 * Hash-based URL router.
 *
 * Tabs use replaceState (back button skips tab switches).
 * Sheets/modals/overlays use pushState (back button closes them).
 * Uses popstate (not hashchange) — pushState/replaceState don't fire hashchange.
 */

const ROUTES = [
  { pattern: /^#(log|history|charts|stats|ranks)$/, handler: 'tab' },
  { pattern: /^#settings$/, handler: 'settings' },
  { pattern: /^#workout\/(.+)$/, handler: 'workout' },
  { pattern: /^#builder\/(.+)$/, handler: 'builder' },
  { pattern: /^#fatigue$/, handler: 'fatigueSheet' },
  { pattern: /^#lift\/(.+)$/, handler: 'liftDetail' },
];

let _handlers = {};
let _currentOverlay = null;
let _closeCurrentOverlay = null;
let _routerResolving = false;

/** Whether the router is currently resolving a route (boot, popstate, forward). */
export function isRouterResolving() { return _routerResolving; }

/**
 * Initialize the router. Call once after all DOM listeners are bound.
 * @param {Object} handlerMap - { tab, settings, workout, builder, fatigueSheet, liftDetail }
 */
export function initRouter(handlerMap) {
  _handlers = handlerMap;

  window.addEventListener('popstate', () => {
    const hash = location.hash || '#log';

    // If an overlay is open, a back-button press should close it.
    if (_currentOverlay && _closeCurrentOverlay) {
      const closeFn = _closeCurrentOverlay;
      _currentOverlay = null;
      _closeCurrentOverlay = null;
      closeFn();
      // Also resolve the tab route the hash landed on.
      if (/^#(log|history|charts|stats|ranks)$/.test(hash)) {
        _resolveRoute(hash);
      }
      return;
    }

    _resolveRoute(hash);
  });

  // Restore view from URL on boot (only for non-default hashes).
  const hash = location.hash;
  if (hash && hash !== '#log') {
    _resolveRoute(hash);
  } else {
    history.replaceState(null, '', '#log');
  }
}

function _resolveRoute(hash) {
  _routerResolving = true;
  try {
    for (const route of ROUTES) {
      const match = hash.match(route.pattern);
      if (match && _handlers[route.handler]) {
        _handlers[route.handler](match);
        return;
      }
    }
  } finally {
    _routerResolving = false;
  }
}

/**
 * Update the URL hash via replaceState (no history entry).
 * Use for tab switches and closing overlays.
 * @param {string} hash - e.g. '#log'
 */
export function updateRoute(hash) {
  if (location.hash === hash) return;
  history.replaceState(null, '', hash);
}

/**
 * Push a route for an overlay (modal/sheet/overlay).
 * Records the close function so back-button can close it.
 * Guard with `if (!isRouterResolving())` at each call site.
 *
 * @param {string} hash - e.g. '#lift/squat'
 * @param {string} overlayName - identifier for the overlay
 * @param {Function} closeFn - function to call when back-button fires
 */
export function pushRoute(hash, overlayName, closeFn) {
  _currentOverlay = overlayName;
  _closeCurrentOverlay = closeFn;
  history.pushState({ overlay: overlayName }, '', hash);
}

/**
 * Clear overlay routing state and restore the tab hash.
 * Call from manual close handlers (close button, backdrop) — NOT from back-button.
 * @param {string} tabHash - e.g. '#log'
 */
export function clearOverlayState(tabHash) {
  _currentOverlay = null;
  _closeCurrentOverlay = null;
  if (tabHash) updateRoute(tabHash);
}
