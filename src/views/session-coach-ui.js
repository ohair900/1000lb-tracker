/**
 * Session coach UI — renders coaching notes, chips, and grade displays
 * into the existing workout overlay DOM.
 *
 * Voice: action-first, reason-trailing, one sentence per row. No uppercase
 * "COACH" title, no circle-icon badges, no decorative animations. Color is
 * reserved for priority (high = orange accent), not decoration.
 */

import { formatWeight } from '../formulas/units.js';
import store from '../state/store.js';

// ---------------------------------------------------------------------------
// Pre-session coaching note
// ---------------------------------------------------------------------------

/**
 * Render the pre-session coaching note HTML. Unifies insights,
 * supplementalAdjustment, accessorySwaps, and comebackProtocol into a single
 * list where each actionable row gets an inline Accept button.
 *
 * Returns empty string if there's nothing to say — silence is a valid coach
 * output.
 *
 * @param {Object} plan - SessionPlan from generateSessionPlan()
 * @returns {string} HTML string
 */
export function renderCoachingCard(plan) {
  if (!plan) return '';
  const rows = buildCoachRows(plan);
  if (rows.length === 0) return '';

  const rowsHtml = rows.map(renderCoachRow).join('');

  return `
    <section class="coach-note" id="coach-card">
      <header class="coach-note-head">
        <span class="coach-note-label">Notes</span>
      </header>
      <ul class="coach-note-list">
        ${rowsHtml}
      </ul>
    </section>`;
}

/**
 * Flatten plan.insights into a priority-ordered row list. Insights that
 * correspond to an adjustment carry the action metadata needed to render an
 * Accept button and wire it to the right handler.
 */
function buildCoachRows(plan) {
  const rows = [];

  (plan.insights || []).forEach(ins => {
    const priority = priorityClass(ins.priority);
    let action = null;

    if (ins.actionable) {
      if (ins.type === 'volume' && plan.supplementalAdjustment) {
        action = {
          kind: 'supp',
          attr: 'data-coach-accept-supp',
          accepted: !!plan.supplementalAdjustment._accepted,
        };
      } else if (ins.type === 'gap' && Number.isInteger(ins.swapIndex)) {
        const swap = plan.accessorySwaps && plan.accessorySwaps[ins.swapIndex];
        if (swap) {
          action = {
            kind: 'swap',
            attr: `data-coach-accept-swap="${ins.swapIndex}"`,
            accepted: !!swap._accepted,
          };
        }
      } else if (ins.type === 'comeback') {
        // Comeback is advisory — no in-session action to apply directly
        action = null;
      }
    }

    rows.push({
      priority,
      text: ins.text,
      action,
      accepted: !!ins._accepted || (action && action.accepted),
    });
  });

  return rows;
}

function priorityClass(p) {
  if (p <= 1) return 'high';
  if (p <= 2) return 'med';
  return 'low';
}

function renderCoachRow(row) {
  const acceptedCls = row.accepted ? ' accepted' : '';
  const buttonHtml = row.action
    ? (row.accepted
        ? `<span class="coach-row-applied">Applied</span>`
        : `<button class="coach-row-accept" ${row.action.attr}>Accept</button>`)
    : '';

  return `
    <li class="coach-row${acceptedCls}" data-priority="${row.priority}"${row.action ? ' data-actionable="true"' : ''}>
      <p class="coach-row-text">${row.text}</p>
      ${buttonHtml}
    </li>`;
}

// ---------------------------------------------------------------------------
// Mid-session coaching chip
// ---------------------------------------------------------------------------

/**
 * Render a coaching chip for a set evaluation. Left-border severity color is
 * the only decoration — no circle icons, no background tint.
 *
 * @param {Object} evaluation - SetEvaluation from evaluateSetCompletion()
 * @returns {string} HTML string
 */
export function renderSetEvaluationChip(evaluation) {
  if (!evaluation || evaluation.drift === 'on-track') return '';

  const severityClass = evaluation.severity === 'alert' ? 'coach-chip-alert'
    : evaluation.severity === 'warn' ? 'coach-chip-warn'
      : 'coach-chip-info';

  const hasAdjustments = evaluation.adjustments && evaluation.adjustments.length > 0;

  let adjustDetail = '';
  if (hasAdjustments) {
    const first = evaluation.adjustments[0];
    if (first.action === 'drop') {
      adjustDetail = `<p class="coach-chip-meta">Drop set ${first.setIndex + 1}</p>`;
    } else if (first.field === 'weight') {
      adjustDetail = `<p class="coach-chip-meta">${formatWeight(first.from)} &rarr; ${formatWeight(first.to)} ${store.unit}</p>`;
    }
  }

  return `
    <div class="coach-chip ${severityClass}" data-eval-idx="${evaluation.setIndex}">
      <p class="coach-chip-text">${evaluation.message}</p>
      ${adjustDetail}
      ${hasAdjustments ? `
        <div class="coach-chip-actions">
          <button class="coach-chip-btn coach-chip-apply" data-coach-apply="${evaluation.setIndex}">Apply</button>
          <button class="coach-chip-btn coach-chip-dismiss" data-coach-dismiss="${evaluation.setIndex}" aria-label="Dismiss">&times;</button>
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

// Grade-tier headlines. Congratulatory for A/B, terse diagnostic for C/D/F.
const GRADE_HEADLINES = {
  'A+': { headline: 'Strong session', sub: 'RPE on target, volume hit.' },
  A:    { headline: 'Strong session', sub: 'RPE on target, volume hit.' },
  'B+': { headline: 'Solid work',     sub: 'Hit the numbers cleanly.' },
  B:    { headline: 'Solid work',     sub: 'Hit the numbers cleanly.' },
  'C+': { headline: 'Rough patches',  sub: 'A few sets missed target.' },
  C:    { headline: 'Rough patches',  sub: 'A few sets missed target.' },
  D:    { headline: 'Off day',        sub: 'Miss was real — review recovery.' },
  F:    { headline: 'Incomplete',     sub: 'Most of the work didn\u2019t happen.' },
};

/**
 * Render session grade HTML for the workout summary. Inline letter + headline
 * row, followed by a compact dl stats grid and impacts list. A/A+ gets a
 * single 400ms pulse on the letter (no confetti, no glow, no giant font).
 *
 * @param {Object} sessionGrade - SessionGrade from gradeSession()
 * @returns {string} HTML string
 */
export function renderSessionGrade(sessionGrade) {
  if (!sessionGrade) return '';

  const color = GRADE_COLORS[sessionGrade.grade] || 'var(--text)';
  const head = GRADE_HEADLINES[sessionGrade.grade] || { headline: '', sub: '' };

  const driftSign = sessionGrade.rpeDrift.avg > 0 ? '+' : '';
  const driftStr = sessionGrade.rpeDrift.avg !== 0
    ? `${driftSign}${sessionGrade.rpeDrift.avg}`
    : '0';

  const tonnage = sessionGrade.tonnage > 0
    ? Math.round(sessionGrade.tonnage).toLocaleString()
    : '—';
  const tonnageUnit = sessionGrade.tonnage > 0 ? store.unit : '';

  let impactHtml = '';
  if (sessionGrade.impacts && sessionGrade.impacts.length > 0) {
    impactHtml = `
      <ul class="coach-grade-impacts">
        ${sessionGrade.impacts.map(imp =>
          `<li data-kind="${imp.icon || 'info'}">${imp.message}</li>`
        ).join('')}
      </ul>`;
  }

  return `
    <section class="coach-grade" data-grade="${sessionGrade.grade}">
      <div class="coach-grade-row">
        <span class="coach-grade-letter" style="color:${color}">${sessionGrade.grade}</span>
        <div class="coach-grade-meta">
          <p class="coach-grade-headline">${head.headline}</p>
          <p class="coach-grade-sub">${head.sub}</p>
        </div>
      </div>
      <dl class="coach-grade-stats">
        <div><dt>Complete</dt><dd>${sessionGrade.completionPct}%</dd></div>
        <div><dt>RPE drift</dt><dd>${driftStr}</dd></div>
        <div><dt>Tonnage</dt><dd>${tonnage}${tonnageUnit ? `<span class="coach-grade-unit">${tonnageUnit}</span>` : ''}</dd></div>
      </dl>
      ${impactHtml}
    </section>`;
}
