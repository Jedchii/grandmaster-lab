// Match archive + PGN serialisation.
//
// PGNs are anonymous - "only moves matter": every identifying header uses the
// standard unknown token. The Result tag (and movetext terminator) carries the
// real outcome so the file stays valid PGN; games from an edited position add
// the mandatory SetUp/FEN tags. The list shown in the app (date, opponent,
// Elo) lives in separate metadata next to the PGN, never inside it.

import { signal } from '@preact/signals';
import { INITIAL_FEN } from '../shared/chess';
import type { PersonaId, Side } from '../shared/protocol';
import { game, resultToken } from './game';

export interface ArchivedGame {
  id: string;
  savedAt: number;
  pgn: string;
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  persona: PersonaId;
  elo: number;
  userSide: Side;
  plies: number;
  startFen: string;
  moves: string[];
  /** The live game it was saved from: saving the same game again updates this entry. */
  gameId?: number;
}

const KEY = 'gml.archive.v1';
const MAX_GAMES = 200;

export interface PgnInput {
  startFen: string;
  sans: string[];
  result: '1-0' | '0-1' | '1/2-1/2' | '*';
  startFullmove: number;
  startTurn: Side;
}

export function buildPgn(input: PgnInput): string {
  const headers = [
    ['Event', '?'],
    ['Site', '?'],
    ['Date', '????.??.??'],
    ['Round', '?'],
    ['White', '?'],
    ['Black', '?'],
    ['Result', input.result],
  ];
  if (input.startFen !== INITIAL_FEN) {
    headers.push(['SetUp', '1'], ['FEN', input.startFen]);
  }
  const tokens: string[] = [];
  let number = input.startFullmove;
  let white = input.startTurn === 'white';
  input.sans.forEach((san, i) => {
    if (white) tokens.push(`${number}.`);
    else if (i === 0) tokens.push(`${number}...`);
    tokens.push(san);
    if (!white) number++;
    white = !white;
  });
  tokens.push(input.result);

  // Wrap movetext at 80 columns, as the PGN standard recommends.
  const lines: string[] = [];
  let current = '';
  for (const t of tokens) {
    const joined = current ? `${current} ${t}` : t;
    if (joined.length > 80 && current) {
      lines.push(current);
      current = t;
    } else {
      current = joined;
    }
  }
  if (current) lines.push(current);

  return `${headers.map(([k, v]) => `[${k} "${v}"]`).join('\n')}\n\n${lines.join('\n')}\n`;
}

/** PGN of the current game's whole line (including any moves you could redo). */
export function currentPgn(): string {
  const line = game.line.value;
  const start = game.start.value;
  return buildPgn({
    startFen: game.startFen.value,
    sans: line.map((p) => p.san),
    result: resultToken(game.resultAt(line.length)),
    startFullmove: start.fullmove,
    startTurn: start.turn,
  });
}

const PERSONA_IDS = ['patricia', 'stockfish', 'drawfish'];
const RESULTS = ['1-0', '0-1', '1/2-1/2', '*'];

/** Drops entries that would break the history list (corrupt or from another version). */
function valid(g: unknown): g is ArchivedGame {
  const e = g as Partial<ArchivedGame> | null;
  return (
    !!e &&
    typeof e.id === 'string' &&
    typeof e.savedAt === 'number' &&
    typeof e.pgn === 'string' &&
    RESULTS.includes(e.result as string) &&
    PERSONA_IDS.includes(e.persona as string) &&
    typeof e.elo === 'number' &&
    (e.userSide === 'white' || e.userSide === 'black') &&
    typeof e.startFen === 'string' &&
    Array.isArray(e.moves) &&
    e.moves.every((m) => typeof m === 'string')
  );
}

function load(): ArchivedGame[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(valid).map((g) => ({ ...g, plies: g.moves.length }));
    }
  } catch {
    /* unavailable or corrupt storage */
  }
  return [];
}

export const archive = signal<ArchivedGame[]>(load());

function persist(list: ArchivedGame[]): void {
  archive.value = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: keep the in-memory list */
  }
}

/** Archives the current game if it has any moves. Returns the entry (or null). */
export function archiveCurrentGame(persona: PersonaId, elo: number): ArchivedGame | null {
  const line = game.line.value;
  if (!line.length) return null;
  const entry: ArchivedGame = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: Date.now(),
    pgn: currentPgn(),
    result: resultToken(game.resultAt(line.length)),
    persona,
    elo,
    userSide: game.userSide.value,
    plies: line.length,
    startFen: game.startFen.value,
    moves: line.map((p) => p.uci),
    gameId: game.gameId.value,
  };
  // Saving the same live game again ("Save current game now", then auto-save
  // at the next New Game) updates its entry; so does archiving an identical
  // game (e.g. resumed, then left untouched). No duplicates either way.
  const key = gameKey(entry);
  const continued = (g: ArchivedGame) =>
    g.gameId === entry.gameId &&
    g.startFen === entry.startFen &&
    g.moves.length <= entry.moves.length &&
    g.moves.every((m, i) => entry.moves[i] === m);
  const same = (g: ArchivedGame) => gameKey(g) === key || continued(g);
  persist([entry, ...archive.value.filter((g) => !same(g))].slice(0, MAX_GAMES));
  return entry;
}

const gameKey = (g: Pick<ArchivedGame, 'startFen' | 'userSide' | 'moves' | 'result'>) =>
  `${g.startFen}|${g.userSide}|${g.result}|${g.moves.join(' ')}`;

export function removeArchived(id: string): void {
  persist(archive.value.filter((g) => g.id !== id));
}
