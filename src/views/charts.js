/**
 * Charts tab view — e1RM, volume, bodyweight, Wilks/DOTS charts,
 * activity heatmap, training calendar, and chart tooltip handling.
 */

import store from '../state/store.js';
import { $, fmtNum } from '../utils/helpers.js';
import { canvas, ctx, tooltip } from '../ui/dom.js';
import { LIFTS, COLORS, LIFT_SHORT, LIFT_NAMES } from '../constants/lift-config.js';
import { MS_PER_DAY } from '../constants/time.js';
import { displayWeight, formatWeight, lbsToKg } from '../formulas/units.js';
import { calcWilks, calcDOTS } from '../formulas/scoring.js';
import { openModal } from '../ui/modal.js';

// ---------------------------------------------------------------------------
// Chart date range helper
// ---------------------------------------------------------------------------

function getChartDateCutoff() {
  if (store.chartDateRange === 'all') return null;
  const days = parseInt(store.chartDateRange);
  const cutoff = new Date(Date.now() - days * MS_PER_DAY);
  return cutoff.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

function drawEmpty(w, h, msg) {
  ctx.fillStyle = '#888'; ctx.font = '14px -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(msg, w / 2, h / 2);
}

function drawAxes(w, h, pad, allDates, minVal, maxVal) {
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const valRange = maxVal - minVal || 1;

  // Grid
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (i / 5) * ch;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
    const val = maxVal - (i / 5) * valRange;
    ctx.fillStyle = '#666'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtNum(val), pad.left - 8, y + 3);
  }
  // X labels
  ctx.fillStyle = '#666'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'center';
  const maxLabels = Math.floor(cw / 60);
  const step = Math.max(1, Math.ceil(allDates.length / maxLabels));
  allDates.forEach((date, i) => {
    if (i % step === 0 || i === allDates.length - 1) {
      const d = new Date(date + 'T12:00:00');
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const x = pad.left + (allDates.length === 1 ? cw / 2 : (i / (allDates.length - 1)) * cw);
      ctx.fillText(label, x, h - pad.bottom + 20);
    }
  });
}

function chartSetup(w, h, leftPad) {
  const pad = { top: 20, right: 16, bottom: 40, left: leftPad || 50 };
  return { pad, cw: w - pad.left - pad.right, ch: h - pad.top - pad.bottom, dateCutoff: getChartDateCutoff() };
}

// ---------------------------------------------------------------------------
// e1RM Chart
// ---------------------------------------------------------------------------

function renderE1RMChart(w, h) {
  if (store.entries.length === 0) { drawEmpty(w, h, 'No data yet'); return; }
  const { pad, cw, ch, dateCutoff } = chartSetup(w, h);

  const liftsToShow = store.chartFilter === 'all' ? LIFTS
    : store.chartFilter === 'total' ? [] : [store.chartFilter];
  const showTotal = store.chartFilter === 'all' || store.chartFilter === 'total';

  function buildSeries(lift) {
    const byDate = {};
    store.entries.filter(e => e.lift === lift && (!dateCutoff || e.date >= dateCutoff)).forEach(e => {
      if (!byDate[e.date] || e.e1rm > byDate[e.date].e1rm) byDate[e.date] = e;
    });
    return Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, e]) => ({ date, value: e.e1rm, isPR: e.isPR }));
  }

  const series = {};
  liftsToShow.forEach(l => series[l] = buildSeries(l));
  if (showTotal) {
    const allDates = new Set(); store.entries.filter(e => !dateCutoff || e.date >= dateCutoff).forEach(e => allDates.add(e.date));
    const sortedD = [...allDates].sort();
    const running = { squat: 0, bench: 0, deadlift: 0 };
    series.total = [];
    sortedD.forEach(date => {
      LIFTS.forEach(l => {
        const b = store.entries.filter(e => e.lift === l && e.date <= date).reduce((m, e) => Math.max(m, e.e1rm), 0);
        if (b > 0) running[l] = b;
      });
      if (running.squat > 0 && running.bench > 0 && running.deadlift > 0)
        series.total.push({ date, value: running.squat + running.bench + running.deadlift, isPR: false });
    });
  }

  const allDates = [...new Set(Object.values(series).flat().map(p => p.date))].sort();
  if (allDates.length === 0) { drawEmpty(w, h, 'No data for this filter'); return; }
  const allVals = Object.values(series).flat().map(p => displayWeight(p.value));
  if (allVals.length === 0) { drawEmpty(w, h, 'No data for this filter'); return; }
  const minVal = Math.floor(Math.min(...allVals) * 0.9);
  const maxVal = Math.ceil(Math.max(...allVals) * 1.05);
  const valRange = maxVal - minVal || 1;

  const xPos = date => pad.left + (allDates.length === 1 ? cw / 2 : (allDates.indexOf(date) / (allDates.length - 1)) * cw);
  const yPos = val => pad.top + ch - ((displayWeight(val) - minVal) / valRange) * ch;

  drawAxes(w, h, pad, allDates, minVal, maxVal);

  const drawOrder = [...liftsToShow]; if (showTotal) drawOrder.push('total');
  drawOrder.forEach(key => {
    const pts = series[key]; if (!pts || pts.length === 0) return;
    const color = COLORS[key];
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xPos(p.date), y = yPos(p.value);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      store.chartPoints.push({ x, y, date: p.date, value: p.value, lift: key, color, isPR: p.isPR });
    });
    ctx.stroke();
    // Dots
    pts.forEach(p => {
      const x = xPos(p.date), y = yPos(p.value);
      ctx.beginPath();
      if (p.isPR) {
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
      } else {
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
      }
      ctx.fill();
    });
  });
}

// ---------------------------------------------------------------------------
// Volume Chart
// ---------------------------------------------------------------------------

function renderVolumeChart(w, h) {
  if (store.entries.length === 0) { drawEmpty(w, h, 'No data yet'); return; }
  const { pad, cw, ch, dateCutoff } = chartSetup(w, h, 55);
  const lifts = store.chartFilter === 'all' ? LIFTS : [store.chartFilter];

  const byDate = {};
  store.entries.forEach(e => {
    if (store.chartFilter !== 'all' && e.lift !== store.chartFilter) return;
    if (dateCutoff && e.date < dateCutoff) return;
    if (!byDate[e.date]) byDate[e.date] = { squat: 0, bench: 0, deadlift: 0 };
    byDate[e.date][e.lift] += e.weight * e.reps;
  });

  const dates = Object.keys(byDate).sort();
  if (dates.length === 0) { drawEmpty(w, h, 'No data for this filter'); return; }
  const totals = dates.map(d => lifts.reduce((s, l) => s + (byDate[d][l] || 0), 0));
  const maxVol = Math.max(...totals.map(v => displayWeight(v)));
  const minVal = 0, maxVal = Math.ceil(maxVol * 1.1);

  drawAxes(w, h, pad, dates, minVal, maxVal);

  const barW = Math.max(4, Math.min(30, (cw / dates.length) * 0.7));
  dates.forEach((date, i) => {
    const x = pad.left + (dates.length === 1 ? cw / 2 : (i / (dates.length - 1)) * cw) - barW / 2;
    let yBottom = pad.top + ch;
    lifts.forEach(lift => {
      const vol = byDate[date][lift] || 0;
      if (vol <= 0) return;
      const dispVol = displayWeight(vol);
      const barH = (dispVol / (maxVal - minVal)) * ch;
      ctx.fillStyle = COLORS[lift];
      ctx.fillRect(x, yBottom - barH, barW, barH);
      store.chartPoints.push({ x: x + barW / 2, y: yBottom - barH / 2, date, value: vol, lift, color: COLORS[lift] });
      yBottom -= barH;
    });
  });
}

// ---------------------------------------------------------------------------
// Bodyweight Chart
// ---------------------------------------------------------------------------

function renderBWChart(w, h) {
  const bwh = store.profile.bodyweightHistory || [];
  if (bwh.length === 0) { drawEmpty(w, h, 'No bodyweight data yet'); return; }
  const { pad, cw, ch, dateCutoff } = chartSetup(w, h);

  let sorted = [...bwh].sort((a, b) => a.timestamp - b.timestamp);
  if (dateCutoff) sorted = sorted.filter(b => b.date >= dateCutoff);
  if (sorted.length === 0) { drawEmpty(w, h, 'No data in range'); return; }
  const dates = sorted.map(b => b.date);
  const vals = sorted.map(b => displayWeight(b.weight));
  const minVal = Math.floor(Math.min(...vals) * 0.95);
  const maxVal = Math.ceil(Math.max(...vals) * 1.05);
  const valRange = maxVal - minVal || 1;

  drawAxes(w, h, pad, dates, minVal, maxVal);

  const xPos = i => pad.left + (dates.length === 1 ? cw / 2 : (i / (dates.length - 1)) * cw);
  const yPos = v => pad.top + ch - ((v - minVal) / valRange) * ch;

  // Raw line
  ctx.strokeStyle = '#aaa'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  sorted.forEach((b, i) => {
    const x = xPos(i), y = yPos(displayWeight(b.weight));
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    store.chartPoints.push({ x, y, date: b.date, value: b.weight, lift: 'BW', color: '#aaa' });
  });
  ctx.stroke();
  sorted.forEach((b, i) => {
    ctx.beginPath(); ctx.arc(xPos(i), yPos(displayWeight(b.weight)), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#aaa'; ctx.fill();
  });

  // 7-day rolling average
  if (sorted.length >= 3) {
    ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    sorted.forEach((b, i) => {
      const windowStart = new Date(new Date(b.date + 'T12:00:00').getTime() - 7 * MS_PER_DAY).toISOString().split('T')[0];
      const windowPts = sorted.filter(p => p.date >= windowStart && p.date <= b.date);
      const avg = windowPts.reduce((s, p) => s + displayWeight(p.weight), 0) / windowPts.length;
      const x = xPos(i), y = yPos(avg);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // Legend
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillStyle = '#aaa'; ctx.textAlign = 'left'; ctx.fillText('Raw', pad.left + 5, pad.top + 12);
    ctx.fillStyle = '#ffd700'; ctx.fillText('7d Avg', pad.left + 40, pad.top + 12);
  }
}

// ---------------------------------------------------------------------------
// Wilks/DOTS Chart
// ---------------------------------------------------------------------------

function renderWilksChart(w, h) {
  if (!store.profile.gender || !store.profile.bodyweight || store.entries.length === 0) {
    drawEmpty(w, h, 'Need profile + lift data'); return;
  }
  const pad = { top: 20, right: 16, bottom: 40, left: 50 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
  const dateCutoff = getChartDateCutoff();

  let allDates = [...new Set(store.entries.map(e => e.date))].sort();
  if (dateCutoff) allDates = allDates.filter(d => d >= dateCutoff);
  const running = { squat: 0, bench: 0, deadlift: 0 };
  const bwHist = [...(store.profile.bodyweightHistory || [])].sort((a, b) => a.timestamp - b.timestamp);
  const dataPoints = [];

  allDates.forEach(date => {
    LIFTS.forEach(l => {
      const b = store.entries.filter(e => e.lift === l && e.date <= date).reduce((m, e) => Math.max(m, e.e1rm), 0);
      if (b > 0) running[l] = b;
    });
    if (running.squat > 0 && running.bench > 0 && running.deadlift > 0) {
      const total = running.squat + running.bench + running.deadlift;
      // Interpolate bodyweight
      let bw = store.profile.bodyweight;
      if (bwHist.length > 0) {
        const before = bwHist.filter(b => b.date <= date);
        const after = bwHist.filter(b => b.date > date);
        if (before.length > 0 && after.length > 0) {
          const b1 = before[before.length - 1], b2 = after[0];
          const t1 = new Date(b1.date).getTime(), t2 = new Date(b2.date).getTime();
          const t = new Date(date).getTime();
          const ratio = t2 === t1 ? 0 : (t - t1) / (t2 - t1);
          bw = b1.weight + (b2.weight - b1.weight) * ratio;
        } else if (before.length > 0) { bw = before[before.length - 1].weight; }
        else { bw = after[0].weight; }
      }
      const tKg = lbsToKg(total), bKg = lbsToKg(bw);
      const wilks = calcWilks(tKg, bKg, store.profile.gender);
      const dots = calcDOTS(tKg, bKg, store.profile.gender);
      if (wilks && dots) dataPoints.push({ date, wilks, dots });
    }
  });

  if (dataPoints.length === 0) { drawEmpty(w, h, 'Not enough data'); return; }
  const dates = dataPoints.map(p => p.date);
  const allVals = [...dataPoints.map(p => p.wilks), ...dataPoints.map(p => p.dots)];
  const minVal = Math.floor(Math.min(...allVals) * 0.9);
  const maxVal = Math.ceil(Math.max(...allVals) * 1.05);
  const valRange = maxVal - minVal || 1;

  drawAxes(w, h, pad, dates, minVal, maxVal);

  const xPos = i => pad.left + (dates.length === 1 ? cw / 2 : (i / (dates.length - 1)) * cw);
  const yPos = v => pad.top + ch - ((v - minVal) / valRange) * ch;

  // Wilks line
  ctx.strokeStyle = '#ff9800'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
  dataPoints.forEach((p, i) => { const x = xPos(i), y = yPos(p.wilks); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    store.chartPoints.push({ x, y, date: p.date, value: p.wilks, lift: 'Wilks', color: '#ff9800' }); });
  ctx.stroke();
  dataPoints.forEach((p, i) => { ctx.beginPath(); ctx.arc(xPos(i), yPos(p.wilks), 3, 0, Math.PI * 2); ctx.fillStyle = '#ff9800'; ctx.fill(); });

  // DOTS line
  ctx.strokeStyle = '#ab47bc'; ctx.lineWidth = 2; ctx.beginPath();
  dataPoints.forEach((p, i) => { const x = xPos(i), y = yPos(p.dots); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    store.chartPoints.push({ x, y, date: p.date, value: p.dots, lift: 'DOTS', color: '#ab47bc' }); });
  ctx.stroke();
  dataPoints.forEach((p, i) => { ctx.beginPath(); ctx.arc(xPos(i), yPos(p.dots), 3, 0, Math.PI * 2); ctx.fillStyle = '#ab47bc'; ctx.fill(); });

  // Legend
  ctx.font = '11px -apple-system, sans-serif';
  ctx.fillStyle = '#ff9800'; ctx.fillText('Wilks', pad.left + 5, pad.top + 12);
  ctx.fillStyle = '#ab47bc'; ctx.fillText('DOTS', pad.left + 55, pad.top + 12);
}

// ---------------------------------------------------------------------------
// Heatmap Chart
// ---------------------------------------------------------------------------

function renderHeatmap(w, h) {
  if (store.entries.length === 0) { drawEmpty(w, h, 'No data yet'); return; }
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weeksToShow = Math.min(26, Math.floor(w / 14));
  const daysBack = weeksToShow * 7;
  const startDate = new Date(today.getTime() - daysBack * MS_PER_DAY);
  // Adjust to start on Monday
  const startDay = startDate.getDay();
  const adjustedStart = new Date(startDate.getTime() - ((startDay + 6) % 7) * MS_PER_DAY);

  // Build volume by date
  const volByDate = {};
  store.entries.forEach(e => { volByDate[e.date] = (volByDate[e.date] || 0) + e.weight * e.reps; });
  const allVols = Object.values(volByDate).filter(v => v > 0);
  const maxVol = allVols.length > 0 ? Math.max(...allVols) : 1;

  const cellSize = Math.min(12, Math.floor((w - 40) / (weeksToShow + 1)));
  const gap = 2;
  const padLeft = 28;
  const padTop = 20;
  const dayLabels = ['M', '', 'W', '', 'F', '', 'S'];

  // Day of week labels
  ctx.font = '9px -apple-system, sans-serif'; ctx.fillStyle = '#666'; ctx.textAlign = 'right';
  for (let d = 0; d < 7; d++) {
    if (dayLabels[d]) ctx.fillText(dayLabels[d], padLeft - 4, padTop + d * (cellSize + gap) + cellSize - 1);
  }

  // Month labels
  ctx.textAlign = 'center';
  let lastMonth = -1;
  for (let wk = 0; wk <= weeksToShow; wk++) {
    const weekStart = new Date(adjustedStart.getTime() + wk * 7 * MS_PER_DAY);
    const month = weekStart.getMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      const x = padLeft + wk * (cellSize + gap) + cellSize / 2;
      ctx.fillText(weekStart.toLocaleDateString('en-US', { month: 'short' }), x, padTop - 6);
    }
  }

  // Draw cells
  for (let wk = 0; wk <= weeksToShow; wk++) {
    for (let day = 0; day < 7; day++) {
      const cellDate = new Date(adjustedStart.getTime() + (wk * 7 + day) * MS_PER_DAY);
      if (cellDate > today) continue;
      const dateStr = cellDate.toISOString().split('T')[0];
      const vol = volByDate[dateStr] || 0;
      const x = padLeft + wk * (cellSize + gap);
      const y = padTop + day * (cellSize + gap);

      if (vol === 0) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface2').trim() || '#2a2a2a';
      } else {
        const intensity = Math.min(1, vol / maxVol);
        const r = Math.round(67 + (229 - 67) * intensity);
        const g = Math.round(160 + (57 - 160) * intensity * 0.3);
        const b = Math.round(71 * (1 - intensity * 0.5));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      }
      ctx.beginPath();
      ctx.roundRect(x, y, cellSize, cellSize, 2);
      ctx.fill();

      if (vol > 0) {
        store.chartPoints.push({ x: x + cellSize / 2, y: y + cellSize / 2, date: dateStr, value: vol, lift: 'Volume', color: ctx.fillStyle });
      }
    }
  }

  // Legend
  const legendX = w - 100, legendY = h - 14;
  ctx.font = '9px -apple-system, sans-serif'; ctx.fillStyle = '#666'; ctx.textAlign = 'left';
  ctx.fillText('Less', legendX, legendY);
  for (let i = 0; i < 5; i++) {
    const intensity = i / 4;
    if (intensity === 0) { ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface2').trim() || '#2a2a2a'; }
    else {
      const r = Math.round(67 + (229 - 67) * intensity);
      const g = Math.round(160 + (57 - 160) * intensity * 0.3);
      const b = Math.round(71 * (1 - intensity * 0.5));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
    }
    ctx.fillRect(legendX + 30 + i * 11, legendY - 9, 9, 9);
  }
  ctx.fillStyle = '#666'; ctx.fillText('More', legendX + 88, legendY);
}

// ---------------------------------------------------------------------------
// Training Calendar
// ---------------------------------------------------------------------------

export function renderCalendar() {
  const el = document.getElementById('calendar-view');
  if (!el) return;
  const year = store.calendarMonth.getFullYear(), month = store.calendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = (firstDay.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = lastDay.getDate();
  const today = new Date().toISOString().split('T')[0];

  // Build data maps
  const dayData = {};
  store.entries.forEach(e => {
    const d = e.date;
    if (d.slice(0, 7) !== `${year}-${String(month + 1).padStart(2, '0')}`) return;
    if (!dayData[d]) dayData[d] = { lifts: new Set(), hasPR: false, entries: [] };
    dayData[d].lifts.add(e.lift);
    if (e.isPR) dayData[d].hasPR = true;
    dayData[d].entries.push(e);
  });

  const monthLabel = firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  let html = `<div class="calendar-nav">
    <button class="calendar-nav-btn" id="cal-prev">&larr;</button>
    <span class="calendar-month-label">${monthLabel}</span>
    <button class="calendar-nav-btn" id="cal-next">&rarr;</button>
  </div>`;
  html += `<div class="calendar-grid">`;
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach(d => html += `<div class="calendar-day-header">${d}</div>`);

  // Empty cells before first day
  for (let i = 0; i < startDow; i++) html += `<div class="calendar-cell"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const data = dayData[dateStr];
    const isToday = dateStr === today;
    const classes = ['calendar-cell'];
    if (data) classes.push('has-data');
    if (isToday) classes.push('today');

    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">`;
    html += `<span>${d}</span>`;
    if (data) {
      if (data.hasPR) html += `<span class="calendar-pr-star">\u2605</span>`;
      html += `<div class="calendar-dots">`;
      [...data.lifts].forEach(l => html += `<div class="calendar-dot" style="background:${COLORS[l]}"></div>`);
      html += `</div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  el.innerHTML = html;

  // Navigation
  el.querySelector('#cal-prev').addEventListener('click', () => {
    store.calendarMonth = new Date(year, month - 1, 1);
    renderCalendar();
  });
  el.querySelector('#cal-next').addEventListener('click', () => {
    store.calendarMonth = new Date(year, month + 1, 1);
    renderCalendar();
  });

  // Click day to show session in edit modal
  el.querySelectorAll('.calendar-cell.has-data').forEach(cell => {
    cell.addEventListener('click', () => {
      const date = cell.dataset.date;
      const dayEntries = store.entries.filter(e => e.date === date).sort((a, b) => b.timestamp - a.timestamp);
      if (dayEntries.length === 0) return;
      const body = $('edit-body');
      const d = new Date(date + 'T12:00:00');
      const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      let mhtml = `<div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:8px">${label} &middot; ${dayEntries.length} sets</div>`;
      dayEntries.forEach(e => {
        mhtml += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="color:${COLORS[e.lift]};font-weight:600;font-size:0.75rem;min-width:22px">${LIFT_SHORT[e.lift]}</span>
          <span style="font-size:0.85rem">${formatWeight(e.weight)} ${store.unit} &times; ${e.reps} = ${formatWeight(e.e1rm)} e1RM</span>
          ${e.isPR ? '<span class="pr-badge">PR</span>' : ''}
        </div>`;
      });
      $('edit-modal').querySelector('h3').textContent = 'Session Detail';
      body.innerHTML = mhtml;
      openModal('edit-modal');
    });
  });
}

// ---------------------------------------------------------------------------
// Chart tooltip
// ---------------------------------------------------------------------------

function handleChartHover(e) {
  if (store.chartPoints.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let closest = null, minDist = Infinity;
  store.chartPoints.forEach(p => { const d = Math.hypot(p.x - mx, p.y - my); if (d < minDist && d < 40) { minDist = d; closest = p; } });
  if (closest) {
    const d = new Date(closest.date + 'T12:00:00');
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const name = LIFT_NAMES[closest.lift] || closest.lift;
    const valDisplay = (store.chartType === 'volume')
      ? fmtNum(displayWeight(closest.value)) + ' ' + store.unit
      : (store.chartType === 'wilks' || closest.lift === 'Wilks' || closest.lift === 'DOTS')
        ? Math.round(closest.value).toString()
        : formatWeight(closest.value) + ' ' + store.unit;
    tooltip.innerHTML = `<span style="color:${closest.color}">${name}</span>: ${valDisplay}<br>${label}`;
    const containerRect = canvas.parentElement.getBoundingClientRect();
    let tx = closest.x + 12, ty = closest.y - 40;
    if (tx + 120 > containerRect.width - 12) tx = closest.x - 120;
    if (ty < 0) ty = closest.y + 12;
    tooltip.style.left = (tx + 12) + 'px'; tooltip.style.top = (ty + 12) + 'px';
    tooltip.style.opacity = '1';
  } else { tooltip.style.opacity = '0'; }
}

// ---------------------------------------------------------------------------
// Main renderChart()
// ---------------------------------------------------------------------------

/**
 * Render the current chart type to the canvas, or the calendar.
 */
export function renderChart() {
  // Calendar is HTML-based, not canvas
  const calEl = document.getElementById('calendar-view');
  if (store.chartType === 'calendar') {
    canvas.style.display = 'none';
    if (!calEl) {
      const div = document.createElement('div');
      div.id = 'calendar-view';
      canvas.parentElement.appendChild(div);
    }
    renderCalendar();
    return;
  } else {
    canvas.style.display = '';
    if (calEl) calEl.innerHTML = '';
  }

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width - 24;
  const h = Math.min(w * 0.65, 300);
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  store.chartPoints = [];
  ctx.clearRect(0, 0, w, h);

  if (store.chartType === 'e1rm') renderE1RMChart(w, h);
  else if (store.chartType === 'volume') renderVolumeChart(w, h);
  else if (store.chartType === 'bodyweight') renderBWChart(w, h);
  else if (store.chartType === 'wilks') renderWilksChart(w, h);
  else if (store.chartType === 'heatmap') renderHeatmap(w, h);
}

// ---------------------------------------------------------------------------
// initChartsTab — wire up all Charts tab event listeners
// ---------------------------------------------------------------------------

/**
 * Set up all event listeners for the Charts tab.
 * Call once after DOMContentLoaded.
 */
export function initChartsTab() {
  // Chart date range pills
  $('chart-date-range').addEventListener('click', e => {
    const pill = e.target.closest('.range-pill');
    if (!pill) return;
    $('chart-date-range').querySelectorAll('.range-pill').forEach(b => b.classList.remove('active'));
    pill.classList.add('active');
    store.chartDateRange = pill.dataset.range;
    renderChart();
  });

  // Chart type selector
  document.querySelectorAll('.chart-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      store.chartType = btn.dataset.type;
      // Show/hide lift filters
      $('chart-filters').style.display = (store.chartType === 'e1rm' || store.chartType === 'volume') ? 'flex' : 'none';
      if (store.chartType === 'heatmap' || store.chartType === 'calendar') $('chart-filters').style.display = 'none';
      // Show/hide date range for heatmap/calendar
      $('chart-date-range').style.display = (store.chartType === 'heatmap' || store.chartType === 'calendar') ? 'none' : 'flex';
      renderChart();
    });
  });

  // Chart filter buttons
  $('chart-filters').addEventListener('click', e => {
    const btn = e.target.closest('.chart-filter-btn');
    if (!btn) return;
    $('chart-filters').querySelectorAll('.chart-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    store.chartFilter = btn.dataset.filter;
    renderChart();
  });

  // Chart tooltip
  canvas.addEventListener('mousemove', handleChartHover);
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    handleChartHover({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
  }, { passive: false });
  canvas.addEventListener('mouseleave', () => tooltip.style.opacity = '0');
  canvas.addEventListener('touchend', () => tooltip.style.opacity = '0');
}
