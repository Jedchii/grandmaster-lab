// Classic layout: horizontally scrolling move list. Tap a move to view that
// position; moves after the cursor (redo-able) are dimmed. While reviewing, a
// "Live" button at the end of the strip jumps back to the current position.

import { useEffect, useRef } from 'preact/hooks';
import { game } from '../../state/game';
import { Icon } from '../controls';

export function MoveStrip() {
  const line = game.line.value;
  const cursor = game.cursor.value;
  const ref = useRef<HTMLDivElement>(null);
  const reviewing = cursor < line.length;

  // Scroll only the strip itself (scrollIntoView would also scroll the page).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('.mv.active');
    if (!active) {
      if (cursor === line.length) el.scrollLeft = el.scrollWidth;
      return;
    }
    const left = active.offsetLeft; // .moves is the offsetParent
    const right = left + active.offsetWidth;
    if (left < el.scrollLeft + 12) el.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
    else if (right > el.scrollLeft + el.clientWidth - 12)
      el.scrollTo({ left: right - el.clientWidth + 24, behavior: 'smooth' });
  }, [cursor, line.length]);

  if (!line.length) {
    const userMoves = game.turnAt(0) === game.userSide.value;
    return (
      <div class="moves-row">
        <div class="moves empty" ref={ref}>
          <span class="muted">
            {game.userSide.value === 'white' ? 'You have White' : 'You have Black'}
            {userMoves ? ' — your move.' : '.'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div class={`moves-row ${reviewing ? 'reviewing' : ''}`}>
      <div class="moves" ref={ref}>
        {line.map((p, i) => {
          const white = p.by === 'white';
          const no = game.moveNumberAt(i);
          const cls = [
            'mv',
            i === cursor - 1 ? 'active' : '',
            i >= cursor ? 'future' : '',
            p.by === game.userSide.value ? 'you' : 'them',
          ].join(' ');
          return (
            <button key={i} class={cls} onClick={() => game.jumpTo(i + 1)}>
              {white && <span class="mv-no">{no}.</span>}
              {!white && i === 0 && <span class="mv-no">{no}…</span>}
              {p.san}
            </button>
          );
        })}
      </div>
      {reviewing && (
        <button class="live-btn" aria-label="Back to the live position" onClick={() => game.jumpTo(line.length)}>
          <span>Live</span>
          <Icon name="live" />
        </button>
      )}
    </div>
  );
}
