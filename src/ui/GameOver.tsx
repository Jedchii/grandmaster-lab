// Result card shown over the board when the live line ends.
// SmallFish: rematch alternates colours. Classic: rematch keeps your colour,
// with a separate Switch sides button (as before).

import { useEffect, useState } from 'preact/hooks';
import { newGame, undo } from '../controller';
import { PROFILES } from '../personas/meta';
import { game, opposite } from '../state/game';
import { engineSettings, uiSettings } from '../state/settings';

const REASON: Record<string, string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  threefold: 'by threefold repetition',
  fifty: 'by the 50-move rule',
  insufficient: 'by insufficient material',
  resign: 'by resignation',
};

export function GameOver() {
  const result = game.result.value;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [result, game.gameId.value]);
  if (!result || dismissed || !game.atEnd.value) return null;

  const persona = PROFILES[engineSettings.value.persona];
  const userWon = result.winner === game.userSide.value;
  const title = result.winner === null ? 'Draw' : userWon ? 'You win!' : `${persona.name} wins`;
  const emoji = result.winner === null ? '🤝' : userWon ? '🏆' : persona.avatar;
  const classic = uiSettings.value.layout === 'classic';
  const next = opposite(game.userSide.value) === 'white' ? 'White' : 'Black';

  return (
    <div class="gameover" role="dialog" aria-label="Game over">
      <div class="gameover-card glass">
        <div class="gameover-emoji">{emoji}</div>
        <h2>{title}</h2>
        <p>{REASON[result.reason]}</p>
        {classic ? (
          <div class="gameover-actions four">
            <button class="btn primary" onClick={() => newGame(game.userSide.value)}>
              Rematch
            </button>
            <button class="btn" onClick={() => newGame('alternate')}>
              Switch sides
            </button>
            <button class="btn" onClick={() => undo()}>
              Undo
            </button>
            <button class="btn ghost" onClick={() => setDismissed(true)}>
              Review
            </button>
          </div>
        ) : (
          <div class="gameover-actions">
            <button class="btn primary wide" onClick={() => newGame('alternate')}>
              Rematch as {next}
            </button>
            <button class="btn" onClick={() => undo()}>
              Undo
            </button>
            <button class="btn ghost" onClick={() => setDismissed(true)}>
              Review
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
