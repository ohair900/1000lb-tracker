/**
 * Smart workout recommendation UI — auto-selects a lift and
 * accessories based on fatigue, history, and progression analysis.
 */

import store from '../state/store.js';
import { $ } from '../utils/helpers.js';
import { LIFTS, LIFT_NAMES } from '../constants/lift-config.js';
import { suggestMainLift, suggestIntensity } from '../systems/smart-workout.js';
import { selectSmartAccessories, scoreAccessories } from '../systems/workout-builder.js';
import { bestE1RM } from '../formulas/e1rm.js';
import { formatWeight } from '../formulas/units.js';
import { roundToPlate } from '../formulas/plates.js';
import { showToast } from '../ui/toast.js';

// ---------------------------------------------------------------------------
// Smart accessory card
// ---------------------------------------------------------------------------

/**
 * Render a single smart accessory card with score bar and reasons.
 * @param {Object} acc - Accessory exercise object with _score and _reasons
 * @param {number} accIdx - Index in builderExercises
 * @returns {string} HTML string
 */
export function renderSmartAccCard(acc, accIdx) {
  return `<div class="builder-exercise" data-smart-acc="${accIdx}">
    <div class="builder-exercise-info">
      <div class="builder-exercise-name" data-exid="${acc.exerciseId || ''}">${acc.name}</div>
      <div class="builder-exercise-meta">${acc.equipment} &bull; ${acc.sets}x${Array.isArray(acc.repRange) ? acc.repRange.join('-') : acc.reps}</div>
      ${acc._score != null ? `<div class="smart-score-bar"><div class="smart-score-fill" style="width:${acc._score}%"></div></div>` : ''}
      ${acc._reasons ? `<div style="margin-top:2px">${acc._reasons.map(r => `<span class="smart-reason">${r}</span>`).join('')}</div>` : ''}
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0">
      <button class="smart-swap-btn" data-swap="${accIdx}">Swap</button>
      <button class="smart-remove-btn" data-smart-remove="${accIdx}">&#10005;</button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Open smart recommendation
// ---------------------------------------------------------------------------

/**
 * Open the smart recommendation overlay.
 * Selects the suggested lift, builds exercises, and renders the UI.
 */
export function openSmartRecommendation() {
  const suggestion = suggestMainLift();
  let selectedLift = store.currentLift;
  let lastSmartLift = null;

  function render(lift) {
    selectedLift = lift;
    const intensity = suggestIntensity(lift);

    // Only rebuild exercises when lift changes or first render
    if (lift !== lastSmartLift) {
      lastSmartLift = lift;
      const smartAccs = selectSmartAccessories(lift, 5);
      store.builderExercises = [
        { type: 'main', exerciseId: lift, name: LIFT_NAMES[lift],
          sets: intensity.sets, reps: intensity.reps, weightMode: 'program', weightValue: 0,
          equipment: 'barbell', repRange: [1, intensity.reps], order: 0 }
      ];
      smartAccs.forEach((acc, i) => {
        store.builderExercises.push({
          type: 'accessory', exerciseId: acc.id, name: acc.name,
          sets: acc.sets, reps: acc.repRange[1], weightMode: 'auto', weightValue: 0,
          equipment: acc.equipment, repRange: [...acc.repRange], order: i + 1,
          _score: acc.score, _reasons: acc.reasons
        });
      });
    }

    const body = $('builder-body');
    let html = '';

    // Lift selector
    html += '<div class="smart-lift-selector">';
    LIFTS.forEach(l => {
      const isSuggested = l === suggestion.lift;
      const isActive = l === lift;
      html += `<button class="smart-lift-btn${isActive ? ' active' : ''}${isSuggested && !isActive ? ' suggested' : ''}" data-smart-lift="${l}">
        ${LIFT_NAMES[l]}
        <div class="smart-score-label">${suggestion.scores[l]}pts</div>
      </button>`;
    });
    html += '</div>';

    // Reasons for suggested lift
    if (suggestion.reasons[lift].length > 0) {
      html += '<div style="margin-bottom:var(--space-3)">';
      suggestion.reasons[lift].forEach(r => { html += `<span class="smart-reason">${r}</span>`; });
      html += '</div>';
    }

    // Intensity suggestion
    const tm = store.programConfig.trainingMaxes[lift] || (bestE1RM(lift) ? Math.round(bestE1RM(lift) * 0.9) : 0);
    const suggestedWeight = tm ? roundToPlate(tm * intensity.pctTM / 100) : 0;
    html += `<div class="builder-exercise main-lift ${lift}">
      <div class="builder-exercise-info">
        <div class="builder-exercise-name">${LIFT_NAMES[lift]}</div>
        <div class="builder-exercise-meta">${intensity.sets} sets x ${intensity.reps} @ ${intensity.pctTM}% TM${suggestedWeight ? ` (${formatWeight(suggestedWeight)} ${store.unit})` : ''} &bull; RPE ${intensity.rpe}</div>
      </div>
    </div>`;

    // Accessories with scores
    store.builderExercises.forEach((acc, accIdx) => {
      if (acc.type === 'main') return;
      html += renderSmartAccCard(acc, accIdx);
    });

    // Add more button
    html += `<button class="btn-dashed" id="smart-add-more">+ Add More</button>`;

    body.innerHTML = html;

    // Lift selector clicks
    body.querySelectorAll('[data-smart-lift]').forEach(btn => {
      btn.addEventListener('click', () => render(btn.dataset.smartLift));
    });

    // Remove accessory
    body.querySelectorAll('[data-smart-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.smartRemove);
        store.builderExercises.splice(idx, 1);
        render(lift);
      });
    });

    // Swap accessory
    body.querySelectorAll('[data-swap]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.swap);
        const allScored = scoreAccessories(lift);
        const usedIds = new Set(store.builderExercises.map(ex => ex.exerciseId));
        const alternatives = allScored.filter(a => !usedIds.has(a.id)).slice(0, 5);

        const container = btn.closest('.builder-exercise');
        let altEl = container.querySelector('.smart-alternatives');
        if (altEl) { altEl.remove(); return; }

        altEl = document.createElement('div');
        altEl.className = 'smart-alternatives';
        alternatives.forEach(alt => {
          const item = document.createElement('div');
          item.className = 'smart-alt-item';
          item.innerHTML = `<span style="font-size:var(--text-sm)">${alt.name}</span><span style="font-size:var(--text-xs);color:var(--text-dim)">${alt.score}pts</span>`;
          item.addEventListener('click', () => {
            store.builderExercises[idx] = {
              type: 'accessory', exerciseId: alt.id, name: alt.name,
              sets: alt.sets, reps: alt.repRange[1], weightMode: 'auto', weightValue: 0,
              equipment: alt.equipment, repRange: [...alt.repRange], order: idx,
              _score: alt.score, _reasons: alt.reasons
            };
            render(lift);
          });
          altEl.appendChild(item);
        });
        container.appendChild(altEl);
      });
    });

    // Add more
    const addMoreBtn = $('smart-add-more');
    if (addMoreBtn) {
      addMoreBtn.addEventListener('click', () => {
        const allScored = scoreAccessories(lift);
        const usedIds = new Set(store.builderExercises.map(ex => ex.exerciseId));
        const next = allScored.find(a => !usedIds.has(a.id));
        if (next) {
          store.builderExercises.push({
            type: 'accessory', exerciseId: next.id, name: next.name,
            sets: next.sets, reps: next.repRange[1], weightMode: 'auto', weightValue: 0,
            equipment: next.equipment, repRange: [...next.repRange], order: store.builderExercises.length,
            _score: next.score, _reasons: next.reasons
          });
          render(lift);
        } else {
          showToast('No more exercises available');
        }
      });
    }
  }

  $('builder-title').textContent = 'Smart Workout';
  $('builder-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  render(store.currentLift);
}
