/**
 * Leaderboard ("Ranks") tab — displays a ranked list of all users by
 * top e1RM, with a detail sheet for viewing individual lifter stats.
 */

import store from '../state/store.js';
import { $, escapeHTML } from '../utils/helpers.js';
import { COLORS, LIFT_NAMES } from '../constants/lift-config.js';
import { formatWeight as _fmt } from '../formulas/units.js';
import { fetchLeaderboard } from '../firebase/sync.js';

/** Format weight rounded to nearest whole number. */
const fmt = (v) => _fmt(Math.round(v));
import { currentUser } from '../firebase/auth.js';
import { openSheet, closeSheet, enableSheetSwipeDismiss } from '../ui/sheet.js';

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function openLeaderboardSheet() {
  openSheet('leaderboard-sheet', 'leaderboard-sheet-backdrop');
}

function closeLeaderboardSheet() {
  closeSheet('leaderboard-sheet', 'leaderboard-sheet-backdrop');
}

// ---------------------------------------------------------------------------
// Render leaderboard list
// ---------------------------------------------------------------------------

/**
 * Fetch and render the leaderboard.  Called each time the user switches
 * to the Ranks tab.
 */
export async function renderLeaderboard() {
  const container = $('leaderboard-list');

  if (!currentUser) {
    container.innerHTML = '<div class="empty-state" style="color:var(--text-dim);text-align:center;padding:32px 0">Sign in to view the leaderboard.</div>';
    return;
  }

  container.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:32px 0">Loading...</div>';

  const data = await fetchLeaderboard();
  store.leaderboardData = data;

  // Filter out users with 0 total
  const filtered = data.filter(e => (e.total || 0) > 0);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state" style="color:var(--text-dim);text-align:center;padding:32px 0">No lifters on the board yet.</div>';
    return;
  }

  const sortField = store.leaderboardFilter;
  const sorted = [...filtered].sort((a, b) => (b[sortField] || 0) - (a[sortField] || 0));

  let html = '';
  sorted.forEach((entry, i) => {
    const rank = i + 1;
    const isMe = entry.uid === currentUser?.uid;
    const medalClass = rank <= 3 ? ` rank-${rank}` : '';

    html += `<div class="lb-row${isMe ? ' lb-me' : ''}${medalClass}" data-uid="${entry.uid}">
      <div class="lb-rank">${rank}</div>
      <div class="lb-info">
        <div class="lb-top-line">
          <span class="lb-name">${escapeHTML(entry.displayName || 'Lifter')}</span>
          <span class="lb-total">${fmt(entry.total || 0)}</span>
        </div>
        <div class="lb-lifts-line">
          <span style="color:${COLORS.squat}">SQ ${fmt(entry.squat || 0)}</span>
          <span style="color:${COLORS.bench}">BP ${fmt(entry.bench || 0)}</span>
          <span style="color:${COLORS.deadlift}">DL ${fmt(entry.deadlift || 0)}</span>
        </div>
      </div>
    </div>`;
  });

  container.innerHTML = html;

  // Tap to show detail
  container.querySelectorAll('.lb-row').forEach(row => {
    row.addEventListener('click', () => showLifterDetail(row.dataset.uid));
  });
}

// ---------------------------------------------------------------------------
// Lifter detail sheet
// ---------------------------------------------------------------------------

function showLifterDetail(uid) {
  const entry = store.leaderboardData.find(e => e.uid === uid);
  if (!entry) return;

  $('leaderboard-sheet-title').textContent = entry.displayName || 'Lifter';

  let html = '';

  // Overall classification badge
  const overall = entry.classifications?.overall;
  if (overall) {
    html += `<div class="lb-classification ${overall}">${overall}</div>`;
  }

  // Summary cards: SQ / BP / DL / Total
  html += '<div class="lb-detail-grid">';
  ['squat', 'bench', 'deadlift'].forEach(lift => {
    const cls = entry.classifications?.[lift];
    html += `<div class="lb-detail-card" style="border-top-color:${COLORS[lift]}">
      <div class="lb-detail-label">${LIFT_NAMES[lift]}</div>
      <div class="lb-detail-value">${fmt(entry[lift] || 0)}</div>
      ${cls ? `<div class="lb-detail-class">${cls}</div>` : ''}
    </div>`;
  });
  html += `<div class="lb-detail-card" style="border-top-color:var(--total)">
    <div class="lb-detail-label">Total</div>
    <div class="lb-detail-value">${fmt(entry.total || 0)}</div>
  </div>`;
  html += '</div>';

  // Best 3 sets per lift (highest e1RM)
  const bestByLift = entry.bestByLift || {};
  ['squat', 'bench', 'deadlift'].forEach(lift => {
    const sets = bestByLift[lift];
    if (!sets || sets.length === 0) return;

    html += `<div class="lb-lift-section">`;
    html += `<div class="lb-lift-section-title" style="color:${COLORS[lift]}">Best ${LIFT_NAMES[lift]}</div>`;
    sets.forEach(s => {
      html += `<div class="lb-recent-row">
        <span class="lb-recent-detail">${fmt(s.weight)} x ${s.reps}</span>
        <span class="lb-recent-e1rm">e1RM ${fmt(s.e1rm)}</span>
        <span class="lb-recent-date">${s.date || ''}</span>
      </div>`;
    });
    html += '</div>';
  });

  $('leaderboard-sheet-body').innerHTML = html;
  openLeaderboardSheet();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

/**
 * One-time listener setup for the leaderboard tab.
 * Call once after DOMContentLoaded.
 */
export function initLeaderboardTab() {
  // Filter pills
  $('leaderboard-filter-pills').addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    $('leaderboard-filter-pills').querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    store.leaderboardFilter = pill.dataset.lbFilter;
    renderLeaderboard();
  });

  // Sheet close
  $('leaderboard-sheet-close').addEventListener('click', closeLeaderboardSheet);
  $('leaderboard-sheet-backdrop').addEventListener('click', closeLeaderboardSheet);
  enableSheetSwipeDismiss('leaderboard-sheet', 'leaderboard-sheet-backdrop', closeLeaderboardSheet);
}
