// src/data/standards.js — Strength standards (BW multipliers by classification)
// Note: IPF_CLASSES lives in src/data/constants.js (already extracted there)

export const STRENGTH_STANDARDS = {
  male: {
    squat:    { beginner: 0.75, novice: 1.25, intermediate: 1.75, advanced: 2.5, elite: 3.0 },
    bench:    { beginner: 0.5,  novice: 1.0,  intermediate: 1.25, advanced: 1.75, elite: 2.0 },
    deadlift: { beginner: 1.0,  novice: 1.5,  intermediate: 2.0,  advanced: 2.75, elite: 3.5 }
  },
  female: {
    squat:    { beginner: 0.5,  novice: 1.0,  intermediate: 1.5,  advanced: 2.0, elite: 2.5 },
    bench:    { beginner: 0.25, novice: 0.5,  intermediate: 0.75, advanced: 1.25, elite: 1.5 },
    deadlift: { beginner: 0.5,  novice: 1.0,  intermediate: 1.5,  advanced: 2.0, elite: 2.75 }
  }
};
