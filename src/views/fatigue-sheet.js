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
import { renderBodyMap, initBodyMapEvents } from '../views/body-map.js';

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
  $('fatigue-sheet-title').textContent = mg + ' Fatigue';
  const byMuscle = calcFatigueByMuscle();
  const backMuscles = ['Back', 'Glutes', 'Hams'];
  const currentView = backMuscles.includes(mg) ? 'back' : 'front';
  let html = '';

  // Body map always shows at top
  html += renderBodyMap(byMuscle, mg, currentView);

  const detail = calcFatigueDetail(mg);
  if (!detail) {
    html += '<div style="padding:24px 0;text-align:center;color:var(--text-dim)">Not enough data for ' + mg + ' (need 3+ entries in 28 days)</div>';
    $('fatigue-sheet-body').innerHTML = html;
    // Attach body map events even with no detail data
    const bodyMapContainer = $('fatigue-sheet-body').querySelector('.body-map-container');
    if (bodyMapContainer) {
      initBodyMapEvents(
        bodyMapContainer,
        (muscle) => showFatigueDetail(muscle),
        (view) => {
          const newMapHtml = renderBodyMap(byMuscle, mg, view);
          bodyMapContainer.outerHTML = newMapHtml;
          const newContainer = $('fatigue-sheet-body').querySelector('.body-map-container');
          if (newContainer) initBodyMapEvents(newContainer, (m) => showFatigueDetail(m), () => showFatigueDetail(mg));
        }
      );
    }
    openFatigueSheet();
    return;
  }

  const statusColor = `var(--${detail.status})`;

  // 1. Status banner
  html += `<div class="fatigue-detail-banner ${detail.status}">` +
    `<span class="fatigue-dot ${detail.status}"></span>` +
    `<span>${detail.label} Fatigue</span>` +
    `<span style="margin-left:auto;font-size:var(--text-sm);opacity:0.8">ACWR ${detail.acwr !== null ? detail.acwr.toFixed(2) : '\u2014'}</span>` +
    `</div>`;

  // 2. Stat grid
  html += `<div class="recap-stat-grid">` +
    `<div class="recap-stat"><div class="recap-stat-label">7-Day Load</div><div class="recap-stat-value">${detail.load7.toFixed(1)}</div></div>` +
    `<div class="recap-stat"><div class="recap-stat-label">Weekly Avg Load</div><div class="recap-stat-value">${detail.weeklyAvg28.toFixed(1)}</div></div>` +
    `<div class="recap-stat"><div class="recap-stat-label">ACWR Ratio</div><div class="recap-stat-value" style="color:${statusColor}">${detail.acwr !== null ? detail.acwr.toFixed(2) : '\u2014'}</div></div>` +
    `<div class="recap-stat"><div class="recap-stat-label">Data Points (28d)</div><div class="recap-stat-value">${detail.count28}</div></div>` +
    `</div>`;

  // 3. Recovery timeline
  const rec = detail.recoveryEstimate;
  if (rec.percentRecovered !== null) {
    const pct = Math.round(rec.percentRecovered * 100);
    const hrsAgo = detail.hoursSince !== null ? Math.round(detail.hoursSince) : null;
    const lastStr = hrsAgo !== null ? (hrsAgo < 24 ? `${hrsAgo}h ago` : `${Math.round(hrsAgo / 24)}d ago`) : 'N/A';
    html += `<div class="section-label-lg">Recovery (${pct}%)</div>`;
    html += `<div class="fatigue-recovery-track"><div class="fatigue-recovery-fill ${detail.status}" style="width:${pct}%"></div></div>`;
    html += `<div class="fatigue-recovery-meta"><span>Last trained: ${lastStr}</span><span>Est. ready: ${rec.readyLabel}</span></div>`;
  }

  // 4. Recovery advice + calibration info
  const advice = getRecoveryAdvice(detail);
  html += `<div class="fatigue-advice ${detail.status}">${advice}</div>`;

  // Calibration confidence
  const calInfo = getCalibrationInfo(mg);
  if (calInfo.isCalibrated) {
    const confPct = Math.round(calInfo.confidence * 100);
    const confLabel = calInfo.confidence >= 0.7
      ? 'Personalized to your training'
      : `Learning your patterns (${Math.max(0, 24 - calInfo.sampleCount)} more sessions needed)`;
    html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-bottom:12px;display:flex;align-items:center;gap:6px">` +
      `<span>Your recovery: ~${calInfo.hours}h</span>` +
      `<span style="opacity:0.5">&middot;</span>` +
      `<span>${confLabel}</span>` +
      `</div>`;
  }

  // 5. Weekly tonnage trend
  const maxTrend = Math.max(...detail.weeklyTrend, 1);
  html += `<div class="section-label-lg">Weekly Load Trend</div>`;
  html += `<div class="fatigue-trend-chart">`;
  detail.weeklyTrend.forEach((val, i) => {
    const h = Math.max(2, (val / maxTrend) * 100);
    const color = i === 3 ? statusColor : 'var(--surface2)';
    html += `<div class="fatigue-trend-bar"><div class="fatigue-trend-bar-fill" style="height:${h}%;background:${color}"></div></div>`;
  });
  html += `</div>`;
  html += `<div class="fatigue-trend-labels"><span>W1</span><span>W2</span><span>W3</span><span>W4</span></div>`;

  // 6. Contributing exercises
  if (detail.contributors.length > 0) {
    const maxContrib = Math.max(...detail.contributors.map(c => c.load7), 1);
    html += `<div class="section-label-lg">Contributing Exercises</div>`;
    detail.contributors.forEach(c => {
      const pctBar = (c.load7 / maxContrib) * 100;
      const barColor = c.lift && COLORS[c.lift] ? COLORS[c.lift] : 'var(--text-dim)';
      const badgeBg = c.type === 'Main' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
      const badgeColor = c.type === 'Main' ? 'var(--text)' : 'var(--text-dim)';
      html += `<div class="fatigue-contributor">` +
        `<span class="fatigue-contributor-name">${c.name}</span>` +
        `<span class="fatigue-contributor-badge" style="background:${badgeBg};color:${badgeColor}">${c.type}</span>` +
        `<span style="font-size:var(--text-xs);color:var(--text-dim)">${Math.round(c.muscleWeight * 100)}%</span>` +
        `<div class="fatigue-contributor-bar"><div class="fatigue-contributor-bar-fill" style="width:${pctBar}%;background:${barColor}"></div></div>` +
        `<span class="fatigue-contributor-vol">${c.load7.toFixed(1)}</span>` +
        `</div>`;
    });
  }

  $('fatigue-sheet-body').innerHTML = html;

  // Initialize body map interactions
  const bodyMapContainer = $('fatigue-sheet-body').querySelector('.body-map-container');
  if (bodyMapContainer) {
    initBodyMapEvents(
      bodyMapContainer,
      (muscle) => showFatigueDetail(muscle), // Navigate to tapped muscle
      (view) => {
        // Re-render body map with new view
        const mapEl = bodyMapContainer;
        const newMapHtml = renderBodyMap(byMuscle, mg, view);
        mapEl.outerHTML = newMapHtml;
        // Re-attach events on new DOM
        const newContainer = $('fatigue-sheet-body').querySelector('.body-map-container');
        if (newContainer) {
          initBodyMapEvents(
            newContainer,
            (muscle) => showFatigueDetail(muscle),
            (v) => {
              // Recursive toggle — simplified: just re-render the whole detail
              showFatigueDetail(mg);
            }
          );
          // Update toggle state
          newContainer.querySelectorAll('.body-map-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
          });
        }
      }
    );
  }

  openFatigueSheet();
}

// ---------------------------------------------------------------------------
// Aliases for backward compatibility
// ---------------------------------------------------------------------------

/** @deprecated Use updateFatigueBar instead */
export const renderFatigueSheet = updateFatigueBar;

/** @deprecated Use showFatigueDetail instead */
export const renderFatigueDetail = showFatigueDetail;
