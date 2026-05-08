/**
 * Strength classification and weight-class helpers.
 */

import { STRENGTH_STANDARDS } from '../data/standards.js';
import { LIFTS, IPF_CLASSES } from '../constants/lift-config.js';
import store from '../state/store.js';
import { bestE1RM } from './e1rm.js';
import { lbsToKg } from './units.js';
import type { Lift } from '../types.js';

export type Classification = 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'elite';

const LEVELS: Classification[] = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];

export interface WeightClass {
  className: string;
  limit: number | null;
  distToLimit: number | null;
  bwKg: number;
  isPlus: boolean;
}

/**
 * Classify a single lift based on the lifter's bodyweight ratio.
 */
export function getClassification(lift: Lift, e1rm: number | null): Classification | null {
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
 * Returns the lowest classification (weakest link).
 */
export function getOverallClassification(): Classification | null {
  const classes = LIFTS.map((l) => getClassification(l, bestE1RM(l))).filter(
    (c): c is Classification => c !== null
  );
  if (classes.length === 0) return null;
  const minIdx = Math.min(...classes.map((c) => LEVELS.indexOf(c)));
  return LEVELS[minIdx];
}

/**
 * Determine the lifter's IPF weight class based on bodyweight.
 */
export function getWeightClass(): WeightClass | null {
  if (!store.profile.gender || !store.profile.bodyweight) return null;
  const bwKg = Math.round(lbsToKg(store.profile.bodyweight) * 10) / 10;
  const classes = IPF_CLASSES[store.profile.gender as 'male' | 'female'];
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
