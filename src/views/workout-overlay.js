/**
 * Workout overlay — full-screen workout view with main sets
 * and accessory exercises.
 *
 * Manages session lifecycle: create, resume, render, complete, discard.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { WEIGHT_INCREMENT_KG, WEIGHT_INCREMENT_LBS } from '../constants/thresholds.js';
import { LBS_PER_KG } from '../constants/formulas.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { EXERCISE_CATALOG, MOVEMENT_PATTERNS, PROGRESSION_MODELS } from '../data/exercise-catalog.js';
import { resolveExercise, resolveCanonicalId, getExerciseHistory } from '../data/exercise-compat.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';
import { SUPPLEMENTAL_TIERS } from '../constants/program-tiers.js';
import { formatWeight, displayWeight } from '../formulas/units.js';
import { formatPlates, roundToPlate } from '../formulas/plates.js';
import {
  getProgramWorkout,
  findFirstIncompleteWeek,
  checkAutoProgression,
  applyProgression,
} from '../systems/programs.js';
import {
  selectAccessories,
  selectSmartAccessories,
  computeSetWeights,
  getAccessoryWeight,
  checkAccessoryProgression,
  scoreAccessories,
  getNextTier,
  getWeightForTier,
} from '../systems/workout-builder.js';
import { REP_TIERS } from '../constants/rotation.js';
import {
  generateSessionPlan,
  evaluateSetCompletion,
  gradeSession,
  applyAdjustments,
  applySupplementalAdjustment,
  applyCoachAddition,
} from '../systems/session-optimizer.js';
import { renderCoachingCard, renderSetEvaluationChip, renderSessionGrade } from '../views/session-coach-ui.js';
import { showToast } from '../ui/toast.js';
import { burstMilestoneConfetti } from '../ui/confetti.js';
import { confirmSheet } from '../ui/confirm-sheet.js';
import {
  startTimer,
  ensureAudioContext,
  startExerciseTimer,
  stopExerciseTimer,
  cancelExerciseTimer,
  requestWakeLock,
  releaseWakeLock,
  setWakeLockNeeded,
} from '../ui/timer.js';

// ---------------------------------------------------------------------------
// Progression badge text (category-specific)
// ---------------------------------------------------------------------------

function getProgressionBadgeText(acc) {
  const catalogEx = resolveExercise(acc.exerciseId);
  if (!catalogEx) return 'WEIGHT UP';
  const pType = catalogEx.progressionType;
  const model = PROGRESSION_MODELS[pType];
  if (!model) return 'WEIGHT UP';

  if (pType === 'close-variation') return `${Math.round((catalogEx.pctOfTM[store.workoutSession?.mainLift] || 0.65) * 100)}% TM`;
  if (pType === 'isolation') {
    const inc = store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
    return `+${inc}${store.unit}`;
  }
  if (pType === 'compound') {
    const inc = store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
    return `+${inc}${store.unit}`;
  }
  if (pType === 'bodyweight') {
    // Check current weight context
    const weight = acc.setWeights ? acc.setWeights[0] : 0;
    if (weight < 0) return 'Less assist';
    if (weight === 0) {
      const topReps = catalogEx.repRange ? catalogEx.repRange[1] : 12;
      return `Hit ${topReps}? Add weight`;
    }
    const inc = store.unit === 'kg' ? model.increment.kg : model.increment.lbs;
    return `+${inc}${store.unit}`;
  }
  if (pType === 'time') return `+${model.increment}s`;
  return 'WEIGHT UP';
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

let _deps = {};

/**
 * Inject dependencies to avoid circular imports.
 */
export function setWorkoutOverlayDeps(deps) { Object.assign(_deps, deps); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Exercise picker (inline browser)
// ---------------------------------------------------------------------------

function _renderMusclePills(ex) {
  const muscles = ex.primaryMuscles || {};
  return Object.entries(muscles)
    .filter(([, w]) => w >= 0.20)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([mg]) => `<span class="muscle-pill">${mg}</span>`)
    .join('');
}

function _renderExercisePicker(tab, query) {
  const mainLift = store.workoutSession.mainLift;
  const usedIds = new Set(store.workoutSession.accessories.map(a => a.exerciseId));
  const equip = store.equipmentProfile || {};
  const list = document.getElementById('workout-ex-list');
  if (!list) return;

  let html = '';

  if (tab === 'suggested') {
    // Top 12 scored exercises, grouped by movement pattern
    const scored = scoreAccessories(mainLift)
      .filter(ex => !usedIds.has(ex.id) && ex.equipAvailable !== false);
    const filtered = query
      ? scored.filter(ex => ex.name.toLowerCase().includes(query.toLowerCase()))
      : scored;
    const picks = filtered.slice(0, 12);

    if (picks.length === 0) {
      html = '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:var(--text-sm)">No exercises found</div>';
    } else {
      const groups = {};
      picks.forEach(ex => {
        const p = ex.movementPattern || 'other';
        if (!groups[p]) groups[p] = [];
        groups[p].push(ex);
      });
      for (const [pattern, exercises] of Object.entries(groups)) {
        const info = MOVEMENT_PATTERNS[pattern] || { label: pattern, pushPull: 'neutral' };
        html += `<div class="pattern-group-header">${info.label}</div>`;
        for (const ex of exercises) {
          html += `<div class="exercise-browser-item" data-pick-exercise="${ex.id}">
            <div><div class="exercise-browser-item-name">${ex.name}</div><div class="muscle-pills">${_renderMusclePills(ex)}</div></div>
            <span class="exercise-browser-item-equip">${ex.equipment}</span>
          </div>`;
        }
      }
    }
  } else {
    // Full catalog, grouped by movement pattern, search-filtered
    const groups = {};
    for (const [id, ex] of Object.entries(EXERCISE_CATALOG)) {
      if (query && !ex.name.toLowerCase().includes(query.toLowerCase())) continue;
      const p = ex.movementPattern || 'other';
      if (!groups[p]) groups[p] = [];
      groups[p].push({ id, ...ex });
    }

    if (Object.keys(groups).length === 0) {
      html = '<div style="padding:16px;text-align:center;color:var(--text-dim);font-size:var(--text-sm)">No exercises found</div>';
    } else {
      for (const [pattern, exercises] of Object.entries(groups).sort()) {
        const info = MOVEMENT_PATTERNS[pattern] || { label: pattern, pushPull: 'neutral' };
        html += `<div class="pattern-group-header">${info.label}</div>`;
        for (const ex of exercises) {
          const added = usedIds.has(ex.id);
          const available = equip[ex.equipment] !== false;
          html += `<div class="exercise-browser-item${added ? ' added' : ''}${!available ? ' unavailable' : ''}" data-pick-exercise="${ex.id}">
            <div><div class="exercise-browser-item-name">${ex.name}</div><div class="muscle-pills">${_renderMusclePills(ex)}</div></div>
            <span class="exercise-browser-item-equip">${ex.equipment}</span>
          </div>`;
        }
      }
    }
  }

  list.innerHTML = html;
}

// ---------------------------------------------------------------------------

function getLastMainPerformance(lift) {
  const recent = store.entries.filter(e => e.lift === lift).sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!recent) return null;
  return { weight: recent.weight, reps: recent.reps, e1rm: recent.e1rm, date: recent.date };
}

function getLastAccPerformance(exerciseId) {
  const canonId = resolveCanonicalId(exerciseId);
  const history = getExerciseHistory(canonId, store.accessoryLog);
  const recent = history[0];
  if (!recent) return null;
  return { weight: recent.weight, setWeights: recent.setWeights, setsCompleted: recent.setsCompleted, date: recent.date };
}

function createWorkoutSession(mainLift) {
  const now = new Date();
  const workout = getProgramWorkout(mainLift, findFirstIncompleteWeek(mainLift));

  // Programs that prescribe supplemental volume (BBB, T2, etc.) leave less
  // room for accessories — cut the default accessory count.
  const hasSupplemental = workout
    ? workout.sets.some(s => SUPPLEMENTAL_TIERS.includes(s.tier))
    : false;
  const accCount = hasSupplemental ? 3 : 5;
  const accessories = hasSupplemental ? selectSmartAccessories(mainLift, accCount) : selectAccessories(mainLift);

  const session = {
    id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6),
    mainLift,
    programWeek: findFirstIncompleteWeek(mainLift),
    date: now.toISOString().split('T')[0],
    startTime: now.getTime(),
    mainSets: [],
    // `bbbSets` is the historical field name but holds ALL supplemental tiers
    // (BBB, T2, etc.) — preserved for back-compat with in-flight sessions.
    bbbSets: [],
    accessories: accessories.map(ex => {
      const tier = getNextTier(ex.id);
      const tierInfo = tier ? REP_TIERS[tier] : null;
      const repRange = tierInfo ? tierInfo.repRange : ex.repRange;
      const sets = tierInfo ? tierInfo.sets : (ex.sets || 3);
      const weight = tier ? getWeightForTier(ex.id, tier, mainLift) : getAccessoryWeight(ex.id, mainLift);
      return {
        exerciseId: ex.id,
        name: ex.name,
        setWeights: computeSetWeights(weight, sets),
        targetSets: sets,
        repRange,
        equipment: ex.equipment,
        setsCompleted: [],
        progressed: checkAccessoryProgression(ex.id, mainLift),
        _tier: tier,
      };
    }),
    completed: false
  };
  // Clone program sets if active, peeling all supplemental tiers out of mainSets.
  if (workout) {
    const mainOnly = workout.sets.filter(s => !SUPPLEMENTAL_TIERS.includes(s.tier));
    const suppOnly = workout.sets.filter(s => SUPPLEMENTAL_TIERS.includes(s.tier));
    session.mainSets = mainOnly.map(s => ({
      num: s.num, weight: s.weight, reps: s.reps, pct: s.pct,
      tier: s.tier, day: s.day, completed: s.completed
    }));
    session.bbbSets = suppOnly.map((s, i) => ({
      num: i + 1, weight: s.weight, reps: s.reps, pct: s.pct,
      tier: s.tier,            // preserve original tier ('T2' or 'BBB')
      completed: false
    }));
  }
  store.workoutSession = session;
  store.saveWorkoutSession();

  // Session Optimizer: generate coaching plan. Wrap so an error here never
  // blocks the workout overlay from opening — renderWorkoutView will retry
  // generation and fall back to a visible error card if it fails again.
  store._sessionOptimizer = null;
  try {
    generateSessionPlan(mainLift, session);
  } catch (err) {
    console.error('[coach] generateSessionPlan failed in createWorkoutSession for ' + mainLift + ':', err);
    store._sessionOptimizer = null;
  }

  return session;
}

function updateCompleteButton() {
  const btn = $('workout-complete-btn');
  if (!store.workoutSession) { btn.disabled = true; return; }
  const hasProgress = store.workoutSession.mainSets.some(s => s.completed) ||
    (store.workoutSession.bbbSets && store.workoutSession.bbbSets.some(s => s.completed)) ||
    store.workoutSession.accessories.some(a => a.setsCompleted.length > 0);
  btn.disabled = !hasProgress;
}

// ---------------------------------------------------------------------------
// Complete main set (logs immediately, RPE slider shown after)
// ---------------------------------------------------------------------------

// Track the entry ID of the last completed main set (for RPE slider update)
let _lastMainEntryId = null;

function _completeMainSet(idx) {
  const set = store.workoutSession.mainSets[idx];
  if (!set || set.completed) return;
  const week = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[store.workoutSession.mainLift] || 1);
  const isAmrap = typeof set.reps === 'string' && set.reps.toString().includes('+');
  let repsToLog = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
  if (isAmrap) {
    const amrapInput = document.querySelector(`[data-main-amrap="${idx}"]`);
    if (amrapInput && amrapInput.value) repsToLog = parseInt(amrapInput.value);
  }
  const result = _deps.addEntry?.(store.workoutSession.mainLift, set.weight, repsToLog, null, '', []) ?? null;
  _lastMainEntryId = result ? result.entry.id : null;
  // Track entry for discard rollback
  if (result && result.entry) {
    if (!store.workoutSession.loggedEntryIds) store.workoutSession.loggedEntryIds = [];
    store.workoutSession.loggedEntryIds.push(result.entry.id);
  }
  // Goal milestone celebration — toast + inline confetti per hit milestone
  if (result && result.hitMilestones && result.hitMilestones.length > 0) {
    result.hitMilestones.forEach((ms, i) => {
      setTimeout(() => {
        const isGoal = ms.label === 'Goal';
        const emoji = isGoal ? '\uD83C\uDFC6' : '\uD83C\uDFAF';
        const msg = isGoal
          ? `${emoji} GOAL REACHED! ${LIFT_NAMES[ms.lift]} ${formatWeight(ms.target)} ${store.unit}`
          : `${emoji} ${ms.label}: ${LIFT_NAMES[ms.lift]} ${formatWeight(ms.target)} ${store.unit}`;
        showToast(msg);
        burstMilestoneConfetti(ms.lift);
      }, 500 + i * 1500);
    });
  }
  _deps.updateDashboard?.();
  set.completed = true;
  set.rpe = null;
  set.entryId = _lastMainEntryId;
  store.programConfig.completedSets[`${store.workoutSession.mainLift}-${week}-${idx}`] = true;
  if (isAmrap && repsToLog) {
    store.programConfig.amrapResults[`${store.workoutSession.mainLift}-${week}-${idx}`] = repsToLog;
  }
  const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
  if (tmpl && tmpl.progression && tmpl.progression.type === 'session') {
    const progResult = checkAutoProgression(store.workoutSession.mainLift);
    if (progResult) applyProgression(progResult);
  }
  store.saveProgramConfig();
  store.saveWorkoutSession();
  startTimer(store.timerDuration);
  if (navigator.vibrate) navigator.vibrate(50);
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Re-render the workout overlay body (main sets + accessories).
 */
export function renderWorkoutView() {
  if (!store.workoutSession) return;
  const body = $('workout-body');
  const lift = store.workoutSession.mainLift;
  $('workout-title').textContent = LIFT_NAMES[lift] + ' Workout';
  const weekLabel = store.workoutSession.programWeek ? ` \u2014 Week ${store.workoutSession.programWeek}` : '';
  $('workout-subtitle').textContent = store.workoutSession.date + weekLabel;
  let html = '';

  // Session Optimizer coaching card — ensure the stored plan belongs to this
  // session. If it's missing or belongs to a prior lift, regenerate it in
  // place. On any error we MUST clear the stale plan so a cross-lift plan
  // (e.g. squat notes leaking into a bench workout) can never be rendered.
  let optimizer = store._sessionOptimizer;
  let coachError = null;
  const sessionLift = store.workoutSession.mainLift;
  const stale = !optimizer || !optimizer.plan || optimizer.plan.lift !== sessionLift;
  if (stale) {
    // First, drop the stale plan so nothing from the previous session can
    // fall through the error path. If regen succeeds it overwrites this.
    store._sessionOptimizer = null;
    optimizer = null;
    try {
      generateSessionPlan(sessionLift, store.workoutSession);
      optimizer = store._sessionOptimizer;
    } catch (err) {
      // Capture for both console AND inline display so mobile users can
      // screenshot the error without needing devtools.
      console.error('[coach] generateSessionPlan failed for ' + sessionLift + ':', err);
      coachError = err;
      store._sessionOptimizer = null;
      optimizer = null;
    }
  }
  // Only render if we actually have a plan for the CURRENT lift. Otherwise
  // render a minimal error-state card with the actual error text so the user
  // doesn't need devtools to diagnose the failure.
  if (optimizer && optimizer.plan && optimizer.plan.lift === sessionLift) {
    html += renderCoachingCard(optimizer.plan);
  } else {
    const errMsg = coachError
      ? String(coachError && coachError.message ? coachError.message : coachError)
      : 'Plan was missing after regen — unknown cause';
    const errStack = coachError && coachError.stack
      ? String(coachError.stack).split('\n').slice(0, 4).join('\n')
      : '';
    // Escape angle brackets so the error text doesn't break the HTML
    const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html += `<section class="coach-note coach-note-empty" id="coach-card" data-lift="${sessionLift}">
      <header class="coach-note-head"><span class="coach-note-label">${LIFT_NAMES[sessionLift]} notes</span></header>
      <ul class="coach-note-list">
        <li class="coach-row" data-priority="high">
          <p class="coach-row-text"><strong>Coach error:</strong> ${escape(errMsg)}</p>
        </li>
        ${errStack ? `<li class="coach-row" data-priority="low">
          <p class="coach-row-text" style="font-family:var(--font-mono);font-size:0.65rem;white-space:pre-wrap;word-break:break-all;">${escape(errStack)}</p>
        </li>` : ''}
      </ul>
    </section>`;
  }

  // Main lift section
  html += `<div class="workout-exercise main-lift ${lift}">`;
  html += `<div class="workout-exercise-name">${LIFT_NAMES[lift]}</div>`;
  const lastMain = getLastMainPerformance(lift);
  if (lastMain) {
    html += `<div class="prev-perf">Last: ${formatWeight(lastMain.weight)} ${store.unit} &times; ${lastMain.reps} = ${formatWeight(lastMain.e1rm)} e1RM <span class="prev-perf-date">${lastMain.date}</span></div>`;
  }
  if (store.workoutSession.mainSets.length > 0) {
    html += `<div class="workout-exercise-meta">Program sets \u2014 tap to log</div>`;
    store.workoutSession.mainSets.forEach((s, i) => {
      if (s._dropped) return; // Dropped by session optimizer
      const isAmrap = typeof s.reps === 'string' && s.reps.toString().includes('+');
      const repDisplay = s.reps;
      const plateStr = formatPlates(s.weight);
      const rpeLabel = s.completed && s.rpe ? ` @ RPE ${s.rpe}` : '';
      html += `<div class="workout-set-row${s.completed ? ' completed' : ''}" data-type="main" data-idx="${i}">
        <div class="workout-set-check">${s.completed ? '&#10003;' : ''}</div>
        <div class="workout-set-info">
          Set ${s.num}: ${formatWeight(s.weight)} ${store.unit} &times; ${repDisplay}${rpeLabel}
          ${s.pct ? `<span style="color:var(--text-dim);font-size:var(--text-xs)"> (${s.pct}%)</span>` : ''}
          ${isAmrap ? '<span class="amrap-badge">AMRAP</span>' : ''}
          ${plateStr ? `<div class="plate-display">${plateStr} /side</div>` : ''}
        </div>
        ${isAmrap ? `<input type="number" class="workout-set-input" data-main-amrap="${i}" placeholder="${parseInt(s.reps)}" min="1" inputmode="numeric" ${s.completed ? 'disabled' : ''}>` : ''}
      </div>`;
    });
    html += `<button class="workout-add-set-btn" data-add-main-set>+ Add Set</button>`;
  } else {
    html += `<div class="workout-no-program">No active program. Log your main lift from the Log tab, then come back for accessories.</div>`;
  }
  html += `</div>`;

  // Supplemental section (between main lifts and accessories). Holds T2 or
  // BBB tier sets depending on which program is active.
  if (store.workoutSession.bbbSets && store.workoutSession.bbbSets.length > 0) {
    const suppTier = store.workoutSession.bbbSets[0].tier || 'BBB';
    const suppLabel = suppTier === 'BBB' ? 'Boring But Big' : `Supplemental (${suppTier})`;
    html += `<div class="workout-exercise bbb-section">`;
    html += `<div class="workout-exercise-name" style="color:var(--text-dim)">${suppLabel}</div>`;
    const activeBBB = store.workoutSession.bbbSets.filter(s => !s._dropped);
    html += `<div class="workout-exercise-meta">${activeBBB.length}&times;${store.workoutSession.bbbSets[0].reps} at ${store.workoutSession.bbbSets[0].pct}%</div>`;
    activeBBB.forEach((s, i) => {
      const plateStr = formatPlates(s.weight);
      const origIdx = store.workoutSession.bbbSets.indexOf(s);
      html += `<div class="workout-set-row${s.completed ? ' completed' : ''}" data-type="bbb" data-idx="${origIdx}">
        <div class="workout-set-check">${s.completed ? '&#10003;' : ''}</div>
        <div class="workout-set-info">
          Set ${i + 1}: ${formatWeight(s.weight)} ${store.unit} &times; ${s.reps}
          <span style="color:var(--text-dim);font-size:var(--text-xs)"> (${s.pct}%)</span>
          ${plateStr ? `<div class="plate-display">${plateStr} /side</div>` : ''}
        </div>
      </div>`;
    });
    html += `<button class="workout-add-set-btn" data-add-bbb-set>+ Add Set</button>`;
    html += `</div>`;
  }

  // Accessory sections — #20: group supersets visually
  store.workoutSession.accessories.forEach((acc, ai) => {
    const prevAcc = ai > 0 ? store.workoutSession.accessories[ai - 1] : null;
    const nextAcc = ai < store.workoutSession.accessories.length - 1 ? store.workoutSession.accessories[ai + 1] : null;
    if (acc.groupId && (!prevAcc || prevAcc.groupId !== acc.groupId)) {
      html += `<div class="superset-group"><div class="superset-label">Superset</div>`;
    }
    const ex = ACCESSORY_DB[acc.exerciseId];
    const catalogEx = resolveExercise(acc.exerciseId);
    const isBodyweight = catalogEx ? catalogEx.progressionType === 'bodyweight' : (!ex || ex.pctOfTM === 0);
    const isTimeBased = catalogEx ? !!catalogEx.timeBased : !!(ex && ex.timeBased);
    const targetReps = acc.repRange[1];
    html += `<div class="workout-exercise">`;
    const tierBadge = acc._tier && REP_TIERS[acc._tier]
      ? `<span class="acc-tier-badge ${acc._tier}">${REP_TIERS[acc._tier].label}</span>`
      : '';
    html += `<div class="workout-exercise-name" data-exid="${acc.exerciseId}" data-acc-toggle="${ai}">${acc.name}${tierBadge}${acc.progressed ? `<span class="acc-progression-badge">${getProgressionBadgeText(acc)}</span>` : ''}</div>`;
    html += `<div class="acc-action-bar" id="acc-action-bar-${ai}" style="display:none">
      <button class="acc-swap-btn" data-acc-swap="${ai}">&#8644; Swap</button>
      <button class="acc-remove-btn" data-acc-remove="${ai}">&times; Remove</button>
    </div>`;
    const accLogs = store.accessoryLog.filter(l => l.exerciseId === acc.exerciseId);
    const accLogCount = new Set(accLogs.map(l => l.date)).size;
    const accBestWeight = isBodyweight
      ? accLogs.reduce((best, l) => Math.max(best, l.weight), -Infinity)
      : accLogs.reduce((max, l) => Math.max(max, l.weight), 0);
    const hasBestWeight = accLogs.length > 0 && (isBodyweight || accBestWeight > 0);
    const currentTopWeight = acc.setWeights ? acc.setWeights[acc.setWeights.length - 1] : 0;
    const isNewHigh = hasBestWeight && currentTopWeight > accBestWeight;
    let metaParts = [acc.equipment];
    metaParts.push(`hit ${targetReps}${isTimeBased ? 's' : ' reps'} on all sets to progress`);
    if (accLogCount > 0) metaParts.push(`${accLogCount} session${accLogCount !== 1 ? 's' : ''}`);
    if (hasBestWeight && !isNewHigh) {
      if (isBodyweight) {
        const bestLabel = accBestWeight < 0 ? `Assisted ${formatWeight(Math.abs(accBestWeight))}` : accBestWeight === 0 ? 'BW' : `BW +${formatWeight(accBestWeight)}`;
        metaParts.push(`best: ${bestLabel} ${store.unit}`);
      } else {
        metaParts.push(`best: ${formatWeight(accBestWeight)} ${store.unit}`);
      }
    }
    html += `<div class="workout-exercise-meta">${metaParts.join(' &bull; ')}${isNewHigh ? ' <span class="acc-new-high">New High!</span>' : ''}</div>`;
    const lastAcc = getLastAccPerformance(acc.exerciseId);
    if (lastAcc) {
      let lastWeight;
      if (isBodyweight && lastAcc.weight < 0) {
        lastWeight = `Assisted ${formatWeight(Math.abs(lastAcc.weight))} ${store.unit}`;
      } else if (isBodyweight && lastAcc.weight === 0) {
        lastWeight = 'BW';
      } else if (isBodyweight && lastAcc.weight > 0) {
        lastWeight = `BW +${formatWeight(lastAcc.weight)} ${store.unit}`;
      } else if (lastAcc.weight === 0) {
        lastWeight = 'BW';
      } else if (lastAcc.setWeights && lastAcc.setWeights.length > 1 && new Set(lastAcc.setWeights).size > 1) {
        lastWeight = lastAcc.setWeights.map(w => formatWeight(w)).join('/') + ' ' + store.unit;
      } else {
        lastWeight = formatWeight(lastAcc.weight) + ' ' + store.unit;
      }
      const lastReps = lastAcc.setsCompleted.join('/');
      html += `<div class="prev-perf">Last: ${lastWeight} &times; ${lastReps}${isTimeBased ? 's' : ' reps'} <span class="prev-perf-date">${lastAcc.date}</span></div>`;
    }

    // Set rows with per-set weights
    for (let si = 0; si < acc.targetSets; si++) {
      const done = si < acc.setsCompleted.length;
      const repsVal = done ? acc.setsCompleted[si] : '';
      const repTarget = isTimeBased ? `${targetReps}s` : targetReps;
      let setWeight;
      if (isBodyweight) {
        const w = acc.setWeights ? acc.setWeights[si] : 0;
        if (w < 0) setWeight = `Assisted ${formatWeight(Math.abs(w))} ${store.unit}`;
        else if (w === 0) setWeight = 'BW';
        else setWeight = `BW +${formatWeight(w)} ${store.unit}`;
      } else {
        setWeight = `${formatWeight(acc.setWeights[si])} ${store.unit}`;
      }
      const isCountingDown = isTimeBased && store.exerciseTimer && store.exerciseTimer.accIdx === ai && store.exerciseTimer.setIdx === si;
      html += `<div class="workout-set-row${done ? ' completed' : ''}${isCountingDown ? ' counting-down' : ''}" data-type="acc" data-acc="${ai}" data-set="${si}"${isTimeBased ? ' data-time-based="true"' : ''}>
        <div class="workout-set-check">${done ? '&#10003;' : ''}</div>
        <div class="workout-set-info">
          Set ${si + 1}: ${isTimeBased
            ? (isBodyweight
              ? (done ? repsVal + 's' : repTarget)
              : (acc.setWeights[si] > 0
                ? `${setWeight} &times; ${done ? repsVal + 's' : repTarget}`
                : (done ? repsVal + 's' : repTarget)))
            : `${setWeight} &times; ${done ? repsVal : repTarget}${done ? ' reps' : ''}`}
        </div>
        ${!done && isTimeBased ? (isCountingDown
          ? `<div class="exercise-countdown">
              <span class="exercise-countdown-display" id="exercise-cd-${ai}-${si}">${store.exerciseTimer.remaining}s</span>
              <button class="exercise-countdown-cancel">&times;</button>
            </div>`
          : `${acc.setWeights[si] > 0 ? `<div class="acc-set-weight-controls">
              <button class="acc-set-weight-btn" data-acc="${ai}" data-set="${si}" data-dir="-1">&minus;wt</button>
              <button class="acc-set-weight-btn" data-acc="${ai}" data-set="${si}" data-dir="1">+wt</button>
            </div>` : ''}
            <button class="exercise-start-btn">&#9201; Start</button>
            <div class="acc-set-weight-controls">
              <button class="acc-time-adj-btn" data-acc="${ai}" data-dir="-1">&minus;s</button>
              <button class="acc-time-adj-btn" data-acc="${ai}" data-dir="1">+s</button>
            </div>`)
        : ''}
        ${!done && !isTimeBased ? `<div class="acc-set-weight-controls">
          <button class="acc-set-weight-btn" data-acc="${ai}" data-set="${si}" data-dir="-1">&minus;</button>
          <button class="acc-set-weight-btn" data-acc="${ai}" data-set="${si}" data-dir="1">+</button>
        </div>` : ''}
        ${!done && !isTimeBased ? `<input type="number" class="workout-set-input" data-acc-input="${ai}-${si}" placeholder="${targetReps}" min="1" inputmode="numeric">` : ''}
      </div>`;
    }
    html += `<button class="workout-add-set-btn small" data-add-acc-set="${ai}">+ Set</button>`;
    html += `</div>`;
    // #20: Close superset group container
    if (acc.groupId && (!nextAcc || nextAcc.groupId !== acc.groupId)) {
      html += `</div>`;
    }
  });

  // Add Exercise button
  html += `<button class="workout-add-exercise-btn" id="workout-add-exercise">+ Add Exercise</button>`;
  html += `<div id="workout-exercise-picker" class="workout-ex-picker" style="display:none">
    <input type="text" class="exercise-browser-search" placeholder="Search exercises..." id="workout-ex-search">
    <div class="browser-tabs">
      <button class="browser-tab active" data-wk-tab="suggested">Suggested</button>
      <button class="browser-tab" data-wk-tab="all">All Exercises</button>
    </div>
    <div class="workout-exercise-picker-list" id="workout-ex-list"></div>
  </div>`;

  body.innerHTML = html;
  updateCompleteButton();
}

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

/**
 * Open the workout overlay — resume or create a session.
 * @param {string} mainLift - 'squat' | 'bench' | 'deadlift'
 */
export async function openWorkoutView(mainLift) {
  // Check if weak points configured
  if (!store.workoutConfig.weakPoints[mainLift]) {
    _deps.showWeakPointSetupModal?.(mainLift);
    return;
  }
  // Resume or create session
  if (store.workoutSession && store.workoutSession.mainLift === mainLift && !store.workoutSession.completed) {
    // Sync main set completion state
    const sessionWeek = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[mainLift] || 1);
    if (store.workoutSession.mainSets.length > 0) {
      store.workoutSession.mainSets.forEach((s, i) => {
        s.completed = !!store.programConfig.completedSets[`${mainLift}-${sessionWeek}-${i}`];
      });
    }
    // Migrate old-format sessions
    store.workoutSession.accessories.forEach(acc => {
      if (acc.weight !== undefined && !acc.setWeights) {
        acc.setWeights = computeSetWeights(acc.weight, acc.targetSets);
        delete acc.weight;
      }
    });
  } else {
    // Warn if there's an in-progress session for a different lift
    if (store.workoutSession && !store.workoutSession.completed && store.workoutSession.mainLift !== mainLift) {
      const hasProgress = store.workoutSession.mainSets.some(s => s.completed) ||
        store.workoutSession.accessories.some(a => a.setsCompleted.length > 0);
      if (hasProgress) {
        const ok = await confirmSheet({
          title: `Switch to ${LIFT_NAMES[mainLift]}?`,
          body: `Your in-progress ${LIFT_NAMES[store.workoutSession.mainLift]} workout will be discarded.`,
          confirmLabel: `Discard & start ${LIFT_NAMES[mainLift]}`,
          cancelLabel: `Keep ${LIFT_NAMES[store.workoutSession.mainLift]}`,
          tone: 'danger',
        });
        if (!ok) return;
        // User confirmed switch — drop prior plan before rebuild so no stale
        // optimizer state is reachable between discard and createWorkoutSession.
        store._sessionOptimizer = null;
      }
    }
    createWorkoutSession(mainLift);
  }
  $('workout-overlay').style.display = 'flex';
  $('workout-overlay').dataset.lift = mainLift;
  document.body.style.overflow = 'hidden';
  // Keep the screen on for the duration of the workout
  setWakeLockNeeded(true);
  requestWakeLock();
  renderWorkoutView();
}

/**
 * Close the workout overlay.
 */
export function closeWorkoutView() {
  stopExerciseTimer();
  setWakeLockNeeded(false);
  releaseWakeLock();
  $('workout-overlay').style.display = 'none';
  document.body.style.overflow = '';
  _deps.updateWorkoutButton?.();
}

// ---------------------------------------------------------------------------
// Complete workout
// ---------------------------------------------------------------------------

/**
 * Complete the current workout session — log accessories,
 * record mesocycle performance, and show summary.
 */
export function completeWorkout() {
  if (!store.workoutSession) return;
  const now = new Date();
  // Update the session date to completion time, not creation time. The user
  // may have opened the workout the night before and trained the next day.
  store.workoutSession.date = now.toISOString().split('T')[0];
  // Save each accessory's results to log
  // #18: Track source and template in accessory log
  const sessionSource = store.workoutSession.source || 'quick';
  const sessionTemplateId = store.workoutSession.templateId || null;
  store.workoutSession.accessories.forEach(acc => {
    if (acc.setsCompleted.length === 0) return;
    store.accessoryLog.push({
      id: now.getTime().toString(36) + Math.random().toString(36).slice(2, 6) + acc.exerciseId,
      exerciseId: acc.exerciseId,
      name: acc.name,
      weight: acc.setWeights[acc.setWeights.length - 1],
      setWeights: [...acc.setWeights],
      setsCompleted: [...acc.setsCompleted],
      targetSets: acc.targetSets,
      repRange: [...acc.repRange],
      date: store.workoutSession.date,
      timestamp: now.getTime(),
      mainLift: store.workoutSession.mainLift,
      source: sessionSource,
      templateId: sessionTemplateId,
    });
  });
  store.saveNow('accessoryLog');

  // #16: Offer weight updates back to template
  if (sessionTemplateId) {
    const template = store.customTemplates.find(t => t.id === sessionTemplateId);
    if (template) {
      const changed = store.workoutSession.accessories.filter(acc => {
        const tmplEx = template.exercises.find(e => e.exerciseId === acc.exerciseId);
        return tmplEx && tmplEx.weightMode === 'manual' && acc.setWeights
          && Math.abs(tmplEx.weightValue - acc.setWeights[acc.setWeights.length - 1]) > 0.1;
      });
      if (changed.length > 0) {
        setTimeout(() => {
          showToast(`${changed.length} weight${changed.length > 1 ? 's' : ''} changed`, {
            action: 'Update Template', onAction: () => {
              changed.forEach(acc => {
                const tmplEx = template.exercises.find(e => e.exerciseId === acc.exerciseId);
                if (tmplEx) tmplEx.weightValue = acc.setWeights[acc.setWeights.length - 1];
              });
              store.saveCustomTemplates();
              showToast('Template weights updated');
            }, duration: 8000,
          });
        }, 2000);
      }
    }
  }

  // Mesocycle performance recording & adaptation
  let mesoAdaptation = null;
  const completedSession = store.workoutSession;
  if (store.workoutSession.source === 'mesocycle' && store.activeMesocycle && store.activeMesocycle.status === 'active') {
    _deps.recordMesocyclePerformance?.(store.workoutSession);
    mesoAdaptation = _deps.adaptRemainingWeeks?.(store.workoutSession.mainLift) ?? null;
  }

  // Session Optimizer: grade the session
  const sessionGrade = gradeSession(completedSession);

  store.workoutSession = null;
  store._sessionOptimizer = null; // Clear ephemeral optimizer state
  store.saveWorkoutSession();
  closeWorkoutView();
  showToast('Workout complete!');
  if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  _deps.updateWorkoutButton?.();
  setTimeout(() => {
    _deps.showWorkoutSummary?.(completedSession, mesoAdaptation, sessionGrade);
  }, 300);
}

// ---------------------------------------------------------------------------
// Update workout button
// ---------------------------------------------------------------------------

/**
 * Update the "Start/Resume Workout" button text based on session state.
 */
export function updateWorkoutButton() {
  const btn = $('create-workout-btn');
  if (!btn) return;
  if (store.workoutSession && !store.workoutSession.completed && store.workoutSession.mainLift === store.currentLift) {
    btn.textContent = `Resume ${LIFT_NAMES[store.currentLift]} Workout`;
    btn.classList.add('has-session');
  } else if (store.activeMesocycle && store.activeMesocycle.status === 'active') {
    const week = store.activeMesocycle.weeks[store.activeMesocycle.currentWeek - 1];
    const liftDone = week && week.performance[store.currentLift];
    btn.textContent = liftDone ? `${LIFT_NAMES[store.currentLift]} - Week ${store.activeMesocycle.currentWeek} Done` : `Start ${LIFT_NAMES[store.currentLift]} Workout`;
    btn.classList.remove('has-session');
  } else {
    btn.textContent = `Start ${LIFT_NAMES[store.currentLift]} Workout`;
    btn.classList.remove('has-session');
  }
}

// ---------------------------------------------------------------------------
// Init — delegation (attached once)
// ---------------------------------------------------------------------------

/**
 * Attach event delegation for the workout overlay.
 * Call once after DOMContentLoaded.
 */
export function initWorkoutOverlay() {
  const body = $('workout-body');

  // Exercise picker search — debounced input filter
  let _searchTimer = null;
  body.addEventListener('input', (e) => {
    if (e.target.id === 'workout-ex-search') {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        const activeTab = document.querySelector('[data-wk-tab].active');
        const tab = activeTab ? activeTab.dataset.wkTab : 'suggested';
        _renderExercisePicker(tab, e.target.value);
      }, 150);
    }
  });

  body.addEventListener('click', (e) => {
    if (!store.workoutSession) return;

    // Session Optimizer: coaching card toggle
    if (e.target.closest('[data-coach-toggle]')) {
      const card = document.getElementById('coach-card');
      if (card) card.classList.toggle('collapsed');
      return;
    }
    // Session Optimizer: Apply mid-session adjustment
    if (e.target.closest('[data-coach-apply]')) {
      const evalIdx = parseInt(e.target.closest('[data-coach-apply]').dataset.coachApply);
      const optimizer = store._sessionOptimizer;
      if (optimizer && optimizer.evaluations) {
        const evaluation = optimizer.evaluations.find(ev => ev.setIndex === evalIdx);
        if (evaluation) {
          applyAdjustments(evaluation);
          renderWorkoutView();
          showToast('Adjustments applied');
        }
      }
      return;
    }
    // Session Optimizer: Accept pre-session supplemental (BBB/T2) reduction
    if (e.target.closest('[data-coach-accept-supp]')) {
      const optimizer = store._sessionOptimizer;
      const plan = optimizer && optimizer.plan;
      if (plan && plan.supplementalAdjustment && !plan.supplementalAdjustment._accepted) {
        applySupplementalAdjustment(plan.supplementalAdjustment);
        plan.supplementalAdjustment._accepted = true;
        // Mark the corresponding insight row so the re-render shows it as applied
        (plan.insights || []).forEach(ins => {
          if (ins.type === 'volume') ins._accepted = true;
        });
        renderWorkoutView();
      }
      return;
    }
    // Session Optimizer: Accept pre-session coach addition (add exercise)
    const acceptSwapBtn = e.target.closest('[data-coach-accept-swap]');
    if (acceptSwapBtn) {
      const idx = parseInt(acceptSwapBtn.dataset.coachAcceptSwap, 10);
      const optimizer = store._sessionOptimizer;
      const plan = optimizer && optimizer.plan;
      if (plan && Array.isArray(plan.accessorySwaps) && plan.accessorySwaps[idx]) {
        const swap = plan.accessorySwaps[idx];
        if (!swap._accepted) {
          const result = applyCoachAddition(swap);
          swap._accepted = true;
          (plan.insights || []).forEach(ins => {
            if (ins.type === 'gap' && ins.swapIndex === idx) ins._accepted = true;
          });
          renderWorkoutView();
          if (result === 'added') {
            showToast(`${swap.suggestedName} added`);
          } else if (result === 'already-present') {
            showToast('Already in your workout');
          }
        }
      }
      return;
    }
    // Session Optimizer: Dismiss coaching chip
    if (e.target.closest('[data-coach-dismiss]')) {
      const chip = e.target.closest('.coach-chip');
      if (chip) chip.remove();
      return;
    }

    // Prevent set-input clicks from toggling the row
    if (e.target.closest('.workout-set-input')) return;

    // Toggle accessory action bar (swap/remove)
    const accNameEl = e.target.closest('[data-acc-toggle]');
    if (accNameEl) {
      const ai = accNameEl.dataset.accToggle;
      const bar = $('acc-action-bar-' + ai);
      if (bar) {
        // Close any other open action bars and alternatives
        body.querySelectorAll('.acc-action-bar').forEach(b => {
          if (b.id !== 'acc-action-bar-' + ai) b.style.display = 'none';
        });
        body.querySelectorAll('.acc-swap-alternatives').forEach(el => el.remove());
        bar.style.display = bar.style.display === 'none' ? '' : 'none';
      }
      return;
    }

    // Remove accessory — soft-commit with undo toast (no confirm dialog)
    const removeBtn = e.target.closest('.acc-remove-btn');
    if (removeBtn) {
      e.stopPropagation();
      const ai = parseInt(removeBtn.dataset.accRemove);
      const acc = store.workoutSession.accessories[ai];
      if (!acc) return;
      // Snapshot for undo (deep clone the accessory object)
      const snapshot = JSON.parse(JSON.stringify(acc));
      // Cancel/adjust timer BEFORE splicing to avoid race condition
      if (store.exerciseTimer) {
        if (store.exerciseTimer.accIdx === ai) {
          stopExerciseTimer();
        } else if (store.exerciseTimer.accIdx > ai) {
          store.exerciseTimer.accIdx--;
        }
      }
      store.workoutSession.accessories.splice(ai, 1);
      store.saveWorkoutSession();
      renderWorkoutView();
      showToast(`${acc.name} removed`, {
        action: 'Undo',
        duration: 6000,
        onAction: () => {
          if (!store.workoutSession) return;
          const insertAt = Math.min(ai, store.workoutSession.accessories.length);
          store.workoutSession.accessories.splice(insertAt, 0, snapshot);
          store.saveWorkoutSession();
          renderWorkoutView();
        },
      });
      return;
    }

    // Swap accessory — show alternatives
    const swapBtn = e.target.closest('.acc-swap-btn');
    if (swapBtn) {
      e.stopPropagation();
      const ai = parseInt(swapBtn.dataset.accSwap);
      const acc = store.workoutSession.accessories[ai];
      const ex = ACCESSORY_DB[acc.exerciseId];
      const container = swapBtn.closest('.workout-exercise');
      // Toggle off if already showing
      const existing = container.querySelector('.acc-swap-alternatives');
      if (existing) { existing.remove(); return; }
      // Get alternatives excluding current equipment
      const allScored = scoreAccessories(store.workoutSession.mainLift, ex ? ex.equipment : null);
      const usedIds = new Set(store.workoutSession.accessories.map(a => a.exerciseId));
      const alternatives = allScored.filter(a => !usedIds.has(a.id)).slice(0, 5);
      if (alternatives.length === 0) {
        showToast('No alternatives available');
        return;
      }
      const altDiv = document.createElement('div');
      altDiv.className = 'acc-swap-alternatives';
      alternatives.forEach(alt => {
        const item = document.createElement('div');
        item.className = 'acc-swap-alt-item';
        const lastPerf = getLastAccPerformance(alt.id);
        const estWeight = getAccessoryWeight(alt.id, store.workoutSession.mainLift);
        let perfHtml;
        if (lastPerf) {
          const w = lastPerf.weight === 0 ? 'BW' : formatWeight(lastPerf.weight) + ' ' + store.unit;
          const reps = lastPerf.setsCompleted.join('/');
          const perfDate = new Date(lastPerf.date + 'T12:00:00');
          const todayMid = new Date(); todayMid.setHours(0,0,0,0);
          const perfMid = new Date(perfDate.getFullYear(), perfDate.getMonth(), perfDate.getDate());
          const days = Math.round((todayMid - perfMid) / 86400000);
          const ago = days === 0 ? 'today' : days === 1 ? 'yesterday' : days + 'd ago';
          perfHtml = `<span class="acc-swap-alt-perf">${w} &times; ${reps} &bull; ${ago}</span>`;
        } else {
          perfHtml = estWeight > 0
            ? `<span class="acc-swap-alt-perf">No history &mdash; est. ${formatWeight(estWeight)} ${store.unit}</span>`
            : `<span class="acc-swap-alt-perf">No history</span>`;
        }
        item.innerHTML = `<div><span>${alt.name}</span><span class="acc-swap-alt-meta">${alt.equipment}</span></div><div>${perfHtml}</div>`;
        item.addEventListener('click', () => {
          const newWeight = getAccessoryWeight(alt.id, store.workoutSession.mainLift);
          const newSetWeights = computeSetWeights(newWeight, alt.sets);
          const progressed = checkAccessoryProgression(alt.id, store.workoutSession.mainLift);
          store.workoutSession.accessories[ai] = {
            exerciseId: alt.id,
            name: alt.name,
            setWeights: newSetWeights,
            targetSets: alt.sets,
            repRange: [...alt.repRange],
            equipment: alt.equipment,
            setsCompleted: [],
            progressed: !!progressed,
          };
          store.saveWorkoutSession();
          renderWorkoutView();
          showToast(`Swapped to ${alt.name}`);
        });
        altDiv.appendChild(item);
      });
      container.appendChild(altDiv);
      return;
    }

    // Per-set weight +/- buttons
    const weightBtn = e.target.closest('.acc-set-weight-btn');
    if (weightBtn) {
      e.stopPropagation();
      const ai = parseInt(weightBtn.dataset.acc);
      const si = parseInt(weightBtn.dataset.set);
      const dir = parseInt(weightBtn.dataset.dir);
      const acc = store.workoutSession.accessories[ai];
      const increment = store.unit === 'kg' ? WEIGHT_INCREMENT_KG * LBS_PER_KG : WEIGHT_INCREMENT_LBS;
      const accCatalogEx = resolveExercise(acc.exerciseId);
      const isBWExercise = accCatalogEx ? accCatalogEx.progressionType === 'bodyweight' : false;
      const newWeight = acc.setWeights[si] + dir * increment;
      acc.setWeights[si] = isBWExercise ? roundToPlate(newWeight) : roundToPlate(Math.max(0, newWeight));
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Time-based +/- buttons
    const timeBtn = e.target.closest('.acc-time-adj-btn');
    if (timeBtn) {
      e.stopPropagation();
      const ai = parseInt(timeBtn.dataset.acc);
      const dir = parseInt(timeBtn.dataset.dir);
      const acc = store.workoutSession.accessories[ai];
      acc.repRange[1] = Math.max(5, acc.repRange[1] + dir * 5);
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Add Set — Main lift
    if (e.target.closest('[data-add-main-set]')) {
      const sets = store.workoutSession.mainSets;
      if (sets.length > 0) {
        const last = sets[sets.length - 1];
        sets.push({ ...last, num: sets.length + 1, completed: false });
        store.saveWorkoutSession();
        renderWorkoutView();
      }
      return;
    }

    // Add Set — BBB
    if (e.target.closest('[data-add-bbb-set]')) {
      const sets = store.workoutSession.bbbSets;
      if (sets && sets.length > 0) {
        const last = sets[sets.length - 1];
        sets.push({ ...last, num: sets.length + 1, completed: false });
        store.saveWorkoutSession();
        renderWorkoutView();
      }
      return;
    }

    // Add Set — Accessory
    const addAccSetBtn = e.target.closest('[data-add-acc-set]');
    if (addAccSetBtn) {
      const ai = parseInt(addAccSetBtn.dataset.addAccSet);
      const acc = store.workoutSession.accessories[ai];
      acc.targetSets += 1;
      const lastWeight = acc.setWeights[acc.setWeights.length - 1] || 0;
      acc.setWeights.push(lastWeight);
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Add Exercise — toggle the full exercise browser
    if (e.target.closest('#workout-add-exercise')) {
      const picker = document.getElementById('workout-exercise-picker');
      if (picker.style.display !== 'none') {
        picker.style.display = 'none';
        return;
      }
      _renderExercisePicker('suggested', '');
      picker.style.display = '';
      // Focus the search input for immediate typing
      const searchInput = document.getElementById('workout-ex-search');
      if (searchInput) setTimeout(() => searchInput.focus(), 50);
      return;
    }

    // Exercise picker — tab switching
    const tabBtn = e.target.closest('[data-wk-tab]');
    if (tabBtn) {
      const tab = tabBtn.dataset.wkTab;
      document.querySelectorAll('[data-wk-tab]').forEach(b => b.classList.toggle('active', b.dataset.wkTab === tab));
      const query = (document.getElementById('workout-ex-search') || {}).value || '';
      _renderExercisePicker(tab, query);
      return;
    }

    // Pick exercise from picker
    const pickEx = e.target.closest('[data-pick-exercise]');
    if (pickEx) {
      const exId = pickEx.dataset.pickExercise;
      const mainLift = store.workoutSession.mainLift;
      const catalogEx = EXERCISE_CATALOG[exId];
      if (!catalogEx) return;
      // Already in session? Skip.
      if (store.workoutSession.accessories.some(a => a.exerciseId === exId)) {
        showToast('Already in your workout');
        return;
      }
      // Apply tier rotation (same as createWorkoutSession)
      const tier = getNextTier(exId);
      const tierInfo = tier ? REP_TIERS[tier] : null;
      const repRange = tierInfo ? tierInfo.repRange : (catalogEx.repRange ? [...catalogEx.repRange] : [8, 12]);
      const sets = tierInfo ? tierInfo.sets : (catalogEx.sets || 3);
      const weight = tier ? getWeightForTier(exId, tier, mainLift) : getAccessoryWeight(exId, mainLift);
      store.workoutSession.accessories.push({
        exerciseId: exId,
        name: catalogEx.name,
        setWeights: computeSetWeights(weight, sets),
        targetSets: sets,
        repRange,
        equipment: catalogEx.equipment,
        setsCompleted: [],
        progressed: !!checkAccessoryProgression(exId, mainLift),
        _tier: tier,
      });
      store.saveWorkoutSession();
      renderWorkoutView();
      showToast(`Added ${catalogEx.name}`);
      return;
    }

    // RPE slider input (update entry RPE in real-time)
    if (e.target.classList.contains('rpe-slider')) return; // handled by input event below

    // Main set row clicks
    const mainRow = e.target.closest('.workout-set-row[data-type="main"]');
    if (mainRow) {
      const idx = parseInt(mainRow.dataset.idx);
      const set = store.workoutSession.mainSets[idx];
      const week = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[store.workoutSession.mainLift] || 1);
      if (set.completed) {
        set.completed = false;
        delete set.rpe;
        delete set.entryId;
        delete store.programConfig.completedSets[`${store.workoutSession.mainLift}-${week}-${idx}`];
        delete store.programConfig.amrapResults[`${store.workoutSession.mainLift}-${week}-${idx}`];
        store.saveProgramConfig();
        store.saveWorkoutSession();
        renderWorkoutView();
        _deps.renderProgramSection?.();
      } else {
        // Log immediately, then show RPE slider
        _completeMainSet(idx);
        // Remove any existing slider
        const existing = document.querySelector('.workout-rpe-row');
        if (existing) existing.remove();
        // Re-render to show completed state
        renderWorkoutView();
        _deps.renderProgramSection?.();
        // Insert slider after the now-completed row
        const completedRow = document.querySelector(`.workout-set-row[data-type="main"][data-idx="${idx}"]`);
        if (completedRow) {
          const rpeRow = document.createElement('div');
          rpeRow.className = 'workout-rpe-row';
          rpeRow.dataset.idx = idx;
          rpeRow.innerHTML = `<span class="rpe-row-label">1</span>` +
            `<input type="range" class="rpe-slider" min="1" max="10" step="1" value="8">` +
            `<span class="rpe-row-label">10</span>` +
            `<span class="rpe-slider-value">8</span>`;
          completedRow.after(rpeRow);
          // Attach slider input event
          const slider = rpeRow.querySelector('.rpe-slider');
          const valueDisplay = rpeRow.querySelector('.rpe-slider-value');
          slider.addEventListener('input', () => {
            const rpeVal = parseInt(slider.value);
            valueDisplay.textContent = rpeVal;
            // Update the entry's RPE
            set.rpe = rpeVal;
            if (set.entryId) {
              const entry = store.entries.find(e => e.id === set.entryId);
              if (entry) { entry.rpe = rpeVal; store.saveEntries(); }
            }
            store.saveWorkoutSession();
            // Update the set row display
            const infoEl = completedRow.querySelector('.workout-set-info');
            if (infoEl) {
              infoEl.innerHTML = infoEl.innerHTML.replace(/ @ RPE \d+/g, '').replace(/(×\s*\d+)/,  `$1 @ RPE ${rpeVal}`);
            }
          });
          // Session Optimizer: evaluate after RPE is set (debounced on change)
          slider.addEventListener('change', () => {
            const rpeVal = parseInt(slider.value);
            const reps = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
            const evaluation = evaluateSetCompletion(idx, rpeVal, reps, set.weight);
            if (evaluation && evaluation.drift !== 'on-track') {
              // Remove any existing chip for this set
              const existingChip = document.querySelector(`.coach-chip[data-eval-idx="${idx}"]`);
              if (existingChip) existingChip.remove();
              // Insert coaching chip after RPE row
              const chipHtml = renderSetEvaluationChip(evaluation);
              if (chipHtml) {
                const chipContainer = document.createElement('div');
                chipContainer.innerHTML = chipHtml;
                rpeRow.after(chipContainer.firstElementChild);
              }
            }
          });
        }
      }
      return;
    }

    // BBB supplemental set row clicks
    const bbbRow = e.target.closest('.workout-set-row[data-type="bbb"]');
    if (bbbRow) {
      const idx = parseInt(bbbRow.dataset.idx);
      const set = store.workoutSession.bbbSets[idx];
      if (set.completed) {
        set.completed = false;
      } else {
        set.completed = true;
        // Log as an entry for volume tracking
        const reps = typeof set.reps === 'string' ? parseInt(set.reps) : set.reps;
        const bbbResult = _deps.addEntry?.(store.workoutSession.mainLift, set.weight, reps, null, '', ['BBB']) ?? null;
        if (bbbResult && bbbResult.entry) {
          if (!store.workoutSession.loggedEntryIds) store.workoutSession.loggedEntryIds = [];
          store.workoutSession.loggedEntryIds.push(bbbResult.entry.id);
        }
        _deps.updateDashboard?.();
        startTimer(store.timerDuration);
        if (navigator.vibrate) navigator.vibrate(50);
      }
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }

    // Accessory set row clicks
    const accRow = e.target.closest('.workout-set-row[data-type="acc"]');
    if (accRow) {
      const ai = parseInt(accRow.dataset.acc);
      const si = parseInt(accRow.dataset.set);
      const acc = store.workoutSession.accessories[ai];
      const ex = ACCESSORY_DB[acc.exerciseId];
      const isTimeBased = !!(ex && ex.timeBased);

      if (e.target.closest('.exercise-countdown-cancel')) {
        e.stopPropagation();
        cancelExerciseTimer();
        return;
      }

      if (e.target.closest('.exercise-start-btn')) {
        e.stopPropagation();
        ensureAudioContext();
        if (si === acc.setsCompleted.length) {
          startExerciseTimer(ai, si);
        }
        return;
      }

      if (isTimeBased && si >= acc.setsCompleted.length) return;

      if (si < acc.setsCompleted.length) {
        if (si === acc.setsCompleted.length - 1) {
          acc.setsCompleted.pop();
        }
      } else if (si === acc.setsCompleted.length) {
        const input = accRow.querySelector('.workout-set-input');
        const reps = input && input.value ? parseInt(input.value) : acc.repRange[1];
        acc.setsCompleted.push(reps);
        startTimer(store.timerDuration);
        if (navigator.vibrate) navigator.vibrate(50);
      }
      store.saveWorkoutSession();
      renderWorkoutView();
      return;
    }
  });

  // Complete & discard buttons
  $('workout-complete-btn').addEventListener('click', completeWorkout);
  $('workout-close').addEventListener('click', closeWorkoutView);
  $('workout-discard-btn').addEventListener('click', async () => {
    // Describe what will be lost so the user can decide with full info
    const session = store.workoutSession;
    let summary = 'Nothing logged yet.';
    if (session) {
      const mainDone = session.mainSets.filter(s => s.completed).length;
      const bbbDone = (session.bbbSets || []).filter(s => s.completed).length;
      const accDone = session.accessories.reduce((n, a) => n + a.setsCompleted.length, 0);
      const total = mainDone + bbbDone + accDone;
      if (total > 0) {
        const parts = [];
        if (mainDone) parts.push(`${mainDone} main set${mainDone > 1 ? 's' : ''}`);
        if (bbbDone) parts.push(`${bbbDone} BBB set${bbbDone > 1 ? 's' : ''}`);
        if (accDone) parts.push(`${accDone} accessory set${accDone > 1 ? 's' : ''}`);
        summary = `${parts.join(', ')} will be removed from your history.`;
      }
    }
    const ok = await confirmSheet({
      title: 'Discard this workout?',
      body: summary,
      confirmLabel: 'Discard workout',
      cancelLabel: 'Keep going',
      tone: 'danger',
    });
    if (!ok) return;
    stopExerciseTimer();
    // Remove any entries logged during this session
    if (store.workoutSession && store.workoutSession.loggedEntryIds) {
      const idsToRemove = new Set(store.workoutSession.loggedEntryIds);
      store.entries = store.entries.filter(e => !idsToRemove.has(e.id));
      store.prs = store.prs.filter(p => !idsToRemove.has(p.entryId));
      store.saveEntries();
      store.savePRs();
    }
    // Undo any completed set flags in program config
    if (store.workoutSession && store.workoutSession.mainSets) {
      const lift = store.workoutSession.mainLift;
      const week = store.workoutSession.programWeek || (store.programConfig.liftWeeks?.[lift] || 1);
      store.workoutSession.mainSets.forEach((s, i) => {
        if (s.completed) {
          delete store.programConfig.completedSets[`${lift}-${week}-${i}`];
          delete store.programConfig.amrapResults[`${lift}-${week}-${i}`];
        }
      });
      store.saveProgramConfig();
    }
    store.workoutSession = null;
    store._sessionOptimizer = null; // keep lifecycle symmetric with completeWorkout
    store.saveWorkoutSession();
    closeWorkoutView();
    _deps.updateDashboard?.();
    showToast('Workout discarded');
  });
}
