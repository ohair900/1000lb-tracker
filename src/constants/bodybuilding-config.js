// src/constants/bodybuilding-config.js — Bodybuilding split plan configuration
//
// Unlike the SBD program templates (per-lift, Training-Max %), a bodybuilding
// plan is a rotating muscle-group split. The default is Push / Pull / Legs.
//
// Each day is a fixed, ORDERED list of exercise slots so the same movements
// recur week to week — that stability is what lets double progression actually
// work (you can only add weight to a lift you keep repeating).
//
// A slot resolves to ONE exercise at session-build time:
//   - If `compLift` is set AND the barbell is available, the slot becomes the
//     competition lift (Bench/Squat/Deadlift). These log as real lift entries
//     so they count toward your SBD max, e1RM, and PRs.
//   - Otherwise the first `candidates` exercise whose equipment is enabled wins
//     (logged as a bodybuilding/accessory movement).
//
// Exercise ids reference EXERCISE_CATALOG (src/data/exercise-catalog.js).

/**
 * Clean, standardized hypertrophy set/rep schemes by slot role. Deliberately
 * tidy (no 4–6 / 20–40 mixing, no per-exercise catalog ranges) so prescriptions
 * feel predictable. A slot may override with its own `scheme`.
 */
export const BB_SCHEMES = {
  primary: { sets: 4, repRange: [6, 10] },
  compound: { sets: 4, repRange: [8, 12] },
  isolation: { sets: 3, repRange: [12, 15] },
};

export const BB_SCHEME_FALLBACK = { sets: 3, repRange: [8, 12] };

export const BODYBUILDING_SPLITS = {
  ppl: {
    key: 'ppl',
    name: 'Push / Pull / Legs',
    blurb:
      'Hypertrophy split that auto-rotates Push → Pull → Legs. Big compounds still count toward your maxes.',
    days: [
      {
        key: 'push',
        label: 'Push',
        muscles: ['Chest', 'Shoulders', 'Triceps'],
        slots: [
          {
            role: 'primary',
            compLift: 'bench',
            name: 'Bench Press',
            candidates: ['dumbbell-press', 'incline-bench'],
          },
          { role: 'compound', candidates: ['incline-bench', 'dumbbell-press'] },
          { role: 'compound', candidates: ['overhead-press', 'dumbbell-press'] },
          { role: 'isolation', candidates: ['lateral-raises'] },
          { role: 'isolation', candidates: ['tricep-extension', 'skull-crushers', 'dips'] },
        ],
      },
      {
        key: 'pull',
        label: 'Pull',
        muscles: ['Upper Back', 'Biceps', 'Forearms'],
        slots: [
          // Deadlift gets a lower-volume scheme than the hypertrophy default.
          {
            role: 'primary',
            compLift: 'deadlift',
            name: 'Deadlift',
            scheme: { sets: 3, repRange: [5, 8] },
            candidates: ['barbell-row', 'pendlay-row', 'dumbbell-row'],
          },
          { role: 'compound', candidates: ['barbell-row', 'dumbbell-row', 't-bar-row'] },
          { role: 'compound', candidates: ['lat-pulldown', 'wide-pullup'] },
          { role: 'compound', candidates: ['seated-cable-row', 'cable-row', 'dumbbell-row'] },
          { role: 'isolation', candidates: ['barbell-curl', 'hammer-curl', 'preacher-curl'] },
          { role: 'isolation', candidates: ['face-pull', 'rear-delt-flies'] },
        ],
      },
      {
        key: 'legs',
        label: 'Legs',
        muscles: ['Quads', 'Hams', 'Glutes', 'Calves'],
        slots: [
          {
            role: 'primary',
            compLift: 'squat',
            name: 'Squat',
            candidates: ['front-squat', 'leg-press', 'bulgarian-split-squat'],
          },
          { role: 'compound', candidates: ['romanian-deadlift', 'leg-press'] },
          { role: 'compound', candidates: ['leg-extension', 'bulgarian-split-squat'] },
          { role: 'isolation', candidates: ['lying-ham-curl', 'seated-ham-curl', 'nordic-curl'] },
          { role: 'compound', candidates: ['hip-thrust', 'glute-bridge'] },
          { role: 'isolation', candidates: ['calf-raise'] },
        ],
      },
    ],
  },
};

/** Default split for new bodybuilding plans. */
export const DEFAULT_SPLIT_TYPE = 'ppl';

/** Sentinel stored in programConfig.activeProgram while a split plan is active. */
export const SPLIT_PROGRAM_ID = '__split__';

/**
 * Resolve a slot's scheme: explicit slot override → role scheme → fallback.
 * @param {Object} slot
 * @returns {{ sets: number, repRange: number[] }}
 */
export function schemeForSlot(slot) {
  return slot.scheme || BB_SCHEMES[slot.role] || BB_SCHEME_FALLBACK;
}
