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
import { calcFatigueByMuscle, calcFatigueDetail, getRecoveryAdvice } from '../systems/fatigue.js';
import { calcStreak } from '../systems/streak.js';
import { calcWeeklyRecap } from '../systems/weekly-recap.js';
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
  if (best !== null) { el.textContent = formatWeight(best); el.classList.remove('empty'); }
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
  if (cls) { badgeEl.textContent = cls; badgeEl.className = 'class-badge ' + cls; badgeEl.style.display = ''; }
  else { badgeEl.style.display = 'none'; }
  const trendEl = ensureChild(card, 'card-trend');
  const prog = calcProgression(lift);
  if (prog) {
    const arrow = DIRECTION_ARROWS[prog.direction];
    trendEl.textContent = `${arrow} ${Math.abs(prog.monthRate).toFixed(1)} ${store.unit}/mo`;
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
  if (total) { totalEl.textContent = formatWeight(total); totalEl.classList.remove('empty'); }
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
  if (oc) { tBadge.textContent = oc; tBadge.className = 'class-badge ' + oc; tBadge.style.display = ''; }
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
    if (cls) html += ` &middot; <span class="class-badge ${cls}" style="vertical-align:middle">${cls}</span>`;
    el.innerHTML = html;
  } else { el.style.display = 'none'; }
}

// ---------------------------------------------------------------------------
// Fatigue indicator
// ---------------------------------------------------------------------------

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
// Fatigue sheet helpers
// ---------------------------------------------------------------------------

function openFatigueSheet() {
  $('fatigue-sheet-backdrop').style.display = 'block';
  $('fatigue-sheet').style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function closeFatigueSheet() {
  const sheet = $('fatigue-sheet'), backdrop = $('fatigue-sheet-backdrop');
  sheet.style.transform = ''; sheet.style.transition = '';
  backdrop.style.opacity = ''; backdrop.style.transition = '';
  backdrop.style.display = 'none';
  sheet.style.display = 'none';
  document.body.style.overflow = '';
}

function showFatigueDetail(mg) {
  const detail = calcFatigueDetail(mg);
  if (!detail) {
    $('fatigue-sheet-title').textContent = mg + ' Fatigue';
    $('fatigue-sheet-body').innerHTML = '<div style="padding:24px 0;text-align:center;color:var(--text-dim)">Not enough data (need 3+ entries in 28 days)</div>';
    openFatigueSheet();
    return;
  }

  $('fatigue-sheet-title').textContent = mg + ' Fatigue';
  const statusColor = `var(--${detail.status})`;
  let html = '';

  // 1. Status banner
  html += `<div class="fatigue-detail-banner ${detail.status}">` +
    `<span class="fatigue-dot ${detail.status}"></span>` +
    `<span>${detail.label} Fatigue</span>` +
    `<span style="margin-left:auto;font-size:var(--text-sm);opacity:0.8">ACWR ${detail.acwr !== null ? detail.acwr.toFixed(2) : '\u2014'}</span>` +
    `</div>`;

  // 2. Stat grid
  html += `<div class="recap-stat-grid">` +
    `<div class="recap-stat"><div class="recap-stat-label">7-Day Tonnage</div><div class="recap-stat-value">${fmtNum(displayWeight(detail.ton7))}</div></div>` +
    `<div class="recap-stat"><div class="recap-stat-label">Weekly Avg (28d)</div><div class="recap-stat-value">${fmtNum(displayWeight(detail.weeklyAvg28))}</div></div>` +
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

  // 4. Recovery advice
  const advice = getRecoveryAdvice(detail);
  html += `<div class="fatigue-advice ${detail.status}">${advice}</div>`;

  // 5. Weekly tonnage trend
  const maxTrend = Math.max(...detail.weeklyTrend, 1);
  html += `<div class="section-label-lg">Weekly Tonnage Trend</div>`;
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
    const maxContrib = Math.max(...detail.contributors.map(c => c.ton7), 1);
    html += `<div class="section-label-lg">Contributing Exercises</div>`;
    detail.contributors.forEach(c => {
      const pct = (c.ton7 / maxContrib) * 100;
      const barColor = c.lift && COLORS[c.lift] ? COLORS[c.lift] : 'var(--text-dim)';
      const badgeBg = c.type === 'Main' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)';
      const badgeColor = c.type === 'Main' ? 'var(--text)' : 'var(--text-dim)';
      html += `<div class="fatigue-contributor">` +
        `<span class="fatigue-contributor-name">${c.name}</span>` +
        `<span class="fatigue-contributor-badge" style="background:${badgeBg};color:${badgeColor}">${c.type}</span>` +
        `<span style="font-size:var(--text-xs);color:var(--text-dim)">${Math.round(c.muscleWeight * 100)}%</span>` +
        `<div class="fatigue-contributor-bar"><div class="fatigue-contributor-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>` +
        `<span class="fatigue-contributor-vol">${fmtNum(displayWeight(c.ton7))}</span>` +
        `</div>`;
    });
  }

  $('fatigue-sheet-body').innerHTML = html;
  openFatigueSheet();
}

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

export function renderRecapCard() {
  const el = $('recap-card');
  const recap = calcWeeklyRecap();
  if (!recap || (recap.sets === 0 && recap.prevSets === 0)) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  let preview = `${recap.sets} sets &middot; ${fmtNum(displayWeight(recap.volume))} ${store.unit} vol`;
  if (recap.prsThisWeek.length > 0) preview += ` &middot; ${recap.prsThisWeek.length} PR${recap.prsThisWeek.length > 1 ? 's' : ''}`;
  el.innerHTML = `<div class="recap-card-header">This Week</div><div class="recap-card-preview">${preview}</div>`;
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
  $('fatigue-sheet-close').addEventListener('click', closeFatigueSheet);
  $('fatigue-sheet-backdrop').addEventListener('click', closeFatigueSheet);

  // Swipe dismiss
  enableSheetSwipeDismiss('fatigue-sheet', 'fatigue-sheet-backdrop', closeFatigueSheet);
}

function enableSheetSwipeDismiss(sheetId, backdropId, closeFn) {
  const sheet = $(sheetId), backdrop = $(backdropId);
  let startY, startTime, offset, swiping, locked, onHandle;
  const DEAD_ZONE = 8;

  sheet.addEventListener('touchstart', e => {
    if (sheet.style.display === 'none') return;
    const t = e.touches[0];
    startY = t.clientY; startTime = Date.now();
    offset = 0; swiping = false; locked = false;
    onHandle = !!e.target.closest('.sheet-handle');
  }, { passive: true });

  sheet.addEventListener('touchmove', e => {
    if (locked && !swiping) return;
    const dy = e.touches[0].clientY - startY;
    if (!locked) {
      if (Math.abs(dy) < DEAD_ZONE) return;
      locked = true;
      if (dy > 0 && (onHandle || sheet.scrollTop <= 1)) {
        swiping = true;
      } else {
        return;
      }
    }
    if (!swiping) return;
    e.preventDefault();
    offset = Math.max(0, dy);
    sheet.style.transition = 'none';
    sheet.style.transform = 'translateY(' + offset + 'px)';
    backdrop.style.transition = 'none';
    backdrop.style.opacity = Math.max(0, 1 - offset / sheet.offsetHeight);
  }, { passive: false });

  sheet.addEventListener('touchend', () => {
    if (!swiping) return;
    const elapsed = Date.now() - startTime;
    const velocity = offset / elapsed;
    if (offset > sheet.offsetHeight * 0.3 || velocity > 0.5) {
      sheet.style.transition = 'transform 0.2s ease';
      sheet.style.transform = 'translateY(100%)';
      backdrop.style.transition = 'opacity 0.2s ease';
      backdrop.style.opacity = '0';
      setTimeout(closeFn, 200);
    } else {
      sheet.style.transition = 'transform 0.25s ease';
      sheet.style.transform = 'translateY(0)';
      backdrop.style.transition = 'opacity 0.25s ease';
      backdrop.style.opacity = '1';
      setTimeout(() => {
        sheet.style.transform = ''; sheet.style.transition = '';
        backdrop.style.opacity = ''; backdrop.style.transition = '';
      }, 250);
    }
    swiping = false;
  }, { passive: true });
}

// Re-export for use by other views that need sheet swipe dismiss
export { enableSheetSwipeDismiss };

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
  if (store.dashboardWidgets.recap) renderRecapCard(); else $('recap-card').style.display = 'none';
  updatePRStreakBar();
  checkAndCelebrateMilestone();
  checkBadges();
}
