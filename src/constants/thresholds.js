export const FATIGUE_THRESHOLD_HIGH = 1.5;
export const FATIGUE_THRESHOLD_MOD = 1.2;
export const FATIGUE_RECOVERY_MULT = { high: 1.3, mod: 1.15, low: 1.0 };

// Eccentric load recovery multiplier (#10)
export const ECCENTRIC_RECOVERY_MULT = { high: 1.25, moderate: 1.0, low: 0.80 };

export const WEIGHT_INCREMENT_KG = 2.5;
export const WEIGHT_INCREMENT_LBS = 5;

export const SHARE_CARD_WIDTH = 600;
export const SHARE_CARD_HEIGHT = 340;

export const HISTORY_PAGE_SIZE = 20;

export const TIMER_MIN_SECONDS = 10;
export const TIMER_MAX_SECONDS = 600;
export const SWIPE_DELETE_THRESHOLD_PX = 80;

export const STRENGTH_RATIO_BS_BALANCED = [55, 70];
export const STRENGTH_RATIO_BS_WARNING = [50, 75];
export const STRENGTH_RATIO_DS_BALANCED = [110, 125];
export const STRENGTH_RATIO_DS_WARNING = [100, 135];

export const SET_RAMP_PERCENTAGES = {
  1: [1.00],
  2: [0.85, 1.00],
  3: [0.80, 0.90, 1.00],
  4: [0.70, 0.80, 0.90, 1.00],
  5: [0.65, 0.75, 0.85, 0.95, 1.00]
};

// Fatigue-responsive ramp profiles (#6)
export const SET_RAMP_MODERATE = {
  1: [0.95],
  2: [0.80, 0.95],
  3: [0.75, 0.85, 0.95],
  4: [0.65, 0.75, 0.85, 0.95],
  5: [0.60, 0.70, 0.80, 0.90, 0.95]
};

export const SET_RAMP_FATIGUED = {
  1: [0.90],
  2: [0.75, 0.90],
  3: [0.70, 0.80, 0.90],
  4: [0.60, 0.70, 0.80, 0.90],
  5: [0.55, 0.65, 0.75, 0.85, 0.90]
};
