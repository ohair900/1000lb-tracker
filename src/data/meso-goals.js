// src/data/meso-goals.js — Mesocycle goal definitions

export const MESO_GOALS = {
  hypertrophy: { label: 'Hypertrophy', pctRange: [65, 75], repRange: [8, 10], rpeRange: [6, 8], defaultWeeks: 6 },
  strength:    { label: 'Strength',    pctRange: [75, 92.5], repRange: [2, 5], rpeRange: [7, 9], defaultWeeks: 6 },
  peaking:     { label: 'Peaking',     pctRange: [85, 97.5], repRange: [1, 3], rpeRange: [8, 9.5], defaultWeeks: 4 },
  deload:      { label: 'Deload',      pctRange: [50, 60], repRange: [5, 5], rpeRange: [5, 5], defaultWeeks: 1 }
};
