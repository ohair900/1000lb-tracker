/** Cross-cutting domain types referenced by formulas, constants, and systems. */

export type Lift = 'squat' | 'bench' | 'deadlift';
export type Unit = 'lbs' | 'kg';
export type Gender = 'male' | 'female';

export interface Entry {
  id: string;
  lift: Lift;
  weight: number;
  reps: number;
  e1rm: number;
  date: string;
  timestamp: number;
  rpe?: number | null;
  notes?: string;
  tags?: string[];
  isPR?: boolean;
  repPRs?: number[];
  bodyweight?: number | null;
  cycleId?: string | null;
  updatedAt?: number;
}
