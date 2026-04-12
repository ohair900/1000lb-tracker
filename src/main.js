/**
 * Main entry point — the single boot file that imports every module,
 * wires dependency injection, initialises state, sets up event listeners,
 * and kicks off the first render.
 *
 * This file replaces the monolith's inline <script> init sequence
 * (roughly lines 7290-7862 of the original index.html).
 */

// ===== 1. Constants & data =====
import { UNIT_KEY } from './constants/storage-keys.js';
import { LIFTS, LIFT_NAMES, COLORS } from './constants/lift-config.js';
import {
  LONG_PRESS_MS, SWIPE_THRESHOLD_PX, SWIPE_TIMEOUT_MS, SWIPE_RATIO,
  TIMER_MIN_SECONDS, TIMER_MAX_SECONDS, RESIZE_DEBOUNCE_MS
} from './constants/index.js';
import { WEAK_POINT_OPTIONS } from './data/accessories.js';
import { ACCESSORY_DB, EXERCISE_INFO } from './data/accessories.js';

// ===== 2. State =====
import store from './state/store.js';
import {
  inject as injectActions,
  addEntry,
  editEntry,
  deleteEntry,
  executeUndo,
} from './state/actions.js';

// ===== 3. Formulas =====
import { calcE1RM } from './formulas/e1rm.js';
import { formatWeight, inputToLbs } from './formulas/units.js';

// ===== 4. Systems =====
import { rebuildPRs, checkPR, checkRepPR, getMilestone } from './systems/pr-tracking.js';
import { checkMilestonesAchieved, lockMilestones } from './systems/goals.js';
import { migrateAccessoryIds } from './systems/accessory-migration.js';
import {
  getProgramWorkout,
  updateWeekStreak,
  checkAutoProgression,
  applyProgression,
} from './systems/programs.js';
import { checkAutoRecap } from './systems/weekly-recap.js';
import { checkComeback } from './systems/comeback.js';
import { runCalibration } from './systems/recovery-calibration.js';
import {
  recordMesocyclePerformance,
  adaptRemainingWeeks,
} from './systems/mesocycle.js';

// ===== 5. Firebase =====
import { DEFAULT_FIREBASE_CONFIG, loadFirebaseConfig } from './firebase/config.js';
import { initFirebase } from './firebase/init.js';
import { setupAuthListener, setOnAuthStatusChange } from './firebase/auth.js';
import {
  scheduleCloudSync,
  flushPendingSync,
  setOnSyncComplete,
  setOnSyncStatusChange,
  stopRealtimeSync,
  startRealtimeSync,
} from './firebase/sync.js';

// ===== 6. UI primitives =====
import { $ } from './utils/helpers.js';
import { initDOMRefs } from './ui/dom.js';
import { showToast, setToastDeps, showToastWithUndo } from './ui/toast.js';
import { openModal, closeModal, initModalListeners } from './ui/modal.js';
import { startTimer, dismissTimer, setTimerDeps } from './ui/timer.js';
import { setConfettiDeps, triggerWeekCompleteCelebration, triggerLiftCompleteCelebration } from './ui/confetti.js';
import { sharePRCard, shareMilestoneCard } from './ui/share.js';
import { initSwipeToDelete, setSwipeDeps } from './ui/swipe.js';
import { initSheetListeners, closeChoiceSheet } from './ui/sheet.js';
import { applyAccentColor, setThemeDeps } from './ui/theme.js';

// ===== 7. Views =====
import { updateDashboard, renderRecapCard } from './views/dashboard.js';
import { initLogTab, injectLogDeps, updatePreview } from './views/log.js';
import { initHistoryTab, injectHistoryDeps, renderHistory } from './views/history.js';
import { initChartsTab, renderChart } from './views/charts.js';
import { initStatsTab, injectStatsDeps, renderStats } from './views/stats.js';
import { initSettingsListeners, setSettingsDeps } from './views/settings.js';
import {
  initProgramSection,
  setProgramSectionDeps,
  renderProgramSection,
  showProgramSetupModal,
} from './views/program-section.js';
import {
  initWorkoutOverlay,
  setWorkoutOverlayDeps,
  openWorkoutView,
  renderWorkoutView,
  updateWorkoutButton,
} from './views/workout-overlay.js';
import { initLiftDetailSheet } from './views/lift-detail.js';
import { initAccessoryDetailSheet } from './views/accessory-detail.js';
import { initPlateauSheet, setPlateauDeps } from './views/plateau-analysis.js';
import {
  initBuilderOverlay,
  setBuilderDeps,
  openBuilder,
  showTemplateList,
} from './views/builder-overlay.js';
import { setChoiceSheetDeps, renderChoiceSheetBody } from './views/choice-sheet.js';

import {
  initMesocycleUI,
  setMesocycleUIDeps,
  showMesocycleGenerator,
  openMesocycleWorkout,
  abandonMesocycle,
  showMesoWeekDetail,
} from './views/mesocycle-ui.js';
import { showWorkoutSummary } from './views/workout-summary.js';
import { initWelcomeOverlay, setWelcomeDeps, showWelcomeScreen } from './views/welcome.js';
import { renderCycleBar } from './views/cycle-bar.js';
import { initSyncUI, updateSyncButton } from './views/sync-ui.js';
import { initLeaderboardTab, renderLeaderboard } from './views/leaderboard.js';

// ===== 8. Polyfills =====

/**
 * roundRect polyfill for older browsers (needed by canvas share cards
 * and the heatmap chart).
 */
function installRoundRectPolyfill() {
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      if (typeof r === 'number') r = [r, r, r, r];
      this.moveTo(x + r[0], y);
      this.lineTo(x + w - r[1], y);
      this.quadraticCurveTo(x + w, y, x + w, y + r[1]);
      this.lineTo(x + w, y + h - r[2]);
      this.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
      this.lineTo(x + r[3], y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - r[3]);
      this.lineTo(x, y + r[0]);
      this.quadraticCurveTo(x, y, x + r[0], y);
      this.closePath();
    };
  }
}

// ===== 9. Weak-point setup modal (not yet extracted to its own module) =====

/**
 * Show the weak-point selection modal so the user can configure
 * per-lift weak points before starting a workout.
 *
 * @param {string} thenOpenLift - If set, opens the workout view for this
 *   lift after saving.  Passed through from the choice sheet / overlay.
 */
function showWeakPointSetupModal(thenOpenLift) {
  const body = $('edit-body');
  let html = '<div style="font-size:var(--text-sm);color:var(--text-dim);margin-bottom:var(--space-3)">Select your weak point for each lift to get targeted accessory recommendations.</div>';

  LIFTS.forEach(lift => {
    const options = WEAK_POINT_OPTIONS[lift];
    const current = store.workoutConfig.weakPoints[lift];
    html += `<div class="weakpoint-lift-title" style="color:${COLORS[lift]}">${LIFT_NAMES[lift]}</div>`;
    html += `<div class="weakpoint-grid">`;
    options.forEach(opt => {
      html += `<div class="weakpoint-option${current === opt.id ? ' selected' : ''}" data-lift="${lift}" data-wp="${opt.id}">${opt.label}</div>`;
    });
    html += `</div>`;
  });
  html += `<button class="modal-save-btn" id="weakpoint-save" style="width:100%;padding:14px;border:none;border-radius:var(--radius-lg);background:var(--green);color:#fff;font-size:var(--text-base);font-weight:700;cursor:pointer;margin-top:var(--space-3)">Save & Start Workout</button>`;

  body.innerHTML = html;
  $('edit-modal').querySelector('h3').textContent = 'Weak Point Setup';
  openModal('edit-modal');

  // Option selection
  body.querySelectorAll('.weakpoint-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const lift = opt.dataset.lift;
      body.querySelectorAll(`.weakpoint-option[data-lift="${lift}"]`).forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });

  // Save
  $('weakpoint-save').addEventListener('click', () => {
    LIFTS.forEach(lift => {
      const sel = body.querySelector(`.weakpoint-option[data-lift="${lift}"].selected`);
      if (sel) {
        store.workoutConfig.weakPoints[lift] = sel.dataset.wp;
      }
    });
    // Must have at least the target lift configured
    if (thenOpenLift && !store.workoutConfig.weakPoints[thenOpenLift]) {
      showToast(`Select a weak point for ${LIFT_NAMES[thenOpenLift]}`);
      return;
    }
    store.workoutConfig.setupComplete = true;
    store.save('workoutConfig');
    closeModal('edit-modal');
    if (thenOpenLift) openWorkoutView(thenOpenLift);
  });
}

// ===== 10. Tab switching =====

const TAB_ORDER = ['log', 'history', 'charts', 'stats', 'ranks'];

function switchToTab(tabName, direction) {
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tabName)
  );
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const newPanel = $('tab-' + tabName);
  if (direction) {
    newPanel.style.animation = direction === 'left' ? 'slideInLeft 0.2s ease' : 'slideInRight 0.2s ease';
    setTimeout(() => { newPanel.style.animation = ''; }, 200);
  }
  newPanel.classList.add('active');
  store.currentTab = tabName;
  if (store.currentTab === 'history') renderHistory();
  if (store.currentTab === 'charts') renderChart();
  if (store.currentTab === 'stats') renderStats();
  if (store.currentTab === 'log') renderProgramSection();
  if (store.currentTab === 'ranks') renderLeaderboard();
}

// ===== 11. Exercise preview card (long-press) =====

function initExercisePreview() {
  const overlay = document.createElement('div');
  overlay.id = 'exercise-preview';
  overlay.style.display = 'none';
  overlay.innerHTML = `<div class="exercise-preview-card">
    <div class="exercise-preview-name" id="ep-name"></div>
    <div class="exercise-preview-desc" id="ep-desc"></div>
    <div class="exercise-preview-meta" id="ep-meta"></div>
    <a class="exercise-preview-video" id="ep-video" target="_blank" rel="noopener">Watch form video</a>
  </div>`;
  document.body.appendChild(overlay);

  function showExercisePreview(exId) {
    const db = ACCESSORY_DB[exId];
    const info = EXERCISE_INFO[exId];
    if (!db && !info) return;
    $('ep-name').textContent = db ? db.name : exId;
    $('ep-desc').textContent = info ? info.desc : '';
    const meta = [];
    if (db) {
      meta.push(db.equipment);
      meta.push(db.sets + ' x ' + db.repRange.join('-') + (db.timeBased ? 's' : ' reps'));
      if (db.weakPoints.length) meta.push('Targets: ' + db.weakPoints.join(', '));
    }
    $('ep-meta').textContent = meta.join('  \u2022  ');
    const vid = $('ep-video');
    if (info && info.yt) {
      vid.href = 'https://www.youtube.com/watch?v=' + info.yt;
      vid.style.display = '';
    } else {
      vid.style.display = 'none';
    }
    overlay.style.display = '';
  }

  function hideExercisePreview() {
    overlay.style.display = 'none';
  }

  // Long-press detection (delegated)
  let timer = null;
  document.addEventListener('touchstart', function (e) {
    const target = e.target.closest('[data-exid]');
    if (!target || !target.dataset.exid) return;
    const exId = target.dataset.exid;
    if (!EXERCISE_INFO[exId]) return;
    timer = setTimeout(function () {
      showExercisePreview(exId);
      timer = null;
    }, LONG_PRESS_MS);
  }, { passive: true });

  document.addEventListener('touchmove', function () {
    if (timer) { clearTimeout(timer); timer = null; }
  }, { passive: true });

  document.addEventListener('touchend', function () {
    if (timer) { clearTimeout(timer); timer = null; }
  }, { passive: true });

  // Dismiss on tapping the backdrop
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) hideExercisePreview();
  });
}

// ===== 12. PWA =====

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js?v=22').catch(() => {});
  }
}

// =========================================================================
// BOOT SEQUENCE
// =========================================================================

installRoundRectPolyfill();
store.init();
// Firebase SDK loaded lazily — deferred to after first paint (see Step 13)

// ----- Step 4: Wire dependency injection -----

// 4a. Actions module — needs formula + PR system functions
injectActions({
  calcE1RM,
  rebuildPRs,
  checkPR,
  checkRepPR,
  getMilestone,
  checkMilestonesAchieved,
});

// 4b. Store hooks — cloud sync on every local save
store.onAfterFlush = scheduleCloudSync;
store.onStorageFull = (msg) => showToast(msg);

// 4c. Sync callbacks — refresh UI after cloud merge
setOnSyncComplete(() => {
  // Rebuild PRs from merged entries
  rebuildPRs();
  // Full UI refresh
  updateDashboard();
  renderCycleBar();
  updateWorkoutButton();
  if (store.currentTab === 'log') renderProgramSection();
  if (store.currentTab === 'history') renderHistory();
  if (store.currentTab === 'charts') renderChart();
  if (store.currentTab === 'stats') renderStats();
  if (store.currentTab === 'ranks') renderLeaderboard();
  // Re-apply accent in case cloud changed it
  applyAccentColor();
  // Re-sync unit UI
  document.querySelectorAll('.unit-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.unit === store.unit)
  );
  document.querySelectorAll('.unit-label').forEach(el => el.textContent = store.unit);
});

// 4d. Auth status change — update sync button
setOnAuthStatusChange(() => {
  updateSyncButton();
});

// 4d2. Sync status change — update sync button
setOnSyncStatusChange(() => {
  updateSyncButton();
});

// 4e. Toast deps
setToastDeps({
  sharePRCard,
  onAfterUndo: (type, data) => {
    // Perform the actual undo mutation
    if (type === 'delete' && data.entry) {
      store.entries.push(data.entry);
      store.deletedEntryIds.delete(data.entry.id);
      store._deletedEntryRecords = store._deletedEntryRecords.filter(r => r.id !== data.entry.id);
      store.save('deletedEntryIds');
      rebuildPRs();
    } else if (type === 'edit' && data.id) {
      const e = store.entries.find(x => x.id === data.id);
      if (e) {
        Object.assign(e, data.previous);
        rebuildPRs();
      }
    } else if (type === 'add' && data.id) {
      store.entries = store.entries.filter(e => e.id !== data.id);
      rebuildPRs();
    }
    // Refresh UI
    updateDashboard();
    renderCycleBar();
    if (store.currentTab === 'history') renderHistory();
    if (store.currentTab === 'charts') renderChart();
  },
});

// 4f. Timer deps
setTimerDeps({
  scheduleCloudSync,
  renderWorkoutView,
  saveWorkoutSession: () => store.saveWorkoutSession(),
});

// 4g. Confetti deps
setConfettiDeps({
  shareMilestoneCard,
  showToast,
  updateWeekStreak,
});

// 4h. Swipe-to-delete deps
setSwipeDeps({
  deleteEntry,
  renderHistory,
  showToastWithUndo,
});

// 4i. Accent color deps
setThemeDeps({
  scheduleCloudSync,
});

// 4j. Log view deps
injectLogDeps({
  updateDashboard,
  renderHistory,
  renderChart: renderChart,
  renderProgramSection,
  updateWorkoutButton,
  getProgramWorkout,
  checkAutoProgression,
  applyProgression,
  startTimer,
  dismissTimer,
});

// 4k. History view deps
injectHistoryDeps({
  updateDashboard,
});

// 4l. Stats view deps
injectStatsDeps({
  updateDashboard,
  renderCycleBar,
  showMesoWeekDetail,
});

// 4m. Settings view deps
setSettingsDeps({
  updateDashboard,
  renderHistory,
  renderChart,
  renderStats,
  renderCycleBar,
  renderProgramSection,
  updateWorkoutButton,
  dismissTimer,
  scheduleCloudSync,
});

// 4n. Program section deps
setProgramSectionDeps({
  updatePreview,
  updateDashboard,
  addEntry,
  startTimer,
  triggerWeekCompleteCelebration,
  triggerLiftCompleteCelebration,
});

// 4o. Workout overlay deps
setWorkoutOverlayDeps({
  updateDashboard,
  addEntry,
  renderProgramSection,
  updateWorkoutButton,
  showWorkoutSummary,
  showWeakPointSetupModal,
  recordMesocyclePerformance,
  adaptRemainingWeeks,
});

// 4p. Builder overlay deps
setBuilderDeps({
  closeChoiceSheet,
  renderWorkoutView,
});

// 4q. Choice sheet deps
setChoiceSheetDeps({
  openWorkoutView,
  openBuilder,
  showTemplateList,
  openMesocycleWorkout,
  showMesocycleGenerator,
  showProgramSetupModal,
  showWeakPointSetupModal,
  abandonMesocycle,
  renderProgramSection,
  updateWorkoutButton,
});

// 4r. Plateau analysis deps
setPlateauDeps({
  updateDashboard,
});

// 4s. Mesocycle UI deps
setMesocycleUIDeps({
  renderWorkoutView,
  updateWorkoutButton,
});

// 4s. Welcome deps
setWelcomeDeps({
  updateDashboard,
});

// Defer PR rebuild to after first paint (heavy O(n log n) sort)
const _ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
_ric(() => {
  try { rebuildPRs(); } catch {}
  // Migrate: auto-generate goalMilestones for users with existing goals
  try {
    ['squat', 'bench', 'deadlift'].forEach(lift => {
      if (store.goals[lift] && !store.goalMilestones?.[lift]) {
        lockMilestones(lift);
      }
    });
  } catch {}
  // Migrate: rewrite legacy accessory exerciseIds to canonical form.
  // Delayed inside setTimeout to guarantee the store's own deferred-store
  // load (accessoryLog, customTemplates, etc.) has finished first —
  // deferred stores are scheduled via requestIdleCallback inside store.init(),
  // and we can't rely on idle-callback ordering alone.
  setTimeout(() => {
    try {
      const result = migrateAccessoryIds();
      if (result.migrated > 0) {
        // eslint-disable-next-line no-console
        console.log(`[accessory-migration] rewrote ${result.migrated} ID references`, result.breakdown);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[accessory-migration] failed', err);
    }
  }, 1500);
});
initDOMRefs();

// ----- Step 7: Apply accent color -----
applyAccentColor();

// ----- Step 8: Sync unit UI state -----
document.querySelectorAll('.unit-btn').forEach(b =>
  b.classList.toggle('active', b.dataset.unit === store.unit)
);
document.querySelectorAll('.unit-label').forEach(el => el.textContent = store.unit);

// ----- Step 9: Tab switching -----
document.querySelectorAll('#app .tabs .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchToTab(btn.dataset.tab));
});

// Touch swipe between tabs
(function initTabSwipe() {
  let startX = null, startY = null, startTime = 0;
  document.addEventListener('touchstart', e => {
    if (e.target.closest('.chart-container') || e.target.closest('.modal-backdrop') ||
        e.target.closest('.workout-overlay') || e.target.closest('input') ||
        e.target.closest('textarea') || e.target.closest('.fatigue-sheet') ||
        e.target.closest('.choice-sheet') || e.target.closest('.workout-summary-sheet') ||
        e.target.closest('.leaderboard-sheet')) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    const elapsed = Date.now() - startTime;
    startX = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && elapsed < SWIPE_TIMEOUT_MS && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) {
      const idx = TAB_ORDER.indexOf(store.currentTab);
      if (dx < 0 && idx < TAB_ORDER.length - 1) switchToTab(TAB_ORDER[idx + 1], 'left');
      else if (dx > 0 && idx > 0) switchToTab(TAB_ORDER[idx - 1], 'right');
    }
  }, { passive: true });
})();

// ----- Step 10: Unit toggle handlers -----
document.querySelectorAll('.unit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b === btn));
    store.unit = btn.dataset.unit;
    localStorage.setItem(UNIT_KEY, store.unit);
    scheduleCloudSync();
    document.querySelectorAll('.unit-label').forEach(el => el.textContent = store.unit);
    updateDashboard();
    updatePreview();
    if (store.currentTab === 'history') renderHistory();
    if (store.currentTab === 'charts') renderChart();
    if (store.currentTab === 'stats') renderStats();
  });
});

initLogTab();
initHistoryTab();
initChartsTab();
initStatsTab();
initModalListeners();
initSheetListeners();
initLiftDetailSheet();
initAccessoryDetailSheet();
initPlateauSheet();
initSwipeToDelete();
initProgramSection();
initWorkoutOverlay();
initBuilderOverlay();
initMesocycleUI();
initWelcomeOverlay();
initSyncUI();
initLeaderboardTab();
initSettingsListeners();

// Timer presets
$('timer-presets').addEventListener('click', e => {
  const btn = e.target.closest('.timer-preset');
  if (!btn) return;
  $('timer-presets').querySelectorAll('.timer-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  startTimer(parseInt(btn.dataset.secs));
});
$('timer-custom')?.addEventListener('change', () => {
  const val = parseInt($('timer-custom').value);
  if (val >= TIMER_MIN_SECONDS && val <= TIMER_MAX_SECONDS) {
    $('timer-presets').querySelectorAll('.timer-preset').forEach(b => b.classList.remove('active'));
    startTimer(val);
  }
});

// "Start Workout" / choice sheet button
$('create-workout-btn').addEventListener('click', () => renderChoiceSheetBody());

updateDashboard();
renderCycleBar();
renderProgramSection();
updateWorkoutButton();

// Update timer preset active state
$('timer-presets').querySelectorAll('.timer-preset').forEach(b => {
  b.classList.toggle('active', parseInt(b.dataset.secs) === store.timerDuration);
});

// Resize handler for chart re-render (debounced)
let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => {
    if (store.currentTab === 'charts') renderChart();
  }, RESIZE_DEBOUNCE_MS);
});

// ----- Step 13: Auth listener (Firebase) — deferred, lazy SDK load -----
(async () => {
  try {
    await initFirebase(loadFirebaseConfig() || DEFAULT_FIREBASE_CONFIG);
    setupAuthListener();
    updateSyncButton();
  } catch (e) { console.warn('Firebase boot deferred or failed:', e); }
})();

// ----- Step 14: PWA init -----
try { initPWA(); } catch { /* ignore */ }

// ----- Step 15: Safe late init (deferred to after first paint) -----
_ric(() => {
  try { checkAutoRecap(); } catch (e) { console.warn('checkAutoRecap failed:', e); }
  try { checkComeback(); } catch (e) { console.warn('checkComeback failed:', e); }
  try { runCalibration(); } catch (e) { console.warn('runCalibration failed:', e); }
});
try { showWelcomeScreen(); } catch (e) { console.warn('showWelcomeScreen failed:', e); }

// ----- Step 16: Visibility change — flush sync & manage listener -----
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    store._flush();      // Flush any pending localStorage writes before tab goes away
    flushPendingSync();
    stopRealtimeSync(); // #4: detach listener when backgrounded
  } else {
    startRealtimeSync(); // #4: reattach when foregrounded
  }
});

initExercisePreview();
