/**
 * Accessory exercise detail bottom sheet.
 *
 * Shows per-exercise progress: weight trend sparkline, stats grid,
 * progression status, and recent session history.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { openSheet, closeSheet, enableSheetSwipeDismiss } from '../ui/sheet.js';
import { getAccessoryDetail } from '../systems/accessory-progress.js';
import { getAccessoryWeight } from '../systems/workout-builder.js';
import { formatWeight, displayWeight } from '../formulas/units.js';
import { ACCESSORY_DB } from '../data/accessories.js';

const COLORS = { squat: '#e53935', bench: '#1e88e5', deadlift: '#43a047' };
const TREND_ARROWS = { up: '\u2191', down: '\u2193', flat: '\u2192' };

function closeAccessoryDetail() {
  closeSheet('acc-detail-sheet', 'acc-detail-backdrop');
}

export function showAccessoryDetail(exerciseId) {
  const detail = getAccessoryDetail(exerciseId);
  if (!detail) return;

  const color = COLORS[detail.mainLift] || '#888';
  const isBodyweight = detail.bestWeight === 0;
  const db = ACCESSORY_DB[exerciseId];
  let html = '';
  let sectionIdx = 0;

  // --- Hero banner ---
  html += `<div class="sheet-section ld-banner ${detail.mainLift}" style="--i:${sectionIdx++}">`;
  html += `<div class="ld-banner-e1rm">${isBodyweight ? 'Bodyweight' : formatWeight(detail.lastWeight) + ' <span class="ld-banner-unit">' + store.unit + '</span>'}</div>`;
  html += `<div class="ld-banner-label">${detail.name}</div>`;
  html += `<div class="ld-banner-meta">`;
  html += `<span class="ld-banner-bw">${detail.equipment}</span>`;
  if (detail.repRange) html += `<span class="ld-banner-bw">${detail.repRange[0]}-${detail.repRange[1]}${detail.timeBased ? 's' : ' reps'}</span>`;
  if (detail.readyToProgress) html += `<span class="acc-progression-badge" style="font-size:var(--text-xs)">READY TO PROGRESS</span>`;
  html += `</div>`;
  if (!isBodyweight && detail.sessionCount >= 2) {
    const arrow = TREND_ARROWS[detail.trend];
    html += `<div class="ld-banner-trend ${detail.trend}">${arrow} ${detail.progressionCount} weight increase${detail.progressionCount !== 1 ? 's' : ''}</div>`;
  }
  html += `</div>`;

  // --- Stats grid ---
  html += `<div class="sheet-section ld-progress" style="--i:${sectionIdx++}">`;
  html += `<div class="sheet-section-title">Overview</div>`;
  html += `<div class="ld-progress-grid">`;
  if (!isBodyweight) {
    html += `<div class="ld-progress-item"><div class="ld-progress-label">Best Weight</div><div class="ld-progress-value">${formatWeight(detail.bestWeight)} ${store.unit}</div></div>`;
  }
  html += `<div class="ld-progress-item"><div class="ld-progress-label">Sessions</div><div class="ld-progress-value">${detail.sessionCount}</div></div>`;
  html += `<div class="ld-progress-item"><div class="ld-progress-label">Total Sets</div><div class="ld-progress-value">${detail.totalSets}</div></div>`;
  html += `<div class="ld-progress-item"><div class="ld-progress-label">Avg Reps/Set</div><div class="ld-progress-value">${detail.avgRepsPerSet.toFixed(1)}</div></div>`;
  html += `</div></div>`;

  // --- Progression status ---
  if (!isBodyweight && db) {
    html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
    if (detail.readyToProgress) {
      const nextWeight = getAccessoryWeight(exerciseId, detail.mainLift);
      html += `<div class="acc-progression-card ready">`;
      html += `<strong>Ready to progress!</strong> Next session: ${formatWeight(nextWeight)} ${store.unit}`;
      html += `</div>`;
    } else {
      html += `<div class="acc-progression-card">`;
      html += `Hit ${db.repRange[1]} reps on all ${db.sets} sets to increase weight`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  // --- Weight trend sparkline ---
  if (!isBodyweight && detail.weightHistory.length >= 2) {
    const wh = detail.weightHistory;
    const weights = wh.map(w => w.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const range = max - min || 1;
    const svgW = 280, svgH = 80, padX = 8, padY = 8;
    const plotW = svgW - padX * 2, plotH = svgH - padY * 2;

    const points = wh.map((w, i) => ({
      x: padX + (i / (wh.length - 1)) * plotW,
      y: padY + plotH - ((w.weight - min) / range) * plotH,
      increased: i > 0 && w.weight > wh[i - 1].weight,
    }));

    const lineStr = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaStr = `${points[0].x.toFixed(1)},${svgH - padY} ${lineStr} ${points[points.length - 1].x.toFixed(1)},${svgH - padY}`;

    html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
    html += `<div class="sheet-section-title">Weight Trend</div>`;
    html += `<div class="ld-sparkline-wrap">`;
    html += `<svg class="ld-sparkline" viewBox="0 0 ${svgW} ${svgH}" preserveAspectRatio="none">`;
    html += `<defs><linearGradient id="acc-grad" x1="0" y1="0" x2="0" y2="1">`;
    html += `<stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>`;
    html += `<stop offset="100%" stop-color="${color}" stop-opacity="0.03"/>`;
    html += `</linearGradient></defs>`;
    html += `<polygon points="${areaStr}" fill="url(#acc-grad)"/>`;
    html += `<polyline points="${lineStr}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    points.forEach(p => {
      if (p.increased) {
        html += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--green)" stroke="var(--surface)" stroke-width="1.5"/>`;
      }
    });
    html += `</svg>`;
    html += `<div class="ld-sparkline-labels">`;
    html += `<span>${wh[0].date.slice(5)}</span>`;
    html += `<span>${wh[wh.length - 1].date.slice(5)}</span>`;
    html += `</div></div></div>`;
  }

  // --- Recent sessions ---
  if (detail.sessions.length > 0) {
    html += `<div class="sheet-section" style="--i:${sectionIdx++}">`;
    html += `<div class="sheet-section-title">Recent Sessions</div>`;
    html += `<div class="ld-sessions">`;
    detail.sessions.slice(0, 8).forEach((s, idx) => {
      let w;
      if (isBodyweight) {
        w = 'BW';
      } else if (s.setWeights && s.setWeights.length > 1) {
        const unique = new Set(s.setWeights);
        w = unique.size === 1
          ? `${s.setWeights.length}&times;${formatWeight(s.setWeights[0])} ${store.unit}`
          : s.setWeights.map(v => formatWeight(v)).join('/') + ' ' + store.unit;
      } else {
        w = formatWeight(s.weight) + ' ' + store.unit;
      }
      const reps = s.setsCompleted.join('/');
      const completedAll = s.setsCompleted.length >= s.targetSets;
      html += `<div class="ld-session">`;
      html += `<div class="ld-session-header">`;
      if (s.allHitTop) html += `<span class="ld-rpe-dot rpe-low" title="All sets hit target"></span>`;
      html += `<div class="ld-session-header-text">`;
      html += `<div class="ld-session-date">${s.date}</div>`;
      html += `<div class="ld-session-detail">${w} &times; ${reps || 'incomplete'}${detail.timeBased ? 's' : ''}</div>`;
      html += `<div class="ld-session-meta">${s.setsCompleted.length}/${s.targetSets} sets${s.allHitTop ? ' &bull; <span style="color:var(--green)">hit target</span>' : ''}</div>`;
      html += `</div></div></div>`;
    });
    html += `</div></div>`;
  }

  $('acc-detail-title').textContent = detail.name;
  $('acc-detail-body').innerHTML = html;

  openSheet('acc-detail-sheet', 'acc-detail-backdrop');
}

export function initAccessoryDetailSheet() {
  $('acc-detail-close').addEventListener('click', closeAccessoryDetail);
  $('acc-detail-backdrop').addEventListener('click', closeAccessoryDetail);
  enableSheetSwipeDismiss('acc-detail-sheet', 'acc-detail-backdrop', closeAccessoryDetail);
}
