// Top status / clock bar. The whole bar is the trigger for the slide-down
// shelf: tap it and the board springs down to reveal the game controls.
// Optional lock (Options -> Header menu): the right pill becomes a lock
// button; while locked, taps on the header do nothing.
// (iOS keeps taps on its own status bar, so this bar sits directly under it
// and reaches up into the safe area as far as the system allows.)

import { clockSecs, engine, flash } from '../controller';
import { PROFILES } from '../personas/meta';
import { game } from '../state/game';
import { useState } from 'preact/hooks';
import { engineSettings, uiSettings, updateUi } from '../state/settings';
import { shelfOpen } from '../state/ui';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function statusText(): { text: string; tone: string } {
  if (flash.value) return { text: flash.value, tone: 'alert' };
  const persona = PROFILES[engineSettings.value.persona];
  const result = game.result.value;
  if (result) {
    const who = result.winner === null ? 'Draw' : result.winner === game.userSide.value ? 'You win' : `${persona.name} wins`;
    return { text: `${who} · ${result.reason}`, tone: 'idle' };
  }
  if (!game.atEnd.value) return { text: 'Reviewing · swipe ← to redo', tone: 'review' };
  switch (engine.state.value) {
    case 'loading':
      return { text: `${persona.name} is waking up…`, tone: 'busy' };
    case 'thinking':
      return { text: `${persona.name} is thinking…`, tone: 'busy' };
    case 'pondering':
      return { text: 'Your move · pondering', tone: 'ponder' };
    case 'hint':
      return { text: engine.detail.value || 'Finding a hint…', tone: 'busy' };
    case 'book': {
      const o = engine.opening.value;
      return { text: o ? `Book · ${o.eco} ${o.name}` : 'Book move', tone: 'book' };
    }
    case 'error':
      return { text: 'Engine problem — retrying', tone: 'error' };
    default:
      return { text: game.turn.value === game.userSide.value ? 'Your move' : `${persona.name} to move`, tone: 'idle' };
  }
}

const LOCK_PATH = 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6z';
const UNLOCK_PATH = 'M7 11V8a5 5 0 0 1 9.6-2M6 11h12v10H6z';

export function Header() {
  const [nudge, setNudge] = useState(0);
  const open = shelfOpen.value;
  const clocks = clockSecs.value;
  const live = game.atEnd.value && !game.result.value;
  const userSide = game.userSide.value;
  const myTurn = game.turn.value === userSide;
  const persona = PROFILES[engineSettings.value.persona];
  const { headerLock, headerLocked } = uiSettings.value;
  const locked = headerLock && headerLocked && !open; // an open menu can always be closed
  const status = statusText();
  const toggleMenu = () => {
    if (locked) {
      setNudge((n) => n + 1); // the lock wiggles: "I'm locked"
      return;
    }
    shelfOpen.value = !open;
  };
  return (
    <div
      class={`header ${open ? 'open' : ''} ${locked ? 'locked' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-disabled={locked}
      aria-label={locked ? 'Game menu locked' : open ? 'Close game menu' : 'Open game menu'}
      onClick={toggleMenu}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleMenu()}
    >
      <span class={`hdr-clock ${live && myTurn ? 'running' : ''}`}>
        <span class={`side-dot ${userSide}`} />
        <span class="hdr-who">Me</span>
        <span class="hdr-time">{fmt(clocks.me)}</span>
      </span>
      <span class={`hdr-status tone-${status.tone}`}>
        <span class="hdr-text">{status.text}</span>
        {!locked && (
          <svg class="hdr-chev" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </span>
      {headerLock ? (
        <button
          key={nudge}
          class={`hdr-clock right hdr-lock ${live && !myTurn ? 'running' : ''} ${headerLocked ? 'on' : ''} ${nudge ? 'nudge' : ''}`}
          aria-pressed={headerLocked}
          aria-label={headerLocked ? 'Unlock the game menu' : 'Lock the game menu'}
          onClick={(e) => {
            e.stopPropagation();
            updateUi({ headerLocked: !headerLocked });
          }}
        >
          <span class="hdr-time">{fmt(clocks.engine)}</span>
          <svg class="hdr-lock-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d={headerLocked ? LOCK_PATH : UNLOCK_PATH} />
          </svg>
          <span class={`side-dot ${game.engineSide.value}`} />
        </button>
      ) : (
        <span class={`hdr-clock right ${live && !myTurn ? 'running' : ''}`}>
          <span class="hdr-time">{fmt(clocks.engine)}</span>
          <span class="hdr-who">{persona.avatar}</span>
          <span class={`side-dot ${game.engineSide.value}`} />
        </span>
      )}
    </div>
  );
}
