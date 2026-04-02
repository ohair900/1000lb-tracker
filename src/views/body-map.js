/**
 * SVG Body Map — side-by-side front/back muscle fatigue visualization.
 *
 * Solid anatomical figure with neon glow overlays.
 * Dark filled body with muscle separation lines.
 * Status colors glow like a heat map on active muscles.
 */

const BASE_FILL = 'rgba(255,255,255,0.08)';
const BOUNDARY_STROKE = 'rgba(255,255,255,0.12)';

const STATUS_STYLES = {
  green:  { fill: 'rgba(76,175,80,0.5)',  glow: 'rgba(76,175,80,0.6)',  blur: 4 },
  yellow: { fill: 'rgba(255,193,7,0.5)',  glow: 'rgba(255,193,7,0.6)',  blur: 5 },
  red:    { fill: 'rgba(244,67,54,0.55)', glow: 'rgba(244,67,54,0.7)', blur: 6 },
  none:   { fill: BASE_FILL,             glow: 'none',                 blur: 0 },
};

// ---------------------------------------------------------------------------
// SVG muscle paths — designed to tile the body (no gaps)
// ---------------------------------------------------------------------------

const FRONT_MUSCLES = {
  Shoulders: [
    // Left delt
    'M 30,52 Q 22,54 20,62 Q 22,70 28,72 L 36,68 Q 38,60 36,54 Z',
    // Right delt
    'M 70,52 Q 78,54 80,62 Q 78,70 72,72 L 64,68 Q 62,60 64,54 Z',
  ],
  Chest: [
    // Left pec
    'M 36,56 L 36,68 L 28,72 Q 30,80 36,82 L 48,82 Q 50,76 50,68 L 50,56 Z',
    // Right pec
    'M 64,56 L 64,68 L 72,72 Q 70,80 64,82 L 52,82 Q 50,76 50,68 L 50,56 Z',
  ],
  Triceps: [
    // Left arm
    'M 20,62 Q 16,72 14,84 Q 14,92 16,98 L 24,98 Q 26,92 28,84 Q 28,74 28,72 L 20,62 Z',
    // Right arm
    'M 80,62 Q 84,72 86,84 Q 86,92 84,98 L 76,98 Q 74,92 72,84 Q 72,74 72,72 L 80,62 Z',
  ],
  Core: [
    // Abs
    'M 38,82 Q 36,90 36,100 Q 36,108 38,114 L 62,114 Q 64,108 64,100 Q 64,90 62,82 Z',
  ],
  Quads: [
    // Left quad
    'M 36,116 Q 32,130 30,146 Q 30,158 32,166 L 46,166 Q 48,158 48,146 Q 48,130 46,116 Z',
    // Right quad
    'M 54,116 Q 52,130 52,146 Q 52,158 54,166 L 68,166 Q 70,158 70,146 Q 70,130 64,116 Z',
  ],
};

const BACK_MUSCLES = {
  Back: [
    // Left lat + upper back
    'M 36,54 Q 30,62 28,72 Q 28,84 30,96 L 36,100 Q 40,90 42,78 L 48,78 L 48,54 Z',
    // Right lat + upper back
    'M 64,54 Q 70,62 72,72 Q 72,84 70,96 L 64,100 Q 60,90 58,78 L 52,78 L 52,54 Z',
    // Spine / mid-back
    'M 48,54 L 48,78 L 42,78 Q 40,90 36,100 L 38,108 Q 44,110 50,110 Q 56,110 62,108 L 64,100 Q 60,90 58,78 L 52,78 L 52,54 Z',
  ],
  Glutes: [
    // Left glute
    'M 36,110 Q 30,116 28,124 Q 30,132 36,134 L 48,132 Q 50,124 48,116 Q 46,110 42,108 Z',
    // Right glute
    'M 64,110 Q 70,116 72,124 Q 70,132 64,134 L 52,132 Q 50,124 52,116 Q 54,110 58,108 Z',
  ],
  Hams: [
    // Left hamstring
    'M 30,136 Q 28,148 28,160 Q 28,168 30,174 L 46,174 Q 48,168 48,160 Q 48,148 46,136 Z',
    // Right hamstring
    'M 54,136 Q 52,148 52,160 Q 52,168 54,174 L 70,174 Q 72,168 72,160 Q 72,148 68,136 Z',
  ],
};

// Head path (non-interactive, just for the silhouette)
const HEAD_PATH = 'M 50,8 Q 42,8 38,14 Q 34,20 34,28 Q 34,36 38,40 Q 42,44 50,44 Q 58,44 62,40 Q 66,36 66,28 Q 66,20 62,14 Q 58,8 50,8 Z';
// Neck
const NECK_PATH = 'M 44,44 L 44,54 L 56,54 L 56,44 Z';
// Lower legs (non-interactive)
const LOWER_LEGS_FRONT = [
  'M 32,168 Q 30,178 30,188 Q 30,194 32,198 L 46,198 Q 48,194 48,188 Q 48,178 46,168 Z',
  'M 54,168 Q 52,178 52,188 Q 52,194 54,198 L 68,198 Q 70,194 70,188 Q 70,178 68,168 Z',
];
const LOWER_LEGS_BACK = LOWER_LEGS_FRONT;
// Forearms (non-interactive)
const FOREARMS = [
  'M 14,100 Q 12,108 12,116 L 18,118 Q 22,110 24,100 Z',
  'M 86,100 Q 88,108 88,116 L 82,118 Q 78,110 76,100 Z',
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function buildGlowFilter(id, blur) {
  if (blur <= 0) return '';
  return `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="blur"/>` +
    `<feComposite in="SourceGraphic" in2="blur" operator="over"/>` +
    `</filter>`;
}

function renderMuscleGroup(mg, paths, status) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.none;
  const filterId = `glow-${mg.toLowerCase().replace(/\s/g, '')}`;
  const hasGlow = style.blur > 0;

  let svg = '';
  if (hasGlow) svg += buildGlowFilter(filterId, style.blur);

  const filterAttr = hasGlow ? ` filter="url(#${filterId})"` : '';
  svg += `<g class="body-map-muscle" data-muscle="${mg}"${filterAttr}>`;
  paths.forEach(d => {
    svg += `<path d="${d}" fill="${style.fill}" stroke="${BOUNDARY_STROKE}" stroke-width="0.5"/>`;
  });
  svg += `</g>`;
  return svg;
}

function renderNonInteractive(paths) {
  return paths.map(d =>
    `<path d="${d}" fill="${BASE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.4"/>`
  ).join('');
}

function buildFigureSVG(muscles, label, fatigueByMuscle) {
  const getStatus = mg => fatigueByMuscle && fatigueByMuscle[mg] ? fatigueByMuscle[mg].status : 'none';

  let defs = '';
  let body = '';

  // Head + neck (non-interactive)
  body += `<path d="${HEAD_PATH}" fill="${BASE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.4"/>`;
  body += `<path d="${NECK_PATH}" fill="${BASE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.3"/>`;

  // Muscle groups
  Object.entries(muscles).forEach(([mg, paths]) => {
    body += renderMuscleGroup(mg, paths, getStatus(mg));
  });

  // Lower legs + forearms (non-interactive)
  const legs = label === 'FRONT' ? LOWER_LEGS_FRONT : LOWER_LEGS_BACK;
  body += renderNonInteractive(legs);
  body += renderNonInteractive(FOREARMS);

  return `<div class="body-map-figure">` +
    `<svg viewBox="8 2 84 202" xmlns="http://www.w3.org/2000/svg" class="body-map-svg">` +
    `<defs>${defs}</defs>` +
    body +
    `</svg>` +
    `<div class="body-map-view-label">${label}</div>` +
    `</div>`;
}

/**
 * Render the body map with front and back side by side.
 * @param {Object|null} fatigueByMuscle - Map of muscle group → { status }
 * @returns {string} HTML string
 */
export function renderBodyMap(fatigueByMuscle) {
  return `<div class="body-map-container">` +
    buildFigureSVG(FRONT_MUSCLES, 'FRONT', fatigueByMuscle) +
    buildFigureSVG(BACK_MUSCLES, 'BACK', fatigueByMuscle) +
    `</div>`;
}

/**
 * Attach click listeners to muscle regions.
 * @param {HTMLElement} container
 * @param {Function} onMuscleClick - Called with muscle group name
 */
export function initBodyMapEvents(container, onMuscleClick) {
  container.querySelectorAll('.body-map-muscle').forEach(g => {
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      const muscle = g.dataset.muscle;
      if (muscle && onMuscleClick) onMuscleClick(muscle);
    });
  });
}
