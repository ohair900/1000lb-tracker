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
// Module-level state for animation & crosshair
// ---------------------------------------------------------------------------

let _prevChartKey = '';

// ---------------------------------------------------------------------------
// Sync chart UI state with store on every render
// ---------------------------------------------------------------------------

function syncChartUI() {
  document.querySelectorAll('.chart-type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === store.chartType)
  );
  $('chart-filters').querySelectorAll('.chart-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === store.chartFilter)
  );
  $('chart-date-range').querySelectorAll('.range-pill').forEach(b =>
    b.classList.toggle('active', b.dataset.range === store.chartDateRange)
  );
  const showFilters = store.chartType === 'e1rm' || store.chartType === 'volume';
  const showDateRange = store.chartType !== 'heatmap' && store.chartType !== 'calendar';
  $('chart-filters').style.display = showFilters ? 'flex' : 'none';
  $('chart-date-range').style.display = showDateRange ? 'flex' : 'none';
  const metricToggle = document.getElementById('heatmap-metric-toggle');
  if (metricToggle) {
    metricToggle.style.display = store.chartType === 'heatmap' ? 'flex' : 'none';
    metricToggle.querySelectorAll('.heatmap-metric-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.metric === (store.heatmapMetric || 'volume'))
    );
  }

  // "← Today" chip: shown when panned back on a chart type that supports panning
  const isPannable = store.chartType === 'volume' || store.chartType === 'heatmap';
  const todayChip = document.getElementById('chart-today-chip');
  if (todayChip) {
    todayChip.style.display = isPannable && (store.chartOffset || 0) > 0 ? '' : 'none';
  }

  // Edge-fade affordance on the container to hint "more exists off-screen"
  const chartContainer = canvas.parentElement;
  if (chartContainer) {
    chartContainer.classList.toggle('chart-pannable', isPannable);
  }
}

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
// Canvas helpers — bezier curves, gradients, drawing
// ---------------------------------------------------------------------------

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Trace a smooth bezier path through points (monotone cubic). Does NOT beginPath. */
function traceSmoothPath(pts) {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length <= 2) {
    if (pts.length === 2) ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
      p2.x, p2.y
    );
  }
}

/** Draw a gradient fill under a smooth curve. */
function drawGradientFill(pts, color, bottomY) {
  if (pts.length < 2) return;
  const minY = Math.min(...pts.map(p => p.y));
  const grad = ctx.createLinearGradient(0, minY, 0, bottomY);
  grad.addColorStop(0, hexToRgba(color, 0.15));
  grad.addColorStop(1, hexToRgba(color, 0));
  ctx.beginPath();
  traceSmoothPath(pts);
  ctx.lineTo(pts[pts.length - 1].x, bottomY);
  ctx.lineTo(pts[0].x, bottomY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

/** Draw a smooth bezier line. */
function drawSmoothLine(pts, color, width) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  traceSmoothPath(pts);
  ctx.stroke();
}

function drawEmpty(w, h, msg) {
  ctx.fillStyle = '#888'; ctx.font = '14px -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.fillText(msg, w / 2, h / 2);
  if (store.chartDateRange !== 'all' && store.entries.length > 0) {
    ctx.font = '12px -apple-system, sans-serif'; ctx.fillStyle = '#666';
    ctx.fillText('Try a wider date range', w / 2, h / 2 + 22);
  }
}

function drawAxes(w, h, pad, allDates, minVal, maxVal) {
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const valRange = maxVal - minVal || 1;

  // Zebra banding
  for (let i = 0; i < 5; i++) {
    if (i % 2 === 0) {
      const y1 = pad.top + (i / 5) * ch;
      const y2 = pad.top + ((i + 1) / 5) * ch;
      ctx.fillStyle = 'rgba(255,255,255,0.015)';
      ctx.fillRect(pad.left, y1, cw, y2 - y1);
    }
  }

  // Dashed grid lines
  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (i / 5) * ch;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
    ctx.fillStyle = '#666'; ctx.font = '10px -apple-system, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(fmtNum(maxVal - (i / 5) * valRange), pad.left - 8, y + 3);
  }
  ctx.setLineDash([]);

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
// e1RM Chart — gradient fills, bezier curves, PR glow
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
  const bottomY = pad.top + ch;

  // Phase 1: Gradient fills (behind lines)
  drawOrder.forEach(key => {
    const pts = series[key]; if (!pts || pts.length === 0) return;
    const screenPts = pts.map(p => ({ x: xPos(p.date), y: yPos(p.value) }));
    drawGradientFill(screenPts, COLORS[key], bottomY);
  });

  // Phase 2: Smooth lines
  drawOrder.forEach(key => {
    const pts = series[key]; if (!pts || pts.length === 0) return;
    const color = COLORS[key];
    const screenPts = pts.map(p => ({ x: xPos(p.date), y: yPos(p.value) }));
    drawSmoothLine(screenPts, color, 2.5);
    pts.forEach(p => {
      store.chartPoints.push({ x: xPos(p.date), y: yPos(p.value), date: p.date, value: p.value, lift: key, color, isPR: p.isPR });
    });
  });

  // Phase 3: Dots + PR glow
  drawOrder.forEach(key => {
    const pts = series[key]; if (!pts || pts.length === 0) return;
    const color = COLORS[key];
    pts.forEach(p => {
      const x = xPos(p.date), y = yPos(p.value);
      if (p.isPR) {
        // Glow
        const glow = ctx.createRadialGradient(x, y, 2, x, y, 12);
        glow.addColorStop(0, 'rgba(255,215,0,0.45)');
        glow.addColorStop(1, 'rgba(255,215,0,0)');
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
        // Gold dot
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700'; ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Volume Chart — rounded bars, depth effect
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Volume Histogram — time-bucketed, slidable timeline
// ---------------------------------------------------------------------------

// Map chartDateRange to a fixed window width in days.
// Range pill values are literal day counts ("30"/"90"/"180"/"365") or "all"
// (which still uses a 365-day window — pan to see further back).
function _windowDays(range) {
  if (range === 'all') return 365;
  const n = parseInt(range, 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

// Pick bucket granularity for a window size
function _bucketForWindow(windowDays) {
  if (windowDays <= 35) return { size: 'day', stepDays: 1 };
  if (windowDays <= 200) return { size: 'week', stepDays: 7 };
  return { size: 'month', stepDays: 30 }; // approximate — actual step by calendar month
}

function _startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function _startOfWeek(d) { // Monday
  const x = _startOfDay(d);
  const dow = x.getDay(); // 0=Sun
  const shift = (dow + 6) % 7; // Monday=0
  x.setDate(x.getDate() - shift);
  return x;
}
function _startOfMonth(d) {
  const x = _startOfDay(d);
  x.setDate(1);
  return x;
}

function _bucketKey(date, size) {
  if (size === 'day')   return date.toISOString().slice(0, 10);
  if (size === 'week')  return _startOfWeek(date).toISOString().slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function _bucketLabel(date, size) {
  if (size === 'day')   return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (size === 'week')  return 'Week of ' + _startOfWeek(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function _enumerate(windowStart, windowEnd, bucket) {
  const out = [];
  let cursor;
  if (bucket.size === 'day')   cursor = _startOfDay(windowStart);
  else if (bucket.size === 'week') cursor = _startOfWeek(windowStart);
  else                              cursor = _startOfMonth(windowStart);
  const end = new Date(windowEnd);
  while (cursor <= end) {
    out.push(new Date(cursor));
    if (bucket.size === 'day')  cursor.setDate(cursor.getDate() + 1);
    else if (bucket.size === 'week') cursor.setDate(cursor.getDate() + 7);
    else                              cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

// Earliest training entry timestamp, or now if no entries
function _earliestEntryMs() {
  let min = Infinity;
  for (const e of store.entries) if (e.timestamp < min) min = e.timestamp;
  return min === Infinity ? Date.now() : min;
}

// Max pan offset (days) so you can still see at least one real data point.
// Volume uses the range-pill window width; the heatmap always shows ~1 year
// regardless of chartDateRange, so we size the clamp to that.
function _maxOffsetDays() {
  const span = (Date.now() - _earliestEntryMs()) / MS_PER_DAY;
  const visibleDays = store.chartType === 'heatmap'
    ? 52 * 7
    : _windowDays(store.chartDateRange);
  return Math.max(0, Math.ceil(span - visibleDays / 2));
}

// Active bucket state — used by the pan gesture in initCharts
let _activeBucket = null;
// Geometry captured at render time for whichever chart is active, so the
// pan handler can convert pixel-drag → days without re-doing the layout.
// { stepDays, pitchPx, plotLeft } where pitchPx is the width of one bar/column.
let _panGeom = null;
// Flag set by the pointer pan handler so the mouse-hover tooltip doesn't
// fight the pan gesture when dragging with a mouse (mousemove + pointermove
// both fire for the same pointer).
let _isPanning = false;

function renderVolumeChart(w, h) {
  if (store.entries.length === 0) { drawEmpty(w, h, 'No data yet'); return; }
  const { pad, cw, ch } = chartSetup(w, h, 55);
  const lifts = (store.chartFilter === 'all' || store.chartFilter === 'total') ? LIFTS : [store.chartFilter];

  // --- Window + bucket selection -------------------------------------------
  const today = _startOfDay(new Date());
  const windowDays = _windowDays(store.chartDateRange);
  const offsetDays = Math.max(0, store.chartOffset || 0);
  const windowEnd = new Date(today.getTime() - offsetDays * MS_PER_DAY);
  const windowStart = new Date(windowEnd.getTime() - windowDays * MS_PER_DAY);
  const bucket = _bucketForWindow(windowDays);
  const buckets = _enumerate(windowStart, windowEnd, bucket);
  _activeBucket = bucket;

  // --- Aggregate entries into buckets --------------------------------------
  const byKey = {};
  buckets.forEach(b => { byKey[_bucketKey(b, bucket.size)] = { squat: 0, bench: 0, deadlift: 0 }; });
  store.entries.forEach(e => {
    if (store.chartFilter !== 'all' && store.chartFilter !== 'total' && e.lift !== store.chartFilter) return;
    const d = new Date(e.date + 'T12:00:00');
    if (d < windowStart || d > windowEnd) return;
    const k = _bucketKey(d, bucket.size);
    if (byKey[k]) byKey[k][e.lift] += e.weight * e.reps;
  });

  // --- Axis scaling --------------------------------------------------------
  const totals = buckets.map(b => {
    const data = byKey[_bucketKey(b, bucket.size)];
    return lifts.reduce((s, l) => s + (data[l] || 0), 0);
  });
  const maxDisp = Math.max(...totals.map(v => displayWeight(v)), 1);
  const minVal = 0, maxVal = Math.ceil(maxDisp * 1.1);

  // Draw axes using bucket labels. drawAxes wants a string[] of date labels.
  const axisLabels = buckets.map(b => _bucketKey(b, 'day'));
  drawAxes(w, h, pad, axisLabels, minVal, maxVal);

  // --- Bars ----------------------------------------------------------------
  const barPitch = cw / buckets.length;
  const barW = Math.max(2, Math.min(30, barPitch * 0.7));
  const barR = Math.min(3, barW / 4);

  // Record geometry for the pan handler (volume chart path).
  _panGeom = { stepDays: bucket.stepDays, pitchPx: barPitch, plotLeft: pad.left };

  buckets.forEach((b, i) => {
    const key = _bucketKey(b, bucket.size);
    const data = byKey[key];
    const total = lifts.reduce((s, l) => s + (data[l] || 0), 0);
    const x = pad.left + i * barPitch + (barPitch - barW) / 2;

    if (total === 0) {
      // Empty-bucket stub — 2px baseline grey so the timeline is continuous
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, pad.top + ch - 2, barW, 2);
      return;
    }

    let yBottom = pad.top + ch;
    const nonZero = lifts.filter(l => (data[l] || 0) > 0);
    const topLift = nonZero[nonZero.length - 1];

    lifts.forEach(lift => {
      const vol = data[lift] || 0;
      if (vol <= 0) return;
      const dispVol = displayWeight(vol);
      const barH = (dispVol / (maxVal - minVal)) * ch;
      ctx.fillStyle = COLORS[lift];

      if (lift === topLift && barH > barR * 2) {
        ctx.beginPath();
        ctx.roundRect(x, yBottom - barH, barW, barH, [barR, barR, 0, 0]);
        ctx.fill();
      } else {
        ctx.fillRect(x, yBottom - barH, barW, barH);
      }

      // Depth: lighter left edge
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x, yBottom - barH, 1.5, barH);

      store.chartPoints.push({
        x: x + barW / 2,
        y: yBottom - barH / 2,
        date: key,
        value: vol,
        lift,
        color: COLORS[lift],
        tooltipExtra: _bucketLabel(b, bucket.size),
      });
      yBottom -= barH;
    });
  });

  // --- "← Today" chip visibility is managed in syncChartUI ----------------
}

// ---------------------------------------------------------------------------
// Bodyweight Chart — gradient fill, bezier curves
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
  const bottomY = pad.top + ch;

  // Raw line: gradient fill + smooth line
  const rawPts = sorted.map((b, i) => ({ x: xPos(i), y: yPos(displayWeight(b.weight)) }));
  drawGradientFill(rawPts, '#aaaaaa', bottomY);
  drawSmoothLine(rawPts, '#aaa', 2);
  sorted.forEach((b, i) => {
    store.chartPoints.push({ x: xPos(i), y: yPos(displayWeight(b.weight)), date: b.date, value: b.weight, lift: 'BW', color: '#aaa' });
  });
  // Raw dots
  sorted.forEach((b, i) => {
    ctx.beginPath(); ctx.arc(xPos(i), yPos(displayWeight(b.weight)), 3, 0, Math.PI * 2);
    ctx.fillStyle = '#aaa'; ctx.fill();
  });

  // 7-day rolling average
  if (sorted.length >= 3) {
    const avgPts = [];
    sorted.forEach((b, i) => {
      const windowStart = new Date(new Date(b.date + 'T12:00:00').getTime() - 7 * MS_PER_DAY).toISOString().split('T')[0];
      const windowData = sorted.filter(p => p.date >= windowStart && p.date <= b.date);
      const avg = windowData.reduce((s, p) => s + displayWeight(p.weight), 0) / windowData.length;
      avgPts.push({ x: xPos(i), y: yPos(avg) });
    });
    drawGradientFill(avgPts, '#ffd700', bottomY);
    drawSmoothLine(avgPts, '#ffd700', 2);

    // Legend
    ctx.font = '11px -apple-system, sans-serif'; ctx.textAlign = 'left';
    ctx.fillStyle = '#aaa'; ctx.fillText('Raw', pad.left + 5, pad.top + 12);
    ctx.fillStyle = '#ffd700'; ctx.fillText('7d Avg', pad.left + 40, pad.top + 12);
  }
}

// ---------------------------------------------------------------------------
// Wilks/DOTS Chart — gradient fill, bezier curves
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
  const bottomY = pad.top + ch;

  drawAxes(w, h, pad, dates, minVal, maxVal);

  const xPos = i => pad.left + (dates.length === 1 ? cw / 2 : (i / (dates.length - 1)) * cw);
  const yPos = v => pad.top + ch - ((v - minVal) / valRange) * ch;

  // Wilks: gradient fill + smooth line
  const wilksPts = dataPoints.map((p, i) => ({ x: xPos(i), y: yPos(p.wilks) }));
  drawGradientFill(wilksPts, '#ff9800', bottomY);
  drawSmoothLine(wilksPts, '#ff9800', 2.5);
  dataPoints.forEach((p, i) => {
    store.chartPoints.push({ x: xPos(i), y: yPos(p.wilks), date: p.date, value: p.wilks, lift: 'Wilks', color: '#ff9800' });
  });
  dataPoints.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(xPos(i), yPos(p.wilks), 3, 0, Math.PI * 2); ctx.fillStyle = '#ff9800'; ctx.fill();
  });

  // DOTS: gradient fill + smooth line
  const dotsPts = dataPoints.map((p, i) => ({ x: xPos(i), y: yPos(p.dots) }));
  drawGradientFill(dotsPts, '#ab47bc', bottomY);
  drawSmoothLine(dotsPts, '#ab47bc', 2.5);
  dataPoints.forEach((p, i) => {
    store.chartPoints.push({ x: xPos(i), y: yPos(p.dots), date: p.date, value: p.dots, lift: 'DOTS', color: '#ab47bc' });
  });
  dataPoints.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(xPos(i), yPos(p.dots), 3, 0, Math.PI * 2); ctx.fillStyle = '#ab47bc'; ctx.fill();
  });

  // Legend
  ctx.font = '11px -apple-system, sans-serif'; ctx.textAlign = 'left';
  ctx.fillStyle = '#ff9800'; ctx.fillText('Wilks', pad.left + 5, pad.top + 12);
  ctx.fillStyle = '#ab47bc'; ctx.fillText('DOTS', pad.left + 55, pad.top + 12);
}

// ---------------------------------------------------------------------------
// Heatmap Chart — per-lift colors, PR stars, streaks, weekly summary
// ---------------------------------------------------------------------------

function renderHeatmap(w, h) {
  if (store.entries.length === 0) { drawEmpty(w, h, 'No data yet'); return; }
  const now = new Date();
  // Shift the viewing window back by chartOffset days so the user can
  // drag the heatmap horizontally to see earlier months.
  const offsetDays = Math.max(0, store.chartOffset || 0);
  const realToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = new Date(realToday.getTime() - offsetDays * MS_PER_DAY);
  const weeksToShow = Math.min(52, Math.floor((w - 40) / 10));
  const daysBack = weeksToShow * 7;
  const startDate = new Date(today.getTime() - daysBack * MS_PER_DAY);
  const startDay = startDate.getDay();
  const adjustedStart = new Date(startDate.getTime() - ((startDay + 6) % 7) * MS_PER_DAY);

  // --- Data collection ---
  const metric = store.heatmapMetric || 'volume';
  const valByDate = {}, liftsByDate = {}, prsByDate = {}, setsByDate = {};
  store.entries.forEach(e => {
    if (metric === 'sets') valByDate[e.date] = (valByDate[e.date] || 0) + 1;
    else valByDate[e.date] = (valByDate[e.date] || 0) + e.weight * e.reps;
    if (!liftsByDate[e.date]) liftsByDate[e.date] = new Set();
    liftsByDate[e.date].add(e.lift);
    setsByDate[e.date] = (setsByDate[e.date] || 0) + 1;
    if (e.isPR) { if (!prsByDate[e.date]) prsByDate[e.date] = []; prsByDate[e.date].push(e.lift); }
  });
  const allVals = Object.values(valByDate).filter(v => v > 0);
  const maxVal = allVals.length > 0 ? Math.max(...allVals) : 1;

  // Streak data
  const trainingDates = new Set(Object.keys(valByDate));

  // --- Layout ---
  const cellSize = Math.min(14, Math.max(8, Math.floor((w - 40) / (weeksToShow + 1))));
  const gap = 2;
  const padLeft = 22;
  const padTop = 18;
  const summaryRowH = 16;

  // Record geometry for the pan handler (heatmap path): one column = 1 week.
  _panGeom = { stepDays: 7, pitchPx: cellSize + gap, plotLeft: padLeft };
  const dayLabels = ['M', '', 'W', '', 'F', '', 'S'];
  const surface2 = getComputedStyle(document.documentElement).getPropertyValue('--surface2').trim() || '#2a2a2a';

  // Lift colors (parse COLORS into rgb for blending)
  const LIFT_RGB = {
    squat: [229, 57, 53],
    bench: [30, 136, 229],
    deadlift: [67, 160, 71],
  };
  const baseRGB = [42, 42, 42]; // surface2 approximate

  function liftColor(dateStr, val) {
    if (val === 0) return surface2;
    const lifts = liftsByDate[dateStr];
    if (!lifts || lifts.size === 0) return surface2;
    const t = Math.pow(Math.min(1, val / maxVal), 0.7);
    // Blend lift colors
    let r = 0, g = 0, b = 0, count = 0;
    for (const lift of lifts) {
      const rgb = LIFT_RGB[lift];
      if (rgb) { r += rgb[0]; g += rgb[1]; b += rgb[2]; count++; }
    }
    if (count === 0) return surface2;
    r /= count; g /= count; b /= count;
    // Interpolate from base to lift color
    const fr = Math.round(baseRGB[0] + (r - baseRGB[0]) * t);
    const fg = Math.round(baseRGB[1] + (g - baseRGB[1]) * t);
    const fb = Math.round(baseRGB[2] + (b - baseRGB[2]) * t);
    return `rgb(${fr},${fg},${fb})`;
  }

  // --- Day of week labels ---
  ctx.font = `${Math.max(7, cellSize - 3)}px -apple-system, sans-serif`;
  ctx.fillStyle = '#666'; ctx.textAlign = 'right';
  for (let d = 0; d < 7; d++) {
    if (dayLabels[d]) ctx.fillText(dayLabels[d], padLeft - 3, padTop + d * (cellSize + gap) + cellSize - 1);
  }

  // --- Month labels + separator lines ---
  ctx.textAlign = 'center';
  let lastMonth = -1;
  for (let wk = 0; wk <= weeksToShow; wk++) {
    const weekStart = new Date(adjustedStart.getTime() + wk * 7 * MS_PER_DAY);
    const month = weekStart.getMonth();
    if (month !== lastMonth) {
      // Month separator line
      if (lastMonth !== -1) {
        const sx = padLeft + wk * (cellSize + gap) - gap / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(sx, padTop);
        ctx.lineTo(sx, padTop + 7 * (cellSize + gap));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      lastMonth = month;
      const x = padLeft + wk * (cellSize + gap) + cellSize / 2;
      ctx.font = `bold ${Math.max(8, cellSize - 2)}px -apple-system, sans-serif`;
      ctx.fillStyle = '#888';
      ctx.fillText(weekStart.toLocaleDateString('en-US', { month: 'short' }), x, padTop - 5);
    }
  }

  // --- Draw cells ---
  const weekTotals = [];
  for (let wk = 0; wk <= weeksToShow; wk++) {
    let weekTotal = 0;
    for (let day = 0; day < 7; day++) {
      const cellDate = new Date(adjustedStart.getTime() + (wk * 7 + day) * MS_PER_DAY);
      // Skip cells in the *real* future only — panning back should still
      // let cells between today-window-end and real-today render normally.
      if (cellDate > realToday) continue;
      const dateStr = cellDate.toISOString().split('T')[0];
      const val = valByDate[dateStr] || 0;
      weekTotal += val;
      const x = padLeft + wk * (cellSize + gap);
      const y = padTop + day * (cellSize + gap);

      // Cell fill
      ctx.fillStyle = liftColor(dateStr, val);
      ctx.beginPath();
      ctx.roundRect(x, y, cellSize, cellSize, 2);
      ctx.fill();

      // Streak highlight: border on consecutive training days
      if (val > 0) {
        const prevDateStr = new Date(cellDate.getTime() - MS_PER_DAY).toISOString().split('T')[0];
        const nextDateStr = new Date(cellDate.getTime() + MS_PER_DAY).toISOString().split('T')[0];
        if (trainingDates.has(prevDateStr) || trainingDates.has(nextDateStr)) {
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1, 2);
          ctx.stroke();
        }
      }

      // PR star
      if (prsByDate[dateStr]) {
        ctx.font = `${Math.max(6, cellSize - 5)}px sans-serif`;
        ctx.fillStyle = '#ffd700';
        ctx.textAlign = 'center';
        ctx.fillText('\u2605', x + cellSize / 2, y + cellSize / 2 + Math.max(2, cellSize / 5));
      }

      // Tooltip data
      if (val > 0) {
        const lifts = liftsByDate[dateStr] ? [...liftsByDate[dateStr]].map(l => LIFT_SHORT[l] || l).join('/') : '';
        const sets = setsByDate[dateStr] || 0;
        const prs = prsByDate[dateStr] ? prsByDate[dateStr].length : 0;
        store.chartPoints.push({
          x: x + cellSize / 2, y: y + cellSize / 2,
          date: dateStr, value: val,
          lift: lifts, color: ctx.fillStyle,
          sets, prs,
          tooltipExtra: `${sets} sets${prs > 0 ? ` · ${prs} PR` : ''}`,
        });
      }
    }
    weekTotals.push(weekTotal);
  }

  // --- Weekly summary row ---
  const maxWeekTotal = Math.max(...weekTotals, 1);
  const summaryY = padTop + 7 * (cellSize + gap) + 4;
  for (let wk = 0; wk <= weeksToShow; wk++) {
    const x = padLeft + wk * (cellSize + gap);
    const barH = Math.max(1, (weekTotals[wk] / maxWeekTotal) * summaryRowH);
    ctx.fillStyle = weekTotals[wk] > 0 ? 'rgba(255,215,0,0.3)' : 'transparent';
    ctx.beginPath();
    ctx.roundRect(x, summaryY + summaryRowH - barH, cellSize, barH, 1);
    ctx.fill();
  }

  // --- Streak counter ---
  const streakData = _calcHeatmapStreak(trainingDates);
  if (streakData) {
    ctx.font = `bold ${Math.max(9, cellSize - 1)}px -apple-system, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#888';
    const streakText = streakData.current > 0
      ? `${streakData.current}d streak · Best: ${streakData.longest}d`
      : `Best streak: ${streakData.longest}d`;
    ctx.fillText(streakText, padLeft, summaryY + summaryRowH + 14);
  }

  // --- Legend ---
  const legendY = h - 12;
  ctx.font = '8px -apple-system, sans-serif'; ctx.textAlign = 'left';
  ctx.fillStyle = '#666'; ctx.fillText('SQ', padLeft, legendY);
  ctx.fillStyle = `rgb(${LIFT_RGB.squat})`; ctx.fillRect(padLeft + 14, legendY - 7, 8, 8);
  ctx.fillStyle = '#666'; ctx.fillText('BP', padLeft + 28, legendY);
  ctx.fillStyle = `rgb(${LIFT_RGB.bench})`; ctx.fillRect(padLeft + 42, legendY - 7, 8, 8);
  ctx.fillStyle = '#666'; ctx.fillText('DL', padLeft + 56, legendY);
  ctx.fillStyle = `rgb(${LIFT_RGB.deadlift})`; ctx.fillRect(padLeft + 68, legendY - 7, 8, 8);
  ctx.fillStyle = '#ffd700'; ctx.fillText('\u2605 = PR', padLeft + 84, legendY);
}

function _calcHeatmapStreak(trainingDates) {
  if (trainingDates.size === 0) return null;
  const sorted = [...trainingDates].sort().reverse();
  const today = new Date().toISOString().split('T')[0];
  const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / MS_PER_DAY);

  let current = 0;
  if (dayDiff(today, sorted[0]) <= 1) {
    current = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (dayDiff(sorted[i - 1], sorted[i]) <= 1) current++;
      else break;
    }
  }

  let longest = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (dayDiff(sorted[i - 1], sorted[i]) <= 1) { run++; if (run > longest) longest = run; }
    else run = 1;
  }
  return { current, longest };
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
  const startDow = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const today = new Date().toISOString().split('T')[0];

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

  el.querySelector('#cal-prev').addEventListener('click', () => {
    store.calendarMonth = new Date(year, month - 1, 1);
    renderCalendar();
  });
  el.querySelector('#cal-next').addEventListener('click', () => {
    store.calendarMonth = new Date(year, month + 1, 1);
    renderCalendar();
  });

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
// Chart summary header
// ---------------------------------------------------------------------------

function updateChartSummary() {
  const el = document.getElementById('chart-summary');
  if (!el) return;

  if (store.chartType === 'heatmap' || store.chartType === 'calendar') {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';

  const dateCutoff = getChartDateCutoff();
  const rangeLabel = store.chartDateRange === 'all' ? 'all time'
    : store.chartDateRange === '365' ? 'last year'
    : store.chartDateRange === '180' ? 'last 6mo'
    : `last ${store.chartDateRange}d`;
  let html = '';

  if (store.chartType === 'e1rm') {
    const lift = (store.chartFilter !== 'all' && store.chartFilter !== 'total') ? store.chartFilter : null;
    if (lift) {
      const filtered = store.entries.filter(e => e.lift === lift && (!dateCutoff || e.date >= dateCutoff));
      if (filtered.length > 0) {
        const best = Math.max(...filtered.map(e => e.e1rm));
        const oldest = [...filtered].sort((a, b) => a.timestamp - b.timestamp);
        const firstBest = Math.max(...store.entries.filter(e => e.lift === lift && e.date === oldest[0].date).map(e => e.e1rm));
        const delta = best - firstBest;
        const color = COLORS[lift];
        html = `<span class="summary-value" style="color:${color}">${formatWeight(best)} ${store.unit}</span>`;
        if (delta !== 0 && oldest.length > 1) {
          html += ` <span class="summary-delta ${delta > 0 ? 'positive' : 'negative'}">${delta > 0 ? '+' : ''}${formatWeight(delta)}</span>`;
        }
        html += ` <span class="summary-label">best e1RM &middot; ${rangeLabel}</span>`;
      }
    } else {
      const best = {};
      LIFTS.forEach(l => {
        const vals = store.entries.filter(e => e.lift === l && (!dateCutoff || e.date >= dateCutoff)).map(e => e.e1rm);
        if (vals.length > 0) best[l] = Math.max(...vals);
      });
      if (best.squat && best.bench && best.deadlift) {
        const total = best.squat + best.bench + best.deadlift;
        html = `<span class="summary-value" style="color:${COLORS.total}">${formatWeight(total)} ${store.unit}</span>`;
        html += ` <span class="summary-label">total &middot; ${rangeLabel}</span>`;
      }
    }
  } else if (store.chartType === 'volume') {
    // Volume summary reflects the VISIBLE panned window, not just chartDateRange.
    const today = _startOfDay(new Date());
    const windowDays = _windowDays(store.chartDateRange);
    const offsetDays = Math.max(0, store.chartOffset || 0);
    const windowEnd = new Date(today.getTime() - offsetDays * MS_PER_DAY);
    const windowStart = new Date(windowEnd.getTime() - windowDays * MS_PER_DAY);
    const inWindow = e => {
      const d = new Date(e.date + 'T12:00:00');
      return d >= windowStart && d <= windowEnd;
    };
    let filtered = store.entries.filter(inWindow);
    if (store.chartFilter !== 'all' && store.chartFilter !== 'total') {
      filtered = filtered.filter(e => e.lift === store.chartFilter);
    }
    const totalVol = filtered.reduce((s, e) => s + e.weight * e.reps, 0);
    // Label reflects the panned window: "Apr 12 – May 12" when offset > 0,
    // otherwise the range name the user picked ("last 30d" / "all time" / ...).
    const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const windowLabel = offsetDays > 0
      ? `${fmt(windowStart)} – ${fmt(windowEnd)}`
      : rangeLabel;
    if (totalVol > 0) {
      html = `<span class="summary-value">${fmtNum(displayWeight(totalVol))} ${store.unit}</span>`;
      html += ` <span class="summary-label">total volume &middot; ${windowLabel}</span>`;
    } else {
      html = `<span class="summary-label">no volume in ${windowLabel}</span>`;
    }
  } else if (store.chartType === 'bodyweight') {
    const bwh = (store.profile.bodyweightHistory || []).slice().sort((a, b) => a.timestamp - b.timestamp);
    if (bwh.length > 0) {
      const latest = bwh[bwh.length - 1];
      let filtered = bwh;
      if (dateCutoff) filtered = bwh.filter(b => b.date >= dateCutoff);
      if (filtered.length > 0) {
        const first = filtered[0];
        const delta = latest.weight - first.weight;
        html = `<span class="summary-value">${formatWeight(latest.weight)} ${store.unit}</span>`;
        if (delta !== 0 && filtered.length > 1) {
          html += ` <span class="summary-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${formatWeight(delta)}</span>`;
        }
        html += ` <span class="summary-label">bodyweight &middot; ${rangeLabel}</span>`;
      }
    }
  } else if (store.chartType === 'wilks') {
    html = '';
  }

  el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Chart tooltip + crosshair
// ---------------------------------------------------------------------------

function handleChartHover(e) {
  // Suppress hover while the volume chart is being panned — otherwise the
  // tooltip redraws on every mouse micro-movement during a drag.
  if (_isPanning) return;
  const crosshair = document.getElementById('chart-crosshair');
  if (store.chartPoints.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let closest = null, minDist = Infinity;
  store.chartPoints.forEach(p => { const d = Math.hypot(p.x - mx, p.y - my); if (d < minDist && d < 40) { minDist = d; closest = p; } });

  if (closest) {
    // Crosshair
    if (crosshair && store.chartType !== 'heatmap') {
      crosshair.style.left = (closest.x + 12) + 'px';
      crosshair.style.opacity = '1';
    }

    const d = new Date(closest.date + 'T12:00:00');
    const dateLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const name = LIFT_NAMES[closest.lift] || closest.lift;
    const valDisplay = (store.chartType === 'volume')
      ? fmtNum(displayWeight(closest.value)) + ' ' + store.unit
      : (store.chartType === 'wilks' || closest.lift === 'Wilks' || closest.lift === 'DOTS')
        ? Math.round(closest.value).toString()
        : formatWeight(closest.value) + ' ' + store.unit;

    // Delta from previous point
    let deltaHtml = '';
    if (store.chartType !== 'heatmap') {
      const prev = store.chartPoints.filter(p => p.lift === closest.lift && p.date < closest.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (prev) {
        const diff = closest.value - prev.value;
        if (diff !== 0) {
          const absDiff = store.chartType === 'volume'
            ? fmtNum(displayWeight(Math.abs(diff)))
            : (store.chartType === 'wilks' || closest.lift === 'Wilks' || closest.lift === 'DOTS')
              ? Math.round(Math.abs(diff)).toString()
              : formatWeight(Math.abs(diff));
          const sign = diff > 0 ? '+' : '-';
          const cls = diff > 0 ? '#43a047' : '#e53935';
          deltaHtml = ` <span style="color:${cls};font-size:0.65rem">${sign}${absDiff}</span>`;
        }
      }
    }

    if (store.chartType === 'heatmap' && closest.tooltipExtra) {
      tooltip.innerHTML = `<span style="color:${closest.color};font-weight:600">${closest.lift}</span><br><span style="font-size:0.85rem;font-weight:700;color:#fff">${fmtNum(displayWeight(closest.value))} ${store.unit}</span><br><span style="color:#aaa;font-size:0.7rem">${closest.tooltipExtra}</span><br><span style="color:#888;font-size:0.65rem">${dateLabel}</span>`;
    } else if (store.chartType === 'volume' && closest.tooltipExtra) {
      // Volume bars: show the bucket label (e.g. "Week of Apr 7" / "April 2026")
      tooltip.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${closest.color};margin-right:4px;vertical-align:middle"></span><span style="color:${closest.color};font-weight:600">${name}</span>${deltaHtml}<br><span style="font-size:0.85rem;font-weight:700;color:#fff">${valDisplay}</span><br><span style="color:#888;font-size:0.65rem">${closest.tooltipExtra}</span>`;
    } else {
      tooltip.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${closest.color};margin-right:4px;vertical-align:middle"></span><span style="color:${closest.color};font-weight:600">${name}</span>${deltaHtml}<br><span style="font-size:0.85rem;font-weight:700;color:#fff">${valDisplay}</span><br><span style="color:#888;font-size:0.65rem">${dateLabel}</span>`;
    }
    const containerRect = canvas.parentElement.getBoundingClientRect();
    let tx = closest.x + 12, ty = closest.y - 40;
    if (tx + 140 > containerRect.width - 12) tx = closest.x - 140;
    if (ty < 0) ty = closest.y + 12;
    tooltip.style.left = (tx + 12) + 'px'; tooltip.style.top = (ty + 12) + 'px';
    tooltip.style.opacity = '1';
  } else {
    tooltip.style.opacity = '0';
    if (crosshair) crosshair.style.opacity = '0';
  }
}

// ---------------------------------------------------------------------------
// Main renderChart()
// ---------------------------------------------------------------------------

export function renderChart() {
  syncChartUI();
  updateChartSummary();

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

  // Fade animation on chart type/filter/range change
  const chartKey = `${store.chartType}-${store.chartFilter}-${store.chartDateRange}`;
  const shouldFade = chartKey !== _prevChartKey;
  _prevChartKey = chartKey;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width - 24;
  const h = Math.min(w * 0.65, 300);
  canvas.width = w * dpr; canvas.height = h * dpr;
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  store.chartPoints = [];
  ctx.clearRect(0, 0, w, h);

  if (shouldFade) canvas.style.opacity = '0';

  if (store.chartType === 'e1rm') renderE1RMChart(w, h);
  else if (store.chartType === 'volume') renderVolumeChart(w, h);
  else if (store.chartType === 'bodyweight') renderBWChart(w, h);
  else if (store.chartType === 'wilks') renderWilksChart(w, h);
  else if (store.chartType === 'heatmap') renderHeatmap(w, h);

  if (shouldFade) requestAnimationFrame(() => { canvas.style.opacity = '1'; });
}

// ---------------------------------------------------------------------------
// initChartsTab — wire up event listeners + create dynamic elements
// ---------------------------------------------------------------------------

export function initChartsTab() {
  // Create summary header (before chart container)
  const summary = document.createElement('div');
  summary.id = 'chart-summary';
  summary.className = 'chart-summary';
  canvas.parentElement.parentElement.insertBefore(summary, canvas.parentElement);

  // Create crosshair (inside chart container)
  const crosshair = document.createElement('div');
  crosshair.id = 'chart-crosshair';
  crosshair.className = 'chart-crosshair';
  canvas.parentElement.appendChild(crosshair);

  // Heatmap metric toggle
  const metricToggle = document.createElement('div');
  metricToggle.id = 'heatmap-metric-toggle';
  metricToggle.className = 'heatmap-metric-toggle';
  metricToggle.style.display = 'none';
  metricToggle.innerHTML = `<button class="heatmap-metric-btn active" data-metric="volume">Volume</button><button class="heatmap-metric-btn" data-metric="sets">Sets</button>`;
  canvas.parentElement.parentElement.insertBefore(metricToggle, canvas.parentElement);
  metricToggle.addEventListener('click', e => {
    const btn = e.target.closest('.heatmap-metric-btn');
    if (!btn) return;
    store.heatmapMetric = btn.dataset.metric;
    renderChart();
  });

  // Chart date range pills — switching range rescales the pan window, so
  // reset the offset to avoid stranding the user in an empty slice of time.
  $('chart-date-range').addEventListener('click', e => {
    const pill = e.target.closest('.range-pill');
    if (!pill) return;
    store.chartDateRange = pill.dataset.range;
    store.chartOffset = 0;
    renderChart();
  });

  // Chart type selector — switching chart types resets the pan offset so
  // each chart starts at "today" rather than inheriting a stale offset.
  document.querySelectorAll('.chart-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (store.chartType !== btn.dataset.type) store.chartOffset = 0;
      store.chartType = btn.dataset.type;
      renderChart();
    });
  });

  // Chart filter buttons
  $('chart-filters').addEventListener('click', e => {
    const btn = e.target.closest('.chart-filter-btn');
    if (!btn) return;
    store.chartFilter = btn.dataset.filter;
    renderChart();
  });

  // --- Volume histogram pan (swipe horizontally to scroll through time) ---
  // "← Today" chip: resets pan offset to 0. Absolutely positioned in the
  // chart container; visibility managed by syncChartUI() below.
  const container = canvas.parentElement;
  const todayChip = document.createElement('button');
  todayChip.id = 'chart-today-chip';
  todayChip.className = 'chart-today-chip';
  todayChip.type = 'button';
  todayChip.textContent = '← Today';
  todayChip.style.display = 'none';
  todayChip.addEventListener('click', () => {
    store.chartOffset = 0;
    renderChart();
  });
  container.appendChild(todayChip);

  // Pan gesture — pointer events so mouse + finger both work.
  // Applies to Volume histogram AND Activity heatmap.
  const isPannable = () => store.chartType === 'volume' || store.chartType === 'heatmap';
  let panState = null;
  canvas.addEventListener('pointerdown', e => {
    if (!isPannable() || !_panGeom) return;
    panState = {
      startX: e.clientX,
      baseOffset: store.chartOffset || 0,
      moved: false,
      pointerId: e.pointerId,
    };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine on unsupported */ }
  });
  canvas.addEventListener('pointermove', e => {
    if (!panState) return;
    const dx = e.clientX - panState.startX;
    if (!panState.moved && Math.abs(dx) < 5) return;

    if (!panState.moved) {
      panState.moved = true;
      _isPanning = true;
      // Suppress tooltip/crosshair during a pan.
      tooltip.style.opacity = '0';
      const ch = document.getElementById('chart-crosshair');
      if (ch) ch.style.opacity = '0';
    }

    if (!_panGeom) return;
    const { stepDays, pitchPx } = _panGeom;
    // Drag right (dx > 0) → go back in time (offset increases).
    const columnsDragged = Math.round(-dx / Math.max(1, pitchPx));
    const proposed = panState.baseOffset + columnsDragged * stepDays;
    const next = Math.max(0, Math.min(_maxOffsetDays(), proposed));
    if (next !== store.chartOffset) {
      store.chartOffset = next;
      renderChart();
    }
  });
  const endPan = () => {
    panState = null;
    // Release the pan flag on the next tick so the trailing mousemove from the
    // same gesture (which would repaint the tooltip at the release point) is
    // still suppressed.
    setTimeout(() => { _isPanning = false; }, 0);
  };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('pointerleave', e => {
    if (panState && panState.pointerId === e.pointerId) endPan();
  });

  // Chart tooltip
  canvas.addEventListener('mousemove', handleChartHover);
  canvas.addEventListener('touchmove', e => {
    if (store.chartPoints.length > 0) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.touches[0].clientX - rect.left, my = e.touches[0].clientY - rect.top;
      const near = store.chartPoints.some(p => Math.hypot(p.x - mx, p.y - my) < 40);
      if (near) e.preventDefault();
    }
    handleChartHover({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY });
  }, { passive: false });
  canvas.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
    const ch = document.getElementById('chart-crosshair');
    if (ch) ch.style.opacity = '0';
  });
  canvas.addEventListener('touchend', () => {
    tooltip.style.opacity = '0';
    const ch = document.getElementById('chart-crosshair');
    if (ch) ch.style.opacity = '0';
  });
}
