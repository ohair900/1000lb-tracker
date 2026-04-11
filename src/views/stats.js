/**
 * Stats tab view — hero summary, records board, goals, PR timeline,
 * volume, period comparison, training insights, badges, training cycles,
 * accessory progress, mesocycle, and year in review.
 *
 * Organized in tiers: Hero → Progress → Analysis → Contextual → Engagement
 * Empty sections are hidden instead of showing placeholder messages.
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
import { calcStreak } from '../systems/streak.js';
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

let _deps = {};

export function injectStatsDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Helpers
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

const CLASS_LABELS = { beginner: 'Beg', novice: 'Nov', intermediate: 'Int', advanced: 'Adv', elite: 'Elite' };
const CLASS_COLORS = { beginner: '#888', novice: '#1e88e5', intermediate: '#fdd835', advanced: '#ff9800', elite: '#e53935' };

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

  // Inline milestone roadmap (persistent, locked at goal-set time)
  const roadmapLifts = LIFTS.filter(lift => !!calcMilestoneRoadmap(lift));
  if (roadmapLifts.length > 0) {
    html += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <div style="font-size:var(--text-xs);color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Milestone Roadmap</div>`;
    roadmapLifts.forEach(lift => {
      const rm = calcMilestoneRoadmap(lift);
      if (!rm) return;
      html += `<div style="margin-bottom:12px">
        <div style="font-size:var(--text-sm);font-weight:600;color:${COLORS[lift]};margin-bottom:4px">${LIFT_NAMES[lift]}</div>
        <div style="position:relative;padding-left:16px">
        <div style="position:absolute;left:5px;top:4px;bottom:4px;width:2px;background:var(--border)"></div>`;
      rm.milestones.forEach(ms => {
        const dotColor = ms.achieved ? COLORS[lift] : 'var(--border)';
        const textColor = ms.achieved ? 'var(--text)' : 'var(--text-dim)';
        const rightLabel = ms.achieved
          ? ms.achievedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : ms.estDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        const targetStyle = ms.achieved
          ? 'text-decoration:line-through;opacity:0.7'
          : '';
        const checkmark = ms.achieved
          ? '<span style="margin-left:6px;color:' + COLORS[lift] + '">&#10003;</span>'
          : '';
        html += `<div style="position:relative;padding:3px 0 6px 12px;font-size:var(--text-sm);color:${textColor}">
          <div style="position:absolute;left:-3px;top:6px;width:8px;height:8px;border-radius:50%;background:${dotColor};border:2px solid var(--surface)"></div>
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span><strong style="${targetStyle}">${formatWeight(ms.target)} ${store.unit}</strong> <span style="font-size:var(--text-xs)">${ms.label}</span>${checkmark}</span>
            <span style="font-size:var(--text-xs);color:var(--text-dim)">${rightLabel}</span>
          </div>
        </div>`;
      });
      html += `</div></div>`;
    });
    html += `</div>`;
  }

  return html;
}

// ---------------------------------------------------------------------------
// TIER 1: Hero Summary (non-collapsible)
// ---------------------------------------------------------------------------

function renderStatsHero(total) {
  const hasProfile = store.profile.gender && store.profile.bodyweight;
  const streak = calcStreak();
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const monthEntries = store.entries.filter(e => e.date.startsWith(thisMonth));
  const monthSessions = new Set(monthEntries.map(e => e.date)).size;
  const monthPRs = monthEntries.filter(e => e.isPR).length;

  let html = `<div class="stats-hero">`;
  html += `<div class="hero-gradient-bar"></div>`;

  // SBD Total
  if (total) {
    html += `<div class="hero-total">
      <div class="hero-total-value">${formatWeight(total)} <span class="hero-total-unit">${store.unit}</span></div>
      <div class="hero-total-label">SBD Total</div>
    </div>`;
  }

  // Wilks / DOTS
  if (total && hasProfile) {
    const tKg = lbsToKg(total), bKg = lbsToKg(store.profile.bodyweight);
    const wi = calcWilks(tKg, bKg, store.profile.gender);
    const dt = calcDOTS(tKg, bKg, store.profile.gender);
    if (wi || dt) {
      html += `<div class="hero-scores">`;
      if (wi) html += `<div class="hero-score"><span class="hero-score-value">${Math.round(wi)}</span><span class="hero-score-label">Wilks</span></div>`;
      if (dt) html += `<div class="hero-score"><span class="hero-score-value">${Math.round(dt)}</span><span class="hero-score-label">DOTS</span></div>`;
      html += `</div>`;
    }
  }

  // Quick stats
  html += `<div class="hero-quick-stats">
    <div class="hero-quick"><span class="hero-quick-value">${monthSessions}</span><span class="hero-quick-label">sessions this mo</span></div>
    <div class="hero-quick"><span class="hero-quick-value">${monthPRs}</span><span class="hero-quick-label">PRs this mo</span></div>
    <div class="hero-quick"><span class="hero-quick-value">${streak?.current || 0}</span><span class="hero-quick-label">week streak</span></div>
  </div>`;

  html += `</div>`;
  return html;
}

// ---------------------------------------------------------------------------
// TIER 2: Progress sections
// ---------------------------------------------------------------------------

function renderStatsRecordsBoard() {
  if (store.entries.length === 0) return '';
  let html = statsSection('records-board', 'Records Board', store.statsCollapsed);
  const repPRs = getRepPRs();
  html += `<div class="records-grid"><div class="rg-header"></div>`;
  REP_RANGES.forEach(r => { html += `<div class="rg-header">${r}RM</div>`; });
  LIFTS.forEach(lift => {
    html += `<div class="rg-lift" style="color:${COLORS[lift]}">${LIFT_SHORT[lift]}</div>`;
    REP_RANGES.forEach(r => {
      const best = repPRs[lift][r];
      if (best) {
        const daysAgo = Math.round((Date.now() - new Date(best.date + 'T12:00:00').getTime()) / MS_PER_DAY);
        const isRecent = daysAgo < 30;
        const dateLabel = daysAgo < 7 ? `${daysAgo}d ago` : daysAgo < 60 ? `${Math.round(daysAgo / 7)}w ago` : '';
        html += `<div class="rg-cell${isRecent ? ' pr-cell' : ''}" title="${best.date}">${formatWeight(best.weight)}${dateLabel ? `<div class="rg-date">${dateLabel}</div>` : ''}</div>`;
      } else {
        html += `<div class="rg-cell" style="color:var(--text-dim)">\u2014</div>`;
      }
    });
  });
  html += `</div>`;
  return html + SECTION_CLOSE;
}

function renderStatsGoals(total) {
  return statsSection('goals', 'Goals & Milestones', store.statsCollapsed) + buildGoalsHTML(total) + SECTION_CLOSE;
}

function renderStatsPRTimeline() {
  if (store.prs.length === 0) return '';
  let html = statsSection('pr-timeline', 'PR Timeline', store.statsCollapsed);
  const sorted = [...store.prs].sort((a, b) => b.timestamp - a.timestamp);

  // Days since last PR
  const daysSince = Math.round((Date.now() - sorted[0].timestamp) / MS_PER_DAY);
  html += `<div class="pr-since">${daysSince === 0 ? 'PR today!' : `${daysSince}d since last PR`}</div>`;

  html += `<div class="pr-timeline">`;
  sorted.forEach((pr, i) => {
    const d = new Date(pr.date + 'T12:00:00');
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const name = LIFT_NAMES[pr.lift] || pr.lift;
    let milestoneHtml = '';
    if (pr.milestone) {
      const idx = PLATE_MILESTONES.indexOf(parseInt(pr.milestone));
      milestoneHtml = `<span class="milestone-badge">${idx + 1} plate${idx > 0 ? 's' : ''}</span>`;
    }
    // Gap from previous PR
    const nextPR = sorted[i + 1];
    const gap = nextPR ? Math.round((pr.timestamp - nextPR.timestamp) / MS_PER_DAY) : null;

    html += `<div class="pr-item">
      <div class="pr-dot" style="background:${COLORS[pr.lift]}"></div>
      <div class="pr-content">
        <div class="pr-main"><span style="color:${COLORS[pr.lift]}">${name}</span> <strong>${formatWeight(pr.e1rm)} ${store.unit}</strong> ${milestoneHtml}
          <button class="toast-share" onclick="return false" data-share-lift="${pr.lift}" data-share-e1rm="${pr.e1rm}" data-share-date="${pr.date}" style="font-size:var(--text-xs);padding:1px 6px;vertical-align:middle">Share</button>
        </div>
        <div class="pr-date">${label}${gap !== null ? ` <span class="pr-gap">(${gap}d gap)</span>` : ''}</div>
      </div>
    </div>`;
  });
  html += `</div>`;
  return html + SECTION_CLOSE;
}

// ---------------------------------------------------------------------------
// TIER 3: Analysis sections
// ---------------------------------------------------------------------------

function renderStatsVolume() {
  if (store.entries.length === 0) return '';
  let html = statsSection('volume', 'Volume', store.statsCollapsed);
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
  return html + SECTION_CLOSE;
}

function renderStatsPeriodComparison() {
  if (store.entries.length < 5) return '';
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

function renderStatsInsights() {
  const btd = calcBestTrainingDay();
  if (!btd || btd.length === 0) return '';
  let html = statsSection('training-insights', 'Training Insights', store.statsCollapsed);

  // Best training day
  html += `<div style="font-size:var(--text-sm);color:var(--text-dim);margin-bottom:8px">Strongest day: <strong style="color:var(--text)">${btd[0].name}</strong></div>`;
  const maxAvg = btd[0].avg;
  btd.forEach(d => {
    const pct = maxAvg > 0 ? (d.avg / maxAvg * 100) : 0;
    html += `<div class="vol-row">
      <span class="vol-period-label" style="min-width:32px">${d.name.slice(0, 3)}</span>
      <div class="vol-bars"><div class="vol-bar-seg" style="width:${pct}%;background:var(--bench)"></div></div>
      <span class="vol-total">${formatWeight(d.avg)}</span>
    </div>`;
  });

  // Strongest rep range
  if (store.entries.length >= 20) {
    const ranges = [[1, 3, 'Singles-Triples'], [4, 6, 'Medium (4-6)'], [7, 10, 'Hypertrophy (7-10)'], [11, 50, 'Endurance (11+)']];
    const rangeAvgs = ranges.map(([lo, hi, label]) => {
      const entries = store.entries.filter(e => e.reps >= lo && e.reps <= hi);
      if (entries.length < 3) return null;
      const avg = entries.reduce((s, e) => s + e.e1rm, 0) / entries.length;
      return { label, avg, count: entries.length };
    }).filter(Boolean);
    if (rangeAvgs.length >= 2) {
      rangeAvgs.sort((a, b) => b.avg - a.avg);
      html += `<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border);font-size:var(--text-sm);color:var(--text-dim)">Best rep range: <strong style="color:var(--text)">${rangeAvgs[0].label}</strong> (avg ${formatWeight(rangeAvgs[0].avg)} e1RM)</div>`;
    }
  }

  // Most consistent lift
  if (store.entries.length >= 20) {
    const last90 = new Date(Date.now() - 90 * MS_PER_DAY).toISOString().split('T')[0];
    const recent = store.entries.filter(e => e.date >= last90);
    const liftFreq = {};
    LIFTS.forEach(l => {
      liftFreq[l] = new Set(recent.filter(e => e.lift === l).map(e => e.date)).size;
    });
    const sorted = Object.entries(liftFreq).sort((a, b) => b[1] - a[1]);
    if (sorted[0][1] > 0) {
      html += `<div style="margin-top:4px;font-size:var(--text-sm);color:var(--text-dim)">Most trained (90d): <strong style="color:${COLORS[sorted[0][0]]}">${LIFT_NAMES[sorted[0][0]]}</strong> (${sorted[0][1]} sessions)</div>`;
    }
  }

  return html + SECTION_CLOSE;
}

// ---------------------------------------------------------------------------
// TIER 4: Contextual sections (only if data exists)
// ---------------------------------------------------------------------------

function renderStatsMesocycle() {
  const meso = store.activeMesocycle;
  if (!meso || meso.status !== 'active') return '';
  const isCollapsed = store.statsCollapsed['mesocycle'];
  const week = meso.weeks[meso.currentWeek - 1];
  const completedWeeks = meso.weeks.filter(w => w.completed).length;
  const pct = Math.round((completedWeeks / meso.durationWeeks) * 100);

  let html = `<div class="stats-section${isCollapsed ? ' collapsed' : ''}">
    <div class="stats-header" data-toggle="mesocycle"><span>Mesocycle</span><span class="stats-header-chevron">&#9656;</span></div>
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

function renderStatsCycles() {
  if (store.cycles.length === 0) return '';
  let html = statsSection('training-cycles', 'Training Cycles', store.statsCollapsed);
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
  return html + SECTION_CLOSE;
}

function renderStatsAccessoryProgress() {
  const summaries = getAccessorySummaries();
  if (summaries.size === 0) return '';
  let html = statsSection('accessory-progress', 'Accessory Progress', store.statsCollapsed);

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
      html += `<div class="acc-progress-row" data-exercise-id="${s.exerciseId}">
        <div class="acc-progress-dot ${s.mainLift}"></div>
        <div class="acc-progress-info">
          <div class="acc-progress-name">${escapeHTML(s.name)}${s.readyToProgress ? '<span class="acc-progress-badge">Ready</span>' : ''}</div>
          <div class="acc-progress-meta">${s.sessionCount} session${s.sessionCount !== 1 ? 's' : ''} &bull; ${s.equipment} &bull; ${s.lastDate}</div>
        </div>
        <div class="acc-progress-right">
          <div class="acc-progress-weight">${w}</div>
          <div class="acc-progress-trend ${s.trend}">${arrow}</div>
        </div></div>`;
    }
    html += `</div>`;
  }
  return html + SECTION_CLOSE;
}

// ---------------------------------------------------------------------------
// TIER 5: Engagement
// ---------------------------------------------------------------------------

function renderStatsBadges() {
  const totalBadges = BADGE_DEFINITIONS.length;
  const unlockedCount = Object.keys(store.unlockedBadges).length;
  let html = statsSection('badges', `Badges (${unlockedCount}/${totalBadges})`, store.statsCollapsed);

  // Precompute progress context
  const uniqueDays = new Set(store.entries.map(e => e.date)).size;
  const total = getTotal();
  const maxLiftE1rm = Math.max(0, ...LIFTS.map(l => bestE1RM(l) || 0));
  const totalVol = store.entries.reduce((s, e) => s + e.weight * e.reps, 0);

  function getProgress(b) {
    if (store.unlockedBadges[b.id]) return null;
    switch (b.id) {
      case 'first-rep': return { cur: store.entries.length, target: 1 };
      case 'week-warrior': return { cur: uniqueDays, target: 14 };
      case 'fifty-strong': return { cur: uniqueDays, target: 50 };
      case 'century': return { cur: uniqueDays, target: 100 };
      case '1plate': return { cur: maxLiftE1rm, target: 135 };
      case '2plate': return { cur: maxLiftE1rm, target: 225 };
      case '3plate': return { cur: maxLiftE1rm, target: 315 };
      case '4plate': return { cur: maxLiftE1rm, target: 405 };
      case '5plate': return { cur: maxLiftE1rm, target: 495 };
      case 'total-500': return { cur: total || 0, target: 500 };
      case 'total-750': return { cur: total || 0, target: 750 };
      case 'total-1000': return { cur: total || 0, target: 1000 };
      case 'total-1500': return { cur: total || 0, target: 1500 };
      case 'vol-100k': return { cur: totalVol, target: 100000 };
      case 'vol-500k': return { cur: totalVol, target: 500000 };
      case 'vol-1m': return { cur: totalVol, target: 1000000 };
      default: return null;
    }
  }

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
        const prog = getProgress(b);
        const pct = prog ? Math.min(100, Math.round((prog.cur / prog.target) * 100)) : 0;
        html += `<div class="badge-card locked"><span class="badge-icon">${b.icon}</span><div class="badge-name">${b.name}</div>`;
        if (prog && prog.target > 0) {
          html += `<div class="badge-progress"><div class="badge-progress-fill" style="width:${pct}%"></div></div>`;
          html += `<div class="badge-date">${pct}%</div>`;
        } else {
          html += `<div class="badge-date" style="font-style:italic">${b.desc}</div>`;
        }
        html += `</div>`;
      }
    });
    html += `</div>`;
  });
  return html + SECTION_CLOSE;
}

function renderStatsYIR() {
  let html = statsSection('year-in-review', 'Year in Review', store.statsCollapsed);
  html += `<button class="data-btn" id="yir-btn" style="width:100%">Generate ${new Date().getFullYear()} Review</button>`;
  html += `<div id="yir-content"></div>`;
  return html + SECTION_CLOSE;
}

// ---------------------------------------------------------------------------
// Main renderStats()
// ---------------------------------------------------------------------------

export function renderStats() {
  const c = $('stats-content');
  const total = getTotal();
  c.innerHTML = [
    // Tier 1: Hero
    renderStatsHero(total),
    // Tier 2: Progress
    renderStatsRecordsBoard(),
    renderStatsGoals(total),
    renderStatsPRTimeline(),
    // Tier 3: Analysis
    renderStatsVolume(),
    renderStatsPeriodComparison(),
    renderStatsInsights(),
    // Tier 4: Contextual
    renderStatsMesocycle(),
    renderStatsCycles(),
    renderStatsAccessoryProgress(),
    // Tier 5: Engagement
    renderStatsBadges(),
    renderStatsYIR()
  ].join('');
  attachStatsListeners();
}

// ---------------------------------------------------------------------------
// attachStatsListeners
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
      _deps.showMesoWeekDetail?.(parseInt(card.dataset.mesoStatWeek));
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
        _deps.renderCycleBar?.();
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
      function diffBar(a, b, label) {
        const max = Math.max(a, b, 1);
        const pctA = (a / max * 100).toFixed(0);
        const pctB = (b / max * 100).toFixed(0);
        const better = a > b ? 'a' : a < b ? 'b' : 'same';
        return `<div class="compare-row">
          <div class="compare-label">${label}</div>
          <div class="compare-bar-wrap">
            <div class="compare-bar${better === 'a' ? ' winner' : ''}" style="width:${pctA}%"></div>
            <span class="compare-bar-val">${typeof a === 'number' && a > 999 ? fmtNum(a) : a}</span>
          </div>
          <div class="compare-bar-wrap right">
            <div class="compare-bar${better === 'b' ? ' winner' : ''}" style="width:${pctB}%"></div>
            <span class="compare-bar-val">${typeof b === 'number' && b > 999 ? fmtNum(b) : b}</span>
          </div>
        </div>`;
      }
      const cRes = $('compare-results');
      cRes.innerHTML = diffBar(sA.sets, sB.sets, 'Sets') +
        diffBar(Math.round(displayWeight(sA.volume)), Math.round(displayWeight(sB.volume)), 'Volume') +
        diffBar(sA.trainingDays, sB.trainingDays, 'Days') +
        diffBar(sA.prs, sB.prs, 'PRs') +
        LIFTS.map(l => diffBar(
          sA[l] > 0 ? Math.round(displayWeight(sA[l])) : 0,
          sB[l] > 0 ? Math.round(displayWeight(sB[l])) : 0,
          LIFT_SHORT[l]
        )).join('');
    }
    compareA.addEventListener('change', runComparison);
    compareB.addEventListener('change', runComparison);
    runComparison();
  }

  // Goal input listeners
  document.querySelectorAll('#stats-content .goal-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const lift = inp.dataset.lift;
      const val = parseFloat(inp.value);
      store.goals[lift] = val > 0 ? inputToLbs(val) : null;
      store.saveGoals();
      _deps.updateDashboard?.();
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
    $('yir-share').addEventListener('click', () => {
      const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1920;
      const yirCtx = cv.getContext('2d');
      yirCtx.fillStyle = '#121212'; yirCtx.fillRect(0, 0, 1080, 1920);
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
// initStatsTab
// ---------------------------------------------------------------------------

export function initStatsTab() {
  // All listeners are attached dynamically in attachStatsListeners()
}
