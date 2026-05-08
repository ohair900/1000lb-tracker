export const FATIGUE_THRESHOLD_HIGH = 1.5 as const;
export const FATIGUE_THRESHOLD_MOD = 1.2 as const;
export const FATIGUE_RECOVERY_MULT = { high: 1.3, mod: 1.15, low: 1.0 } as const;

// Eccentric load recovery multiplier
export const ECCENTRIC_RECOVERY_MULT = { high: 1.25, moderate: 1.0, low: 0.8 } as const;

export const WEIGHT_INCREMENT_KG = 2.5 as const;
export const WEIGHT_INCREMENT_LBS = 5 as const;

export const SHARE_CARD_WIDTH = 600 as const;
export const SHARE_CARD_HEIGHT = 340 as const;

export const HISTORY_PAGE_SIZE = 20 as const;

export const TIMER_MIN_SECONDS = 10 as const;
export const TIMER_MAX_SECONDS = 600 as const;
export const SWIPE_DELETE_THRESHOLD_PX = 80 as const;

export const STRENGTH_RATIO_BS_BALANCED = [55, 70] as const;
export const STRENGTH_RATIO_BS_WARNING = [50, 75] as const;
export const STRENGTH_RATIO_DS_BALANCED = [110, 125] as const;
export const STRENGTH_RATIO_DS_WARNING = [100, 135] as const;

export const SET_RAMP_PERCENTAGES: Record<number, readonly number[]> = {
  1: [1.0],
  2: [0.85, 1.0],
  3: [0.8, 0.9, 1.0],
  4: [0.7, 0.8, 0.9, 1.0],
  5: [0.65, 0.75, 0.85, 0.95, 1.0],
};

export const SET_RAMP_MODERATE: Record<number, readonly number[]> = {
  1: [0.95],
  2: [0.8, 0.95],
  3: [0.75, 0.85, 0.95],
  4: [0.65, 0.75, 0.85, 0.95],
  5: [0.6, 0.7, 0.8, 0.9, 0.95],
};

export const SET_RAMP_FATIGUED: Record<number, readonly number[]> = {
  1: [0.9],
  2: [0.75, 0.9],
  3: [0.7, 0.8, 0.9],
  4: [0.6, 0.7, 0.8, 0.9],
  5: [0.55, 0.65, 0.75, 0.85, 0.9],
};
