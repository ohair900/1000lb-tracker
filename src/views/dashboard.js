/**
 * Dashboard view — renders the top-level dashboard cards, goal bars,
 * strength ratios, score line, fatigue indicator, streak bars,
 * weekly recap card, milestone celebrations, and PR streak.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { fmtNum, ensureChild } from '../utils/helpers.js';
import { LIFTS, COLORS, LIFT_SHORT, LIFT_NAMES, PLATE_MILESTONES } from '../constants/lift-config.js';
import {
  STRENGTH_RATIO_BS_BALANCED, STRENGTH_RATIO_BS_WARNING,
  STRENGTH_RATIO_DS_BALANCED, STRENGTH_RATIO_DS_WARNING
} from '../constants/thresholds.js';
import { MS_PER_DAY } from '../constants/time.js';
import { DIRECTION_ARROWS, CONFETTI_COUNT, CELEBRATION_DISMISS_MS } from '../constants/ui.js';
import { TOTAL_MILESTONES, TOTAL_MILESTONE_THEMES } from '../data/milestones.js';
import { TOTAL_CELEBRATED_KEY } from '../constants/storage-keys.js';
import { MUSCLE_GROUPS, WEEKLY_SET_TARGETS } from '../data/muscle-groups.js';
import { bestE1RM, getTotal } from '../formulas/e1rm.js';
import { displayWeight, formatWeight, lbsToKg } from '../formulas/units.js';
import { calcWilks, calcDOTS } from '../formulas/scoring.js';
import { calcProgression, detectPlateau } from '../formulas/progression.js';
import { getClassification, getOverallClassification } from '../formulas/standards.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';
import { showFatigueDetail } from '../views/fatigue-sheet.js';
import { renderBodyMap, initBodyMapEvents } from '../views/body-map.js';
import { updatePlateauCards, showPlateauSheet } from '../views/plateau-analysis.js';
import { calcStreak } from '../systems/streak.js';
import { calcWeeklyRecap } from '../systems/weekly-recap.js';
import { calcPriorWeekReview, calcWeeklyCoverage, calcAverageMuscleCoverage } from '../systems/weekly-coverage.js';
import { calcWeeklyInsights } from '../systems/weekly-insights.js';
import { calcWeeklyGrade } from '../systems/weekly-grade.js';
import { openReviewSheet, closeReviewSheet } from '../ui/sheet.js';
import { enableSheetSwipeDismiss } from '../ui/sheet.js';
import { checkBadges } from '../systems/badges.js';
import { openModal } from '../ui/modal.js';
import { shareMilestoneCard } from '../ui/share.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Status color map for muscle coverage tables (used by both weekly sheets). */
const MUSCLE_STATUS_COLORS = {
  'Worked hard': 'var(--green)',
  'On target':   'var(--green)',
  'Light':       'var(--yellow)',
  'Needs more':  'var(--yellow)',
  'Recovering':  'var(--bench)',
  'Skipped':     '#b55',
};

// ---------------------------------------------------------------------------
// Dashboard card renderers
// ---------------------------------------------------------------------------

/**
 * Update a single lift card (squat / bench / deadlift).
 * @param {string} lift
 */
export function updateLiftCard(lift) {
  const el = $('dash-' + lift);
  const card = el.parentElement;
  const best = bestE1RM(lift);
  const bar = $('goal-bar-' + lift);
  if (best !== null) { el.textContent = Math.round(displayWeight(best)); el.classList.remove('empty'); }
  else { el.textContent = '\u2014'; el.classList.add('empty'); }
  if (bar) {
    if (store.goals[lift] && best) {
      bar.style.display = '';
      bar.querySelector('.goal-fill').style.width = Math.min(100, best / store.goals[lift] * 100) + '%';
    } else { bar.style.display = 'none'; }
  }
  const bwEl = ensureChild(card, 'card-bw');
  if (best && store.profile.bodyweight) {
    bwEl.textContent = (best / store.profile.bodyweight).toFixed(1) + 'x BW';
    bwEl.style.display = '';
  } else { bwEl.style.display = 'none'; }
  const badgeEl = ensureChild(card, 'class-badge');
  const cls = getClassification(lift, best);
  const clsShort = { beginner: 'Beg', novice: 'Nov', intermediate: 'Int', advanced: 'Adv', elite: 'Elite' };
  if (cls) { badgeEl.textContent = clsShort[cls] || cls; badgeEl.className = 'class-badge ' + cls; badgeEl.style.display = ''; }
  else { badgeEl.style.display = 'none'; }
  const trendEl = ensureChild(card, 'card-trend');
  const prog = calcProgression(lift);
  if (prog) {
    const arrow = DIRECTION_ARROWS[prog.direction];
    trendEl.textContent = `${arrow} ${Math.round(Math.abs(prog.delta))} ${store.unit} / 90d`;
    trendEl.className = 'card-trend ' + prog.direction;
    trendEl.style.display = '';
  } else { trendEl.style.display = 'none'; }
  const platEl = ensureChild(card.querySelector('.card-label'), 'plateau-icon', 'button');
  if (best && detectPlateau(lift)) {
    platEl.innerHTML = '\u26A0\uFE0F';
    platEl.setAttribute('aria-label', `${LIFT_NAMES[lift]} plateau — tap for analysis`);
    platEl.setAttribute('title', 'Plateau detected — tap for analysis');
    platEl.dataset.lift = lift;
    platEl.style.display = 'inline-flex';
    if (!platEl._bound) {
      platEl.addEventListener('click', (e) => {
        e.stopPropagation();
        showPlateauSheet(platEl.dataset.lift);
      });
      platEl._bound = true;
    }
  } else { platEl.style.display = 'none'; }
}

/**
 * Update the Total card.
 */
export function updateTotalCard() {
  const totalEl = $('dash-total');
  const bar = $('goal-bar-total');
  const total = getTotal();
  if (total) { totalEl.textContent = Math.round(displayWeight(total)); totalEl.classList.remove('empty'); }
  else { totalEl.textContent = '\u2014'; totalEl.classList.add('empty'); }
  if (bar) {
    if (store.goals.total && total) {
      bar.style.display = '';
      bar.querySelector('.goal-fill').style.width = Math.min(100, total / store.goals.total * 100) + '%';
    } else { bar.style.display = 'none'; }
  }
  const totalCard = totalEl.parentElement;
  const tbw = ensureChild(totalCard, 'card-bw');
  if (total && store.profile.bodyweight) { tbw.textContent = (total / store.profile.bodyweight).toFixed(1) + 'x BW'; tbw.style.display = ''; }
  else { tbw.style.display = 'none'; }
  const tBadge = ensureChild(totalCard, 'class-badge');
  const oc = getOverallClassification();
  const ocShort = { beginner: 'Beg', novice: 'Nov', intermediate: 'Int', advanced: 'Adv', elite: 'Elite' };
  if (oc) { tBadge.textContent = ocShort[oc] || oc; tBadge.className = 'class-badge ' + oc; tBadge.style.display = ''; }
  else { tBadge.style.display = 'none'; }
}

// ---------------------------------------------------------------------------
// Strength ratios
// ---------------------------------------------------------------------------

export function updateStrengthRatios() {
  const sq = bestE1RM('squat'), bp = bestE1RM('bench'), dl = bestE1RM('deadlift');
  const el = $('strength-ratios');
  if (!sq || !bp || !dl) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const bsRatio = bp / sq * 100;
  const dsRatio = dl / sq * 100;
  const bsEl = $('ratio-bs'), dsEl = $('ratio-ds');
  bsEl.textContent = Math.round(bsRatio) + '%';
  bsEl.className = 'ratio-value ' + (bsRatio >= STRENGTH_RATIO_BS_BALANCED[0] && bsRatio <= STRENGTH_RATIO_BS_BALANCED[1] ? 'balanced' : bsRatio >= STRENGTH_RATIO_BS_WARNING[0] && bsRatio <= STRENGTH_RATIO_BS_WARNING[1] ? 'warning' : 'imbalanced');
  dsEl.textContent = Math.round(dsRatio) + '%';
  dsEl.className = 'ratio-value ' + (dsRatio >= STRENGTH_RATIO_DS_BALANCED[0] && dsRatio <= STRENGTH_RATIO_DS_BALANCED[1] ? 'balanced' : dsRatio >= STRENGTH_RATIO_DS_WARNING[0] && dsRatio <= STRENGTH_RATIO_DS_WARNING[1] ? 'warning' : 'imbalanced');
}

// ---------------------------------------------------------------------------
// Score line (Wilks / DOTS)
// ---------------------------------------------------------------------------

export function updateScoreLine() {
  const el = $('score-line');
  const total = getTotal();
  if (!total || !store.profile.gender || !store.profile.bodyweight) { el.style.display = 'none'; return; }
  const tKg = lbsToKg(total), bKg = lbsToKg(store.profile.bodyweight);
  const w = calcWilks(tKg, bKg, store.profile.gender);
  const d = calcDOTS(tKg, bKg, store.profile.gender);
  if (w && d) {
    el.style.display = '';
    let html = `Wilks: <strong>${Math.round(w)}</strong> &middot; DOTS: <strong>${Math.round(d)}</strong>`;
    const cls = getOverallClassification();
    const clsLabel = { beginner: 'Beg', novice: 'Nov', intermediate: 'Int', advanced: 'Adv', elite: 'Elite' };
    if (cls) html += ` &middot; <span class="class-badge ${cls}" style="vertical-align:middle">${clsLabel[cls] || cls}</span>`;
    el.innerHTML = html;
  } else { el.style.display = 'none'; }
}

// ---------------------------------------------------------------------------
// Fatigue indicator
// ---------------------------------------------------------------------------

export function updateFatigueBar() {
  const el = $('fatigue-bar');
  const byMuscle = calcFatigueByMuscle();

  // Always show the body map, even with no data (muscles appear dim)
  el.style.display = 'block';

  // Body map above fatigue cards
  let bodyMapEl = el.querySelector('.body-map-container');
  if (bodyMapEl) bodyMapEl.remove();
  const mapHtml = renderBodyMap(byMuscle);
  $('fatigue-row').insertAdjacentHTML('beforebegin', mapHtml);

  // Attach body map click events
  bodyMapEl = el.querySelector('.body-map-container');
  if (bodyMapEl) {
    initBodyMapEvents(bodyMapEl, (mg) => showFatigueDetail(mg));
  }

  // Collapsible fatigue cards grouped by front/back
  if (!byMuscle) {
    $('fatigue-row').innerHTML = '';
    return;
  }

  const upperBody = ['Chest', 'Upper Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms'];
  const lowerBody = ['Quads', 'Hams', 'Glutes', 'Calves', 'Lower Back', 'Core'];

  function buildCards(groups) {
    return groups.map(mg => {
      const f = byMuscle[mg];
      const st = f ? f.displayStatus : 'none';
      const val = f ? f.displayLabel : '&mdash;';
      const recPct = f && f.recoveryPct !== null ? Math.round(f.recoveryPct * 100) : null;
      const recBar = recPct !== null
        ? `<div class="fatigue-card-recovery"><div class="fatigue-card-recovery-fill ${st}" style="width:${recPct}%"></div></div>`
        : '';
      return `<div class="fatigue-card" data-muscle="${mg}">` +
        `<div class="fatigue-card-label">${mg}</div>` +
        `<div class="fatigue-card-status">` +
          `<span class="fatigue-dot ${st}"></span>` +
          `<span class="fatigue-level ${st}">${val}</span>` +
        `</div>${recBar}</div>`;
    }).join('');
  }

  let html = '';
  // Toggle button
  html += `<div class="fatigue-cards-toggle" id="fatigue-cards-toggle">` +
    `<span class="fatigue-cards-toggle-icon">&#9662;</span> Fatigue Details</div>`;
  // Collapsible content
  html += `<div class="fatigue-cards-content" id="fatigue-cards-content">`;
  html += `<div class="fatigue-group-label">Upper Body</div>`;
  html += `<div class="fatigue-group-row">${buildCards(upperBody)}</div>`;
  html += `<div class="fatigue-group-label">Lower Body</div>`;
  html += `<div class="fatigue-group-row">${buildCards(lowerBody)}</div>`;
  html += `</div>`;

  $('fatigue-row').innerHTML = html;
  $('fatigue-row').querySelectorAll('.fatigue-card[data-muscle]').forEach(card => {
    card.addEventListener('click', () => showFatigueDetail(card.dataset.muscle));
  });

  // Toggle expand/collapse
  const toggle = $('fatigue-cards-toggle');
  const content = $('fatigue-cards-content');
  if (toggle && content) {
    toggle.addEventListener('click', () => {
      const expanded = content.classList.toggle('expanded');
      toggle.querySelector('.fatigue-cards-toggle-icon').innerHTML = expanded ? '&#9652;' : '&#9662;';
    });
  }
}

// ---------------------------------------------------------------------------
// Fatigue sheet helpers
// ---------------------------------------------------------------------------

function closeFatigueSheet() {
  const sheet = $('fatigue-sheet'), backdrop = $('fatigue-sheet-backdrop');
  sheet.style.transform = ''; sheet.style.transition = '';
  backdrop.style.opacity = ''; backdrop.style.transition = '';
  backdrop.style.display = 'none';
  sheet.style.display = 'none';
  document.body.style.overflow = '';
}

// showFatigueDetail is imported from fatigue-sheet.js

// ---------------------------------------------------------------------------
// Streak bar
// ---------------------------------------------------------------------------

export function updateStreakBar() {
  const el = $('streak-bar');
  const streak = calcStreak();
  if (!streak || streak.current === 0 && streak.longest <= 1) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const icon = streak.current >= 7 ? '\uD83D\uDD25' : streak.current >= 3 ? '\u26A1' : '\uD83C\uDFCB\uFE0F';
  $('streak-icon').textContent = icon;
  let html = `<strong>${streak.current} day${streak.current !== 1 ? 's' : ''} streak</strong>`;
  html += ` <span class="streak-detail">&middot; Best: ${streak.longest}d &middot; ${streak.weeksActive}/4 weeks active</span>`;
  $('streak-info').innerHTML = html;
}

// ---------------------------------------------------------------------------
// PR streak bar
// ---------------------------------------------------------------------------

export function updatePRStreakBar() {
  const el = $('pr-streak-bar');
  if (!store.dashboardWidgets.prStreak) { el.style.display = 'none'; return; }
  const now = Date.now(), day = MS_PER_DAY;
  const prs30 = store.prs.filter(p => (now - p.timestamp) <= 30 * day).length;
  const prs90 = store.prs.filter(p => (now - p.timestamp) <= 90 * day).length;
  if (prs90 === 0) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  const isHot = prs30 >= 3;
  el.querySelector('.pr-streak-icon').textContent = isHot ? '\uD83D\uDD25' : '\uD83C\uDFC6';
  let html = `<strong>${prs30} PR${prs30 !== 1 ? 's' : ''} last 30d</strong> &middot; ${prs90} PRs last 90d`;
  if (isHot) html += ` <span class="hot-streak">HOT STREAK \uD83D\uDD25</span>`;
  el.querySelector('.pr-streak-info').innerHTML = html;
}

// ---------------------------------------------------------------------------
// Weekly recap card (compact dashboard card)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Prior Week Review card (Mon–Wed only)
// ---------------------------------------------------------------------------

let _reviewSheetSwipeInit = false;

export function renderPriorWeekCard() {
  const el = $('prior-week-card');
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed
  // Show Sun(0), Mon(1), Tue(2), Wed(3) — hide Thu(4), Fri(5), Sat(6)
  if (dayOfWeek >= 4) { el.style.display = 'none'; return; }

  const review = calcPriorWeekReview();
  if (!review) { el.style.display = 'none'; return; }
  el.style.display = 'block';

  // Grade the prior week
  const now = new Date();
  const thisMonday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * MS_PER_DAY);
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday.getTime() - 7 * MS_PER_DAY);
  const gradeResult = calcWeeklyGrade({ weekStart: lastMonday });

  // Grade badge
  let gradeHtml = '';
  if (gradeResult && !gradeResult.insufficient && gradeResult.grade) {
    const gradeColor = gradeResult.grade.startsWith('A') || gradeResult.grade.startsWith('B') ? 'var(--green)'
      : gradeResult.grade.startsWith('C') ? 'var(--yellow)' : 'var(--red)';
    gradeHtml = `<span class="recap-grade-badge" style="background:${gradeColor}">${gradeResult.grade}</span>`;
  }

  // Stats line
  const prCount = review.prs.length;
  let statsLine = `${review.totalSets} sets &middot; ${fmtNum(displayWeight(review.totalVolume))} ${store.unit} vol`;
  if (prCount > 0) statsLine += ` &middot; ${prCount} PR${prCount > 1 ? 's' : ''}`;

  // Insight chips
  const insights = calcWeeklyInsights();
  let chipsHtml = '';
  if (insights && insights.chips.length > 0) {
    chipsHtml = `<div class="insight-chips">` +
      insights.chips.map(c => `<span class="insight-chip" style="background:${c.color}">${c.label}</span>`).join('') +
      `</div>`;
  }

  el.innerHTML = `<div class="recap-card-header">Last Week in Review ${gradeHtml}</div>` +
    `<div class="recap-card-preview">${statsLine}</div>` +
    chipsHtml;
  el.onclick = () => showPriorWeekSheet(review, gradeResult, insights);

  // Init swipe dismiss once
  if (!_reviewSheetSwipeInit) {
    _reviewSheetSwipeInit = true;
    enableSheetSwipeDismiss('review-sheet', 'review-sheet-backdrop', closeReviewSheet);
    $('review-sheet-close').onclick = closeReviewSheet;
    $('review-sheet-backdrop').onclick = closeReviewSheet;
  }
}

function _compareRow(label, current, prior, pctChange) {
  const arrow = pctChange > 0 ? '↑' : pctChange < 0 ? '↓' : '';
  const changeColor = pctChange > 0 ? 'var(--green)' : pctChange < 0 ? 'var(--red)' : 'var(--text-dim)';
  const changeStr = pctChange !== null && pctChange !== 0 ? `<span style="color:${changeColor};font-size:0.65rem;font-weight:600">${arrow}${Math.abs(pctChange)}%</span>` : '';
  return `<div class="review-compare-row"><span class="review-compare-label">${label}</span><span style="color:var(--text-dim);font-size:var(--text-xs)">${prior}</span><span style="font-size:var(--text-xs)">→</span><span style="font-weight:600">${current}</span>${changeStr}</div>`;
}

function showPriorWeekSheet(review, gradeResult, insights) {
  const body = $('review-sheet-body');
  let html = '';
  let _fullHtml = ''; // saved for back navigation

  // Grade header
  if (gradeResult && !gradeResult.insufficient && gradeResult.grade) {
    const gradeColor = gradeResult.grade.startsWith('A') || gradeResult.grade.startsWith('B') ? 'var(--green)'
      : gradeResult.grade.startsWith('C') ? 'var(--yellow)' : 'var(--red)';
    html += `<div style="text-align:center;margin-bottom:12px">
      <span style="font-size:1.8rem;font-weight:800;color:${gradeColor}">${gradeResult.grade}</span>
      <span style="font-size:var(--text-sm);color:var(--text-dim);margin-left:8px">${gradeResult.label} &middot; ${gradeResult.score}/100</span>
    </div>`;
  }

  // Body map
  html += `<div id="review-sheet-map">${renderBodyMap(review.coverage)}</div>`;

  // Week-over-week comparison
  if (review.prior) {
    const p = review.prior;
    const setsChange = p.totalSets > 0 ? Math.round((review.totalSets - p.totalSets) / p.totalSets * 100) : null;
    const volChange = p.totalVolume > 0 ? Math.round((review.totalVolume - p.totalVolume) / p.totalVolume * 100) : null;
    html += `<div style="margin:12px 0"><div class="section-label-lg">vs Prior Week</div>`;
    html += `<div class="review-compare-grid">`;
    html += _compareRow('Sets', review.totalSets, p.totalSets, setsChange);
    html += _compareRow('Volume', fmtNum(displayWeight(review.totalVolume)) + ' ' + store.unit, fmtNum(displayWeight(p.totalVolume)) + ' ' + store.unit, volChange);
    html += _compareRow('Intensity', review.avgIntensity + '%', p.avgIntensity + '%', review.avgIntensity - p.avgIntensity);
    html += _compareRow('Days', review.trainingDays, p.days, null);
    html += `</div></div>`;
  }

  // Per-lift breakdown with prior week comparison
  html += `<div style="margin:12px 0"><div class="section-label-lg">Lift Breakdown</div>`;
  LIFTS.forEach(l => {
    const s = review.liftStats[l];
    const color = COLORS[l];
    const prBadge = s.prs > 0 ? ` <span style="color:var(--gold);font-size:0.65rem;font-weight:700">PR</span>` : '';
    const intLabel = s.avgIntensity > 0 ? ` &middot; ${s.avgIntensity}%` : '';
    const priorSets = review.prior ? review.prior.liftStats[l]?.sets || 0 : 0;
    const delta = s.sets - priorSets;
    const deltaStr = delta !== 0 ? ` <span style="color:${delta > 0 ? 'var(--green)' : 'var(--red)'};font-size:0.6rem">${delta > 0 ? '+' : ''}${delta}</span>` : '';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="color:${color};font-weight:700;font-size:0.75rem;min-width:24px">${LIFT_SHORT[l]}</span>
      <span style="flex:1;font-size:var(--text-sm);color:var(--text)">${s.sets} sets${deltaStr} &middot; ${fmtNum(displayWeight(s.volume))} ${store.unit}${intLabel}${prBadge}</span>
    </div>`;
  });
  html += '</div>';

  // Muscle coverage with volume-based status
  const fatigue = calcFatigueByMuscle();
  html += `<div style="margin:12px 0"><div class="section-label-lg">Muscle Coverage</div>`;
  MUSCLE_GROUPS.forEach(mg => {
    const data = review.coverage[mg];
    const sets = data ? Math.round(data.sets) : 0;

    // Status: use volume-based status from coverage, override with Recovering if fatigued
    const fatigueStatus = fatigue && fatigue[mg] ? fatigue[mg].displayStatus : null;
    let status = data ? data.status : 'Skipped';
    if ((status === 'Light' || status === 'Needs more' || status === 'Skipped') && (fatigueStatus === 'red' || fatigueStatus === 'orange')) {
      status = 'Recovering';
    }
    const statusColor = MUSCLE_STATUS_COLORS[status] || 'var(--text-dim)';

    // vs average column
    const vsAvg = data ? data.vsAvg : null;
    let vsAvgStr;
    if (vsAvg === null) { vsAvgStr = '<span style="color:var(--text-dim)">—</span>'; }
    else if (vsAvg > 10) { vsAvgStr = `<span style="color:var(--green)">+${vsAvg}%</span>`; }
    else if (vsAvg < -10) { vsAvgStr = `<span style="color:var(--red)">${vsAvg}%</span>`; }
    else { vsAvgStr = `<span style="color:var(--text-dim)">${vsAvg > 0 ? '+' : ''}${vsAvg}%</span>`; }

    html += `<div class="review-muscle-row">
      <span class="review-muscle-name">${mg}</span>
      <span class="review-muscle-sets">${sets}</span>
      <span class="review-muscle-status" style="color:${statusColor}">${status}</span>
      <span class="review-muscle-delta">${vsAvgStr}</span>
    </div>`;
  });
  html += '</div>';

  // PRs
  if (review.prs.length > 0) {
    html += `<div style="margin:12px 0"><div class="section-label-lg">PRs Last Week</div>`;
    review.prs.forEach(e => {
      html += `<div class="recap-pr-item"><span style="color:${COLORS[e.lift]}">${LIFT_NAMES[e.lift]}</span> ${formatWeight(e.weight)} ${store.unit} &times; ${e.reps} = ${formatWeight(e.e1rm)} e1RM</div>`;
    });
    html += '</div>';
  }

  // Insights (all, with detail text)
  if (insights && insights.allInsights.length > 0) {
    html += `<div style="margin:12px 0;border-top:1px solid var(--border);padding-top:12px"><div class="section-label-lg">Insights</div>`;
    insights.allInsights.forEach(c => {
      html += `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
        <span class="insight-chip" style="background:${c.color};flex-shrink:0">${c.label}</span>
        <span style="font-size:var(--text-xs);color:var(--text-dim);padding-top:2px">${c.detail}</span>
      </div>`;
    });
    html += '</div>';
  }

  body.innerHTML = html;
  _fullHtml = html;
  openReviewSheet();

  // Attach body map events
  const mapContainer = document.getElementById('review-sheet-map')?.querySelector('.body-map-container');
  if (mapContainer) {
    initBodyMapEvents(mapContainer, (mg) => {
      // Inline muscle detail with back button
      const data = review.coverage[mg];
      if (!data) return;
      let detailHtml = `<div style="padding:4px 0">
        <button class="review-back-btn" style="background:none;border:none;color:var(--text-dim);font-size:var(--text-sm);cursor:pointer;padding:4px 0">&larr; Back</button>
        <div style="text-align:center;margin:12px 0">
          <div style="font-size:1.2rem;font-weight:700;color:var(--text-strong)">${mg}</div>
          <div style="font-size:var(--text-sm);color:var(--text-dim)">${Math.round(data.sets)} sets last week</div>
        </div>`;
      if (data.exercises.length > 0) {
        detailHtml += `<div class="section-label-lg">Contributing Exercises</div>`;
        data.exercises.forEach(ex => {
          detailHtml += `<div style="font-size:var(--text-sm);padding:4px 0;color:var(--text)">${ex}</div>`;
        });
      } else {
        detailHtml += `<div style="font-size:var(--text-sm);color:var(--text-dim);text-align:center;padding:12px 0">No exercises hit this muscle last week</div>`;
      }
      detailHtml += `</div>`;
      body.innerHTML = detailHtml;
      body.querySelector('.review-back-btn').onclick = () => showPriorWeekSheet(review, gradeResult);
    });
  }
}

// ---------------------------------------------------------------------------
// This Week card (simple stats)
// ---------------------------------------------------------------------------

export function renderRecapCard() {
  const el = $('recap-card');
  const recap = calcWeeklyRecap();
  if (!recap || (recap.sets === 0 && recap.prevSets === 0)) { el.style.display = 'none'; return; }
  el.style.display = 'block';

  let preview = `${recap.sets} sets &middot; ${fmtNum(displayWeight(recap.volume))} ${store.unit} vol`;
  if (recap.prsThisWeek.length > 0) preview += ` &middot; ${recap.prsThisWeek.length} PR${recap.prsThisWeek.length > 1 ? 's' : ''}`;
  el.innerHTML = `<div class="recap-card-header">This Week</div>` +
    `<div class="recap-card-preview">${preview}</div>` +
    `<div class="recap-card-days">${recap.trainingDays} training day${recap.trainingDays !== 1 ? 's' : ''}</div>`;
  el.onclick = () => showRecapModal(recap);
}

function showRecapModal(recap) {
  const body = $('edit-body');
  let html = '';

  // Current week start (Monday @ 00:00 local) — same pattern used by renderPriorWeekCard
  const now = new Date();
  const thisMonday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * MS_PER_DAY);
  thisMonday.setHours(0, 0, 0, 0);

  // Current-week muscle coverage (skipped muscles will have displayStatus='red')
  const avgCoverage = calcAverageMuscleCoverage();
  const coverage = calcWeeklyCoverage(thisMonday, avgCoverage);
  const fatigueByMuscle = calcFatigueByMuscle();

  // Coverage % badge — how many of 10 muscle groups have been hit this week
  const hitCount = MUSCLE_GROUPS.filter(mg => coverage[mg] && coverage[mg].sets > 0).length;
  const totalCount = MUSCLE_GROUPS.length;
  const coverageClass = hitCount >= 8 ? 'high' : hitCount >= 5 ? 'mid' : 'low';

  html += `<div class="recap-coverage-header">
    <span class="recap-coverage-badge ${coverageClass}">${hitCount}/${totalCount} muscles hit</span>
  </div>`;

  // Top set
  if (recap.topSet) {
    html += `<div class="recap-top-set">
      <div class="recap-top-set-label">Top Set</div>
      <div class="recap-top-set-value">${LIFT_NAMES[recap.topSet.lift]} ${formatWeight(recap.topSet.weight)} ${store.unit} &times; ${recap.topSet.reps}
        <span style="color:var(--text-dim);font-size:0.8rem">= ${formatWeight(recap.topSet.e1rm)} e1RM</span></div>
    </div>`;
  }

  // Body map — skipped muscles render red via displayStatus='red'
  html += `<div style="margin:12px 0"><div class="section-label-lg">Body Map</div>`;
  html += `<div id="recap-modal-map">${renderBodyMap(coverage)}</div></div>`;

  // Stat grid (existing 2x2)
  const volChangeStr = recap.volChange !== null ? `<div class="recap-stat-change ${recap.volChange >= 0 ? 'up' : 'down'}">${recap.volChange >= 0 ? '\u2191' : '\u2193'}${Math.abs(recap.volChange).toFixed(0)}%</div>` : '';
  const setsChangeStr = recap.setsChange !== null ? `<div class="recap-stat-change ${recap.setsChange >= 0 ? 'up' : 'down'}">${recap.setsChange >= 0 ? '\u2191' : '\u2193'}${Math.abs(recap.setsChange).toFixed(0)}%</div>` : '';
  html += `<div class="recap-stat-grid">
    <div class="recap-stat"><div class="recap-stat-label">Sets</div><div class="recap-stat-value">${recap.sets}</div>${setsChangeStr}</div>
    <div class="recap-stat"><div class="recap-stat-label">Volume</div><div class="recap-stat-value">${fmtNum(displayWeight(recap.volume))}</div>${volChangeStr}</div>
    <div class="recap-stat"><div class="recap-stat-label">Training Days</div><div class="recap-stat-value">${recap.trainingDays}</div></div>
    <div class="recap-stat"><div class="recap-stat-label">Fatigue (ACWR)</div><div class="recap-stat-value">${recap.fatigue?.acwr ? recap.fatigue.acwr.toFixed(2) : '\u2014'}</div></div>
  </div>`;

  // Lift Breakdown — per-lift rows (mirrors Week-in-Review sheet, minus prior-week delta)
  const weekStartMs = thisMonday.getTime();
  const weekEndMs = weekStartMs + 7 * MS_PER_DAY;
  const weekEntries = store.entries.filter(e => e.timestamp >= weekStartMs && e.timestamp < weekEndMs);
  html += `<div style="margin:12px 0"><div class="section-label-lg">Lift Breakdown</div>`;
  LIFTS.forEach(l => {
    const liftEntries = weekEntries.filter(e => e.lift === l);
    const sets = liftEntries.length;
    const volume = liftEntries.reduce((sum, e) => sum + e.weight * e.reps, 0);
    const best = bestE1RM(l);
    const avgIntensity = sets > 0 && best > 0
      ? Math.round(liftEntries.reduce((sum, e) => sum + (e.weight / best * 100), 0) / sets)
      : 0;
    const prs = liftEntries.filter(e => e.isPR).length;
    const color = COLORS[l];
    const prBadge = prs > 0 ? ` <span style="color:var(--gold);font-size:0.65rem;font-weight:700">PR</span>` : '';
    const intLabel = avgIntensity > 0 ? ` &middot; ${avgIntensity}%` : '';
    if (sets === 0) {
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);opacity:0.45">
        <span style="color:${color};font-weight:700;font-size:0.75rem;min-width:24px">${LIFT_SHORT[l]}</span>
        <span style="flex:1;font-size:var(--text-sm);color:var(--text-dim)">No sets this week</span>
      </div>`;
    } else {
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="color:${color};font-weight:700;font-size:0.75rem;min-width:24px">${LIFT_SHORT[l]}</span>
        <span style="flex:1;font-size:var(--text-sm);color:var(--text)">${sets} sets &middot; ${fmtNum(displayWeight(volume))} ${store.unit}${intLabel}${prBadge}</span>
      </div>`;
    }
  });
  html += '</div>';

  // Muscle Coverage table — reuses .review-muscle-row grid
  html += `<div style="margin:12px 0"><div class="section-label-lg">Muscle Coverage</div>`;
  MUSCLE_GROUPS.forEach(mg => {
    const data = coverage[mg];
    const sets = data ? Math.round(data.sets) : 0;

    // Same Recovering-override logic as the Week-in-Review sheet
    const fatigueStatus = fatigueByMuscle && fatigueByMuscle[mg] ? fatigueByMuscle[mg].displayStatus : null;
    let status = data ? data.status : 'Skipped';
    if ((status === 'Light' || status === 'Needs more' || status === 'Skipped') && (fatigueStatus === 'red' || fatigueStatus === 'orange')) {
      status = 'Recovering';
    }
    const statusColor = MUSCLE_STATUS_COLORS[status] || 'var(--text-dim)';

    // vs average column
    const vsAvg = data ? data.vsAvg : null;
    let vsAvgStr;
    if (vsAvg === null || vsAvg === undefined) { vsAvgStr = '<span style="color:var(--text-dim)">—</span>'; }
    else if (vsAvg > 10) { vsAvgStr = `<span style="color:var(--green)">+${vsAvg}%</span>`; }
    else if (vsAvg < -10) { vsAvgStr = `<span style="color:var(--red)">${vsAvg}%</span>`; }
    else { vsAvgStr = `<span style="color:var(--text-dim)">${vsAvg > 0 ? '+' : ''}${vsAvg}%</span>`; }

    html += `<div class="review-muscle-row">
      <span class="review-muscle-name">${mg}</span>
      <span class="review-muscle-sets">${sets}</span>
      <span class="review-muscle-status" style="color:${statusColor}">${status}</span>
      <span class="review-muscle-delta">${vsAvgStr}</span>
    </div>`;
  });
  html += '</div>';

  // PRs
  if (recap.prsThisWeek.length > 0) {
    html += `<div style="margin-bottom:12px"><div class="section-label-lg">PRs This Week</div>`;
    recap.prsThisWeek.forEach(e => {
      html += `<div class="recap-pr-item"><span style="color:${COLORS[e.lift]}">${LIFT_NAMES[e.lift]}</span> ${formatWeight(e.weight)} ${store.unit} &times; ${e.reps} = ${formatWeight(e.e1rm)} e1RM</div>`;
    });
    html += '</div>';
  }

  // Streak
  if (recap.streak && recap.streak.current > 0) {
    html += `<div style="font-size:0.8rem;color:var(--text-dim);padding:8px 0;border-top:1px solid var(--border)">
      ${recap.streak.current >= 7 ? '\uD83D\uDD25' : recap.streak.current >= 3 ? '\u26A1' : '\uD83C\uDFCB\uFE0F'}
      <strong style="color:var(--text)">${recap.streak.current} day streak</strong> &middot; Best: ${recap.streak.longest}d &middot; ${recap.streak.weeksActive}/4 weeks active
    </div>`;
  }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const weekStartLabel = `${thisMonday.getDate()} ${MONTH_NAMES[thisMonday.getMonth()]} ${thisMonday.getFullYear()}`;
  $('edit-modal').querySelector('h3').textContent = `This Week \u00b7 ${weekStartLabel}`;
  body.innerHTML = html;
  openModal('edit-modal');

  // Attach body map muscle-click to show contributing exercises inline
  const mapContainer = document.getElementById('recap-modal-map')?.querySelector('.body-map-container');
  if (mapContainer) {
    initBodyMapEvents(mapContainer, (mg) => {
      const data = coverage[mg];
      if (!data) return;
      let detailHtml = `<div style="padding:4px 0">
        <button class="recap-modal-back-btn" style="background:none;border:none;color:var(--text-dim);font-size:var(--text-sm);cursor:pointer;padding:4px 0">&larr; Back</button>
        <div style="text-align:center;margin:12px 0">
          <div style="font-size:1.2rem;font-weight:700;color:var(--text-strong)">${mg}</div>
          <div style="font-size:var(--text-sm);color:var(--text-dim)">${Math.round(data.sets)} sets this week</div>
        </div>`;
      if (data.exercises && data.exercises.length > 0) {
        detailHtml += `<div class="section-label-lg">Contributing Exercises</div>`;
        data.exercises.forEach(ex => {
          detailHtml += `<div style="font-size:var(--text-sm);padding:4px 0;color:var(--text)">${ex}</div>`;
        });
      } else {
        detailHtml += `<div style="font-size:var(--text-sm);color:var(--text-dim);text-align:center;padding:12px 0">No exercises hit this muscle yet this week</div>`;
      }
      detailHtml += `</div>`;
      body.innerHTML = detailHtml;
      body.querySelector('.recap-modal-back-btn').onclick = () => showRecapModal(recap);
    });
  }
}

// ---------------------------------------------------------------------------
// Milestone celebrations
// ---------------------------------------------------------------------------

export function checkAndCelebrateMilestone() {
  const total = getTotal();
  if (!total) return;
  let celebrated = {};
  try { celebrated = JSON.parse(localStorage.getItem(TOTAL_CELEBRATED_KEY)) || {}; } catch {}
  // Find highest uncelebrated milestone
  let target = null;
  for (let i = TOTAL_MILESTONES.length - 1; i >= 0; i--) {
    if (total >= TOTAL_MILESTONES[i] && !celebrated[TOTAL_MILESTONES[i]]) {
      target = TOTAL_MILESTONES[i];
      break;
    }
  }
  if (!target) return;
  celebrated[target] = Date.now().toString();
  localStorage.setItem(TOTAL_CELEBRATED_KEY, JSON.stringify(celebrated));
  const msTheme = TOTAL_MILESTONE_THEMES[target];
  setTimeout(() => showCelebration(total, msTheme), 600);
}

function showCelebration(total, msTheme) {
  msTheme = msTheme || TOTAL_MILESTONE_THEMES[1000];
  const overlay = document.createElement('div');
  overlay.className = 'celebration-overlay';

  // Confetti particles
  const confettiColors = msTheme.confettiColors;
  for (let i = 0; i < CONFETTI_COUNT; i++) {
    const p = document.createElement('div');
    p.className = 'confetti';
    const size = 6 + Math.random() * 8;
    p.style.left = Math.random() * 100 + '%';
    p.style.width = size + 'px';
    p.style.height = (Math.random() > 0.5 ? size : size * 2.5) + 'px';
    p.style.background = confettiColors[Math.floor(Math.random() * confettiColors.length)];
    p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    p.style.animationDuration = (2 + Math.random() * 3) + 's';
    p.style.animationDelay = (Math.random() * 2.5) + 's';
    overlay.appendChild(p);
  }

  const sq = bestE1RM('squat'), bp = bestE1RM('bench'), dl = bestE1RM('deadlift');

  const content = document.createElement('div');
  content.className = 'celebration-content';
  content.innerHTML = `
    <button class="celebration-close" aria-label="Close">&times;</button>
    <div class="celebration-crown">${msTheme.emoji}</div>
    <div class="celebration-subtitle">WELCOME TO THE</div>
    <div class="celebration-title" style="color:${msTheme.color}">${msTheme.title}</div>
    <div class="celebration-total">${formatWeight(total)} ${store.unit}</div>
    <div class="celebration-breakdown">
      <div class="cb-lift">
        <span class="cb-label" style="color:${COLORS.squat}">SQ</span>
        <span class="cb-value">${sq ? formatWeight(sq) : '\u2014'}</span>
      </div>
      <div class="cb-lift">
        <span class="cb-label" style="color:${COLORS.bench}">BP</span>
        <span class="cb-value">${bp ? formatWeight(bp) : '\u2014'}</span>
      </div>
      <div class="cb-lift">
        <span class="cb-label" style="color:${COLORS.deadlift}">DL</span>
        <span class="cb-value">${dl ? formatWeight(dl) : '\u2014'}</span>
      </div>
    </div>
    <div class="celebration-date">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
    <div class="celebration-actions">
      <button class="celebration-share-btn">\uD83D\uDCE4 Share Achievement</button>
    </div>
  `;

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  function dismiss() {
    overlay.classList.add('fade-out');
    setTimeout(() => overlay.remove(), 500);
  }

  content.querySelector('.celebration-close').addEventListener('click', dismiss);
  overlay.addEventListener('click', e => { if (e.target === overlay) dismiss(); });
  const autoDismiss = setTimeout(dismiss, CELEBRATION_DISMISS_MS);

  content.querySelector('.celebration-share-btn').addEventListener('click', () => {
    clearTimeout(autoDismiss);
    shareMilestoneCard(total, sq, bp, dl, msTheme);
  });
}

// ---------------------------------------------------------------------------
// Fatigue sheet swipe-dismiss + listeners
// ---------------------------------------------------------------------------

export function initFatigueSheetListeners() {
  // Close/backdrop listeners and swipe-dismiss are handled by
  // initSheetListeners() in src/ui/sheet.js — no duplicate wiring needed.
}

// ---------------------------------------------------------------------------
// Main updateDashboard()
// ---------------------------------------------------------------------------

/**
 * Full dashboard refresh — called after logging, editing, importing, etc.
 */
export function updateDashboard() {
  LIFTS.forEach(updateLiftCard);
  updateTotalCard();
  if (store.dashboardWidgets.ratios) updateStrengthRatios(); else $('strength-ratios').style.display = 'none';
  updateScoreLine();
  if (store.dashboardWidgets.fatigue) updateFatigueBar(); else $('fatigue-bar').style.display = 'none';
  if (store.dashboardWidgets.streak) updateStreakBar(); else $('streak-bar').style.display = 'none';
  renderPriorWeekCard();
  if (store.dashboardWidgets.recap) renderRecapCard(); else $('recap-card').style.display = 'none';
  updatePRStreakBar();
  updatePlateauCards();
  checkAndCelebrateMilestone();
  checkBadges();
}

