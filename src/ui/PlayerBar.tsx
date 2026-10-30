// Player bar under the board (SmallFish layout):
//   Top: Me (colour)   •••   Bottom: Engine (persona · Elo, colour)

import { bubble, engine, evaluation } from '../controller';
import { PROFILES } from '../personas/meta';
import { game } from '../state/game';
import { engineSettings, uiSettings } from '../state/settings';
import { shelfOpen } from '../state/ui';
import { formatScore } from './EvalBar';

const colour = (s: string) => (s === 'white' ? 'White' : 'Black');

export function PlayerBar() {
  const s = engineSettings.value;
  const persona = PROFILES[s.persona];
  const live = game.atEnd.value && !game.result.value;
  const myTurn = game.turn.value === game.userSide.value;
  const thinking = engine.state.value === 'thinking' || engine.state.value === 'hint';
  const say = uiSettings.value.bubbles ? bubble.value : null;
  return (
    <div class="playerbar">
      <div class="pb-side">
        <span class={`turn-ring ${live && myTurn ? 'on' : ''}`} />
        <span class="pb-text">
          <span class="pb-colour">
            {colour(game.userSide.value)} <em>top</em>
          </span>
          <span class="pb-name">Me</span>
        </span>
      </div>
      <button
        class={`pb-dots ${thinking ? 'thinking' : ''}`}
        aria-label="Open game menu"
        onClick={() => (shelfOpen.value = !shelfOpen.value)}
      >
        <span class="dots3">
          <i />
          <i />
          <i />
        </span>
        <span class="pb-eval">{formatScore(evaluation.value)}</span>
      </button>
      <div class="pb-side right">
        <span class="pb-text">
          <span class="pb-colour">
            <em>bottom</em> {colour(game.engineSide.value)}
          </span>
          <span class="pb-name">
            {persona.name} · {s.elo >= 3000 ? 'Full' : s.elo}
          </span>
        </span>
        <span class={`turn-ring ${live && !myTurn ? 'on' : ''}`} />
      </div>
      {say && (
        <div key={say.id} class="bubble" role="status">
          <span class="bubble-avatar">{persona.avatar}</span>
          {say.text}
        </div>
      )}
    </div>
  );
}
