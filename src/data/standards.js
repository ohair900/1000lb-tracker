// src/data/standards.js — Strength standards (BW multipliers by classification)
// Note: IPF_CLASSES lives in src/data/constants.js (already extracted there)

export const STRENGTH_STANDARDS = {
  male: {
    squat: { beginner: 0.75, novice: 1.15, intermediate: 1.6, advanced: 2.15, elite: 2.6 },
    bench: { beginner: 0.5, novice: 0.85, intermediate: 1.1, advanced: 1.5, elite: 1.85 },
    deadlift: { beginner: 1.0, novice: 1.35, intermediate: 1.85, advanced: 2.5, elite: 3.0 },
  },
  female: {
    squat: { beginner: 0.5, novice: 0.85, intermediate: 1.35, advanced: 1.75, elite: 2.2 },
    bench: { beginner: 0.25, novice: 0.45, intermediate: 0.65, advanced: 1.0, elite: 1.25 },
    deadlift: { beginner: 0.75, novice: 1.0, intermediate: 1.35, advanced: 1.85, elite: 2.5 },
  },
};
