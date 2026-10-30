// Classic layout: iOS-style bottom sheet. A peeking control row (Back, Next,
// Flip, Undo, Hint, New, Lab) that drags up into the full Lab panel. Motion
// is transform-only; the drag follows the finger 1:1 and snaps with velocity.
// "New" opens the colour chooser (NewGameChooser).

import { useEffect, useRef } from 'preact/hooks';
import { flipBoard, hintButton, stepBack, stepForward, undo } from '../../controller';
import { game } from '../../state/game';
import { labOpen, newGameOpen } from '../../state/ui';
import { Icon } from '../controls';
import { ErrorBoundary } from '../ErrorBoundary';
import { LabPanel } from './LabPanel';

function RepeatButton(props: { icon: string; label: string; disabled?: boolean; onStep: () => boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      class="icon-btn"
      aria-label={props.label}
      disabled={props.disabled}
      onPointerDown={(e) => {
        if (props.disabled) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        props.onStep();
        const repeat = (delay: number) => {
          timer.current = setTimeout(() => {
            if (props.onStep()) repeat(70);
            else stop();
          }, delay);
        };
        repeat(380);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      <Icon name={props.icon} />
      <span class="icon-btn-label">{props.label}</span>
    </button>
  );
}

export function ClassicSheet() {
  const open = labOpen.value;
  const setOpen = (v: boolean) => (labOpen.value = v);
  const sheet = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ y0: number; y: number; t: number; base: number; moved: boolean } | null>(null);

  // Closed, the sheet shows exactly var(--peek) (grabber + controls + home
  // indicator inset); the probe measures that in pixels.
  const travel = () => sheet.current!.offsetHeight - (probe.current?.offsetHeight || 96);

  const onDown = (e: PointerEvent) => {
    sheet.current!.setPointerCapture(e.pointerId);
    drag.current = { y0: e.clientY, y: e.clientY, t: e.timeStamp, base: open ? 0 : travel(), moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.moved && Math.abs(dy) < 6) return;
    d.moved = true;
    d.y = e.clientY;
    d.t = e.timeStamp;
    const el = sheet.current!;
    const offset = Math.max(0, Math.min(travel(), d.base + dy));
    el.classList.add('dragging');
    el.style.transform = `translate3d(0, ${offset}px, 0)`;
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const el = sheet.current!;
    el.classList.remove('dragging');
    el.style.transform = '';
    if (!d) return;
    if (!d.moved) {
      setOpen(!open);
      return;
    }
    const dy = e.clientY - d.y0;
    const velocity = (e.clientY - d.y) / Math.max(1, e.timeStamp - d.t); // px/ms
    if (velocity < -0.35) setOpen(true);
    else if (velocity > 0.35) setOpen(false);
    else setOpen(d.base + dy < travel() / 2);
  };

  const plies = game.length.value;
  const cursor = game.cursor.value;

  return (
    <>
      <div class={`sheet-backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <div ref={sheet} class={`sheet glass ${open ? 'open' : ''}`}>
        <span ref={probe} class="peek-probe" aria-hidden="true" />
        <div
          class="sheet-grab"
          role="button"
          aria-label={open ? 'Close the Lab' : 'Open the Lab'}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <span class="grabber" />
        </div>
        <div class="sheet-controls">
          <RepeatButton icon="back" label="Back" disabled={cursor === 0} onStep={stepBack} />
          <RepeatButton icon="forward" label="Next" disabled={cursor === plies} onStep={stepForward} />
          <button class="icon-btn" aria-label="Flip board" onClick={flipBoard}>
            <Icon name="flip" />
            <span class="icon-btn-label">Flip</span>
          </button>
          <button class="icon-btn" aria-label="Take back" disabled={cursor === 0} onClick={() => undo()}>
            <Icon name="undo" />
            <span class="icon-btn-label">Undo</span>
          </button>
          <button class="icon-btn" aria-label="Hint" onClick={hintButton}>
            <Icon name="bulb" />
            <span class="icon-btn-label">Hint</span>
          </button>
          <button
            class={`icon-btn ${newGameOpen.value ? 'active' : ''}`}
            aria-label="New game"
            onClick={() => {
              labOpen.value = false;
              newGameOpen.value = true;
            }}
          >
            <Icon name="plus" />
            <span class="icon-btn-label">New</span>
          </button>
          <button class={`icon-btn ${open ? 'active' : ''}`} aria-label="Lab settings" onClick={() => setOpen(!open)}>
            <Icon name="gear" />
            <span class="icon-btn-label">Lab</span>
          </button>
        </div>
        <div class="sheet-content" aria-hidden={!open} inert={!open}>
          <ErrorBoundary area="Lab panel">
            <LabPanel onClose={() => setOpen(false)} />
          </ErrorBoundary>
        </div>
      </div>
    </>
  );
}
