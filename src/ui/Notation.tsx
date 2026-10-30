// Monospaced, scrollable algebraic notation. Tap a move to go there; moves
// after the cursor (redo-able) are dimmed.

import { useEffect, useRef } from 'preact/hooks';
import { engine } from '../controller';
import { game } from '../state/game';
import { EngineLines } from './EvalBar';

export function Notation() {
  const line = game.line.value;
  const cursor = game.cursor.value;
  const ref = useRef<HTMLDivElement>(null);
  const opening = engine.opening.value;

  // Scroll only this box (scrollIntoView would also scroll the clipped
  // viewport and shift the board / shelf).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('.mv.current');
    if (!active) {
      if (cursor === line.length) el.scrollTop = el.scrollHeight;
      return;
    }
    const top = active.offsetTop; // .notation is the offsetParent
    const bottom = top + active.offsetHeight;
    if (top < el.scrollTop) el.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTo({ top: bottom - el.clientHeight + 8, behavior: 'smooth' });
  }, [cursor, line.length]);

  // The space between tokens must sit outside the no-wrap span, or the whole
  // move list becomes one unbreakable line. (A plain wrapper span rather than
  // a Fragment: the dev transform drops a JSX-only `Fragment` import.)
  const tokens = line.map((p, i) => {
    const white = p.by === 'white';
    const no = game.moveNumberAt(i);
    return (
      <span key={i}>
        <span class="tok">
          {white && <span class="mv-no">{no}.</span>}
          {!white && i === 0 && <span class="mv-no">{no}...</span>}
          <button
            class={`mv ${i < cursor ? 'past' : 'future'} ${i === cursor - 1 ? 'current' : ''}`}
            onClick={() => game.jumpTo(i + 1)}
          >
            {p.san}
          </button>
        </span>{' '}
      </span>
    );
  });

  return (
    <div class="notation" ref={ref}>
      <div class="opening-line">
        {opening ? (
          <>
            <b>{opening.eco}</b> {opening.name}
            {opening.inBook && <span class="chip book">Book</span>}
          </>
        ) : (
          <span class="muted">
            {cursor > 0 ? 'Out of theory' : game.userTurn.value ? 'Starting position — you play from the top' : 'Starting position'}
          </span>
        )}
      </div>
      <div class="movetext">
        <button class={`mv start ${cursor === 0 ? 'current' : ''}`} onClick={() => game.jumpTo(0)} aria-label="Start position">
          ⌂
        </button>{' '}
        {tokens}
      </div>
      <EngineLines />
    </div>
  );
}
