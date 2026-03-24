// src/data/muscle-groups.js — Muscle group definitions, recovery, and fatigue weights

export const MUSCLE_GROUPS = ['Quads', 'Hams', 'Back', 'Chest'];

export const MUSCLE_RECOVERY_HOURS = { Quads: 48, Hams: 48, Back: 48, Chest: 48 };

export const MAIN_LIFT_WEIGHTS = {
  squat:    { Quads: 0.60, Hams: 0.25, Back: 0.15, Chest: 0 },
  bench:    { Quads: 0, Hams: 0, Back: 0, Chest: 1.0 },
  deadlift: { Quads: 0.20, Hams: 0.35, Back: 0.45, Chest: 0 }
};

export const ACCESSORY_CAT_WEIGHTS = {
  'squat-variation': { Quads: 0.60, Hams: 0.25, Back: 0.15, Chest: 0 },
  'quad-compound':   { Quads: 0.80, Hams: 0.20, Back: 0, Chest: 0 },
  'quad-isolation':  { Quads: 1.0,  Hams: 0, Back: 0, Chest: 0 },
  'quad':            { Quads: 0.70, Hams: 0.15, Back: 0.15, Chest: 0 },
  'posterior':       { Quads: 0, Hams: 0.60, Back: 0.40, Chest: 0 },
  'dl-variation':    { Quads: 0.20, Hams: 0.35, Back: 0.45, Chest: 0 },
  'back':            { Quads: 0, Hams: 0, Back: 1.0, Chest: 0 },
  'press-variation': { Quads: 0, Hams: 0, Back: 0, Chest: 1.0 },
  'chest-accessory': { Quads: 0, Hams: 0, Back: 0, Chest: 1.0 }
};
