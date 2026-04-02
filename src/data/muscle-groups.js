// src/data/muscle-groups.js — Muscle group definitions, recovery, and fatigue weights

export const MUSCLE_GROUPS = [
  'Quads', 'Hams', 'Glutes', 'Upper Back', 'Lower Back',
  'Chest', 'Shoulders', 'Triceps', 'Biceps', 'Core',
];

export const MUSCLE_RECOVERY_HOURS = {
  Quads: 72, Hams: 56, Glutes: 56,
  'Upper Back': 60, 'Lower Back': 72,
  Chest: 52, Shoulders: 48, Triceps: 40, Biceps: 40, Core: 36,
};

export const MAIN_LIFT_WEIGHTS = {
  squat: {
    Quads: 0.40, Hams: 0.15, Glutes: 0.25,
    'Upper Back': 0.05, 'Lower Back': 0.05,
    Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.10,
  },
  bench: {
    Quads: 0, Hams: 0, Glutes: 0,
    'Upper Back': 0, 'Lower Back': 0,
    Chest: 0.55, Shoulders: 0.25, Triceps: 0.20, Biceps: 0, Core: 0,
  },
  deadlift: {
    Quads: 0.15, Hams: 0.25, Glutes: 0.25,
    'Upper Back': 0.15, 'Lower Back': 0.10,
    Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.10,
  },
};

export const ACCESSORY_CAT_WEIGHTS = {
  'squat-variation': { Quads: 0.40, Hams: 0.15, Glutes: 0.25, 'Upper Back': 0.05, 'Lower Back': 0.05, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.10 },
  'quad-compound':   { Quads: 0.60, Hams: 0.10, Glutes: 0.20, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.10 },
  'quad-isolation':  { Quads: 1.0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0 },
  'quad':            { Quads: 0.50, Hams: 0.10, Glutes: 0.15, 'Upper Back': 0.05, 'Lower Back': 0.05, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.15 },
  'posterior':       { Quads: 0, Hams: 0.35, Glutes: 0.45, 'Upper Back': 0, 'Lower Back': 0.20, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0 },
  'dl-variation':    { Quads: 0.15, Hams: 0.25, Glutes: 0.25, 'Upper Back': 0.15, 'Lower Back': 0.10, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.10 },
  'back':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0.60, 'Lower Back': 0.10, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0.30, Core: 0 },
  'press-variation': { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0.55, Shoulders: 0.25, Triceps: 0.20, Biceps: 0, Core: 0 },
  'chest-accessory': { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0.70, Shoulders: 0.15, Triceps: 0.15, Biceps: 0, Core: 0 },
  'tricep':          { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 1.0, Biceps: 0, Core: 0 },
  'shoulder':        { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0.80, Triceps: 0.20, Biceps: 0, Core: 0 },
  'core':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 1.0 },
  'grip':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0.10, 'Lower Back': 0.20, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.70 },
};
