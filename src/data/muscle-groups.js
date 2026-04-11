// src/data/muscle-groups.js — Muscle group definitions, recovery, and fatigue weights

export const MUSCLE_GROUPS = [
  'Quads', 'Hams', 'Glutes', 'Upper Back', 'Lower Back',
  'Chest', 'Shoulders', 'Triceps', 'Biceps', 'Core',
  'Forearms', 'Calves',
];

export const MUSCLE_RECOVERY_HOURS = {
  Quads: 48, Hams: 40, Glutes: 40,
  'Upper Back': 44, 'Lower Back': 56,
  Chest: 36, Shoulders: 36, Triceps: 32, Biceps: 32, Core: 28,
  Forearms: 32, Calves: 36,
};

export const MAIN_LIFT_WEIGHTS = {
  squat: {
    Quads: 0.32, Hams: 0.17, Glutes: 0.20,
    'Upper Back': 0.07, 'Lower Back': 0.10,
    Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.07,
    Forearms: 0.02, Calves: 0.05,
  },
  bench: {
    Quads: 0, Hams: 0, Glutes: 0,
    'Upper Back': 0.05, 'Lower Back': 0,
    Chest: 0.48, Shoulders: 0.23, Triceps: 0.20, Biceps: 0, Core: 0,
    Forearms: 0.04, Calves: 0,
  },
  deadlift: {
    Quads: 0.10, Hams: 0.22, Glutes: 0.18,
    'Upper Back': 0.15, 'Lower Back': 0.20,
    Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.08,
    Forearms: 0.05, Calves: 0.02,
  },
};

export const ACCESSORY_CAT_WEIGHTS = {
  'squat-variation': { Quads: 0.33, Hams: 0.18, Glutes: 0.20, 'Upper Back': 0.08, 'Lower Back': 0.10, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.06, Forearms: 0, Calves: 0.05 },
  'quad-compound':   { Quads: 0.60, Hams: 0.10, Glutes: 0.20, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.10, Forearms: 0, Calves: 0 },
  'quad-isolation':  { Quads: 1.0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0, Forearms: 0, Calves: 0 },
  'quad':            { Quads: 0.50, Hams: 0.10, Glutes: 0.15, 'Upper Back': 0.05, 'Lower Back': 0.05, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.15, Forearms: 0, Calves: 0 },
  'posterior':       { Quads: 0, Hams: 0.35, Glutes: 0.45, 'Upper Back': 0, 'Lower Back': 0.20, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0, Forearms: 0, Calves: 0 },
  'dl-variation':    { Quads: 0.10, Hams: 0.23, Glutes: 0.20, 'Upper Back': 0.15, 'Lower Back': 0.20, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.05, Forearms: 0.05, Calves: 0.02 },
  'back':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0.52, 'Lower Back': 0.10, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0.30, Core: 0, Forearms: 0.08, Calves: 0 },
  'press-variation': { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0.55, Shoulders: 0.21, Triceps: 0.20, Biceps: 0, Core: 0, Forearms: 0.04, Calves: 0 },
  'chest-accessory': { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0.67, Shoulders: 0.15, Triceps: 0.15, Biceps: 0, Core: 0, Forearms: 0.03, Calves: 0 },
  'tricep':          { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 1.0, Biceps: 0, Core: 0, Forearms: 0, Calves: 0 },
  'shoulder':        { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0.80, Triceps: 0.20, Biceps: 0, Core: 0, Forearms: 0, Calves: 0 },
  'core':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0, 'Lower Back': 0, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 1.0, Forearms: 0, Calves: 0 },
  'grip':            { Quads: 0, Hams: 0, Glutes: 0, 'Upper Back': 0.15, 'Lower Back': 0.15, Chest: 0, Shoulders: 0, Triceps: 0, Biceps: 0, Core: 0.20, Forearms: 0.40, Calves: 0.10 },
};

// Synergist cross-recovery map (#3): when a group is red/orange, connected groups
// recover slower. Asymmetric: large prime movers affect synergists, not vice versa.
export const SYNERGIST_MAP = {
  'Lower Back': ['Hams', 'Glutes', 'Core'],
  'Upper Back': ['Biceps', 'Shoulders', 'Forearms'],
  Chest:        ['Shoulders', 'Triceps'],
  Quads:        ['Glutes', 'Core', 'Calves'],
  Shoulders:    ['Triceps'],
};
export const SYNERGIST_RECOVERY_PENALTY = 0.12; // 12% slower recovery per red synergist

// Push/pull classification per muscle group (used by gap analysis for ratio tracking)
export const MUSCLE_PUSH_PULL = {
  Quads:       'push',
  Hams:        'pull',
  Glutes:      'push',
  'Upper Back':'pull',
  'Lower Back':'pull',
  Chest:       'push',
  Shoulders:   'push',
  Triceps:     'push',
  Biceps:      'pull',
  Core:        'neutral',
  Forearms:    'pull',
  Calves:      'push',
};

// Evidence-based weekly set minimums per muscle group (for gap analysis)
export const WEEKLY_SET_TARGETS = {
  Quads:       { min: 8,  max: 20 },
  Hams:        { min: 6,  max: 16 },
  Glutes:      { min: 6,  max: 16 },
  'Upper Back':{ min: 10, max: 25 },
  'Lower Back':{ min: 4,  max: 12 },
  Chest:       { min: 8,  max: 20 },
  Shoulders:   { min: 8,  max: 16 },
  Triceps:     { min: 6,  max: 14 },
  Biceps:      { min: 4,  max: 12 },
  Core:        { min: 4,  max: 16 },
  Forearms:    { min: 6,  max: 14 },
  Calves:      { min: 8,  max: 16 },
};
