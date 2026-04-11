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
 * Lock in a 4-milestone set for a lift based on the current e1RM and goal.
 * Called when a goal is first set or changed. Always regenerates all 4 milestones
 * — previously achieved ones are NOT preserved (per user preference).
 *
 * Milestones 1-3 are evenly spaced between current and goal (rounded to
 * nearest 5 lbs). Milestone 4 is the goal itself.
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 */
export function lockMilestones(lift) {
  if (lift === 'total') return;
  if (!store.goalMilestones) store.goalMilestones = { squat: null, bench: null, deadlift: null };

  const goal = store.goals[lift];
  if (!goal) {
    store.goalMilestones[lift] = null;
    store.saveGoalMilestones();
    return;
  }
  const cur = bestE1RM(lift);
  if (!cur || cur >= goal) {
    // No point creating milestones if user already at/past goal or has no data
    store.goalMilestones[lift] = null;
    store.saveGoalMilestones();
    return;
  }

  const gap = goal - cur;
  const milestones = [];
  for (let i = 1; i <= 4; i++) {
    const target = i === 4 ? goal : Math.round((cur + gap * (i / 4)) / 5) * 5;
    milestones.push({
      target,
      label: i === 4 ? 'Goal' : `Milestone ${i}`,
      achievedAt: null,
      achievedEntryId: null,
    });
  }
  store.goalMilestones[lift] = {
    goal,
    startE1RM: cur,
    createdAt: Date.now(),
    milestones,
  };
  store.saveGoalMilestones();
}

/**
 * Check if a new e1RM crosses any previously-unachieved milestones for a lift.
 * Marks newly-achieved milestones with timestamp + entry ID and returns them
 * so the caller can trigger celebration (toast + confetti).
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @param {number} newE1RM - The e1RM from the just-logged entry
 * @param {string} entryId - The entry ID that triggered this check
 * @returns {Array} Newly-achieved milestone objects (with lift field added)
 */
export function checkMilestonesAchieved(lift, newE1RM, entryId) {
  if (lift === 'total') return [];
  const data = store.goalMilestones && store.goalMilestones[lift];
  if (!data || !data.milestones) return [];

  const hit = [];
  data.milestones.forEach(ms => {
    if (!ms.achievedAt && newE1RM >= ms.target) {
      ms.achievedAt = Date.now();
      ms.achievedEntryId = entryId;
      hit.push({ ...ms, lift });
    }
  });
  if (hit.length > 0) store.saveGoalMilestones();
  return hit;
}

/**
 * Build the milestone roadmap for a lift, reading from persistent store.
 * Returns null if:
 *  - No goal set, OR
 *  - No locked milestones exist, OR
 *  - All milestones (including the Goal) have been achieved
 *
 * @param {string} lift - 'squat' | 'bench' | 'deadlift'
 * @returns {Object|null} Roadmap with `lift`, `milestones` array, and `projection`.
 */
export function calcMilestoneRoadmap(lift) {
  if (lift === 'total') return null;
  const data = store.goalMilestones && store.goalMilestones[lift];
  if (!data || !data.milestones || data.milestones.length === 0) return null;

  // Hide once all milestones (including Goal) are achieved
  const allAchieved = data.milestones.every(ms => ms.achievedAt);
  if (allAchieved) return null;

  // Use the current projection for estDate on unachieved milestones
  const proj = calcGoalProjection(lift);
  const cur = bestE1RM(lift) || data.startE1RM;
  const goal = data.goal;
  const gap = goal - cur;

  const milestones = data.milestones.map(ms => {
    const achieved = !!ms.achievedAt;
    const achievedDate = achieved ? new Date(ms.achievedAt) : null;
    let weeksAway = 0;
    let estDate = new Date();
    if (!achieved && proj && gap > 0) {
      const pctOfGap = Math.max(0, (ms.target - cur) / gap);
      weeksAway = Math.round(proj.weeksNeeded * pctOfGap);
      estDate = new Date();
      estDate.setDate(estDate.getDate() + weeksAway * 7);
    } else if (achieved) {
      estDate = achievedDate;
    }
    return {
      target: ms.target,
      label: ms.label,
      weeksAway,
      estDate,
      achieved,
      achievedDate,
    };
  });

  return { lift, milestones, projection: proj };
}
