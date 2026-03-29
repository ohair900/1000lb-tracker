/**
 * Settings modal view — profile editing, goal setting, dashboard widget
 * toggles, data export/import/clear, and related event wiring.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFTS, COLORS, LIFT_NAMES } from '../constants/lift-config.js';
import {
  UNIT_KEY, DASH_WIDGETS_KEY, ACCENT_KEY, VERSION_KEY,
  TOTAL_CELEBRATED_KEY, ALL_DATA_KEYS
} from '../constants/storage-keys.js';
import { CURRENT_VERSION } from '../constants/time.js';
import { bestE1RM, getTotal } from '../formulas/e1rm.js';
import { displayWeight, formatWeight, inputToLbs } from '../formulas/units.js';
import { getWeightClass } from '../formulas/standards.js';
import { rebuildPRs } from '../systems/pr-tracking.js';
import { showToast } from '../ui/toast.js';
import { openModal, closeModal } from '../ui/modal.js';
import { applyTheme, applyAccentColor } from '../ui/theme.js';
import { buildProfileHTML, buildGoalsHTML } from './stats.js';

// ---------------------------------------------------------------------------
// Late-bound callbacks
// ---------------------------------------------------------------------------

let _updateDashboard = null;
let _renderHistory = null;
let _renderChart = null;
let _renderStats = null;
let _renderCycleBar = null;
let _renderProgramSection = null;
let _updateWorkoutButton = null;
let _dismissTimer = null;
let _scheduleCloudSync = null;

/**
 * Inject view-level dependencies.
 * @param {object} deps
 */
export function injectSettingsDeps(deps) {
  if (deps.updateDashboard) _updateDashboard = deps.updateDashboard;
  if (deps.renderHistory) _renderHistory = deps.renderHistory;
  if (deps.renderChart) _renderChart = deps.renderChart;
  if (deps.renderStats) _renderStats = deps.renderStats;
  if (deps.renderCycleBar) _renderCycleBar = deps.renderCycleBar;
  if (deps.renderProgramSection) _renderProgramSection = deps.renderProgramSection;
  if (deps.updateWorkoutButton) _updateWorkoutButton = deps.updateWorkoutButton;
  if (deps.dismissTimer) _dismissTimer = deps.dismissTimer;
  if (deps.scheduleCloudSync) _scheduleCloudSync = deps.scheduleCloudSync;
}

function scheduleCloudSync() {
  if (_scheduleCloudSync) _scheduleCloudSync();
}

// ---------------------------------------------------------------------------
// Settings body renderer
// ---------------------------------------------------------------------------

const sectionLabel = text => `<div class="section-label-lg">${text}</div>`;
const settingsDivider = '<hr style="border:none;border-top:1px solid var(--border);margin:14px 0">';

/**
 * Render the settings modal body HTML.
 * @returns {string} HTML string
 */
export function renderSettingsBody() {
  const total = getTotal();
  let html = '';
  // Profile
  html += sectionLabel('Profile');
  html += buildProfileHTML();
  html += settingsDivider;
  // Goals
  html += sectionLabel('Goals');
  html += buildGoalsHTML(total);
  html += settingsDivider;
  // Dashboard
  html += sectionLabel('Dashboard Widgets');
  html += `<label class="widget-toggle"><input type="checkbox" data-widget="ratios" ${store.dashboardWidgets.ratios ? 'checked' : ''}> Strength Ratios</label>
    <label class="widget-toggle"><input type="checkbox" data-widget="fatigue" ${store.dashboardWidgets.fatigue ? 'checked' : ''}> Fatigue Indicator</label>
    <label class="widget-toggle"><input type="checkbox" data-widget="streak" ${store.dashboardWidgets.streak ? 'checked' : ''}> Streak Tracker</label>
    <label class="widget-toggle"><input type="checkbox" data-widget="recap" ${store.dashboardWidgets.recap ? 'checked' : ''}> Weekly Recap</label>
    <label class="widget-toggle" style="margin-bottom:12px"><input type="checkbox" data-widget="prStreak" ${store.dashboardWidgets.prStreak ? 'checked' : ''}> PR Tracker</label>`;
  html += settingsDivider;
  // Data
  html += sectionLabel('Data');
  html += `<div class="data-row" style="margin-bottom:12px">
      <button class="data-btn" id="s-export">Export JSON</button>
      <button class="data-btn" id="s-export-csv">Export CSV</button>
      <button class="data-btn" id="s-import">Import JSON</button>
    </div>
    <button class="data-btn danger" id="s-clear" style="width:100%">Clear All Data</button>`;
  return html;
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

function exportData() {
  const data = {
    version: CURRENT_VERSION,
    entries: store.entries,
    profile: store.profile,
    goals: store.goals,
    prs: store.prs,
    cycles: store.cycles,
    programs: store.programConfig,
    unit: localStorage.getItem(UNIT_KEY) || 'lbs',
    theme: store.theme,
    badges: store.unlockedBadges,
    dashboardWidgets: store.dashboardWidgets,
    accentColor: store.accentColor,
    celebratedTotals: JSON.parse(localStorage.getItem(TOTAL_CELEBRATED_KEY) || '{}'),
    workoutConfig: store.workoutConfig,
    accessoryLog: store.accessoryLog,
    customTemplates: store.customTemplates,
    activeMesocycle: store.activeMesocycle,
    mesocycleHistory: store.mesocycleHistory
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `1000lb-tracker-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported');
}

function exportCSV() {
  const headers = ['Date', 'Lift', 'Weight', 'Reps', 'e1RM', 'RPE', 'Notes', 'Tags', 'PR', 'Bodyweight'];
  const sorted = [...store.entries].sort((a, b) => a.timestamp - b.timestamp);
  const rows = sorted.map(e => {
    const notes = (e.notes || '').replace(/"/g, '""');
    const tags = (e.tags || []).join('; ');
    return [
      e.date,
      LIFT_NAMES[e.lift],
      formatWeight(e.weight),
      e.reps,
      formatWeight(e.e1rm),
      e.rpe !== null && e.rpe !== undefined ? e.rpe : '',
      `"${notes}"`,
      `"${tags}"`,
      e.isPR ? 'Yes' : '',
      e.bodyweight ? formatWeight(e.bodyweight) : ''
    ].join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `1000lb-tracker-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported');
}

function handleImport(ev) {
  try {
    const data = JSON.parse(ev.target.result);
    if (!data.entries || !Array.isArray(data.entries)) throw new Error('Invalid format');
    store.entries = data.entries;
    if (data.profile) store.profile = data.profile;
    if (data.goals) store.goals = data.goals;
    if (data.prs) store.prs = data.prs;
    if (data.cycles) store.cycles = data.cycles;
    if (data.programs) { store.programConfig = data.programs; store.saveProgramConfig(); }
    if (data.unit) { store.unit = data.unit; localStorage.setItem(UNIT_KEY, store.unit); }
    if (data.theme) { store.theme = data.theme; applyTheme(); }
    if (data.badges) { store.unlockedBadges = data.badges; localStorage.setItem('sbd-tracker-badges', JSON.stringify(store.unlockedBadges)); }
    if (data.dashboardWidgets) { store.dashboardWidgets = { ...store.dashboardWidgets, ...data.dashboardWidgets }; localStorage.setItem(DASH_WIDGETS_KEY, JSON.stringify(store.dashboardWidgets)); }
    if (data.accentColor) { store.accentColor = data.accentColor; localStorage.setItem(ACCENT_KEY, store.accentColor); applyAccentColor(); }
    if (data.celebratedTotals) { localStorage.setItem(TOTAL_CELEBRATED_KEY, JSON.stringify(data.celebratedTotals)); }
    if (data.workoutConfig) { store.workoutConfig = data.workoutConfig; store.save('workoutConfig'); }
    if (data.accessoryLog) { store.accessoryLog = data.accessoryLog; store.saveAccessoryLog(); }
    if (data.customTemplates) { store.customTemplates = data.customTemplates; store.saveCustomTemplates(); }
    if (data.activeMesocycle) { store.activeMesocycle = data.activeMesocycle; store.saveMesocycle(); }
    if (data.mesocycleHistory) { store.mesocycleHistory = data.mesocycleHistory; store.saveMesocycleHistory(); }
    if (!store.profile.bodyweightHistory) store.profile.bodyweightHistory = [];
    store.activeCycleId = (store.cycles.find(c => c.active) || {}).id || null;
    localStorage.setItem(VERSION_KEY, CURRENT_VERSION.toString());
    rebuildPRs();
    store.saveAll();
    // Re-init UI
    document.querySelectorAll('.unit-btn').forEach(b => b.classList.toggle('active', b.dataset.unit === store.unit));
    document.querySelectorAll('.unit-label').forEach(el => el.textContent = store.unit);
    if (_updateDashboard) _updateDashboard();
    if (_renderCycleBar) _renderCycleBar();
    if (_renderProgramSection) _renderProgramSection();
    if (_updateWorkoutButton) _updateWorkoutButton();
    if (store.currentTab === 'history' && _renderHistory) _renderHistory();
    if (store.currentTab === 'charts' && _renderChart) _renderChart();
    if (store.currentTab === 'stats' && _renderStats) _renderStats();
    closeModal('settings-modal');
    showToast('Data imported');
  } catch (err) {
    showToast('Import failed: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Attach settings listeners
// ---------------------------------------------------------------------------

/**
 * Attach event listeners to the rendered settings body.
 * Called after renderSettingsBody() populates #settings-body.
 */
export function attachSettingsListeners() {
  const body = $('settings-body');

  // Gender pills
  body.querySelectorAll('.gender-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.gender-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      store.profile.gender = btn.dataset.gender;
      store.saveProfile();
      if (_updateDashboard) _updateDashboard();
    });
  });

  // Bodyweight log
  const bwLogBtn = body.querySelector('#bw-log-btn');
  if (bwLogBtn) {
    bwLogBtn.addEventListener('click', () => {
      const v = parseFloat($('bw-input').value);
      if (!(v > 0)) return;
      const bwLbs = inputToLbs(v);
      store.profile.bodyweight = bwLbs;
      const now = new Date();
      store.profile.bodyweightHistory.push({
        date: now.toISOString().split('T')[0],
        weight: bwLbs,
        timestamp: now.getTime()
      });
      store.saveProfile();
      if (_updateDashboard) _updateDashboard();
      showToast('Bodyweight logged');
    });
  }

  // Goal inputs
  body.querySelectorAll('.goal-input').forEach(input => {
    input.addEventListener('change', () => {
      const lift = input.dataset.lift;
      const v = parseFloat(input.value);
      store.goals[lift] = v > 0 ? inputToLbs(v) : null;
      store.saveGoals();
      if (_updateDashboard) _updateDashboard();
      // Re-render settings body so roadmap updates live
      body.innerHTML = renderSettingsBody();
      attachSettingsListeners();
    });
  });

  // Dashboard widget toggles
  body.querySelectorAll('[data-widget]').forEach(cb => {
    cb.addEventListener('change', () => {
      store.dashboardWidgets[cb.dataset.widget] = cb.checked;
      localStorage.setItem(DASH_WIDGETS_KEY, JSON.stringify(store.dashboardWidgets));
      scheduleCloudSync();
      if (_updateDashboard) _updateDashboard();
    });
  });

  // Data management
  $('s-export').addEventListener('click', exportData);
  $('s-export-csv').addEventListener('click', exportCSV);
  $('s-import').addEventListener('click', () => $('import-file').click());
  $('s-clear').addEventListener('click', function () {
    if (!store.clearConfirm) {
      store.clearConfirm = true;
      this.textContent = 'Are you sure? Click again to confirm';
      return;
    }
    ALL_DATA_KEYS.forEach(k => localStorage.removeItem(k));
    store.entries = []; store.prs = []; store.cycles = [];
    store.statsCollapsed = {};
    store.timerDuration = 180;
    store.profile = { gender: null, bodyweight: null, bodyweightHistory: [] };
    store.goals = { squat: null, bench: null, deadlift: null, total: null };
    store.activeCycleId = null; store.lastLoggedSet = null;
    store.programConfig = { activeProgram: null, trainingMaxes: {}, liftWeeks: { squat: 1, bench: 1, deadlift: 1 }, completedSets: {}, amrapResults: {}, tmHistory: [], autoProgressEnabled: true, completedWeeks: {}, weekStreak: 0, progressedCycles: {} };
    store.unlockedBadges = {};
    store.workoutConfig = { weakPoints: { squat: null, bench: null, deadlift: null }, setupComplete: false };
    store.accessoryLog = []; store.workoutSession = null;
    store.customTemplates = []; store.activeMesocycle = null; store.mesocycleHistory = [];
    store.dashboardWidgets = { ratios: true, fatigue: true, streak: true, recap: true, prStreak: true };
    store.accentColor = 'gold'; applyAccentColor();
    closeModal('settings-modal');
    if (_updateDashboard) _updateDashboard();
    if (_renderCycleBar) _renderCycleBar();
    if (_renderProgramSection) _renderProgramSection();
    if (_updateWorkoutButton) _updateWorkoutButton();
    $('repeat-btn').classList.remove('visible');
    if (_dismissTimer) _dismissTimer();
    showToast('All data cleared');
  });
}

// ---------------------------------------------------------------------------
// initSettingsListeners — one-time gear-btn and import-file listeners
// ---------------------------------------------------------------------------

/**
 * Set up the gear button click handler and import-file change handler.
 * Call once after DOMContentLoaded.
 */
export function initSettingsListeners() {
  $('gear-btn').addEventListener('click', () => {
    store.clearConfirm = false;
    const body = $('settings-body');
    body.innerHTML = renderSettingsBody();
    openModal('settings-modal');
    attachSettingsListeners();
  });

  $('import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = handleImport;
    reader.readAsText(file);
    e.target.value = '';
  });
}
