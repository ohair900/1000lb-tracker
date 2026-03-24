// src/data/badges.js — Badge definitions
//
// Badge check functions accept a context object:
//   ctx.entries        — array of log entries
//   ctx.bestE1RM(lift) — function returning best estimated 1RM for a lift
//   ctx.calcStreak()   — function returning { current, longest }
//   ctx.getTotal()     — function returning the current SBD total
//   ctx.groupSessions(entries) — function grouping entries into sessions
//   ctx.profile        — { gender, bodyweight, bodyweightHistory }

const LIFTS = ['squat', 'bench', 'deadlift'];

export const BADGE_DEFINITIONS = [
  // Consistency
  { id: 'first-rep', name: 'First Rep', desc: 'Log your first set', icon: '\uD83C\uDFAF', category: 'consistency',
    check: (ctx) => ctx.entries.length >= 1 },
  { id: 'week-warrior', name: 'Two-Week Warrior', desc: 'Train 14 days total', icon: '\uD83D\uDCC5', category: 'consistency',
    check: (ctx) => new Set(ctx.entries.map(e => e.date)).size >= 14 },
  { id: 'fifty-strong', name: 'Fifty Strong', desc: 'Log 50 sessions', icon: '\uD83D\uDCAA', category: 'consistency',
    check: (ctx) => { const s = new Set(); ctx.entries.forEach(e => s.add(e.date)); return s.size >= 50; } },
  { id: 'century', name: 'Century Club', desc: 'Log 100 sessions', icon: '\uD83D\uDCAF', category: 'consistency',
    check: (ctx) => { const s = new Set(); ctx.entries.forEach(e => s.add(e.date)); return s.size >= 100; } },
  { id: 'streak-7', name: 'Week Streak', desc: '7-day training streak', icon: '\uD83D\uDD25', category: 'consistency',
    check: (ctx) => { const s = ctx.calcStreak(); return s && s.longest >= 7; } },
  { id: 'all-three', name: 'Full SBD', desc: 'Log all 3 lifts in one session', icon: '\uD83C\uDFCB\uFE0F', category: 'consistency',
    check: (ctx) => { const sessions = ctx.groupSessions(ctx.entries); return sessions.some(s => s.lifts.length >= 3); } },
  // Strength
  { id: 'bw-squat', name: 'BW Squat', desc: 'Squat your bodyweight', icon: '\uD83E\uDDB5', category: 'strength',
    check: (ctx) => ctx.profile.bodyweight && ctx.bestE1RM('squat') >= ctx.profile.bodyweight },
  { id: 'bw-bench', name: 'BW Bench', desc: 'Bench your bodyweight', icon: '\uD83E\uDDBE', category: 'strength',
    check: (ctx) => ctx.profile.bodyweight && ctx.bestE1RM('bench') >= ctx.profile.bodyweight },
  { id: '2x-deadlift', name: '2x BW Dead', desc: 'Deadlift 2x bodyweight', icon: '\uD83C\uDFCB\uFE0F', category: 'strength',
    check: (ctx) => ctx.profile.bodyweight && ctx.bestE1RM('deadlift') >= ctx.profile.bodyweight * 2 },
  { id: '1plate', name: '1 Plate Club', desc: 'Hit 135 lbs on any lift', icon: '\uD83E\uDD49', category: 'strength',
    check: (ctx) => LIFTS.some(l => ctx.bestE1RM(l) >= 135) },
  { id: '2plate', name: '2 Plate Club', desc: 'Hit 225 lbs on any lift', icon: '\uD83E\uDD48', category: 'strength',
    check: (ctx) => LIFTS.some(l => ctx.bestE1RM(l) >= 225) },
  { id: '3plate', name: '3 Plate Club', desc: 'Hit 315 lbs on any lift', icon: '\uD83E\uDD47', category: 'strength',
    check: (ctx) => LIFTS.some(l => ctx.bestE1RM(l) >= 315) },
  { id: '4plate', name: '4 Plate Club', desc: 'Hit 405 lbs on any lift', icon: '\uD83C\uDFC5', category: 'strength',
    check: (ctx) => LIFTS.some(l => ctx.bestE1RM(l) >= 405) },
  { id: '5plate', name: '5 Plate Club', desc: 'Hit 495 lbs on any lift', icon: '\uD83D\uDC8E', category: 'strength',
    check: (ctx) => LIFTS.some(l => ctx.bestE1RM(l) >= 495) },
  // Milestones
  { id: 'total-500', name: '500 Total', desc: 'Reach a 500 lb total', icon: '\uD83D\uDCAA', category: 'milestones',
    check: (ctx) => { const t = ctx.getTotal(); return t && t >= 500; } },
  { id: 'total-750', name: '750 Total', desc: 'Reach a 750 lb total', icon: '\uD83C\uDFCB\uFE0F', category: 'milestones',
    check: (ctx) => { const t = ctx.getTotal(); return t && t >= 750; } },
  { id: 'total-1000', name: '1000 Total', desc: 'Reach a 1000 lb total', icon: '\uD83D\uDC51', category: 'milestones',
    check: (ctx) => { const t = ctx.getTotal(); return t && t >= 1000; } },
  { id: 'total-1500', name: '1500 Total', desc: 'Reach a 1500 lb total', icon: '\u26A1', category: 'milestones',
    check: (ctx) => { const t = ctx.getTotal(); return t && t >= 1500; } },
  // Volume
  { id: 'volume-100k', name: 'Volume I', desc: 'Move 100,000 total lbs', icon: '\uD83D\uDCCA', category: 'volume',
    check: (ctx) => ctx.entries.reduce((s, e) => s + e.weight * e.reps, 0) >= 100000 },
  { id: 'volume-500k', name: 'Volume II', desc: 'Move 500,000 total lbs', icon: '\uD83D\uDCC8', category: 'volume',
    check: (ctx) => ctx.entries.reduce((s, e) => s + e.weight * e.reps, 0) >= 500000 },
  { id: 'volume-1m', name: 'Volume King', desc: 'Move 1,000,000 total lbs', icon: '\uD83D\uDC51', category: 'volume',
    check: (ctx) => ctx.entries.reduce((s, e) => s + e.weight * e.reps, 0) >= 1000000 },
];
