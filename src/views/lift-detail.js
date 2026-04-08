/**
 * Lift detail bottom sheet — shows detailed stats when tapping
 * a lift card (squat/bench/deadlift) on the dashboard.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFT_NAMES, COLORS, PLATE_MILESTONES, REP_RANGES } from '../constants/lift-config.js';
import { DIRECTION_ARROWS } from '../constants/ui.js';
import { MS_PER_DAY } from '../constants/time.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { formatWeight, displayWeight, lbsToKg } from '../formulas/units.js';
import { calcProgression, detectPlateau } from '../formulas/progression.js';
import { getClassification } from '../formulas/standards.js';
import { calcDOTS } from '../formulas/scoring.js';
import { openSheet, closeSheet, enableSheetSwipeDismiss } from '../ui/sheet.js';
import { calcMilestoneRoadmap } from '../systems/goals.js';

/* --- RPE color helpers --- */
function rpeColor(rpe) {
  if (rpe == null) return 'var(--text-dim)';
  if (rpe <= 7) return 'var(--green)';
  if (rpe <= 8) return 'var(--yellow, #fbc02d)';
  if (rpe <= 9) return 'var(--orange, #fb8c00)';
  return 'var(--red)';
}
function rpeClass(rpe) {
  if (rpe == null) return 'none';
  if (rpe <= 7) return 'low';
  if (rpe <= 8) return 'mod';
  if (rpe <= 9) return 'high';
  return 'max';
}

function closeLiftDetail() {
  closeSheet('lift-detail-sheet', 'lift-detail-backdrop');
}

export function showLiftDetail(lift) {
  const best = bestE1RM(lift);
  const cls = getClassification(lift, best);
  const prog = calcProgression(lift);
  const plateaued = best && detectPlateau(lift);
  const goal = store.goals[lift];
  const bw = store.profile.bodyweight;
  const gender = store.profile.gender;

  const liftEntries = store.entries
    .filter(e => e.lift === lift)
    .sort((a, b) => b.timestamp - a.timestamp);

  let html = '';
  let sectionIdx = 0;

  // --- 1. Hero banner (compact, includes all-time best) ---
  html += `<div class="ld-section ld-banner ${lift}" style="--i:${sectionIdx++}">`;
  html += `<div class="ld-banner-e1rm">${best ? formatWeight(best) : '\u2014'} <span class="ld-banner-unit">${store.unit}</span></div>`;
  html += `<div class="ld-banner-label">Estimated 1RM</div>`;
  html += `<div class="ld-banner-meta">`;
  if (cls) html += `<span class="class-badge ${cls}">${cls}</span>`;
  if (best && bw) html += `<span class="ld-banner-bw">${(best / bw).toFixed(1)}x BW</span>`;
  if (best && bw && gender) {
    const dots = calcDOTS(lbsToKg(best), lbsToKg(bw), gender);
    if (dots) html += `<span class="ld-banner-dots">${dots.toFixed(0)} DOTS</span>`;
  }
  if (plateaued) html += `<span class="ld-plateau">Plateaued</span>`;
  html += `</div>`;
  // All-time best merged into hero
  if (liftEntries.length > 0) {
    const bestEntry = liftEntries.reduce((b, e) => e.e1rm > b.e1rm ? e : b, liftEntries[0]);
    html += `<div class="ld-banner-best">Best: ${formatWeight(bestEntry.weight)} &times; ${bestEntry.reps} = ${formatWeight(bestEntry.e1rm)} e1RM &bull; ${bestEntry.date}</div>`;
  }
  if (prog) {
    const arrow = DIRECTION_ARROWS[prog.direction];
    html += `<div class="ld-banner-trend ${prog.direction}">${arrow} ${Math.round(Math.abs(prog.delta))} ${store.unit} / 90d</div>`;
  }
  html += `</div>`;

  // --- 2. Progress grid 2×2 (compact) ---
  if (liftEntries.length >= 2) {
    const sessionBests = new Map();
    for (const e of liftEntries) {
      const cur = sessionBests.get(e.date);
      if (!cur || e.e1rm > cur.e1rm) sessionBests.set(e.date, e);
    }
    const sortedSessions = [...sessionBests.values()].sort((a, b) => b.timestamp - a.timestamp);
    const lastE1rm = sortedSessions[0].e1rm;
    const prevE1rm = sortedSessions[1].e1rm;
    const delta = lastE1rm - prevE1rm;
    const deltaSign = delta >= 0 ? '+' : '';
    const deltaClass = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oldEntries = liftEntries.filter(e => e.timestamp < thirtyDaysAgo);
    const oldBest = oldEntries.length ? Math.max(...oldEntries.map(e => e.e1rm)) : null;
    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthSessions = new Set(liftEntries.filter(e => e.date.startsWith(thisMonth)).map(e => e.date)).size;

    html += `<div class="ld-section ld-progress" style="--i:${sectionIdx++}">`;
    html += `<div class="ld-progress-grid">`;
    html += `<div class="ld-progress-item"><div class="ld-progress-label">Last vs Prev</div><div class="ld-progress-value">${formatWeight(lastE1rm)} vs ${formatWeight(prevE1rm)}</div><div class="ld-progress-delta ${deltaClass}">${deltaSign}${formatWeight(Math.abs(delta))}</div></div>`;
    if (oldBest) {
      const d30 = best - oldBest;
      const d30Class = d30 > 0 ? 'up' : d30 < 0 ? 'down' : 'flat';
      html += `<div class="ld-progress-item"><div class="ld-progress-label">30-Day</div><div class="ld-progress-value">${formatWeight(best)}</div><div class="ld-progress-delta ${d30Class}">${d30 >= 0 ? '+' : ''}${formatWeight(Math.abs(d30))}</div></div>`;
    }
    html += `<div class="ld-progress-item"><div class="ld-progress-label">This Month</div><div class="ld-progress-value">${monthSessions} session${monthSessions !== 1 ? 's' : ''}</div></div>`;
    html += `<div class="ld-progress-item"><div class="ld-progress-label">Total</div><div class="ld-progress-value">${liftEntries.length} sets</div></div>`;
    html += `</div></div>`;
  }

  // --- 3. Goal bar + Milestone Roadmap ---
  if (goal && best) {
    const pct = Math.min(100, best / goal * 100);
    html += `<div class="ld-section" style="--i:${sectionIdx++}">`;
    html += `<div class="ld-goal-label">${pct.toFixed(0)}% of ${formatWeight(goal)} ${store.unit} goal</div>`;
    html += `<div class="ld-goal-bar"><div class="ld-goal-fill" style="width:${pct}%"></div></div>`;
    // Milestone roadmap (same as stats tab)
    const rm = calcMilestoneRoadmap(lift);
    if (rm) {
      html += `<div class="ld-roadmap">`;
      rm.milestones.forEach(ms => {
        const dotColor = ms.achieved ? COLORS[lift] : 'var(--border)';
        const textColor = ms.achieved ? 'var(--text)' : 'var(--text-dim)';
        const estLabel = ms.estDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        html += `<div class="ld-roadmap-item" style="color:${textColor}">`;
        html += `<span class="ld-roadmap-dot" style="background:${dotColor}"></span>`;
        html += `<span><strong>${formatWeight(ms.target)}</strong> ${ms.label}</span>`;
        html += `<span class="ld-roadmap-est">${ms.achieved ? 'Done' : '~' + estLabel}</span>`;
        html += `</div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  // --- 4. Sparkline trend (compact, 60px) ---
  if (liftEntries.length >= 2) {
    const sessionMap = new Map();
    for (const e of liftEntries) {
      if (!sessionMap.has(e.date) || e.e1rm > sessionMap.get(e.date).e1rm) {
        sessionMap.set(e.date, { ...e });
      }
    }
    const prDates = new Set(liftEntries.filter(e => e.isPR).map(e => e.date));
    const sessionList = [...sessionMap.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-10);

    if (sessionList.length >= 2) {
      const e1rms = sessionList.map(s => s.e1rm);
      const min = Math.min(...e1rms), max = Math.max(...e1rms), range = max - min || 1;
      const svgW = 280, svgH = 60, padX = 8, padY = 6;
      const plotW = svgW - padX * 2, plotH = svgH - padY * 2;
      const color = COLORS[lift];
      const points = sessionList.map((s, i) => ({
        x: padX + (i / (sessionList.length - 1)) * plotW,
        y: padY + plotH - ((s.e1rm - min) / range) * plotH,
        isPR: prDates.has(s.date),
      }));
      const lineStr = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const areaStr = `${points[0].x.toFixed(1)},${svgH - padY} ${lineStr} ${points[points.length - 1].x.toFixed(1)},${svgH - padY}`;

      html += `<div class="ld-section" style="--i:${sectionIdx++}">`;
      html += `<div class="ld-section-title">Trend</div>`;
      html += `<svg class="ld-sparkline" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none">`;
      html += `<defs><linearGradient id="ld-grad-${lift}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.35"/><stop offset="100%" stop-color="${color}" stop-opacity="0.03"/></linearGradient></defs>`;
      html += `<polygon points="${areaStr}" fill="url(#ld-grad-${lift})"/>`;
      html += `<polyline points="${lineStr}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      points.forEach(p => { if (p.isPR) html += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--gold, #ffd700)" stroke="var(--surface)" stroke-width="1.5"/>`; });
      html += `</svg>`;
      html += `<div class="ld-sparkline-labels"><span>${sessionList[0].date.slice(5)}</span><span>${sessionList[sessionList.length - 1].date.slice(5)}</span></div>`;
      html += `</div>`;
    }
  }

  // --- 5. Last 3 sessions (compact single-line) ---
  if (liftEntries.length > 0) {
    const sessions = [];
    const seen = new Set();
    for (const e of liftEntries) {
      if (!seen.has(e.date)) {
        seen.add(e.date);
        const dayEntries = liftEntries.filter(x => x.date === e.date);
        const topSet = dayEntries.reduce((b, x) => x.e1rm > b.e1rm ? x : b, dayEntries[0]);
        sessions.push({ date: e.date, topSet, sets: dayEntries.length });
      }
      if (sessions.length >= 3) break;
    }

    html += `<div class="ld-section" style="--i:${sectionIdx++}">`;
    html += `<div class="ld-section-title">Recent</div>`;
    sessions.forEach(s => {
      html += `<div class="ld-compact-session">`;
      html += `<span class="ld-compact-date">${s.date.slice(5)}</span>`;
      html += `<span>${formatWeight(s.topSet.weight)} &times; ${s.topSet.reps}</span>`;
      html += `<span class="ld-compact-e1rm">= ${formatWeight(s.topSet.e1rm)}</span>`;
      html += `<span class="ld-compact-sets">${s.sets}s</span>`;
      html += `</div>`;
    });
    html += `</div>`;
  }

  $('lift-detail-title').textContent = LIFT_NAMES[lift];
  $('lift-detail-body').innerHTML = html;
  openSheet('lift-detail-sheet', 'lift-detail-backdrop');

  // Wire plateau buttons if diagnosis is present
  if (plateaued) {
    const diagnosis = diagnosePlateau(lift);
    if (diagnosis) wireLiftDetailButtons('lift-detail-body', lift, diagnosis);
  }

  // Feature 4: Wire session expand/collapse
  document.querySelectorAll('.ld-session-expandable').forEach(card => {
    card.querySelector('.ld-session-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
  });
}

export function initLiftDetailSheet() {
  $('lift-detail-close').addEventListener('click', closeLiftDetail);
  $('lift-detail-backdrop').addEventListener('click', closeLiftDetail);

  enableSheetSwipeDismiss('lift-detail-sheet', 'lift-detail-backdrop', closeLiftDetail);

  // Dashboard card click handlers
  document.querySelectorAll('.card[data-lift]').forEach(card => {
    if (card.dataset.lift === 'total') return;
    card.addEventListener('click', () => showLiftDetail(card.dataset.lift));
  });
}
