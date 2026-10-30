// Slide-down shelf revealed when the board springs down (SmallFish layout):
// New Game, Edit Position, persona, Elo, Instamove and the match history.

import { useLayoutEffect, useRef } from 'preact/hooks';
import { newGame } from '../controller';
import { game, opposite } from '../state/game';
import { engineSettings, updateEngine } from '../state/settings';
import { editorOpen, shelfOpen } from '../state/ui';
import { Toggle } from './controls';
import { MatchHistory } from './History';
import { EloSlider, PersonaPicker } from './PersonaPicker';

export function Shelf() {
  const ref = useRef<HTMLElement>(null);
  const s = engineSettings.value;
  const open = shelfOpen.value;

  // The stage translates by exactly the shelf's height.
  useLayoutEffect(() => {
    const el = ref.current!;
    const apply = () => document.documentElement.style.setProperty('--shelf-h', `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <section ref={ref} class={`shelf ${open ? 'open' : ''}`} aria-hidden={!open} inert={!open}>
      <div class="shelf-actions">
        <button
          class="shelf-btn primary"
          onClick={() => {
            newGame('alternate');
            shelfOpen.value = false;
          }}
        >
          <strong>New Game</strong>
          <small>You'll play {opposite(game.userSide.value) === 'white' ? 'White' : 'Black'} · on top</small>
        </button>
        <button
          class="shelf-btn"
          onClick={() => {
            shelfOpen.value = false;
            editorOpen.value = true;
          }}
        >
          <strong>Edit Position</strong>
          <small>Palette · FEN</small>
        </button>
      </div>

      <PersonaPicker />
      <EloSlider />
      <Toggle
        label="Instamove"
        hint={s.instamove ? 'Replies in < 50 ms, still Elo-scaled' : 'Realistic think time'}
        checked={s.instamove}
        onChange={(v) => updateEngine({ instamove: v })}
      />

      <MatchHistory onResume={() => (shelfOpen.value = false)} />
    </section>
  );
}
