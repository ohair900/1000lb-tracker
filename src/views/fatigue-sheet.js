/**
 * Fatigue sheet body rendering — fatigue bar, fatigue detail views
 * with ACWR, recovery timeline, tonnage trends, and contributing exercises.
 */

import store from '../state/store.js';
import { $, fmtNum } from '../utils/helpers.js';
import { COLORS } from '../constants/lift-config.js';
import { MUSCLE_GROUPS } from '../data/muscle-groups.js';
import { displayWeight } from '../formulas/units.js';
import {
  calcFatigueByMuscle,
  calcFatigueDetail,
  getRecoveryAdvice,
} from '../systems/fatigue.js';
import { openFatigueSheet } from '../ui/sheet.js';
import { getCalibrationInfo } from '../systems/recovery-calibration.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeDay(ts) {
  if (!ts) return '';
  // Use midnight-to-midnight calendar-day diff, not raw timestamp diff.
  // Raw diff fails near midnight: a Friday 8 PM entry viewed Saturday 2 AM
  // would be 6 hours → 0 → "Today" instead of "Yesterday".
  const now = new Date();
  const then = new Date(ts);
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thenMidnight = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const days = Math.round((todayMidnight - thenMidnight) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return then.toLocaleDateString('en', { weekday: 'short' });
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Fatigue bar (dashboard widget)
// ---------------------------------------------------------------------------

/**
 * Update the fatigue bar widget on the dashboard.
 * Shows per-muscle-group fatigue status cards.
 */
export function updateFatigueBar() {
  const el = $('fatigue-bar');
  const byMuscle = calcFatigueByMuscle();
  if (!byMuscle) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  let html = '';
  MUSCLE_GROUPS.forEach(mg => {
    const f = byMuscle[mg];
    const st = f ? f.status : 'none';
    const val = f ? f.label : '&mdash;';
    html += `<div class="fatigue-card" data-muscle="${mg}">` +
      `<div class="fatigue-card-label">${mg}</div>` +
      `<div class="fatigue-card-status">` +
        `<span class="fatigue-dot ${st}"></span>` +
        `<span class="fatigue-level ${st}">${val}</span>` +
      `</div></div>`;
  });
  $('fatigue-row').innerHTML = html;
  $('fatigue-row').querySelectorAll('.fatigue-card[data-muscle]').forEach(card => {
    card.addEventListener('click', () => showFatigueDetail(card.dataset.muscle));
  });
}

// ---------------------------------------------------------------------------
// Fatigue detail (shown in fatigue sheet)
// ---------------------------------------------------------------------------

/**
 * Show detailed fatigue information for a specific muscle group.
 * @param {string} mg - Muscle group name (e.g. 'Quads', 'Back')
 */
export function showFatigueDetail(mg) {
  $('fatigue-sheet-title').textContent = mg;
  let html = '';

  const detail = calcFatigueDetail(mg);
  if (!detail) {
    html += '<div style="padding:24px 0;text-align:center;color:var(--text-dim)">Not enough data for ' + mg + ' (need 3+ entries in 28 days)</div>';
    $('fatigue-sheet-body').innerHTML = html;
    openFatigueSheet();
    return;
  }

  // Compute display status to match dashboard cards
  const rec = detail.recoveryEstimate;
  const recoveryPct = rec.percentRecovered;
  let displayStatus;
  if (detail.status === 'red') displayStatus = 'red';
  else if (detail.status === 'yellow' && recoveryPct !== null && recoveryPct < 0.15) displayStatus = 'red';
  else if (recoveryPct !== null && recoveryPct < 0.15) displayStatus = 'red';
  else if (detail.status === 'yellow' && recoveryPct !== null && recoveryPct < 0.4) displayStatus = 'orange';
  else if (recoveryPct !== null && recoveryPct < 0.4) displayStatus = 'orange';
  else if (recoveryPct !== null && recoveryPct < 0.7) displayStatus = 'yellow';
  else if (recoveryPct !== null && recoveryPct < 0.9) displayStatus = 'lime';
  else displayStatus = 'green';
  const displayColor = `var(--${displayStatus})`;
  let sectionIdx = 0;

  // 1. Recovery hero — leads with recovery % to match dashboard cards
  if (recoveryPct !== null) {
    const pct = Math.round(recoveryPct * 100);
    const hrsAgo = detail.hoursSince !== null ? Math.round(detail.hoursSince) : null;
    // Use calendar-day based label for day-level display to avoid timezone drift
    const lastStr = hrsAgo !== null
      ? (hrsAgo < 24 ? `${hrsAgo}h ago` : relativeDay(detail.lastTs))
      : 'N/A';
    html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
    html += `<div class="fatigue-detail-banner ${displayStatus}">` +
      `<span style="font-size:var(--text-2xl);font-weight:800">${pct}%</span>` +
      `<span style="font-size:var(--text-sm);opacity:0.8">recovered</span>` +
      `<span style="margin-left:auto;font-size:var(--text-xs);opacity:0.7">Last: ${lastStr}</span>` +
      `</div>`;
    html += `<div class="fatigue-recovery-track"><div class="fatigue-recovery-fill ${displayStatus}" style="width:${pct}%"></div></div>`;
    html += `<div class="fatigue-recovery-meta"><span>Est. ready: ${rec.readyLabel}</span><span>Base recovery: ~${Math.round(rec.baseHours)}h</span></div>`;
    html += `</div>`;
  }

  // 2. Recovery advice
  const advice = getRecoveryAdvice(detail);
  html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
  html += `<div class="fatigue-advice ${displayStatus}">${advice}</div>`;
  html += `</div>`;

  // 3. Stat grid
  const statusColor = `var(--${detail.status})`;
  html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
  html += `<div class="recap-stat-grid">` +
    `<div class="recap-stat"><div class="recap-stat-label">7-Day Load</div><div class="recap-stat-value">${detail.load7.toFixed(1)}</div></div>` +
    `<div class="recap-stat"><div class="recap-stat-label">Weekly Avg</div><div class="recap-stat-value">${detail.weeklyAvg28.toFixed(1)}</div></div>` +
    `<div class="recap-stat"><div class="recap-stat-label">ACWR</div><div class="recap-stat-value" style="color:${statusColor}">${detail.acwr !== null ? detail.acwr.toFixed(2) : '\u2014'}</div></div>` +
    `<div class="recap-stat"><div class="recap-stat-label">Sessions (28d)</div><div class="recap-stat-value">${detail.count28}</div></div>` +
    `</div>`;
  html += `</div>`;

  // Calibration confidence
  const calInfo = getCalibrationInfo(mg);
  if (calInfo.isCalibrated) {
    const confLabel = calInfo.confidence >= 0.7
      ? 'Personalized to your training'
      : `Learning your patterns (${Math.max(0, 24 - calInfo.sampleCount)} more sessions needed)`;
    html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
    html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:12px;display:flex;align-items:center;gap:6px">` +
      `<span>Your recovery: ~${calInfo.hours}h</span>` +
      `<span style="opacity:0.5">&middot;</span>` +
      `<span>${confLabel}</span>` +
      `</div>`;
    html += `</div>`;
  }

  // 4. Weekly tonnage trend
  html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
  const maxTrend = Math.max(...detail.weeklyTrend, 1);
  html += `<div class="section-label-lg">Weekly Load Trend</div>`;
  html += `<div class="fatigue-trend-chart">`;
  detail.weeklyTrend.forEach((val, i) => {
    const h = Math.max(2, (val / maxTrend) * 100);
    const color = i === 3 ? displayColor : 'var(--surface2)';
    html += `<div class="fatigue-trend-bar"><div class="fatigue-trend-bar-fill" style="height:${h}%;background:${color}"></div></div>`;
  });
  html += `</div>`;
  html += `<div class="fatigue-trend-labels"><span>W1</span><span>W2</span><span>W3</span><span>W4</span></div>`;
  html += `</div>`;

  // 6. Contributing exercises (top 5, simplified)
  const topContribs = detail.contributors.slice(0, 5);
  if (topContribs.length > 0) {
    html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
    const maxContrib = Math.max(...topContribs.map(c => c.load7), 1);
    html += `<div class="section-label-lg">Contributing Exercises</div>`;
    topContribs.forEach(c => {
      const pctBar = (c.load7 / maxContrib) * 100;
      const barColor = c.lift && COLORS[c.lift] ? COLORS[c.lift] : 'var(--text-dim)';
      const when = relativeDay(c.lastTs);
      const setsLabel = c.sets === 1 ? '1 set' : `${c.sets} sets`;
      html += `<div class="fatigue-contributor">` +
        `<span class="fatigue-contributor-name">${c.name}</span>` +
        `<span class="fatigue-contributor-meta">${setsLabel} &middot; ${when}</span>` +
        `<div class="fatigue-contributor-bar"><div class="fatigue-contributor-bar-fill" style="width:${pctBar}%;background:${barColor}"></div></div>` +
        `</div>`;
    });
    html += `</div>`;
  }

  $('fatigue-sheet-body').innerHTML = html;
  openFatigueSheet();
}

// ---------------------------------------------------------------------------
// Aliases for backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use updateFatigueBar instead */
export const renderFatigueSheet = updateFatigueBar;

/** @deprecated Use showFatigueDetail instead */
export const renderFatigueDetail = showFatigueDetail;
