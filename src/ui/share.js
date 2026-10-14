/**
 * Shareable card generation and sharing utilities.
 *
 * Generates canvas-based images for:
 *   - PR cards (single-lift personal records)
 *   - Milestone cards (total achievements like 1000 lb club)
 *
 * Uses the Web Share API when available; falls back to a download link.
 */

import store from '../state/store.js';
import { $, escapeHTML } from '../utils/helpers.js';
import { COLORS, LIFT_NAMES } from '../constants/lift-config.js';
import { SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT } from '../constants/thresholds.js';
import { TOTAL_MILESTONE_THEMES } from '../data/milestones.js';
import { formatWeight, lbsToKg } from '../formulas/units.js';
import { getTotal } from '../formulas/e1rm.js';
import { calcWilks } from '../formulas/scoring.js';
import { showToast } from './toast.js';
import { trapFocus, releaseFocus } from './focus-trap.js';

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

/**
 * Create a canvas with a dark rounded-rect background.
 *
 * @param {number} w - Width in pixels
 * @param {number} h - Height in pixels
 * @returns {{ canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }}
 */
export function createCardCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 16);
  ctx.fill();
  return { canvas: c, ctx };
}

/**
 * Draw the "1000LB CLUB TRACKER" branding text at the bottom of a card.
 */
export function drawCardBranding(ctx, y) {
  ctx.font = 'bold 12px -apple-system, sans-serif';
  ctx.fillStyle = '#444';
  ctx.textAlign = 'center';
  ctx.fillText('1000LB CLUB TRACKER', 300, y);
  // Gold accent line under branding
  ctx.fillStyle = '#fdd835';
  ctx.fillRect(240, y + 4, 120, 1.5);
  // Tri-color S/B/D bar
  ctx.fillStyle = '#e53935';
  ctx.fillRect(240, y + 7, 40, 1.5);
  ctx.fillStyle = '#1e88e5';
  ctx.fillRect(280, y + 7, 40, 1.5);
  ctx.fillStyle = '#43a047';
  ctx.fillRect(320, y + 7, 40, 1.5);
}

/**
 * Draw a formatted date line on a card.
 */
export function drawCardDate(ctx, w, y, date) {
  ctx.font = '14px -apple-system, sans-serif';
  ctx.fillStyle = '#555';
  ctx.textAlign = 'center';
  ctx.fillText(
    date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    w / 2,
    y
  );
}

/**
 * Draw a Wilks score line if the user has bodyweight and gender set.
 * @returns {number} Vertical space consumed (0 if nothing drawn)
 */
export function drawCardWilks(ctx, cx, y) {
  if (store.profile.bodyweight && store.profile.gender) {
    const total = getTotal();
    if (total) {
      const tKg = lbsToKg(total);
      const bKg = lbsToKg(store.profile.bodyweight);
      const w = calcWilks(tKg, bKg, store.profile.gender);
      if (w) {
        ctx.font = '18px -apple-system, sans-serif';
        ctx.fillStyle = '#aaa';
        ctx.textAlign = 'center';
        ctx.fillText('Wilks: ' + Math.round(w), cx, y);
        return 28;
      }
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Share / download
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workout code sharing
// ---------------------------------------------------------------------------

/** Public origin used for share links. */
export const SHARE_LINK_ORIGIN = 'https://1000lbtracker.com';

/**
 * Build the shareable link for a workout code.
 * Format: https://1000lbtracker.com/#workout/CODE
 * The `#workout/:id` router route distinguishes 6-char codes from lift keys.
 * @param {string} code - 6-character share code
 */
export function buildShareLink(code) {
  return `${SHARE_LINK_ORIGIN}/#workout/${code}`;
}

/**
 * Copy text to the clipboard, with a textarea+execCommand fallback for
 * browsers/contexts where the async Clipboard API is unavailable.
 * @param {string} text
 * @returns {Promise<boolean>} whether the copy succeeded
 */
export async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

/**
 * One-line summary of what's being shared: workout name + exercise count.
 * @param {object} session - the host's workoutSession
 */
export function buildShareSummary(session) {
  if (!session) return 'Workout';
  const liftName = LIFT_NAMES[session.mainLift] || session.mainLift || 'Workout';
  const mainSets = (session.mainSets || []).length + (session.bbbSets || []).length;
  const accessories = (session.accessories || []).length;
  const exercises = accessories + (mainSets > 0 ? 1 : 0);
  const parts = [];
  if (exercises > 0) parts.push(`${exercises} exercise${exercises === 1 ? '' : 's'}`);
  if (mainSets > 0) parts.push(`${mainSets} set${mainSets === 1 ? '' : 's'}`);
  return `${liftName} workout${parts.length ? ' · ' + parts.join(' · ') : ''}`;
}

/**
 * Show the host's share sheet: a bottom sheet with the full share link,
 * the 6-char code (big and copyable), a Copy Link button, and a one-line
 * summary of what's shared. Fully async — no blocking dialogs.
 *
 * @param {string} code - 6-character share code
 */
export function shareWorkoutCode(code) {
  const link = buildShareLink(code);
  const summary = buildShareSummary(store.workoutSession);

  // Dismiss any existing share sheet first.
  document.getElementById('share-workout-backdrop')?.remove();
  document.getElementById('share-workout-sheet')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.id = 'share-workout-backdrop';

  const sheet = document.createElement('div');
  sheet.className = 'sheet-panel share-workout-sheet';
  sheet.id = 'share-workout-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Share workout');

  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-header">
      <h3>Share this workout</h3>
      <button class="modal-close" type="button" id="share-workout-close" aria-label="Close">&times;</button>
    </div>
    <div class="sheet-body">
      <div class="share-workout-summary">${escapeHTML(summary)}</div>
      <div class="share-code-wrap">
        <div class="share-code-big" id="share-workout-code" role="button" tabindex="0" aria-label="Copy share code">${escapeHTML(code)}</div>
        <div class="share-code-hint">Tap the code to copy it</div>
      </div>
      <div class="share-link-box" id="share-workout-link" role="button" tabindex="0" aria-label="Copy share link">${escapeHTML(link)}</div>
      <button class="share-copy-btn" type="button" id="share-workout-copy">Copy Link</button>
      <div class="share-workout-note">Anyone with the link can view your workout and train along.</div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  document.body.style.overflow = 'hidden';

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    releaseFocus(sheet);
    backdrop.remove();
    sheet.remove();
    if (!document.querySelector('.sheet-panel')) document.body.style.overflow = '';
  };

  const copyLink = async () => {
    const ok = await copyTextToClipboard(link);
    showToast(ok ? 'Link copied' : 'Could not copy — long-press the link');
  };
  const copyCode = async () => {
    const ok = await copyTextToClipboard(code);
    showToast(ok ? 'Code copied: ' + code : 'Could not copy the code');
  };

  $('share-workout-close').addEventListener('click', dismiss);
  backdrop.addEventListener('click', dismiss);
  // Focus trap: Escape dismisses, Tab cycles within the sheet.
  trapFocus(sheet, dismiss);
  // Focus the primary action for keyboard users.
  setTimeout(() => $('share-workout-copy')?.focus(), 60);
  $('share-workout-copy').addEventListener('click', copyLink);
  const codeEl = $('share-workout-code');
  codeEl.addEventListener('click', copyCode);
  codeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      copyCode();
    }
  });
  const linkEl = $('share-workout-link');
  linkEl.addEventListener('click', copyLink);
  linkEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      copyLink();
    }
  });
}

// ---------------------------------------------------------------------------
// Share / download
// ---------------------------------------------------------------------------

/**
 * Share a canvas as a PNG via the Web Share API, or fall back to download.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 * @param {string} title
 * @param {string} text
 */
export function shareOrDownloadCanvas(canvas, filename, title, text) {
  canvas.toBlob((blob) => {
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title, text });
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Card downloaded');
    }
  }, 'image/png');
}

// ---------------------------------------------------------------------------
// PR Card
// ---------------------------------------------------------------------------

/**
 * Generate a PR card canvas for a single lift.
 *
 * @param {string} lift   - 'squat' | 'bench' | 'deadlift'
 * @param {number} weight - Weight lifted (in display units)
 * @param {number} e1rm   - Estimated 1RM
 * @param {string} date   - ISO date string (YYYY-MM-DD)
 * @returns {HTMLCanvasElement}
 */
export function generatePRCard(lift, weight, e1rm, date) {
  const { canvas: c, ctx } = createCardCanvas(SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);

  // Top accent bar
  ctx.fillStyle = COLORS[lift];
  ctx.fillRect(0, 0, SHARE_CARD_WIDTH, 6);

  // Branding
  ctx.font = 'bold 16px -apple-system, sans-serif';
  ctx.fillStyle = '#666';
  ctx.textAlign = 'left';
  ctx.fillText('1000LB CLUB', 30, 40);
  // Gold accent line under branding
  ctx.fillStyle = '#fdd835';
  ctx.fillRect(30, 44, 120, 2);
  // Tri-color S/B/D bar
  ctx.fillStyle = '#e53935';
  ctx.fillRect(30, 48, 40, 2);
  ctx.fillStyle = '#1e88e5';
  ctx.fillRect(70, 48, 40, 2);
  ctx.fillStyle = '#43a047';
  ctx.fillRect(110, 48, 40, 2);

  // PR label
  ctx.font = 'bold 14px -apple-system, sans-serif';
  ctx.fillStyle = '#ffd700';
  ctx.textAlign = 'right';
  ctx.fillText('NEW PR', SHARE_CARD_WIDTH - 30, 40);

  // Lift name
  ctx.font = 'bold 36px -apple-system, sans-serif';
  ctx.fillStyle = COLORS[lift];
  ctx.textAlign = 'center';
  ctx.fillText(LIFT_NAMES[lift].toUpperCase(), 300, 110);

  // Weight
  ctx.font = 'bold 72px -apple-system, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(formatWeight(weight) + ' ' + store.unit, 300, 195);

  // e1RM
  ctx.font = '24px -apple-system, sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText('e1RM: ' + formatWeight(e1rm) + ' ' + store.unit, 300, 240);

  // Total + Wilks if available
  const total = getTotal();
  if (total && store.profile.bodyweight && store.profile.gender) {
    const tKg = lbsToKg(total);
    const bKg = lbsToKg(store.profile.bodyweight);
    const w = calcWilks(tKg, bKg, store.profile.gender);
    if (w) {
      ctx.font = '16px -apple-system, sans-serif';
      ctx.fillStyle = '#666';
      ctx.fillText(
        'Total: ' + formatWeight(total) + ' ' + store.unit + '  |  Wilks: ' + Math.round(w),
        300,
        275
      );
    }
  }

  // Date
  drawCardDate(ctx, SHARE_CARD_WIDTH, 315, new Date(date + 'T12:00:00'));

  return c;
}

/**
 * Generate and share/download a PR card.
 */
export function sharePRCard(lift, weight, e1rm, date) {
  const canvas = generatePRCard(lift, weight, e1rm, date);
  shareOrDownloadCanvas(
    canvas,
    '1000lb-pr-' + lift + '.png',
    '1000lb Club - New PR!',
    LIFT_NAMES[lift] + ' PR: ' + formatWeight(weight) + ' ' + store.unit
  );
}

// ---------------------------------------------------------------------------
// Milestone Card
// ---------------------------------------------------------------------------

/**
 * Generate and share/download a milestone achievement card.
 *
 * @param {number} total - SBD total
 * @param {number|null} sq - Squat best e1RM
 * @param {number|null} bp - Bench best e1RM
 * @param {number|null} dl - Deadlift best e1RM
 * @param {object} [msTheme] - Milestone theme from TOTAL_MILESTONE_THEMES
 */
export function shareMilestoneCard(total, sq, bp, dl, msTheme) {
  msTheme = msTheme || TOTAL_MILESTONE_THEMES[1000];
  const { canvas: c, ctx } = createCardCanvas(600, 400);

  // SBD gradient top bar
  const grad = ctx.createLinearGradient(0, 0, 600, 0);
  grad.addColorStop(0, COLORS.squat);
  grad.addColorStop(0.5, COLORS.bench);
  grad.addColorStop(1, COLORS.deadlift);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 600, 6);

  // Crown/emoji
  ctx.font = '40px serif';
  ctx.textAlign = 'center';
  ctx.fillText(msTheme.emoji, 300, 55);

  // Title with glow
  ctx.save();
  ctx.shadowColor = msTheme.color;
  ctx.shadowBlur = 20;
  ctx.font = 'bold 42px -apple-system, sans-serif';
  ctx.fillStyle = msTheme.color;
  ctx.fillText(msTheme.title, 300, 110);
  ctx.restore();

  // Total
  ctx.font = 'bold 64px -apple-system, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(formatWeight(total) + ' ' + store.unit, 300, 190);

  // SBD breakdown
  const lifts = [
    { label: 'SQ', val: sq, color: COLORS.squat },
    { label: 'BP', val: bp, color: COLORS.bench },
    { label: 'DL', val: dl, color: COLORS.deadlift },
  ];
  const startX = 150;
  lifts.forEach((l, i) => {
    const cx = startX + i * 150;
    ctx.font = 'bold 14px -apple-system, sans-serif';
    ctx.fillStyle = l.color;
    ctx.fillText(l.label, cx, 230);
    ctx.font = 'bold 28px -apple-system, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(l.val ? formatWeight(l.val) : '\u2014', cx, 262);
  });

  // Wilks score if available
  let infoY = 300;
  infoY += drawCardWilks(ctx, 300, infoY);

  // Date
  drawCardDate(ctx, 600, infoY, new Date());

  // Branding
  drawCardBranding(ctx, 380);

  shareOrDownloadCanvas(
    c,
    '1000lb-club-achievement.png',
    '1000lb Club Achievement',
    'I joined the 1000lb Club! Total: ' + formatWeight(total) + ' ' + store.unit
  );
}
