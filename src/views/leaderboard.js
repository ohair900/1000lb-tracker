/**
 * Leaderboard ("Ranks") tab — multi-track social leaderboards.
 *
 * Four boards: Strength (sortable by lift/Wilks/DOTS, weight-class filter),
 * Streaks, Most Improved, Hall of Fame. Crew chip strip at the top scopes
 * all boards to invite-only groups when one is selected.
 *
 * All data comes from a single cached fetchLeaderboard() call. Tabs are
 * client-side filters / sorts of that pool.
 */

import store from '../state/store.js';
import { $, escapeHTML } from '../utils/helpers.js';
import { COLORS, LIFT_NAMES, IPF_CLASSES } from '../constants/lift-config.js';
import { LBS_PER_KG } from '../constants/formulas.js';
import { formatWeight as _fmt } from '../formulas/units.js';
import { calcWilks, calcDOTS } from '../formulas/scoring.js';
import { TOTAL_MILESTONES } from '../data/milestones.js';
import { fetchLeaderboard, fetchUserCrews, createCrew, joinCrew, leaveCrew } from '../firebase/sync.js';
import { currentUser } from '../firebase/auth.js';
import { openSheet, closeSheet, enableSheetSwipeDismiss } from '../ui/sheet.js';
import { showToast } from '../ui/toast.js';

const fmt = (v) => _fmt(Math.round(v));
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function openLeaderboardSheet() { openSheet('leaderboard-sheet', 'leaderboard-sheet-backdrop'); }
function closeLeaderboardSheet() { closeSheet('leaderboard-sheet', 'leaderboard-sheet-backdrop'); }

// ---------------------------------------------------------------------------
// Pool — apply crew filter to leaderboardData
// ---------------------------------------------------------------------------

function getPool() {
  const data = store.leaderboardData || [];
  if (!store.leaderboardCrewId) return data;
  const crew = (store.userCrews || []).find(c => c.id === store.leaderboardCrewId);
  if (!crew) return data;
  return data.filter(e => crew.memberUids.includes(e.uid));
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

export async function renderLeaderboard() {
  const container = $('leaderboard-list');
  if (!currentUser) {
    container.innerHTML = '<div class="empty-state" style="color:var(--text-dim);text-align:center;padding:32px 0">Sign in to view the leaderboard.</div>';
    $('lb-crew-strip').style.display = 'none';
    $('lb-controls').innerHTML = '';
    return;
  }

  container.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:32px 0">Loading...</div>';

  // Fire both fetches in parallel — leaderboard is required, crews are best-effort
  const [data, crews] = await Promise.all([
    fetchLeaderboard(),
    fetchUserCrews().catch(() => []),
  ]);
  store.leaderboardData = data;
  store.userCrews = crews;

  renderCrewStrip();
  renderActiveTab();
}

function renderActiveTab() {
  const tab = store.leaderboardTab || 'strength';
  // Sync tab strip active state
  document.querySelectorAll('.lb-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.lbTab === tab);
  });

  if (tab === 'strength') return renderStrengthTab();
  if (tab === 'streaks') return renderStreaksTab();
  if (tab === 'improved') return renderImprovedTab();
  if (tab === 'hall') return renderHallTab();
}

// ---------------------------------------------------------------------------
// Crew strip
// ---------------------------------------------------------------------------

function renderCrewStrip() {
  const strip = $('lb-crew-strip');
  const chips = $('lb-crew-chips');
  const crews = store.userCrews || [];
  // Always show strip (so Create/Join buttons are reachable even with 0 crews)
  strip.style.display = 'flex';

  let chipHtml = `<button class="lb-crew-chip${!store.leaderboardCrewId ? ' active' : ''}" data-lb-crew="">Global</button>`;
  crews.forEach(c => {
    const isActive = store.leaderboardCrewId === c.id;
    chipHtml += `<button class="lb-crew-chip${isActive ? ' active' : ''}" data-lb-crew="${c.id}" title="${escapeHTML(c.name)} — ${c.memberUids.length} members">${escapeHTML(c.name)}</button>`;
  });
  chips.innerHTML = chipHtml;
}

// ---------------------------------------------------------------------------
// Strength tab — sort + weight class + active filter + hot streak
// ---------------------------------------------------------------------------

function renderStrengthTab() {
  const sort = store.leaderboardFilter || 'total';
  const wc = store.leaderboardWeightClass;
  const activeOnly = !!store.leaderboardActiveOnly;

  // Controls: sort dropdown + weight class pills + active toggle
  const wcOptions = (() => {
    const gender = store.profile?.gender || 'male';
    const classes = IPF_CLASSES[gender] || IPF_CLASSES.male;
    return ['', ...classes.map(String), classes[classes.length - 1] + '+'];
  })();

  let controls = `<div class="lb-controls-row">
    <select id="lb-sort-select" class="lb-sort-select">
      <option value="total"${sort === 'total' ? ' selected' : ''}>Total</option>
      <option value="squat"${sort === 'squat' ? ' selected' : ''}>Squat</option>
      <option value="bench"${sort === 'bench' ? ' selected' : ''}>Bench</option>
      <option value="deadlift"${sort === 'deadlift' ? ' selected' : ''}>Deadlift</option>
      <option value="wilks"${sort === 'wilks' ? ' selected' : ''}>Wilks</option>
      <option value="dots"${sort === 'dots' ? ' selected' : ''}>DOTS</option>
    </select>
    <label class="lb-active-toggle"><input type="checkbox" id="lb-active-toggle" ${activeOnly ? 'checked' : ''}> Active 7d</label>
  </div>
  <div class="lb-wc-pills">
    ${wcOptions.map(c => {
      const label = c === '' ? 'All' : (c.endsWith('+') ? c : c + 'kg');
      const isActive = (wc || '') === c;
      return `<button class="lb-wc-pill${isActive ? ' active' : ''}" data-lb-wc="${c}">${label}</button>`;
    }).join('')}
  </div>`;
  $('lb-controls').innerHTML = controls;

  // Apply filters
  const now = Date.now();
  let pool = getPool().filter(e => (e[sort === 'wilks' ? 'wilks' : sort === 'dots' ? 'dots' : sort] || 0) > 0);
  if (wc) pool = pool.filter(e => e.weightClass === wc);
  if (activeOnly) pool = pool.filter(e => e.lastTrainedAt && (now - e.lastTrainedAt) <= 7 * MS_PER_DAY);

  const sorted = [...pool].sort((a, b) => (b[sort] || 0) - (a[sort] || 0));

  if (sorted.length === 0) {
    $('leaderboard-list').innerHTML = `<div class="empty-state" style="color:var(--text-dim);text-align:center;padding:32px 0">No lifters match these filters.</div>`;
    return;
  }

  let html = '';
  sorted.forEach((entry, i) => {
    const rank = i + 1;
    const isMe = entry.uid === currentUser?.uid;
    const medalClass = rank <= 3 ? ` rank-${rank}` : '';
    const valueLabel = (sort === 'wilks' || sort === 'dots')
      ? (entry[sort] != null ? entry[sort].toFixed(1) : '—')
      : fmt(entry[sort] || 0);
    const hotStreak = _isHotStreak(entry) ? '<span class="lb-hot-chip">🔥</span>' : '';
    const wcLabel = entry.weightClass ? ` <span class="lb-wc-label">${entry.weightClass}${entry.weightClass.endsWith('+') ? '' : 'kg'}</span>` : '';

    html += `<div class="lb-row${isMe ? ' lb-me' : ''}${medalClass}" data-uid="${entry.uid}">
      <div class="lb-rank">${rank}</div>
      <div class="lb-info">
        <div class="lb-top-line">
          <span class="lb-name">${escapeHTML(entry.displayName || 'Lifter')}${hotStreak}${wcLabel}</span>
          <span class="lb-total">${valueLabel}</span>
        </div>
        <div class="lb-lifts-line">
          <span style="color:${COLORS.squat}">SQ ${fmt(entry.squat || 0)}</span>
          <span style="color:${COLORS.bench}">BP ${fmt(entry.bench || 0)}</span>
          <span style="color:${COLORS.deadlift}">DL ${fmt(entry.deadlift || 0)}</span>
        </div>
      </div>
    </div>`;
  });
  $('leaderboard-list').innerHTML = html;
  _attachRowClicks();
}

function _isHotStreak(entry) {
  // 3+ recent PRs in last 30d → look at bestByLift dates
  const cutoff = Date.now() - 30 * MS_PER_DAY;
  let recent = 0;
  ['squat', 'bench', 'deadlift'].forEach(lift => {
    const sets = entry.bestByLift?.[lift] || [];
    sets.forEach(s => {
      const ts = s.date ? new Date(s.date + 'T12:00:00').getTime() : 0;
      if (ts >= cutoff) recent++;
    });
  });
  return recent >= 3;
}

// ---------------------------------------------------------------------------
// Streaks tab
// ---------------------------------------------------------------------------

function renderStreaksTab() {
  $('lb-controls').innerHTML = '';
  const pool = getPool().filter(e => (e.currentStreak || 0) > 0);
  const sorted = [...pool].sort((a, b) => {
    const d = (b.currentStreak || 0) - (a.currentStreak || 0);
    if (d !== 0) return d;
    return (b.longestStreak || 0) - (a.longestStreak || 0);
  });

  if (sorted.length === 0) {
    $('leaderboard-list').innerHTML = `<div class="empty-state" style="color:var(--text-dim);text-align:center;padding:32px 0">No active streaks yet.</div>`;
    return;
  }

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
          <span class="lb-total">${entry.currentStreak}d</span>
        </div>
        <div class="lb-lifts-line">
          <span style="color:var(--text-dim)">Best: ${entry.longestStreak || 0}d</span>
        </div>
      </div>
    </div>`;
  });
  $('leaderboard-list').innerHTML = html;
  _attachRowClicks();
}

// ---------------------------------------------------------------------------
// Most Improved tab
// ---------------------------------------------------------------------------

function renderImprovedTab() {
  const range = store.leaderboardImprovedRange || 30;
  $('lb-controls').innerHTML = `<div class="lb-controls-row">
    <button class="lb-range-pill${range === 30 ? ' active' : ''}" data-lb-range="30">30 days</button>
    <button class="lb-range-pill${range === 90 ? ' active' : ''}" data-lb-range="90" disabled style="opacity:0.4">90 days (soon)</button>
  </div>`;

  const pool = getPool().filter(e => (e.totalAt30dAgo || 0) > 0 && (e.total || 0) > (e.totalAt30dAgo || 0));
  const withGain = pool.map(e => {
    const gain = (e.total || 0) - (e.totalAt30dAgo || 0);
    const pct = (e.totalAt30dAgo || 0) > 0 ? (gain / e.totalAt30dAgo) * 100 : 0;
    return { ...e, _gain: gain, _pct: pct };
  });
  withGain.sort((a, b) => b._pct - a._pct);

  if (withGain.length === 0) {
    $('leaderboard-list').innerHTML = `<div class="empty-state" style="color:var(--text-dim);text-align:center;padding:32px 0">No improvement data yet — check back in a few weeks.</div>`;
    return;
  }

  let html = '';
  withGain.forEach((entry, i) => {
    const rank = i + 1;
    const isMe = entry.uid === currentUser?.uid;
    const medalClass = rank <= 3 ? ` rank-${rank}` : '';
    html += `<div class="lb-row${isMe ? ' lb-me' : ''}${medalClass}" data-uid="${entry.uid}">
      <div class="lb-rank">${rank}</div>
      <div class="lb-info">
        <div class="lb-top-line">
          <span class="lb-name">${escapeHTML(entry.displayName || 'Lifter')}</span>
          <span class="lb-total" style="color:var(--green)">+${entry._pct.toFixed(1)}%</span>
        </div>
        <div class="lb-lifts-line">
          <span style="color:var(--text-dim)">+${fmt(entry._gain)} ${store.unit} &middot; now ${fmt(entry.total)}</span>
        </div>
      </div>
    </div>`;
  });
  $('leaderboard-list').innerHTML = html;
  _attachRowClicks();
}

// ---------------------------------------------------------------------------
// Hall of Fame tab — milestone clubs
// ---------------------------------------------------------------------------

function renderHallTab() {
  $('lb-controls').innerHTML = '';
  const pool = getPool().filter(e => Array.isArray(e.milestones) && e.milestones.length > 0);

  // Group by milestone (largest first — 2000, 1500, ..., 500)
  const byMilestone = {};
  TOTAL_MILESTONES.forEach(m => { byMilestone[m] = []; });
  pool.forEach(e => {
    e.milestones.forEach(m => {
      if (byMilestone[m.total]) byMilestone[m.total].push({ ...e, _achievedAt: m.achievedAt });
    });
  });

  // Sort each club by achievedAt desc
  Object.values(byMilestone).forEach(arr => arr.sort((a, b) => (b._achievedAt || '').localeCompare(a._achievedAt || '')));

  let html = '';
  const milestonesDesc = [...TOTAL_MILESTONES].sort((a, b) => b - a);
  let anyShown = false;
  milestonesDesc.forEach(m => {
    const club = byMilestone[m] || [];
    if (club.length === 0) return;
    anyShown = true;
    html += `<div class="lb-hall-club">
      <div class="lb-hall-club-header">${m} Club <span class="lb-hall-count">${club.length}</span></div>`;
    club.forEach(entry => {
      const isMe = entry.uid === currentUser?.uid;
      html += `<div class="lb-hall-row${isMe ? ' lb-me' : ''}" data-uid="${entry.uid}">
        <span class="lb-name">${escapeHTML(entry.displayName || 'Lifter')}</span>
        <span class="lb-hall-total">${fmt(entry.total)}</span>
        <span class="lb-hall-date">${_fmtMilestoneDate(entry._achievedAt)}</span>
      </div>`;
    });
    html += `</div>`;
  });

  if (!anyShown) {
    $('leaderboard-list').innerHTML = `<div class="empty-state" style="color:var(--text-dim);text-align:center;padding:32px 0">No milestones reached yet.</div>`;
    return;
  }
  $('leaderboard-list').innerHTML = html;
  _attachRowClicks('.lb-hall-row');
}

function _fmtMilestoneDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Lifter detail sheet (with You vs Them)
// ---------------------------------------------------------------------------

function _attachRowClicks(selector = '.lb-row') {
  document.querySelectorAll('#leaderboard-list ' + selector).forEach(row => {
    row.addEventListener('click', () => showLifterDetail(row.dataset.uid));
  });
}

function showLifterDetail(uid) {
  const entry = (store.leaderboardData || []).find(e => e.uid === uid);
  if (!entry) return;

  $('leaderboard-sheet-title').textContent = entry.displayName || 'Lifter';

  let html = '';

  // You vs Them comparison (only when viewing someone else)
  const me = (store.leaderboardData || []).find(e => e.uid === currentUser?.uid);
  if (me && entry.uid !== currentUser?.uid) {
    html += _renderCompare(me, entry);
  }

  // Overall classification
  const overall = entry.classifications?.overall;
  if (overall) html += `<div class="lb-classification ${overall}">${overall}</div>`;

  // Summary cards
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

  // Best 3 sets per lift
  const bestByLift = entry.bestByLift || {};
  ['squat', 'bench', 'deadlift'].forEach(lift => {
    const sets = bestByLift[lift];
    if (!sets || sets.length === 0) return;
    html += `<div class="lb-lift-section">
      <div class="lb-lift-section-title" style="color:${COLORS[lift]}">Best ${LIFT_NAMES[lift]}</div>`;
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

function _renderCompare(me, them) {
  const lifts = ['squat', 'bench', 'deadlift'];
  let rows = '';
  lifts.forEach(lift => {
    const myV = me[lift] || 0;
    const theirV = them[lift] || 0;
    const gap = theirV - myV;
    const gapStr = gap === 0 ? '' : (gap > 0 ? `<span class="lb-cmp-gap-up">+${fmt(gap)}</span>` : `<span class="lb-cmp-gap-down">${fmt(gap)}</span>`);
    rows += `<div class="lb-cmp-row">
      <span class="lb-cmp-label">${LIFT_NAMES[lift]}</span>
      <span class="lb-cmp-mine">${fmt(myV)}</span>
      <span class="lb-cmp-theirs">${fmt(theirV)} ${gapStr}</span>
    </div>`;
  });
  const myTotal = me.total || 0;
  const theirTotal = them.total || 0;
  const totalGap = theirTotal - myTotal;
  const totalGapStr = totalGap === 0 ? '' : (totalGap > 0 ? `<span class="lb-cmp-gap-up">+${fmt(totalGap)}</span>` : `<span class="lb-cmp-gap-down">${fmt(totalGap)}</span>`);
  rows += `<div class="lb-cmp-row lb-cmp-total">
    <span class="lb-cmp-label">Total</span>
    <span class="lb-cmp-mine">${fmt(myTotal)}</span>
    <span class="lb-cmp-theirs">${fmt(theirTotal)} ${totalGapStr}</span>
  </div>`;

  // Catch-up projection
  let catchUp = '';
  if (totalGap > 0 && me.totalAt30dAgo > 0) {
    const myMonthlyGain = (me.total - me.totalAt30dAgo);
    if (myMonthlyGain > 0) {
      const months = totalGap / myMonthlyGain;
      if (months <= 60) {
        const weeks = Math.round(months * 4.33);
        catchUp = `<div class="lb-cmp-catchup">At your 30-day rate, you'll catch ${escapeHTML(them.displayName || 'them')} in ~${weeks} weeks.</div>`;
      } else {
        catchUp = `<div class="lb-cmp-catchup">Out of reach for now — keep grinding.</div>`;
      }
    }
  } else if (totalGap <= 0) {
    catchUp = `<div class="lb-cmp-catchup">You're ahead by ${fmt(-totalGap)} ${store.unit}.</div>`;
  }

  return `<div class="lb-cmp-panel">
    <div class="lb-cmp-header">
      <span class="lb-cmp-col-label">You</span>
      <span class="lb-cmp-col-label">${escapeHTML(them.displayName || 'Lifter')}</span>
    </div>
    ${rows}
    ${catchUp}
  </div>`;
}

// ---------------------------------------------------------------------------
// Init / event wiring
// ---------------------------------------------------------------------------

export function initLeaderboardTab() {
  // Tab strip
  $('lb-tab-strip').addEventListener('click', (e) => {
    const t = e.target.closest('[data-lb-tab]');
    if (!t) return;
    store.leaderboardTab = t.dataset.lbTab;
    renderActiveTab();
  });

  // Per-tab controls (delegated)
  $('lb-controls').addEventListener('click', (e) => {
    const wc = e.target.closest('[data-lb-wc]');
    if (wc) {
      store.leaderboardWeightClass = wc.dataset.lbWc || null;
      renderStrengthTab();
      return;
    }
    const range = e.target.closest('[data-lb-range]');
    if (range && !range.disabled) {
      store.leaderboardImprovedRange = parseInt(range.dataset.lbRange, 10);
      renderImprovedTab();
      return;
    }
  });
  $('lb-controls').addEventListener('change', (e) => {
    if (e.target.id === 'lb-sort-select') {
      store.leaderboardFilter = e.target.value;
      renderStrengthTab();
    } else if (e.target.id === 'lb-active-toggle') {
      store.leaderboardActiveOnly = e.target.checked;
      renderStrengthTab();
    }
  });

  // Crew strip
  $('lb-crew-chips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-lb-crew]');
    if (!chip) return;
    store.leaderboardCrewId = chip.dataset.lbCrew || null;
    renderCrewStrip();
    renderActiveTab();
  });

  // Crew create / join modal triggers
  $('lb-crew-create-btn').addEventListener('click', () => {
    $('crew-create-name').value = '';
    $('crew-create-modal').style.display = 'flex';
    setTimeout(() => $('crew-create-name').focus(), 50);
  });
  $('lb-crew-join-btn').addEventListener('click', () => {
    $('crew-join-code').value = '';
    $('crew-join-modal').style.display = 'flex';
    setTimeout(() => $('crew-join-code').focus(), 50);
  });
  $('crew-create-close').addEventListener('click', () => $('crew-create-modal').style.display = 'none');
  $('crew-join-close').addEventListener('click', () => $('crew-join-modal').style.display = 'none');
  $('crew-create-submit').addEventListener('click', async () => {
    const name = $('crew-create-name').value.trim();
    if (!name) { showToast('Enter a crew name'); return; }
    try {
      const crew = await createCrew(name);
      $('crew-create-modal').style.display = 'none';
      showToast(`${crew.name} created — code: ${crew.inviteCode}`);
      renderCrewStrip();
    } catch (err) {
      showToast(err.message || 'Could not create crew');
    }
  });
  $('crew-join-submit').addEventListener('click', async () => {
    const code = $('crew-join-code').value.trim();
    if (!code) { showToast('Enter an invite code'); return; }
    try {
      const crew = await joinCrew(code);
      $('crew-join-modal').style.display = 'none';
      showToast(`Joined ${crew.name}`);
      renderCrewStrip();
      renderActiveTab();
    } catch (err) {
      showToast(err.message || 'Could not join crew');
    }
  });

  // Long-press a crew chip to leave
  let _crewPressTimer = null;
  $('lb-crew-chips').addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('[data-lb-crew]');
    if (!chip || !chip.dataset.lbCrew) return;
    _crewPressTimer = setTimeout(async () => {
      const crewId = chip.dataset.lbCrew;
      const crew = (store.userCrews || []).find(c => c.id === crewId);
      if (!crew) return;
      if (confirm(`Leave ${crew.name}?`)) {
        try {
          await leaveCrew(crewId);
          if (store.leaderboardCrewId === crewId) store.leaderboardCrewId = null;
          renderCrewStrip();
          renderActiveTab();
          showToast(`Left ${crew.name}`);
        } catch (err) {
          showToast(err.message || 'Could not leave crew');
        }
      }
    }, 600);
  });
  $('lb-crew-chips').addEventListener('pointerup', () => clearTimeout(_crewPressTimer));
  $('lb-crew-chips').addEventListener('pointerleave', () => clearTimeout(_crewPressTimer));

  // Sheet close
  $('leaderboard-sheet-close').addEventListener('click', closeLeaderboardSheet);
  $('leaderboard-sheet-backdrop').addEventListener('click', closeLeaderboardSheet);
  enableSheetSwipeDismiss('leaderboard-sheet', 'leaderboard-sheet-backdrop', closeLeaderboardSheet);
}
