/**
 * Strength classification and weight-class helpers.
 *
 * Uses bodyweight-ratio based standards to classify a lifter from
 * beginner through elite, and determines their IPF weight class.
 */

import { STRENGTH_STANDARDS } from '../data/standards.js';
import { LIFTS, IPF_CLASSES } from '../constants/lift-config.js';
import store from '../state/store.js';
import { bestE1RM } from './e1rm.js';
import { lbsToKg } from './units.js';

/**
 * Classification levels in ascending order of strength.
 * @type {string[]}
 */
const LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];

/**
 * Classify a single lift based on the lifter's bodyweight ratio.
 * Requires gender and bodyweight to be set in the profile.
 *
 * @param {string} lift  - 'squat' | 'bench' | 'deadlift'
 * @param {number} e1rm  - Estimated 1RM in lbs
 * @returns {string|null} Classification string or null if data is missing
 */
export function getClassification(lift, e1rm) {
  if (!store.profile.gender || !store.profile.bodyweight || !e1rm) return null;
  const stds = STRENGTH_STANDARDS[store.profile.gender]?.[lift];
  if (!stds) return null;
  const ratio = e1rm / store.profile.bodyweight;
  if (ratio >= stds.elite) return 'elite';
  if (ratio >= stds.advanced) return 'advanced';
  if (ratio >= stds.intermediate) return 'intermediate';
  if (ratio >= stds.novice) return 'novice';
  return 'beginner';
}

/**
 * Determine the lifter's overall classification across all three lifts.
 * Returns the *lowest* classification among the three (weakest link).
 *
 * @returns {string|null} Overall classification or null if no data
 */
export function getOverallClassification() {
  const classes = LIFTS.map(l => getClassification(l, bestE1RM(l))).filter(Boolean);
  if (classes.length === 0) return null;
  const minIdx = Math.min(...classes.map(c => LEVELS.indexOf(c)));
  return LEVELS[minIdx];
}

/**
 * Determine the lifter's IPF weight class based on bodyweight.
 * Bodyweight is stored in lbs internally and converted to kg here.
 *
 * @returns {{ className: string, limit: number|null, distToLimit: number|null, bwKg: number, isPlus: boolean }|null}
 */
export function getWeightClass() {
  if (!store.profile.gender || !store.profile.bodyweight) return null;
  const bwKg = Math.round(lbsToKg(store.profile.bodyweight) * 10) / 10;
  const classes = IPF_CLASSES[store.profile.gender];
  if (!classes) return null;
  const maxClass = classes[classes.length - 1];
  if (bwKg > maxClass) {
    return { className: maxClass + '+', limit: null, distToLimit: null, bwKg, isPlus: true };
  }
  for (const limit of classes) {
    if (bwKg <= limit) {
      return {
        className: limit + ' kg',
        limit,
        distToLimit: Math.round((limit - bwKg) * 10) / 10,
        bwKg,
        isPlus: false,
      };
    }
  }
  return null;
}
