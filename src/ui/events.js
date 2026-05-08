/**
 * Synchronous event bus for fire-and-forget UI fan-out.
 * Errors in handlers are caught and logged so one bad subscriber
 * never breaks the emit chain.
 */

const _handlers = new Map();

/** Subscribe to an event. Returns an unsubscribe function. */
export function on(event, handler) {
  if (!_handlers.has(event)) _handlers.set(event, new Set());
  _handlers.get(event).add(handler);
  return () => off(event, handler);
}

/** Unsubscribe a handler. */
export function off(event, handler) {
  _handlers.get(event)?.delete(handler);
}

/** Fire an event synchronously. All handlers receive the same payload. */
export function emit(event, payload) {
  const handlers = _handlers.get(event);
  if (!handlers) return;
  for (const h of handlers) {
    try {
      h(payload);
    } catch (err) {
      console.error(`[events] handler error on "${event}":`, err);
    }
  }
}

/** Subscribe for one invocation only; auto-removes after firing. */
export function once(event, handler) {
  const wrapper = (payload) => {
    off(event, wrapper);
    handler(payload);
  };
  return on(event, wrapper);
}

/** Remove all handlers for an event, or all handlers if no event given. */
export function clear(event) {
  if (event === undefined) {
    _handlers.clear();
  } else {
    _handlers.delete(event);
  }
}
