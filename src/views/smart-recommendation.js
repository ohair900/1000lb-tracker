/**
 * REMOVED during the tier-1 upgrade (Oct 2026).
 *
 * `openSmartRecommendation` (and `renderSmartAccCard`) had zero call sites
 * and this module was not imported anywhere in the app. The smart-workout
 * engine it wrapped — `suggestMainLift` / `suggestIntensity` from
 * src/systems/smart-workout.js and `selectSmartAccessories` /
 * `scoreAccessories` from src/systems/workout-builder.js — remains live
 * and is used directly by src/views/workout-overlay.js.
 *
 * Wiring this orphaned overlay into the UI was rejected: it renders into
 * the builder shell without pushing a router entry, while the real builder
 * flow (openBuilder) pushes `#builder/<lift>` — resurrecting it would have
 * introduced back-button inconsistency and untested UX. If a "Smart
 * Workout" entry point is wanted later, rebuild it on the live engine
 * rather than reviving this file.
 *
 * This file is intentionally left as a stub so the removal is explicit.
 * It is safe to delete the file entirely (no imports exist).
 */

export {};
