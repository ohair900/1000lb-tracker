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
import { openSheet, closeSheet, enableSheetSwipeDismiss } from '../ui/sheet.js';

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

  // Collect all entries for this lift
  const liftEntries = store.entries
    .filter(e => e.lift === lift)
    .sort((a, b) => b.timestamp - a.timestamp);

  let html = '';

  // --- 1. Lift-colored hero banner ---
  html += `<div class="ld-banner ${lift}">`;
  html += `<div class="ld-banner-e1rm">${best ? formatWeight(best) : '\u2014'} <span class="ld-banner-unit">${store.unit}</span></div>`;
  html += `<div class="ld-banner-label">Estimated 1RM</div>`;
  html += `<div class="ld-banner-meta">`;
  if (cls) html += `<span class="class-badge ${cls}">${cls}</span>`;
  if (best && bw) html += `<span class="ld-banner-bw">${(best / bw).toFixed(1)}x BW</span>`;
  if (plateaued) html += `<span class="ld-plateau">Plateaued</span>`;
  html += `</div>`;
  if (prog) {
    const arrow = DIRECTION_ARROWS[prog.direction];
    html += `<div class="ld-banner-trend ${prog.direction}">${arrow} ${Math.abs(prog.monthRate).toFixed(1)} ${store.unit}/mo</div>`;
  }
  html += `</div>`;

  // --- 2. Gold best-lift box ---
  if (liftEntries.length > 0) {
    const bestEntry = liftEntries.reduce((b, e) => e.e1rm > b.e1rm ? e : b, liftEntries[0]);
    html += `<div class="ld-best-lift">`;
    html += `<div class="ld-best-label">All-Time Best</div>`;
    html += `<div class="ld-best-value">${formatWeight(bestEntry.weight)} ${store.unit} &times; ${bestEntry.reps}</div>`;
    html += `<div class="ld-best-detail">= ${formatWeight(bestEntry.e1rm)} e1RM &bull; ${bestEntry.date}</div>`;
    html += `</div>`;
  }

  // --- Goal bar ---
  if (goal && best) {
    const pct = Math.min(100, best / goal * 100);
    html += `<div class="ld-goal-section">`;
    html += `<div class="ld-goal-label">${pct.toFixed(0)}% of ${formatWeight(goal)} ${store.unit} goal</div>`;
    html += `<div class="ld-goal-bar"><div class="ld-goal-fill" style="width:${pct}%"></div></div>`;
    html += `</div>`;
  }

  // --- Next milestone ---
  if (best) {
    const nextPlate = PLATE_MILESTONES.find(m => displayWeight(m) > displayWeight(best));
    if (nextPlate) {
      const diff = displayWeight(nextPlate) - displayWeight(best);
      html += `<div class="ld-milestone">Next milestone: <strong>${formatWeight(nextPlate)} ${store.unit}</strong> (${diff.toFixed(1)} ${store.unit} away)</div>`;
    }
  }

  // --- 3. Mini trend chart ---
  if (liftEntries.length >= 2) {
    // Group by date, get top e1RM per session, take last 10
    const sessionMap = new Map();
    for (const e of liftEntries) {
      if (!sessionMap.has(e.date) || e.e1rm > sessionMap.get(e.date).e1rm) {
        sessionMap.set(e.date, e);
      }
    }
    const sessionList = [...sessionMap.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-10);

    if (sessionList.length >= 2) {
      const e1rms = sessionList.map(s => s.e1rm);
      const min = Math.min(...e1rms);
      const max = Math.max(...e1rms);
      const range = max - min || 1;

      html += `<div class="ld-section-title">Trend</div>`;
      html += `<div class="ld-trend-chart">`;
      sessionList.forEach((s, i) => {
        const pct = ((s.e1rm - min) / range) * 70 + 30; // 30-100% height range
        const isLatest = i === sessionList.length - 1;
        const showLabel = i === 0 || isLatest;
        html += `<div class="ld-trend-col">
          <div class="ld-trend-bar${isLatest ? ' latest ' + lift : ''}" style="height:${pct}%"></div>
          ${showLabel ? `<div class="ld-trend-label">${s.date.slice(5)}</div>` : '<div class="ld-trend-label"></div>'}
        </div>`;
      });
      html += `</div>`;
    }
  }

  // --- 4. Rep PR horizontal bars ---
  const prReps = REP_RANGES.filter(r => repPRs[r]);
  if (prReps.length > 0) {
    const maxPR = Math.max(...prReps.map(r => repPRs[r].weight));
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
    html += `</div>`;
  }

  // --- Recent sessions ---
  if (liftEntries.length > 0) {
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

  enableSheetSwipeDismiss('lift-detail-sheet', 'lift-detail-backdrop', closeLiftDetail);

  // Dashboard card click handlers
  document.querySelectorAll('.card[data-lift]').forEach(card => {
    if (card.dataset.lift === 'total') return;
    card.addEventListener('click', () => showLiftDetail(card.dataset.lift));
  });
}
