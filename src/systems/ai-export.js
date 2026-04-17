/**
 * AI Coaching Export — builds structured prompts with training data
 * for sharing to external AI apps via native share sheet.
 */

import store from '../state/store.js';
import { LIFTS, LIFT_NAMES, LIFT_SHORT } from '../constants/lift-config.js';
import { MS_PER_DAY } from '../constants/time.js';
import { bestE1RM, getTotal } from '../formulas/e1rm.js';
import { displayWeight, formatWeight } from '../formulas/units.js';
import { calcWilks, calcDOTS } from '../formulas/scoring.js';
import { getClassification, getOverallClassification } from '../formulas/standards.js';
import { calcFatigueByMuscle } from '../systems/fatigue.js';
import { MUSCLE_GROUPS, MAIN_LIFT_WEIGHTS } from '../data/muscle-groups.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { resolveExercise } from '../data/exercise-compat.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bestE1RMAsOf(lift, beforeTimestamp) {
  const vals = store.entries
    .filter(e => e.lift === lift && e.timestamp <= beforeTimestamp && e.e1rm > 0)
    .map(e => e.e1rm);
  return vals.length > 0 ? Math.max(...vals) : 0;
}

// ---------------------------------------------------------------------------
// Athlete profile block
// ---------------------------------------------------------------------------

function buildAthleteProfile() {
  const bw = store.profile.bodyweight;
  const unit = store.unit;
  const overall = getOverallClassification() || 'Unknown';
  const total = getTotal();
  const wilks = bw ? calcWilks(total, bw, store.profile.gender || 'male') : null;
  const dots = bw ? calcDOTS(total, bw, store.profile.gender || 'male') : null;

  // Training age estimate
  const sorted = [...store.entries].sort((a, b) => a.timestamp - b.timestamp);
  const firstDate = sorted.length > 0 ? sorted[0].date : null;
  const trainingAge = firstDate
    ? Math.round((Date.now() - new Date(firstDate + 'T12:00:00').getTime()) / (MS_PER_DAY * 30)) + ' months of tracked data'
    : 'Unknown';

  // Training frequency
  const last30 = store.entries.filter(e => (Date.now() - e.timestamp) <= 30 * MS_PER_DAY);
  const daysPerWeek = last30.length > 0
    ? (new Set(last30.map(e => e.date)).size / 4.3).toFixed(1)
    : '?';

  // Bodyweight trend
  const bwHist = (store.profile.bodyweightHistory || []).slice().sort((a, b) => a.timestamp - b.timestamp);
  let bwTrend = 'Unknown';
  if (bwHist.length >= 2) {
    const recent = bwHist[bwHist.length - 1].weight;
    const older = bwHist[Math.max(0, bwHist.length - 5)].weight;
    const diff = recent - older;
    bwTrend = Math.abs(diff) < 2 ? 'Maintaining' : diff > 0 ? 'Gaining' : 'Cutting';
  }

  // Weak points
  const wp = store.workoutConfig?.weakPoints || {};

  let text = `=== ATHLETE PROFILE ===\n`;
  text += `Gender: ${store.profile.gender || 'Male'}\n`;
  text += `Bodyweight: ${bw ? formatWeight(bw) + ' ' + unit : 'Not set'} (Trend: ${bwTrend})\n`;
  text += `Classification: ${overall}\n`;
  text += `Training history: ${trainingAge}\n`;
  text += `Training frequency: ~${daysPerWeek} days/week (last 30 days)\n`;
  text += `Active program: ${store.programConfig?.activeProgram || 'None'}\n`;

  text += `\n=== CURRENT MAXES (e1RM) ===\n`;
  LIFTS.forEach(l => {
    const best = bestE1RM(l);
    const cls = best ? (getClassification(l, best) || '') : '';
    text += `${LIFT_NAMES[l]}: ${best ? Math.round(displayWeight(best)) + ' ' + unit : 'No data'} ${cls ? '(' + cls + ')' : ''}\n`;
  });
  text += `Total: ${total ? Math.round(displayWeight(total)) + ' ' + unit : 'No data'}\n`;
  if (wilks) text += `Wilks: ${Math.round(wilks)} | DOTS: ${Math.round(dots)}\n`;

  if (store.goals && Object.values(store.goals).some(v => v > 0)) {
    text += `\n=== GOALS ===\n`;
    LIFTS.forEach(l => {
      if (store.goals[l]) text += `${LIFT_NAMES[l]}: ${Math.round(displayWeight(store.goals[l]))} ${unit}\n`;
    });
    if (store.goals.total) text += `Total: ${Math.round(displayWeight(store.goals.total))} ${unit}\n`;
  }

  if (wp.squat || wp.bench || wp.deadlift) {
    text += `\n=== KNOWN WEAK POINTS ===\n`;
    LIFTS.forEach(l => { if (wp[l]) text += `${LIFT_NAMES[l]}: ${wp[l]}\n`; });
  }

  return text;
}

// ---------------------------------------------------------------------------
// Session log
// ---------------------------------------------------------------------------

function resolveAccName(exerciseId) {
  const catalogEx = resolveExercise(exerciseId);
  if (catalogEx) return catalogEx.name;
  const legacyEx = ACCESSORY_DB[exerciseId];
  if (legacyEx) return legacyEx.name;
  return exerciseId;
}

function buildSessionLog(startDate, endDate) {
  const startMs = new Date(startDate + 'T00:00:00').getTime();
  const endMs = new Date(endDate + 'T23:59:59').getTime();
  const entries = store.entries.filter(e => e.timestamp >= startMs && e.timestamp <= endMs)
    .sort((a, b) => a.timestamp - b.timestamp);
  const accLogs = store.accessoryLog.filter(l => l.timestamp >= startMs && l.timestamp <= endMs)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (entries.length === 0 && accLogs.length === 0) return '\nNo sessions logged in this period.\n';

  // Group main entries by date
  const mainByDate = {};
  entries.forEach(e => {
    if (!mainByDate[e.date]) mainByDate[e.date] = [];
    mainByDate[e.date].push(e);
  });

  // Group accessories by date
  const accByDate = {};
  accLogs.forEach(l => {
    const date = l.date || new Date(l.timestamp).toISOString().split('T')[0];
    if (!accByDate[date]) accByDate[date] = [];
    accByDate[date].push(l);
  });

  // Merge all dates
  const allDates = [...new Set([...Object.keys(mainByDate), ...Object.keys(accByDate)])].sort();

  let text = '';
  for (const date of allDates) {
    const d = new Date(date + 'T12:00:00');
    const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    text += `\n--- ${label} ---\n`;

    // Main lifts
    const mainSets = mainByDate[date] || [];
    mainSets.forEach(e => {
      const best = bestE1RMAsOf(e.lift, e.timestamp);
      const pctE1rm = best > 0 ? Math.round(e.weight / best * 100) : null;
      let line = `  ${LIFT_NAMES[e.lift]}: ${Math.round(displayWeight(e.weight))} x ${e.reps}`;
      if (e.rpe) line += ` @ RPE ${e.rpe}`;
      if (pctE1rm) line += ` (${pctE1rm}% of e1RM)`;
      if (e.isPR) line += ' ★ PR';
      text += line + '\n';
    });

    // Accessories
    const dayAcc = accByDate[date] || [];
    if (dayAcc.length > 0) {
      text += `  Accessories:\n`;
      dayAcc.forEach(l => {
        const name = resolveAccName(l.exerciseId);
        const unit = store.unit;
        const reps = l.setsCompleted || [];
        if (reps.length === 0) return;
        // Format weight
        const catalogEx = resolveExercise(l.exerciseId);
        const isBW = catalogEx && catalogEx.progressionType === 'bodyweight';
        let weightStr;
        if (isBW) {
          const w = l.weight || 0;
          weightStr = w < 0 ? `Assisted ${Math.round(displayWeight(Math.abs(w)))}${unit}` : w === 0 ? 'BW' : `BW+${Math.round(displayWeight(w))}${unit}`;
        } else {
          weightStr = `${Math.round(displayWeight(l.weight || 0))} ${unit}`;
        }
        text += `    ${name}: ${weightStr} x ${reps.join(', ')}\n`;
      });
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// Coverage block
// ---------------------------------------------------------------------------

function buildCoverageBlock(startDate, endDate) {
  const startMs = new Date(startDate + 'T00:00:00').getTime();
  const endMs = new Date(endDate + 'T23:59:59').getTime();
  const entries = store.entries.filter(e => e.timestamp >= startMs && e.timestamp <= endMs);

  const muscleSets = {};
  MUSCLE_GROUPS.forEach(mg => { muscleSets[mg] = 0; });
  entries.forEach(e => {
    const weights = MAIN_LIFT_WEIGHTS[e.lift];
    if (!weights) return;
    MUSCLE_GROUPS.forEach(mg => { if (weights[mg] >= 0.15) muscleSets[mg] += 1; });
  });

  let text = `\n=== MUSCLE COVERAGE ===\n`;
  MUSCLE_GROUPS.forEach(mg => {
    const sets = Math.round(muscleSets[mg]);
    text += `${mg}: ${sets} sets\n`;
  });
  return text;
}

// ---------------------------------------------------------------------------
// Fatigue block
// ---------------------------------------------------------------------------

function buildFatigueBlock() {
  const fatigue = calcFatigueByMuscle();
  if (!fatigue) return '\n=== FATIGUE STATUS ===\nInsufficient data for fatigue analysis.\n';

  let text = `\n=== FATIGUE STATUS ===\n`;
  MUSCLE_GROUPS.forEach(mg => {
    const f = fatigue[mg];
    if (!f) return;
    text += `${mg}: ${f.displayLabel} recovered (ACWR: ${f.acwr ? f.acwr.toFixed(2) : '—'})\n`;
  });
  return text;
}

// ---------------------------------------------------------------------------
// Intensity & rep range distributions
// ---------------------------------------------------------------------------

function buildIntensityDistribution(entries) {
  const zones = { '<70%': 0, '70-80%': 0, '80-85%': 0, '85-90%': 0, '90%+': 0 };
  const rpeGroups = { '6-7': 0, '7-8': 0, '8-9': 0, '9+': 0, 'none': 0 };

  entries.forEach(e => {
    const best = bestE1RMAsOf(e.lift, e.timestamp);
    if (best > 0) {
      const pct = e.weight / best;
      if (pct >= 0.90) zones['90%+']++;
      else if (pct >= 0.85) zones['85-90%']++;
      else if (pct >= 0.80) zones['80-85%']++;
      else if (pct >= 0.70) zones['70-80%']++;
      else zones['<70%']++;
    }
    if (e.rpe) {
      if (e.rpe >= 9) rpeGroups['9+']++;
      else if (e.rpe >= 8) rpeGroups['8-9']++;
      else if (e.rpe >= 7) rpeGroups['7-8']++;
      else rpeGroups['6-7']++;
    } else { rpeGroups['none']++; }
  });

  let text = `\n=== INTENSITY DISTRIBUTION ===\n`;
  for (const [zone, count] of Object.entries(zones)) text += `${zone} of e1RM: ${count} sets\n`;
  text += `\nRPE Distribution:\n`;
  for (const [group, count] of Object.entries(rpeGroups)) text += `RPE ${group}: ${count} sets\n`;
  return text;
}

function buildRepRangeDistribution(entries) {
  const ranges = { 'Singles (1-2)': 0, 'Strength (3-5)': 0, 'Volume (6-8)': 0, 'Hypertrophy (8+)': 0 };
  entries.forEach(e => {
    if (e.reps <= 2) ranges['Singles (1-2)']++;
    else if (e.reps <= 5) ranges['Strength (3-5)']++;
    else if (e.reps <= 8) ranges['Volume (6-8)']++;
    else ranges['Hypertrophy (8+)']++;
  });
  let text = `\n=== REP RANGE DISTRIBUTION ===\n`;
  const total = entries.length || 1;
  for (const [range, count] of Object.entries(ranges)) {
    text += `${range}: ${count} sets (${Math.round(count / total * 100)}%)\n`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Monthly aggregates (for 90-day program check)
// ---------------------------------------------------------------------------

function buildMonthlyAggregates(startDate, endDate) {
  const startMs = new Date(startDate + 'T00:00:00').getTime();
  const endMs = new Date(endDate + 'T23:59:59').getTime();
  const span = endMs - startMs;
  const monthMs = span / 3;

  let text = '';
  for (let i = 0; i < 3; i++) {
    const mStart = startMs + i * monthMs;
    const mEnd = startMs + (i + 1) * monthMs;
    const entries = store.entries.filter(e => e.timestamp >= mStart && e.timestamp < mEnd);
    const days = new Set(entries.map(e => e.date)).size;
    const weeks = Math.max(1, (mEnd - mStart) / (7 * MS_PER_DAY));

    const d1 = new Date(mStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const d2 = new Date(mEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    text += `\n--- Block ${i + 1} (${d1} - ${d2}) ---\n`;
    text += `Training days: ${days} (${(days / weeks).toFixed(1)}/week)\n`;
    LIFTS.forEach(l => {
      const liftEntries = entries.filter(e => e.lift === l);
      const blockBest = bestE1RMAsOf(l, mEnd);
      const avgInt = liftEntries.length > 0 && blockBest > 0
        ? Math.round(liftEntries.reduce((s, e) => s + e.weight / blockBest, 0) / liftEntries.length * 100)
        : 0;
      text += `${LIFT_SHORT[l]}: ${liftEntries.length} sets, avg intensity ${avgInt}%\n`;
    });
    const prs = entries.filter(e => e.isPR).length;
    if (prs > 0) text += `PRs: ${prs}\n`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function getDateRange(daysBack) {
  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - daysBack * MS_PER_DAY).toISOString().split('T')[0];
  return { start, end };
}

export function buildWeeklyReviewPrompt(notes = '') {
  const { start, end } = getDateRange(7);
  const entries = store.entries.filter(e => e.date >= start && e.date <= end);

  let prompt = `You are an experienced powerlifting coach specializing in novice-to-intermediate raw lifters. You use RPE-based autoregulation and evidence-based volume landmarks. Review one week of training and give specific, actionable feedback.\n\n`;
  prompt += buildAthleteProfile();
  prompt += `\n=== THIS WEEK'S SESSIONS ===`;
  prompt += buildSessionLog(start, end);
  prompt += buildCoverageBlock(start, end);
  prompt += buildIntensityDistribution(entries);
  prompt += buildFatigueBlock();

  if (notes) prompt += `\n=== ATHLETE NOTES ===\n${notes}\n`;

  prompt += `\n=== INSTRUCTIONS ===
Evaluate volume adequacy per muscle group, intensity distribution, RPE management, training frequency, push:pull balance, and recovery indicators.

=== RESPONSE FORMAT ===
**What Went Well** (2-4 bullets — be specific, reference actual numbers)
**What Needs Work** (2-4 bullets — identify the ROOT issue, not just symptoms)
**This Week's Focus** (2-3 bullets — the single most impactful change to make)

=== GUARDRAILS ===
- Do not comment on the data format, structure, or quality. Treat all provided data as accurate and complete. Focus entirely on coaching.
- Do not suggest increasing weekly volume by more than 10-20% in a single week.
- Do not recommend intensity above 90% of e1RM for more than 1-2 sets per lift per week at this level.
- If ACWR for any muscle group is elevated, recommend reducing volume for that group.
- Assume no injuries unless the athlete's notes mention pain.
- Do not recommend a complete program overhaul based on one week of data.
- Keep recommendations practical for a commercial gym.`;

  return prompt;
}

export function buildProgramCheckPrompt(notes = '') {
  const { start, end } = getDateRange(90);
  const entries = store.entries.filter(e => e.date >= start && e.date <= end);

  let prompt = `You are an experienced powerlifting coach reviewing a 90-day training block for a raw powerlifter. Evaluate long-term programming effectiveness and recommend specific adjustments.\n\n`;
  prompt += buildAthleteProfile();

  // E1RM progression
  prompt += `\n=== E1RM PROGRESSION (Last 90 Days) ===\n`;
  LIFTS.forEach(l => {
    const liftEntries = entries.filter(e => e.lift === l).sort((a, b) => a.timestamp - b.timestamp);
    if (liftEntries.length < 2) { prompt += `${LIFT_NAMES[l]}: Insufficient data\n`; return; }
    const firstTs = liftEntries[0].timestamp;
    const lastTs = liftEntries[liftEntries.length - 1].timestamp;
    const weekMs = 7 * MS_PER_DAY;
    const earlyEnd = Math.min(firstTs + weekMs, lastTs);
    const lateStart = Math.max(lastTs - weekMs, firstTs);
    const firstBest = Math.max(...liftEntries.filter(e => e.timestamp <= earlyEnd).map(e => e.e1rm));
    const lastBest = Math.max(...liftEntries.filter(e => e.timestamp >= lateStart).map(e => e.e1rm));
    const change = lastBest - firstBest;
    const daySpan = (lastTs - firstTs) / MS_PER_DAY;
    const rate = daySpan > 0 ? (change / (daySpan / 30)).toFixed(1) : '?';
    prompt += `${LIFT_NAMES[l]}: ${Math.round(displayWeight(firstBest))} → ${Math.round(displayWeight(lastBest))} (${change > 0 ? '+' : ''}${Math.round(displayWeight(change))} ${store.unit}) | Rate: ${rate} ${store.unit}/month\n`;
  });

  prompt += buildMonthlyAggregates(start, end);
  prompt += buildRepRangeDistribution(entries);
  prompt += buildIntensityDistribution(entries);

  // Strength ratios
  const sq = bestE1RM('squat'), bp = bestE1RM('bench'), dl = bestE1RM('deadlift');
  if (sq && bp && dl) {
    prompt += `\n=== STRENGTH RATIOS ===\n`;
    prompt += `Squat:Bench = ${(sq / bp).toFixed(2)}:1\n`;
    prompt += `Squat:Deadlift = ${(sq / dl).toFixed(2)}:1\n`;
    prompt += `Bench:Deadlift = ${(bp / dl).toFixed(2)}:1\n`;
  }

  if (notes) prompt += `\n=== ATHLETE NOTES ===\n${notes}\n`;

  prompt += `\n=== INSTRUCTIONS ===
Analyze this 90-day block. Evaluate: progression rate vs classification level, volume progression trends, intensity management, frequency per lift, exercise selection, strength balance, periodization structure, and red flags (stagnant maxes, missing rep ranges, junk volume, overreaching).

=== RESPONSE FORMAT ===
**90-Day Summary** (3-4 sentences — trajectory, biggest win, biggest concern)
**Lift-by-Lift Assessment** (Squat, Bench, Deadlift — 2-3 sentences each)
**Programming Adjustments** (3-5 specific, numbered changes to current approach)
**Next 4-Week Focus** (priorities for next training block)
**Goal Projection** (estimated timeline to reach stated goals at current rate)

=== GUARDRAILS ===
- Do not comment on the data format, structure, or quality. Treat all provided data as accurate and complete. Focus entirely on coaching.
- Default to adjusting the current program, not replacing it.
- Do not recommend more than 15-20% volume increase per mesocycle.
- If the lifter has not deloaded in 6+ weeks and fatigue is elevated, recommend a deload first.
- If e1RM trend is clearly upward, do not recommend major changes.
- Frame suggestions within the athlete's ${store.unit} system and training schedule.`;

  return prompt;
}

export function buildLiftDeepDivePrompt(lift, notes = '') {
  const { start, end } = getDateRange(90);
  const entries = store.entries.filter(e => e.lift === lift && e.date >= start && e.date <= end)
    .sort((a, b) => a.timestamp - b.timestamp);

  let prompt = `You are an experienced powerlifting coach doing a deep technical and programming analysis of the ${LIFT_NAMES[lift]}. You understand biomechanics, common weak points, and accessory transfer.\n\n`;
  prompt += buildAthleteProfile();

  const currentBest = bestE1RM(lift);
  const cls = currentBest ? (getClassification(lift, currentBest) || '') : '';
  prompt += `\n=== ${LIFT_NAMES[lift].toUpperCase()} DATA — LAST 90 DAYS ===\n`;
  prompt += `Current e1RM: ${currentBest ? Math.round(displayWeight(currentBest)) + ' ' + store.unit : 'No data'} ${cls ? '(' + cls + ')' : ''}\n`;

  if (entries.length >= 2) {
    const firstTs = entries[0].timestamp;
    const lastTs = entries[entries.length - 1].timestamp;
    const weekMs = 7 * MS_PER_DAY;
    const earlyEnd = Math.min(firstTs + weekMs, lastTs);
    const lateStart = Math.max(lastTs - weekMs, firstTs);
    const startBest = Math.max(...entries.filter(e => e.timestamp <= earlyEnd).map(e => e.e1rm));
    const endBest = Math.max(...entries.filter(e => e.timestamp >= lateStart).map(e => e.e1rm));
    prompt += `90-day starting e1RM: ${Math.round(displayWeight(startBest))} ${store.unit}\n`;
    prompt += `Current e1RM: ${Math.round(displayWeight(endBest))} ${store.unit}\n`;
    prompt += `Change: ${endBest - startBest > 0 ? '+' : ''}${Math.round(displayWeight(endBest - startBest))} ${store.unit}\n`;
  }

  // Best sets
  const topSets = [...entries].sort((a, b) => b.e1rm - a.e1rm).slice(0, 5);
  if (topSets.length > 0) {
    prompt += `\nBest sets (top 5 by e1RM):\n`;
    topSets.forEach(e => {
      prompt += `  ${e.date}: ${Math.round(displayWeight(e.weight))} x ${e.reps}${e.rpe ? ' @ RPE ' + e.rpe : ''} = ${Math.round(displayWeight(e.e1rm))} e1RM${e.isPR ? ' ★ PR' : ''}\n`;
    });
  }

  // Full session log for this lift
  prompt += `\n=== SESSION LOG ===\n`;
  const byDate = {};
  entries.forEach(e => { if (!byDate[e.date]) byDate[e.date] = []; byDate[e.date].push(e); });
  for (const [date, sets] of Object.entries(byDate)) {
    const d = new Date(date + 'T12:00:00');
    prompt += `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: `;
    prompt += sets.map(e => {
      let s = `${Math.round(displayWeight(e.weight))}x${e.reps}`;
      if (e.rpe) s += `@${e.rpe}`;
      return s;
    }).join(', ') + '\n';
  }

  prompt += buildRepRangeDistribution(entries);
  prompt += buildIntensityDistribution(entries);

  // Frequency & volume
  const weeks = Math.max(1, 90 / 7);
  const sessionsPerWeek = new Set(entries.map(e => e.date)).size / weeks;
  prompt += `\n=== FREQUENCY & VOLUME ===\n`;
  prompt += `Sessions per week (avg): ${sessionsPerWeek.toFixed(1)}\n`;
  prompt += `Sets per session (avg): ${entries.length > 0 ? (entries.length / new Set(entries.map(e => e.date)).size).toFixed(1) : '0'}\n`;
  prompt += `Total sets (90 days): ${entries.length}\n`;

  // Strength context
  const sq = bestE1RM('squat'), bp = bestE1RM('bench'), dl = bestE1RM('deadlift');
  if (sq && bp && dl) {
    prompt += `\n=== STRENGTH CONTEXT ===\n`;
    prompt += `Squat: ${Math.round(displayWeight(sq))} | Bench: ${Math.round(displayWeight(bp))} | Deadlift: ${Math.round(displayWeight(dl))}\n`;
  }

  // Related accessories
  const liftAccessories = store.accessoryLog.filter(l => {
    const ts = l.timestamp;
    return ts >= new Date(start + 'T00:00:00').getTime() && ts <= new Date(end + 'T23:59:59').getTime();
  });
  if (liftAccessories.length > 0) {
    const accCounts = {};
    liftAccessories.forEach(l => {
      const name = resolveAccName(l.exerciseId);
      accCounts[name] = (accCounts[name] || 0) + 1;
    });
    const topAcc = Object.entries(accCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (topAcc.length > 0) {
      prompt += `\n=== ACCESSORY WORK (90 days) ===\n`;
      topAcc.forEach(([name, count]) => { prompt += `${name}: ${count} sessions\n`; });
    }
  }

  if (notes) prompt += `\n=== ATHLETE NOTES ===\n${notes}\n`;

  prompt += `\n=== INSTRUCTIONS ===
Perform a complete analysis of this lift:
1. PROGRESSION: Is the e1RM trend healthy for this classification level? Characterize the pattern.
2. VOLUME & FREQUENCY: Enough weekly sets for this level?
3. INTENSITY DISTRIBUTION: Training across sufficient range? Flag if >50% in one zone.
4. REP RANGE: Sufficient variety? Flag if only doing sets of 5 or never doing singles.
5. WEAK POINTS: Infer from data patterns and stated weak points.
6. ACCESSORY EVALUATION: Are current accessories well-targeted?

=== RESPONSE FORMAT ===
**Lift Health Score** (one line summary)
**Progression Analysis** (3-4 sentences)
**Identified Weak Points** (bulleted with reasoning)
**Recommended Accessory Program** (3-5 exercises with sets x reps, frequency, and WHY)
**Programming Adjustments** (2-3 specific changes to main lift training)

=== GUARDRAILS ===
- Do not comment on the data format, structure, or quality. Treat all provided data as accurate and complete. Focus entirely on coaching.
- Max 5 accessory recommendations, standard gym equipment.
- If e1RM trend is positive, reinforce what's working.
- All prescriptions appropriate for ${cls || 'intermediate'}-level lifter.
- For deadlift: do not recommend >2x/week competition deadlift.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

export async function shareCoachingPrompt(text, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled
    }
  }
  // Fallback: clipboard
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied! Paste into your AI app for coaching');
  } catch {
    showToast('Could not share or copy');
  }
}
