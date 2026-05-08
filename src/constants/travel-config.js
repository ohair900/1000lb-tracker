// src/constants/travel-config.js — Travel workout configuration

// Muscle keys must match MUSCLE_GROUPS in src/data/muscle-groups.js

export const TRAVEL_GROUPINGS = {
  push: {
    label: 'Push',
    muscles: ['Chest', 'Shoulders', 'Triceps'],
    count: 4,
  },
  pull: {
    label: 'Pull',
    muscles: ['Upper Back', 'Biceps', 'Forearms'],
    count: 4,
  },
  legs: {
    label: 'Legs',
    muscles: ['Quads', 'Hams', 'Glutes', 'Calves'],
    count: 5,
  },
  full: {
    label: 'Full Body',
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

// Equipment with inline SVG icons (currentColor stroke, 24×24 viewBox)
export const EQUIPMENT_META = {
  barbell: {
    label: 'Barbell',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="1.5" y="9" width="3" height="6" rx="0.75"/>
      <rect x="4.5" y="10" width="2" height="4" rx="0.5"/>
      <line x1="6.5" y1="12" x2="17.5" y2="12"/>
      <rect x="17.5" y="10" width="2" height="4" rx="0.5"/>
      <rect x="19.5" y="9" width="3" height="6" rx="0.75"/>
    </svg>`,
  },
  dumbbell: {
    label: 'Dumbbell',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="9.5" width="4" height="5" rx="0.75"/>
      <line x1="6" y1="12" x2="10" y2="12"/>
      <line x1="14" y1="12" x2="18" y2="12"/>
      <rect x="18" y="9.5" width="4" height="5" rx="0.75"/>
      <line x1="10" y1="10.5" x2="10" y2="13.5"/>
      <line x1="14" y1="10.5" x2="14" y2="13.5"/>
    </svg>`,
  },
  cable: {
    label: 'Cable',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="15" y="3" width="5" height="14" rx="1"/>
      <circle cx="14" cy="6" r="2"/>
      <path d="M12 6 Q 6 10 6 18"/>
      <line x1="3" y1="18" x2="9" y2="18" stroke-width="2"/>
    </svg>`,
  },
  machine: {
    label: 'Machine',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="11" width="9" height="3.5" rx="1"/>
      <rect x="10" y="5" width="3" height="9.5" rx="1"/>
      <circle cx="19" cy="9.5" r="3"/>
      <line x1="13" y1="8.5" x2="16" y2="9.5"/>
      <line x1="3" y1="14.5" x2="3" y2="20"/>
      <line x1="12" y1="14.5" x2="12" y2="20"/>
    </svg>`,
  },
  bodyweight: {
    label: 'BW',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="4.5" r="2"/>
      <line x1="12" y1="6.5" x2="12" y2="13.5"/>
      <path d="M12 9 L7.5 7 M12 9 L16.5 7"/>
      <path d="M12 13.5 L9 20 M12 13.5 L15 20"/>
    </svg>`,
  },
};

// Backward-compat: derived from EQUIPMENT_META so workout-summary.js import works unchanged
export const EQUIPMENT_LABELS = Object.fromEntries(
  Object.entries(EQUIPMENT_META).map(([k, v]) => [k, v.label])
);

// Built-in equipment presets (not deletable by user)
export const TRAVEL_BUILTIN_PRESETS = [
  {
    id: 'hotel',
    name: 'Hotel',
    builtin: true,
    equipment: { barbell: false, dumbbell: true, cable: false, machine: true, bodyweight: true },
  },
  {
    id: 'home',
    name: 'Home Gym',
    builtin: true,
    equipment: { barbell: true, dumbbell: true, cable: true, machine: true, bodyweight: true },
  },
  {
    id: 'bodyweight',
    name: 'Bodyweight',
    builtin: true,
    equipment: { barbell: false, dumbbell: false, cable: false, machine: false, bodyweight: true },
  },
  {
    id: 'outdoor',
    name: 'Outdoor',
    builtin: true,
    equipment: { barbell: false, dumbbell: false, cable: false, machine: false, bodyweight: true },
  },
];

// Set/rep defaults per progression type for travel sessions
export const TRAVEL_SET_DEFAULTS = {
  'close-variation': { sets: 4, repRange: [4, 6] },
  compound: { sets: 3, repRange: [8, 12] },
  isolation: { sets: 3, repRange: [12, 15] },
  bodyweight: { sets: 3, repRange: [8, 15] },
  time: { sets: 3, repRange: [20, 40] },
};
export const TRAVEL_SET_DEFAULTS_FALLBACK = { sets: 3, repRange: [8, 12] };
