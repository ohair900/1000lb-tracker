/**
 * Workout summary sheet — shown after completing a workout.
 *
 * Displays duration, completion stats, main lift sets, accessory details,
 * and mesocycle adaptation information.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFT_NAMES } from '../constants/lift-config.js';
import { formatWeight } from '../formulas/units.js';
import { ACCESSORY_DB } from '../data/accessories.js';
import { renderSessionGrade } from './session-coach-ui.js';

// ---------------------------------------------------------------------------
// Show workout summary
// ---------------------------------------------------------------------------

/**
 * Show the post-workout summary sheet.
 *
 * @param {Object} session - The completed workout session
 * @param {Object|null} mesoAdaptation - Mesocycle adaptation result, if any
 */
export function showWorkoutSummary(session, mesoAdaptation, sessionGrade) {
  const duration = Date.now() - session.startTime;
  const mins = Math.floor(duration / 60000);
  const secs = Math.floor((duration % 60000) / 1000);
  const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  // Main lift sets
  const mainCompleted = session.mainSets.filter(s => s.completed).length;
  const mainTotal = session.mainSets.length;
  const mainReps = session.mainSets.filter(s => s.completed).reduce((sum, s) => sum + (s.reps || 0), 0);

  // Accessory stats
  const accCompleted = session.accessories.reduce((sum, a) => sum + a.setsCompleted.length, 0);
  const accTotal = session.accessories.reduce((sum, a) => sum + a.targetSets, 0);

  const totalCompleted = mainCompleted + accCompleted;
  const totalSets = mainTotal + accTotal;
  const completionPct = totalSets > 0 ? Math.round((totalCompleted / totalSets) * 100) : 0;
  const completionColor = completionPct >= 80 ? 'var(--green)' : completionPct >= 50 ? 'var(--yellow)' : 'var(--red)';

  let html = '';

  // Session Optimizer grade
  if (sessionGrade) {
    html += renderSessionGrade(sessionGrade);
  }

  // Stat grid
  html += '<div class="summary-stat-grid">';
  html += `<div class="summary-stat"><div class="summary-stat-label">Duration</div><div class="summary-stat-value">${durationStr}</div></div>`;
  html += `<div class="summary-stat"><div class="summary-stat-label">Completion</div><div class="summary-stat-value" style="color:${completionColor}">${completionPct}%</div></div>`;
  html += `<div class="summary-stat"><div class="summary-stat-label">Main Sets</div><div class="summary-stat-value">${mainCompleted}/${mainTotal}</div></div>`;
  html += `<div class="summary-stat"><div class="summary-stat-label">Acc. Sets</div><div class="summary-stat-value">${accCompleted}/${accTotal}</div></div>`;
  html += '</div>';

  // Completion bar
  html += `<div class="summary-completion-bar"><div class="fill" style="width:${completionPct}%;background:${completionColor}"></div></div>`;

  // Main lift sets detail
  if (mainTotal > 0) {
    html += `<div class="section-label-lg" style="margin:12px 0 6px">${LIFT_NAMES[session.mainLift] || session.mainLift} Sets</div>`;
    session.mainSets.forEach(s => {
      const cls = s.completed ? 'completed' : 'missed';
      const status = s.completed ? '\u2713' : '\u2717';
      const pctLabel = s.pct ? ` (${s.pct}%)` : '';
      html += `<div class="summary-set-row ${cls}">
        <span>Set ${s.num}: ${s.weight}${store.unit} \u00d7 ${s.reps}${pctLabel}</span>
        <span style="font-weight:700;color:${s.completed ? 'var(--green)' : 'var(--red)'}">${status}</span>
      </div>`;
    });
  }

  // Accessories detail
  if (session.accessories.length > 0) {
    html += '<div class="section-label-lg" style="margin:12px 0 6px">Accessories</div>';
    session.accessories.forEach(acc => {
      const done = acc.setsCompleted.length;
      const target = acc.targetSets;
      let weightStr = '';
      if (acc.setWeights && acc.setWeights.some(w => w > 0)) {
        const uniqueWeights = new Set(acc.setWeights);
        weightStr = uniqueWeights.size > 1
          ? acc.setWeights.slice(0, done || target).map(w => formatWeight(w)).join('/') + ' ' + store.unit
          : formatWeight(acc.setWeights[0]) + ' ' + store.unit;
        weightStr += ' \u00b7 ';
      }
      const ex = ACCESSORY_DB[acc.exerciseId];
      const isTimeBased = !!(ex && ex.timeBased);
      const repDetail = done > 0 ? acc.setsCompleted.join('/') + (isTimeBased ? 's' : ' reps') : 'skipped';
      const color = done >= target ? 'var(--green)' : done > 0 ? 'var(--yellow)' : 'var(--text-dim)';
      html += `<div class="summary-acc-row">
        <span class="summary-acc-name">${acc.name}</span>
        <span class="summary-acc-detail" style="color:${color}">${weightStr}${done}/${target} sets \u00b7 ${repDetail}</span>
      </div>`;
    });
  }

  // Mesocycle data
  if (session.source === 'mesocycle') {
    const meso = store.activeMesocycle || (store.mesocycleHistory.length ? store.mesocycleHistory[store.mesocycleHistory.length - 1] : null);
    if (meso) {
      const weekIdx = (session.mesocycleWeek || 1) - 1;
      const week = meso.weeks[weekIdx];
      const perf = week ? week.performance[session.mainLift] : null;
      if (week && perf) {
        html += '<div class="section-label-lg" style="margin:12px 0 6px">Mesocycle</div>';
        html += `<div class="summary-set-row ${perf.actualRPE <= week.targetRPE ? 'completed' : 'missed'}">
          <span>RPE Target / Actual</span><span style="font-weight:700">${week.targetRPE} / ${perf.actualRPE}</span>
        </div>`;
        html += `<div class="summary-set-row completed"><span>Total Reps</span><span style="font-weight:700">${perf.totalReps}</span></div>`;
        if (mesoAdaptation) {
          html += `<div class="summary-set-row completed">
            <span>Adaptation</span>
            <span style="font-weight:700;color:var(--gold)">${mesoAdaptation.type === 'increase' ? '+' : ''}${mesoAdaptation.pctChange}% intensity</span>
          </div>`;
        } else {
          html += `<div class="summary-set-row completed"><span>Adaptation</span><span style="font-weight:700;color:var(--green)">No change needed</span></div>`;
        }
        // Next week preview
        if (meso.status === 'active' && meso.currentWeek <= meso.durationWeeks) {
          const nextWeek = meso.weeks[meso.currentWeek - 1];
          if (nextWeek) {
            html += `<div style="margin-top:8px;font-size:var(--text-xs);color:var(--text-dim)">Next: ${nextWeek.label} (${nextWeek.phase}) \u00b7 RPE ${nextWeek.targetRPE}</div>`;
          }
        }
      }
    }
  }

  $('workout-summary-title').textContent = `${LIFT_NAMES[session.mainLift] || session.mainLift} Workout Summary`;
  $('workout-summary-body').innerHTML = html;
  $('workout-summary-backdrop').style.display = 'block';
  $('workout-summary-sheet').style.display = 'block';
  document.body.style.overflow = 'hidden';
}
