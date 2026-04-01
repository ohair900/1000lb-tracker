/**
 * Lift detail bottom sheet — shows detailed stats when tapping
 * a lift card (squat/bench/deadlift) on the dashboard.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFT_NAMES, PLATE_MILESTONES, REP_RANGES } from '../constants/lift-config.js';
import { DIRECTION_ARROWS } from '../constants/ui.js';
import { MS_PER_DAY } from '../constants/time.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { formatWeight, displayWeight } from '../formulas/units.js';
import { calcProgression, detectPlateau } from '../formulas/progression.js';
import { getClassification } from '../formulas/standards.js';
import { getRepPRs } from '../systems/pr-tracking.js';
import { openSheet, closeSheet } from '../ui/sheet.js';

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

  let html = '';

  // --- Header ---
  html += `<div class="ld-header">`;
  html += `<span class="ld-lift-name">${LIFT_NAMES[lift]}</span>`;
  if (cls) html += `<span class="class-badge ${cls}">${cls}</span>`;
  if (plateaued) html += `<span class="ld-plateau">Plateaued</span>`;
  html += `</div>`;

  // --- Metrics grid ---
  html += `<div class="ld-metrics">`;
  html += `<div class="ld-metric"><div class="ld-metric-value">${best ? formatWeight(best) + ' ' + store.unit : '\u2014'}</div><div class="ld-metric-label">Best e1RM</div></div>`;
  html += `<div class="ld-metric"><div class="ld-metric-value">${best && bw ? (best / bw).toFixed(1) + 'x' : '\u2014'}</div><div class="ld-metric-label">BW Ratio</div></div>`;
  if (prog) {
    const arrow = DIRECTION_ARROWS[prog.direction];
    html += `<div class="ld-metric"><div class="ld-metric-value ${prog.direction}">${arrow} ${Math.abs(prog.monthRate).toFixed(1)}</div><div class="ld-metric-label">${store.unit}/mo</div></div>`;
  } else {
    html += `<div class="ld-metric"><div class="ld-metric-value">\u2014</div><div class="ld-metric-label">${store.unit}/mo</div></div>`;
  }
  if (goal && best) {
    const pct = Math.min(100, best / goal * 100).toFixed(0);
    html += `<div class="ld-metric"><div class="ld-metric-value">${pct}%</div><div class="ld-metric-label">of ${formatWeight(goal)} goal</div></div>`;
  } else {
    html += `<div class="ld-metric"><div class="ld-metric-value">\u2014</div><div class="ld-metric-label">Goal</div></div>`;
  }
  html += `</div>`;

  // --- Goal bar ---
  if (goal && best) {
    html += `<div class="ld-goal-bar"><div class="ld-goal-fill" style="width:${Math.min(100, best / goal * 100)}%"></div></div>`;
  }

  // --- Next milestone ---
  if (best) {
    const nextPlate = PLATE_MILESTONES.find(m => displayWeight(m) > displayWeight(best));
    if (nextPlate) {
      const diff = displayWeight(nextPlate) - displayWeight(best);
      html += `<div class="ld-milestone">Next milestone: <strong>${formatWeight(nextPlate)} ${store.unit}</strong> (${diff.toFixed(1)} ${store.unit} away)</div>`;
    }
  }

  // --- Progression pattern ---
  if (prog) {
    const labels = { up: 'Gaining', down: 'Declining', flat: 'Maintaining' };
    html += `<div class="ld-progression">Trend: <strong>${labels[prog.direction]}</strong> at ${Math.abs(prog.monthRate).toFixed(1)} ${store.unit}/mo over 90 days</div>`;
  }

  // --- Rep PRs ---
  const prReps = REP_RANGES.filter(r => repPRs[r]);
  if (prReps.length > 0) {
    html += `<div class="ld-section-title">Rep PRs</div>`;
    html += `<div class="ld-rep-prs">`;
    prReps.forEach(r => {
      const pr = repPRs[r];
      html += `<div class="ld-rep-pr">
        <div class="ld-rep-pr-reps">${r}RM</div>
        <div class="ld-rep-pr-weight">${formatWeight(pr.weight)} ${store.unit}</div>
        <div class="ld-rep-pr-date">${pr.date}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // --- Recent sessions ---
  const liftEntries = store.entries
    .filter(e => e.lift === lift)
    .sort((a, b) => b.timestamp - a.timestamp);

  if (liftEntries.length > 0) {
    // Group by date, take last 6 sessions
    const sessions = [];
    const seen = new Set();
    for (const e of liftEntries) {
      if (!seen.has(e.date)) {
        seen.add(e.date);
        const dayEntries = liftEntries.filter(x => x.date === e.date);
        const topSet = dayEntries.reduce((best, x) => x.e1rm > best.e1rm ? x : best, dayEntries[0]);
        const tonnage = dayEntries.reduce((sum, x) => sum + x.weight * x.reps, 0);
        sessions.push({ date: e.date, topSet, tonnage, sets: dayEntries.length });
      }
      if (sessions.length >= 6) break;
    }

    html += `<div class="ld-section-title">Recent Sessions</div>`;
    html += `<div class="ld-sessions">`;
    sessions.forEach(s => {
      html += `<div class="ld-session">
        <div class="ld-session-date">${s.date}</div>
        <div class="ld-session-detail">${formatWeight(s.topSet.weight)} ${store.unit} &times; ${s.topSet.reps} <span class="ld-session-e1rm">= ${formatWeight(s.topSet.e1rm)} e1RM</span></div>
        <div class="ld-session-meta">${s.sets} set${s.sets > 1 ? 's' : ''} &bull; ${formatWeight(s.tonnage)} ${store.unit} tonnage</div>
      </div>`;
    });
    html += `</div>`;
  }

  $('lift-detail-title').textContent = LIFT_NAMES[lift];
  $('lift-detail-body').innerHTML = html;
  openSheet('lift-detail-sheet', 'lift-detail-backdrop');
}

export function initLiftDetailSheet() {
  $('lift-detail-close').addEventListener('click', closeLiftDetail);
  $('lift-detail-backdrop').addEventListener('click', closeLiftDetail);

  // Swipe dismiss
  const sheet = $('lift-detail-sheet');
  const backdrop = $('lift-detail-backdrop');
  let startY = 0, currentY = 0, swiping = false;

  sheet.addEventListener('touchstart', (e) => {
    if (e.target.closest('.ld-sessions')) return;
    startY = e.touches[0].clientY;
    currentY = startY;
    swiping = true;
    sheet.style.transition = 'none';
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!swiping) return;
    currentY = e.touches[0].clientY;
    const dy = Math.max(0, currentY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(1 - dy / sheet.offsetHeight);
  }, { passive: true });

  sheet.addEventListener('touchend', () => {
    if (!swiping) return;
    const dy = currentY - startY;
    const velocity = dy / (sheet.offsetHeight || 1);
    if (dy > sheet.offsetHeight * 0.3 || velocity > 0.5) {
      sheet.style.transition = 'transform 0.2s ease';
      sheet.style.transform = 'translateY(100%)';
      backdrop.style.transition = 'opacity 0.2s ease';
      backdrop.style.opacity = '0';
      setTimeout(closeLiftDetail, 200);
    } else {
      sheet.style.transition = 'transform 0.25s ease';
      sheet.style.transform = 'translateY(0)';
      backdrop.style.transition = 'opacity 0.25s ease';
      backdrop.style.opacity = '1';
      setTimeout(() => {
        sheet.style.transform = '';
        sheet.style.transition = '';
        backdrop.style.opacity = '';
        backdrop.style.transition = '';
      }, 250);
    }
    swiping = false;
  }, { passive: true });

  // Dashboard card click handlers
  document.querySelectorAll('.card[data-lift]').forEach(card => {
    if (card.dataset.lift === 'total') return;
    card.addEventListener('click', () => showLiftDetail(card.dataset.lift));
  });
}
