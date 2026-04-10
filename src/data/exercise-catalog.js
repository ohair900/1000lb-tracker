// src/data/exercise-catalog.js — Unified exercise registry, movement patterns, and progression models
//
// This replaces the siloed ACCESSORY_DB for new code paths.
// The old ACCESSORY_DB in accessories.js is kept for backward compat.
// See exercise-compat.js for the legacy ID mapping layer.

// ---------------------------------------------------------------------------
// Movement patterns (8 categories)
// ---------------------------------------------------------------------------

export const MOVEMENT_PATTERNS = {
  'squat-pattern':   { label: 'Squat Pattern',   pushPull: 'push' },
  'hip-hinge':       { label: 'Hip Hinge',       pushPull: 'push' },
  'horizontal-push': { label: 'Horizontal Push',  pushPull: 'push' },
  'horizontal-pull': { label: 'Horizontal Pull',  pushPull: 'pull' },
  'vertical-push':   { label: 'Vertical Push',    pushPull: 'push' },
  'vertical-pull':   { label: 'Vertical Pull',    pushPull: 'pull' },
  'core-stability':  { label: 'Core / Stability', pushPull: 'neutral' },
  'grip-carry':      { label: 'Grip / Carry',     pushPull: 'neutral' },
};

// ---------------------------------------------------------------------------
// Progression models
// ---------------------------------------------------------------------------

export const PROGRESSION_MODELS = {
  'close-variation': { method: 'pct-of-tm' },
  'compound':        { method: 'double-progression', increment: { kg: 2.5, lbs: 5 } },
  'isolation':       { method: 'double-progression', increment: { kg: 1.25, lbs: 2.5 } },
  'bodyweight':      { method: 'rep-first',          increment: { kg: 2.5, lbs: 5 } },
  'time':            { method: 'time-progression',   increment: 5 },
};

// ---------------------------------------------------------------------------
// Movement pattern → default muscle weights (used for custom exercises
// when user picks a pattern but not specific muscles)
// ---------------------------------------------------------------------------

export const PATTERN_DEFAULT_MUSCLES = {
  'squat-pattern':   { Quads: 0.45, Hams: 0.10, Glutes: 0.25, Core: 0.10, 'Lower Back': 0.05, 'Upper Back': 0.05 },
  'hip-hinge':       { Hams: 0.35, Glutes: 0.35, 'Lower Back': 0.20, Core: 0.10 },
  'horizontal-push': { Chest: 0.45, Shoulders: 0.25, Triceps: 0.25, Core: 0.05 },
  'horizontal-pull': { 'Upper Back': 0.45, Biceps: 0.20, 'Lower Back': 0.15, Shoulders: 0.10, Core: 0.10 },
  'vertical-push':   { Shoulders: 0.50, Triceps: 0.30, 'Upper Back': 0.10, Core: 0.10 },
  'vertical-pull':   { 'Upper Back': 0.50, Biceps: 0.30, Core: 0.10, Shoulders: 0.10 },
  'core-stability':  { Core: 0.80, 'Lower Back': 0.10, Hams: 0.10 },
  'grip-carry':      { Core: 0.40, 'Upper Back': 0.20, 'Lower Back': 0.20, Hams: 0.10, Glutes: 0.10 },
};

// ---------------------------------------------------------------------------
// Exercise catalog (~51 canonical exercises)
// ---------------------------------------------------------------------------

export const EXERCISE_CATALOG = {

  // =========================================================================
  // SQUAT PATTERN
  // =========================================================================

  'pause-squat': {
    name: 'Pause Squat',
    movementPattern: 'squat-pattern',
    primaryMuscles: { Quads: 0.35, Glutes: 0.22, Hams: 0.18, 'Lower Back': 0.10, 'Upper Back': 0.08, Core: 0.07 },
    progressionType: 'close-variation',
    equipment: 'barbell',
    repRange: [3, 5],
    sets: 5,
    pctOfTM: { squat: 0.65 },
    supportsLifts: ['squat'],
    weakPoints: { squat: ['hole', 'core'] },
    desc: 'Squat with a 2-3s pause in the bottom position. Builds strength out of the hole and reinforces bracing.',
  },

  'front-squat': {
    name: 'Front Squat',
    movementPattern: 'squat-pattern',
    primaryMuscles: { Quads: 0.50, Core: 0.15, Glutes: 0.15, Hams: 0.10, 'Upper Back': 0.05, 'Lower Back': 0.05 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [5, 8],
    sets: 4,
    pctOfTM: { squat: 0.60, deadlift: 0.50 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['hole', 'quads', 'core'], deadlift: ['floor'] },
    desc: 'Barbell racked on front delts with an upright torso. Targets quads and core stability.',
  },

  'leg-press': {
    name: 'Leg Press',
    movementPattern: 'squat-pattern',
    primaryMuscles: { Quads: 0.60, Glutes: 0.20, Hams: 0.10, Core: 0.10 },
    progressionType: 'compound',
    equipment: 'machine',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { squat: 1.00, deadlift: 0.80 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['quads', 'hole'], deadlift: ['floor'] },
    desc: 'Machine press using legs. Heavy quad builder without spinal loading.',
  },

  'leg-extension': {
    name: 'Leg Extension',
    movementPattern: 'squat-pattern',
    primaryMuscles: { Quads: 1.0 },
    progressionType: 'isolation',
    equipment: 'machine',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { squat: 0.25 },
    supportsLifts: ['squat'],
    weakPoints: { squat: ['quads'] },
    desc: 'Seated machine extension. Isolates the quadriceps.',
  },

  'bulgarian-split-squat': {
    name: 'Bulgarian Split Squat',
    movementPattern: 'squat-pattern',
    primaryMuscles: { Quads: 0.50, Glutes: 0.25, Core: 0.15, Hams: 0.10 },
    progressionType: 'compound',
    equipment: 'dumbbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { squat: 0.30 },
    supportsLifts: ['squat'],
    weakPoints: { squat: ['quads', 'hole'] },
    desc: 'Rear foot elevated on bench, lunge down on front leg. Unilateral quad and balance work.',
  },

  'lunges': {
    name: 'Lunges',
    movementPattern: 'squat-pattern',
    primaryMuscles: { Quads: 0.45, Glutes: 0.25, Core: 0.15, Hams: 0.15 },
    progressionType: 'compound',
    equipment: 'dumbbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { squat: 0.30 },
    supportsLifts: ['squat'],
    weakPoints: { squat: ['quads', 'lockout'] },
    desc: 'Step forward or backward and lower until both knees are at 90 degrees. Builds single-leg quad strength.',
  },

  'wall-sit': {
    name: 'Wall Sit',
    movementPattern: 'squat-pattern',
    primaryMuscles: { Quads: 1.0 },
    progressionType: 'time',
    equipment: 'bodyweight',
    repRange: [30, 60],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['squat'],
    weakPoints: { squat: ['quads'] },
    timeBased: true,
    desc: 'Back flat against a wall, thighs parallel to floor. Isometric quad endurance hold.',
  },

  'calf-raise': {
    name: 'Calf Raises',
    movementPattern: 'squat-pattern',
    primaryMuscles: { Quads: 0.30, Hams: 0.30, Glutes: 0.40 },
    progressionType: 'isolation',
    equipment: 'machine',
    repRange: [12, 20],
    sets: 3,
    pctOfTM: { squat: 0.30, deadlift: 0.30 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['quads'], deadlift: ['floor'] },
    desc: 'Raise heels against resistance. Builds calf and lower leg strength for stability under load.',
  },

  // =========================================================================
  // HIP HINGE
  // =========================================================================

  'good-morning': {
    name: 'Good Morning',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Hams: 0.30, Glutes: 0.25, 'Lower Back': 0.25, Core: 0.15, 'Upper Back': 0.05 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { squat: 0.35, deadlift: 0.30 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['lockout', 'core'], deadlift: ['lockout', 'upperback'] },
    desc: 'Barbell on back, hinge at the hips until torso is near parallel. Strengthens posterior chain and core.',
  },

  'hip-thrust': {
    name: 'Hip Thrust',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Glutes: 0.60, Hams: 0.20, Core: 0.10, 'Lower Back': 0.10 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { squat: 0.60, deadlift: 0.50 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['lockout'], deadlift: ['lockout'] },
    eccentricLoad: 'low',
    desc: 'Back against a bench, drive barbell up with hips. Isolates glutes for lockout power.',
  },

  'glute-bridge': {
    name: 'Glute Bridge',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Glutes: 0.65, Hams: 0.20, Core: 0.10, 'Lower Back': 0.05 },
    progressionType: 'isolation',
    equipment: 'barbell',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { squat: 0.50, deadlift: 0.40 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['lockout'], deadlift: ['lockout'] },
    eccentricLoad: 'low',
    desc: 'Lie flat, drive hips up with barbell across hips. Glute activation with less range than hip thrust.',
  },

  'rdl': {
    name: 'Romanian Deadlift',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Hams: 0.40, Glutes: 0.25, 'Lower Back': 0.20, Core: 0.10, 'Upper Back': 0.05 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { squat: 0.50, deadlift: 0.45 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['lockout', 'core'], deadlift: ['lockout'] },
    eccentricLoad: 'high',
    desc: 'Stand with barbell, hinge at hips keeping legs nearly straight. Targets hamstrings and lower back.',
  },

  // =========================================================================
  // HORIZONTAL PUSH
  // =========================================================================

  'pause-bench': {
    name: 'Pause Bench',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Chest: 0.50, Shoulders: 0.25, Triceps: 0.20, Core: 0.05 },
    progressionType: 'close-variation',
    equipment: 'barbell',
    repRange: [3, 5],
    sets: 5,
    pctOfTM: { bench: 0.70 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['chest'] },
    desc: 'Bench press with a 2-3s pause on the chest. Builds power off the chest and eliminates bounce.',
  },

  'spoto-press': {
    name: 'Spoto Press',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Chest: 0.50, Shoulders: 0.25, Triceps: 0.20, Core: 0.05 },
    progressionType: 'close-variation',
    equipment: 'barbell',
    repRange: [5, 8],
    sets: 4,
    pctOfTM: { bench: 0.65 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['chest'] },
    desc: 'Lower the bar to 1-2 inches above the chest and press. Strengthens the mid-range sticking point.',
  },

  'close-grip-bench': {
    name: 'Close-Grip Bench',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Triceps: 0.45, Chest: 0.35, Shoulders: 0.15, Core: 0.05 },
    progressionType: 'close-variation',
    equipment: 'barbell',
    repRange: [5, 8],
    sets: 4,
    pctOfTM: { bench: 0.70 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['lockout'] },
    desc: 'Bench press with hands shoulder-width apart. Emphasizes tricep lockout strength.',
  },

  'incline-bench': {
    name: 'Incline Bench',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Chest: 0.40, Shoulders: 0.30, Triceps: 0.20, Core: 0.10 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [6, 10],
    sets: 4,
    pctOfTM: { bench: 0.65 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['shoulders', 'chest'] },
    desc: 'Bench press on a 30-45 degree incline. Targets upper chest and front delts.',
  },

  'dumbbell-press': {
    name: 'Dumbbell Press',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Chest: 0.50, Shoulders: 0.25, Triceps: 0.20, Core: 0.05 },
    progressionType: 'compound',
    equipment: 'dumbbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { bench: 0.30 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['chest', 'shoulders'] },
    desc: 'Flat bench press with dumbbells. Greater range of motion and pec stretch.',
  },

  'chest-flies': {
    name: 'Chest Flies',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Chest: 0.75, Shoulders: 0.15, Biceps: 0.10 },
    progressionType: 'isolation',
    equipment: 'dumbbell',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { bench: 0.15 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['chest'] },
    desc: 'Dumbbells in each hand, arc outward and squeeze together. Chest isolation with a deep stretch.',
  },

  'tricep-extension': {
    name: 'Tricep Extension',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Triceps: 1.0 },
    progressionType: 'isolation',
    equipment: 'cable',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { bench: 0.15 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['lockout'] },
    desc: 'Cable or rope pushdowns extending the elbows. Tricep isolation.',
  },

  'skull-crushers': {
    name: 'Skull Crushers',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Triceps: 0.85, Chest: 0.10, Shoulders: 0.05 },
    progressionType: 'isolation',
    equipment: 'barbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { bench: 0.20 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['lockout'] },
    desc: 'Lying barbell extension lowered toward forehead. Targets the long head of the triceps.',
  },

  'jm-press': {
    name: 'JM Press',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Triceps: 0.55, Chest: 0.30, Shoulders: 0.15 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [6, 10],
    sets: 4,
    pctOfTM: { bench: 0.45 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['lockout'] },
    desc: 'Hybrid of close-grip bench and skull crusher. Overloads triceps in the bench press path.',
  },

  'dips': {
    name: 'Dips',
    movementPattern: 'horizontal-push',
    primaryMuscles: { Chest: 0.35, Triceps: 0.40, Shoulders: 0.20, Core: 0.05 },
    progressionType: 'bodyweight',
    equipment: 'bodyweight',
    repRange: [6, 12],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['bench'],
    weakPoints: { bench: ['lockout', 'chest'] },
    desc: 'Lower and press body between parallel bars. Builds pressing strength and tricep mass.',
  },

  // =========================================================================
  // HORIZONTAL PULL
  // =========================================================================

  'barbell-row': {
    name: 'Barbell Row',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { 'Upper Back': 0.40, Biceps: 0.20, 'Lower Back': 0.15, Hams: 0.10, Core: 0.10, Shoulders: 0.05 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [6, 10],
    sets: 4,
    pctOfTM: { bench: 0.55, deadlift: 0.45 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['floor', 'upperback'] },
    desc: 'Hinge forward, row barbell to lower chest. Builds upper back thickness for bench stability.',
  },

  'dumbbell-row': {
    name: 'Dumbbell Row',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { 'Upper Back': 0.45, Biceps: 0.25, Shoulders: 0.10, Core: 0.10, 'Lower Back': 0.10 },
    progressionType: 'compound',
    equipment: 'dumbbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { bench: 0.25 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['upperback'] },
    desc: 'One-arm dumbbell row from a bench. Unilateral upper back and lat strength.',
  },

  'pendlay-row': {
    name: 'Pendlay Row',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { 'Upper Back': 0.45, Biceps: 0.15, 'Lower Back': 0.20, Core: 0.10, Hams: 0.10 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [5, 8],
    sets: 4,
    pctOfTM: { bench: 0.50, deadlift: 0.40 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['floor', 'upperback'] },
    desc: 'Strict barbell row from the floor each rep. Explosive upper back power for deadlift position.',
  },

  't-bar-row': {
    name: 'T-Bar Row',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { 'Upper Back': 0.45, Biceps: 0.15, 'Lower Back': 0.15, Core: 0.15, Shoulders: 0.10 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { bench: 0.45, deadlift: 0.40 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['upperback'] },
    desc: 'Row one end of a barbell anchored at the other end. Heavy upper back builder with neutral grip.',
  },

  'cable-row': {
    name: 'Cable Row',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { 'Upper Back': 0.45, Biceps: 0.25, Core: 0.15, Shoulders: 0.10, 'Lower Back': 0.05 },
    progressionType: 'compound',
    equipment: 'cable',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { bench: 0.30, deadlift: 0.25 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['upperback'] },
    desc: 'Seated cable row with various handle attachments. Constant tension upper back work.',
  },

  'seated-cable-row': {
    name: 'Seated Cable Row',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { 'Upper Back': 0.45, Biceps: 0.20, 'Lower Back': 0.15, Core: 0.10, Shoulders: 0.10 },
    progressionType: 'compound',
    equipment: 'cable',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { bench: 0.25, deadlift: 0.20 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['upperback'] },
    desc: 'Wide-grip seated cable row targeting mid-back. Builds back width and posture support.',
  },

  'face-pull': {
    name: 'Face Pulls',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { Shoulders: 0.35, 'Upper Back': 0.35, Biceps: 0.15, Core: 0.15 },
    progressionType: 'isolation',
    equipment: 'cable',
    repRange: [12, 20],
    sets: 3,
    pctOfTM: { bench: 0.12, deadlift: 0.10 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback', 'shoulders'], deadlift: ['upperback'] },
    desc: 'Pull cable rope toward the face with elbows high. Builds rear delts and external rotation.',
  },

  'rear-delt-flies': {
    name: 'Rear Delt Flies',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { Shoulders: 0.50, 'Upper Back': 0.35, Biceps: 0.15 },
    progressionType: 'isolation',
    equipment: 'dumbbell',
    repRange: [12, 20],
    sets: 3,
    pctOfTM: { bench: 0.08 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['upperback', 'shoulders'] },
    desc: 'Bent-over dumbbell flies targeting rear delts. Balances pressing with pulling.',
  },

  'barbell-shrugs': {
    name: 'Barbell Shrugs',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { 'Upper Back': 0.60, Core: 0.20, Shoulders: 0.10, 'Lower Back': 0.10 },
    progressionType: 'isolation',
    equipment: 'barbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { deadlift: 0.50 },
    supportsLifts: ['deadlift'],
    weakPoints: { deadlift: ['lockout', 'grip', 'upperback'] },
    desc: 'Barbell in hands, shrug shoulders toward ears. Builds upper traps and grip.',
  },

  'dumbbell-shrugs': {
    name: 'Dumbbell Shrugs',
    movementPattern: 'horizontal-pull',
    primaryMuscles: { 'Upper Back': 0.60, Shoulders: 0.15, Biceps: 0.15, Core: 0.10 },
    progressionType: 'isolation',
    equipment: 'dumbbell',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { deadlift: 0.25 },
    supportsLifts: ['deadlift'],
    weakPoints: { deadlift: ['grip', 'upperback'] },
    desc: 'Dumbbell shrugs. Trap and grip work with a freer range of motion.',
  },

  // =========================================================================
  // VERTICAL PUSH
  // =========================================================================

  'overhead-press': {
    name: 'Overhead Press',
    movementPattern: 'vertical-push',
    primaryMuscles: { Shoulders: 0.45, Triceps: 0.30, 'Upper Back': 0.10, Core: 0.15 },
    progressionType: 'compound',
    equipment: 'barbell',
    repRange: [5, 8],
    sets: 4,
    pctOfTM: { bench: 0.55 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['shoulders', 'lockout'] },
    desc: 'Press barbell overhead from shoulders. Builds shoulders and overhead pressing strength.',
  },

  'lateral-raises': {
    name: 'Lateral Raises',
    movementPattern: 'vertical-push',
    primaryMuscles: { Shoulders: 0.85, 'Upper Back': 0.10, Core: 0.05 },
    progressionType: 'isolation',
    equipment: 'dumbbell',
    repRange: [12, 20],
    sets: 3,
    pctOfTM: { bench: 0.08 },
    supportsLifts: ['bench'],
    weakPoints: { bench: ['shoulders'] },
    desc: 'Raise dumbbells out to the sides to shoulder height. Isolates lateral deltoids.',
  },

  // =========================================================================
  // VERTICAL PULL
  // =========================================================================

  'pullup': {
    name: 'Pull-ups',
    movementPattern: 'vertical-pull',
    primaryMuscles: { 'Upper Back': 0.50, Biceps: 0.25, Core: 0.15, Shoulders: 0.10 },
    progressionType: 'bodyweight',
    equipment: 'bodyweight',
    repRange: [6, 12],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['floor', 'upperback'] },
    desc: 'Hang from a bar, pull chin over. Lat and upper back strength.',
  },

  'wide-pullup': {
    name: 'Wide-Grip Pull-ups',
    movementPattern: 'vertical-pull',
    primaryMuscles: { 'Upper Back': 0.55, Biceps: 0.20, Core: 0.15, Shoulders: 0.10 },
    progressionType: 'bodyweight',
    equipment: 'bodyweight',
    repRange: [6, 12],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['floor', 'upperback'] },
    desc: 'Pull-up with a wider-than-shoulder grip. Emphasizes lat width.',
  },

  'chinup': {
    name: 'Chin-ups',
    movementPattern: 'vertical-pull',
    primaryMuscles: { 'Upper Back': 0.40, Biceps: 0.35, Core: 0.15, Shoulders: 0.10 },
    progressionType: 'bodyweight',
    equipment: 'bodyweight',
    repRange: [6, 12],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['floor', 'upperback'] },
    desc: 'Underhand-grip pull-up. Engages biceps more than standard pull-ups.',
  },

  'lat-pulldown': {
    name: 'Lat Pulldown',
    movementPattern: 'vertical-pull',
    primaryMuscles: { 'Upper Back': 0.50, Biceps: 0.25, Shoulders: 0.10, Core: 0.15 },
    progressionType: 'compound',
    equipment: 'cable',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { deadlift: 0.30, bench: 0.25 },
    supportsLifts: ['deadlift', 'bench'],
    weakPoints: { deadlift: ['floor', 'upperback'], bench: ['upperback'] },
    desc: 'Cable pulldown to chest. Lat engagement for keeping the bar close during deadlifts.',
  },

  // =========================================================================
  // DEADLIFT VARIATIONS (close-variation pattern — still squat-pattern or hip-hinge)
  // =========================================================================

  'deficit-deadlift': {
    name: 'Deficit Deadlift',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Hams: 0.25, Glutes: 0.20, Quads: 0.15, 'Lower Back': 0.20, 'Upper Back': 0.12, Core: 0.08 },
    progressionType: 'close-variation',
    equipment: 'barbell',
    repRange: [3, 5],
    sets: 5,
    pctOfTM: { deadlift: 0.65 },
    supportsLifts: ['deadlift'],
    weakPoints: { deadlift: ['floor'] },
    eccentricLoad: 'high',
    desc: 'Deadlift while standing on a 1-2 inch platform. Increases range of motion off the floor.',
  },

  'block-pull': {
    name: 'Block Pull',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Hams: 0.20, Glutes: 0.25, 'Upper Back': 0.20, 'Lower Back': 0.20, Core: 0.10, Quads: 0.05 },
    progressionType: 'close-variation',
    equipment: 'barbell',
    repRange: [3, 5],
    sets: 5,
    pctOfTM: { deadlift: 0.80 },
    supportsLifts: ['deadlift'],
    weakPoints: { deadlift: ['lockout'] },
    desc: 'Deadlift from elevated blocks (mid-shin or above). Overloads the lockout portion.',
  },

  // =========================================================================
  // CORE / STABILITY
  // =========================================================================

  'ab-wheel': {
    name: 'Ab Wheel',
    movementPattern: 'core-stability',
    primaryMuscles: { Core: 0.75, Shoulders: 0.10, 'Lower Back': 0.10, 'Upper Back': 0.05 },
    progressionType: 'bodyweight',
    equipment: 'bodyweight',
    repRange: [8, 15],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['squat', 'deadlift', 'bench'],
    weakPoints: { squat: ['core'], deadlift: ['lockout'] },
    desc: 'Kneel and roll a wheel forward, extending the body. Deep core anti-extension exercise.',
  },

  'pallof-press': {
    name: 'Pallof Press',
    movementPattern: 'core-stability',
    primaryMuscles: { Core: 0.80, Shoulders: 0.10, 'Upper Back': 0.10 },
    progressionType: 'isolation',
    equipment: 'cable',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { squat: 0.10, deadlift: 0.10 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['core'] },
    desc: 'Press cable outward and hold against rotational pull. Anti-rotation core stability drill.',
  },

  'plank': {
    name: 'Plank',
    movementPattern: 'core-stability',
    primaryMuscles: { Core: 0.70, Shoulders: 0.10, 'Lower Back': 0.10, Glutes: 0.10 },
    progressionType: 'time',
    equipment: 'bodyweight',
    repRange: [30, 60],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['squat', 'deadlift', 'bench'],
    weakPoints: { squat: ['core'] },
    timeBased: true,
    desc: 'Hold a rigid push-up position on forearms. Isometric core endurance.',
  },

  // =========================================================================
  // GRIP / CARRY
  // =========================================================================

  'farmers-walk': {
    name: "Farmer's Walk",
    movementPattern: 'grip-carry',
    primaryMuscles: { Core: 0.30, 'Upper Back': 0.25, 'Lower Back': 0.15, Hams: 0.10, Glutes: 0.10, Shoulders: 0.10 },
    progressionType: 'time',
    equipment: 'dumbbell',
    repRange: [30, 60],
    sets: 3,
    pctOfTM: { deadlift: 0.50 },
    supportsLifts: ['deadlift'],
    weakPoints: { deadlift: ['grip', 'lockout'] },
    eccentricLoad: 'low',
    timeBased: true,
    desc: 'Walk holding heavy dumbbells at sides. Builds grip endurance and full-body stability.',
  },

  'dead-hang': {
    name: 'Dead Hang',
    movementPattern: 'grip-carry',
    primaryMuscles: { 'Upper Back': 0.30, Shoulders: 0.20, Core: 0.20, Biceps: 0.15, 'Lower Back': 0.15 },
    progressionType: 'time',
    equipment: 'bodyweight',
    repRange: [20, 60],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['deadlift'],
    weakPoints: { deadlift: ['grip'] },
    eccentricLoad: 'low',
    timeBased: true,
    desc: 'Hang from a pull-up bar as long as possible. Pure grip endurance training.',
  },

  // =========================================================================
  // NEW: HAMSTRING ISOLATION
  // =========================================================================

  'seated-ham-curl': {
    name: 'Seated Hamstring Curl',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Hams: 0.90, Glutes: 0.10 },
    progressionType: 'isolation',
    equipment: 'machine',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { squat: 0.20, deadlift: 0.20 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['lockout'], deadlift: ['lockout'] },
    desc: 'Seated machine curl targeting the hamstrings. Isolates the knee flexion function of the hamstrings.',
  },

  'lying-ham-curl': {
    name: 'Lying Hamstring Curl',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Hams: 0.90, Glutes: 0.10 },
    progressionType: 'isolation',
    equipment: 'machine',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { squat: 0.20, deadlift: 0.20 },
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['lockout'], deadlift: ['lockout'] },
    desc: 'Lying face-down, curl weight toward glutes. Targets hamstrings through full range of motion.',
  },

  'nordic-curl': {
    name: 'Nordic Hamstring Curl',
    movementPattern: 'hip-hinge',
    primaryMuscles: { Hams: 0.85, Glutes: 0.10, Core: 0.05 },
    progressionType: 'bodyweight',
    equipment: 'bodyweight',
    repRange: [4, 8],
    sets: 3,
    pctOfTM: {},
    supportsLifts: ['squat', 'deadlift'],
    weakPoints: { squat: ['lockout'], deadlift: ['lockout'] },
    eccentricLoad: 'high',
    desc: 'Kneel and slowly lower body forward under control. Advanced eccentric hamstring exercise for injury prevention.',
  },

  // =========================================================================
  // NEW: BICEP EXERCISES
  // =========================================================================

  'barbell-curl': {
    name: 'Barbell Curl',
    movementPattern: 'vertical-pull',
    primaryMuscles: { Biceps: 0.85, Shoulders: 0.10, Core: 0.05 },
    progressionType: 'isolation',
    equipment: 'barbell',
    repRange: [8, 12],
    sets: 3,
    pctOfTM: { bench: 0.20, deadlift: 0.15 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'], deadlift: ['grip'] },
    desc: 'Standing barbell curl. Builds bicep size and pulling strength for rows and deadlifts.',
  },

  'hammer-curl': {
    name: 'Hammer Curl',
    movementPattern: 'vertical-pull',
    primaryMuscles: { Biceps: 0.75, Shoulders: 0.15, Core: 0.10 },
    progressionType: 'isolation',
    equipment: 'dumbbell',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { bench: 0.12, deadlift: 0.10 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { deadlift: ['grip'] },
    desc: 'Dumbbell curl with neutral grip (palms facing in). Targets brachialis and forearm for grip support.',
  },

  'preacher-curl': {
    name: 'Preacher Curl',
    movementPattern: 'vertical-pull',
    primaryMuscles: { Biceps: 0.90, Shoulders: 0.05, Core: 0.05 },
    progressionType: 'isolation',
    equipment: 'dumbbell',
    repRange: [10, 15],
    sets: 3,
    pctOfTM: { bench: 0.10, deadlift: 0.08 },
    supportsLifts: ['bench', 'deadlift'],
    weakPoints: { bench: ['upperback'] },
    desc: 'Curl over a preacher bench to isolate the biceps. Eliminates momentum for strict form.',
  },
};
