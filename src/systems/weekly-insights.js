/**
 * Smart weekly review engine — analyzes prior week training and generates
 * prioritized insight chips for the dashboard card.
 *
 * Composes from: fatigue, coverage, weekly-grade, weekly-recap, streak systems.
 */

import store from '../state/store.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { MS_PER_DAY } from '../constants/time.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { MUSCLE_GROUPS, WEEKLY_SET_TARGETS, MAIN_LIFT_WEIGHTS } from '../data/muscle-groups.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';

// Tier 1 muscles (worth surfacing as chips)
const CHIP_MUSCLES = ['Quads', 'Chest', 'Glutes', 'Hams', 'Upper Back', 'Lower Back'];

// Chip colors
const COLORS = {
  red: 'var(--red)',
  orange: 'var(--yellow)',
  green: 'var(--green)',
  blue: 'var(--bench)',
  gold: 'var(--gold)',
  purple: 'var(--purple)',
};

// ---------------------------------------------------------------------------
// Phase detection
// ---------------------------------------------------------------------------

function getWeekRange(weeksBack) {
  const now = new Date();
  const thisMonday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * MS_PER_DAY);
  thisMonday.setHours(0, 0, 0, 0);
  const start = new Date(thisMonday.getTime() - weeksBack * 7 * MS_PER_DAY);
  const end = new Date(start.getTime() + 7 * MS_PER_DAY);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function getWeekStats(startMs, endMs) {
  const entries = store.entries.filter(e => e.timestamp >= startMs && e.timestamp < endMs);
  const volume = entries.reduce((s, e) => s + e.weight * e.reps, 0);
  let avgIntensity = 0;
  let intensityCount = 0;
  entries.forEach(e => {
    const best = bestE1RM(e.lift);
    if (best > 0) { avgIntensity += e.weight / best; intensityCount++; }
  });
  avgIntensity = intensityCount > 0 ? avgIntensity / intensityCount : 0;
  const withRPE = entries.filter(e => e.rpe != null && e.rpe > 0);
  const avgRPE = withRPE.length > 0 ? withRPE.reduce((s, e) => s + e.rpe, 0) / withRPE.length : null;
  const rpeLogged = entries.length > 0 ? withRPE.length / entries.length : 0;
  return { entries, volume, avgIntensity, avgRPE, rpeLogged, sets: entries.length };
}

function getRollingAvg() {
  // 4-week rolling average from W-2 to W-5 (skip W-1 = last week itself)
  let totalVol = 0, totalInt = 0, count = 0;
  for (let w = 2; w <= 5; w++) {
    const { startMs, endMs } = getWeekRange(w);
    const stats = getWeekStats(startMs, endMs);
    if (stats.sets > 0) {
      totalVol += stats.volume;
      totalInt += stats.avgIntensity;
      count++;
    }
  }
  return count > 0 ? { avgVolume: totalVol / count, avgIntensity: totalInt / count } : null;
}

function detectPhase(lastWeekStats, rolling) {
  // Layer 1: mesocycle label
  if (store.activeMesocycle && store.activeMesocycle.status === 'active') {
    const weekIdx = (store.activeMesocycle.currentWeek || 1) - 1;
    // Check PREVIOUS week (currentWeek may have already advanced)
    const prevIdx = Math.max(0, weekIdx - 1);
    const week = store.activeMesocycle.weeks[prevIdx];
    if (week && week.phase && week.phase.toLowerCase().includes('deload')) return 'deload';
  }

  if (!rolling) return 'normal';

  const volRatio = rolling.avgVolume > 0 ? lastWeekStats.volume / rolling.avgVolume : 1;
  const intDrop = rolling.avgIntensity > 0 ? (rolling.avgIntensity - lastWeekStats.avgIntensity) / rolling.avgIntensity : 0;

  // Deload auto-detect: volume drop >= 40% AND intensity drop >= 10%
  if (volRatio <= 0.60 && intDrop >= 0.10) return 'deload';
  // Or volume drop >= 50% alone
  if (volRatio <= 0.50) return 'deload';

  // Peaking: avg intensity >= 85% AND volume <= 70% of rolling AND 3+ entries
  if (lastWeekStats.avgIntensity >= 0.85 && volRatio <= 0.70 && lastWeekStats.sets >= 3) return 'peaking';

  // Accumulation: avg intensity 60-80% AND volume >= 110% of rolling
  if (lastWeekStats.avgIntensity >= 0.60 && lastWeekStats.avgIntensity <= 0.80 && volRatio >= 1.10) return 'accumulation';

  return 'normal';
}

// ---------------------------------------------------------------------------
// Insight generators
// ---------------------------------------------------------------------------

function generateInsights(lastWeekStats, phase, rolling) {
  const insights = [];
  const { startMs, endMs } = getWeekRange(1); // last week

  // --- Phase chip ---
  if (phase === 'deload') insights.push({ type: 'phase', label: 'Deload week', color: COLORS.blue, severity: 0, tier: 1, detail: 'Low volume/intensity week — recovery focused' });
  else if (phase === 'peaking') insights.push({ type: 'phase', label: 'Peaking', color: COLORS.blue, severity: 0, tier: 1, detail: 'High intensity, reduced volume — strength is sharpening' });
  else if (phase === 'accumulation') insights.push({ type: 'phase', label: 'Building volume', color: COLORS.blue, severity: 0, tier: 1, detail: 'Moderate intensity, high volume — accumulation block' });

  // --- PR chips ---
  const prs = lastWeekStats.entries.filter(e => e.isPR);
  if (prs.length === 1) {
    insights.push({ type: 'pr', label: `PR: ${LIFT_NAMES[prs[0].lift]}`, color: COLORS.gold, severity: 0, tier: 1, detail: `New PR on ${LIFT_NAMES[prs[0].lift]}` });
  } else if (prs.length > 1) {
    insights.push({ type: 'pr', label: `${prs.length} PRs`, color: COLORS.gold, severity: 0, tier: 1, detail: `${prs.length} personal records this week` });
  }

  // --- Fatigue chips (Tier 1 muscles + Lower Back) ---
  const fatigue = calcFatigueByMuscle();
  if (fatigue) {
    const hotMuscles = [];
    const warmMuscles = [];
    CHIP_MUSCLES.forEach(mg => {
      const f = fatigue[mg];
      if (!f) return;
      if (f.displayStatus === 'red') hotMuscles.push(mg);
      else if (f.displayStatus === 'orange') warmMuscles.push(mg);
    });
    if (hotMuscles.length === 1) {
      insights.push({ type: 'overtrained', label: `${hotMuscles[0]} hot`, color: COLORS.red, severity: 1, tier: 2, detail: `${hotMuscles[0]} fatigue is elevated — consider reducing volume` });
    } else if (hotMuscles.length > 1) {
      insights.push({ type: 'overtrained', label: `${hotMuscles[0]} hot +${hotMuscles.length - 1}`, color: COLORS.red, severity: 1, tier: 2, detail: `${hotMuscles.join(', ')} fatigue elevated` });
    }
    if (warmMuscles.length > 0 && hotMuscles.length === 0) {
      insights.push({ type: 'overtrained', label: `${warmMuscles[0]} warm`, color: COLORS.orange, severity: 2, tier: 2, detail: `${warmMuscles.join(', ')} fatigue is moderate` });
    }
  }

  // --- Missing lifts ---
  const liftsTrained = new Set(lastWeekStats.entries.map(e => e.lift));
  const missedLifts = LIFTS.filter(l => !liftsTrained.has(l));
  missedLifts.forEach(l => {
    insights.push({ type: 'missing', label: `No ${LIFT_NAMES[l]}`, color: COLORS.orange, severity: 2, tier: 2, detail: `${LIFT_NAMES[l]} was not trained last week` });
  });

  // --- Undertrained muscles ---
  const muscleSets = {};
  MUSCLE_GROUPS.forEach(mg => { muscleSets[mg] = 0; });
  lastWeekStats.entries.forEach(e => {
    const weights = MAIN_LIFT_WEIGHTS[e.lift];
    if (!weights) return;
    MUSCLE_GROUPS.forEach(mg => { if (weights[mg] >= 0.15) muscleSets[mg] += 1; });
  });
  CHIP_MUSCLES.forEach(mg => {
    const target = WEEKLY_SET_TARGETS[mg];
    if (!target) return;
    const sets = muscleSets[mg];
    if (sets === 0 && target.min >= 6) {
      insights.push({ type: 'undertrained', label: `${mg} skipped`, color: COLORS.red, severity: 2, tier: 2, detail: `${mg} got 0 sets (target: ${target.min}-${target.max})` });
    } else if (sets > 0 && sets < target.min * 0.3) {
      insights.push({ type: 'undertrained', label: `${mg} low`, color: COLORS.orange, severity: 3, tier: 2, detail: `${mg}: ${Math.round(sets)} sets vs ${target.min} minimum target` });
    }
  });

  // --- Volume trend ---
  if (rolling && rolling.avgVolume > 0) {
    const volChange = ((lastWeekStats.volume - rolling.avgVolume) / rolling.avgVolume) * 100;
    if (volChange > 10) {
      insights.push({ type: 'volume', label: `Vol +${Math.round(volChange)}%`, color: COLORS.green, severity: 4, tier: 3, detail: `Volume up ${Math.round(volChange)}% vs 4-week average` });
    } else if (volChange < -20) {
      insights.push({ type: 'volume', label: `Vol ${Math.round(volChange)}%`, color: COLORS.orange, severity: 4, tier: 3, detail: `Volume down ${Math.round(Math.abs(volChange))}% vs 4-week average` });
    }
  }

  // --- RPE creep ---
  if (lastWeekStats.avgRPE !== null && lastWeekStats.rpeLogged >= 0.5) {
    let rpeBaseline = 0, rpeCount = 0;
    for (let w = 2; w <= 5; w++) {
      const ws = getWeekStats(getWeekRange(w).startMs, getWeekRange(w).endMs);
      if (ws.avgRPE !== null && ws.rpeLogged >= 0.5) { rpeBaseline += ws.avgRPE; rpeCount++; }
    }
    if (rpeCount > 0) {
      const baseAvg = rpeBaseline / rpeCount;
      if (lastWeekStats.avgRPE > baseAvg + 0.5 && prs.length === 0) {
        insights.push({ type: 'rpe', label: 'RPE creeping', color: COLORS.orange, severity: 3, tier: 3, detail: `Avg RPE ${lastWeekStats.avgRPE.toFixed(1)} vs ${baseAvg.toFixed(1)} baseline — fatigue accumulating` });
      }
    }
  }

  // --- Comeback detection ---
  const prevWeekRange = getWeekRange(2);
  const prevPrevRange = getWeekRange(3);
  const prevEntries = store.entries.filter(e => e.timestamp >= prevWeekRange.startMs && e.timestamp < prevWeekRange.endMs);
  const prevPrevEntries = store.entries.filter(e => e.timestamp >= prevPrevRange.startMs && e.timestamp < prevPrevRange.endMs);
  if (prevEntries.length === 0 && prevPrevEntries.length === 0 && lastWeekStats.sets > 0) {
    // Suppress negatives, add welcome back
    return [{ type: 'comeback', label: 'Welcome back', color: COLORS.blue, severity: 0, tier: 1, detail: 'First training week after 14+ days off' }];
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Focus suggestion
// ---------------------------------------------------------------------------

function generateFocus(insights, phase, missedLifts, hotMuscles) {
  if (phase === 'deload') return { label: 'Focus: Recovery + mobility', color: COLORS.purple, detail: 'Deload week — prioritize recovery' };

  const hasRedMuscle = insights.some(c => c.type === 'overtrained' && c.color === COLORS.red);
  const missed = missedLifts.length > 0 ? LIFT_NAMES[missedLifts[0]] : null;

  if (hasRedMuscle && missed) return { label: `Focus: ${missed} (light)`, color: COLORS.purple, detail: `Train ${missed} at reduced load while managing fatigue` };
  if (hasRedMuscle) {
    const hotName = hotMuscles[0] || 'fatigued muscles';
    return { label: `Focus: Reduce ${hotName} vol`, color: COLORS.purple, detail: `${hotName} fatigue is high — drop volume this week` };
  }
  if (missed) return { label: `Focus: ${missed}`, color: COLORS.purple, detail: `${missed} was missed last week — prioritize it` };

  const undertrained = insights.filter(c => c.type === 'undertrained').map(c => c.label.replace(' skipped', '').replace(' low', ''));
  if (undertrained.length > 0) return { label: `Focus: ${undertrained.slice(0, 2).join(' + ')}`, color: COLORS.purple, detail: `Add volume for ${undertrained.join(', ')}` };

  if (phase === 'peaking') return { label: 'Focus: Sharpen singles', color: COLORS.purple, detail: 'Peaking phase — practice heavy singles' };
  if (phase === 'accumulation') return { label: 'Focus: Push volume', color: COLORS.purple, detail: 'Accumulation phase — build training volume' };

  // Volume down
  if (insights.some(c => c.type === 'volume' && c.color === COLORS.orange)) return { label: 'Focus: Rebuild volume', color: COLORS.purple, detail: 'Volume dropped — get back to baseline' };

  return { label: 'Stay the course', color: COLORS.purple, detail: 'Training looks balanced — keep going' };
}

// ---------------------------------------------------------------------------
// Context suppression
// ---------------------------------------------------------------------------

function suppressForContext(insights, phase) {
  return insights.filter(c => {
    if (phase === 'deload') {
      // Keep red overtrained (deload not working), suppress undertrained/missing/volume-down
      if (c.type === 'undertrained' || c.type === 'missing') return false;
      if (c.type === 'volume' && c.color === COLORS.orange) return false;
    }
    if (phase === 'peaking') {
      if (c.type === 'volume' && c.color === COLORS.orange) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Priority + trim to max chips
// ---------------------------------------------------------------------------

function prioritize(insights, maxChips = 4) {
  // Sort by tier, then severity
  const sorted = [...insights].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.severity - b.severity;
  });
  return sorted.slice(0, maxChips);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function calcWeeklyInsights() {
  const { startMs, endMs } = getWeekRange(1); // last week
  const lastWeekStats = getWeekStats(startMs, endMs);
  if (lastWeekStats.sets === 0) return null;

  const rolling = getRollingAvg();
  const phase = detectPhase(lastWeekStats, rolling);

  let allInsights = generateInsights(lastWeekStats, phase, rolling);

  // Context suppression
  allInsights = suppressForContext(allInsights, phase);

  // Focus suggestion
  const liftsTrained = new Set(lastWeekStats.entries.map(e => e.lift));
  const missedLifts = LIFTS.filter(l => !liftsTrained.has(l));
  const fatigue = calcFatigueByMuscle();
  const hotMuscles = fatigue ? CHIP_MUSCLES.filter(mg => fatigue[mg] && fatigue[mg].displayStatus === 'red') : [];
  const focus = generateFocus(allInsights, phase, missedLifts, hotMuscles);

  // Add focus as last insight
  allInsights.push({ ...focus, type: 'focus', severity: 5, tier: 3 });

  const chips = prioritize(allInsights, 4);

  return { phase, chips, allInsights, focus: focus.label };
}
