import type { Lift } from '../types.js';

export const LIFTS: Lift[] = ['squat', 'bench', 'deadlift'];

export const COLORS: Record<Lift | 'total', string> = {
  squat: '#e53935',
  bench: '#1e88e5',
  deadlift: '#43a047',
  total: '#fdd835',
};

export const LIFT_SHORT: Record<Lift, string> = { squat: 'SQ', bench: 'BP', deadlift: 'DL' };
export const LIFT_NAMES: Record<Lift, string> = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
};

export const PLATE_MILESTONES = [135, 225, 315, 405, 495] as const;
export const REP_RANGES = [1, 2, 3, 5, 8, 10] as const;
export const CYCLE_TYPES = ['General', 'Hypertrophy', 'Strength', 'Peaking', 'Deload'] as const;

export const IPF_CLASSES: Record<'male' | 'female', number[]> = {
  male: [59, 66, 74, 83, 93, 105, 120],
  female: [47, 52, 57, 63, 69, 76, 84],
};

export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25] as const;
export const PLATES_LBS = [45, 35, 25, 10, 5, 2.5] as const;
