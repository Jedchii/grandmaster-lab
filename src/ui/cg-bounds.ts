// chessground caches the board's screen rectangle and only re-measures it on
// scroll or window resize. Our boards move with CSS transforms (the shelf
// spring, sheets, the editor's slide-in), which fire neither. A board that was
// measured while it was displaced - e.g. New Game flips the board while the
// shelf still has it lowered - then maps every later tap and drag to the wrong
// square. So: drop the cached rectangle at the start of every touch, before
// chessground reads it (one getBoundingClientRect per touch).

import type { Api } from '@lichess-org/chessground/api';

const STARTS = ['pointerdown', 'touchstart', 'mousedown'] as const;

/** Listens in the capture phase on an ancestor of the board, so it runs first. */
export function keepBoundsFresh(container: HTMLElement, api: () => Api | null): () => void {
  const clear = () => api()?.state.dom.bounds.clear();
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  for (const type of STARTS) container.addEventListener(type, clear, opts);
  return () => {
    for (const type of STARTS) container.removeEventListener(type, clear, opts);
  };
}
