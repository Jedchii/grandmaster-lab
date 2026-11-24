// Game result, shown when the live line ends.
// * SmallFish: a card over the board; rematch alternates colours.
// * Classic: a slim banner over the top of the board, so the final position
//   stays visible. Its actions (Rematch, Switch sides, Undo, Review) live in
//   the bottom bar, in thumb reach (see classic/ClassicSheet.tsx).

import { newGame, undo } from '../controller';
import { PROFILES } from '../personas/meta';
import { game, opposite } from '../state/game';
import { engineSettings, uiSettings } from '../state/settings';
import { gameOverDismissed } from '../state/ui';

const REASON: Record<string, string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  threefold: 'by threefold repetition',
  fifty: 'by the 50-move rule',
  insufficient: 'by insufficient material',
  resign: 'by resignation',
};

/** The live line has ended and its result hasn't been dismissed with Review. */
export function gameOverActive(): boolean {
  if (!game.result.value || !game.atEnd.value) return false;
  const d = gameOverDismissed.value;
  return !(d && d.line === game.line.value && d.resigned === game.resigned.value);
}

/** "Review": hide the result until the game changes. */
export function dismissGameOver(): void {
  gameOverDismissed.value = { line: game.line.value, resigned: game.resigned.value };
}

export function GameOver() {
  const result = game.result.value;
  if (!result || !gameOverActive()) return null;

  const persona = PROFILES[engineSettings.value.persona];
  const userWon = result.winner === game.userSide.value;
  const title = result.winner === null ? 'Draw' : userWon ? 'You win!' : `${persona.name} wins`;
  const emoji = result.winner === null ? '🤝' : userWon ? '🏆' : persona.avatar;
  const next = opposite(game.userSide.value) === 'white' ? 'White' : 'Black';

  if (uiSettings.value.layout === 'classic') {
    return (
      <div class="gameover-banner glass" role="status" aria-label="Game over">
        <span class="gameover-banner-emoji" aria-hidden="true">
          {emoji}
        </span>
        <strong>{title}</strong>
        <span class="muted">{REASON[result.reason]}</span>
      </div>
    );
  }

  return (
    <div class="gameover" role="dialog" aria-label="Game over">
      <div class="gameover-card glass">
        <div class="gameover-emoji">{emoji}</div>
        <h2>{title}</h2>
        <p>{REASON[result.reason]}</p>
        <div class="gameover-actions">
          <button class="btn primary wide" onClick={() => newGame('alternate')}>
            Rematch as {next}
          </button>
          <button class="btn" onClick={() => undo()}>
            Undo
          </button>
          <button class="btn ghost" onClick={dismissGameOver}>
            Review
          </button>
        </div>
      </div>
    </div>
  );
}
