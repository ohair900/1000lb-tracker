// src/constants/travel-config.js — Travel workout configuration

// Muscle keys must match MUSCLE_GROUPS in src/data/muscle-groups.js

export const TRAVEL_GROUPINGS = {
  push: {
    label: 'Push',
    icon: '&#11014;',
    muscles: ['Chest', 'Shoulders', 'Triceps'],
    count: 4,
  },
  pull: {
    label: 'Pull',
    icon: '&#11015;',
    muscles: ['Upper Back', 'Biceps', 'Forearms'],
    count: 4,
  },
  legs: {
    label: 'Legs',
    icon: '&#127939;',
    muscles: ['Quads', 'Hams', 'Glutes', 'Calves'],
    count: 5,
  },
  full: {
    label: 'Full Body',
    icon: '&#128170;',
    muscles: ['Chest', 'Upper Back', 'Quads', 'Hams', 'Shoulders'],
    count: 6,
  },
};

// Maps travel grouping to the SBD lift used for weight/progression lookups
export const GROUPING_LIFT_CONTEXT = {
  push: 'bench',
  pull: 'deadlift',
  legs: 'squat',
  full: 'squat',
};

// Default hotel-gym equipment (no barbell/cable, yes dumbbell/machine/bodyweight)
export const TRAVEL_DEFAULT_EQUIPMENT = {
  barbell: false,
  dumbbell: true,
  cable: false,
  machine: true,
  bodyweight: true,
};

// Display labels for equipment toggles
export const EQUIPMENT_LABELS = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  cable: 'Cable',
  machine: 'Machine',
  bodyweight: 'Bodyweight',
};

// Set/rep defaults per progression type for travel sessions
export const TRAVEL_SET_DEFAULTS = {
  'close-variation': { sets: 4, repRange: [4, 6] },
  compound: { sets: 3, repRange: [8, 12] },
  isolation: { sets: 3, repRange: [12, 15] },
  bodyweight: { sets: 3, repRange: [8, 15] },
  time: { sets: 3, repRange: [20, 40] },
};
export const TRAVEL_SET_DEFAULTS_FALLBACK = { sets: 3, repRange: [8, 12] };
