// Small touch-first form controls.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Press-and-hold repeat for step buttons. A tap steps once on release (so a
 * drag that merely starts on the button never steps); holding steps after
 * 380 ms, then every 70 ms. `onEnd` runs once when a tap or a hold is over.
 */
export function useHoldRepeat(onStep: () => boolean, onEnd?: () => void) {
  const st = useRef({ timer: null as ReturnType<typeof setTimeout> | null, x: 0, y: 0, repeated: false, moved: false, ended: false });
  const step = useRef(onStep);
  const end = useRef(onEnd);
  step.current = onStep;
  end.current = onEnd;
  const stop = () => {
    const s = st.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
  };
  const finish = () => {
    const s = st.current;
    stop();
    if (s.repeated && !s.ended) {
      s.ended = true;
      end.current?.();
    }
  };
  useEffect(() => stop, []);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const s = st.current;
      stop();
      Object.assign(s, { x: e.clientX, y: e.clientY, repeated: false, moved: false, ended: false });
      const tick = (delay: number) => {
        s.timer = setTimeout(() => {
          s.repeated = true;
          if (step.current()) tick(70);
          else finish();
        }, delay);
      };
      tick(380);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = st.current;
      if (s.moved || s.repeated) return;
      if (Math.abs(e.clientX - s.x) > 10 || Math.abs(e.clientY - s.y) > 10) {
        s.moved = true;
        stop();
      }
    },
    onPointerUp: finish,
    onPointerCancel: () => {
      st.current.moved = true;
      finish();
    },
    onClick: () => {
      const s = st.current;
      if (s.repeated || s.moved) {
        s.repeated = false;
        s.moved = false;
        return;
      }
      step.current();
      end.current?.();
    },
  };
}

export function Section(props: { title: string; hint?: string; children: ComponentChildren }) {
  return (
    <section class="section">
      <header class="section-head">
        <h3>{props.title}</h3>
        {props.hint && <p>{props.hint}</p>}
      </header>
      <div class="section-body">{props.children}</div>
    </section>
  );
}

export function Row(props: { label: string; value?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="row">
      <div class="row-top">
        <span class="row-label">{props.label}</span>
        {props.value !== undefined && <span class="row-value">{props.value}</span>}
      </div>
      {props.children}
    </div>
  );
}

/**
 * Native range input: smooth on iOS. Shows the value live while dragging
 * and commits on release, so the engine isn't restarted on every pixel.
 * The − / + buttons (Classic only, hidden by CSS in SmallFish) step exactly
 * one notch; holding them repeats and commits once on release.
 */
export function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onCommit: (v: number) => void;
}) {
  const [live, setLive] = useState(props.value);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = props.value;
    setLive(props.value);
  }, [props.value]);
  const nudge = (dir: 1 | -1) => () => {
    const next = Math.max(props.min, Math.min(props.max, liveRef.current + dir * props.step));
    if (next === liveRef.current) return false;
    liveRef.current = next;
    setLive(next);
    return true;
  };
  const commit = () => {
    if (liveRef.current !== props.value) props.onCommit(liveRef.current);
  };
  const lower = useHoldRepeat(nudge(-1), commit);
  const raise = useHoldRepeat(nudge(1), commit);
  const pct = ((live - props.min) / (props.max - props.min)) * 100;
  return (
    <Row label={props.label} value={props.format(live)}>
      <div class="slider-row">
        <button class="slider-step" aria-label={`Lower ${props.label}`} disabled={live <= props.min} {...lower}>
          −
        </button>
        <input
          type="range"
          class="slider"
          min={props.min}
          max={props.max}
          step={props.step}
          value={live}
          style={{ '--fill': `${pct}%` }}
          onInput={(e) => {
            liveRef.current = Number((e.target as HTMLInputElement).value);
            setLive(liveRef.current);
          }}
          onChange={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
        />
        <button class="slider-step" aria-label={`Raise ${props.label}`} disabled={live >= props.max} {...raise}>
          +
        </button>
      </div>
    </Row>
  );
}

export function Segmented<T extends string | number>(props: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div class="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === props.value}
          class={o.value === props.value ? 'seg on' : 'seg'}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** iOS 17.4+ renders `switch` checkboxes as native switches (with haptics). */
export function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="toggle">
      <span class="toggle-text">
        <span class="row-label">{props.label}</span>
        {props.hint && <span class="toggle-hint">{props.hint}</span>}
      </span>
      <input
        type="checkbox"
        // @ts-expect-error - `switch` is a valid boolean attribute in Safari 17.4+
        switch
        checked={props.checked}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
    </label>
  );
}

const ICONS: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  first: 'M17 5l-7 7 7 7M8 5v14',
  flip: 'M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3',
  undo: 'M9 7H5V3M5.6 7.4A8 8 0 1 1 4 13',
  plus: 'M12 5v14M5 12h14',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v7h14v-7',
  rematch: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  live: 'M5 6l6 6-6 6M13 6l6 6-6 6',
};

export function Icon(props: { name: keyof typeof ICONS | string }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[props.name]} />
    </svg>
  );
}

export function IconButton(props: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      class={props.active ? 'icon-btn active' : 'icon-btn'}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
      <span class="icon-btn-label">{props.label}</span>
    </button>
  );
}
