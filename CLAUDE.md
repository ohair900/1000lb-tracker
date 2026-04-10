# Project: 1000lb Club Tracker

> AI agent manual. Read this once to understand the app — architecture, systems, data shapes, conventions, and domain glossary. Dense and tabular by design.

## 1. Project Overview

A vanilla-JS powerlifting tracker PWA focused on the squat, bench, and deadlift (SBD). Tracks lifts, accessories, RPE, and bodyweight; computes e1RM, Wilks/DOTS, volume, and fatigue; runs periodization (programs + mesocycles); and provides adaptive coaching via a Session Optimizer that orchestrates fatigue, plateau, gap, and comeback systems in real time.

- **Tech:** Vanilla JS, Vite bundler, no framework, localStorage-first, optional Firebase sync
- **Deployment:** GitHub Pages at `1000lbtracker.com` (CNAME in repo root)
- **Firebase project:** `lb-club-tracker` (API key HTTP-referrer restricted to ohair900.github.io + 1000lbtracker.com)
- **Differentiators:** EWMA ACWR fatigue tracking, per-user recovery calibration, adaptive Session Optimizer, offline-first PWA

## 2. Quick Start for AI Agents

| Looking for... | Start here |
|---|---|
| Boot sequence + dep injection wiring | `src/main.js` |
| State shape / localStorage keys | `src/state/store.js` (STORES registry at line 163) |
| Entry CRUD (add/edit/delete) | `src/state/actions.js` |
| Main UI tabs | `src/views/dashboard.js`, `log.js`, `history.js`, `charts.js`, `stats.js` |
| Workout flow | `src/views/workout-overlay.js` + `src/systems/session-optimizer.js` |
| Fatigue math | `src/systems/fatigue.js` |
| Periodization | `src/systems/mesocycle.js`, `src/systems/programs.js` |
| Build or deploy | §3 below — use `npm run build`, NOT `vite build` |

**Dev commands:**
```bash
npm run dev       # Vite dev server with HMR
npm run build     # Vite build + copy dist/ to repo root (REQUIRED — see §3)
npm test          # Vitest unit tests
```

## 3. Build & Deploy

**CRITICAL:** Always use `npm run build`, never `vite build` alone. The build script runs Vite AND copies `dist/index.src.html` → `index.html` plus `dist/assets/*` → repo root `assets/`. GitHub Pages serves from repo root (`/` on `master`), not from `dist/`. If you only run `vite build`, the site will serve stale JS/CSS.

**After building, always commit both `index.html` AND `assets/*` changes.**

**Service worker cache versioning:** `sw.js` line 2 defines `CACHE_NAME` (currently `'1000lb-tracker-v18'`). Bump the version number when making breaking changes to the PWA shell so old clients invalidate their cache.

**Firebase config:** `src/firebase/config.js` holds `DEFAULT_FIREBASE_CONFIG` with a production API key. The key is HTTP-referrer restricted, so it only works from the deployed domain. Users can override by pasting a custom config in Settings (persisted to localStorage under `FIREBASE_CONFIG_KEY`).

**Source-vs-built:** Edit `index.src.html` (the source template). The `index.html` at the repo root is the built artifact — don't edit it directly, it gets overwritten on every build.

## 4. Architecture Principles

- **Vanilla JS + Vite, no framework** — DOM manipulation via template strings + event delegation
- **localStorage-first, Firebase optional** — App works fully offline; cloud sync layers on top
- **Singleton store** — `src/state/store.js` exports one instance; all mutations go through it
- **Batched save** — `store.save(name)` marks dirty + schedules `queueMicrotask(_flush)`; coalesces many saves into one localStorage write. `saveNow(name)` bypasses batching for critical data (workoutSession)
- **Dependency injection** — Modules with cross-module deps expose `inject(deps)` or `setXxxDeps(deps)` and are wired in `main.js` after all imports, eliminating circular imports
- **Late-bound deps** — Use `_deps.foo?.(...)` with optional chaining so modules survive a missing injection
- **Deferred heavy operations** — PR rebuild, calibration, recap checks run in `requestIdleCallback` after first paint
- **Lazy Firebase SDK** — Loaded dynamically on first use from CDN, not bundled
- **PWA offline-first** — `sw.js` uses network-first for HTML/Firebase, cache-first for hashed assets, stale-while-revalidate for the rest
- **Modular boundaries** — Systems = domain logic (pure, no DOM). Views = rendering + event wiring. Formulas = pure math. UI = reusable interactive primitives.

## 5. Directory Structure

```
src/
├── main.js             — Boot: imports, DI wiring, init sequence (~650 lines)
├── constants/          — Config, thresholds, storage keys, math constants (7 files)
├── data/               — Static reference: programs, exercises, badges, muscles (9 files)
├── firebase/           — Auth, sync, config (lazy SDK load) (4 files)
├── formulas/           — Pure math: e1RM, Wilks/DOTS, plates, INOL (8 files)
├── state/              — store.js singleton + actions.js (entry CRUD)
├── styles/             — CSS: components/, features/, layout, variables (36 files)
├── systems/            — Domain logic: fatigue, mesocycle, plateau, etc. (22 files)
├── ui/                 — Reusable primitives: toast, modal, sheet, timer, confetti (9 files)
├── utils/              — Stateless helpers: date, dom, html, helpers, error (4 files)
├── views/              — UI rendering + event wiring: dashboard, log, workout (24 files)
└── __tests__/          — Vitest unit tests

index.src.html          — Source HTML template (edit this)
index.html              — Built artifact (auto-generated by npm run build)
sw.js                   — Service worker, CACHE_NAME versioned
manifest.json           — PWA manifest
vite.config.js          — Vite config
```

## 6. Data Model Reference

### Persistent Stores (via `STORES` registry in `src/state/store.js`)

| Store | Key const | Shape | Purpose |
|---|---|---|---|
| `entries` | `STORAGE_KEY` | `[]` of entry objects | Every logged main-lift set |
| `profile` | `PROFILE_KEY` | `{ gender, bodyweight, bodyweightHistory[] }` | User demographics |
| `goals` | `GOALS_KEY` | `{ squat, bench, deadlift, total }` | Target maxes (lbs) |
| `prs` | `PRS_KEY` | `[]` of PR records | Cached best e1RMs per lift |
| `cycles` | `CYCLES_KEY` | `[]` of cycle objects | Training blocks |
| `programs` | `PROGRAMS_KEY` | `programConfig{}` (see below) | Active program state |
| `workoutConfig` | `WORKOUT_KEY` | `{ weakPoints, setupComplete }` | Per-lift weak points |
| `accessoryLog` | `ACCESSORY_LOG_KEY` | `[]` of accessory log entries | Accessory exercise history |
| `workoutSession` | `WORKOUT_SESSION_KEY` | nullable session object | Current workout in progress |
| `customTemplates` | `CUSTOM_TEMPLATES_KEY` | `[]` of template objects | User-saved workout templates |
| `mesocycle` | `MESOCYCLE_KEY` | nullable mesocycle | Active periodization cycle |
| `mesocycleHistory` | `MESOCYCLE_HISTORY_KEY` | `[]` of past mesocycles | Completed cycles |
| `recoveryCalibration` | `RECOVERY_CALIBRATION_KEY` | nullable `{ [muscle]: { hours, confidence, sampleCount } }` | Learned recovery rates |
| `deletedEntryIds` | `DELETED_IDS_KEY` | `[]` of `{ id, deletedAt }` | 30-day undo window |
| `leaderboard` | `LEADERBOARD_KEY` | boolean | Opt-in flag |
| `equipmentProfile` | `EQUIPMENT_PROFILE_KEY` | `{ barbell, dumbbell, cable, machine, bodyweight }` | Available equipment |
| `reasonTagCounts` | `REASON_TAG_COUNTS_KEY` | `{ [exerciseId]: count }` | Tracks "why this exercise" impression count |
| `accessoryOverrides` | `ACCESSORY_OVERRIDES_KEY` | `{ [exId]: { sets?, repRange?, pctOfTM? } }` | User exercise overrides |
| `customAccessories` | `CUSTOM_ACCESSORIES_KEY` | `[]` of custom exercise objects | User-created exercises |
| `disabledAccessories` | `DISABLED_ACCESSORIES_KEY` | `[]` of exerciseIds | Hidden from recommendations |

**Load classes** (in `store.init()`):
- `ESSENTIAL_STORES` — loaded synchronously for first paint: entries, profile, goals, prs, programs, workoutConfig, workoutSession, mesocycle, cycles, deletedEntryIds, leaderboard
- `DEFERRED_STORES` — loaded via `requestIdleCallback` after first paint: accessoryLog, customTemplates, mesocycleHistory, recoveryCalibration, equipmentProfile, reasonTagCounts, accessoryOverrides, customAccessories, disabledAccessories

### Ephemeral State (NOT persisted via STORES registry)

Some seeded from individual localStorage keys; others pure in-memory:
- `unit` ('lbs'|'kg') — seeded from `UNIT_KEY`
- `accentColor`, `currentLift`, `currentTab`, `currentRPE`
- Chart state: `chartType`, `chartFilter`, `chartDateRange`, `heatmapMetric`, `calendarMonth`, `chartPoints`
- History state: `historyFilter`, `historyFrom`, `historyTo`, `historySearch`, `historySort`, `historyPage`, `notesVisible`, `editingEntryId`
- Timer: `timerDuration`, `timerRemaining`, `timerRunning`, `timerInterval`, `timerStartTime`, `exerciseTimer`
- `activeCycleId`, `undoStack`, `undoTimer`, `statsCollapsed`, `unlockedBadges`, `dashboardWidgets`
- Leaderboard: `leaderboardData`, `leaderboardFilter`
- **`_sessionOptimizer`** — ephemeral coaching cache (SessionPlan + evaluations + expensive-calc cache); `_`-prefix signals "never persisted"

### Sample: `workoutSession` shape

```js
{
  id: "abc123",
  mainLift: "squat",
  programWeek: 2,
  date: "2026-04-10",
  startTime: 1712707200000,
  mainSets: [
    { num: 1, weight: 220, reps: "5+", pct: 70, tier: null, day: null,
      completed: true, rpe: 7, entryId: "..." }
  ],
  bbbSets: [ { num: 1, weight: 155, reps: 10, pct: 50, tier: 'BBB', completed: false } ],
  accessories: [
    { exerciseId: "rdl", name: "Romanian Deadlift",
      setWeights: [135, 155, 155], targetSets: 3, repRange: [8, 12],
      equipment: "barbell", setsCompleted: [10, 10], progressed: false }
  ],
  loggedEntryIds: ["entry1", "entry2"],
  source: "quick" | "mesocycle" | "template",
  templateId: null,
  completed: false
}
```

### Entry shape

```js
{
  id, lift, weight, reps, e1rm, date, timestamp,
  rpe?, notes?, tags?, isPR?, repPRs?, bodyweight?, cycleId?, updatedAt?
}
```

## 7. Systems Reference (`src/systems/`)

| File | Purpose | Key exports |
|---|---|---|
| `pr-tracking.js` | Maintains PR list, detects plate milestones (135/225/315/405/495) | `rebuildPRs`, `checkPR`, `checkRepPR`, `getMilestone` |
| `streak.js` | Consecutive training days (2-day gap allowed), longest streak | `calcStreak` |
| `volume.js` | Tonnage per weekly/monthly period, session grouping, meet projection | `calcVolumeSummaries`, `getProjectedTotal`, `suggestAttempts`, `groupSessions` |
| `badges.js` | Evaluates 22+ BADGE_DEFINITIONS against store state | `checkBadges` |
| `goals.js` | Projects timeline to goal based on historical rate | `calcGoalProjection` |
| `plateau-breaker.js` | Six-layer plateau diagnosis + intervention list | `diagnosePlateau`, `detectPlateau`, `getInterventions`, `generatePlateauMiniCycle` |
| `comeback.js` | Detects 14+ day training breaks | `checkComeback` |
| `accessory-progress.js` | Per-exercise progress summaries from accessoryLog | `getAccessorySummaries`, `getAccessoryDetail` |
| `weekly-recap.js` | Sunday/Monday auto-recap of prior week | `calcWeeklyRecap`, `checkAutoRecap` |
| `gap-analysis.js` | Volume gaps by muscle, push/pull ratio, recency gaps | `getGapReport`, `analyzeWeeklyVolume`, `analyzePushPullRatio`, `analyzeRecencyGaps` |
| `weekly-grade.js` | Four-pillar weekly score (compliance + coverage + intensity + consistency) | `calcWeeklyGrade` |
| `weekly-coverage.js` | Muscle coverage for body map, focus suggestions | `calcWeeklyCoverage`, `calcWeeklyFocus` |
| `weekly-insights.js` | Prioritized insight chips for dashboard (up to 6) | `calcWeeklyInsights` |
| `ai-export.js` | Builds structured prompts for external AI coaching apps | `buildAthleteProfile`, `buildWeeklyReviewPrompt`, `buildProgramCheckPrompt`, `buildLiftDeepDivePrompt`, `shareCoachingPrompt` |
| `programs.js` | Program template execution, auto-progression, week tracking | `getProgramWorkout`, `findFirstIncompleteWeek`, `checkAutoProgression`, `applyProgression`, `updateWeekStreak`, `getLiftWeek`, `daysSinceLastLift` |
| `workout-builder.js` | Accessory selection + scoring + set-ramping + fatigue scalars | `selectAccessories`, `selectSmartAccessories`, `scoreAccessories`, `computeSetWeights`, `getAccessoryWeight`, `checkAccessoryProgression` |
| `workout-guardrails.js` | Non-blocking hints when loading is unbalanced/fatigued | `checkGuardrails` |
| `smart-workout.js` | Suggests next lift (recovery-aware) + intensity (fatigue-tempered) | `suggestMainLift`, `suggestIntensity` |
| `fatigue.js` | EWMA ACWR per muscle + per lift, recovery estimates | `calcFatigue`, `calcFatigueLift`, `calcFatigueByMuscle`, `calcFatigueDetail`, `getRecoveryAdvice`, `invalidateThresholds` |
| `recovery-calibration.js` | Learns per-user recovery rates from interval-performance data | `runCalibration`, `getCalibratedRecovery`, `getCalibrationInfo` |
| `mesocycle.js` | Mesocycle generation, performance recording, ACWR-aware adaptation | `generateMesocycle`, `generateMesoWeek`, `recordMesocyclePerformance`, `adaptRemainingWeeks` |
| `session-optimizer.js` | Pre/mid/post-session adaptive coaching orchestrator | `generateSessionPlan`, `evaluateSetCompletion`, `gradeSession`, `applyAdjustments`, `applyBBBAdjustment`, `generateFreestylePlan` |

## 8. Views Reference (`src/views/`)

### Tab views
| File | Purpose |
|---|---|
| `dashboard.js` | Lift cards, total, goal bars, ratios, fatigue body map, streak, weekly insights, plateau warnings |
| `log.js` | Weight/reps entry, live e1RM preview, RPE pills, notes/tags, lift selector |
| `history.js` | Searchable/filterable entry list, swipe-to-delete with undo, edit modal |
| `charts.js` | e1RM progression, volume trends, heatmap, training calendar |
| `stats.js` | PR timeline, accessory progress, body map, weekly grade, Wilks/DOTS |
| `leaderboard.js` | Global ranking by total or lift, weight-class filter |

### Sheets (bottom drawers)
| File | Purpose |
|---|---|
| `lift-detail.js` | Per-lift deep dive: all entries, stats, trend |
| `accessory-detail.js` | Single accessory progress graph + readiness |
| `fatigue-sheet.js` | Per-muscle fatigue detail + recovery time |
| `plateau-analysis.js` | Plateau diagnostic + mini-cycle generator |
| `choice-sheet.js` | "Start Workout" options hub (quick/smart/custom/template/mesocycle) |
| `workout-summary.js` | Post-workout summary with session grade + impact flags |

### Overlays (full-screen)
| File | Purpose |
|---|---|
| `workout-overlay.js` | Active workout session UI (main sets + BBB + accessories + timer) |
| `builder-overlay.js` | Advanced workout builder with exercise catalog search |
| `welcome.js` | First-time onboarding (profile + program setup) |

### Specialty
| File | Purpose |
|---|---|
| `body-map.js` | SVG anatomical map with muscle fatigue/coverage colors |
| `cycle-bar.js` | Training cycle progress bar above program section |
| `mesocycle-ui.js` | Mesocycle generator + week detail + performance logging |
| `program-section.js` | Program display in log tab with set checklist |
| `session-coach-ui.js` | Coaching card/chip/grade rendering for Session Optimizer |
| `smart-recommendation.js` | Smart workout recommendation card |
| `sync-ui.js` | Cloud sync button, status indicator, sign-in/out |
| `settings.js` | 3-tab settings modal (profile / preferences / tools) |
| `exercises-tab.js` | Equipment profile + custom exercise management |

## 9. Formulas Reference (`src/formulas/`)

| File | Math | Key exports |
|---|---|---|
| `e1rm.js` | Epley: `weight × (1 + reps/30)` | `calcE1RM`, `bestE1RM`, `getTotal` |
| `scoring.js` | Wilks & DOTS polynomial coefficients by gender | `calcWilks`, `calcDOTS` |
| `units.js` | lbs ↔ kg conversion, display rounding | `formatWeight`, `displayWeight`, `inputToLbs`, `lbsToKg` |
| `plates.js` | Round to loadable plates (2.5kg / 5lbs), plate breakdown | `roundToPlate`, `calcPlatesPerSide`, `formatPlates` |
| `progression.js` | 90-day rolling rate; plateau = ≤2lbs gain in 4 weeks | `calcProgression`, `detectPlateau` |
| `standards.js` | Classification by bodyweight ratio (beginner → elite) | `getClassification`, `getOverallClassification`, `getWeightClass` |
| `inol.js` | `reps / (100 - %1RM)`; accessory variant discounted | `calcINOL`, `calcAccessoryINOL` |
| `streak.js` | Re-export helper (actual logic in systems/streak.js) | — |

## 10. Data Reference (`src/data/`)

| File | Contents |
|---|---|
| `programs.js` | `PROGRAM_TEMPLATES` — 5/3/1 BBB, nSuns, GZCL, Texas Method, StrongLifts, Candito |
| `accessories.js` | Legacy `ACCESSORY_DB` (~50 exercises), `WEAK_POINT_OPTIONS`, `EXERCISE_INFO` |
| `exercise-catalog.js` | Unified `EXERCISE_CATALOG` (~51 canonical exercises), `MOVEMENT_PATTERNS` (8), `PROGRESSION_MODELS` (close-variation/compound/isolation/bodyweight/time), `PATTERN_DEFAULT_MUSCLES` |
| `exercise-compat.js` | Legacy ID → canonical ID resolver | `resolveExercise`, `resolveCanonicalId`, `getExerciseHistory`, `resolveAccessory` |
| `muscle-groups.js` | `MUSCLE_GROUPS` (10), `MUSCLE_RECOVERY_HOURS`, `MAIN_LIFT_WEIGHTS`, `ACCESSORY_CAT_WEIGHTS`, `SYNERGIST_MAP`, `SYNERGIST_RECOVERY_PENALTY` (0.12), `MUSCLE_PUSH_PULL`, `WEEKLY_SET_TARGETS` |
| `badges.js` | `BADGE_DEFINITIONS` — 22+ achievement definitions |
| `standards.js` | Strength classification thresholds per bodyweight |
| `milestones.js` | Total milestones ([500,750,1000,1250,1500,2000]), themes, `AVAILABLE_TAGS` |
| `meso-goals.js` | `MESO_GOALS` — hypertrophy/strength/peaking/deload pct/rep/RPE ranges |

## 11. State & Actions

**Store (`src/state/store.js`) is a singleton.** Access via `import store from '../state/store.js'`.

**Batched save flow:**
```
mutate field → store.save(name) → _dirtyStores.add(name) → queueMicrotask(_flush)
→ _flush writes ALL dirty stores to localStorage in one pass → onAfterFlush() fires
→ sync module's scheduleCloudSync() debounces a push to Firestore
```

- `store.save(name)` — batched (microtask)
- `store.saveNow(name)` — bypasses batch; use for `workoutSession` where every set must survive a crash
- Convenience shortcuts: `store.saveEntries()`, `store.saveProgramConfig()`, `store.saveWorkoutSession()`, etc.
- `store.onAfterFlush` — set by `main.js` to `scheduleCloudSync`
- `store.onStorageFull` — set to `showToast` for quota errors

**Actions (`src/state/actions.js`) — entry CRUD with late-bound deps:**
```js
inject({ calcE1RM, rebuildPRs, checkPR, checkRepPR, getMilestone })
addEntry(lift, weight, reps, rpe, notes, tags)
  → { entry, isPR, isRepPR, milestone }
editEntry(id, lift, weight, reps, rpe, notes)
deleteEntry(id)
executeUndo()
```

**Entry CRUD flow:** `addEntry` → `calcE1RM` → `checkPR` + `checkRepPR` → push to `store.entries` → `saveEntries()` → cloud sync scheduled via onAfterFlush.

## 12. Firebase & Sync (`src/firebase/`)

| File | Purpose |
|---|---|
| `config.js` | `DEFAULT_FIREBASE_CONFIG` (project `lb-club-tracker`, HTTP-referrer restricted). `loadFirebaseConfig`, `saveFirebaseConfig` |
| `init.js` | Lazy-loads Firebase SDK from CDN on first call. Exports mutable references populated in `initFirebase(config)` |
| `auth.js` | Google Sign-In (popup with redirect fallback), `currentUser`, `setupAuthListener`, `handleFirstSignIn`, `signInWithGoogle`, `signOutUser` |
| `sync.js` | Batched push (10s debounce), Firestore `onSnapshot` realtime listener, timestamp-based merge, leaderboard 5-min cache |

**Cloud sync lifecycle:**
```
local save → onAfterFlush fires → scheduleCloudSync (10s debounce)
→ flushPendingSync → pushLocalData (writes to Firestore user doc)
Meanwhile: startRealtimeSync → onSnapshot → mergeCloudData → rebuildPRs
```

**Conflict rule:** timestamp-based. Cloud wins on conflicts (last-write-wins by `updatedAt`/`timestamp`).

**Leaderboard:** cached for 5 minutes. Only opted-in users (`store.leaderboardOptedIn`) push their totals.

## 13. UI Primitives (`src/ui/`)

| File | Purpose |
|---|---|
| `toast.js` | Notifications with undo (10s expiration), PR share buttons. Single-level undo stack |
| `modal.js` | Backdrop + display:none toggle, body scroll lock on open |
| `sheet.js` | Bottom drawer management with swipe-dismiss (choice, fatigue, review, workout summary) |
| `timer.js` | Rest timer + exercise hold timer, Screen Wake Lock API, beep chime on completion |
| `confetti.js` | 3 celebration types: milestone overlay, week-complete cascade, lift-complete flash |
| `swipe.js` | Swipe-to-delete gesture on history entries |
| `theme.js` | Accent color via CSS custom properties (8+ color schemes) |
| `share.js` | Canvas-rendered PR & milestone share cards via Web Share API |
| `dom.js` | DOM reference caching (weightInput, repsInput, etc.) after DOMContentLoaded |

## 14. Conventions & Patterns

- **JSDoc:** File-level docstring at top of each module; `@param` and `@returns` on exported functions; `@type {Function|null}` on late-bound dep slots
- **Dep injection:** Modules expose `inject(deps)` or `setXxxDeps(deps)`; `main.js` wires them all after import phase (search for `setXxxDeps(` to find integration points)
- **Late-bound deps:** Always use `_deps.foo?.(...)` with optional chaining — module should survive missing injection
- **Ephemeral fields:** Prefix with `_` (e.g., `_sessionOptimizer`, `_dropped`, `_deletedEntryRecords`) — never persisted
- **Storage keys:** All defined in `src/constants/storage-keys.js`, imported by name. Never hardcode strings
- **Units:** Internal storage is ALWAYS lbs. Convert at display time via `formatWeight()` / `displayWeight()` / `inputToLbs()`
- **Dates:** ISO `"YYYY-MM-DD"` format internally. When parsing, append `"T12:00:00"` to avoid timezone off-by-one near midnight
- **Cache busting:** Bump `CACHE_NAME` in `sw.js` for breaking PWA shell changes
- **Saving state:** `store.save(name)` for batched, `store.saveNow(name)` only for workoutSession mid-workout
- **Stale reads:** Never read UI state (`store.currentTab`, `store.chartFilter`) from inside a system — pass as arg or read from view layer
- **Testing:** Vitest unit tests in `src/__tests__/` (formulas primarily); legacy node tests in `tests.js`
- **Async deferrals:** Heavy ops (`rebuildPRs`, `runCalibration`, `checkAutoRecap`, `checkComeback`) run via `requestIdleCallback` after first paint
- **Store mutations:** Only happen inside `src/state/actions.js` or `src/systems/` — views should not write store fields directly (except ephemeral UI state)

## 15. Intelligence Systems Deep Dives

### Fatigue tracking (`src/systems/fatigue.js`)

**EWMA ACWR (Exponentially Weighted Moving Average, Acute:Chronic Workload Ratio):**
```
LAMBDA_ACUTE   = 2 / (7 + 1)  = 0.25    // 7-day equivalent
LAMBDA_CHRONIC = 2 / (28 + 1) ≈ 0.069   // 28-day equivalent
EWMA_WINDOW_DAYS = 42
```

**Load metric:** INOL (Intensity Number of Lifts)
```
calcINOL(weight, reps, e1rm) = reps / (100 - (weight/e1rm)*100)
calcAccessoryINOL: approximates %1RM as pctOfTM × 0.9
```
Accessory discount tiered by progressionType: close-variation 0.80, compound 0.55, isolation 0.30, bodyweight 0.35, time 0.20.

**Auto-calibrated thresholds** (once per 60s, requires 28+ days + 10+ entries):
- `high = max(1.4, p90 of user's historical ACWR)`
- `mod = max(1.1, p75 of user's historical ACWR)`

**Per-muscle recovery adjustment** stacks multipliers on base hours:
```
adjustedHours = baseHours
  × intensityMult   // 1.3 if avg >85%, 1.1 if 70-85%, 0.85 if <70%
  × acwrMult        // 1.3 red, 1.15 mod, 1.0 low (from FATIGUE_RECOVERY_MULT)
  × synergistMult   // +12% per red synergist, +6% per yellow
  × eccentricMult   // 1.25 high (RDL/Nordic), 1.0 mod, 0.80 low (carries)
  + spikeMult       // +12h if 7-day load > 1.5× chronic
  + densityPenalty  // +12-18h for back-to-back sessions
```

**5-tier display status** (classifyACWR + recoveryPct):
- `red` — ACWR > high OR recoveryPct < 15%
- `orange` — ACWR yellow AND recoveryPct < 40% OR recoveryPct < 40%
- `yellow` — recoveryPct < 70%
- `lime` — recoveryPct < 90%
- `green` — recovered

**Break detection** in `computeEWMA`:
- gap > 14 days → partial re-seed (decay chronic, re-seed acute)
- gap > 42 days → full reset, sets `ramping=true` flag that suppresses ACWR warnings for 14 days

**Load floor:** muscles with `chronic < 0.15` always classified green to avoid false positives on trivial loads.

### Recovery calibration (`src/systems/recovery-calibration.js`)

**Algorithm:**
1. Require 6+ weeks of training history, 4+ sessions per muscle group
2. Build interval-performance pairs: `(hours since last session, e1RM delta vs last session)`
3. Filter to "good recovery" pairs: `delta ≥ -2%` (accounts for day-to-day variation)
4. Take median interval among good pairs → calibrated hours
5. Clamp to 12-168h

**Confidence blending** for UI use:
```
blended = (1 - confidence) × default + confidence × calibrated
where confidence = min(1.0, sampleCount / 24)
```

**Throttle:** runs at most once per 24h (per muscle's `lastCalibrated` timestamp).

### Session Optimizer (`src/systems/session-optimizer.js`)

Orchestrates fatigue + plateau + gap + comeback + mesocycle into a three-phase coaching loop.

**Phase 1 — `generateSessionPlan(lift, session)`:**
- Runs expensive calcs ONCE and caches in `store._sessionOptimizer.cache`: fatigueLift, fatigueByMuscle, plateauDiagnosis, gapReport, comebackInfo
- Generates `SessionPlan` with insights (coaching reasons), adjustments (what was changed), accessorySwaps, setTargets (expected RPE per set), bbbAdjustment, comebackProtocol

**Phase 2 — `evaluateSetCompletion(setIdx, actualRPE, actualReps, actualWeight)`:**
- Compares actual RPE vs target; tracks cumulative drift across completed sets
- `avgDrift ≥ 2.0` → severe: reduce remaining 15%, drop last set
- `avgDrift ≥ 1.0` → moderate: reduce remaining 10%
- `avgDrift ≤ -1.5` → under-target: suggest +5% on remaining
- Special case: set 1 RPE 9+ when target ≤7 → switch to light day (80%)
- Returns `SetEvaluation` with adjustments, message, severity (info|warn|alert)

**Phase 3 — `gradeSession(session)`:**
- Grade points: 50 (completion) + 30 (RPE accuracy) + 20 (main set completion)
- Letter scale: A+ (95+), A (90), B+ (85), B (80), C+ (75), C (70), D (60), F (<60)
- Impact flags: TM hold if RPE drift > 1.0, fatigue warning if red primary muscles, rising RPE trend, continued plateau

**Program interaction rules (critical):**
- **Main sets are sacred** — never modify program-prescribed percentages/reps/set counts
- **Supplemental volume (BBB) is adjustable** — can only be reduced, never increased
- **Accessories are fully managed** — swap/reduce based on gaps and fatigue
- **RPE targets assigned** regardless of whether program normally uses RPE
- **Peaking blocks** tolerate yellow fatigue without tempering (intentional overreach)

**Freestyle mode** (no program, no mesocycle): `generateFreestylePlan()` calls `suggestMainLift()` + `suggestIntensity()` as the baseline, then layers plateau/gap/comeback on top — the optimizer becomes the program.

**`applyAdjustments(evaluation)`** — marks dropped sets with `_dropped=true`; `renderWorkoutView` skips them. Weight adjustments mutate `session.mainSets[i].weight` and re-render.

### Mesocycle engine (`src/systems/mesocycle.js`)

**Three periodization models:**
- **linear** — progressive intensity increase, reps decrease across weeks
- **dup** — daily undulating: each week has all 3 stimuli (hypertrophy/strength/power), one per lift, rotating
- **block** — accumulation (40%) → intensification (30%) → realization (30%)

**Goals** (from `data/meso-goals.js`): hypertrophy, strength, peaking, deload. Each defines `pctRange`, `repRange`, `rpeRange`.

**Auto-adaptation (`adaptRemainingWeeks(lift)`)** — runs after each lift's completion:
- `rpeDiff = actualRPE - targetRPE`
- `rpeDiff ≤ -1.5` → exceeding → +2.5% (or +5% if ≤ -2.5)
- `rpeDiff ≥ 1.5` → missing → -2.5% + drop last set
- ACWR override: if lift fatigue yellow/red, blocks intensity increases (logs "blocked")
- ACWR-triggered decrease: red primary muscle triggers volume reduction regardless of RPE (except peaking final 2 weeks)
- Goal-aware: peaking tolerates higher ACWR

**Deload weeks:** last week of any non-deload mesocycle is auto-generated as a deload (55% TM, RPE 5, 3x5).

### Plateau breaker (`src/systems/plateau-breaker.js`)

**Six diagnostic analyzers:**
1. **Intensity distribution** — flags if stuck in narrow % range
2. **Volume trend** — detects flat/declining tonnage
3. **Fatigue interference** — checks if other lifts are loading shared muscle groups (uses `calcFatigueLift` + `calcFatigueByMuscle`)
4. **Training frequency** — flags too few (<4/4w) or too many (≥7-9) sessions
5. **Weak-point coverage** — checks if configured weak point is undertrained
6. **RPE pattern** — high RPE + flat e1RM signals accumulated fatigue

Each analyzer returns a score. `diagnosePlateau(lift)` aggregates and `getInterventions(lift)` returns a prioritized intervention list. `generatePlateauMiniCycle(lift, diagnosis)` creates a 3-4 week targeted mini-cycle.

## 16. Feature Catalog (End-User Facing)

| Tab | Shows | Key actions |
|---|---|---|
| **Dashboard** | 3 lift cards + total, goal bars, classification, fatigue body map, streak, weekly insights, plateau warnings, ratios | Tap lift to drill down, tap body map for muscle detail |
| **Log** | Weight/reps entry, live e1RM, RPE pills, notes/tags, program workout, AMRAP input, rest timer | Log set, start workout, mark program set complete |
| **History** | Filterable entry list (by lift, date, search), sortable, paginated | Swipe-to-delete with undo, tap to edit |
| **Charts** | e1RM progression, volume trend, activity heatmap, training calendar | Filter by lift, switch date range, hover for values |
| **Stats** | PR timeline, accessory progress, body map, weekly grade, strength ratios, classification, Wilks/DOTS | Expand sections, view accessory detail |
| **Ranks** | Global leaderboard (total/squat/bench/deadlift), medal badges | Opt in/out in settings, view other lifters |
| **Settings** | Profile, goals, units, theme, equipment, sync, dashboard widgets, AI export, data import/export | Sign in to Firebase, export JSON/CSV, clear data |

**Cross-tab features:**
- **Mesocycle planner** — generate 4-12 week cycles (linear/DUP/block), track progress, auto-adapt from RPE + ACWR
- **Session Optimizer** — pre-session coaching card, mid-session RPE drift chips with Apply button, post-session grade
- **Plateau breaker** — 6-layer diagnosis + targeted 3-4 week mini-cycles
- **Smart workout builder** — auto-selects accessories by weak point, fatigue, and gaps
- **Recovery calibration** — self-learns per-user recovery rates after 6+ weeks of data
- **PWA offline** — works fully without internet, syncs when online
- **Share cards** — canvas-rendered PR and milestone cards with Web Share API
- **22 badges** — consistency, strength, milestones, volume categories

## 17. Glossary

| Term | Meaning |
|---|---|
| **ACWR** | Acute:Chronic Workload Ratio — fatigue indicator; `>1.5` high, `>1.2` moderate |
| **AMRAP** | As Many Reps As Possible — final top set of many 5/3/1 waves |
| **BBB** | Boring But Big — 5/3/1 supplemental 5×10 @ ~50% TM |
| **DOTS** | Dots Total (modern IPF 2020 scoring), replaces Wilks |
| **DUP** | Daily Undulating Periodization — vary stimulus each session |
| **e1RM** | Estimated 1-Rep Max (Epley: `weight × (1 + reps/30)`) |
| **EWMA** | Exponentially Weighted Moving Average — weights recent data higher |
| **GZCL** | Named program (Cody Lefever) with T1/T2/T3 tier system |
| **INOL** | Intensity Number of Lifts — `reps / (100 - %1RM)` load metric |
| **Mesocycle** | Multi-week training block (typically 4-12 weeks) |
| **MEV / MRV** | Minimum / Maximum Effective Volume (per muscle, per week) |
| **nSuns** | Named linear progression program with heavy volume |
| **Peaking** | Final meet-prep phase (high intensity, low volume) |
| **PR** | Personal Record — all-time best e1RM or weight-for-reps |
| **rep PR** | Best reps at a specific weight (separate from absolute PR) |
| **Repeated bout effect** | Adaptive reduction in muscle damage from repeated exercise exposure |
| **RPE** | Rate of Perceived Exertion (1-10); RPE 8 = 2 reps in reserve |
| **SBD** | Squat / Bench / Deadlift — the three competition powerlifts |
| **SRA curve** | Stimulus → Recovery → Adaptation (Selye's fitness-fatigue model) |
| **Texas Method** | Classic weekly undulating program (volume / recovery / intensity days) |
| **TM** | Training Max — working weight, conventionally ~90% of true 1RM |
| **Wilks** | Legacy bodyweight-adjusted strength score, polynomial formula |
| **5/3/1** | Jim Wendler's program: 4-week waves of 5s/3s/1+ with deload |
| **Strength classes** | Beginner → Novice → Intermediate → Advanced → Elite (by BW ratio) |
| **Weight class** | IPF bodyweight division (e.g., 83kg, 93kg, 105kg for men) |

## 18. Common Gotchas

- **Stale build after `vite build`:** Always use `npm run build` — `vite build` alone does NOT copy to repo root. Site will serve old assets.
- **GitHub Pages not updating:** Must commit both `index.html` AND `assets/*` after building. Check `git status` shows both.
- **Service worker cache stuck:** Bump `CACHE_NAME` in `sw.js` (line 2) and hard-refresh. Old clients invalidate on activation.
- **Firebase API key errors:** The key is HTTP-referrer restricted to `ohair900.github.io` and `1000lbtracker.com`. Local dev won't work with the default config — paste a custom config via Settings.
- **`_sessionOptimizer` in localStorage:** It's NOT — the `_` prefix signals ephemeral. Cleared in `completeWorkout`.
- **BBB auto-reduces accessories:** When a program has `tier === 'BBB'` sets, `createWorkoutSession` reduces accessory count from 5 to 3.
- **Dates near midnight:** Always parse as `new Date(dateStr + "T12:00:00")` to avoid timezone off-by-one when rendering calendars.
- **PR rebuild cost:** `rebuildPRs()` is O(n log n) over all entries. Deferred to `requestIdleCallback` at startup in `main.js`. Don't call in hot paths.
- **Circular imports:** NEVER import system X from system Y directly if Y is injected into X. Use `inject(deps)` pattern and wire in `main.js`.
- **`index.src.html` vs `index.html`:** Edit the `.src.html` source file. `index.html` is auto-generated by `npm run build` and MUST NOT be edited directly.
- **Store mutations from views:** Only mutate persistent store fields via actions.js or systems. Views should only touch ephemeral UI state.
- **Undo expiration:** 10-second single-level stack. Don't rely on deep undo history.
- **Long-press exercise preview:** Requires `initExercisePreview()` to be called in `main.js` — it's attached globally, not per-view.
- **`store.workoutSession` vs `store._sessionOptimizer`:** workoutSession persists (via `saveWorkoutSession`), _sessionOptimizer does NOT. Don't confuse them.
- **Ephemeral bypass on serialization:** When adding new ephemeral fields, don't add them to `STORES` registry or they'll get persisted.
- **Firebase lazy load:** Don't assume `db`, `auth`, etc. are available at startup. They're populated after `initFirebase()` completes.
- **Weekly recap timing:** Auto-triggers only on Sunday/Monday with a new week's data available. Manual trigger available in settings.
