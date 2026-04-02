/**
 * SVG Body Map — side-by-side front/back muscle fatigue visualization.
 *
 * Solid anatomical figure with neon glow overlays.
 * 10 muscle groups with gradient fills, layered glow, muscle texture,
 * and complete silhouette (hands, feet, hip connectors).
 */

const BASE_FILL = 'rgba(255,255,255,0.07)';
const INACTIVE_FILL = 'rgba(255,255,255,0.04)';
const BOUNDARY_STROKE = 'rgba(255,255,255,0.12)';
const TEXTURE_STROKE = 'rgba(255,255,255,0.06)';

const STATUS_COLORS = {
  green:  { r: 76,  g: 175, b: 80,  a: 0.55, glowA: 0.35, blur: 3, outerBlur: 6 },
  yellow: { r: 255, g: 193, b: 7,   a: 0.55, glowA: 0.30, blur: 3, outerBlur: 7 },
  red:    { r: 244, g: 67,  b: 54,  a: 0.60, glowA: 0.40, blur: 4, outerBlur: 8 },
};

// ---------------------------------------------------------------------------
// Improved anatomical SVG paths — smoother curves, better proportions
// ViewBox: 0 0 100 210
// ---------------------------------------------------------------------------

const FRONT_MUSCLES = {
  Shoulders: [
    // Left delt — rounded cap
    'M 28,55 C 20,55 16,60 16,66 C 16,72 20,76 26,76 L 32,72 C 34,66 34,60 32,55 Z',
    // Right delt
    'M 72,55 C 80,55 84,60 84,66 C 84,72 80,76 74,76 L 68,72 C 66,66 66,60 68,55 Z',
  ],
  Chest: [
    // Left pec — curved, natural shape
    'M 32,58 L 32,72 L 26,76 C 28,82 34,86 42,86 L 48,86 C 50,82 50,74 50,64 L 50,58 Z',
    // Right pec
    'M 68,58 L 68,72 L 74,76 C 72,82 66,86 58,86 L 52,86 C 50,82 50,74 50,64 L 50,58 Z',
  ],
  Biceps: [
    // Left inner arm
    'M 26,76 C 24,82 22,90 22,96 L 28,96 C 30,90 32,82 32,76 Z',
    // Right inner arm
    'M 74,76 C 76,82 78,90 78,96 L 72,96 C 70,90 68,82 68,76 Z',
  ],
  Triceps: [
    // Left outer arm
    'M 16,66 C 14,74 12,84 12,92 L 12,96 L 22,96 C 22,90 24,82 26,76 L 20,76 C 18,72 16,68 16,66 Z',
    // Right outer arm
    'M 84,66 C 86,74 88,84 88,92 L 88,96 L 78,96 C 78,90 76,82 74,76 L 80,76 C 82,72 84,68 84,66 Z',
  ],
  Core: [
    // Abs — tapered
    'M 36,86 C 34,94 34,104 34,110 L 34,118 L 66,118 L 66,110 C 66,104 66,94 64,86 Z',
  ],
  Quads: [
    // Left quad — tapered, natural
    'M 32,120 C 28,132 26,148 26,160 C 26,166 28,172 30,176 L 46,176 C 48,172 48,166 48,160 C 48,148 48,132 46,120 Z',
    // Right quad
    'M 54,120 C 52,132 52,148 52,160 C 52,166 52,172 54,176 L 70,176 C 72,172 74,166 74,160 C 74,148 72,132 68,120 Z',
  ],
};

const BACK_MUSCLES = {
  'Upper Back': [
    // Left upper back — traps, rhomboids
    'M 32,58 C 28,62 26,68 26,74 L 30,80 L 38,78 L 48,78 L 48,58 Z',
    // Right upper back
    'M 68,58 C 72,62 74,68 74,74 L 70,80 L 62,78 L 52,78 L 52,58 Z',
    // Mid upper (between scapulae)
    'M 48,58 L 48,78 L 38,78 L 38,80 C 42,82 46,82 50,82 C 54,82 58,82 62,80 L 62,78 L 52,78 L 52,58 Z',
  ],
  'Lower Back': [
    // Erectors / lumbar
    'M 38,82 C 36,90 34,100 34,108 L 34,118 L 66,118 L 66,108 C 66,100 64,90 62,82 C 58,84 54,84 50,84 C 46,84 42,84 38,82 Z',
  ],
  Glutes: [
    // Left glute — rounder
    'M 32,120 C 26,124 24,130 24,136 C 26,142 32,144 40,142 L 48,140 C 50,134 48,126 46,120 Z',
    // Right glute
    'M 68,120 C 74,124 76,130 76,136 C 74,142 68,144 60,142 L 52,140 C 50,134 52,126 54,120 Z',
  ],
  Hams: [
    // Left ham
    'M 26,144 C 24,154 24,164 24,172 C 24,176 26,180 30,182 L 46,182 C 48,178 48,174 48,168 C 48,158 48,148 46,142 L 40,142 C 34,144 28,144 26,144 Z',
    // Right ham
    'M 74,144 C 76,154 76,164 76,172 C 76,176 74,180 70,182 L 54,182 C 52,178 52,174 52,168 C 52,158 52,148 54,142 L 60,142 C 66,144 72,144 74,144 Z',
  ],
};

// Non-interactive body parts
const HEAD = 'M 50,6 C 42,6 36,12 36,22 C 36,32 42,40 50,40 C 58,40 64,32 64,22 C 64,12 58,6 50,6 Z';
const NECK = 'M 42,40 C 42,46 44,52 46,54 L 54,54 C 56,52 58,46 58,40';

// Hip connectors (front + back)
const HIP_FRONT = [
  'M 34,118 L 32,120 L 46,120 L 48,118 Z',
  'M 52,118 L 54,120 L 68,120 L 66,118 Z',
];
const HIP_BACK = HIP_FRONT;

// Forearms
const FOREARMS_FRONT = [
  'M 10,98 C 8,106 8,114 10,120 L 16,120 C 18,114 20,106 22,98 Z',
  'M 90,98 C 92,106 92,114 90,120 L 84,120 C 82,114 80,106 78,98 Z',
];
const FOREARMS_BACK = FOREARMS_FRONT;

// Hands
const HANDS = [
  'M 10,120 C 8,124 8,128 10,130 L 16,130 C 18,128 18,124 16,120 Z',
  'M 90,120 C 92,124 92,128 90,130 L 84,130 C 82,128 82,124 84,120 Z',
];

// Lower legs
const LOWER_LEGS = [
  'M 28,178 C 26,186 24,194 26,200 L 44,200 C 46,194 46,186 44,178 Z',
  'M 56,178 C 54,186 54,194 56,200 L 74,200 C 76,194 76,186 72,178 Z',
];

// Feet
const FEET = [
  'M 24,200 C 22,202 22,204 24,206 L 46,206 C 48,204 48,202 46,200 Z',
  'M 54,200 C 52,202 52,204 54,206 L 76,206 C 78,204 78,202 76,200 Z',
];

// Ab texture lines (within Core)
const AB_LINES = [
  'M 40,92 L 60,92',
  'M 39,100 L 61,100',
  'M 38,108 L 62,108',
];

// ---------------------------------------------------------------------------
// SVG rendering helpers
// ---------------------------------------------------------------------------

function statusGradientId(mg, view) {
  return `grad-${view}-${mg.replace(/\s/g, '')}`;
}

function buildDefs(muscles, view, fatigueByMuscle) {
  let defs = '';

  // Glow filters per status
  ['green', 'yellow', 'red'].forEach(status => {
    const c = STATUS_COLORS[status];
    const id = `glow-${view}-${status}`;
    defs += `<filter id="${id}" x="-80%" y="-80%" width="260%" height="260%">` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${c.blur}" result="innerBlur"/>` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${c.outerBlur}" result="outerBlur"/>` +
      `<feFlood flood-color="rgba(${c.r},${c.g},${c.b},${c.glowA})" result="glowColor"/>` +
      `<feComposite in="glowColor" in2="outerBlur" operator="in" result="halo"/>` +
      `<feMerge><feMergeNode in="halo"/><feMergeNode in="innerBlur"/></feMerge>` +
      `</filter>`;
  });

  // Radial gradients per muscle group
  Object.keys(muscles).forEach(mg => {
    const status = fatigueByMuscle && fatigueByMuscle[mg] ? fatigueByMuscle[mg].status : null;
    const gId = statusGradientId(mg, view);
    if (status && STATUS_COLORS[status]) {
      const c = STATUS_COLORS[status];
      defs += `<radialGradient id="${gId}" cx="50%" cy="40%" r="70%">` +
        `<stop offset="0%" stop-color="rgba(${c.r},${c.g},${c.b},${c.a + 0.15})"/>` +
        `<stop offset="70%" stop-color="rgba(${c.r},${c.g},${c.b},${c.a})"/>` +
        `<stop offset="100%" stop-color="rgba(${c.r},${c.g},${c.b},${c.a * 0.5})"/>` +
        `</radialGradient>`;
    } else {
      defs += `<radialGradient id="${gId}" cx="50%" cy="40%" r="70%">` +
        `<stop offset="0%" stop-color="rgba(255,255,255,0.09)"/>` +
        `<stop offset="100%" stop-color="rgba(255,255,255,0.05)"/>` +
        `</radialGradient>`;
    }
  });

  return defs;
}

function renderMuscle(mg, paths, view, fatigueByMuscle) {
  const status = fatigueByMuscle && fatigueByMuscle[mg] ? fatigueByMuscle[mg].status : null;
  const gId = statusGradientId(mg, view);
  const filterAttr = status && STATUS_COLORS[status]
    ? ` filter="url(#glow-${view}-${status})"`
    : '';

  let svg = `<g class="body-map-muscle" data-muscle="${mg}"${filterAttr}>`;
  paths.forEach(d => {
    svg += `<path d="${d}" fill="url(#${gId})" stroke="${BOUNDARY_STROKE}" stroke-width="0.6"/>`;
  });
  svg += `</g>`;
  return svg;
}

function renderInactive(paths) {
  return paths.map(d =>
    `<path d="${d}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.3"/>`
  ).join('');
}

function renderTexture(lines) {
  return lines.map(d =>
    `<line x1="${d.split(/[ML,\s]+/).filter(Boolean)[1]}" y1="${d.split(/[ML,\s]+/).filter(Boolean)[2]}" ` +
    `x2="${d.split(/[ML,\s]+/).filter(Boolean)[4]}" y2="${d.split(/[ML,\s]+/).filter(Boolean)[5]}" ` +
    `stroke="${TEXTURE_STROKE}" stroke-width="0.4"/>`
  ).join('');
}

function buildFigure(muscles, label, fatigueByMuscle) {
  const view = label.toLowerCase();
  const defs = buildDefs(muscles, view, fatigueByMuscle);
  let body = '';

  // Head + neck
  body += `<path d="${HEAD}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.3"/>`;
  body += `<path d="${NECK}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.2" fill="none"/>`;

  // Muscles
  Object.entries(muscles).forEach(([mg, paths]) => {
    body += renderMuscle(mg, paths, view, fatigueByMuscle);
  });

  // Ab texture lines (front only, within Core)
  if (label === 'FRONT') {
    body += AB_LINES.map(d => {
      const parts = d.replace(/[ML]/g, '').trim().split(/\s+/);
      const [x1, y1] = parts[0].split(',');
      const [x2, y2] = parts[1].split(',');
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${TEXTURE_STROKE}" stroke-width="0.5"/>`;
    }).join('');
  }

  // Hip connectors
  const hips = label === 'FRONT' ? HIP_FRONT : HIP_BACK;
  body += renderInactive(hips);

  // Forearms
  const forearms = label === 'FRONT' ? FOREARMS_FRONT : FOREARMS_BACK;
  body += renderInactive(forearms);

  // Hands
  body += renderInactive(HANDS);

  // Lower legs
  body += renderInactive(LOWER_LEGS);

  // Feet
  body += renderInactive(FEET);

  return `<div class="body-map-figure">` +
    `<svg viewBox="2 0 96 212" xmlns="http://www.w3.org/2000/svg" class="body-map-svg">` +
    `<defs>${defs}</defs>` +
    body +
    `</svg>` +
    `<div class="body-map-view-label">${label}</div>` +
    `</div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render front + back body maps side by side.
 * @param {Object|null} fatigueByMuscle - Map of muscle group → { status }
 * @returns {string} HTML string
 */
export function renderBodyMap(fatigueByMuscle) {
  return `<div class="body-map-container">` +
    buildFigure(FRONT_MUSCLES, 'FRONT', fatigueByMuscle) +
    buildFigure(BACK_MUSCLES, 'BACK', fatigueByMuscle) +
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
