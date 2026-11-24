// Horizontal swipe detection shared by the board and SmallFish's bottom zone.
// A swipe fires once it travels > 40 px, mostly sideways (|dx| > 1.6 |dy|).
// After a swipe, the click that iOS may still deliver to whatever was under
// the finger (a move in the notation, the ••• button) is swallowed.

export type SwipeDir = 'left' | 'right';

export const SWIPE_DX = 40;

export interface SwipeOptions {
  /** Decide at touch-down whether this gesture may become a swipe. */
  accept: (e: PointerEvent) => boolean;
  onSwipe: (dir: SwipeDir) => void;
}

/** Swallows the click iOS may still deliver after a gesture ends (within 450 ms). */
export function swallowClick(): void {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 450);
}

export function attachSwipe(node: HTMLElement, opts: SwipeOptions): () => void {
  let start: { x: number; y: number; id: number } | null = null;
  let fired = false;

  const onDown = (e: PointerEvent) => {
    start = null;
    fired = false;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!opts.accept(e)) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onMove = (e: PointerEvent) => {
    if (!start || fired || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) > SWIPE_DX && Math.abs(dx) > 1.6 * Math.abs(dy)) {
      fired = true;
      swallowClick();
      opts.onSwipe(dx > 0 ? 'right' : 'left');
    }
  };
  const onEnd = (e: PointerEvent) => {
    if (start && e.pointerId === start.id) start = null;
  };

  node.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onEnd, { passive: true });
  window.addEventListener('pointercancel', onEnd, { passive: true });
  return () => {
    node.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
  };
}
