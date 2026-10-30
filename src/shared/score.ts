// Score helpers shared by the eval bars and the suggestion arrows.

import type { Score } from './protocol';

/** Lichess win-probability curve: White's winning chances, 0..100. */
export function whiteShare(score: Score | null | undefined): number {
  if (!score) return 50;
  if (score.mate !== undefined) return score.mate > 0 ? 100 : score.mate < 0 ? 0 : 50;
  const cp = Math.max(-2000, Math.min(2000, score.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function formatScore(score: Score | null | undefined): string {
  if (!score) return '0.0';
  if (score.mate !== undefined) return score.mate === 0 ? '#' : `${score.mate > 0 ? '' : '−'}M${Math.abs(score.mate)}`;
  const v = (score.cp ?? 0) / 100;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`;
}
