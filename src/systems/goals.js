/**
 * Goal projection and milestone roadmap system.
 *
 * - calcGoalProjection(lift) — project timeline to reach a lift goal
 * - calcMilestoneRoadmap(lift) — break the path to a goal into 4 milestones
 */

import store from '../state/store.js';
import { MS_PER_DAY } from '../constants/time.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { PROGRAM_TEMPLATES } from '../data/programs.js';

/**
 * Project how long it will take to reach a goal for a given lift.
 *
 * Uses program-based projection if an active program with a progression
 * template is set, otherwise falls back to historical e1RM progression rate.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {Object|null} Projection data, or null if no projection is possible.
 *   Fields vary by projection type:
 *     Program-based: currentE1RM, goal, gap, program, weeksNeeded, estDate, tmProgression
 *     Historical:    currentE1RM, goal, gap, program (null), weeksNeeded, estDate, ratePerWeek
 */
export function calcGoalProjection(lift) {
  if (lift === 'total') return null;

  const goal = store.goals[lift];
  const cur = bestE1RM(lift);
  if (!goal || !cur || cur >= goal) return null;
  const gap = goal - cur;

  // Program-based projection
  if (store.programConfig.activeProgram) {
    const tmpl = PROGRAM_TEMPLATES[store.programConfig.activeProgram];
    if (tmpl && tmpl.progression) {
      const prog = tmpl.progression;
      const increment = (lift === 'bench') ? prog.upperIncrement : prog.lowerIncrement;
      const cycleWeeks = prog.cycleWeeks;
      const cyclesNeeded = Math.ceil(gap / increment);
      const weeksNeeded = cyclesNeeded * cycleWeeks;
      const estDate = new Date();
      estDate.setDate(estDate.getDate() + weeksNeeded * 7);

      // Build per-cycle TM progression
      const tmProgression = [];
      let tmVal = store.programConfig.trainingMaxes[lift] || cur * 0.9;
      for (let i = 0; i < Math.min(cyclesNeeded, 20); i++) {
        tmVal += increment;
        const d = new Date();
        d.setDate(d.getDate() + (i + 1) * cycleWeeks * 7);
        tmProgression.push({ tm: tmVal, date: d });
      }

      return { currentE1RM: cur, goal, gap, program: tmpl.name, weeksNeeded, estDate, tmProgression };
    }
  }

  // Fallback: historical e1RM progression rate
  const liftEntries = store.entries
    .filter(e => e.lift === lift)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (liftEntries.length < 2) return null;

  const first = liftEntries[0];
  const last = liftEntries[liftEntries.length - 1];
  const daySpan = (last.timestamp - first.timestamp) / MS_PER_DAY;
  if (daySpan < 14) return null;

  const e1rmFirst = first.e1rm;
  const e1rmLast = last.e1rm;
  const ratePerWeek = (e1rmLast - e1rmFirst) / (daySpan / 7);
  if (ratePerWeek <= 0) return null;

  const weeksNeeded = Math.ceil(gap / ratePerWeek);
  const estDate = new Date();
  estDate.setDate(estDate.getDate() + weeksNeeded * 7);

  return { currentE1RM: cur, goal, gap, program: null, weeksNeeded, estDate, ratePerWeek };
}

/**
 * Build a 4-milestone roadmap from the current e1RM to the goal.
 *
 * Milestones 1-3 are evenly spaced between current and goal (rounded to
 * nearest 5 lbs).  Milestone 4 is the goal itself.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {Object|null} Roadmap with `lift`, `milestones` array, and `projection`.
 */
export function calcMilestoneRoadmap(lift) {
  const proj = calcGoalProjection(lift);
  if (!proj) return null;

  const cur = proj.currentE1RM;
  const goal = proj.goal;
  const gap = proj.gap;
  const milestones = [];

  // Break into 4 milestones
  for (let i = 1; i <= 4; i++) {
    let target;
    if (i === 4) {
      target = goal;
    } else {
      target = Math.round((cur + gap * (i / 4)) / 5) * 5;
    }
    const pctOfGap = (target - cur) / gap;
    const weeksAway = Math.round(proj.weeksNeeded * pctOfGap);
    const estDate = new Date();
    estDate.setDate(estDate.getDate() + weeksAway * 7);
    milestones.push({
      target,
      label: i === 4 ? 'Goal' : `Milestone ${i}`,
      weeksAway,
      estDate,
      achieved: cur >= target,
    });
  }

  return { lift, milestones, projection: proj };
}
