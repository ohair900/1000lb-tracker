# Smart Advanced Workout Builder

## Context

The current workout builder is basic: user picks a main lift, system auto-selects 3-5 accessories based on a single weak point, and follows a fixed program template. There's no way to build fully custom workouts, no intelligent recommendations based on training history/fatigue, no saved templates, and no auto-generated periodization. This plan adds a complete smart workout system with custom building, intelligent recommendations, mesocycle generation, and performance-based adaptation.

**File:** `index.html` (single-file SPA, ~7,400 lines, vanilla JS)

---

## Phase 1: Foundation (Data Models + Choice Screen + Custom Builder)

### 1.1 New Data Models

**Custom Workout Template:**
```js
{ id, name, mainLift, createdAt, lastUsed, exercises: [{ type, exerciseId, name, sets, reps, weightMode, weightValue, equipment, repRange, order }] }
```

**Mesocycle:**
```js
{ id, name, goal, model, durationWeeks, startDate, createdAt, baseTMs, currentWeek,
  weeks: [{ weekNum, label, phase, targetRPE, workouts: { squat/bench/deadlift: { mainSets[], accessories[], volumeTarget } }, completed, performance, adapted }],
  adaptationLog: [{ weekNum, lift, reason, adjustment, timestamp }], status }
```

### 1.2 New Storage Keys + State

Add after existing keys (~line 2068):
- `sbd-tracker-custom-templates` -> `customTemplates[]`
- `sbd-tracker-mesocycle` -> `activeMesocycle`
- `sbd-tracker-mesocycle-history` -> `mesocycleHistory[]`

Add load/save functions following existing `loadWorkoutConfig`/`saveWorkoutConfig` pattern (~line 2422). Call loaders at startup (~line 5067).

### 1.3 Enhanced "Start Workout" Choice Screen

**Modify** the click handler at ~line 5052. Instead of directly calling `openWorkoutView(currentLift)`, show a bottom sheet (reuse fatigue-sheet pattern) with cards:

1. **Mesocycle: Week X** (if active mesocycle - shown prominently at top)
2. **Quick Start** - existing auto-generate behavior
3. **Smart Workout** - AI-suggested based on history/fatigue
4. **Build Custom** - full workout builder
5. **Saved Templates (N)** - load a saved template (only if templates exist)
6. **Generate Mesocycle** - create a multi-week plan (only if no active mesocycle)

If resuming an active session, skip choice sheet and go directly to workout overlay.

### 1.4 Custom Workout Builder

Full-screen overlay (new `#builder-overlay`, reuses `.workout-overlay` CSS). Contains:

- Main lift pre-added as first exercise (not removable)
- **Exercise Browser**: searchable list of all ACCESSORY_DB exercises for the current main lift, grouped by category. Tap to add.
- **Custom Exercise Entry**: "Add Custom Exercise" button at bottom of browser opens an inline form: name (text input), sets, reps, weight, equipment dropdown (barbell/dumbbell/cable/machine/bodyweight). Custom exercises get `exerciseId: 'custom-' + timestamp` and are tracked in accessory log but don't participate in smart scoring (no weak point data).
- Each exercise card: name, equipment, sets/reps/weight inputs, remove button, move up/down buttons
- Footer: **Start Workout** + **Save as Template** buttons

**Save as Template**: prompts for name, stores in `customTemplates[]`
**Load Template**: bottom sheet listing saved templates sorted by `lastUsed`, tap to pre-populate builder
**Start Workout**: converts builder state into a `workoutSession` (same shape as `createWorkoutSession()` ~line 3377) and opens the existing workout overlay

**Template Management**: Full CRUD from the template list screen:
- **Edit**: loads template into builder, modifications overwrite the original on save
- **Rename**: inline name edit directly on the template card
- **Delete**: swipe or tap delete icon, with undo toast (10s window, matching existing delete pattern)
- **Duplicate**: copy a template to use as a starting point for a variant

### Key files/functions to modify:
- `createWorkoutSession()` (~line 3377) - model new session creation after this
- `selectAccessories()` (~line 3287) - reuse exercise filtering logic
- ACCESSORY_DB (~line 2111) - the exercise data source

---

## Phase 2: Smart Recommendations

### 2.1 Main Lift Suggestion (`suggestMainLift()`) + Override

Score each lift (0-100) based on:
- **Recency** (+30 max): days since last training * 5
- **Fatigue** (+20/-10): green = +20, yellow = +10, red = -10
- **Plateau** (+15): if `detectPlateau(lift)` returns true
- **Declining trend** (+10): if `calcProgression(lift)` shows downward

Returns highest-scoring lift with reasons array. **The user can override the suggestion** by tapping a different lift selector at the top of the recommendation screen. When overridden, all accessories and intensity suggestions regenerate for the newly selected lift while keeping the smart logic.

### 2.2 Intensity Suggestion (`suggestIntensity()`)

Based on fatigue level:
- Green: 82.5% TM, RPE 8, 5x3
- Yellow: 75% TM, RPE 7, 4x5
- Red: 65% TM, RPE 6, 3x5

If mesocycle active, use mesocycle prescription (tempered by fatigue if red).

### 2.3 Accessory Scoring Algorithm (`scoreAccessories()`)

Each accessory scored (0-100) on:
- **Weak point alignment** (+25): matches user's configured weak point
- **Recency** (+20 max): days since last done * 2, from `accessoryLog`
- **Muscle group fatigue** (+5/-10): recovered groups score higher
- **Progression signal** (+10): ready for weight increase (all sets hit top rep range)

### 2.4 Smart Selection with Diversity (`selectSmartAccessories()`)

Pick top 5 scorers with diversity constraints:
1. First pass: one per category (highest scorer per category)
2. Second pass: fill remaining with equipment diversity
3. Third pass: fill by pure score

### 2.5 Smart Recommendation UI

Renders in the builder overlay. Shows:
- Header: suggested lift + reason
- Lift selector pills (SQ / BP / DL) with suggested one pre-selected, tap another to override + regenerate
- Main lift with suggested intensity/sets/reps
- Each accessory with score bar + reasons
- **Swap** button per exercise (shows alternatives), **Remove** button, **Add More** button
- Everything is editable before starting
- **Start This Workout** converts to session

### Key functions to reuse:
- `calcFatigue*()` functions (~line 2590-2830)
- `detectPlateau()`, `calcProgression()` - existing analysis
- `getAccessoryWeight()` - existing weight calculation

---

## Phase 3: Periodization Engine

### 3.1 Mesocycle Generator (`generateMesocycle(goal, model, durationWeeks)`)

**Goals & intensity progressions:**

| Goal | %TM Range | Rep Range | RPE Range | Default Duration |
|------|-----------|-----------|-----------|-----------------|
| Hypertrophy | 65-75% | 8-10 | 6-8 | 6 weeks |
| Strength | 75-92.5% | 2-5 | 7-9 | 6 weeks |
| Peaking | 85-97.5% | 1-3 | 8-9.5 | 4 weeks |
| Deload | 50-60% | 5 | 5 | 1 week |

**Models:**
- **Linear**: smooth progression across weeks, intensity increases, volume adjusts per phase
- **DUP**: within each week, each lift gets a different stimulus (hypertrophy/strength/power rotation)
- **Block**: divide duration into accumulation/intensification/realization phases

Last week is always deload (except deload goal). Each week gets a `phase`, `targetRPE`, and per-lift workout prescription. Accessories auto-selected via `selectSmartAccessories()` with count based on phase (2-5).

**Training Frequency**: Default 3 days/week (one SBD each). Users can optionally add light/accessory-only days on top. Optional days are generated with lower intensity (~60% TM) and more accessories (4-5), focusing on volume and weak points. The mesocycle generator UI includes a toggle: "Add optional light days" which adds up to 2 extra days per week.

### 3.2 Mesocycle Generator UI (`showMesocycleGenerator()`)

Rendered in edit modal (reuse `showProgramSetupModal` pattern ~line 3619):
- **Goal** selector: pill buttons (Hypertrophy / Strength / Peaking / Deload)
- **Model** selector: pill buttons (Linear / DUP / Block)
- **Duration** selector: pills (4 / 6 / 8 weeks)
- **Optional light days** toggle
- **Training Maxes** display (read-only, link to setup if not set)
- **Generate** button

### 3.3 Mesocycle Workout (`openMesocycleWorkout(lift)`)

Reads current week's prescription for the lift, converts to `workoutSession` with:
- `mainSets` from mesocycle week's `mainSets` (pct * baseTM = weight)
- `accessories` from mesocycle week's accessory prescriptions
- Tags: `source: 'mesocycle'`, `mesocycleId`, `mesocycleWeek`

### 3.4 Mesocycle Management

Users can **abandon** an active mesocycle (moves to history with status `'abandoned'`). No mid-cycle editing -- to change anything, abandon and generate a new one. The abandon action is accessible via a button in the mesocycle timeline header and requires a confirmation tap. No skip-week or manual edit of generated plans.

### 3.5 Mesocycle + Programs Coexistence

The mesocycle runs **alongside** existing program templates, not replacing them:
- If a program (e.g. 5/3/1) is active, it still controls main lift set/rep schemes in the program section
- The mesocycle handles week-to-week periodization planning and accessory recommendations on top
- The choice sheet makes it clear which system each option uses ("Quick Start" uses active program, "Mesocycle: Week X" uses mesocycle prescriptions)
- The mesocycle uses its own `baseTMs` snapshot and does not modify `programConfig.trainingMaxes`

### 3.6 Mesocycle Timeline View

Horizontal scrollable row of week cards (story/reel style):
- Current week centered and highlighted with accent border
- Past weeks grayed with completion checkmarks per lift
- Future weeks show phase label + intensity preview
- Adapted weeks highlighted with a small indicator
- Tap a week card to see full detail (sets/reps/accessories for each lift)
- Rendered at the top of the choice sheet when mesocycle is active, and also accessible from Stats tab

### Key patterns to reference:
- PROGRAM_TEMPLATES (~line 2187) - how week/set structures are defined
- `renderProgramSection()` (~line 3476) - existing program UI patterns

---

## Phase 4: Performance-Based Adaptation

### 4.1 Record Performance (`recordMesocyclePerformance()`)

Called in `completeWorkout()` (~line 3412) when `session.source === 'mesocycle'`:
- Count completed main sets, total reps, AMRAP results
- Estimate actual RPE from AMRAP performance (extra reps = lower RPE)
- Store in `weekData.performance[lift]`
- If all 3 lifts done for the week, advance `currentWeek`
- If last week done, mark mesocycle `completed` and move to history

### 4.2 Adapt Remaining Weeks (`adaptRemainingWeeks()`)

Triggered after recording performance. Compares actual RPE to target:

- **Exceeding** (actual RPE 1.5+ below target): increase remaining weeks' intensity by 2.5-5%
- **Missing** (actual RPE 1.5+ above target or missed reps): reduce remaining weeks' intensity by 2.5% and volume by 10-15%
- **Within range**: no changes

Deload weeks are never adjusted. All adaptations logged to `adaptationLog[]` with reason and adjustment description.

### 4.3 Post-Workout Summary Card

After completing a mesocycle workout, show a **dedicated summary card** in the completion flow (after PR detection/celebration):
- **Performance vs Target**: actual RPE vs target RPE, AMRAP reps vs minimum, volume completed vs target
- **Adaptation Applied**: what changed (e.g. "Intensity +2.5% for weeks 4-6") or "No adaptation needed"
- **Next Week Preview**: brief look at next week's phase, intensity, and rep scheme for this lift
- Dismiss button to close, card uses the existing modal/card styling

### 4.4 Integration Point

In `completeWorkout()` (~line 3412), after existing accessory log saving:
```js
if (workoutSession.source === 'mesocycle' && activeMesocycle?.status === 'active') {
  recordMesocyclePerformance(workoutSession);
  adaptRemainingWeeks(workoutSession.mainLift);
  showMesocycleSummaryCard(workoutSession);
}
```

---

## Phase 5: Integration & Polish

### 5.1 Firebase Sync
- Add `customTemplates`, `mesocycle`, `mesocycleHistory` to `getLocalData()` (~line 7145)
- Add merge logic in `mergeCloudData()` (~line 7198): templates merge by ID (union, latest wins), mesocycle last-write-wins
- Wrap save functions with `scheduleCloudSync()` (~line 7393)

### 5.2 Export/Import
- Add new data to `exportData()` (~line 5572)
- Add restore logic in import handler
- Add to `clearAllData()` (~line 5527)

### 5.3 Stats Tab Integration
- Add mesocycle progress card to Stats: current week, phase, completion %, adaptation log
- Add mesocycle timeline view (scrollable week cards)

### 5.4 Workout Button Update
- Modify `updateWorkoutButton()` (~line 3701) to show mesocycle context when active

---

## Verification

1. **Choice screen**: appears on "Start Workout", resumes active session directly, each card navigates correctly
2. **Custom builder**: add/remove/reorder exercises (including custom free-text exercises), save template, load template, start workout from builder
3. **Template management**: edit, rename, delete (with undo), duplicate templates
4. **Smart recommendations**: suggests correct lift based on recency/fatigue with override to switch lifts, accessory scores reflect weak points + recency, swap/remove/tweak works, starts workout correctly
5. **Mesocycle generation**: each goal/model/duration combo produces valid week progressions, last week is deload, intensity increases appropriately, optional light days toggle works
6. **Mesocycle timeline**: scrollable week cards render correctly, current week centered, tap to expand detail, adapted weeks marked
7. **Mesocycle management**: abandon works with confirmation, moves to history, can generate new after abandoning
8. **Mesocycle workouts**: prescription matches week plan, sets/weights/reps correct, completion advances week
9. **Programs coexistence**: mesocycle and active program both work without interfering, choice sheet labels are clear
10. **Post-workout summary**: shows performance vs target, adaptation details, next week preview after mesocycle workouts
11. **Adaptation**: exceeding targets increases future intensity, missing targets reduces load, deload weeks untouched, log entries created
12. **Persistence**: all new data survives page reload, Firebase sync works, export/import includes new data
13. **Edge cases**: no TMs set (shows toast), mid-mesocycle clear (no crash), storage quota (graceful toast)
