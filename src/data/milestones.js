// src/data/milestones.js — Total milestones, celebration themes, and available tags

export const TOTAL_MILESTONES = [500, 750, 1000, 1250, 1500, 2000];

export const TOTAL_MILESTONE_THEMES = {
  500:  { emoji: '\uD83D\uDCAA', title: '500 LB TOTAL', color: '#43a047', confettiColors: ['#43a047','#66bb6a','#a5d6a7','#fff'] },
  750:  { emoji: '\uD83C\uDFCB\uFE0F', title: '750 LB TOTAL', color: '#1e88e5', confettiColors: ['#1e88e5','#42a5f5','#90caf9','#fff'] },
  1000: { emoji: '\uD83D\uDC51', title: '1000 LB CLUB', color: '#ffd700', confettiColors: ['#e53935','#1e88e5','#43a047','#ffd700','#fff'] },
  1250: { emoji: '\uD83D\uDD25', title: '1250 LB TOTAL', color: '#ff9800', confettiColors: ['#ff9800','#ffb74d','#ffe0b2','#fff'] },
  1500: { emoji: '\u26A1', title: '1500 LB TOTAL', color: '#ab47bc', confettiColors: ['#ab47bc','#ce93d8','#e1bee7','#fff'] },
  2000: { emoji: '\uD83C\uDFC6', title: '2000 LB TOTAL', color: '#e53935', confettiColors: ['#e53935','#ef5350','#ef9a9a','#ffd700','#fff'] }
};

export const AVAILABLE_TAGS = ['belt','sleeves','wraps','competition','paused','tempo','deficit','block'];
