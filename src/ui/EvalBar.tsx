// Evaluation bars (compositor-only scale transitions):
// * EvalBar - SmallFish: vertical, on the board's left edge. White's share
//   grows from the side White sits on.
// * EvalStrip - Classic: a slim horizontal strip under the board with the score.

import { engine, evaluation } from '../controller';
import { lineKey } from '../shared/protocol';
import { formatScore, whiteShare } from '../shared/score';
import { game } from '../state/game';
import { uiSettings } from '../state/settings';
import { orientation } from '../state/view';

export { formatScore, whiteShare };

export function EvalBar() {
  if (!uiSettings.value.showEval) return <div class="evalbar-v off" aria-hidden="true" />;
  const score = evaluation.value;
  const share = whiteShare(score) / 100;
  const whiteOnTop = orientation.value === 'black';
  return (
    <div class={`evalbar-v ${whiteOnTop ? 'white-top' : ''}`} role="img" aria-label={`Evaluation ${formatScore(score)}`}>
      <div class="evalbar-v-fill" style={{ transform: `scaleY(${share})` }} />
      <div class="evalbar-v-mid" />
    </div>
  );
}

export function EvalStrip() {
  if (!uiSettings.value.showEval) return <div class="evalbar-spacer" />;
  const score = evaluation.value;
  const share = whiteShare(score) / 100;
  const blackAtBottom = orientation.value === 'black';
  return (
    <div class={`evalbar ${blackAtBottom ? 'flipped' : ''}`} aria-label={`Evaluation ${formatScore(score)}`}>
      <div class="evalbar-track">
        <div class="evalbar-fill" style={{ transform: `scaleX(${share})` }} />
        <div class="evalbar-mid" />
      </div>
      <span class={`evalbar-label ${share >= 0.5 ? 'w' : 'b'}`}>{formatScore(score)}</span>
    </div>
  );
}

export function EngineLines() {
  if (!uiSettings.value.showLines) return null;
  const info = engine.info.value;
  if (!info || info.gameId !== game.gameId.value) return <div class="lines muted">Engine lines appear while it thinks.</div>;
  if (info.mode === 'ponder') {
    return <div class="lines muted">Pondering · depth {info.depth} · lines hidden on your turn</div>;
  }
  if (info.line !== lineKey(game.moves.value)) return null;
  return (
    <div class="lines">
      {info.lines.slice(0, Math.max(1, 3)).map((l) => (
        <div class="line" key={l.multipv}>
          <span class="line-score">{formatScore(l.scoreWhite)}</span>
          <span class="line-pv">
            {l.san.map((san, i) => {
              const ply = info.ply + i;
              const white = game.turnAt(ply) === 'white';
              const no = game.moveNumberAt(ply);
              return (
                <span key={i}>
                  {white ? `${no}.` : i === 0 ? `${no}…` : ''}
                  {san}{' '}
                </span>
              );
            })}
          </span>
        </div>
      ))}
      <div class="line-meta">
        d{info.depth}/{info.seldepth} · {(info.nps / 1000).toFixed(0)} kN/s
      </div>
    </div>
  );
}
