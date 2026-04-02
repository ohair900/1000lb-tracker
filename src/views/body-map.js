/**
 * SVG Body Map — side-by-side front/back muscle fatigue visualization.
 *
 * Anatomical figure built from connected muscle regions that share edges
 * to form a seamless body silhouette. No gaps between regions.
 * ViewBox: 0 0 100 200
 */

const INACTIVE_FILL = 'rgba(255,255,255,0.04)';
const BOUNDARY_STROKE = 'rgba(255,255,255,0.10)';
const TEXTURE_STROKE = 'rgba(255,255,255,0.05)';

const STATUS_COLORS = {
  green:  { r: 76,  g: 175, b: 80,  fill: 0.40, stroke: 0.7 },
  yellow: { r: 255, g: 193, b: 7,   fill: 0.40, stroke: 0.7 },
  red:    { r: 244, g: 67,  b: 54,  fill: 0.45, stroke: 0.75 },
};

// ---------------------------------------------------------------------------
// Connected muscle regions — share edges, no gaps
// Built on a coherent body outline: shoulders ~24-76, waist ~36-64, hips ~33-67
// ---------------------------------------------------------------------------

const FRONT_MUSCLES = {
  Shoulders: [
    // Left delt — wraps from neck/trap area over shoulder joint to upper arm
    'M 36,50 C 34,50 31,50 28,51 C 25,52 22,54 20,57 C 18,60 18,63 19,66 C 20,68 22,69 24,70 L 28,70 L 32,66 L 36,60 Z',
    // Right delt
    'M 64,50 C 66,50 69,50 72,51 C 75,52 78,54 80,57 C 82,60 82,63 81,66 C 80,68 78,69 76,70 L 72,70 L 68,66 L 64,60 Z',
  ],
  Chest: [
    // Left pec — connects delt to sternum to abs
    'M 36,50 L 36,60 L 32,66 L 28,70 C 30,74 33,77 36,79 C 39,80 42,81 45,81 L 49,81 L 49,74 L 49,66 L 49,58 L 49,50 Z',
    // Right pec
    'M 64,50 L 64,60 L 68,66 L 72,70 C 70,74 67,77 64,79 C 61,80 58,81 55,81 L 51,81 L 51,74 L 51,66 L 51,58 L 51,50 Z',
  ],
  Biceps: [
    // Left bicep — from delt insertion to elbow
    'M 19,66 C 18,70 16,74 15,78 C 14,82 13,86 13,90 L 14,93 L 22,93 C 23,89 24,85 25,81 C 26,77 27,73 28,70 L 24,70 C 22,69 20,68 19,66 Z',
    // Right bicep
    'M 81,66 C 82,70 84,74 85,78 C 86,82 87,86 87,90 L 86,93 L 78,93 C 77,89 76,85 75,81 C 74,77 73,73 72,70 L 76,70 C 78,69 80,68 81,66 Z',
  ],
  Core: [
    // Abs — from pec line to hip crease, tapered waist
    'M 49,81 L 45,81 C 42,81 39,80 37,79 C 36,80 35,82 35,84 C 34,88 34,92 34,96 C 34,100 34,104 35,108 L 35,112 L 50,112 L 65,112 L 65,108 C 66,104 66,100 66,96 C 66,92 66,88 65,84 C 65,82 64,80 63,79 C 61,80 58,81 55,81 L 51,81 Z',
  ],
  Quads: [
    // Left quad — from hip crease to knee, natural thigh shape
    'M 35,114 C 34,116 33,119 32,122 C 31,127 30,132 29,137 C 28,142 28,147 28,152 C 28,156 29,160 30,163 L 32,166 L 36,168 L 42,168 L 46,166 C 47,163 47,160 47,156 C 47,151 47,146 47,141 C 47,136 46,131 46,126 C 45,121 45,118 44,114 Z',
    // Right quad
    'M 56,114 C 55,118 55,121 54,126 C 53,131 53,136 53,141 C 53,146 53,151 53,156 C 53,160 53,163 54,166 L 58,168 L 64,168 L 68,166 L 70,163 C 71,160 72,156 72,152 C 72,147 72,142 71,137 C 70,132 69,127 68,122 C 67,119 66,116 65,114 Z',
  ],
};

const BACK_MUSCLES = {
  Triceps: [
    // Left tricep — back of arm from delt to elbow
    'M 19,66 C 18,70 16,74 15,78 C 14,82 13,86 13,90 L 14,93 L 22,93 C 23,89 24,85 25,81 C 26,77 27,73 28,70 L 24,70 C 22,69 20,68 19,66 Z',
    // Right tricep
    'M 81,66 C 82,70 84,74 85,78 C 86,82 87,86 87,90 L 86,93 L 78,93 C 77,89 76,85 75,81 C 74,77 73,73 72,70 L 76,70 C 78,69 80,68 81,66 Z',
  ],
  'Upper Back': [
    // Left upper back — from trap/neck to mid-back, includes lat
    'M 36,50 L 36,60 L 32,66 L 28,70 C 27,73 26,77 25,81 C 24,84 24,87 24,90 L 26,93 C 28,95 31,96 34,97 L 38,97 C 41,97 44,96 46,95 L 49,93 L 49,50 Z',
    // Right upper back
    'M 64,50 L 64,60 L 68,66 L 72,70 C 73,73 74,77 75,81 C 76,84 76,87 76,90 L 74,93 C 72,95 69,96 66,97 L 62,97 C 59,97 56,96 54,95 L 51,93 L 51,50 Z',
    // Spine column
    'M 49,50 L 49,93 C 48,94 47,95 46,95 L 44,96 C 43,97 42,97 42,98 C 44,99 47,100 50,100 C 53,100 56,99 58,98 C 58,97 57,97 56,96 L 54,95 C 53,95 52,94 51,93 L 51,50 Z',
  ],
  'Lower Back': [
    // Erectors — from mid-back to hip crease
    'M 42,98 C 40,100 38,102 37,105 C 36,108 35,111 35,114 L 44,114 L 50,114 L 56,114 L 65,114 C 65,111 64,108 63,105 C 62,102 60,100 58,98 C 56,99 53,100 50,100 C 47,100 44,99 42,98 Z',
  ],
  Glutes: [
    // Left glute — from hip crease curving down, connected to ham
    'M 35,114 L 44,114 C 45,118 46,122 46,126 C 46,130 45,134 44,137 L 42,140 C 40,142 37,143 34,143 C 31,143 29,142 27,140 C 26,138 26,135 26,132 C 27,128 28,124 30,120 C 31,118 33,116 35,114 Z',
    // Right glute
    'M 65,114 L 56,114 C 55,118 54,122 54,126 C 54,130 55,134 56,137 L 58,140 C 60,142 63,143 66,143 C 69,143 71,142 73,140 C 74,138 74,135 74,132 C 73,128 72,124 70,120 C 69,118 67,116 65,114 Z',
  ],
  Hams: [
    // Left ham — from glute tie-in to knee
    'M 27,140 C 29,142 31,143 34,143 C 37,143 40,142 42,140 L 44,137 C 45,140 46,144 46,148 C 46,152 46,156 46,160 C 46,163 46,166 46,168 L 42,168 L 36,168 L 32,166 C 30,164 28,161 27,158 C 26,154 26,150 26,146 C 26,144 26,142 27,140 Z',
    // Right ham
    'M 73,140 C 71,142 69,143 66,143 C 63,143 60,142 58,140 L 56,137 C 55,140 54,144 54,148 C 54,152 54,156 54,160 C 54,163 54,166 54,168 L 58,168 L 64,168 L 68,166 C 70,164 72,161 73,158 C 74,154 74,150 74,146 C 74,144 74,142 73,140 Z',
  ],
};

// Non-interactive body parts
const HEAD = 'M 50,4 C 44,4 40,8 38,13 C 37,18 37,23 39,28 C 40,31 42,34 44,36 L 46,38 C 48,39 50,39 50,39 C 50,39 52,39 54,38 L 56,36 C 58,34 60,31 61,28 C 63,23 63,18 62,13 C 60,8 56,4 50,4 Z';
const NECK = 'M 46,38 C 45,40 43,43 42,46 L 41,48 C 41,49 42,50 44,50 L 50,50 L 56,50 C 58,50 59,49 59,48 L 58,46 C 57,43 55,40 54,38';

// Hip connectors — seamless transition
const HIP_FRONT = [
  'M 35,112 L 35,114 L 44,114 L 44,112 Z',
  'M 56,112 L 56,114 L 65,114 L 65,112 Z',
];
const HIP_BACK = [];  // Back muscles connect directly

// Forearms
const FOREARMS_FRONT = [
  'M 13,93 C 12,97 11,101 10,105 C 9,108 9,111 10,114 L 12,116 L 15,116 C 17,114 19,111 20,108 C 21,105 22,101 22,97 L 22,93 Z',
  'M 87,93 C 88,97 89,101 90,105 C 91,108 91,111 90,114 L 88,116 L 85,116 C 83,114 81,111 80,108 C 79,105 78,101 78,97 L 78,93 Z',
];
const FOREARMS_BACK = FOREARMS_FRONT;

// Hands
const HANDS = [
  'M 10,116 C 9,118 8,120 9,122 C 9,123 10,124 12,124 L 14,123 C 15,122 16,120 15,118 L 15,116 Z',
  'M 90,116 C 91,118 92,120 91,122 C 91,123 90,124 88,124 L 86,123 C 85,122 84,120 85,118 L 85,116 Z',
];

// Lower legs — calf shape
const LOWER_LEGS = [
  'M 30,170 C 29,174 28,178 27,182 C 27,186 27,189 28,192 L 30,194 L 34,194 L 40,194 L 44,194 L 46,192 C 47,189 47,186 46,182 C 45,178 44,174 43,170 Z',
  'M 57,170 C 56,174 55,178 54,182 C 53,186 53,189 54,192 L 56,194 L 60,194 L 66,194 L 70,194 L 72,192 C 73,189 73,186 73,182 C 72,178 71,174 70,170 Z',
];

// Feet
const FEET = [
  'M 28,194 C 27,195 26,196 27,197 L 30,198 L 38,198 L 44,198 C 46,197 46,196 46,195 L 46,194 Z',
  'M 54,194 C 53,195 53,196 54,197 L 57,198 L 64,198 L 72,198 C 74,197 74,196 73,195 L 72,194 Z',
];

// Ab texture — horizontal segments + linea alba
const AB_TEXTURE = {
  horizontals: [
    { x1: 38, y1: 86, x2: 62, y2: 86 },
    { x1: 37, y1: 92, x2: 63, y2: 92 },
    { x1: 36, y1: 98, x2: 64, y2: 98 },
    { x1: 36, y1: 104, x2: 64, y2: 104 },
  ],
  midline: { x1: 50, y1: 82, x2: 50, y2: 111 },
};

// Knee gap between quads and lower legs
const KNEE_FRONT = [
  'M 30,168 L 32,170 L 42,170 L 46,168 Z',
  'M 54,168 L 58,170 L 68,170 L 70,168 Z',
];
const KNEE_BACK = KNEE_FRONT;

// Shoulder-to-delt connectors
const SHOULDER_CONN = [
  'M 24,70 L 22,73 L 22,76 L 25,81 L 28,70 Z',
  'M 76,70 L 78,73 L 78,76 L 75,81 L 72,70 Z',
];

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

function statusGradientId(mg, view) {
  return `grad-${view}-${mg.replace(/\s/g, '')}`;
}

function buildDefs(muscles, view, fatigueByMuscle) {
  let defs = '';
  Object.keys(muscles).forEach(mg => {
    const status = fatigueByMuscle && fatigueByMuscle[mg] ? fatigueByMuscle[mg].status : null;
    const gId = statusGradientId(mg, view);
    if (status && STATUS_COLORS[status]) {
      const c = STATUS_COLORS[status];
      defs += `<radialGradient id="${gId}" cx="50%" cy="40%" r="70%">` +
        `<stop offset="0%" stop-color="rgba(${c.r},${c.g},${c.b},${c.fill + 0.10})"/>` +
        `<stop offset="80%" stop-color="rgba(${c.r},${c.g},${c.b},${c.fill})"/>` +
        `<stop offset="100%" stop-color="rgba(${c.r},${c.g},${c.b},${c.fill * 0.6})"/>` +
        `</radialGradient>`;
    } else {
      defs += `<radialGradient id="${gId}" cx="50%" cy="40%" r="70%">` +
        `<stop offset="0%" stop-color="rgba(255,255,255,0.06)"/>` +
        `<stop offset="100%" stop-color="rgba(255,255,255,0.03)"/>` +
        `</radialGradient>`;
    }
  });
  return defs;
}

function renderMuscle(mg, paths, view, fatigueByMuscle) {
  const status = fatigueByMuscle && fatigueByMuscle[mg] ? fatigueByMuscle[mg].status : null;
  const gId = statusGradientId(mg, view);
  const c = status && STATUS_COLORS[status] ? STATUS_COLORS[status] : null;
  const strokeColor = c ? `rgba(${c.r},${c.g},${c.b},${c.stroke})` : BOUNDARY_STROKE;
  const strokeWidth = c ? '0.8' : '0.3';

  let svg = `<g class="body-map-muscle" data-muscle="${mg}">`;
  paths.forEach(d => {
    svg += `<path d="${d}" fill="url(#${gId})" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
  });
  svg += `</g>`;
  return svg;
}

function renderInactive(paths) {
  return paths.map(d =>
    `<path d="${d}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.25" stroke-linejoin="round"/>`
  ).join('');
}

function buildFigure(muscles, label, fatigueByMuscle) {
  const view = label.toLowerCase();
  const defs = buildDefs(muscles, view, fatigueByMuscle);
  let body = '';

  // Head + neck
  body += `<path d="${HEAD}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.3" stroke-linejoin="round"/>`;
  body += `<path d="${NECK}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.25" stroke-linejoin="round"/>`;

  // Muscles
  Object.entries(muscles).forEach(([mg, paths]) => {
    body += renderMuscle(mg, paths, view, fatigueByMuscle);
  });

  // Ab texture (front only)
  if (label === 'FRONT') {
    AB_TEXTURE.horizontals.forEach(l => {
      body += `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${TEXTURE_STROKE}" stroke-width="0.4"/>`;
    });
    body += `<line x1="${AB_TEXTURE.midline.x1}" y1="${AB_TEXTURE.midline.y1}" x2="${AB_TEXTURE.midline.x2}" y2="${AB_TEXTURE.midline.y2}" stroke="${TEXTURE_STROKE}" stroke-width="0.3"/>`;
  }

  // Connectors and non-interactive parts
  const hips = label === 'FRONT' ? HIP_FRONT : HIP_BACK;
  body += renderInactive(hips);
  body += renderInactive(label === 'FRONT' ? SHOULDER_CONN : SHOULDER_CONN);

  const knees = label === 'FRONT' ? KNEE_FRONT : KNEE_BACK;
  body += renderInactive(knees);

  body += renderInactive(label === 'FRONT' ? FOREARMS_FRONT : FOREARMS_BACK);
  body += renderInactive(HANDS);
  body += renderInactive(LOWER_LEGS);
  body += renderInactive(FEET);

  return `<div class="body-map-figure">` +
    `<svg viewBox="4 0 92 202" xmlns="http://www.w3.org/2000/svg" class="body-map-svg">` +
    `<defs>${defs}</defs>` +
    body +
    `</svg>` +
    `<div class="body-map-view-label">${label}</div>` +
    `</div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderBodyMap(fatigueByMuscle) {
  return `<div class="body-map-container">` +
    buildFigure(FRONT_MUSCLES, 'FRONT', fatigueByMuscle) +
    buildFigure(BACK_MUSCLES, 'BACK', fatigueByMuscle) +
    `</div>`;
}

export function initBodyMapEvents(container, onMuscleClick) {
  container.querySelectorAll('.body-map-muscle').forEach(g => {
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      const muscle = g.dataset.muscle;
      if (muscle && onMuscleClick) onMuscleClick(muscle);
    });
  });
}
