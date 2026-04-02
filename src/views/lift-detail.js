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
import { getRepPRs } from '../systems/pr-tracking.js';
import { openSheet, closeSheet, enableSheetSwipeDismiss } from '../ui/sheet.js';
import { renderPlateauSection, wireLiftDetailButtons } from '../views/plateau-analysis.js';
import { diagnosePlateau } from '../systems/plateau-breaker.js';

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
  const repPRs = getRepPRs()[lift] || {};
  const bw = store.profile.bodyweight;
  const gender = store.profile.gender;

  // Collect all entries for this lift
  const liftEntries = store.entries
    .filter(e => e.lift === lift)
    .sort((a, b) => b.timestamp - a.timestamp);

  let html = '';
  let sectionIdx = 0;

  // --- 1. Lift-colored hero banner ---
  html += `<div class="ld-section ld-banner ${lift}" style="--i:${sectionIdx++}">`;
  html += `<div class="ld-banner-e1rm">${best ? formatWeight(best) : '\u2014'} <span class="ld-banner-unit">${store.unit}</span></div>`;
  html += `<div class="ld-banner-label">Estimated 1RM</div>`;
  html += `<div class="ld-banner-meta">`;
  if (cls) html += `<span class="class-badge ${cls}">${cls}</span>`;
  if (best && bw) html += `<span class="ld-banner-bw">${(best / bw).toFixed(1)}x BW</span>`;
  // Feature 6: DOTS badge
  if (best && bw && gender) {
    const dots = calcDOTS(lbsToKg(best), lbsToKg(bw), gender);
    if (dots) html += `<span class="ld-banner-dots">${dots.toFixed(0)} DOTS</span>`;
  }
  if (plateaued) html += `<span class="ld-plateau">Plateaued</span>`;
  html += `</div>`;
  if (prog) {
    const arrow = DIRECTION_ARROWS[prog.direction];
    html += `<div class="ld-banner-trend ${prog.direction}">${arrow} ${Math.abs(prog.monthRate).toFixed(1)} ${store.unit}/mo</div>`;
  }
  html += `</div>`;

  // --- 1b. Plateau analysis (if plateaued) ---
  if (plateaued) {
    html += `<div class="ld-section" style="--i:${sectionIdx++}">`;
    html += renderPlateauSection(lift);
    html += `</div>`;
  }

  // --- 2. Gold best-lift box ---
  if (liftEntries.length > 0) {
    const bestEntry = liftEntries.reduce((b, e) => e.e1rm > b.e1rm ? e : b, liftEntries[0]);
    html += `<div class="ld-section ld-best-lift" style="--i:${sectionIdx++}">`;
    html += `<div class="ld-best-label">All-Time Best</div>`;
    html += `<div class="ld-best-value">${formatWeight(bestEntry.weight)} ${store.unit} &times; ${bestEntry.reps}</div>`;
    html += `<div class="ld-best-detail">= ${formatWeight(bestEntry.e1rm)} e1RM &bull; ${bestEntry.date}</div>`;
    html += `</div>`;
  }

  // --- Goal bar ---
  if (goal && best) {
    const pct = Math.min(100, best / goal * 100);
    html += `<div class="ld-section ld-goal-section" style="--i:${sectionIdx++}">`;
    html += `<div class="ld-goal-label">${pct.toFixed(0)}% of ${formatWeight(goal)} ${store.unit} goal</div>`;
    html += `<div class="ld-goal-bar"><div class="ld-goal-fill" style="width:${pct}%"></div></div>`;
    // Feature 5: Time-to-beat projection
    if (prog && prog.direction === 'up' && prog.monthRate > 0) {
      const remaining = goal - best; // in lbs (internal)
      const monthsLeft = remaining / prog.monthRate;
      if (monthsLeft > 0 && monthsLeft < 120) {
        const targetDate = new Date();
        targetDate.setMonth(targetDate.getMonth() + Math.ceil(monthsLeft));
        const monthName = targetDate.toLocaleString('default', { month: 'short' });
        html += `<div class="ld-goal-projection">At current rate &rarr; ~${monthName} ${targetDate.getFullYear()}</div>`;
      }
    }
    html += `</div>`;
  }

  // --- Next milestone ---
  if (best) {
    const nextPlate = PLATE_MILESTONES.find(m => displayWeight(m) > displayWeight(best));
    if (nextPlate) {
      const diff = displayWeight(nextPlate) - displayWeight(best);
      html += `<div class="ld-section ld-milestone" style="--i:${sectionIdx++}">Next milestone: <strong>${formatWeight(nextPlate)} ${store.unit}</strong> (${diff.toFixed(1)} ${store.unit} away)</div>`;
    }
  }

  // --- 3. Sparkline trend chart (Feature 2 + 3) ---
  if (liftEntries.length >= 2) {
    const sessionMap = new Map();
    for (const e of liftEntries) {
      if (!sessionMap.has(e.date) || e.e1rm > sessionMap.get(e.date).e1rm) {
        sessionMap.set(e.date, { ...e, hadPR: e.isPR || (sessionMap.get(e.date)?.hadPR) });
      }
    }
    // Track PR status per date across all entries
    const prDates = new Set();
    for (const e of liftEntries) {
      if (e.isPR) prDates.add(e.date);
    }
    const sessionList = [...sessionMap.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-10);

    if (sessionList.length >= 2) {
      const e1rms = sessionList.map(s => s.e1rm);
      const min = Math.min(...e1rms);
      const max = Math.max(...e1rms);
      const range = max - min || 1;
      const svgW = 280;
      const svgH = 80;
      const padX = 8;
      const padY = 8;
      const plotW = svgW - padX * 2;
      const plotH = svgH - padY * 2;
      const color = COLORS[lift];

      const points = sessionList.map((s, i) => ({
        x: padX + (i / (sessionList.length - 1)) * plotW,
        y: padY + plotH - ((s.e1rm - min) / range) * plotH,
        isPR: prDates.has(s.date),
        date: s.date,
      }));

      const lineStr = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const areaStr = `${points[0].x.toFixed(1)},${svgH - padY} ${lineStr} ${points[points.length - 1].x.toFixed(1)},${svgH - padY}`;

      html += `<div class="ld-section" style="--i:${sectionIdx++}">`;
      html += `<div class="ld-section-title">Trend</div>`;
      html += `<div class="ld-sparkline-wrap">`;
      html += `<svg class="ld-sparkline" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none">`;
      html += `<defs><linearGradient id="ld-grad-${lift}" x1="0" y1="0" x2="0" y2="1">`;
      html += `<stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>`;
      html += `<stop offset="100%" stop-color="${color}" stop-opacity="0.03"/>`;
      html += `</linearGradient></defs>`;
      html += `<polygon points="${areaStr}" fill="url(#ld-grad-${lift})"/>`;
      html += `<polyline points="${lineStr}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      // Feature 3: PR markers
      points.forEach(p => {
        if (p.isPR) {
          html += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--gold, #ffd700)" stroke="var(--surface)" stroke-width="1.5"/>`;
        }
      });
      html += `</svg>`;
      // Date labels
      html += `<div class="ld-sparkline-labels">`;
      html += `<span>${sessionList[0].date.slice(5)}</span>`;
      html += `<span>${sessionList[sessionList.length - 1].date.slice(5)}</span>`;
      html += `</div>`;
      html += `</div></div>`;
    }
  }

  // --- 4. Rep PR horizontal bars ---
  const prReps = REP_RANGES.filter(r => repPRs[r]);
  if (prReps.length > 0) {
    const maxPR = Math.max(...prReps.map(r => repPRs[r].weight));
    html += `<div class="ld-section" style="--i:${sectionIdx++}">`;
    html += `<div class="ld-section-title">Rep PRs</div>`;
    html += `<div class="ld-pr-list">`;
    prReps.forEach(r => {
      const pr = repPRs[r];
      const pct = (pr.weight / maxPR) * 100;
      html += `<div class="ld-pr-row">
        <div class="ld-pr-label">${r}RM</div>
        <div class="ld-pr-track"><div class="ld-pr-bar ${lift}" style="width:${pct}%"></div></div>
        <div class="ld-pr-value">
          <div>${formatWeight(pr.weight)} ${store.unit}</div>
          <div class="ld-pr-date">${pr.date}</div>
        </div>
      </div>`;
    });
    html += `</div></div>`;
  }

  // --- Recent sessions (Feature 4: expandable + Feature 7: RPE dots) ---
  if (liftEntries.length > 0) {
    const sessions = [];
    const seen = new Set();
    for (const e of liftEntries) {
      if (!seen.has(e.date)) {
        seen.add(e.date);
        const dayEntries = liftEntries.filter(x => x.date === e.date);
        const topSet = dayEntries.reduce((best, x) => x.e1rm > best.e1rm ? x : best, dayEntries[0]);
        const tonnage = dayEntries.reduce((sum, x) => sum + x.weight * x.reps, 0);
        // Average RPE for the session (only sets that have RPE)
        const rpeSets = dayEntries.filter(x => x.rpe != null);
        const avgRpe = rpeSets.length > 0 ? rpeSets.reduce((s, x) => s + x.rpe, 0) / rpeSets.length : null;
        sessions.push({ date: e.date, topSet, tonnage, sets: dayEntries.length, dayEntries, avgRpe });
      }
      if (sessions.length >= 6) break;
    }

    html += `<div class="ld-section" style="--i:${sectionIdx++}">`;
    html += `<div class="ld-section-title">Recent Sessions</div>`;
    html += `<div class="ld-sessions">`;
    sessions.forEach((s, idx) => {
      html += `<div class="ld-session ld-session-expandable" data-session-idx="${idx}">`;
      html += `<div class="ld-session-header">`;
      // Feature 7: RPE dot
      if (s.avgRpe != null) {
        html += `<span class="ld-rpe-dot rpe-${rpeClass(s.avgRpe)}" title="Avg RPE ${s.avgRpe.toFixed(1)}"></span>`;
      }
      html += `<div class="ld-session-header-text">`;
      html += `<div class="ld-session-date">${s.date}</div>`;
      html += `<div class="ld-session-detail">${formatWeight(s.topSet.weight)} ${store.unit} &times; ${s.topSet.reps} <span class="ld-session-e1rm">= ${formatWeight(s.topSet.e1rm)} e1RM</span></div>`;
      html += `<div class="ld-session-meta">${s.sets} set${s.sets > 1 ? 's' : ''} &bull; ${formatWeight(s.tonnage)} ${store.unit} tonnage</div>`;
      html += `</div>`;
      html += `<span class="ld-expand-icon">&#9662;</span>`;
      html += `</div>`;

      // Feature 4: Expandable detail
      html += `<div class="ld-session-expand">`;
      s.dayEntries.sort((a, b) => a.timestamp - b.timestamp).forEach(entry => {
        html += `<div class="ld-set-row">`;
        if (entry.rpe != null) {
          html += `<span class="ld-rpe-dot rpe-${rpeClass(entry.rpe)}" title="RPE ${entry.rpe}"></span>`;
        }
        html += `<span class="ld-set-detail">${formatWeight(entry.weight)} ${store.unit} &times; ${entry.reps}`;
        if (entry.rpe != null) html += ` @ RPE ${entry.rpe}`;
        html += `</span>`;
        if (entry.isPR) html += `<span class="ld-set-pr">PR</span>`;
        html += `</div>`;
        if (entry.notes) {
          html += `<div class="ld-set-notes">${entry.notes}</div>`;
        }
      });
      html += `</div></div>`;
    });
    html += `</div></div>`;
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
