/**
 * Stats tab view — badges, relative strength, records board, volume,
 * meet prep, training cycles, PR timeline, training insights,
 * period comparison, goals, milestone roadmap, year in review,
 * data management, and mesocycle overview.
 */

import store from '../state/store.js';
import { $, fmtNum, escapeHTML } from '../utils/helpers.js';
import { statsSection, SECTION_CLOSE } from '../utils/html.js';
import { LIFTS, COLORS, LIFT_SHORT, LIFT_NAMES, PLATE_MILESTONES, REP_RANGES } from '../constants/lift-config.js';
import { MS_PER_DAY } from '../constants/time.js';
import { STATS_COLLAPSED_KEY } from '../constants/storage-keys.js';
import { BADGE_DEFINITIONS } from '../data/badges.js';
import { bestE1RM, getTotal } from '../formulas/e1rm.js';
import { displayWeight, formatWeight, lbsToKg, inputToLbs } from '../formulas/units.js';
import { calcWilks, calcDOTS } from '../formulas/scoring.js';
import { getClassification, getOverallClassification, getWeightClass } from '../formulas/standards.js';
import { getRepPRs } from '../systems/pr-tracking.js';
import { calcVolumeSummaries, getProjectedTotal, suggestAttempts } from '../systems/volume.js';
import { calcGoalProjection, calcMilestoneRoadmap } from '../systems/goals.js';
import { getAccessorySummaries } from '../systems/accessory-progress.js';
import { showAccessoryDetail } from './accessory-detail.js';
import { showToast } from '../ui/toast.js';
import { sharePRCard, shareOrDownloadCanvas } from '../ui/share.js';

// ---------------------------------------------------------------------------
// Late-bound callbacks
// ---------------------------------------------------------------------------

let _updateDashboard = null;
let _renderCycleBar = null;
let _exportData = null;
let _exportCSV = null;
let _showMesoWeekDetail = null;

/**
 * Inject view-level dependencies.
 * @param {object} deps
 */
export function injectStatsDeps(deps) {
  if (deps.updateDashboard) _updateDashboard = deps.updateDashboard;
  if (deps.renderCycleBar) _renderCycleBar = deps.renderCycleBar;
  if (deps.exportData) _exportData = deps.exportData;
  if (deps.exportCSV) _exportCSV = deps.exportCSV;
  if (deps.showMesoWeekDetail) _showMesoWeekDetail = deps.showMesoWeekDetail;
}

// ---------------------------------------------------------------------------
// Helper: calcBestTrainingDay (not extracted to a system yet)
// ---------------------------------------------------------------------------

function calcBestTrainingDay() {
  if (store.entries.length < 10) return null;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const byDay = {};
  store.entries.forEach(e => {
    const d = new Date(e.date + 'T12:00:00').getDay();
    if (!byDay[d]) byDay[d] = { total: 0, count: 0 };
    byDay[d].total += e.e1rm;
    byDay[d].count++;
  });
  const results = [];
  for (let d = 0; d < 7; d++) {
    if (byDay[d] && byDay[d].count >= 3) {
      results.push({ day: d, name: dayNames[d], avg: byDay[d].total / byDay[d].count, count: byDay[d].count });
    }
  }
  if (results.length === 0) return null;
  results.sort((a, b) => b.avg - a.avg);
  return results;
}

// ---------------------------------------------------------------------------
// Profile / Goals HTML builders (shared with settings)
// ---------------------------------------------------------------------------

export function buildProfileHTML() {
  let html = `<div class="gender-pills">
      <button class="gender-pill${store.profile.gender === 'male' ? ' active' : ''}" data-gender="male">Male</button>
      <button class="gender-pill${store.profile.gender === 'female' ? ' active' : ''}" data-gender="female">Female</button>
    </div>
    <div class="bw-row">
      <div class="input-group"><label>Bodyweight (<span class="unit-label">${store.unit}</span>)</label>
        <input type="number" id="bw-input" value="${store.profile.bodyweight ? displayWeight(store.profile.bodyweight) : ''}" placeholder="0" inputmode="decimal" step="any">
      </div>
      <button class="bw-log-btn" id="bw-log-btn">Log</button>
    </div>`;
  const wc = getWeightClass();
  if (wc) {
    html += `<div class="weight-class-card">
      <div style="flex:1">
        <div class="weight-class-label">IPF Weight Class</div>
        <div class="weight-class-value">${wc.className}</div>
      </div>
      <div style="text-align:right">
        <div class="weight-class-detail">${wc.bwKg} kg</div>
        ${!wc.isPlus && wc.distToLimit !== null ? `<div class="weight-class-detail">${wc.distToLimit} kg to limit</div>` : ''}
      </div>
    </div>`;
  }
  return html;
}

export function buildGoalsHTML(total) {
  let html = '';
  ['squat', 'bench', 'deadlift', 'total'].forEach(lift => {
    const cur = lift === 'total' ? total : bestE1RM(lift);
    const goal = store.goals[lift];
    const pct = (cur && goal) ? Math.min(100, cur / goal * 100) : 0;
    const name = lift === 'total' ? 'Total' : LIFT_NAMES[lift];
    html += `<div class="goal-row">
      <div class="goal-info">
        <span class="goal-lift" style="color:${COLORS[lift]}">${name}</span>
        <span class="goal-current">${cur ? formatWeight(cur) : '\u2014'} /</span>
        <input type="number" class="goal-input" data-lift="${lift}" value="${goal ? displayWeight(goal) : ''}" placeholder="Target" inputmode="decimal" step="any">
        <span class="goal-unit">${store.unit}</span>
      </div>
      ${goal ? `<div class="goal-track"><div class="goal-fill" style="width:${pct}%;background:${COLORS[lift]}"></div></div>
      <div class="goal-pct">${Math.round(pct)}%</div>` : ''}`;
    if (lift !== 'total' && goal && cur && cur < goal) {
      const proj = calcGoalProjection(lift);
      if (proj) {
        const estLabel = proj.estDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        const via = proj.program || 'historical rate';
        html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-top:2px">Est. ${estLabel} via ${via} (~${proj.weeksNeeded} weeks)</div>`;
      }
    }
    html += `</div>`;
  });
  return html;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderStatsBadges() {
  const totalBadges = BADGE_DEFINITIONS.length;
  const unlockedCount = Object.keys(store.unlockedBadges).length;
  let html = statsSection('badges', `Badges (${unlockedCount}/${totalBadges})`, store.statsCollapsed);
  const categories = ['consistency', 'strength', 'milestones', 'volume'];
  const catLabels = { consistency: 'Consistency', strength: 'Strength', milestones: 'Milestones', volume: 'Volume' };
  categories.forEach(cat => {
    const badges = BADGE_DEFINITIONS.filter(b => b.category === cat);
    html += `<div class="badge-category-label">${catLabels[cat]}</div><div class="badge-grid">`;
    badges.forEach(b => {
      const unlocked = store.unlockedBadges[b.id];
      if (unlocked) {
        const d = new Date(unlocked.date + 'T12:00:00');
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        html += `<div class="badge-card"><span class="badge-icon">${b.icon}</span><div class="badge-name">${b.name}</div><div class="badge-date">${dateStr}</div></div>`;
      } else {
        html += `<div class="badge-card locked"><span class="badge-icon">${b.icon}</span><div class="badge-name">???</div><div class="badge-date" style="font-style:italic">${b.desc}</div></div>`;
      }
    });
    html += `</div>`;
  });
  return html + SECTION_CLOSE;
}

function renderStatsRelativeStrength(total) {
  let html = statsSection('relative-strength', 'Relative Strength', store.statsCollapsed);
  if (total && store.profile.gender && store.profile.bodyweight) {
    const tKg = lbsToKg(total), bKg = lbsToKg(store.profile.bodyweight);
    const wi = calcWilks(tKg, bKg, store.profile.gender);
    const dt = calcDOTS(tKg, bKg, store.profile.gender);
    html += `<div class="score-cards">
      <div class="score-card"><div class="score-label">Wilks</div><div class="score-value">${wi ? Math.round(wi) : '\u2014'}</div></div>
      <div class="score-card"><div class="score-label">DOTS</div><div class="score-value">${dt ? Math.round(dt) : '\u2014'}</div></div>
    </div>`;
  } else {
    html += `<div class="stats-hint">Set gender &amp; bodyweight in \u2699 Settings, then log all 3 lifts</div>`;
  }
  return html + SECTION_CLOSE;
}

function renderStatsRecordsBoard() {
  let html = statsSection('records-board', 'Records Board', store.statsCollapsed);
  if (store.entries.length > 0) {
    const repPRs = getRepPRs();
    html += `<div class="records-grid">
      <div class="rg-header"></div>`;
    REP_RANGES.forEach(r => { html += `<div class="rg-header">${r}RM</div>`; });
    LIFTS.forEach(lift => {
      html += `<div class="rg-lift" style="color:${COLORS[lift]}">${LIFT_SHORT[lift]}</div>`;
      REP_RANGES.forEach(r => {
        const best = repPRs[lift][r];
        if (best) {
          const isRecent = (Date.now() - new Date(best.date + 'T12:00:00').getTime()) < 30 * MS_PER_DAY;
          html += `<div class="rg-cell${isRecent ? ' pr-cell' : ''}">${formatWeight(best.weight)}</div>`;
        } else {
          html += `<div class="rg-cell" style="color:var(--text-dim)">\u2014</div>`;
        }
      });
    });
    html += `</div>`;
  } else {
    html += `<div class="stats-hint">Log sets to see your records</div>`;
  }
  return html + SECTION_CLOSE;
}

function renderStatsVolume() {
  let html = statsSection('volume', 'Volume', store.statsCollapsed);
  if (store.entries.length > 0) {
    html += `<div class="vol-period-toggle">
      <button class="vol-period-btn${store.volPeriod === 'weekly' ? ' active' : ''}" data-period="weekly">Weekly</button>
      <button class="vol-period-btn${store.volPeriod === 'monthly' ? ' active' : ''}" data-period="monthly">Monthly</button>
    </div>`;
    const summaries = calcVolumeSummaries(store.volPeriod);
    if (summaries.length > 0) {
      const maxTotal = Math.max(...summaries.map(s => s.total));
      summaries.forEach(s => {
        const changeStr = s.change !== null ? `<span class="vol-change ${s.change >= 0 ? 'up' : 'down'}">${s.change >= 0 ? '\u2191' : '\u2193'}${Math.abs(s.change).toFixed(0)}%</span>` : '';
        const label = store.volPeriod === 'weekly' ? s.key.split('-W')[1] ? 'W' + s.key.split('-W')[1] : s.key : new Date(s.key + '-01T12:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        html += `<div class="vol-row">
          <span class="vol-period-label">${label}</span>
          <div class="vol-bars">`;
        LIFTS.forEach(l => {
          const pct = maxTotal > 0 ? (s[l] / maxTotal * 100) : 0;
          if (pct > 0) html += `<div class="vol-bar-seg" style="width:${pct}%;background:${COLORS[l]}"></div>`;
        });
        html += `</div>
          <span class="vol-total">${fmtNum(displayWeight(s.total))}</span>
          ${changeStr}
        </div>`;
      });
      html += `<div style="font-size:var(--text-xs);color:var(--text-dim);margin-top:6px">${summaries[0].sets} sets &middot; ${summaries[0].reps} reps this ${store.volPeriod === 'weekly' ? 'week' : 'month'}</div>`;
    }
  } else {
    html += `<div class="stats-hint">Log sets to see volume trends</div>`;
  }
  return html + SECTION_CLOSE;
}

function renderStatsMeetPrep() {
  let html = statsSection('meet-prep', 'Meet Prep', store.statsCollapsed);
  const proj = getProjectedTotal();
  if (proj.total) {
    html += `<div style="font-size:var(--text-sm);color:var(--text-dim);margin-bottom:10px">Projected conservative total (95% of recent e1RM)</div>`;
    html += `<div class="attempt-grid">
      <div class="ag-header"></div><div class="ag-header">Opener</div><div class="ag-header">2nd</div><div class="ag-header">3rd</div>`;
    LIFTS.forEach(lift => {
      const est = proj[lift];
      const opener = est ? Math.round(est * 0.9 / 2.5) * 2.5 : 0;
      const att = opener ? suggestAttempts(opener) : { second: 0, third: 0 };
      html += `<div class="ag-lift" style="color:${COLORS[lift]}">${LIFT_NAMES[lift]}</div>`;
      html += `<div class="ag-cell"><input type="number" class="attempt-input" data-lift="${lift}" value="${opener ? displayWeight(opener) : ''}" placeholder="\u2014" inputmode="decimal" step="any"></div>`;
      html += `<div class="ag-cell" id="att2-${lift}">${att.second ? formatWeight(att.second) : '\u2014'}</div>`;
      html += `<div class="ag-cell" id="att3-${lift}">${att.third ? formatWeight(att.third) : '\u2014'}</div>`;
    });
    html += `</div>`;
    html += `<div class="meet-total">
      <div class="meet-total-label">Projected Total</div>
      <div class="meet-total-value">${formatWeight(proj.total)} ${store.unit}</div>
    </div>`;
  } else {
    html += `<div class="stats-hint">Log all 3 lifts in the last 8 weeks to see projections</div>`;
  }
  return html + SECTION_CLOSE;
}

function renderStatsGoals(total) {
  return statsSection('goals', 'Goals', store.statsCollapsed) + buildGoalsHTML(total) + SECTION_CLOSE;
}

function buildMilestoneRoadmapHTML() {
  const roadmapLifts = LIFTS.filter(lift => {
    const cur = bestE1RM(lift);
    const goal = store.goals[lift];
    return goal && cur && cur < goal;
  });
  if (roadmapLifts.length === 0) return '';
  let html = '';
  roadmapLifts.forEach(lift => {
    const rm = calcMilestoneRoadmap(lift);
    if (!rm) return;
    html += `<div style="margin-bottom:16px">
      <div style="font-size:var(--text-base);font-weight:600;color:${COLORS[lift]};margin-bottom:8px">${LIFT_NAMES[lift]}</div>
      <div style="position:relative;padding-left:16px">`;
    html += `<div style="position:absolute;left:5px;top:4px;bottom:4px;width:2px;background:var(--border)"></div>`;
    rm.milestones.forEach(ms => {
      const dotColor = ms.achieved ? COLORS[lift] : 'var(--border)';
      const textColor = ms.achieved ? 'var(--text)' : 'var(--text-dim)';
      const estLabel = ms.estDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      html += `<div style="position:relative;padding:4px 0 8px 12px;font-size:var(--text-sm);color:${textColor}">
        <div style="position:absolute;left:-3px;top:7px;width:10px;height:10px;border-radius:50%;background:${dotColor};border:2px solid var(--surface)"></div>
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span><strong>${formatWeight(ms.target)} ${store.unit}</strong> <span style="font-size:var(--text-xs)">${ms.label}</span></span>
          <span style="font-size:var(--text-xs);color:var(--text-dim)">${ms.achieved ? 'Achieved' : estLabel + ' (~' + ms.weeksAway + 'w)'}</span>
        </div>
      </div>`;
    });
    html += `</div></div>`;
  });
  return html;
}

function renderStatsMilestoneRoadmap() {
  const html = buildMilestoneRoadmapHTML();
  if (!html) return '';
  return statsSection('milestone-roadmap', 'Milestone Roadmap', store.statsCollapsed) + html + SECTION_CLOSE;
}

function renderStatsCycles() {
  let html = statsSection('training-cycles', 'Training Cycles', store.statsCollapsed);
  if (store.cycles.length > 0) {
    store.cycles.slice().reverse().forEach(cy => {
      const cycleEntries = store.entries.filter(e => e.cycleId === cy.id);
      const vol = cycleEntries.reduce((s, e) => s + e.weight * e.reps, 0);
      const sets = cycleEntries.length;
      const statusLabel = cy.active ? '<span style="color:#43a047">Active</span>' : (cy.endDate || 'Ended');
      html += `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:var(--text-base)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${cy.name}</strong> <span style="font-size:var(--text-sm);color:var(--text-dim)">${cy.type} &middot; ${statusLabel}</span>
        </div>
        <div style="font-size:var(--text-sm);color:var(--text-dim);margin-top:2px">${sets} sets &middot; ${fmtNum(displayWeight(vol))} ${store.unit} volume &middot; Started ${cy.startDate}</div>
        ${cy.active ? `<button class="timer-btn" data-end-cycle="${cy.id}" style="margin-top:4px">End Cycle</button>` : ''}
      </div>`;
    });
  } else {
    html += `<div class="stats-hint">Use the cycle bar in the Log tab to start tracking training phases</div>`;
  }
  return html + SECTION_CLOSE;
}

function renderStatsPRTimeline() {
  let html = statsSection('pr-timeline', 'PR Timeline', store.statsCollapsed);
  if (store.prs.length > 0) {
    const sorted = [...store.prs].sort((a, b) => b.timestamp - a.timestamp);
    html += `<div class="pr-timeline">`;
    sorted.forEach(pr => {
      const d = new Date(pr.date + 'T12:00:00');
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const name = LIFT_NAMES[pr.lift] || pr.lift;
      let milestoneHtml = '';
      if (pr.milestone) {
        const idx = PLATE_MILESTONES.indexOf(parseInt(pr.milestone));
        milestoneHtml = `<span class="milestone-badge">${idx + 1} plate${idx > 0 ? 's' : ''}</span>`;
      }
      html += `<div class="pr-item">
        <div class="pr-dot" style="background:${COLORS[pr.lift]}"></div>
        <div class="pr-content">
          <div class="pr-main"><span style="color:${COLORS[pr.lift]}">${name}</span> <strong>${formatWeight(pr.e1rm)} ${store.unit}</strong> ${milestoneHtml}
            <button class="toast-share" onclick="return false" data-share-lift="${pr.lift}" data-share-e1rm="${pr.e1rm}" data-share-date="${pr.date}" style="font-size:var(--text-xs);padding:1px 6px;vertical-align:middle">Share</button>
          </div>
          <div class="pr-date">${label}</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="stats-hint">No PRs yet \u2014 start logging!</div>`;
  }
  return html + SECTION_CLOSE;
}

function renderStatsInsights() {
  let html = statsSection('training-insights', 'Training Insights', store.statsCollapsed);
  const btd = calcBestTrainingDay();
  if (btd && btd.length > 0) {
    html += `<div style="font-size:var(--text-sm);color:var(--text-dim);margin-bottom:8px">Your strongest day is <strong style="color:var(--text)">${btd[0].name}</strong></div>`;
    const maxAvg = btd[0].avg;
    btd.forEach(d => {
      const pct = maxAvg > 0 ? (d.avg / maxAvg * 100) : 0;
      html += `<div class="vol-row">
        <span class="vol-period-label" style="min-width:32px">${d.name.slice(0, 3)}</span>
        <div class="vol-bars"><div class="vol-bar-seg" style="width:${pct}%;background:var(--bench)"></div></div>
        <span class="vol-total">${formatWeight(d.avg)}</span>
      </div>`;
    });
  } else {
    html += `<div class="stats-hint">Need 10+ entries with 3+ per day shown</div>`;
  }
  return html + SECTION_CLOSE;
}

function renderStatsPeriodComparison() {
  let html = statsSection('period-comparison', 'Period Comparison', store.statsCollapsed);
  html += `<div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
    <select class="compare-select" id="compare-a">
      <option value="this-month">This Month</option>
      <option value="last-month" selected>Last Month</option>
      <option value="last-30">Last 30d</option>
      <option value="last-90">Last 90d</option>
    </select>
    <span style="color:var(--text-dim);font-size:var(--text-sm)">vs</span>
    <select class="compare-select" id="compare-b">
      <option value="this-month" selected>This Month</option>
      <option value="last-month">Last Month</option>
      <option value="last-30">Last 30d</option>
      <option value="last-90">Last 90d</option>
    </select>
  </div>
  <div id="compare-results"></div>`;
  return html + SECTION_CLOSE;
}

function renderStatsYIR() {
  let html = statsSection('year-in-review', 'Year in Review', store.statsCollapsed);
  html += `<button class="data-btn" id="yir-btn" style="width:100%">Generate ${new Date().getFullYear()} Review</button>`;
  html += `<div id="yir-content"></div>`;
  return html + SECTION_CLOSE;
}

function renderStatsMesocycle() {
  const meso = store.activeMesocycle;
  if (!meso || meso.status !== 'active') return '';
  const isCollapsed = store.statsCollapsed['mesocycle'];
  const week = meso.weeks[meso.currentWeek - 1];
  const completedWeeks = meso.weeks.filter(w => w.completed).length;
  const pct = Math.round((completedWeeks / meso.durationWeeks) * 100);

  let html = `<div class="stats-section${isCollapsed ? ' collapsed' : ''}">
    <div class="stats-header" data-toggle="mesocycle"><span>Mesocycle</span><span class="collapse-arrow">${isCollapsed ? '&#9654;' : '&#9660;'}</span></div>
    <div class="stats-body">
      <div style="font-weight:700;color:var(--text-strong);margin-bottom:8px">${escapeHTML(meso.name)}</div>
      <div class="recap-stat-grid">
        <div class="recap-stat"><div class="recap-stat-label">Week</div><div class="recap-stat-value">${meso.currentWeek}/${meso.durationWeeks}</div></div>
        <div class="recap-stat"><div class="recap-stat-label">Phase</div><div class="recap-stat-value">${week ? week.phase : '-'}</div></div>
        <div class="recap-stat"><div class="recap-stat-label">Progress</div><div class="recap-stat-value">${pct}%</div></div>
        <div class="recap-stat"><div class="recap-stat-label">Adaptations</div><div class="recap-stat-value">${meso.adaptationLog.length}</div></div>
      </div>
      <div class="meso-timeline" style="margin-top:8px">`;
  meso.weeks.forEach((w, i) => {
    const isCurrent = i === meso.currentWeek - 1;
    const liftsDone = LIFTS.filter(l => w.performance[l]).length;
    html += `<div class="meso-week-card${isCurrent ? ' current' : ''}${w.completed ? ' completed' : ''}${w.adapted ? ' adapted' : ''}" data-meso-stat-week="${i}">
      <div class="meso-week-num">W${w.weekNum}</div>
      <div class="meso-week-phase">${w.phase}</div>
      ${w.completed ? '<div class="meso-week-check">&#10003;</div>' : `<div class="meso-week-check">${'&#10003;'.repeat(liftsDone)}</div>`}
    </div>`;
  });
  html += `</div>`;
  if (meso.adaptationLog.length > 0) {
    html += `<div style="margin-top:8px">`;
    meso.adaptationLog.slice(-3).forEach(a => {
      html += `<div style="font-size:var(--text-xs);color:var(--gold);padding:2px 0">W${a.weekNum} ${LIFT_NAMES[a.lift]}: ${a.adjustment}</div>`;
    });
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function renderStatsAccessoryProgress() {
  let html = statsSection('accessory-progress', 'Accessory Progress', store.statsCollapsed);
  const summaries = getAccessorySummaries();
  if (summaries.size === 0) {
    html += `<div style="color:var(--text-dim);font-size:var(--text-sm);padding:var(--space-2) 0">Complete workouts with accessories to see progress here.</div>`;
    return html + SECTION_CLOSE;
  }

  // Group by main lift
  const groups = { squat: [], bench: [], deadlift: [] };
  for (const [, s] of summaries) {
    if (groups[s.mainLift]) groups[s.mainLift].push(s);
  }

  const TREND_ARROWS = { up: '\u2191', down: '\u2193', flat: '\u2192' };
  const GROUP_LABELS = { squat: 'Squat', bench: 'Bench', deadlift: 'Deadlift' };

  for (const [lift, exercises] of Object.entries(groups)) {
    if (exercises.length === 0) continue;
    html += `<div class="acc-progress-group-header" style="color:${COLORS[lift]}">${GROUP_LABELS[lift]} Accessories</div>`;
    html += `<div class="acc-progress-list">`;
    for (const s of exercises) {
      const w = s.bestWeight === 0 ? 'BW' : formatWeight(s.lastWeight) + ' ' + store.unit;
      const arrow = TREND_ARROWS[s.trend];
      html += `<div class="acc-progress-row" data-exercise-id="${s.exerciseId}">`;
      html += `<div class="acc-progress-dot ${s.mainLift}"></div>`;
      html += `<div class="acc-progress-info">`;
      html += `<div class="acc-progress-name">${escapeHTML(s.name)}${s.readyToProgress ? '<span class="acc-progress-badge">Ready</span>' : ''}</div>`;
      html += `<div class="acc-progress-meta">${s.sessionCount} session${s.sessionCount !== 1 ? 's' : ''} &bull; ${s.equipment} &bull; ${s.lastDate}</div>`;
      html += `</div>`;
      html += `<div class="acc-progress-right">`;
      html += `<div class="acc-progress-weight">${w}</div>`;
      html += `<div class="acc-progress-trend ${s.trend}">${arrow}</div>`;
      html += `</div></div>`;
    }
    html += `</div>`;
  }

  return html + SECTION_CLOSE;
}

// ---------------------------------------------------------------------------
// Main renderStats()
// ---------------------------------------------------------------------------

/**
 * Render the full Stats tab content.
 */
export function renderStats() {
  const c = $('stats-content');
  const total = getTotal();
  c.innerHTML = [
    renderStatsMesocycle(),
    renderStatsBadges(),
    renderStatsRelativeStrength(total),
    renderStatsRecordsBoard(),
    renderStatsVolume(),
    renderStatsAccessoryProgress(),
    renderStatsMeetPrep(),
    renderStatsCycles(),
    renderStatsPRTimeline(),
    renderStatsInsights(),
    renderStatsPeriodComparison(),
    renderStatsGoals(total),
    renderStatsMilestoneRoadmap(),
    renderStatsYIR()
  ].join('');
  attachStatsListeners();
}

// ---------------------------------------------------------------------------
// attachStatsListeners — wire up dynamic listeners after render
// ---------------------------------------------------------------------------

function attachStatsListeners() {
  // Collapsible section headers
  document.querySelectorAll('.stats-header[data-toggle]').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const id = hdr.dataset.toggle;
      const section = hdr.closest('.stats-section');
      section.classList.toggle('collapsed');
      const isCollapsed = section.classList.contains('collapsed');
      store.statsCollapsed[id] = isCollapsed;
      localStorage.setItem(STATS_COLLAPSED_KEY, JSON.stringify(store.statsCollapsed));
    });
  });

  // Mesocycle week detail clicks
  document.querySelectorAll('[data-meso-stat-week]').forEach(card => {
    card.addEventListener('click', () => {
      if (_showMesoWeekDetail) _showMesoWeekDetail(parseInt(card.dataset.mesoStatWeek));
    });
  });

  // Accessory progress rows
  document.querySelectorAll('.acc-progress-row[data-exercise-id]').forEach(row => {
    row.addEventListener('click', () => showAccessoryDetail(row.dataset.exerciseId));
  });

  // Volume period toggle
  document.querySelectorAll('.vol-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      store.volPeriod = btn.dataset.period;
      renderStats();
    });
  });

  // Attempt inputs
  document.querySelectorAll('.attempt-input').forEach(input => {
    input.addEventListener('input', () => {
      const lift = input.dataset.lift;
      const v = parseFloat(input.value);
      if (v > 0) {
        const openerLbs = inputToLbs(v);
        const att = suggestAttempts(openerLbs);
        const att2El = document.getElementById('att2-' + lift);
        const att3El = document.getElementById('att3-' + lift);
        if (att2El) att2El.textContent = formatWeight(att.second);
        if (att3El) att3El.textContent = formatWeight(att.third);
      }
    });
  });

  // End cycle buttons
  document.querySelectorAll('[data-end-cycle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.endCycle;
      const cy = store.cycles.find(c => c.id === id);
      if (cy) {
        cy.active = false;
        cy.endDate = new Date().toISOString().split('T')[0];
        store.activeCycleId = null;
        store.saveCycles();
        if (_renderCycleBar) _renderCycleBar();
        renderStats();
        showToast('Cycle ended: ' + cy.name);
      }
    });
  });

  // Share PR buttons
  document.querySelectorAll('[data-share-lift]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const lift = btn.dataset.shareLift;
      const e1rm = parseFloat(btn.dataset.shareE1rm);
      const date = btn.dataset.shareDate;
      const bestWeight = store.entries.filter(en => en.lift === lift && en.e1rm === e1rm)[0]?.weight || e1rm;
      sharePRCard(lift, bestWeight, e1rm, date);
    });
  });

  // Period comparison
  const compareA = $('compare-a'), compareB = $('compare-b');
  if (compareA && compareB) {
    function runComparison() {
      function getPeriodRange(val) {
        const now = new Date(), day = MS_PER_DAY;
        if (val === 'this-month') return { start: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01', end: now.toISOString().split('T')[0] };
        if (val === 'last-month') {
          const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const lme = new Date(now.getFullYear(), now.getMonth(), 0);
          return { start: lm.toISOString().split('T')[0], end: lme.toISOString().split('T')[0] };
        }
        if (val === 'last-30') return { start: new Date(Date.now() - 30 * day).toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
        if (val === 'last-90') return { start: new Date(Date.now() - 90 * day).toISOString().split('T')[0], end: now.toISOString().split('T')[0] };
        return { start: '2000-01-01', end: now.toISOString().split('T')[0] };
      }
      function calcPeriodStats(start, end) {
        const pe = store.entries.filter(e => e.date >= start && e.date <= end);
        return {
          sets: pe.length,
          volume: pe.reduce((s, e) => s + e.weight * e.reps, 0),
          trainingDays: new Set(pe.map(e => e.date)).size,
          prs: pe.filter(e => e.isPR).length,
          squat: Math.max(0, ...pe.filter(e => e.lift === 'squat').map(e => e.e1rm)),
          bench: Math.max(0, ...pe.filter(e => e.lift === 'bench').map(e => e.e1rm)),
          deadlift: Math.max(0, ...pe.filter(e => e.lift === 'deadlift').map(e => e.e1rm)),
        };
      }
      const rA = getPeriodRange(compareA.value), rB = getPeriodRange(compareB.value);
      const sA = calcPeriodStats(rA.start, rA.end), sB = calcPeriodStats(rB.start, rB.end);
      function ind(a, b) { return a > b ? '<span class="compare-indicator up">\u2191</span>' : a < b ? '<span class="compare-indicator down">\u2193</span>' : '<span class="compare-indicator same">=</span>'; }
      const cRes = $('compare-results');
      cRes.innerHTML = `<div class="compare-grid">
        <div class="compare-label">Overview</div>
        <div class="compare-val">${sA.sets} sets</div>${ind(sA.sets, sB.sets)}<div class="compare-val">${sB.sets} sets</div>
        <div class="compare-val">${fmtNum(displayWeight(sA.volume))} vol</div>${ind(sA.volume, sB.volume)}<div class="compare-val">${fmtNum(displayWeight(sB.volume))} vol</div>
        <div class="compare-val">${sA.trainingDays} days</div>${ind(sA.trainingDays, sB.trainingDays)}<div class="compare-val">${sB.trainingDays} days</div>
        <div class="compare-val">${sA.prs} PRs</div>${ind(sA.prs, sB.prs)}<div class="compare-val">${sB.prs} PRs</div>
        <div class="compare-label">Best e1RM</div>
        ${LIFTS.map(l => `<div class="compare-val" style="color:${COLORS[l]}">${sA[l] > 0 ? formatWeight(sA[l]) : '\u2014'}</div>${ind(sA[l], sB[l])}<div class="compare-val" style="color:${COLORS[l]}">${sB[l] > 0 ? formatWeight(sB[l]) : '\u2014'}</div>`).join('')}
      </div>`;
    }
    compareA.addEventListener('change', runComparison);
    compareB.addEventListener('change', runComparison);
    runComparison();
  }

  // Goal input listeners in Stats tab
  document.querySelectorAll('#stats-content .goal-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const lift = inp.dataset.lift;
      const val = parseFloat(inp.value);
      store.goals[lift] = val > 0 ? inputToLbs(val) : null;
      store.saveGoals();
      if (_updateDashboard) _updateDashboard();
      renderStats();
    });
  });

  // Year in Review
  const yirBtn = $('yir-btn');
  if (yirBtn) yirBtn.addEventListener('click', () => {
    const year = new Date().getFullYear();
    const yearEntries = store.entries.filter(e => e.date.startsWith(year.toString()));
    if (yearEntries.length === 0) { showToast('No data for ' + year); return; }
    const totalSets = yearEntries.length;
    const totalVol = yearEntries.reduce((s, e) => s + e.weight * e.reps, 0);
    const totalPRs = yearEntries.filter(e => e.isPR).length;
    const days = new Set(yearEntries.map(e => e.date)).size;
    const liftCounts = { squat: 0, bench: 0, deadlift: 0 };
    yearEntries.forEach(e => liftCounts[e.lift]++);
    const mostTrained = Object.entries(liftCounts).sort((a, b) => b[1] - a[1])[0];
    const biggestPR = yearEntries.filter(e => e.isPR).sort((a, b) => b.e1rm - a.e1rm)[0];
    const badgeCount = Object.values(store.unlockedBadges).filter(b => b.date && b.date.startsWith(year.toString())).length;

    let rhtml = `<div class="yir-stat-grid">
      <div class="yir-stat"><div class="yir-stat-label">Total Sets</div><div class="yir-stat-value">${fmtNum(totalSets)}</div></div>
      <div class="yir-stat"><div class="yir-stat-label">Volume</div><div class="yir-stat-value">${fmtNum(displayWeight(totalVol))} ${store.unit}</div></div>
      <div class="yir-stat"><div class="yir-stat-label">Training Days</div><div class="yir-stat-value">${days}</div></div>
      <div class="yir-stat"><div class="yir-stat-label">PRs</div><div class="yir-stat-value">${totalPRs}</div></div>
      <div class="yir-stat"><div class="yir-stat-label">Most Trained</div><div class="yir-stat-value" style="color:${COLORS[mostTrained[0]]}">${LIFT_NAMES[mostTrained[0]]}</div></div>
      <div class="yir-stat"><div class="yir-stat-label">Badges Earned</div><div class="yir-stat-value">${badgeCount}</div></div>
    </div>`;
    if (biggestPR) {
      rhtml += `<div style="text-align:center;padding:8px;background:var(--gold-bg);border-radius:8px;margin-bottom:8px">
        <div style="font-size:0.65rem;color:var(--text-dim);text-transform:uppercase">Biggest PR</div>
        <div style="font-size:1rem;font-weight:700;color:${COLORS[biggestPR.lift]}">${LIFT_NAMES[biggestPR.lift]} ${formatWeight(biggestPR.e1rm)} ${store.unit}</div>
      </div>`;
    }
    rhtml += `<button class="data-btn" id="yir-share" style="width:100%">\uD83D\uDCE4 Share Year in Review</button>`;
    $('yir-content').innerHTML = rhtml;
    // Share card
    $('yir-share').addEventListener('click', () => {
      const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
      const yirCtx = cv.getContext('2d');
      yirCtx.fillStyle = '#121212'; yirCtx.fillRect(0, 0, 1080, 1920);
      // SBD bar
      const grd = yirCtx.createLinearGradient(0, 0, 1080, 0);
      grd.addColorStop(0, COLORS.squat); grd.addColorStop(0.5, COLORS.bench); grd.addColorStop(1, COLORS.deadlift);
      yirCtx.fillStyle = grd; yirCtx.fillRect(0, 0, 1080, 8);
      yirCtx.textAlign = 'center';
      yirCtx.font = 'bold 80px -apple-system, sans-serif'; yirCtx.fillStyle = '#ffd700';
      yirCtx.fillText(year + ' IN REVIEW', 540, 200);
      yirCtx.font = 'bold 48px -apple-system, sans-serif'; yirCtx.fillStyle = '#fff';
      const stats = [`${fmtNum(totalSets)} sets`, `${fmtNum(displayWeight(totalVol))} ${store.unit} volume`, `${days} training days`, `${totalPRs} PRs`];
      stats.forEach((s, i) => yirCtx.fillText(s, 540, 400 + i * 100));
      if (biggestPR) {
        yirCtx.font = 'bold 36px -apple-system, sans-serif'; yirCtx.fillStyle = '#ffd700';
        yirCtx.fillText('Biggest PR', 540, 900);
        yirCtx.font = 'bold 56px -apple-system, sans-serif'; yirCtx.fillStyle = COLORS[biggestPR.lift];
        yirCtx.fillText(`${LIFT_NAMES[biggestPR.lift]} ${formatWeight(biggestPR.e1rm)} ${store.unit}`, 540, 970);
      }
      yirCtx.font = '28px -apple-system, sans-serif'; yirCtx.fillStyle = '#666';
      yirCtx.fillText('1000 LB CLUB TRACKER', 540, 1820);
      shareOrDownloadCanvas(cv, `year-review-${year}.png`, `${year} Year in Review`, `My ${year} lifting year in review`);
    });
  });
}

// ---------------------------------------------------------------------------
// initStatsTab — one-time setup (if needed beyond renderStats)
// ---------------------------------------------------------------------------

/**
 * Set up any one-time listeners for the Stats tab.
 * Currently stats are fully re-rendered each time the tab is shown,
 * so this is a no-op placeholder for future use.
 */
export function initStatsTab() {
  // All listeners are attached dynamically in attachStatsListeners()
}
