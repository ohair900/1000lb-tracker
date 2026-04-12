/**
 * Accessory rep-scheme rotation constants.
 *
 * Each rotation-eligible exercise auto-cycles through three tiers:
 * heavy → moderate → light → heavy. The tier is determined by the
 * exercise's last session in accessoryLog. Weight is auto-calculated
 * from last performance via Epley e1RM estimation.
 *
 * Excluded exercises always use their catalog default rep range (typically
 * isolation or time-based movements where heavy loading is unsafe or
 * pointless).
 */

export const REP_TIERS = {
  heavy:    { repRange: [4, 6],   sets: 4, label: 'Heavy' },
  moderate: { repRange: [8, 12],  sets: 3, label: 'Moderate' },
  light:    { repRange: [12, 20], sets: 3, label: 'Light' },
};

export const ROTATION_EXCLUDED = new Set([
  'lateral-raises',   // shoulder safety at heavy loads
  'ab-wheel',         // core — rep-based
  'pallof-press',     // core stability, not strength
  'plank',            // time-based
  'wall-sit',         // time-based
  'rear-delt-flies',  // isolation, light only
  'dead-hang',        // time-based
]);
