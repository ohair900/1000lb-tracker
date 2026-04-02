// src/data/programs.js — Training program templates (6 programs)

export const PROGRAM_TEMPLATES = {
  '5/3/1': {
    name: '5/3/1 Boring But Big',
    description: 'Classic 4-week periodized program by Jim Wendler. 3 main working sets + 5×10 supplemental (BBB) volume. AMRAP top sets drive progression (+10 bench / +20 squat & deadlift per cycle).',
    weeks: 4,
    progression: { type: 'amrap', upperIncrement: 10, lowerIncrement: 20, cycleWeeks: 4, amrapWeek: 3, minReps: 1 },
    schedule: {
      1: { label: 'Week 1 (5s)', sets: [
        { pct: 65, reps: 5 }, { pct: 75, reps: 5 }, { pct: 85, reps: '5+' },
        { pct: 50, reps: 10, tier: 'BBB' }, { pct: 50, reps: 10, tier: 'BBB' },
        { pct: 50, reps: 10, tier: 'BBB' }, { pct: 50, reps: 10, tier: 'BBB' },
        { pct: 50, reps: 10, tier: 'BBB' }
      ]},
      2: { label: 'Week 2 (3s)', sets: [
        { pct: 70, reps: 3 }, { pct: 80, reps: 3 }, { pct: 90, reps: '3+' },
        { pct: 50, reps: 10, tier: 'BBB' }, { pct: 50, reps: 10, tier: 'BBB' },
        { pct: 50, reps: 10, tier: 'BBB' }, { pct: 50, reps: 10, tier: 'BBB' },
        { pct: 50, reps: 10, tier: 'BBB' }
      ]},
      3: { label: 'Week 3 (1s)', sets: [
        { pct: 75, reps: 5 }, { pct: 85, reps: 3 }, { pct: 95, reps: '1+' },
        { pct: 50, reps: 10, tier: 'BBB' }, { pct: 50, reps: 10, tier: 'BBB' },
        { pct: 50, reps: 10, tier: 'BBB' }, { pct: 50, reps: 10, tier: 'BBB' },
        { pct: 50, reps: 10, tier: 'BBB' }
      ]},
      4: { label: 'Week 4 (Deload)', sets: [
        { pct: 40, reps: 5 }, { pct: 50, reps: 5 }, { pct: 60, reps: 5 }
      ]}
    }
  },
  'nSuns': {
    name: 'nSuns LP',
    description: 'High-volume linear progression based on 5/3/1. Ideal for early intermediates who can still add weight weekly. 9 sets per lift with heavy AMRAP top set followed by back-off volume.',
    weeks: 1,
    progression: { type: 'amrap', upperIncrement: 5, lowerIncrement: 10, cycleWeeks: 1, amrapWeek: 1, minReps: 1 },
    schedule: {
      1: { label: 'nSuns T1', sets: [
        { pct: 75, reps: 5 }, { pct: 85, reps: 3 }, { pct: 95, reps: '1+' },
        { pct: 90, reps: 3 }, { pct: 85, reps: 3 }, { pct: 80, reps: 3 },
        { pct: 75, reps: 5 }, { pct: 70, reps: 5 }, { pct: 65, reps: '5+' }
      ]}
    }
  },
  'GZCL': {
    name: 'GZCL Method',
    description: 'Tiered approach by Cody Lefever. T1 heavy compounds build strength, T2 moderate volume builds muscle. Good for intermediates who want structured progression with built-in variety.',
    weeks: 4,
    progression: { type: 'amrap', upperIncrement: 5, lowerIncrement: 10, cycleWeeks: 4, amrapWeek: 4, minReps: 1 },
    schedule: {
      1: { label: 'Week 1', sets: [
        { pct: 85, reps: 3, tier: 'T1' }, { pct: 85, reps: 3, tier: 'T1' }, { pct: 85, reps: 3, tier: 'T1' },
        { pct: 85, reps: 3, tier: 'T1' }, { pct: 85, reps: 3, tier: 'T1' },
        { pct: 65, reps: 10, tier: 'T2' }, { pct: 65, reps: 10, tier: 'T2' }, { pct: 65, reps: 10, tier: 'T2' }
      ]},
      2: { label: 'Week 2', sets: [
        { pct: 87.5, reps: 2, tier: 'T1' }, { pct: 87.5, reps: 2, tier: 'T1' }, { pct: 87.5, reps: 2, tier: 'T1' },
        { pct: 87.5, reps: 2, tier: 'T1' }, { pct: 87.5, reps: 2, tier: 'T1' },
        { pct: 67.5, reps: 8, tier: 'T2' }, { pct: 67.5, reps: 8, tier: 'T2' }, { pct: 67.5, reps: 8, tier: 'T2' }
      ]},
      3: { label: 'Week 3', sets: [
        { pct: 90, reps: 2, tier: 'T1' }, { pct: 90, reps: 2, tier: 'T1' }, { pct: 90, reps: 2, tier: 'T1' },
        { pct: 90, reps: 2, tier: 'T1' }, { pct: 90, reps: 1, tier: 'T1' },
        { pct: 70, reps: 6, tier: 'T2' }, { pct: 70, reps: 6, tier: 'T2' }, { pct: 70, reps: 6, tier: 'T2' }
      ]},
      4: { label: 'Week 4 (Test)', sets: [
        { pct: 72.5, reps: 3, tier: 'T1' }, { pct: 82.5, reps: 2, tier: 'T1' }, { pct: 92.5, reps: '1+', tier: 'T1' },
        { pct: 72.5, reps: 3, tier: 'T1' },
        { pct: 60, reps: 10, tier: 'T2' }, { pct: 60, reps: 10, tier: 'T2' }, { pct: 60, reps: 10, tier: 'T2' }
      ]}
    }
  },
  'Texas': {
    name: 'Texas Method',
    description: 'Weekly periodization with volume, recovery, and intensity days. Best for late novices / early intermediates who need more than linear progression but less complexity than 5/3/1.',
    weeks: 1,
    progression: { type: 'intensity-pr', upperIncrement: 5, lowerIncrement: 5, cycleWeeks: 1, minReps: 5 },
    schedule: {
      1: { label: 'Texas Method', sets: [
        { pct: 81, reps: 5, day: 'Volume' }, { pct: 81, reps: 5, day: 'Volume' }, { pct: 81, reps: 5, day: 'Volume' },
        { pct: 81, reps: 5, day: 'Volume' }, { pct: 81, reps: 5, day: 'Volume' },
        { pct: 65, reps: 5, day: 'Recovery' }, { pct: 65, reps: 5, day: 'Recovery' },
        { pct: 100, reps: '5+', day: 'Intensity' }
      ]}
    }
  },
  'SL5x5': {
    name: 'StrongLifts 5x5',
    description: 'Simple beginner program — 5 sets of 5 reps at one working weight. Add weight every session when all sets are completed. Best for absolute beginners in their first 3-6 months of lifting.',
    weeks: 1,
    progression: { type: 'session', upperIncrement: 5, lowerIncrement: 10, cycleWeeks: 1 },
    schedule: {
      1: { label: 'StrongLifts 5x5', sets: [
        { pct: 100, reps: 5 }, { pct: 100, reps: 5 }, { pct: 100, reps: 5 },
        { pct: 100, reps: 5 }, { pct: 100, reps: 5 }
      ]}
    }
  },
  'SS': {
    name: 'Starting Strength',
    description: 'The original novice barbell program by Mark Rippetoe. 3 sets of 5 at one working weight with linear progression each session. Perfect for brand-new lifters building a strength foundation.',
    weeks: 1,
    progression: { type: 'session', upperIncrement: 5, lowerIncrement: 5, cycleWeeks: 1 },
    schedule: {
      1: { label: 'Starting Strength', sets: [
        { pct: 100, reps: 5 }, { pct: 100, reps: 5 }, { pct: 100, reps: 5 }
      ]}
    }
  }
};
