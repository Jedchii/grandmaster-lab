// Classic layout: opponent card with avatar, live status, speech bubble and
// opening name. Tap it to shrink it to one line (and back): the board moves up.

import { bubble, engine, flash, lastEngineNote } from '../../controller';
import { PROFILES, eloLabel } from '../../personas/meta';
import { lineKey, type EngineState } from '../../shared/protocol';
import { game } from '../../state/game';
import { engineSettings, uiSettings, updateUi } from '../../state/settings';

const STYLE_LABEL = { classic: 'Classic', aggressive: 'Hyper-Aggressive', positional: 'Positional', solid: 'Solid' } as const;

function subtitle(): string {
  const s = engineSettings.value;
  const strength = s.elo >= 3000 ? 'Full strength' : `~${s.elo} · ${eloLabel(s.elo)}`;
  switch (s.persona) {
    case 'patricia':
      return `${strength} · ${STYLE_LABEL[s.patriciaStyle]}`;
    case 'stockfish':
      return s.elo >= 3000 ? 'Full strength · benchmark' : `Elo ${s.elo} · limited`;
    case 'drawfish':
      return `${s.drawfishDefense === 'max' ? 'Max defence' : strength} · ${s.drawfishMode === 'relentless' ? 'Relentless' : 'Subtle troll'}`;
  }
}

function statusFor(state: EngineState, detail: string): { text: string; tone: string; dots: boolean } {
  if (game.result.value) return { text: 'Game over', tone: 'idle', dots: false };
  if (!game.atEnd.value) return { text: 'Reviewing · Next ▸ or swipe ← to return', tone: 'ponder', dots: false };
  const userTurn = game.turn.value === game.userSide.value;
  switch (state) {
    case 'loading':
      return { text: detail || 'Waking up', tone: 'busy', dots: true };
    case 'thinking':
      return { text: detail === 'Ponder hit' ? 'Ponder hit — thinking' : 'Thinking', tone: 'busy', dots: true };
    case 'pondering':
      return { text: 'Pondering on your time', tone: 'ponder', dots: true };
    case 'hint':
      return { text: detail || 'Finding a hint', tone: 'busy', dots: true };
    case 'book':
      return { text: 'Book move', tone: 'book', dots: false };
    case 'error':
      return { text: 'Engine problem — retrying', tone: 'error', dots: false };
    default:
      return { text: userTurn ? 'Your move' : 'Waiting', tone: 'idle', dots: false };
  }
}

const NOTE_LABEL: Partial<Record<string, string>> = {
  book: '📖 Book',
  sacrifice: '🔥 Sacrifice',
  repetition: '🔁 Repetition',
  perpetual: '♾️ Perpetual',
  simplify: '⚖️ Simplifying',
  fortress: '🏰 Fortress',
  troll: '😏 Trolling',
  instant: '⚡ Instant',
};

export function PersonaCard() {
  const s = engineSettings.value;
  const profile = PROFILES[s.persona];
  const state = engine.state.value;
  const flashText = flash.value;
  const status = flashText ? { text: flashText, tone: 'alert', dots: false } : statusFor(state, engine.detail.value);
  const info = engine.info.value;
  const busy = state === 'thinking' || state === 'pondering' || state === 'hint';
  const live = info && info.gameId === game.gameId.value && (info.mode === 'ponder' || info.line === lineKey(game.moves.value));
  const depth = busy && live ? info.depth : 0;
  const note = lastEngineNote.value;
  const noteLabel = note && note.gameId === game.gameId.value ? NOTE_LABEL[note.note] : undefined;
  const opening = engine.opening.value;
  const say = uiSettings.value.bubbles ? bubble.value : null;
  const identity = engine.identity.value;
  const compact = uiSettings.value.compactCard;
  const toggle = () => updateUi({ compactCard: !compact });
  const chevron = (
    <svg class="persona-chev" viewBox="0 0 24 24" aria-hidden="true">
      <path d={compact ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
    </svg>
  );

  // Compact: one slim line (avatar, name, status, depth / ECO), board moves up.
  if (compact) {
    return (
      <div
        class="persona compact glass"
        style={{ '--accent': profile.accent }}
        role="button"
        aria-expanded={false}
        aria-label="Show the full opponent card"
        onClick={toggle}
      >
        <div class={`avatar ${busy ? 'busy' : ''} ${state === 'pondering' ? 'pondering' : ''}`} aria-hidden="true">
          <span>{profile.avatar}</span>
        </div>
        <strong class="persona-cname">{profile.name}</strong>
        <div class={`status tone-${status.tone}`} aria-live="polite">
          <span class="status-dot" />
          <span class="status-text">{status.text}</span>
        </div>
        {depth > 0 ? (
          <span class="depth">d{depth}</span>
        ) : (
          opening && <span class="eco">{opening.eco}</span>
        )}
        {chevron}
        {say && (
          <div key={say.id} class="bubble" role="status">
            {say.text}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      class="persona glass"
      style={{ '--accent': profile.accent }}
      role="button"
      aria-expanded={true}
      aria-label="Shrink the opponent card"
      onClick={toggle}
    >
      {chevron}
      <div class="persona-main">
        <div class={`avatar ${busy ? 'busy' : ''} ${state === 'pondering' ? 'pondering' : ''}`} aria-hidden="true">
          <span>{profile.avatar}</span>
        </div>
        <div class="persona-text">
          <div class="persona-name">
            <strong>{profile.name}</strong>
            {identity && (
              <span class="chip" title={identity.name}>
                {identity.threaded ? 'WASM·MT' : 'WASM'}
              </span>
            )}
            {s.instamove && <span class="chip insta">⚡ Instamove</span>}
          </div>
          <div class="persona-sub">{subtitle()}</div>
          <div class={`status tone-${status.tone}`} aria-live="polite">
            <span class="status-dot" />
            <span class="status-text">{status.text}</span>
            {status.dots && (
              <span class="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
            {depth > 0 && <span class="depth">d{depth}</span>}
            {!busy && noteLabel && <span class="note">{noteLabel}</span>}
          </div>
        </div>
      </div>
      <div class="opening">
        {opening ? (
          <>
            <span class="eco">{opening.eco}</span>
            <span class="opening-name">{opening.name}</span>
            {opening.inBook && <span class="chip book">Book</span>}
          </>
        ) : (
          <span class="opening-name muted">{game.cursor.value === 0 ? 'Starting position' : 'Out of theory'}</span>
        )}
      </div>
      {say && (
        <div key={say.id} class="bubble" role="status">
          {say.text}
        </div>
      )}
    </div>
  );
}
