// Wires the game record, the engine host and sensory feedback together.

import { computed, effect, signal, untracked } from '@preact/signals';
import { EngineClient } from './engine/client';
import { haptic, setHapticsEnabled } from './feedback/haptics';
import { playSound, setSoundEnabled } from './feedback/sound';
import { PROFILES, line, triggerForNote, triggerForSignal, type DialogueTrigger } from './personas/meta';
import { lineKey, type BestMove, type HintResult, type Score, type SearchInfo, type Side } from './shared/protocol';
import { whiteShare } from './shared/score';
import { archiveCurrentGame, currentPgn, removeArchived, type ArchivedGame } from './state/archive';
import { game, opposite, type PlyRecord, type SavedGame } from './state/game';
import { engineSettings, uiSettings } from './state/settings';
import { showToast } from './state/ui';
import { flipped } from './state/view';

export const engine = new EngineClient();

/** Persona speech bubble. */
export const bubble = signal<{ id: number; text: string } | null>(null);
/** Short-lived status override ("Blunder found!"). */
export const flash = signal<string | null>(null);
/** Latest evaluation from White's point of view (real positions only). */
export const evaluation = signal<Score | null>(null);
/** Last engine move note, e.g. book / sacrifice / troll. */
export const lastEngineNote = signal<BestMove | null>(null);
/** Hint arrow for the user, valid only for the line it was computed on. */
export const hintArrow = signal<HintResult | null>(null);
/** Elapsed thinking time per side, whole seconds. */
export const clockSecs = signal({ me: 0, engine: 0 });

export interface SuggestionArrow {
  uci: string;
  /** 0.95 for the best move, fainter the worse (and lower ranked) it is. */
  opacity: number;
}
/** Suggestion arrows for the user's turn, valid only for the line they were computed on. */
export const suggestions = signal<{ gameId: number; line: string; arrows: SuggestionArrow[] } | null>(null);

/** Brightness caps by rank, so the order always reads even when moves are equal. */
const RANK_OPACITY = [0.95, 0.68, 0.45];
/** A move this many win-% points worse than the best one is not suggested. */
const MAX_DROP = 25;

function suggestionArrows(info: SearchInfo, userSide: Side): SuggestionArrow[] {
  const sign = userSide === 'white' ? 1 : -1;
  const seen = new Set<string>();
  const ranked: Array<{ uci: string; win: number }> = [];
  for (const l of [...info.lines].sort((a, b) => a.multipv - b.multipv)) {
    const uci = l.uci[0];
    if (!uci || seen.has(uci)) continue;
    seen.add(uci);
    const white = whiteShare(l.scoreWhite);
    ranked.push({ uci, win: sign === 1 ? white : 100 - white });
    if (ranked.length === 3) break;
  }
  if (!ranked.length) return [];
  const best = ranked[0].win;
  return ranked
    .map((r, i) => {
      const drop = Math.max(0, best - r.win);
      return { uci: r.uci, drop, opacity: Math.max(0.18, Math.min(RANK_OPACITY[i], 0.95 - drop * 0.03)) };
    })
    .filter((r, i) => i === 0 || r.drop <= MAX_DROP)
    .map(({ uci, opacity }) => ({ uci, opacity }));
}

let bubbleId = 0;
/** When the engine's last move landed (guards the Move/Now button). */
let engineMovedAt = 0;
let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
let lastSpokeAt = 0;

/** Persona speech bubble (only when bubbles are switched on in the settings). */
export function say(trigger: DialogueTrigger, force = false): void {
  if (!uiSettings.value.bubbles) return;
  const now = performance.now();
  if (!force && now - lastSpokeAt < 6000) return; // don't chatter
  const text = line(engineSettings.value.persona, trigger);
  if (!text) return;
  lastSpokeAt = now;
  bubble.value = { id: ++bubbleId, text };
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => (bubble.value = null), 4200);
}

function flashStatus(text: string, ms = 2600): void {
  flash.value = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flash.value = null), ms);
}

export function feedbackFor(record: PlyRecord, byUser: boolean): void {
  const castle = record.san.startsWith('O-O');
  playSound(record.check ? 'check' : record.capture ? 'capture' : castle ? 'castle' : 'move');
  if (byUser || record.check || record.capture) {
    haptic(record.check ? 'check' : record.capture ? 'capture' : 'tick');
  }
}

// ------------------------------------------------------------------ moves

/** Called by the board when the user completes a move. */
export function userMove(uci: string): boolean {
  const record = game.play(uci);
  if (!record) return false;
  feedbackFor(record, true);
  return true;
}

/** Undo (swipe right, Undo buttons). Steps per Options -> Undo / redo step. The host aborts any search. */
export function undo(): boolean {
  const ok = game.undo(uiSettings.value.undoStep);
  if (ok) {
    hintArrow.value = null;
    haptic('tick');
  } else {
    showToast('Start of game');
  }
  return ok;
}

/** Redo (swipe left): forward along the stored line. */
export function redo(): boolean {
  const ok = game.redo(uiSettings.value.undoStep);
  if (ok) haptic('tick');
  else showToast('No more moves');
  return ok;
}

/** A sideways swipe on the board or the SmallFish bottom zone. */
export function swipeStep(dir: 'left' | 'right'): void {
  if (dir === 'right') {
    if (undo()) showToast('↶ Undo', 700);
  } else if (redo()) {
    showToast('Redo ↷', 700);
  }
}

function resetForNewGame(): void {
  flipped.value = false;
  evaluation.value = null;
  lastEngineNote.value = null;
  hintArrow.value = null;
  suggestions.value = null;
  engine.info.value = null;
  resetClocks();
}

/** Colour for the next game: alternate, a fixed colour, or a coin flip. */
export function nextSide(choice: Side | 'random' | 'alternate' = 'alternate'): Side {
  if (choice === 'alternate') return opposite(game.userSide.value);
  if (choice === 'random') return Math.random() < 0.5 ? 'white' : 'black';
  return choice;
}

/** Saves the game being replaced, unless auto-save is switched off. */
function archiveOnReplace(): void {
  if (!uiSettings.value.autoArchive) return;
  const s = engineSettings.value;
  archiveCurrentGame(s.persona, s.elo);
}

/** Match history "Save current game" (works with auto-save off too). */
export function saveCurrentGame(): void {
  const s = engineSettings.value;
  showToast(archiveCurrentGame(s.persona, s.elo) ? 'Saved to Match history' : 'Nothing to save yet');
}

/** New game: archive the previous match, then start with the chosen colour (default: alternate). */
export function newGame(choice: Side | 'random' | 'alternate' = 'alternate'): void {
  archiveOnReplace();
  const side = nextSide(choice);
  game.newGame(side);
  resetForNewGame();
  showToast(`New game · you play ${side === 'white' ? 'White' : 'Black'}`);
  say('greet', true);
}

/** Start sparring from an edited position (archives the previous match). */
export function startFromPosition(fen: string, userSide: Side): void {
  archiveOnReplace();
  game.newGame(userSide, fen);
  resetForNewGame();
  showToast('Position loaded');
}

/**
 * Resume an archived match where it ended. It leaves the history while it is
 * the live game (it is archived again, with any new moves, when replaced).
 */
export function resumeArchived(entry: ArchivedGame): void {
  archiveOnReplace();
  removeArchived(entry.id);
  game.load({
    gameId: game.gameId.value + 1,
    startFen: entry.startFen,
    userSide: entry.userSide,
    moves: entry.moves.map((uci) => ({ uci })),
    cursor: entry.moves.length,
    resigned: null,
  });
  resetForNewGame();
  showToast('Match restored');
}

/** Classic Flip: turn the board around (view only). */
export function flipBoard(): void {
  flipped.value = !flipped.value;
}

/** Classic Back / Next: step through the line one ply at a time. */
export function stepBack(): boolean {
  if (game.cursor.value === 0) return false;
  game.jumpTo(game.cursor.value - 1);
  return true;
}

export function stepForward(): boolean {
  if (game.atEnd.value) return false;
  game.jumpTo(game.cursor.value + 1);
  return true;
}

/** SmallFish Flip: swap colours mid-game (orientation is locked, so the board turns). */
export function switchSides(): void {
  game.switchSides();
  hintArrow.value = null;
  showToast(`You now play ${game.userSide.value === 'white' ? 'White' : 'Black'}`);
}

/** Dock "Move": engine moves now / plays your move / continues from a reviewed position. */
export function moveButton(): void {
  if (game.result.value) {
    showToast('Game over');
    return;
  }
  if (!game.atEnd.value) {
    game.truncateFuture();
    if (game.turn.value === game.userSide.value) requestHint(true);
    return;
  }
  if (game.turn.value === game.engineSide.value) {
    engine.moveNow();
    return;
  }
  // The button reads "Now" while the engine thinks and "Move" on your turn.
  // A tap that lands just after the engine moved was meant as "Now": don't
  // turn it into an auto-played move for you.
  if (performance.now() - engineMovedAt < 600) return;
  requestHint(true);
}

export function hintButton(): void {
  if (game.result.value) return;
  if (game.turn.value !== game.userSide.value) {
    showToast('Hints are for your move');
    return;
  }
  requestHint(false);
}

function requestHint(autoplay: boolean): void {
  engine.hint(game.gameId.value, lineKey(game.moves.value), autoplay);
}

function onHint(h: HintResult): void {
  if (h.gameId !== game.gameId.value || h.line !== lineKey(game.moves.value)) return;
  if (h.autoplay) {
    userMove(h.uci);
    return;
  }
  hintArrow.value = h;
  const score = h.scoreWhite;
  const label = score ? (score.mate !== undefined ? `#${score.mate}` : `${((score.cp ?? 0) / 100).toFixed(1)}`) : '';
  showToast(`Hint: ${h.san}${label ? ` (${label})` : ''}`, 2600);
}

function onBestMove(move: BestMove): void {
  if (move.gameId !== game.gameId.value) return;
  const record = game.playEngine(move.uci, move.note, move.line);
  if (!record) return;
  engineMovedAt = performance.now();
  lastEngineNote.value = move;
  if (move.scoreWhite) evaluation.value = move.scoreWhite;
  feedbackFor(record, false);
  const trigger = triggerForNote(move.note);
  if (trigger) say(trigger);
}

export function resign(): void {
  game.resign();
}

export async function copyPgn(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentPgn());
    showToast('PGN copied');
  } catch {
    showToast('Copy failed');
  }
}

export async function sharePgn(pgn = currentPgn()): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Chess game (PGN)', text: pgn });
      return;
    } catch {
      /* cancelled */
      return;
    }
  }
  try {
    await navigator.clipboard.writeText(pgn);
    showToast('PGN copied');
  } catch {
    showToast('Sharing unavailable');
  }
}

// ----------------------------------------------------------------- clocks

const clockMs = { me: 0, engine: 0 };
let running: 'me' | 'engine' | null = null;
let since = 0;

function settleClock(): void {
  const now = performance.now();
  if (running) clockMs[running] += now - since;
  since = now;
  const next = { me: Math.floor(clockMs.me / 1000), engine: Math.floor(clockMs.engine / 1000) };
  const cur = clockSecs.value;
  if (cur.me !== next.me || cur.engine !== next.engine) clockSecs.value = next;
}

function resetClocks(): void {
  clockMs.me = 0;
  clockMs.engine = 0;
  since = performance.now();
  clockSecs.value = { me: 0, engine: 0 };
}

// ----------------------------------------------------------- persistence

const GAME_KEY = 'gml.game.v1';

function restoreGame(): void {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as SavedGame;
    if (saved?.v === 1) game.load(saved);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ start

export function startController(): void {
  restoreGame();

  engine.onBestMove = onBestMove;
  engine.onHint = onHint;
  engine.onSignal = (sig, gameId) => {
    if (gameId !== game.gameId.value) return;
    if (sig.kind === 'blunderFound') flashStatus('Blunder found!');
    if (sig.kind === 'mateFound') flashStatus(`Mate in ${sig.mateIn}`);
    const trigger = triggerForSignal(sig);
    if (trigger) say(trigger, sig.kind === 'blunderFound' || sig.kind === 'mateFound');
  };

  engine.init(engineSettings.value);

  // Settings -> host (skip the initial run; init already carried them).
  let first = true;
  effect(() => {
    const s = engineSettings.value;
    if (first) {
      first = false;
      return;
    }
    engine.setSettings(s);
  });

  effect(() => {
    setSoundEnabled(uiSettings.value.sound);
    setHapticsEnabled(uiSettings.value.haptics);
  });

  // The whole UI takes the active persona's accent colour.
  effect(() => {
    document.documentElement.style.setProperty('--accent', PROFILES[engineSettings.value.persona].accent);
  });

  // Game -> host on every move, undo, redo, branch, side switch or result.
  // The host stops any search the instant the line stops matching.
  const suggestOn = computed(() => uiSettings.value.suggestArrows);
  effect(() => {
    const moves = game.moves.value;
    engine.sync({
      gameId: game.gameId.value,
      startFen: game.startFen.value,
      moves,
      engineSide: game.engineSide.value,
      paused: !game.atEnd.value || game.result.value !== null,
      suggest: suggestOn.value,
    });
  });

  // Suggestion arrows belong to the position they were computed for.
  effect(() => {
    const key = lineKey(game.moves.value);
    const on = suggestOn.value;
    const current = untracked(() => suggestions.value);
    if (current && (!on || current.line !== key || current.gameId !== game.gameId.value)) suggestions.value = null;
  });

  // Hints belong to the position they were computed for.
  effect(() => {
    const key = lineKey(game.moves.value);
    const h = untracked(() => hintArrow.value);
    if (h && h.line !== key) hintArrow.value = null;
  });

  // Live evaluation: only real searches of the active position, so pondering
  // never leaks the engine's guess at your move.
  effect(() => {
    const info = engine.info.value;
    if (!info || info.mode === 'ponder') return;
    if (info.gameId !== untracked(() => game.gameId.value)) return;
    if (info.line !== untracked(() => lineKey(game.moves.value))) return;
    const best = info.lines[0];
    if (best && !best.bound && info.depth >= 6) evaluation.value = best.scoreWhite;
    // Suggestion arrows refine as the analysis deepens.
    if (info.mode === 'suggest' && untracked(() => uiSettings.value.suggestArrows)) {
      const arrows = suggestionArrows(info, untracked(() => game.userSide.value));
      if (arrows.length) suggestions.value = { gameId: info.gameId, line: info.line, arrows };
    }
  });

  // Game over reactions (once per finished line, not again when redoing).
  let announced = '';
  effect(() => {
    const result = game.result.value;
    if (!result || !game.atEnd.value) return;
    const id = `${game.gameId.value}:${game.length.value}:${result.reason}`;
    if (id === announced) return;
    announced = id;
    playSound('end');
    const engineSide = untracked(() => game.engineSide.value);
    const trigger: DialogueTrigger =
      result.winner === null ? 'draw' : result.winner === engineSide ? 'engineWins' : 'userWins';
    setTimeout(() => say(trigger, true), 350);
  });

  // Persist the game so an iOS PWA restart doesn't lose it.
  effect(() => {
    void game.line.value;
    void game.cursor.value;
    void game.userSide.value;
    void game.resigned.value;
    const snapshot = untracked(() => game.snapshot());
    try {
      localStorage.setItem(GAME_KEY, JSON.stringify(snapshot));
    } catch {
      /* storage full or blocked */
    }
  });

  // Clocks: the side to move at the live end of the line accumulates time.
  effect(() => {
    const live = game.atEnd.value && !game.result.value;
    const turn = game.turn.value;
    const userSide = game.userSide.value;
    settleClock();
    running = live ? (turn === userSide ? 'me' : 'engine') : null;
  });
  setInterval(() => {
    if (!document.hidden) settleClock();
    else since = performance.now();
  }, 500);

  document.addEventListener('visibilitychange', () => {
    settleClock();
    engine.setHidden(document.hidden);
  });

  say('greet', true);
}
