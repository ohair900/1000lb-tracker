/**
 * Injury mapping tables — data-driven exercise loading profiles and
 * injury-safe substitution pairs.
 *
 * HOW TO EXTEND
 * -------------
 * 1. New exercise: add an entry to EXERCISE_LOADS keyed by the canonical
 *    exercise id from src/data/exercise-catalog.js (see
 *    src/data/exercise-compat.js `resolveCanonicalId` for legacy ids).
 *    Fields:
 *      joints         — regions loaded by the movement
 *                       (wrist, elbow, shoulder, knee, hip, back, ankle, neck)
 *      grip           — 'heavy' (barbell rows, deadlifts, pull-ups),
 *                       'light' (machine/cable handles, light dumbbells),
 *                       'none'  (belt squat, leg press, bodyweight core)
 *      wristFlexion   — true if the movement loads the wrist in flexion
 *      wristExtension — true if the movement loads the wrist in extension
 *      note           — optional human-readable loading detail
 *    Exercises missing from this table are treated as UNKNOWN by
 *    src/systems/injury.js (no conflict is raised — the conservative
 *    choice is to flag nothing rather than guess).
 *
 * 2. New injury region: add the region name to INJURY_REGIONS, add a
 *    SUBSTITUTES[region] array, and teach `conflictsWithRegion` in
 *    src/systems/injury.js which EXERCISE_LOADS fields trip the conflict.
 *
 * 3. New substitution: push { insteadOf, use, note } onto the region's
 *    array. `insteadOf` may be a canonical exercise id or '*' (wildcard:
 *    applies to any exercise conflicting under that region that has no
 *    more specific entry). `use` must be a canonical exercise id that is
 *    itself safe for the region.
 *
 *    SAFETY AUDIT (Oct 2026): every `use` below was verified to NOT
 *    conflict with its own region per `conflictsWithRegion` in
 *    src/systems/injury.js. Where no genuinely safe substitute exists in
 *    the catalog (e.g. no pressing movement spares an injured shoulder),
 *    the entry is deliberately omitted — the caller then advises resting
 *    the movement instead of offering a false "safe" swap.
 *    `insteadOf` is a canonical catalog id, except the three competition
 *    main lifts ('squat', 'bench', 'deadlift') which are not catalog
 *    exercises but are checked by name via LIFTS in smart-workout.js and
 *    programs.js — their entries are intentional.
 *
 * SEVERITY ESCALATION (implemented in src/systems/injury.js, not here):
 * mild/moderate → substitute via this table; severe → the whole movement
 * pattern is rested and NO substitute is offered.
 */

export const INJURY_REGIONS = [
  'wrist',
  'elbow',
  'shoulder',
  'knee',
  'hip',
  'back',
  'ankle',
  'neck',
];

export const INJURY_SIDES = ['left', 'right', 'both'];

export const INJURY_SEVERITIES = ['mild', 'moderate', 'severe'];

export const REGION_LABELS = {
  wrist: 'Wrist',
  elbow: 'Elbow',
  shoulder: 'Shoulder',
  knee: 'Knee',
  hip: 'Hip',
  back: 'Back',
  ankle: 'Ankle',
  neck: 'Neck',
};

export const SIDE_LABELS = { left: 'Left', right: 'Right', both: 'Both' };

export const SEVERITY_LABELS = { mild: 'Mild', moderate: 'Moderate', severe: 'Severe' };

// ---------------------------------------------------------------------------
// Exercise loading profiles
// ---------------------------------------------------------------------------

export const EXERCISE_LOADS = {
  // ======================= Competition lifts =======================
  squat: {
    joints: ['knee', 'hip', 'back', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true, // low-bar shelf cocks the wrists back under load
    note: 'Low-bar squat extends the wrists under the bar',
  },
  bench: {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true, // bar stacks over the wrist in extension
    note: 'Bar loads the wrist in extension; heavy grip',
  },
  deadlift: {
    joints: ['back', 'hip', 'knee', 'ankle'],
    grip: 'heavy',
    wristFlexion: true, // grip force, mixed-grip supinated hand
    wristExtension: false,
    note: 'Maximal grip demand; mixed grip flexes one wrist',
  },

  // ======================= Squat pattern =======================
  'pause-squat': {
    joints: ['knee', 'hip', 'back', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true,
  },
  'front-squat': {
    joints: ['knee', 'hip', 'back', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
    note: 'Front rack drives the wrists into extension',
  },
  'leg-press': {
    joints: ['knee', 'hip', 'back'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
    note: 'Handles are unloaded — truly wrist-safe',
  },
  'leg-extension': {
    joints: ['knee'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
    note: 'Handles are unloaded',
  },
  'bulgarian-split-squat': {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'wall-sit': { joints: ['knee', 'hip'], grip: 'none', wristFlexion: false, wristExtension: false },
  'calf-raise': {
    joints: ['ankle', 'knee'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'box-squat': {
    joints: ['knee', 'hip', 'back', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true,
    note: 'Depth control helps knee/hip issues; wrists still extended',
  },
  'safety-bar-squat': {
    joints: ['knee', 'hip', 'back', 'ankle'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
    note: 'SSB yoke rides the shoulders — hands are free. Wrist-safe squat.',
  },
  'tempo-squat': {
    joints: ['knee', 'hip', 'back', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true,
  },
  'pin-squat': {
    joints: ['knee', 'hip', 'back', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true,
  },
  'zercher-squat': {
    joints: ['knee', 'hip', 'back', 'elbow'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Bar in the elbow crooks — wrists still load',
  },
  'overhead-squat': {
    joints: ['shoulder', 'knee', 'hip', 'back', 'wrist', 'ankle'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'goblet-squat': {
    joints: ['knee', 'hip', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'hack-squat': {
    joints: ['knee', 'hip'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
    note: 'Machine handles are unloaded',
  },
  'belt-squat': {
    joints: ['knee', 'hip'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
    note: 'Weight rides a hip belt — zero grip, zero spinal loading. Safest heavy leg loader for wrist/back injuries.',
  },
  'smith-machine-squat': {
    joints: ['knee', 'hip', 'back', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true,
  },
  'split-squat': {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'walking-lunge': {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  lunges: {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Forward dumbbell lunge — harder on the knee than reverse',
  },
  'reverse-lunge': {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Easier on the knee than forward lunges',
  },
  'step-up': {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'sissy-squat': { joints: ['knee'], grip: 'none', wristFlexion: false, wristExtension: false },
  'pistol-squat': {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'jump-squat': {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'bodyweight-squat': {
    joints: ['knee', 'hip', 'ankle'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'seated-calf-raise': {
    joints: ['ankle'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'standing-calf-raise': {
    joints: ['ankle', 'knee'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'hip-abduction': { joints: ['hip'], grip: 'none', wristFlexion: false, wristExtension: false },
  'hip-adduction': { joints: ['hip'], grip: 'none', wristFlexion: false, wristExtension: false },
  thruster: {
    joints: ['shoulder', 'elbow', 'wrist', 'knee', 'hip', 'back', 'ankle'],
    grip: 'heavy',
    wristFlexion: true, // front rack flexes the wrists under the bar
    wristExtension: true, // overhead lockout extends them
    note: 'Squat + press — the front rack and the lockout load the wrists in both directions',
  },

  // ======================= Hip hinge =======================
  'good-morning': {
    joints: ['back', 'hip', 'knee'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true,
  },
  'hip-thrust': {
    joints: ['hip', 'knee'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
    note: 'Upper back on bench, bar on hips — wrists unloaded',
  },
  'glute-bridge': {
    joints: ['hip', 'knee'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'sumo-deadlift': {
    joints: ['back', 'hip', 'knee', 'ankle'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'pause-deadlift': {
    joints: ['back', 'hip', 'knee', 'ankle'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'snatch-grip-deadlift': {
    joints: ['back', 'hip', 'knee', 'shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'rack-pull': {
    joints: ['back', 'hip', 'knee'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Reduced ROM spares the back vs full deadlift',
  },
  'block-pull': {
    joints: ['back', 'hip', 'knee'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Elevated bar — reduced ROM spares the back vs full deadlift',
  },
  'deficit-deadlift': {
    joints: ['back', 'hip', 'knee', 'ankle'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Extra ROM increases back and hip demand vs standard deadlift',
  },
  'trap-bar-deadlift': {
    joints: ['back', 'hip', 'knee', 'ankle'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Neutral handles — wrist-neutral but grip-heavy',
  },
  'stiff-leg-deadlift': {
    joints: ['back', 'hip', 'knee'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'dumbbell-rdl': {
    joints: ['back', 'hip', 'knee'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  rdl: {
    joints: ['back', 'hip', 'knee'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Barbell RDL — maximal grip demand like a deadlift',
  },
  'single-leg-rdl': {
    joints: ['back', 'hip', 'knee', 'ankle'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'back-extension': {
    joints: ['back', 'hip'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'reverse-hyper': {
    joints: ['back', 'hip'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
    note: 'Decompresses the spine — back-friendly hinge',
  },
  'glute-ham-raise': {
    joints: ['knee', 'hip', 'back'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'cable-pull-through': {
    joints: ['hip', 'back'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'kettlebell-swing': {
    joints: ['hip', 'back', 'shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Explosive grip loading',
  },
  'single-leg-hip-thrust': {
    joints: ['hip', 'knee'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'machine-hip-thrust': {
    joints: ['hip', 'knee'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
  },
  'cable-kickback': { joints: ['hip'], grip: 'none', wristFlexion: false, wristExtension: false },
  'power-clean': {
    joints: ['shoulder', 'wrist', 'elbow', 'hip', 'knee', 'back'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: true,
    note: 'Violent catch loads wrists in both directions',
  },
  'hang-clean': {
    joints: ['shoulder', 'wrist', 'elbow', 'hip', 'knee'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: true,
  },
  'clean-pull': {
    joints: ['back', 'hip', 'knee', 'shoulder'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'No catch — safer than a full clean',
  },
  'power-snatch': {
    joints: ['shoulder', 'wrist', 'elbow', 'hip', 'knee', 'back'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: true,
    note: 'Overhead catch is the harshest wrist load in the catalog',
  },

  // ======================= Horizontal push =======================
  'pause-bench': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'spoto-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'close-grip-bench': {
    joints: ['elbow', 'shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'incline-bench': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'dumbbell-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'chest-flies': {
    joints: ['shoulder', 'elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Wrists stay neutral with light dumbbells',
  },
  'tricep-extension': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'skull-crushers': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
    note: 'Heavy wrist extension under load — worst triceps move for wrists',
  },
  'jm-press': {
    joints: ['elbow', 'shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'floor-press': {
    joints: ['elbow', 'shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
    note: 'Limited ROM spares the shoulder vs full bench',
  },
  'board-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'larsen-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'wide-grip-bench': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'decline-bench': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'incline-dumbbell-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'dumbbell-floor-press': {
    joints: ['elbow', 'shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'machine-chest-press': {
    joints: ['shoulder', 'elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Fixed path, neutral handles — the wrist-safe horizontal press',
  },
  'smith-machine-bench': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'cable-crossover': {
    joints: ['shoulder', 'elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'pec-deck': {
    joints: ['shoulder', 'elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Forearms on pads — wrists unloaded',
  },
  'incline-dumbbell-fly': {
    joints: ['shoulder', 'elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'push-up': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: true,
    note: 'Bodyweight through extended wrists',
  },
  'diamond-push-up': {
    joints: ['elbow', 'shoulder', 'wrist'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: true,
  },
  'assisted-dip': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  dips: {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: true,
    note: 'Bodyweight through extended wrists on the bars',
  },
  'bench-dip': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: true,
  },
  'overhead-tricep-extension': {
    joints: ['elbow', 'shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'tricep-kickback': {
    joints: ['elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Light loads, neutral wrist',
  },

  // ======================= Vertical push =======================
  'overhead-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'lateral-raises': {
    joints: ['shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Light dumbbells, neutral wrists',
  },
  'push-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'push-jerk': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'dumbbell-shoulder-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'arnold-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: true,
    note: 'Rotation under load stresses the wrist',
  },
  'machine-shoulder-press': {
    joints: ['shoulder', 'elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Fixed path — the wrist-safe vertical press',
  },
  'landmine-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Angled pressing path is shoulder-friendly; wrist stays near-neutral',
  },
  'z-press': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'handstand-push-up': {
    joints: ['shoulder', 'elbow', 'wrist'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: true,
  },
  'cable-lateral-raise': {
    joints: ['shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'front-raise': {
    joints: ['shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },

  // ======================= Pull =======================
  'barbell-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'dumbbell-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Neutral wrist but heavy grip',
  },
  'pendlay-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  't-bar-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'cable-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'seated-cable-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'face-pull': {
    joints: ['shoulder', 'elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Rope handles, light load — wrist-friendly',
  },
  'rear-delt-flies': {
    joints: ['shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'barbell-shrugs': {
    joints: ['shoulder', 'neck', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'dumbbell-shrugs': {
    joints: ['shoulder', 'neck'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'wide-pullup': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'lat-pulldown': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Wrist-neutral but heavy grip',
  },
  'neutral-grip-pullup': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'assisted-pullup': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'close-grip-pulldown': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  pullup: {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Pronated bodyweight hang — heavy grip',
  },
  chinup: {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Supinated bodyweight hang — heavy grip',
  },
  'straight-arm-pulldown': {
    joints: ['back', 'shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Arms straight, light cable — wrist-safe back work',
  },
  'upright-row': {
    joints: ['shoulder', 'wrist', 'elbow'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Internal rotation + wrist flexion — harsh on both',
  },
  'chest-supported-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Wrist-neutral; spares the lower back vs bent rows',
  },
  'seal-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'meadows-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'landmine-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'machine-row': {
    joints: ['back', 'shoulder', 'elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
    note: 'Chest pad + neutral handles — light, wrist-safe rowing',
  },
  'inverted-row': {
    joints: ['back', 'shoulder', 'elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'reverse-pec-deck': {
    joints: ['shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'band-pull-apart': {
    joints: ['shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'trap-bar-shrug': {
    joints: ['shoulder', 'neck'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'dumbbell-curl': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'incline-dumbbell-curl': {
    joints: ['elbow', 'shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'cable-curl': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Constant tension; grip-heavy',
  },
  'ez-bar-curl': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'concentration-curl': {
    joints: ['elbow'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'reverse-curl': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
    note: 'Pronated grip extends the wrist under load',
  },
  'wrist-curl': {
    joints: ['wrist'],
    grip: 'light',
    wristFlexion: true,
    wristExtension: false,
    note: 'Direct wrist flexion loading — never with a wrist injury',
  },
  'reverse-wrist-curl': {
    joints: ['wrist'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true,
    note: 'Direct wrist extension loading — never with a wrist injury',
  },
  'barbell-curl': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },
  'hammer-curl': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Neutral wrist, still grip-heavy',
  },
  'preacher-curl': {
    joints: ['elbow', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
  },

  // ======================= Core / grip-carry =======================
  'ab-wheel': {
    joints: ['shoulder', 'wrist', 'back'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
    note: 'Full bodyweight through extended wrists',
  },
  'pallof-press': {
    joints: ['shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'hanging-leg-raise': {
    joints: ['shoulder', 'wrist', 'back'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'hanging-knee-raise': {
    joints: ['shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'toes-to-bar': {
    joints: ['shoulder', 'wrist', 'back', 'hip'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'cable-crunch': { joints: ['back'], grip: 'light', wristFlexion: false, wristExtension: false },
  crunch: { joints: ['back'], grip: 'none', wristFlexion: false, wristExtension: false },
  'machine-crunch': { joints: ['back'], grip: 'none', wristFlexion: false, wristExtension: false },
  'sit-up': { joints: ['back', 'hip'], grip: 'none', wristFlexion: false, wristExtension: false },
  'v-up': { joints: ['back', 'hip'], grip: 'none', wristFlexion: false, wristExtension: false },
  'russian-twist': { joints: ['back'], grip: 'light', wristFlexion: false, wristExtension: false },
  'landmine-twist': {
    joints: ['back', 'shoulder'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'side-plank': {
    joints: ['shoulder', 'wrist'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: true,
    note: 'Weight through an extended wrist — use forearm version with a wrist injury',
  },
  plank: {
    joints: ['shoulder', 'wrist'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: true,
    note: 'Straight-arm plank loads extended wrists — use forearm version with a wrist injury',
  },
  'hollow-hold': { joints: ['back'], grip: 'none', wristFlexion: false, wristExtension: false },
  'dead-bug': {
    joints: ['back', 'hip'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: false,
    note: 'Zero wrist/shoulder loading — the safe core swap',
  },
  'bird-dog': {
    joints: ['back', 'shoulder', 'wrist'],
    grip: 'none',
    wristFlexion: false,
    wristExtension: true,
    note: 'Quadruped position loads extended wrists',
  },
  'farmers-walk': {
    joints: ['wrist', 'shoulder', 'back'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
    note: 'Maximal sustained grip — incompatible with any wrist injury',
  },
  'dead-hang': {
    joints: ['shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'suitcase-carry': {
    joints: ['wrist', 'shoulder', 'back'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: false,
  },
  'overhead-carry': {
    joints: ['shoulder', 'wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: true,
  },
  'sled-push': {
    joints: ['shoulder', 'knee', 'hip'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: true,
    note: 'Hands drive through extended wrists',
  },
  'sled-drag': {
    joints: ['back', 'knee', 'hip'],
    grip: 'light',
    wristFlexion: false,
    wristExtension: false,
  },
  'plate-pinch': {
    joints: ['wrist'],
    grip: 'heavy',
    wristFlexion: false,
    wristExtension: false,
    note: 'Pure grip — incompatible with any wrist injury',
  },
  'wrist-roller': {
    joints: ['wrist', 'shoulder'],
    grip: 'heavy',
    wristFlexion: true,
    wristExtension: true,
    note: 'Direct wrist loading — never with a wrist injury',
  },
  'seated-ham-curl': { joints: ['knee'], grip: 'none', wristFlexion: false, wristExtension: false },
  'lying-ham-curl': { joints: ['knee'], grip: 'none', wristFlexion: false, wristExtension: false },
  'nordic-curl': { joints: ['knee'], grip: 'none', wristFlexion: false, wristExtension: false },
};

// ---------------------------------------------------------------------------
// Injury-safe substitution pairs
// ---------------------------------------------------------------------------
//
// region → [ { insteadOf, use, note } ]
// `insteadOf` is a canonical exercise id or '*' (wildcard: any exercise that
// conflicts under this region without a more specific entry).
// `use` is a canonical exercise id that is safe for the region.

export const SUBSTITUTES = {
  wrist: [
    {
      insteadOf: 'bench',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral — no loaded extension',
    },
    {
      insteadOf: 'pause-bench',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral — no loaded extension',
    },
    {
      insteadOf: 'spoto-press',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral — no loaded extension',
    },
    {
      insteadOf: 'close-grip-bench',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral — no loaded extension',
    },
    {
      insteadOf: 'incline-bench',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral — no loaded extension',
    },
    {
      insteadOf: 'dumbbell-press',
      use: 'machine-chest-press',
      note: 'Removes the heavy dumbbell grip from the equation',
    },
    {
      insteadOf: 'incline-dumbbell-press',
      use: 'machine-chest-press',
      note: 'Removes the heavy dumbbell grip from the equation',
    },
    {
      insteadOf: 'dumbbell-floor-press',
      use: 'machine-chest-press',
      note: 'Removes the heavy dumbbell grip from the equation',
    },
    {
      insteadOf: 'floor-press',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral',
    },
    {
      insteadOf: 'board-press',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral',
    },
    {
      insteadOf: 'larsen-press',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral',
    },
    {
      insteadOf: 'wide-grip-bench',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral',
    },
    {
      insteadOf: 'decline-bench',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral',
    },
    {
      insteadOf: 'smith-machine-bench',
      use: 'machine-chest-press',
      note: 'Fixed path keeps the wrists neutral',
    },
    {
      insteadOf: 'push-up',
      use: 'machine-chest-press',
      note: 'No bodyweight through extended wrists',
    },
    {
      insteadOf: 'diamond-push-up',
      use: 'machine-chest-press',
      note: 'No bodyweight through extended wrists',
    },
    {
      insteadOf: 'dips',
      use: 'machine-chest-press',
      note: 'No bodyweight through extended wrists on the bars',
    },
    {
      insteadOf: 'assisted-dip',
      use: 'machine-chest-press',
      note: 'Dips drive the wrists into extension under load',
    },
    {
      insteadOf: 'bench-dip',
      use: 'machine-chest-press',
      note: 'Dips drive the wrists into extension under load',
    },
    {
      insteadOf: 'handstand-push-up',
      use: 'machine-shoulder-press',
      note: 'Fixed path, neutral handles — no loaded wrist extension',
    },
    {
      insteadOf: 'overhead-press',
      use: 'machine-shoulder-press',
      note: 'Fixed path, neutral handles — no loaded wrist extension',
    },
    {
      insteadOf: 'dumbbell-shoulder-press',
      use: 'machine-shoulder-press',
      note: 'Fixed path, neutral handles',
    },
    { insteadOf: 'arnold-press', use: 'machine-shoulder-press', note: 'No rotation under load' },
    { insteadOf: 'push-press', use: 'machine-shoulder-press', note: 'No explosive wrist loading' },
    { insteadOf: 'push-jerk', use: 'machine-shoulder-press', note: 'No explosive wrist loading' },
    { insteadOf: 'z-press', use: 'machine-shoulder-press', note: 'Fixed path, neutral handles' },
    {
      insteadOf: 'landmine-press',
      use: 'machine-shoulder-press',
      note: 'Removes the thick-bar grip from the equation',
    },
    {
      insteadOf: 'deadlift',
      use: 'belt-squat',
      note: 'Weight rides the hips — zero grip, zero wrist load; the closest wrist-safe heavy loader',
    },
    {
      insteadOf: 'sumo-deadlift',
      use: 'belt-squat',
      note: 'Weight rides the hips — zero grip, zero wrist load',
    },
    {
      insteadOf: 'pause-deadlift',
      use: 'belt-squat',
      note: 'Weight rides the hips — zero grip, zero wrist load',
    },
    {
      insteadOf: 'deficit-deadlift',
      use: 'belt-squat',
      note: 'Weight rides the hips — zero grip, zero wrist load',
    },
    {
      insteadOf: 'snatch-grip-deadlift',
      use: 'belt-squat',
      note: 'Weight rides the hips — zero grip, zero wrist load',
    },
    {
      insteadOf: 'rack-pull',
      use: 'belt-squat',
      note: 'Weight rides the hips — zero grip, zero wrist load',
    },
    {
      insteadOf: 'block-pull',
      use: 'belt-squat',
      note: 'Weight rides the hips — zero grip, zero wrist load',
    },
    {
      insteadOf: 'trap-bar-deadlift',
      use: 'belt-squat',
      note: 'Neutral handles still demand heavy grip — belt squat removes it entirely',
    },
    {
      insteadOf: 'stiff-leg-deadlift',
      use: 'belt-squat',
      note: 'Weight rides the hips — zero grip, zero wrist load',
    },
    {
      insteadOf: 'rdl',
      use: 'cable-pull-through',
      note: 'Hinge pattern on a light rope handle — no heavy barbell grip',
    },
    {
      insteadOf: 'dumbbell-rdl',
      use: 'cable-pull-through',
      note: 'Hinge pattern on a light rope handle — no heavy dumbbell grip',
    },
    {
      insteadOf: 'barbell-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'pendlay-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 't-bar-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'dumbbell-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'cable-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'seated-cable-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'meadows-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'landmine-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'inverted-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'seal-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'chest-supported-row',
      use: 'machine-row',
      note: 'Chest pad + neutral handles — light, wrist-safe rowing',
    },
    {
      insteadOf: 'wide-pullup',
      use: 'straight-arm-pulldown',
      note: 'Light cable, arms straight — wrist-neutral vertical pull',
    },
    {
      insteadOf: 'pullup',
      use: 'straight-arm-pulldown',
      note: 'Light cable, arms straight — wrist-neutral vertical pull',
    },
    {
      insteadOf: 'chinup',
      use: 'straight-arm-pulldown',
      note: 'Light cable, arms straight — wrist-neutral vertical pull',
    },
    {
      insteadOf: 'neutral-grip-pullup',
      use: 'straight-arm-pulldown',
      note: 'Light cable, arms straight — wrist-neutral vertical pull',
    },
    {
      insteadOf: 'assisted-pullup',
      use: 'straight-arm-pulldown',
      note: 'Light cable, arms straight — wrist-neutral vertical pull',
    },
    {
      insteadOf: 'lat-pulldown',
      use: 'straight-arm-pulldown',
      note: 'Removes the heavy grip from the pull',
    },
    {
      insteadOf: 'close-grip-pulldown',
      use: 'straight-arm-pulldown',
      note: 'Removes the heavy grip from the pull',
    },
    {
      insteadOf: 'squat',
      use: 'safety-bar-squat',
      note: 'SSB yoke rides the shoulders — hands are free, wrists unloaded',
    },
    {
      insteadOf: 'pause-squat',
      use: 'safety-bar-squat',
      note: 'SSB yoke rides the shoulders — hands are free, wrists unloaded',
    },
    {
      insteadOf: 'tempo-squat',
      use: 'safety-bar-squat',
      note: 'SSB yoke rides the shoulders — hands are free, wrists unloaded',
    },
    {
      insteadOf: 'pin-squat',
      use: 'safety-bar-squat',
      note: 'SSB yoke rides the shoulders — hands are free, wrists unloaded',
    },
    {
      insteadOf: 'box-squat',
      use: 'safety-bar-squat',
      note: 'SSB yoke rides the shoulders — hands are free, wrists unloaded',
    },
    {
      insteadOf: 'smith-machine-squat',
      use: 'safety-bar-squat',
      note: 'SSB yoke rides the shoulders — hands are free, wrists unloaded',
    },
    {
      insteadOf: 'zercher-squat',
      use: 'safety-bar-squat',
      note: 'No bar in the elbow crooks, no wrist loading',
    },
    {
      insteadOf: 'overhead-squat',
      use: 'safety-bar-squat',
      note: 'No overhead wrist extension under load',
    },
    {
      insteadOf: 'goblet-squat',
      use: 'safety-bar-squat',
      note: 'No loaded wrist extension holding the bell',
    },
    {
      insteadOf: 'thruster',
      use: 'safety-bar-squat',
      note: 'Keeps the heavy squat stimulus — hands are free, wrists unloaded',
    },
    { insteadOf: 'front-squat', use: 'safety-bar-squat', note: 'No front-rack wrist extension' },
    { insteadOf: 'good-morning', use: 'safety-bar-squat', note: 'No front-rack wrist extension' },
    { insteadOf: 'ab-wheel', use: 'dead-bug', note: 'Zero wrist or shoulder loading' },
    { insteadOf: 'plank', use: 'dead-bug', note: 'Zero wrist or shoulder loading' },
    { insteadOf: 'side-plank', use: 'dead-bug', note: 'Zero wrist or shoulder loading' },
    { insteadOf: 'bird-dog', use: 'dead-bug', note: 'Zero wrist or shoulder loading' },
    { insteadOf: 'hanging-leg-raise', use: 'cable-crunch', note: 'No hanging grip required' },
    { insteadOf: 'hanging-knee-raise', use: 'cable-crunch', note: 'No hanging grip required' },
    { insteadOf: 'toes-to-bar', use: 'cable-crunch', note: 'No hanging grip required' },
    {
      insteadOf: 'sled-push',
      use: 'sled-drag',
      note: 'Pull instead of push — no driving through extended wrists',
    },
    {
      insteadOf: 'skull-crushers',
      use: 'tricep-kickback',
      note: 'Light loads, neutral wrist — only if completely pain-free',
    },
    {
      insteadOf: 'tricep-extension',
      use: 'tricep-kickback',
      note: 'Light loads, neutral wrist — only if completely pain-free',
    },
    {
      insteadOf: 'overhead-tricep-extension',
      use: 'tricep-kickback',
      note: 'Light loads, neutral wrist — only if completely pain-free',
    },
    {
      insteadOf: 'jm-press',
      use: 'tricep-kickback',
      note: 'Light loads, neutral wrist — only if completely pain-free',
    },
    {
      insteadOf: 'barbell-curl',
      use: 'concentration-curl',
      note: 'Light and braced — the wrist-safe curl',
    },
    {
      insteadOf: 'dumbbell-curl',
      use: 'concentration-curl',
      note: 'Light and braced — the wrist-safe curl',
    },
    {
      insteadOf: 'cable-curl',
      use: 'concentration-curl',
      note: 'Light and braced — the wrist-safe curl',
    },
    {
      insteadOf: 'ez-bar-curl',
      use: 'concentration-curl',
      note: 'Light and braced — the wrist-safe curl',
    },
    {
      insteadOf: 'hammer-curl',
      use: 'concentration-curl',
      note: 'Light and braced — the wrist-safe curl',
    },
    {
      insteadOf: 'preacher-curl',
      use: 'concentration-curl',
      note: 'Light and braced — the wrist-safe curl',
    },
    {
      insteadOf: 'incline-dumbbell-curl',
      use: 'concentration-curl',
      note: 'Light and braced — the wrist-safe curl',
    },
    {
      insteadOf: 'reverse-curl',
      use: 'concentration-curl',
      note: 'Light and braced — the wrist-safe curl',
    },
    {
      insteadOf: 'upright-row',
      use: 'cable-lateral-raise',
      note: 'Light cable, no wrist flexion under load',
    },
  ],
  shoulder: [
    // No pressing or pulling movement spares an injured shoulder — every
    // press, pull, raise, and carry loads the glenohumeral joint, so those
    // patterns rest. The safe swaps below are core work that avoids the
    // shoulder entirely.
    { insteadOf: 'ab-wheel', use: 'dead-bug', note: 'Zero shoulder loading — the safe core swap' },
    {
      insteadOf: 'pallof-press',
      use: 'dead-bug',
      note: 'Zero shoulder loading — the safe core swap',
    },
    {
      insteadOf: 'hanging-leg-raise',
      use: 'cable-crunch',
      note: 'No hanging from the injured shoulder',
    },
    {
      insteadOf: 'hanging-knee-raise',
      use: 'cable-crunch',
      note: 'No hanging from the injured shoulder',
    },
    { insteadOf: 'toes-to-bar', use: 'cable-crunch', note: 'No hanging from the injured shoulder' },
    { insteadOf: 'plank', use: 'dead-bug', note: 'Zero wrist or shoulder loading' },
    { insteadOf: 'side-plank', use: 'dead-bug', note: 'Zero wrist or shoulder loading' },
    { insteadOf: 'bird-dog', use: 'dead-bug', note: 'Zero wrist or shoulder loading' },
  ],
  elbow: [
    // Every arm exercise loads the elbow — there is no safe same-pattern
    // swap for curls, presses, or rows, so those patterns rest. The one
    // honest exception is the lateral raise, which isolates the shoulder
    // with a straight arm and spares the elbow.
    {
      insteadOf: 'upright-row',
      use: 'cable-lateral-raise',
      note: 'Straight-arm lateral work — no bent-arm pulling under load',
    },
  ],
  knee: [
    // Nearly all leg training loads the knee. The honest swap for a knee
    // injury is a pattern change: knee-dominant work becomes hip-dominant
    // work (zero knee loading) until the knee heals.
    {
      insteadOf: 'squat',
      use: 'cable-pull-through',
      note: 'Pattern swap: knee-dominant squat → hip-dominant hinge, zero knee loading',
    },
    {
      insteadOf: 'pause-squat',
      use: 'cable-pull-through',
      note: 'Pattern swap: knee-dominant squat → hip-dominant hinge, zero knee loading',
    },
    {
      insteadOf: 'front-squat',
      use: 'cable-pull-through',
      note: 'Pattern swap: knee-dominant squat → hip-dominant hinge, zero knee loading',
    },
    {
      insteadOf: 'box-squat',
      use: 'cable-pull-through',
      note: 'Pattern swap: knee-dominant squat → hip-dominant hinge, zero knee loading',
    },
    {
      insteadOf: 'deadlift',
      use: 'cable-pull-through',
      note: 'Lighter hinge with zero knee loading',
    },
    {
      insteadOf: 'sumo-deadlift',
      use: 'cable-pull-through',
      note: 'Lighter hinge with zero knee loading',
    },
    {
      insteadOf: 'trap-bar-deadlift',
      use: 'cable-pull-through',
      note: 'Lighter hinge with zero knee loading',
    },
    {
      insteadOf: 'rdl',
      use: 'cable-pull-through',
      note: 'Same hip-hinge pattern, zero knee loading',
    },
    {
      insteadOf: 'dumbbell-rdl',
      use: 'cable-pull-through',
      note: 'Same hip-hinge pattern, zero knee loading',
    },
    {
      insteadOf: 'single-leg-rdl',
      use: 'cable-pull-through',
      note: 'Same hip-hinge pattern, zero knee loading',
    },
    {
      insteadOf: 'good-morning',
      use: 'cable-pull-through',
      note: 'Hip-dominant hinge with zero knee loading',
    },
    {
      insteadOf: 'leg-press',
      use: 'cable-pull-through',
      note: 'Pattern swap: knee-dominant press → hip-dominant hinge, zero knee loading',
    },
  ],
  hip: [
    {
      insteadOf: 'squat',
      use: 'leg-extension',
      note: 'Isolated quad work — zero hip flexion demand',
    },
    {
      insteadOf: 'pause-squat',
      use: 'leg-extension',
      note: 'Isolated quad work — zero hip flexion demand',
    },
    {
      insteadOf: 'front-squat',
      use: 'leg-extension',
      note: 'Isolated quad work — zero hip flexion demand',
    },
    {
      insteadOf: 'leg-press',
      use: 'leg-extension',
      note: 'Isolated quad work — zero hip flexion demand',
    },
    {
      insteadOf: 'hack-squat',
      use: 'leg-extension',
      note: 'Isolated quad work — zero hip flexion demand',
    },
    {
      insteadOf: 'stiff-leg-deadlift',
      use: 'seated-ham-curl',
      note: 'Hamstrings with zero hip demand',
    },
    { insteadOf: 'rdl', use: 'seated-ham-curl', note: 'Hamstrings with zero hip demand' },
    { insteadOf: 'dumbbell-rdl', use: 'seated-ham-curl', note: 'Hamstrings with zero hip demand' },
    {
      insteadOf: 'single-leg-rdl',
      use: 'seated-ham-curl',
      note: 'Hamstrings with zero hip demand',
    },
    {
      insteadOf: 'glute-ham-raise',
      use: 'seated-ham-curl',
      note: 'Hamstrings with zero hip demand',
    },
  ],
  back: [
    {
      insteadOf: 'deadlift',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'sumo-deadlift',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'deficit-deadlift',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'snatch-grip-deadlift',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'pause-deadlift',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'rack-pull',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'block-pull',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'trap-bar-deadlift',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'zercher-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'overhead-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'smith-machine-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'box-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'pause-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'tempo-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'pin-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'stiff-leg-deadlift',
      use: 'seated-ham-curl',
      note: 'Hamstrings with zero spinal loading',
    },
    { insteadOf: 'rdl', use: 'seated-ham-curl', note: 'Hamstrings with zero spinal loading' },
    {
      insteadOf: 'dumbbell-rdl',
      use: 'seated-ham-curl',
      note: 'Hamstrings with zero spinal loading',
    },
    {
      insteadOf: 'single-leg-rdl',
      use: 'seated-ham-curl',
      note: 'Hamstrings with zero spinal loading',
    },
    {
      insteadOf: 'glute-ham-raise',
      use: 'seated-ham-curl',
      note: 'Hamstrings with zero spinal loading',
    },
    {
      insteadOf: 'good-morning',
      use: 'glute-bridge',
      note: 'Floor-based hip work — zero spinal loading',
    },
    {
      insteadOf: 'back-extension',
      use: 'glute-bridge',
      note: 'Floor-based hip work — zero spinal loading',
    },
    {
      insteadOf: 'squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'front-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'safety-bar-squat',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'thruster',
      use: 'belt-squat',
      note: 'Zero axial spinal loading — weight rides the hips',
    },
    {
      insteadOf: 'overhead-press',
      use: 'machine-shoulder-press',
      note: 'Seated, supported — no spinal compression from standing pressing',
    },
  ],
  ankle: [
    {
      insteadOf: 'squat',
      use: 'hack-squat',
      note: 'Machine-guided, feet flat on the platform — minimal ankle dorsiflexion demand',
    },
    {
      insteadOf: 'front-squat',
      use: 'hack-squat',
      note: 'Machine-guided, feet flat on the platform — minimal ankle dorsiflexion demand',
    },
    {
      insteadOf: 'box-squat',
      use: 'hack-squat',
      note: 'Machine-guided, feet flat on the platform — minimal ankle dorsiflexion demand',
    },
    {
      insteadOf: 'smith-machine-squat',
      use: 'hack-squat',
      note: 'Machine-guided, feet flat on the platform — minimal ankle dorsiflexion demand',
    },
    {
      insteadOf: 'pause-squat',
      use: 'hack-squat',
      note: 'Machine-guided, feet flat on the platform — minimal ankle dorsiflexion demand',
    },
    { insteadOf: 'deadlift', use: 'rack-pull', note: 'Reduced ROM, less ankle demand under load' },
    {
      insteadOf: 'sumo-deadlift',
      use: 'rack-pull',
      note: 'Reduced ROM, less ankle demand under load',
    },
    {
      insteadOf: 'deficit-deadlift',
      use: 'rack-pull',
      note: 'Reduced ROM, less ankle demand under load',
    },
    {
      insteadOf: 'trap-bar-deadlift',
      use: 'rack-pull',
      note: 'Reduced ROM, less ankle demand under load',
    },
  ],
  neck: [
    {
      insteadOf: 'upright-row',
      use: 'cable-lateral-raise',
      note: 'Light lateral work without the neck shrug pattern',
    },
    { insteadOf: 'back-extension', use: 'bird-dog', note: 'No loaded neck extension' },
    { insteadOf: 'overhead-carry', use: 'suitcase-carry', note: 'Load at the side, not overhead' },
  ],
};
