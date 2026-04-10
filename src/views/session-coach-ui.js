/**
 * Session coach UI — renders coaching cards, chips, and grade displays
 * into the existing workout overlay DOM.
 */

import { formatWeight } from '../formulas/units.js';
import store from '../state/store.js';

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const ICONS = {
  fatigue:  '<span class="coach-icon coach-icon-fatigue">!</span>',
  plateau:  '<span class="coach-icon coach-icon-plateau">&#x25B2;</span>',
  gap:      '<span class="coach-icon coach-icon-gap">~</span>',
  comeback: '<span class="coach-icon coach-icon-comeback">&#x21BA;</span>',
  volume:   '<span class="coach-icon coach-icon-volume">&#x2193;</span>',
  info:     '<span class="coach-icon coach-icon-info">i</span>',
  warn:     '<span class="coach-icon coach-icon-warn">!</span>',
};

// ---------------------------------------------------------------------------
// Pre-session coaching card
// ---------------------------------------------------------------------------

/**
 * Render the full coaching brief card HTML.
 *
 * @param {Object} plan - SessionPlan from generateSessionPlan()
 * @returns {string} HTML string
 */
export function renderCoachingCard(plan) {
  if (!plan || plan.insights.length === 0) {
    return ''; // No coaching needed — clean session
  }

  const insightRows = plan.insights.map(ins => {
    const icon = ICONS[ins.icon] || ICONS.info;
    return `<div class="coach-insight coach-insight-${ins.type}">${icon}<span>${ins.text}</span></div>`;
  }).join('');

  return `
    <div class="coach-card" id="coach-card">
      <div class="coach-card-header">
        <span class="coach-card-title">Coach</span>
        <button class="coach-card-toggle" data-coach-toggle aria-label="Collapse">&#x25B4;</button>
      </div>
      <div class="coach-card-body" id="coach-card-body">
        ${insightRows}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Mid-session coaching chip
// ---------------------------------------------------------------------------

/**
 * Render a coaching chip HTML for a set evaluation.
 *
 * @param {Object} evaluation - SetEvaluation from evaluateSetCompletion()
 * @returns {string} HTML string
 */
export function renderSetEvaluationChip(evaluation) {
  if (!evaluation || evaluation.drift === 'on-track') return '';

  const severityClass = evaluation.severity === 'alert' ? 'coach-chip-alert'
    : evaluation.severity === 'warn' ? 'coach-chip-warn'
      : 'coach-chip-info';

  const icon = evaluation.severity === 'alert' || evaluation.severity === 'warn'
    ? ICONS.warn : ICONS.info;

  const hasAdjustments = evaluation.adjustments && evaluation.adjustments.length > 0;

  let adjustDetail = '';
  if (hasAdjustments) {
    const first = evaluation.adjustments[0];
    if (first.action === 'drop') {
      adjustDetail = `<div class="coach-chip-detail">Drop set ${first.setIndex + 1}</div>`;
    } else if (first.field === 'weight') {
      adjustDetail = `<div class="coach-chip-detail">${formatWeight(first.from)} → ${formatWeight(first.to)} ${store.unit}</div>`;
    }
  }

  return `
    <div class="coach-chip ${severityClass}" data-eval-idx="${evaluation.setIndex}">
      <div class="coach-chip-message">${icon}<span>${evaluation.message}</span></div>
      ${adjustDetail}
      ${hasAdjustments ? `
        <div class="coach-chip-actions">
          <button class="coach-chip-btn coach-chip-apply" data-coach-apply="${evaluation.setIndex}">Apply</button>
          <button class="coach-chip-btn coach-chip-dismiss" data-coach-dismiss="${evaluation.setIndex}">Dismiss</button>
        </div>
      ` : ''}
    </div>`;
}

// ---------------------------------------------------------------------------
// Post-session grade display
// ---------------------------------------------------------------------------

const GRADE_COLORS = {
  'A+': 'var(--green)', A: 'var(--green)',
  'B+': 'var(--gold)', B: 'var(--gold)',
  'C+': 'var(--yellow)', C: 'var(--yellow)',
  D: 'var(--red)', F: 'var(--red)',
};

/**
 * Render session grade HTML for the workout summary.
 *
 * @param {Object} sessionGrade - SessionGrade from gradeSession()
 * @returns {string} HTML string
 */
export function renderSessionGrade(sessionGrade) {
  if (!sessionGrade) return '';

  const color = GRADE_COLORS[sessionGrade.grade] || 'var(--text)';
  const driftSign = sessionGrade.rpeDrift.avg > 0 ? '+' : '';
  const driftStr = sessionGrade.rpeDrift.avg !== 0
    ? `${driftSign}${sessionGrade.rpeDrift.avg}`
    : 'on target';
  const trendIcon = sessionGrade.rpeDrift.trend === 'rising' ? '&#x2191;'
    : sessionGrade.rpeDrift.trend === 'falling' ? '&#x2193;' : '';

  let impactHtml = '';
  if (sessionGrade.impacts.length > 0) {
    impactHtml = sessionGrade.impacts.map(imp => {
      const icon = ICONS[imp.icon] || ICONS.info;
      return `<div class="coach-impact">${icon}<span>${imp.message}</span></div>`;
    }).join('');
  }

  // Three-stat grid replaces the crowded middot-separated meta line.
  const tonnage = sessionGrade.tonnage > 0
    ? Math.round(sessionGrade.tonnage).toLocaleString()
    : '—';
  const tonnageUnit = sessionGrade.tonnage > 0 ? store.unit : '';

  return `
    <div class="coach-grade-section" data-grade="${sessionGrade.grade}">
      <div class="coach-grade-letter" style="color:${color}">${sessionGrade.grade}</div>
      <div class="coach-grade-stats">
        <div class="coach-grade-stat">
          <div class="coach-grade-stat-val">${sessionGrade.completionPct}<span class="coach-grade-stat-unit">%</span></div>
          <div class="coach-grade-stat-label">Complete</div>
        </div>
        <div class="coach-grade-stat">
          <div class="coach-grade-stat-val">${driftStr} ${trendIcon}</div>
          <div class="coach-grade-stat-label">RPE drift</div>
        </div>
        <div class="coach-grade-stat">
          <div class="coach-grade-stat-val">${tonnage}<span class="coach-grade-stat-unit">${tonnageUnit}</span></div>
          <div class="coach-grade-stat-label">Tonnage</div>
        </div>
      </div>
      ${impactHtml ? `<div class="coach-impacts">${impactHtml}</div>` : ''}
    </div>`;
}
