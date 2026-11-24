// Classic layout: the bottom bar and the pull-up Lab sheet, built for one thumb.
//
// * The bar stays put: Back, Next, Undo, Hint, New, Lab (mirrored for the
//   left thumb). While a finished game's result shows, it swaps to Rematch,
//   Switch sides, Undo, Review, Lab.
// * The Lab slides up from behind the bar and stops at half or full height.
//   The Lab button and the grabber pill open it to half (and close it). Drag
//   up anywhere on the bar, the tabs or the sheet's handle to move between
//   stops; drag down, or swipe down on the content when it's scrolled to the
//   top, to close. The tabs sit right above the bar.
// * Motion is transform-only; drags follow the finger 1:1 and snap with
//   velocity. Bar buttons step on release, so a drag that starts on one never
//   presses it.

import { useEffect, useRef } from 'preact/hooks';
import { hintButton, newGame, stepBack, stepForward, undo } from '../../controller';
import { haptic } from '../../feedback/haptics';
import { game } from '../../state/game';
import { uiSettings } from '../../state/settings';
import { labFull, labOpen, labTab, newGameOpen, type LabTab } from '../../state/ui';
import { Icon, useHoldRepeat } from '../controls';
import { ErrorBoundary } from '../ErrorBoundary';
import { dismissGameOver, gameOverActive } from '../GameOver';
import { swallowClick } from '../swipe';
import { LabPanel } from './LabPanel';

type Stop = 'closed' | 'half' | 'full';

const TABS: Array<{ id: LabTab; label: string }> = [
  { id: 'play', label: 'Play' },
  { id: 'opponent', label: 'Opponent' },
  { id: 'display', label: 'Display' },
  { id: 'engine', label: 'Engine' },
];

const currentStop = (): Stop => (!labOpen.value ? 'closed' : labFull.value ? 'full' : 'half');

function setStop(s: Stop): void {
  labOpen.value = s !== 'closed';
  labFull.value = s === 'full';
}

/** Lab button / grabber pill: closed opens to half; open (either stop) closes. */
const toggleLab = () => setStop(labOpen.value ? 'closed' : 'half');

function BarButton(props: {
  icon: string;
  label: string;
  disabled?: boolean;
  active?: boolean;
  tone?: 'accent';
  onClick: () => void;
}) {
  return (
    <button
      class={`icon-btn ${props.active ? 'active' : ''} ${props.tone ?? ''}`}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
      <span class="icon-btn-label">{props.label}</span>
    </button>
  );
}

/** Back / Next: a tap steps once; holding scrubs through the game. */
function HoldButton(props: { icon: string; label: string; disabled?: boolean; onStep: () => boolean }) {
  const hold = useHoldRepeat(props.onStep);
  return (
    <button class="icon-btn" aria-label={props.label} disabled={props.disabled} {...hold}>
      <Icon name={props.icon} />
      <span class="icon-btn-label">{props.label}</span>
    </button>
  );
}

function barButtons(open: boolean) {
  const lab = <BarButton key="lab" icon="gear" label="Lab" active={open} onClick={toggleLab} />;
  if (gameOverActive()) {
    return [
      <BarButton key="rematch" icon="rematch" label="Rematch" tone="accent" onClick={() => newGame(game.userSide.value)} />,
      <BarButton key="switch" icon="swap" label="Switch" onClick={() => newGame('alternate')} />,
      <BarButton key="undo" icon="undo" label="Undo" onClick={() => undo()} />,
      <BarButton key="review" icon="eye" label="Review" onClick={dismissGameOver} />,
      lab,
    ];
  }
  const cursor = game.cursor.value;
  return [
    <HoldButton key="back" icon="back" label="Back" disabled={cursor === 0} onStep={stepBack} />,
    <HoldButton key="next" icon="forward" label="Next" disabled={cursor === game.length.value} onStep={stepForward} />,
    <BarButton key="undo" icon="undo" label="Undo" disabled={cursor === 0} onClick={() => undo()} />,
    <BarButton key="hint" icon="bulb" label="Hint" onClick={hintButton} />,
    <BarButton
      key="new"
      icon="plus"
      label="New"
      active={newGameOpen.value}
      onClick={() => {
        setStop('closed');
        newGameOpen.value = true;
      }}
    />,
    lab,
  ];
}

export function ClassicSheet() {
  const open = labOpen.value;
  const full = labFull.value;
  const tab = labTab.value;
  const sheet = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const grab = useRef<HTMLDivElement>(null);
  const halfProbe = useRef<HTMLSpanElement>(null);
  const peekProbe = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ y0: number; y: number; t: number; v: number; base: number; moved: boolean } | null>(null);

  useEffect(() => {
    // Offsets (translateY, px) of the three stops. The sheet is always full
    // height; half and closed just push it further down behind the bar.
    const stops = () => {
      const height = sheet.current!.offsetHeight;
      return {
        full: 0,
        half: Math.max(0, height - (halfProbe.current?.offsetHeight ?? height * 0.55)),
        closed: height + (peekProbe.current?.offsetHeight ?? 96),
      };
    };
    const position = (d: { y0: number; y: number; base: number }, limit: number) =>
      Math.max(0, Math.min(limit, d.base + d.y - d.y0));

    const start = (y: number, t: number) => {
      drag.current = { y0: y, y, t, v: 0, base: stops()[currentStop()], moved: false };
    };
    const move = (y: number, t: number) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved) {
        if (Math.abs(y - d.y0) < 8) return;
        d.moved = true;
        sheet.current!.classList.add('dragging');
        document.querySelector('.app')?.classList.add('lab-dragging');
      }
      d.v = 0.7 * ((y - d.y) / Math.max(1, t - d.t)) + 0.3 * d.v; // px/ms, smoothed
      d.y = y;
      d.t = t;
      sheet.current!.style.transform = `translate3d(0, ${position(d, stops().closed)}px, 0)`;
    };
    /** Snaps to a stop; returns whether the gesture was a drag. */
    const end = (): boolean => {
      const d = drag.current;
      drag.current = null;
      if (!d) return false;
      const el = sheet.current!;
      el.classList.remove('dragging');
      el.style.transform = '';
      document.querySelector('.app')?.classList.remove('lab-dragging');
      if (!d.moved) return false;
      const o = stops();
      const now = position(d, o.closed);
      const all: Array<[Stop, number]> = [
        ['full', o.full],
        ['half', o.half],
        ['closed', o.closed],
      ];
      const byDistance = (list: Array<[Stop, number]>) =>
        [...list].sort((a, b) => Math.abs(a[1] - now) - Math.abs(b[1] - now));
      let target: Stop;
      if (Math.abs(d.v) > 0.45) {
        // A flick goes to the next stop in its direction.
        const dir = Math.sign(d.v);
        const ahead = all.filter(([, p]) => (p - now) * dir > 4);
        target = (byDistance(ahead)[0] ?? (dir > 0 ? all[2] : all[0]))[0];
      } else {
        target = byDistance(all)[0][0];
      }
      if (target !== currentStop()) haptic('tick');
      setStop(target);
      return true;
    };

    // Bar, tabs and the sheet's handle: pointer drags (touch-action: none).
    let pointer: { id: number; x0: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || drag.current) return;
      pointer = { id: e.pointerId, x0: e.clientX };
      start(e.clientY, e.timeStamp);
    };
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!pointer || e.pointerId !== pointer.id || !d) return;
      const dx = Math.abs(e.clientX - pointer.x0);
      if (!d.moved && dx > 10 && dx > Math.abs(e.clientY - d.y0)) {
        // Sideways: not a sheet drag.
        drag.current = null;
        pointer = null;
        return;
      }
      move(e.clientY, e.timeStamp);
    };
    const onUp = (e: PointerEvent) => {
      if (!pointer || e.pointerId !== pointer.id) return;
      pointer = null;
      if (end()) swallowClick();
    };
    const handles = [bar.current!, tabs.current!, grab.current!];
    for (const h of handles) h.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });

    // Content: swipe down while scrolled to the top closes (touch events, so
    // the native scroll can be cancelled before iOS takes the gesture).
    const body = content.current!;
    let touch: { id: number; x0: number; y0: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touch = null;
      if (e.touches.length !== 1 || drag.current || body.scrollTop > 0) return;
      if ((e.target as Element | null)?.closest('input, .slider-row')) return; // sliders own their drags
      const t = e.touches[0];
      touch = { id: t.identifier, x0: t.clientX, y0: t.clientY };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touch) return;
      const t = Array.from(e.touches).find((x) => x.identifier === touch!.id);
      if (!t) return;
      const dy = t.clientY - touch.y0;
      const dx = t.clientX - touch.x0;
      if (!drag.current) {
        if (dy < 0 || Math.abs(dx) > Math.max(10, dy)) {
          touch = null; // scrolling the content, or sideways (a slider)
          return;
        }
        e.preventDefault(); // at the top, pulling down: never rubber-band
        if (dy < 8) return;
        start(touch.y0, e.timeStamp);
      }
      e.preventDefault();
      move(t.clientY, e.timeStamp);
    };
    const onTouchEnd = () => {
      if (!touch) return;
      touch = null;
      end();
    };
    body.addEventListener('touchstart', onTouchStart, { passive: true });
    body.addEventListener('touchmove', onTouchMove, { passive: false });
    body.addEventListener('touchend', onTouchEnd);
    body.addEventListener('touchcancel', onTouchEnd);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && labOpen.value) setStop('closed');
    };
    window.addEventListener('keydown', onKey);

    return () => {
      for (const h of handles) h.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      body.removeEventListener('touchstart', onTouchStart);
      body.removeEventListener('touchmove', onTouchMove);
      body.removeEventListener('touchend', onTouchEnd);
      body.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Each tab starts at its top.
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [tab]);

  let buttons = barButtons(open);
  if (uiSettings.value.handedness === 'left') {
    // Mirror the bar, but keep Back to the left of Next so the arrows still read ← →.
    buttons = buttons.reverse();
    const next = buttons.findIndex((b) => b.key === 'next');
    if (next >= 0 && buttons[next + 1]?.key === 'back') [buttons[next], buttons[next + 1]] = [buttons[next + 1], buttons[next]];
  }

  return (
    <>
      <div class={`sheet-backdrop ${open ? 'show' : ''}`} onClick={() => setStop('closed')} />
      <div
        ref={sheet}
        class={`sheet glass ${open ? 'open' : ''} ${full ? 'full' : ''}`}
        role="dialog"
        aria-label="Lab"
        aria-hidden={!open}
        inert={!open}
      >
        <span ref={halfProbe} class="half-probe" aria-hidden="true" />
        <div ref={grab} class="sheet-grab" aria-hidden="true">
          <span class="grabber" />
        </div>
        <div ref={content} class="sheet-content">
          <ErrorBoundary area="Lab panel">
            <LabPanel tab={tab} onClose={() => setStop('closed')} />
          </ErrorBoundary>
        </div>
      </div>
      <div
        ref={tabs}
        class={`lab-tabs ${open ? 'show' : ''}`}
        role="tablist"
        aria-label="Lab sections"
        inert={!open}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            class={`lab-tab ${tab === t.id ? 'on' : ''}`}
            onClick={() => (labTab.value = t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div ref={bar} class={`cbar glass ${open ? 'open' : ''}`}>
        <span ref={peekProbe} class="peek-probe" aria-hidden="true" />
        <button class="cbar-grab" aria-label={open ? 'Close the Lab' : 'Open the Lab'} onClick={toggleLab}>
          <span class="grabber" />
        </button>
        <div class="sheet-controls" style={{ '--n': buttons.length }}>
          {buttons}
        </div>
      </div>
    </>
  );
}
