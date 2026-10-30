// Small chessops helpers shared by the UI thread and the engine host.
// Rules work is O(microseconds); searching never happens here.

import { Chess, castlingSide, normalizeMove } from 'chessops/chess';
import { INITIAL_FEN, makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import type { Move, NormalMove, Role } from 'chessops/types';
import { kingCastlesTo, makeSquare, makeUci, parseUci } from 'chessops/util';

export { INITIAL_FEN };

export function positionFromFen(fen: string): Chess {
  return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

/** Parses an engine/UI move (either castling notation) into a legal chessops move. */
export function parseLegalUci(pos: Chess, uci: string): NormalMove | undefined {
  const raw = parseUci(uci);
  if (!raw || !('from' in raw)) return undefined;
  const move = normalizeMove(pos, raw) as NormalMove;
  return pos.isLegal(move) ? move : undefined;
}

/** Standard UCI (e1g1 for castling), as engines and opening books expect. */
export function toStandardUci(pos: Chess, move: NormalMove): string {
  const side = castlingSide(pos, move);
  if (side) {
    return makeSquare(move.from) + makeSquare(kingCastlesTo(pos.turn, side));
  }
  return makeUci(move);
}

/** Position identity for repetition (board, side, castling, legal ep square). */
export function repetitionKey(pos: Chess): string {
  return makeFen(pos.toSetup()).split(' ', 4).join(' ');
}

export interface ReplayedGame {
  pos: Chess;
  /** Repetition key of every position, index = ply. */
  keys: string[];
  sans: string[];
}

/** Replays a game, stopping at the first illegal move. */
export function replay(startFen: string, moves: readonly string[]): ReplayedGame {
  const pos = positionFromFen(startFen);
  const keys = [repetitionKey(pos)];
  const sans: string[] = [];
  for (const uci of moves) {
    const move = parseLegalUci(pos, uci);
    if (!move) break;
    sans.push(makeSanAndPlay(pos, move));
    keys.push(repetitionKey(pos));
  }
  return { pos, keys, sans };
}

/** Converts a UCI line into SAN, truncated at the first illegal move. */
export function uciLineToSan(pos: Chess, line: readonly string[], limit = 14): string[] {
  const p = pos.clone();
  const out: string[] = [];
  for (const uci of line) {
    if (out.length >= limit) break;
    const move = parseLegalUci(p, uci);
    if (!move) break;
    out.push(makeSanAndPlay(p, move));
  }
  return out;
}

export const ROLE_VALUE: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 0,
};

/** Material balance in pawns, White minus Black. */
export function materialBalance(pos: Chess): number {
  let total = 0;
  for (const [, piece] of pos.board) {
    total += piece.color === 'white' ? ROLE_VALUE[piece.role] : -ROLE_VALUE[piece.role];
  }
  return total;
}

/** Total non-king material on the board, in pawns. */
export function totalMaterial(pos: Chess): number {
  let total = 0;
  for (const [, piece] of pos.board) total += ROLE_VALUE[piece.role];
  return total;
}

export function isPromotionMove(pos: Chess, move: Move): boolean {
  if (!('from' in move)) return false;
  const piece = pos.board.get(move.from);
  if (!piece || piece.role !== 'pawn') return false;
  const rank = move.to >> 3;
  return rank === 0 || rank === 7;
}

const SETUP_ERRORS: Record<string, string> = {
  ERR_EMPTY: 'The board is empty.',
  ERR_KINGS: 'Each side needs exactly one king.',
  ERR_PAWNS_ON_BACKRANK: 'Pawns can’t stand on the first or last rank.',
  ERR_OPPOSITE_CHECK: 'The side that is not to move is in check.',
  ERR_IMPOSSIBLE_CHECK: 'That check is impossible in a real game.',
  ERR_VARIANT: 'Not a standard chess position.',
};

/** Validates a full FEN for play; returns a readable error or null. */
export function fenError(fen: string): string | null {
  const setup = parseFen(fen.trim());
  if (setup.isErr) return 'That FEN can’t be read.';
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return SETUP_ERRORS[pos.error.message] ?? pos.error.message;
  return null;
}

/** Normalised FEN (makeFen of the parsed setup), or null if invalid. */
export function normalizeFen(fen: string): string | null {
  if (fenError(fen)) return null;
  return makeFen(positionFromFen(fen.trim()).toSetup());
}
