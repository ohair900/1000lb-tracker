/**
 * Badge checking runtime — evaluates all badge definitions against
 * the current application state and returns any newly unlocked badges.
 *
 * The badge definitions themselves live in data/badges.js and accept
 * a context object.  This module builds that context from the store
 * and formula functions, then runs each check.
 */

import { BADGE_DEFINITIONS } from '../data/badges.js';
import { BADGES_KEY } from '../constants/storage-keys.js';
import store from '../state/store.js';
import { bestE1RM, getTotal } from '../formulas/e1rm.js';
import { calcStreak } from '../formulas/streak.js';
import { groupSessions } from './volume.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate every badge definition against the current state.
 * Badges that are already unlocked are skipped.
 *
 * Returns the list of newly unlocked badges (may be empty).
 * Also persists newly unlocked badges to `store.unlockedBadges`
 * and saves to localStorage.
 *
 * @returns {Object[]} Array of newly unlocked badge definitions
 *   (each has { id, name, desc, icon, category }).
 */
export function checkBadges() {
  // Build the context expected by BADGE_DEFINITIONS check functions
  const ctx = {
    entries: store.entries,
    bestE1RM,
    calcStreak,
    getTotal,
    groupSessions,
    profile: store.profile,
  };

  const newBadges = [];

  BADGE_DEFINITIONS.forEach(badge => {
    if (store.unlockedBadges[badge.id]) return;
    try {
      if (badge.check(ctx)) {
        store.unlockedBadges[badge.id] = {
          date: new Date().toISOString().split('T')[0],
          timestamp: Date.now()
        };
        newBadges.push(badge);
      }
    } catch {
      // Silently skip badges whose checks fail (e.g. missing data)
    }
  });

  if (newBadges.length > 0) {
    localStorage.setItem(BADGES_KEY, JSON.stringify(store.unlockedBadges));
  }

  return newBadges;
}
