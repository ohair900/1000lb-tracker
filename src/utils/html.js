/**
 * Reusable HTML template builders.
 *
 * These functions produce HTML strings for UI patterns that appear in
 * multiple rendering functions across the app.  They eliminate duplication
 * and make it easy to update a pattern in one place.
 */

import { COLORS, LIFT_SHORT, LIFT_NAMES, PLATE_MILESTONES } from '../constants/lift-config.js';
import { escapeHTML } from './helpers.js';

// ---------------------------------------------------------------------------
// Lift color badges
// ---------------------------------------------------------------------------

/**
 * Small colored tag showing a lift abbreviation (SQ / BP / DL).
 * Used in session cards, history rows, and calendar pop-ups.
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {string} HTML string
 */
export function liftTag(lift) {
  return `<span class="session-tag ${lift}">${LIFT_SHORT[lift]}</span>`;
}

/**
 * Render a set of lift tags from an array of lift names.
 * @param {string[]} lifts
 * @returns {string} HTML string
 */
export function liftTagGroup(lifts) {
  return lifts.map(liftTag).join('');
}

/**
 * Colored lift name span (no background badge, just the accent color).
 * Used in PR timelines, stat rows, etc.
 * @param {string} lift
 * @returns {string} HTML string
 */
export function liftColorName(lift) {
  const name = LIFT_NAMES[lift] || lift;
  return `<span style="color:${COLORS[lift]}">${name}</span>`;
}

// ---------------------------------------------------------------------------
// PR / milestone badges
// ---------------------------------------------------------------------------

/**
 * Inline "PR" badge.
 * @returns {string} HTML string
 */
export function prBadge() {
  return '<span class="pr-badge">PR</span>';
}

/**
 * Inline "REP PR" badge (smaller).
 * @returns {string} HTML string
 */
export function repPRBadge() {
  return '<span class="pr-badge" style="font-size:0.55rem">REP PR</span>';
}

/**
 * Plate-milestone badge (e.g. "1 plate", "3 plates").
 * @param {string|number} milestone - The milestone weight (e.g. 135, 315)
 * @returns {string} HTML string, or empty if milestone is falsy
 */
export function milestoneBadge(milestone) {
  if (!milestone) return '';
  const idx = PLATE_MILESTONES.indexOf(parseInt(milestone));
  if (idx < 0) return '';
  return `<span class="milestone-badge">${idx + 1} plate${idx > 0 ? 's' : ''}</span>`;
}

// ---------------------------------------------------------------------------
// Change / direction indicators
// ---------------------------------------------------------------------------

const DIRECTION_ARROWS = { up: '\u2191', down: '\u2193', flat: '\u2192' };

/**
 * An arrow character for a trend direction.
 * @param {'up'|'down'|'flat'} direction
 * @returns {string} Unicode arrow
 */
export function directionArrow(direction) {
  return DIRECTION_ARROWS[direction] || '';
}

/**
 * Volume-change indicator (e.g. up-arrow with percentage).
 * Returns empty string when `change` is null.
 * @param {number|null} change - Percentage change
 * @returns {string} HTML string
 */
export function changeIndicator(change) {
  if (change === null || change === undefined) return '';
  const dir = change >= 0 ? 'up' : 'down';
  const arrow = change >= 0 ? '\u2191' : '\u2193';
  return `<span class="vol-change ${dir}">${arrow}${Math.abs(change).toFixed(0)}%</span>`;
}

// ---------------------------------------------------------------------------
// Progress / goal bars
// ---------------------------------------------------------------------------

/**
 * A thin horizontal progress bar with a colored fill.
 * @param {number} pct - Fill percentage (0-100, will be clamped)
 * @param {string} color - CSS color for the fill
 * @returns {string} HTML string
 */
export function progressBar(pct, color) {
  const clamped = Math.min(100, Math.max(0, pct));
  return `<div class="goal-track"><div class="goal-fill" style="width:${clamped}%;background:${color}"></div></div>`;
}

/**
 * Goal row with progress bar + percentage label.
 * @param {number} pct - Fill percentage (0-100)
 * @param {string} color - CSS color for the fill
 * @returns {string} HTML string
 */
export function goalProgress(pct, color) {
  return `${progressBar(pct, color)}\n<div class="goal-pct">${Math.round(pct)}%</div>`;
}

// ---------------------------------------------------------------------------
// Tag chips
// ---------------------------------------------------------------------------

/**
 * Render an array of string tags as small chip elements.
 * @param {string[]} tags
 * @returns {string} HTML string (empty if no tags)
 */
export function tagChips(tags) {
  if (!tags || tags.length === 0) return '';
  return tags.map(t => `<span class="tag-chip">${escapeHTML(t)}</span>`).join('');
}

// ---------------------------------------------------------------------------
// Stats collapsible section wrapper
// ---------------------------------------------------------------------------

/**
 * Open a collapsible stats section.  Must be closed with `SECTION_CLOSE`.
 * @param {string} id - Section identifier (used for collapse state)
 * @param {string} label - Display label
 * @param {Object} [collapsed={}] - Map of id -> boolean for collapse state
 * @returns {string} HTML string (opening tags)
 */
export function statsSection(id, label, collapsed = {}) {
  const col = collapsed[id] ? ' collapsed' : '';
  return `<div class="stats-section${col}" data-stats-section="${id}">
    <div class="stats-header" data-toggle="${id}">${label} <span class="stats-header-chevron">&#9656;</span></div>
    <div class="stats-body">`;
}

/**
 * Closing tags for a stats section opened with `statsSection()`.
 */
export const SECTION_CLOSE = `</div></div>`;

// ---------------------------------------------------------------------------
// Entry row (history)
// ---------------------------------------------------------------------------

/**
 * Build the metadata line for a history entry (RPE, notes).
 * @param {Object} entry
 * @returns {string} HTML string (may be empty)
 */
export function entryMeta(entry) {
  const parts = [];
  if (entry.rpe !== null && entry.rpe !== undefined) parts.push(`RPE ${entry.rpe}`);
  if (entry.notes) parts.push(`"${escapeHTML(entry.notes)}"`);
  if (parts.length === 0) return '';
  return `<div class="history-meta" style="font-size:0.65rem">${parts.join(' &middot; ')}</div>`;
}
