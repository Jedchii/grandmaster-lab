// Polyglot opening book reader.
//
// Keys are computed as two unsigned 32-bit halves (no BigInt) and entries are
// found by binary search over the 16-byte big-endian records, so a probe is a
// few microseconds - far below the 1 ms budget.

import type { Chess } from 'chessops/chess';
import type { Role } from 'chessops/types';
import { makeSanAndPlay } from 'chessops/san';
import { parseLegalUci, toStandardUci } from '../../shared/chess';
import { POLYGLOT_RANDOM as R } from './polyglot-random';

export interface PolyKey {
  hi: number;
  lo: number;
}

const ROLE_INDEX: Record<Role, number> = {
  pawn: 0,
  knight: 1,
  bishop: 2,
  rook: 3,
  queen: 4,
  king: 5,
};

const CASTLE_OFFSET = 768;
const EP_OFFSET = 772;
const TURN_OFFSET = 780;

export function polyglotKey(pos: Chess): PolyKey {
  let hi = 0;
  let lo = 0;
  for (const [square, piece] of pos.board) {
    // chessops squares are rank * 8 + file, exactly Polyglot's 8 * row + file.
    const kind = ROLE_INDEX[piece.role] * 2 + (piece.color === 'white' ? 1 : 0);
    const i = (64 * kind + square) * 2;
    hi ^= R[i];
    lo ^= R[i + 1];
  }

  const rights = pos.castles.castlingRights;
  const castle = (has: boolean, n: number) => {
    if (has) {
      hi ^= R[(CASTLE_OFFSET + n) * 2];
      lo ^= R[(CASTLE_OFFSET + n) * 2 + 1];
    }
  };
  castle(rights.has(7), 0); // white short
  castle(rights.has(0), 1); // white long
  castle(rights.has(63), 2); // black short
  castle(rights.has(56), 3); // black long

  // En passant only counts when a pawn of the side to move stands beside the
  // pawn that just made the double step.
  if (pos.epSquare !== undefined) {
    const file = pos.epSquare & 7;
    const pawnRank = pos.turn === 'white' ? 4 : 3;
    const ourPawns = pos.board.pawn.intersect(pos.board[pos.turn]);
    const beside =
      (file > 0 && ourPawns.has(pawnRank * 8 + file - 1)) ||
      (file < 7 && ourPawns.has(pawnRank * 8 + file + 1));
    if (beside) {
      hi ^= R[(EP_OFFSET + file) * 2];
      lo ^= R[(EP_OFFSET + file) * 2 + 1];
    }
  }

  if (pos.turn === 'white') {
    hi ^= R[TURN_OFFSET * 2];
    lo ^= R[TURN_OFFSET * 2 + 1];
  }
  return { hi: hi >>> 0, lo: lo >>> 0 };
}

export function keyToHex(key: PolyKey): string {
  return key.hi.toString(16).padStart(8, '0') + key.lo.toString(16).padStart(8, '0');
}

export interface RawEntry {
  move: number;
  weight: number;
}

const FILES = 'abcdefgh';
const PROMO = ['', 'n', 'b', 'r', 'q'];

/** Polyglot move bits -> UCI (castling still king-takes-rook here). */
export function decodePolyglotMove(move: number): string {
  const toFile = move & 7;
  const toRow = (move >> 3) & 7;
  const fromFile = (move >> 6) & 7;
  const fromRow = (move >> 9) & 7;
  const promo = (move >> 12) & 7;
  return FILES[fromFile] + (fromRow + 1) + FILES[toFile] + (toRow + 1) + (PROMO[promo] ?? '');
}

export class PolyglotBook {
  private readonly view: DataView;
  readonly entries: number;

  constructor(
    readonly id: string,
    buffer: ArrayBuffer,
  ) {
    this.view = new DataView(buffer);
    this.entries = Math.floor(buffer.byteLength / 16);
  }

  probe(key: PolyKey): RawEntry[] {
    const v = this.view;
    let lo = 0;
    let hi = this.entries;
    // Lower bound on (keyHi, keyLo), compared as unsigned 32-bit pairs.
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const off = mid * 16;
      const kh = v.getUint32(off);
      const kl = v.getUint32(off + 4);
      if (kh < key.hi || (kh === key.hi && kl < key.lo)) lo = mid + 1;
      else hi = mid;
    }
    const out: RawEntry[] = [];
    for (let i = lo; i < this.entries; i++) {
      const off = i * 16;
      if (v.getUint32(off) !== key.hi || v.getUint32(off + 4) !== key.lo) break;
      out.push({ move: v.getUint16(off + 8), weight: v.getUint16(off + 10) });
    }
    return out;
  }
}

export interface BookMove {
  uci: string;
  san: string;
  /** Share of the combined weight, 0..1. */
  share: number;
}

/** Combines several books; each book's weights are normalised so they vote equally. */
export function bookMoves(books: readonly PolyglotBook[], pos: Chess): BookMove[] {
  if (!books.length) return [];
  const key = polyglotKey(pos);
  const combined = new Map<string, number>();
  for (const book of books) {
    const entries = book.probe(key);
    const total = entries.reduce((sum, e) => sum + e.weight, 0);
    if (!total) continue;
    for (const entry of entries) {
      const move = parseLegalUci(pos, decodePolyglotMove(entry.move));
      if (!move) continue;
      const uci = toStandardUci(pos, move);
      combined.set(uci, (combined.get(uci) ?? 0) + entry.weight / total);
    }
  }
  const sum = [...combined.values()].reduce((a, b) => a + b, 0);
  if (!sum) return [];
  const top = Math.max(...combined.values());
  return [...combined.entries()]
    .filter(([, w]) => w >= top * 0.04) // drop junk side lines
    .sort((a, b) => b[1] - a[1])
    .map(([uci, w]) => {
      const p = pos.clone();
      const san = makeSanAndPlay(p, parseLegalUci(p, uci)!);
      return { uci, san, share: w / sum };
    });
}

/** Weighted random pick; `sharpness` > 1 favours the main lines. */
export function pickBookMove(moves: readonly BookMove[], sharpness = 1.3, rand = Math.random): BookMove | undefined {
  if (!moves.length) return undefined;
  const weights = moves.map((m) => Math.pow(m.share, sharpness));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i];
    if (r <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}
