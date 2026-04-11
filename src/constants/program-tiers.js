/**
 * Program set-tier classification — used by the workout session builder and
 * the Session Optimizer to separate sacred main work from adjustable
 * supplemental volume.
 *
 * Program templates tag each set with a `tier` field:
 *   - T1      — main working sets (sacred, never modified by the coach)
 *   - T2      — supplemental volume (GZCL, nSuns back-offs, etc. — reducible)
 *   - BBB     — 5/3/1 Boring But Big supplemental (reducible)
 *   - T3/null — accessories (handled by the accessory system, not here)
 */

export const MAIN_TIERS = ['T1'];
export const SUPPLEMENTAL_TIERS = ['T2', 'BBB'];
