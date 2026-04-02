// src/data/muscle-groups.js — Muscle group definitions, recovery, and fatigue weights

export const MUSCLE_GROUPS = [
  'Quads', 'Hams', 'Glutes', 'Upper Back', 'Lower Back',
  'Chest', 'Shoulders', 'Triceps', 'Biceps', 'Core',
];

export const MUSCLE_RECOVERY_HOURS = {
  Quads: 48, Hams: 40, Glutes: 40,
  'Upper Back': 44, 'Lower Back': 56,
  Chest: 36, Shoulders: 36, Triceps: 32, Biceps: 32, Core: 28,
};

export const MAIN_LIFT_WEIGHTS = {
  squat: {
    Quads: 0.35, Hams: 0.18, Glutes: 0.22,
    'Upper Back': 0.08, 'Lower Back': 0.10,
    Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.07,
  },
  bench: {
    Quads: 0, Hams: 0, Glutes: 0,
    'Upper Back': 0.05, 'Lower Back': 0,
    Chest: 0.50, Shoulders: 0.25, Triceps: 0.20, Biceps: 0, Core: 0,
  },
  deadlift: {
    Quads: 0.10, Hams: 0.25, Glutes: 0.20,
    'Upper Back': 0.17, 'Lower Back': 0.20,
    Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.08,
  },
};

export const ACCESSORY_CAT_WEIGHTS = {
  'squat-variation': { Quads: 0.35, Hams: 0.18, Glutes: 0.22, 'Upper Back': 0.08, 'Lower Back': 0.10, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.07 },
  'quad-compound':   { Quads: 0.60, Hams: 0.10, Glutes: 0.20, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.10 },
  'quad-isolation':  { Quads: 1.0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0 },
  'quad':            { Quads: 0.50, Hams: 0.10, Glutes: 0.15, 'Upper Back': 0.05, 'Lower Back': 0.05, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.15 },
  'posterior':       { Quads: 0, Hams: 0.35, Glutes: 0.45, 'Upper Back': 0, 'Lower Back': 0.20, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0 },
  'dl-variation':    { Quads: 0.10, Hams: 0.25, Glutes: 0.20, 'Upper Back': 0.17, 'Lower Back': 0.20, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.08 },
  'back':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0.60, 'Lower Back': 0.10, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0.30, Core: 0 },
  'press-variation': { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0.55, Shoulders: 0.25, Triceps: 0.20, Biceps: 0, Core: 0 },
  'chest-accessory': { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0.70, Shoulders: 0.15, Triceps: 0.15, Biceps: 0, Core: 0 },
  'tricep':          { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 1.0, Biceps: 0, Core: 0 },
  'shoulder':        { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0.80, Triceps: 0.20, Biceps: 0, Core: 0 },
  'core':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 1.0 },
  'grip':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0.10, 'Lower Back': 0.20, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.70 },
};
