// Options bottom sheet (dock → Options). Slides up over the dock; drag the
// grabber down (or tap outside) to close. Transform-only, follows the finger.

import { useRef } from 'preact/hooks';
import { optionsOpen } from '../state/ui';
import { ErrorBoundary } from './ErrorBoundary';
import { Settings } from './Settings';

export function OptionsSheet() {
  const open = optionsOpen.value;
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y0: number; y: number; t: number; moved: boolean } | null>(null);

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y0: e.clientY, y: e.clientY, t: e.timeStamp, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = Math.max(0, e.clientY - d.y0);
    if (!d.moved && dy < 6) return;
    d.moved = true;
    d.y = e.clientY;
    d.t = e.timeStamp;
    const el = sheet.current!;
    el.classList.add('dragging');
    el.style.transform = `translate3d(0, ${dy}px, 0)`;
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const el = sheet.current!;
    el.classList.remove('dragging');
    el.style.transform = '';
    if (!d) return;
    if (!d.moved) {
      optionsOpen.value = false;
      return;
    }
    const dy = e.clientY - d.y0;
    const velocity = (e.clientY - d.y) / Math.max(1, e.timeStamp - d.t);
    if (velocity > 0.35 || dy > el.offsetHeight / 3) optionsOpen.value = false;
  };

  return (
    <>
      <div class={`sheet-backdrop ${open ? 'show' : ''}`} onClick={() => (optionsOpen.value = false)} />
      <div ref={sheet} class={`sheet glass ${open ? 'open' : ''}`} aria-hidden={!open} inert={!open}>
        <div
          class="sheet-grab"
          role="button"
          aria-label="Close options"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <span class="grabber" />
          <span class="sheet-title">Options</span>
        </div>
        <div class="sheet-content">
          <ErrorBoundary area="options">
            <Settings />
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
