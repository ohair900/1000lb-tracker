/**
 * Dashboard view — renders the top-level dashboard cards, goal bars,
 * strength ratios, score line, fatigue indicator, streak bars,
 * weekly recap card, milestone celebrations, and PR streak.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { fmtNum, ensureChild } from '../utils/helpers.js';
import { LIFTS, COLORS, LIFT_SHORT, LIFT_NAMES, PLATE_MILESTONES } from '../constants/lift-config.js';
import { MS_PER_DAY } from '../constants/time.js';
import { DIRECTION_ARROWS, CONFETTI_COUNT, CELEBRATION_DISMISS_MS } from '../constants/ui.js';
import { TOTAL_MILESTONES, TOTAL_MILESTONE_THEMES } from '../data/milestones.js';
import { TOTAL_CELEBRATED_KEY } from '../constants/storage-keys.js';
import { MUSCLE_GROUPS } from '../data/muscle-groups.js';
import { bestE1RM, getTotal } from '../formulas/e1rm.js';
import { displayWeight, formatWeight, lbsToKg } from '../formulas/units.js';
import { calcWilks, calcDOTS } from '../formulas/scoring.js';
import { calcProgression, detectPlateau } from '../formulas/progression.js';
import { getClassification, getOverallClassification } from '../formulas/standards.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';
import { showFatigueDetail } from '../views/fatigue-sheet.js';
import { renderBodyMap, initBodyMapEvents } from '../views/body-map.js';
import { updatePlateauCards } from '../views/plateau-analysis.js';
import { calcStreak } from '../systems/streak.js';
import { calcWeeklyRecap } from '../systems/weekly-recap.js';
import { calcPriorWeekReview } from '../systems/weekly-coverage.js';
import { calcWeeklyGrade } from '../systems/weekly-grade.js';
import { openReviewSheet, closeReviewSheet } from '../ui/sheet.js';
import { enableSheetSwipeDismiss } from '../ui/sheet.js';
import { checkBadges } from '../systems/badges.js';
import { openModal } from '../ui/modal.js';
import { shareMilestoneCard } from '../ui/share.js';

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
  const platEl = ensureChild(card.querySelector('.card-label'), 'plateau-icon', 'span');
  if (best && detectPlateau(lift)) {
    platEl.innerHTML = '\u26A0\uFE0F<span class="plateau-tooltip">Plateau detected: no e1RM gain in 4+ weeks</span>';
    platEl.style.display = 'inline';
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
  bsEl.className = 'ratio-value ' + (bsRatio >= 55 && bsRatio <= 70 ? 'balanced' : bsRatio >= 50 && bsRatio <= 75 ? 'warning' : 'imbalanced');
  dsEl.textContent = Math.round(dsRatio) + '%';
  dsEl.className = 'ratio-value ' + (dsRatio >= 110 && dsRatio <= 125 ? 'balanced' : dsRatio >= 100 && dsRatio <= 135 ? 'warning' : 'imbalanced');
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

  const frontGroups = ['Shoulders', 'Chest', 'Biceps', 'Core', 'Quads'];
  const backGroups = ['Upper Back', 'Lower Back', 'Triceps', 'Glutes', 'Hams'];

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
  html += `<div class="fatigue-group-label">Front</div>`;
  html += `<div class="fatigue-group-row">${buildCards(frontGroups)}</div>`;
  html += `<div class="fatigue-group-label">Back</div>`;
  html += `<div class="fatigue-group-row">${buildCards(backGroups)}</div>`;
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

  el.innerHTML = `<div class="recap-card-header">Last Week in Review ${gradeHtml}</div>` +
    `<div class="recap-card-preview">${statsLine}</div>` +
    `<div class="prior-week-focus">${review.focus}</div>`;
  el.onclick = () => showPriorWeekSheet(review, gradeResult);

  // Init swipe dismiss once
  if (!_reviewSheetSwipeInit) {
    _reviewSheetSwipeInit = true;
    enableSheetSwipeDismiss('review-sheet', 'review-sheet-backdrop', closeReviewSheet);
    $('review-sheet-close').onclick = closeReviewSheet;
    $('review-sheet-backdrop').onclick = closeReviewSheet;
  }
}

function showPriorWeekSheet(review, gradeResult) {
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

  // Per-lift breakdown
  html += `<div style="margin:12px 0"><div class="section-label-lg">Lift Breakdown</div>`;
  LIFTS.forEach(l => {
    const s = review.liftStats[l];
    const color = COLORS[l];
    const prBadge = s.prs > 0 ? ` <span style="color:var(--gold);font-size:0.65rem;font-weight:700">PR</span>` : '';
    const intLabel = s.avgIntensity > 0 ? ` &middot; ${s.avgIntensity}% avg` : '';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="color:${color};font-weight:700;font-size:0.75rem;min-width:24px">${LIFT_SHORT[l]}</span>
      <span style="flex:1;font-size:var(--text-sm);color:var(--text)">${s.sets} sets &middot; ${fmtNum(displayWeight(s.volume))} ${store.unit}${intLabel}${prBadge}</span>
    </div>`;
  });
  html += '</div>';

  // Muscle coverage table
  html += `<div style="margin:12px 0"><div class="section-label-lg">Muscle Coverage</div>`;
  MUSCLE_GROUPS.forEach(mg => {
    const data = review.coverage[mg];
    const sets = data ? Math.round(data.sets) : 0;
    const color = sets >= 3 ? 'var(--green)' : sets >= 2 ? 'var(--lime, var(--green))' : sets >= 1 ? 'var(--yellow)' : 'var(--text-dim)';
    html += `<div style="display:flex;justify-content:space-between;font-size:var(--text-xs);padding:3px 0">
      <span style="color:var(--text)">${mg}</span>
      <span style="color:${color};font-weight:600">${sets} sets</span>
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

  // Focus suggestion
  html += `<div style="font-size:0.8rem;color:var(--text);padding:10px 0;border-top:1px solid var(--border);font-weight:600">${review.focus}</div>`;

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

  // Top set
  if (recap.topSet) {
    html += `<div class="recap-top-set">
      <div class="recap-top-set-label">Top Set</div>
      <div class="recap-top-set-value">${LIFT_NAMES[recap.topSet.lift]} ${formatWeight(recap.topSet.weight)} ${store.unit} &times; ${recap.topSet.reps}
        <span style="color:var(--text-dim);font-size:0.8rem">= ${formatWeight(recap.topSet.e1rm)} e1RM</span></div>
    </div>`;
  }

  // Stat grid
  const volChangeStr = recap.volChange !== null ? `<div class="recap-stat-change ${recap.volChange >= 0 ? 'up' : 'down'}">${recap.volChange >= 0 ? '\u2191' : '\u2193'}${Math.abs(recap.volChange).toFixed(0)}%</div>` : '';
  const setsChangeStr = recap.setsChange !== null ? `<div class="recap-stat-change ${recap.setsChange >= 0 ? 'up' : 'down'}">${recap.setsChange >= 0 ? '\u2191' : '\u2193'}${Math.abs(recap.setsChange).toFixed(0)}%</div>` : '';
  html += `<div class="recap-stat-grid">
    <div class="recap-stat"><div class="recap-stat-label">Sets</div><div class="recap-stat-value">${recap.sets}</div>${setsChangeStr}</div>
    <div class="recap-stat"><div class="recap-stat-label">Volume</div><div class="recap-stat-value">${fmtNum(displayWeight(recap.volume))}</div>${volChangeStr}</div>
    <div class="recap-stat"><div class="recap-stat-label">Training Days</div><div class="recap-stat-value">${recap.trainingDays}</div></div>
    <div class="recap-stat"><div class="recap-stat-label">Fatigue (ACWR)</div><div class="recap-stat-value">${recap.fatigue?.acwr ? recap.fatigue.acwr.toFixed(2) : '\u2014'}</div></div>
  </div>`;

  // Per-lift volume bars
  const maxLiftVol = Math.max(...Object.values(recap.liftVolume), 1);
  html += `<div style="margin-bottom:12px"><div class="section-label-lg">Volume by Lift</div>`;
  LIFTS.forEach(l => {
    const vol = recap.liftVolume[l];
    const pct = maxLiftVol > 0 ? (vol / maxLiftVol * 100) : 0;
    html += `<div class="recap-lift-bar">
      <span class="recap-lift-label" style="color:${COLORS[l]}">${LIFT_SHORT[l]}</span>
      <div style="flex:1;background:var(--surface2);border-radius:3px;overflow:hidden;height:14px">
        <div class="recap-lift-fill" style="width:${pct}%;background:${COLORS[l]};height:100%"></div>
      </div>
      <span class="recap-lift-vol">${fmtNum(displayWeight(vol))}</span>
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

  $('edit-modal').querySelector('h3').textContent = 'Weekly Recap';
  body.innerHTML = html;
  openModal('edit-modal');
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

