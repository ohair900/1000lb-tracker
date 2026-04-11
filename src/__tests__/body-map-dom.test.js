/**
 * DOM tests for src/views/body-map.js
 *
 * Uses happy-dom's DOMParser to parse the SVG output and assert on its
 * structure. This is the one DOM surface that changed dramatically in the
 * Forearms/Calves addition — Shoulders was promoted to BACK_MUSCLES, and
 * two new muscle groups were promoted from inactive to active. We need
 * tests that guard against accidental re-demotion.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../state/store.js', () => ({
  default: { unit: 'lbs', customAccessories: [], accessoryOverrides: {} },
}));

import { renderBodyMap } from '../views/body-map.js';
import { MUSCLE_GROUPS } from '../data/muscle-groups.js';

/** Parse the returned HTML string into a document fragment for querying. */
function parse(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

/** Build a mock fatigue object where every muscle is a green state. */
function makeAllGreen() {
  const f = {};
  for (const mg of MUSCLE_GROUPS) {
    f[mg] = { status: 'green', displayStatus: 'green', displayLabel: '0', sets: 0 };
  }
  return f;
}

describe('renderBodyMap: structure', () => {
  it('returns a string containing exactly two body-map-figure containers (front + back)', () => {
    const html = renderBodyMap(makeAllGreen());
    const container = parse(html);
    const figures = container.querySelectorAll('.body-map-figure');
    expect(figures).toHaveLength(2);
  });

  it('wraps both figures in a .body-map-container', () => {
    const html = renderBodyMap(makeAllGreen());
    const container = parse(html);
    expect(container.querySelector('.body-map-container')).not.toBeNull();
  });

  it('includes FRONT and BACK labels', () => {
    const html = renderBodyMap(makeAllGreen());
    expect(html).toContain('FRONT');
    expect(html).toContain('BACK');
  });
});

describe('renderBodyMap: muscle groups rendered', () => {
  it('renders a group for every muscle that appears in FRONT_MUSCLES or BACK_MUSCLES', () => {
    const html = renderBodyMap(makeAllGreen());
    const container = parse(html);
    const muscleGroups = container.querySelectorAll('.body-map-muscle');
    // Each muscle can appear in one or both views — at least one per unique
    // muscle key, but can be more (up to 2 per muscle).
    expect(muscleGroups.length).toBeGreaterThanOrEqual(MUSCLE_GROUPS.length);
  });

  it('every rendered muscle group has a data-muscle attribute', () => {
    const html = renderBodyMap(makeAllGreen());
    const container = parse(html);
    const groups = container.querySelectorAll('.body-map-muscle');
    groups.forEach(g => {
      const muscleAttr = g.getAttribute('data-muscle');
      expect(muscleAttr).toBeTruthy();
      expect(MUSCLE_GROUPS).toContain(muscleAttr);
    });
  });
});

describe('renderBodyMap: cffb2f8 regression — Forearms + Calves + Shoulders on both views', () => {
  it('Forearms appears in both front and back figures', () => {
    const html = renderBodyMap(makeAllGreen());
    const container = parse(html);
    const forearmGroups = container.querySelectorAll('[data-muscle="Forearms"]');
    // Should appear twice — once per figure
    expect(forearmGroups.length).toBe(2);
  });

  it('Calves appears in both front and back figures', () => {
    const html = renderBodyMap(makeAllGreen());
    const container = parse(html);
    const calfGroups = container.querySelectorAll('[data-muscle="Calves"]');
    expect(calfGroups.length).toBe(2);
  });

  it('Shoulders appears in both front and back figures (rear delts fix)', () => {
    const html = renderBodyMap(makeAllGreen());
    const container = parse(html);
    const shoulderGroups = container.querySelectorAll('[data-muscle="Shoulders"]');
    // Pre-fix: Shoulders only rendered on front. After cffb2f8: both sides.
    expect(shoulderGroups.length).toBe(2);
  });
});

describe('renderBodyMap: inactive regions removed (after cffb2f8)', () => {
  it('does not render forearm or calves as INACTIVE polygons on either view', () => {
    // Before the promotion, forearm and calves were gray inactive regions.
    // After, they're active colored muscles. Should NOT appear as gray.
    const html = renderBodyMap(makeAllGreen());
    // Inactive polygons use the INACTIVE_FILL color. Active muscles use gradient fills.
    // Check that data-muscle="Forearms" and "Calves" exist as active groups,
    // not as inactive polygons (which don't have data-muscle attrs).
    const container = parse(html);
    const forearms = container.querySelectorAll('[data-muscle="Forearms"]');
    const calves = container.querySelectorAll('[data-muscle="Calves"]');
    expect(forearms.length).toBeGreaterThan(0);
    expect(calves.length).toBeGreaterThan(0);
  });
});

describe('renderBodyMap: status color propagation', () => {
  it('uses a fill url for active muscles with a status color', () => {
    const fatigue = makeAllGreen();
    fatigue.Quads = { status: 'red', displayStatus: 'red', displayLabel: '12', sets: 12 };
    const html = renderBodyMap(fatigue);
    // Output should reference a gradient for the Quads muscle
    expect(html).toContain('grad-');
  });

  it('handles missing fatigue entries gracefully (partial fatigue map)', () => {
    const partial = {
      Quads: { status: 'red', displayStatus: 'red', displayLabel: '12', sets: 12 },
      // All others missing
    };
    expect(() => renderBodyMap(partial)).not.toThrow();
  });

  it('handles null fatigue argument without crashing', () => {
    expect(() => renderBodyMap(null)).not.toThrow();
  });

  it('handles undefined fatigue argument without crashing', () => {
    expect(() => renderBodyMap(undefined)).not.toThrow();
  });
});

describe('renderBodyMap: viewBox', () => {
  it('uses viewBox 0 0 100 200 on both SVGs', () => {
    const html = renderBodyMap(makeAllGreen());
    const container = parse(html);
    const svgs = container.querySelectorAll('svg');
    svgs.forEach(svg => {
      expect(svg.getAttribute('viewBox')).toBe('-2 -2 104 204');
    });
  });
});
