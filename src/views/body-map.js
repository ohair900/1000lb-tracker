/**
 * SVG Body Map — side-by-side front/back muscle fatigue visualization.
 *
 * Pixel-perfect traced anatomical outlines with 10 muscle groups.
 * Crisp colored borders, radial gradient fills, no blur.
 * ViewBox: 0 0 100 210
 */

const BASE_FILL = 'rgba(255,255,255,0.07)';
const INACTIVE_FILL = 'rgba(255,255,255,0.04)';
const BOUNDARY_STROKE = 'rgba(255,255,255,0.12)';
const TEXTURE_STROKE = 'rgba(255,255,255,0.06)';

const STATUS_COLORS = {
  green:  { r: 76,  g: 175, b: 80,  fill: 0.45, stroke: 0.8 },
  yellow: { r: 255, g: 193, b: 7,   fill: 0.45, stroke: 0.8 },
  red:    { r: 244, g: 67,  b: 54,  fill: 0.50, stroke: 0.85 },
};

// ---------------------------------------------------------------------------
// Pixel-perfect traced SVG paths — anatomically detailed
// ViewBox: 0 0 100 210, figure centered at x=50
// ---------------------------------------------------------------------------

const FRONT_MUSCLES = {
  Shoulders: [
    // Left anterior deltoid — 3-head cap shape
    'M 30,54 C 27,54 24,55 21,57 C 18,59 16,62 15,65 C 14,68 15,71 17,74 C 19,76 22,77 25,77 L 27,76 C 29,74 31,71 32,68 C 33,65 33,62 32,59 C 31,56 31,55 30,54 Z',
    // Right anterior deltoid
    'M 70,54 C 73,54 76,55 79,57 C 82,59 84,62 85,65 C 86,68 85,71 83,74 C 81,76 78,77 75,77 L 73,76 C 71,74 69,71 68,68 C 67,65 67,62 68,59 C 69,56 69,55 70,54 Z',
  ],
  Chest: [
    // Left pec — upper/lower contour, sternum edge, armpit insertion
    'M 33,57 C 33,58 32,60 32,62 L 32,66 C 32,68 31,70 29,72 L 25,77 C 26,79 28,81 31,83 C 34,85 37,86 40,87 L 44,87 C 46,87 48,86 49,85 L 49,82 C 49,78 49,74 49,70 L 49,64 C 49,60 49,58 49,57 L 33,57 Z',
    // Right pec
    'M 67,57 C 67,58 68,60 68,62 L 68,66 C 68,68 69,70 71,72 L 75,77 C 74,79 72,81 69,83 C 66,85 63,86 60,87 L 56,87 C 54,87 52,86 51,85 L 51,82 C 51,78 51,74 51,70 L 51,64 C 51,60 51,58 51,57 L 67,57 Z',
  ],
  Biceps: [
    // Left bicep — peaked belly, brachialis edge
    'M 15,65 C 13,69 12,73 11,77 C 10,81 9,85 9,89 C 9,92 10,95 11,97 L 14,97 C 17,97 20,97 22,97 L 25,97 C 27,93 28,89 29,85 C 30,81 31,77 32,74 L 32,72 L 29,72 L 25,77 C 22,77 19,76 17,74 C 15,72 15,69 15,65 Z',
    // Right bicep
    'M 85,65 C 87,69 88,73 89,77 C 90,81 91,85 91,89 C 91,92 90,95 89,97 L 86,97 C 83,97 80,97 78,97 L 75,97 C 73,93 72,89 71,85 C 70,81 69,77 68,74 L 68,72 L 71,72 L 75,77 C 78,77 81,76 83,74 C 85,72 85,69 85,65 Z',
  ],
  Core: [
    // Rectus abdominis — tapered, with oblique edges
    'M 37,87 C 36,89 35,92 35,95 C 34,98 34,101 34,104 C 34,107 34,110 34,113 L 34,116 C 34,117 35,118 36,119 L 38,119 L 50,119 L 62,119 L 64,119 C 65,118 66,117 66,116 L 66,113 C 66,110 66,107 66,104 C 66,101 66,98 65,95 C 65,92 64,89 63,87 L 56,87 L 50,87 L 44,87 L 37,87 Z',
  ],
  Quads: [
    // Left quad — vastus lateralis sweep, rectus femoris, VMO teardrop
    'M 34,121 C 33,123 32,126 31,129 C 30,133 29,137 28,141 C 27,145 26,149 26,153 C 26,157 26,161 27,164 C 27,167 28,170 29,172 L 30,174 C 31,175 33,176 35,176 L 38,176 L 42,176 L 45,176 C 47,176 48,175 48,174 C 48,171 48,168 48,165 C 48,161 48,157 48,153 C 48,149 48,145 47,141 C 47,137 46,133 46,129 C 45,126 45,123 44,121 L 40,121 L 34,121 Z',
    // Right quad
    'M 56,121 C 55,123 55,126 54,129 C 53,133 53,137 52,141 C 52,145 52,149 52,153 C 52,157 52,161 52,165 C 52,168 52,171 52,174 C 52,175 53,176 55,176 L 58,176 L 62,176 L 65,176 C 67,176 69,175 70,174 L 71,172 C 72,170 73,167 73,164 C 74,161 74,157 74,153 C 74,149 73,145 72,141 C 71,137 70,133 69,129 C 68,126 67,123 66,121 L 60,121 L 56,121 Z',
  ],
};

const BACK_MUSCLES = {
  Triceps: [
    // Left tricep — horseshoe shape, long/lateral head
    'M 15,65 C 13,69 12,73 11,77 C 10,81 9,85 9,89 C 9,92 10,95 11,97 L 14,97 C 17,97 20,97 22,97 L 25,97 C 27,93 28,89 29,85 C 30,81 31,77 32,74 L 32,72 L 29,72 L 25,77 C 22,77 19,76 17,74 C 15,72 15,69 15,65 Z',
    // Right tricep
    'M 85,65 C 87,69 88,73 89,77 C 90,81 91,85 91,89 C 91,92 90,95 89,97 L 86,97 C 83,97 80,97 78,97 L 75,97 C 73,93 72,89 71,85 C 70,81 69,77 68,74 L 68,72 L 71,72 L 75,77 C 78,77 81,76 83,74 C 85,72 85,69 85,65 Z',
  ],
  'Upper Back': [
    // Left lat + trap — wide, V-taper shape with scapula suggestion
    'M 33,57 C 31,59 29,62 27,65 C 25,68 24,71 23,74 C 22,77 22,80 22,83 C 23,86 24,89 25,91 L 27,93 C 29,95 31,96 33,97 L 36,98 C 38,98 40,97 42,96 L 44,95 L 48,93 L 48,90 L 48,80 L 48,70 L 48,60 L 48,57 L 33,57 Z',
    // Right lat + trap
    'M 67,57 C 69,59 71,62 73,65 C 75,68 76,71 77,74 C 78,77 78,80 78,83 C 77,86 76,89 75,91 L 73,93 C 71,95 69,96 67,97 L 64,98 C 62,98 60,97 58,96 L 56,95 L 52,93 L 52,90 L 52,80 L 52,70 L 52,60 L 52,57 L 67,57 Z',
    // Spine / mid-back — rhomboid area
    'M 48,57 L 48,60 L 48,70 L 48,80 L 48,90 L 48,93 C 47,94 46,95 45,95 C 44,96 43,96 42,96 L 40,97 C 39,97 38,98 38,99 L 39,101 C 41,103 44,104 47,104 L 50,104 L 53,104 C 56,104 59,103 61,101 L 62,99 C 62,98 61,97 60,97 L 58,96 C 57,96 56,96 55,95 C 54,95 53,94 52,93 L 52,90 L 52,80 L 52,70 L 52,60 L 52,57 L 48,57 Z',
  ],
  'Lower Back': [
    // Erectors — christmas tree shape, lumbar
    'M 39,101 C 38,103 37,106 36,109 C 35,112 35,115 35,117 L 35,119 L 38,119 L 44,119 L 50,119 L 56,119 L 62,119 L 65,119 L 65,117 C 65,115 65,112 64,109 C 63,106 62,103 61,101 C 59,103 56,104 53,104 L 50,104 L 47,104 C 44,104 41,103 39,101 Z',
  ],
  Glutes: [
    // Left glute — rounded, anatomical
    'M 34,121 C 32,122 30,124 28,127 C 26,130 25,133 24,136 C 24,139 25,141 27,143 C 29,145 32,146 35,146 L 38,146 C 41,145 43,144 45,142 L 47,140 C 48,138 48,135 47,132 C 47,129 46,126 45,123 L 44,121 L 40,121 L 34,121 Z',
    // Right glute
    'M 66,121 C 68,122 70,124 72,127 C 74,130 75,133 76,136 C 76,139 75,141 73,143 C 71,145 68,146 65,146 L 62,146 C 59,145 57,144 55,142 L 53,140 C 52,138 52,135 53,132 C 53,129 54,126 55,123 L 56,121 L 60,121 L 66,121 Z',
  ],
  Hams: [
    // Left hamstring — bicep femoris + semitendinosus, glute tie-in
    'M 27,147 C 26,149 25,152 24,155 C 23,159 23,163 23,167 C 23,170 24,173 25,175 L 27,177 C 29,178 31,179 34,179 L 38,179 L 42,179 L 45,179 C 47,178 48,177 48,176 C 48,173 48,170 48,167 C 48,163 48,159 47,155 C 47,152 46,149 45,147 L 42,146 L 38,146 L 35,146 C 32,146 29,147 27,147 Z',
    // Right hamstring
    'M 73,147 C 74,149 75,152 76,155 C 77,159 77,163 77,167 C 77,170 76,173 75,175 L 73,177 C 71,178 69,179 66,179 L 62,179 L 58,179 L 55,179 C 53,178 52,177 52,176 C 52,173 52,170 52,167 C 52,163 52,159 53,155 C 53,152 54,149 55,147 L 58,146 L 62,146 L 65,146 C 68,146 71,147 73,147 Z',
  ],
};

// ---------------------------------------------------------------------------
// Non-interactive body parts — detailed
// ---------------------------------------------------------------------------

// Head — oval with jaw definition
const HEAD = 'M 50,4 C 44,4 39,7 37,12 C 35,17 35,22 36,27 C 37,30 38,33 40,35 C 41,37 43,39 45,40 L 47,41 C 48,41 49,42 50,42 C 51,42 52,41 53,41 L 55,40 C 57,39 59,37 60,35 C 62,33 63,30 64,27 C 65,22 65,17 63,12 C 61,7 56,4 50,4 Z';

// Neck — tapered
const NECK = 'M 45,41 C 44,43 43,46 42,48 L 41,51 C 41,53 42,54 43,55 L 45,56 L 50,57 L 55,56 L 57,55 C 58,54 59,53 59,51 L 58,48 C 57,46 56,43 55,41';

// Hip connectors
const HIP_FRONT = [
  'M 36,119 L 34,121 L 44,121 L 46,119 Z',
  'M 54,119 L 56,121 L 66,121 L 64,119 Z',
];
const HIP_BACK = HIP_FRONT;

// Forearms — tapered with wrist
const FOREARMS_FRONT = [
  'M 9,98 C 8,102 7,106 7,110 C 7,114 8,117 9,120 L 11,122 C 12,123 14,123 15,122 L 17,120 C 19,117 20,114 21,110 C 22,106 22,102 23,98 Z',
  'M 91,98 C 92,102 93,106 93,110 C 93,114 92,117 91,120 L 89,122 C 88,123 86,123 85,122 L 83,120 C 81,117 80,114 79,110 C 78,106 78,102 77,98 Z',
];
const FOREARMS_BACK = FOREARMS_FRONT;

// Hands — recognizable shape
const HANDS = [
  'M 9,122 C 8,124 7,126 7,128 C 7,130 8,131 9,132 L 11,133 C 13,133 14,132 15,131 C 16,130 16,128 15,126 L 15,122 Z',
  'M 91,122 C 92,124 93,126 93,128 C 93,130 92,131 91,132 L 89,133 C 87,133 86,132 85,131 C 84,130 84,128 85,126 L 85,122 Z',
];

// Lower legs — calf shape with ankle taper
const LOWER_LEGS = [
  'M 29,178 C 28,181 27,185 26,189 C 25,192 25,195 25,198 C 25,200 26,201 27,202 L 30,202 L 36,202 L 42,202 L 44,202 C 45,201 46,200 46,198 C 46,195 46,192 45,189 C 44,185 43,181 42,178 Z',
  'M 58,178 C 57,181 56,185 55,189 C 54,192 54,195 54,198 C 54,200 55,201 56,202 L 58,202 L 64,202 L 70,202 L 73,202 C 74,201 75,200 75,198 C 75,195 75,192 74,189 C 73,185 72,181 71,178 Z',
];

// Feet — arch shape
const FEET = [
  'M 25,202 C 24,203 23,204 23,205 C 23,206 24,207 26,207 L 34,207 L 42,207 C 44,207 46,206 46,205 C 46,204 45,203 44,202 Z',
  'M 54,202 C 53,203 53,204 54,205 C 54,206 55,207 57,207 L 64,207 L 72,207 C 74,207 76,206 76,205 C 76,204 75,203 75,202 Z',
];

// Ab texture lines — 6-pack segments + linea alba
const AB_LINES_H = [
  { x1: 39, y1: 93, x2: 61, y2: 93 },
  { x1: 38, y1: 100, x2: 62, y2: 100 },
  { x1: 37, y1: 107, x2: 63, y2: 107 },
  { x1: 36, y1: 114, x2: 64, y2: 114 },
];
// Linea alba (vertical midline)
const LINEA_ALBA = { x1: 50, y1: 88, x2: 50, y2: 118 };

// ---------------------------------------------------------------------------
// SVG rendering helpers
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
        `<stop offset="0%" stop-color="rgba(${c.r},${c.g},${c.b},${c.fill + 0.12})"/>` +
        `<stop offset="80%" stop-color="rgba(${c.r},${c.g},${c.b},${c.fill})"/>` +
        `<stop offset="100%" stop-color="rgba(${c.r},${c.g},${c.b},${c.fill * 0.6})"/>` +
        `</radialGradient>`;
    } else {
      defs += `<radialGradient id="${gId}" cx="50%" cy="40%" r="70%">` +
        `<stop offset="0%" stop-color="rgba(255,255,255,0.07)"/>` +
        `<stop offset="100%" stop-color="rgba(255,255,255,0.04)"/>` +
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
  const strokeWidth = c ? '1.0' : '0.4';

  let svg = `<g class="body-map-muscle" data-muscle="${mg}">`;
  paths.forEach(d => {
    svg += `<path d="${d}" fill="url(#${gId})" stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>`;
  });
  svg += `</g>`;
  return svg;
}

function renderInactive(paths) {
  return paths.map(d =>
    `<path d="${d}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.3" stroke-linejoin="round"/>`
  ).join('');
}

function buildFigure(muscles, label, fatigueByMuscle) {
  const view = label.toLowerCase();
  const defs = buildDefs(muscles, view, fatigueByMuscle);
  let body = '';

  // Head + neck
  body += `<path d="${HEAD}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.3" stroke-linejoin="round"/>`;
  body += `<path d="${NECK}" fill="${INACTIVE_FILL}" stroke="${BOUNDARY_STROKE}" stroke-width="0.2" stroke-linejoin="round"/>`;

  // Muscles
  Object.entries(muscles).forEach(([mg, paths]) => {
    body += renderMuscle(mg, paths, view, fatigueByMuscle);
  });

  // Ab texture lines (front only)
  if (label === 'FRONT') {
    AB_LINES_H.forEach(l => {
      body += `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${TEXTURE_STROKE}" stroke-width="0.4"/>`;
    });
    body += `<line x1="${LINEA_ALBA.x1}" y1="${LINEA_ALBA.y1}" x2="${LINEA_ALBA.x2}" y2="${LINEA_ALBA.y2}" stroke="${TEXTURE_STROKE}" stroke-width="0.3"/>`;
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
