// Opponent picker + the unified Elo slider (shared by the SmallFish shelf and
// the Classic Lab panel).

import { say } from '../controller';
import { PROFILES, eloLabel } from '../personas/meta';
import type { PersonaId } from '../shared/protocol';
import { engineSettings, updateEngine } from '../state/settings';
import { Slider } from './controls';

const PERSONA_ORDER: PersonaId[] = ['patricia', 'stockfish', 'drawfish'];

export function PersonaPicker() {
  const current = engineSettings.value.persona;
  const choose = (id: PersonaId) => {
    if (id === current) return;
    updateEngine({ persona: id });
    say('greet', true);
  };
  return (
    <div class="persona-picker">
      {PERSONA_ORDER.map((id) => {
        const p = PROFILES[id];
        return (
          <button
            key={id}
            class={`persona-option ${current === id ? 'on' : ''}`}
            style={{ '--accent': p.accent }}
            aria-pressed={current === id}
            onClick={() => choose(id)}
          >
            <span class="po-avatar">{p.avatar}</span>
            <span class="po-name">{p.name}</span>
            <span class="po-tag">{p.tagline}</span>
          </button>
        );
      })}
    </div>
  );
}

export function EloSlider() {
  return (
    <Slider
      label="Elo"
      min={800}
      max={3000}
      step={50}
      value={engineSettings.value.elo}
      format={(v) => (v >= 3000 ? '3000 · Full strength' : `${v} · ${eloLabel(v)}`)}
      onCommit={(v) => updateEngine({ elo: v })}
    />
  );
}
