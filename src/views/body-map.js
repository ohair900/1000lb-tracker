/**
 * SVG Body Map — interactive muscle fatigue visualization.
 *
 * Renders a stylized human silhouette with muscle regions colored by
 * fatigue status (green/yellow/red). Front and back views with toggle.
 * Tapping a muscle region navigates to its fatigue detail.
 */

const STATUS_COLORS = {
  green:  { fill: 'rgba(76, 175, 80, 0.55)',  glow: 'rgba(76, 175, 80, 0.4)',  blur: 3 },
  yellow: { fill: 'rgba(255, 193, 7, 0.55)',  glow: 'rgba(255, 193, 7, 0.5)',  blur: 4 },
  red:    { fill: 'rgba(244, 67, 54, 0.55)',   glow: 'rgba(244, 67, 54, 0.6)', blur: 5 },
  none:   { fill: 'rgba(255, 255, 255, 0.06)', glow: 'none',                   blur: 0 },
};

// ---------------------------------------------------------------------------
// SVG paths — stylized anatomical silhouette
// ---------------------------------------------------------------------------

// Front view paths
const FRONT_PATHS = {
  Chest: {
    paths: [
      // Left pec
      'M 62,68 Q 58,72 56,78 Q 56,84 60,88 L 72,88 Q 76,84 76,78 Q 74,72 72,68 Z',
      // Right pec
      'M 88,68 Q 84,72 84,78 Q 84,84 88,88 L 100,88 Q 102,84 104,78 Q 102,72 98,68 Z',
    ],
    label: { x: 80, y: 80 },
  },
  Shoulders: {
    paths: [
      // Left delt
      'M 50,62 Q 44,64 42,70 Q 44,78 48,80 L 56,78 Q 58,72 58,66 Q 56,62 50,62 Z',
      // Right delt
      'M 110,62 Q 116,64 118,70 Q 116,78 112,80 L 104,78 Q 102,72 102,66 Q 104,62 110,62 Z',
    ],
    label: { x: 80, y: 70 },
  },
  Triceps: {
    paths: [
      // Left arm outer
      'M 42,80 Q 38,88 36,98 Q 36,104 38,108 L 44,108 Q 46,104 48,98 Q 50,88 48,80 Z',
      // Right arm outer
      'M 118,80 Q 122,88 124,98 Q 124,104 122,108 L 116,108 Q 114,104 112,98 Q 110,88 112,80 Z',
    ],
    label: { x: 38, y: 95 },
  },
  Core: {
    paths: [
      // Abdominals
      'M 66,90 Q 64,96 64,106 Q 64,116 66,122 L 94,122 Q 96,116 96,106 Q 96,96 94,90 Z',
    ],
    label: { x: 80, y: 106 },
  },
  Quads: {
    paths: [
      // Left quad
      'M 60,124 Q 56,136 54,150 Q 54,162 56,170 L 72,170 Q 74,162 76,150 Q 76,136 74,124 Z',
      // Right quad
      'M 86,124 Q 84,136 84,150 Q 84,162 86,170 L 104,170 Q 106,162 106,150 Q 106,136 100,124 Z',
    ],
    label: { x: 80, y: 148 },
  },
};

// Back view paths
const BACK_PATHS = {
  Back: {
    paths: [
      // Upper back / lats
      'M 58,66 Q 54,74 54,84 Q 54,96 58,106 L 66,110 Q 70,100 72,88 L 72,68 Z',
      'M 102,66 Q 106,74 106,84 Q 106,96 102,106 L 94,110 Q 90,100 88,88 L 88,68 Z',
      // Mid-back / spine area
      'M 72,68 L 72,110 Q 76,112 80,112 Q 84,112 88,110 L 88,68 Q 84,64 80,64 Q 76,64 72,68 Z',
    ],
    label: { x: 80, y: 88 },
  },
  Glutes: {
    paths: [
      // Left glute
      'M 58,114 Q 54,120 54,128 Q 56,136 62,138 L 76,136 Q 78,128 76,120 Q 74,114 68,112 Z',
      // Right glute
      'M 102,114 Q 106,120 106,128 Q 104,136 98,138 L 84,136 Q 82,128 84,120 Q 86,114 92,112 Z',
    ],
    label: { x: 80, y: 126 },
  },
  Hams: {
    paths: [
      // Left hamstring
      'M 56,140 Q 54,152 54,164 Q 54,172 56,178 L 72,178 Q 74,172 76,164 Q 76,152 74,140 Z',
      // Right hamstring
      'M 84,140 Q 84,152 84,164 Q 84,172 86,178 L 104,178 Q 106,172 106,164 Q 106,152 104,140 Z',
    ],
    label: { x: 80, y: 160 },
  },
};

// Body outline (non-interactive)
const BODY_OUTLINE_FRONT = 'M 80,12 Q 72,12 68,16 Q 64,20 64,28 Q 64,36 68,40 Q 72,44 80,44 Q 88,44 92,40 Q 96,36 96,28 Q 96,20 92,16 Q 88,12 80,12 Z ' +   // Head
  'M 68,46 L 58,50 Q 46,54 42,62 Q 38,70 36,80 Q 34,92 34,104 L 34,112 Q 34,116 38,118 L 46,118 Q 48,116 48,112 ' +  // Left arm
  'L 50,80 L 56,66 L 62,56 L 68,50 Z ' +
  'M 92,46 L 102,50 Q 114,54 118,62 Q 122,70 124,80 Q 126,92 126,104 L 126,112 Q 126,116 122,118 L 114,118 Q 112,116 112,112 ' +  // Right arm
  'L 110,80 L 104,66 L 98,56 L 92,50 Z ' +
  'M 62,56 Q 58,62 56,70 L 56,120 Q 56,124 58,126 L 58,170 Q 56,180 56,190 Q 56,198 60,202 L 70,204 Q 74,200 74,196 L 76,170 Q 78,164 80,160 ' +  // Left leg
  'Q 82,164 84,170 L 86,196 Q 86,200 90,204 L 100,202 Q 104,198 104,190 Q 104,180 102,170 L 102,126 Q 104,124 104,120 L 104,70 Q 102,62 98,56 Z';  // Right leg

const BODY_OUTLINE_BACK = BODY_OUTLINE_FRONT; // Same silhouette, different muscle fills

// ---------------------------------------------------------------------------
// Render functions
// ---------------------------------------------------------------------------

function renderMusclePaths(paths, mg, status, isActive) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.none;
  const filterId = `glow-${mg.toLowerCase()}`;
  const activeClass = isActive ? ' body-map-muscle--active' : '';

  let svg = '';
  // Glow filter for this muscle
  if (colors.blur > 0) {
    svg += `<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${colors.blur}" result="blur"/>` +
      `<feComposite in="SourceGraphic" in2="blur" operator="over"/>` +
      `</filter>`;
  }

  const filterAttr = colors.blur > 0 ? ` filter="url(#${filterId})"` : '';
  svg += `<g class="body-map-muscle${activeClass}" data-muscle="${mg}"${filterAttr}>`;
  paths.forEach(d => {
    svg += `<path d="${d}" fill="${colors.fill}" stroke="${colors.glow}" stroke-width="0.5" style="cursor:pointer"/>`;
  });
  svg += `</g>`;
  return svg;
}

/**
 * Render the body map SVG with fatigue status colors.
 *
 * @param {Object} fatigueByMuscle - Map of muscle group name to { status }
 * @param {string} activeMuscle - Currently selected muscle group (gets pulse effect)
 * @param {string} view - 'front' or 'back'
 * @returns {string} HTML string
 */
export function renderBodyMap(fatigueByMuscle, activeMuscle, view = 'front') {
  const fatigue = fatigueByMuscle || {};
  const getStatus = mg => fatigue[mg] ? fatigue[mg].status : 'none';

  let filters = '';
  let frontMuscles = '';
  let backMuscles = '';

  // Front muscles
  Object.entries(FRONT_PATHS).forEach(([mg, data]) => {
    const status = getStatus(mg);
    frontMuscles += renderMusclePaths(data.paths, mg, status, mg === activeMuscle);
  });

  // Back muscles
  Object.entries(BACK_PATHS).forEach(([mg, data]) => {
    const status = getStatus(mg);
    backMuscles += renderMusclePaths(data.paths, mg, status, mg === activeMuscle);
  });

  // Labels
  let frontLabels = '', backLabels = '';
  Object.entries(FRONT_PATHS).forEach(([mg, data]) => {
    frontLabels += `<text x="${data.label.x}" y="${data.label.y}" class="body-map-label">${mg}</text>`;
  });
  Object.entries(BACK_PATHS).forEach(([mg, data]) => {
    backLabels += `<text x="${data.label.x}" y="${data.label.y}" class="body-map-label">${mg}</text>`;
  });

  const frontOpacity = view === 'front' ? 1 : 0;
  const backOpacity = view === 'back' ? 1 : 0;
  const frontPointer = view === 'front' ? 'auto' : 'none';
  const backPointer = view === 'back' ? 'auto' : 'none';

  const svg = `<svg viewBox="20 0 120 220" xmlns="http://www.w3.org/2000/svg" class="body-map-svg">` +
    `<defs>` +
    `<radialGradient id="body-bg-grad" cx="50%" cy="40%" r="60%">` +
    `<stop offset="0%" stop-color="rgba(255,255,255,0.03)"/>` +
    `<stop offset="100%" stop-color="rgba(255,255,255,0)"/>` +
    `</radialGradient>` +
    `</defs>` +
    // Background glow
    `<ellipse cx="80" cy="110" rx="50" ry="90" fill="url(#body-bg-grad)"/>` +
    // Front view
    `<g class="body-map-view body-map-view--front" style="opacity:${frontOpacity};pointer-events:${frontPointer}">` +
    `<path d="${BODY_OUTLINE_FRONT}" fill="none" stroke="var(--text-dim)" stroke-width="0.8" opacity="0.3"/>` +
    frontMuscles +
    frontLabels +
    `</g>` +
    // Back view
    `<g class="body-map-view body-map-view--back" style="opacity:${backOpacity};pointer-events:${backPointer}">` +
    `<path d="${BODY_OUTLINE_BACK}" fill="none" stroke="var(--text-dim)" stroke-width="0.8" opacity="0.3"/>` +
    backMuscles +
    backLabels +
    `</g>` +
    `</svg>`;

  const toggleHtml = `<div class="body-map-toggle">` +
    `<button class="body-map-toggle-btn${view === 'front' ? ' active' : ''}" data-view="front">Front</button>` +
    `<button class="body-map-toggle-btn${view === 'back' ? ' active' : ''}" data-view="back">Back</button>` +
    `</div>`;

  return `<div class="body-map-container">` +
    toggleHtml +
    svg +
    `</div>`;
}

/**
 * Initialize body map event listeners.
 * Call after inserting body map HTML into the DOM.
 *
 * @param {HTMLElement} container - Container element
 * @param {Function} onMuscleClick - Callback when a muscle is tapped
 * @param {Function} onViewToggle - Callback when view is toggled (receives 'front'|'back')
 */
export function initBodyMapEvents(container, onMuscleClick, onViewToggle) {
  // Muscle region clicks
  container.querySelectorAll('.body-map-muscle').forEach(g => {
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      const muscle = g.dataset.muscle;
      if (muscle && onMuscleClick) onMuscleClick(muscle);
    });
  });

  // Toggle buttons
  container.querySelectorAll('.body-map-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (onViewToggle) onViewToggle(view);
    });
  });
}
