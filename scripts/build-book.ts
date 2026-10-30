// Builds "The Grandmaster Files": one merged, pruned Polyglot book from the
// source books in ../Opening Data Base.
//   pnpm book                     (node scripts/run-ts.mjs scripts/build-book.ts)
//
// * Walks every book line from the starting position (breadth first, up to
//   40 plies - the app's maximum book depth), so positions no game can reach
//   from the start are dropped.
// * Each source votes per position with its own weights normalised to 1, scaled
//   by a trust factor; votes combine as a blend of the average and the best
//   single-book vote (see MERGE).
// * Variety where it matters: up to 7 moves early, fewer and stricter later
//   (override with BOOK_TIERS='[[untilPly, rel, max], ...]').
// * Output is a standard Polyglot file (16-byte big-endian entries, sorted by
//   key), so it also works in any chess GUI.

import fs from 'node:fs';
import path from 'node:path';
import type { Chess } from 'chessops/chess';
import { INITIAL_FEN, parseLegalUci, positionFromFen, toStandardUci } from '../src/shared/chess';
import { PolyglotBook, decodePolyglotMove, keyToHex, polyglotKey } from '../src/workers/book/polyglot';

const SOURCE_DIR = path.resolve(process.env.BOOK_SOURCES ?? path.join('..', 'Opening Data Base'));
const OUT = path.resolve('public', 'books', 'The-Grandmaster-Files.bin');
const MAX_PLY = 40;

/** Trust per source book (missing files are skipped). */
const SOURCES: Array<[file: string, trust: number]> = [
  ['Perfect2021.bin', 1.0],
  ['komodo.bin', 1.0],
  ['codekiddy.bin', 0.8],
  ['gm2001.bin', 0.6],
];

/** Keep moves scoring at least `rel` x the best move, at most `max` of them. */
const TIERS: Array<[untilPly: number, rel: number, max: number]> = process.env.BOOK_TIERS
  ? JSON.parse(process.env.BOOK_TIERS)
  : [
      [10, 0.06, 7], // first moves: real variety
      [20, 0.15, 3], // main lines and their serious alternatives
      [28, 0.4, 2],
      [MAX_PLY, 0.6, 1], // deep theory: main line only
    ];
function tier(ply: number): { rel: number; max: number } {
  const [, rel, max] = TIERS.find(([until]) => ply < until) ?? TIERS[TIERS.length - 1];
  return { rel, max };
}

const books = SOURCES.flatMap(([file, trust]) => {
  const p = path.join(SOURCE_DIR, file);
  if (!fs.existsSync(p)) {
    console.warn(`skip ${file}: not found in ${SOURCE_DIR}`);
    return [];
  }
  const buf = fs.readFileSync(p);
  const book = new PolyglotBook(file, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  console.log(`source ${file}: ${book.entries.toLocaleString()} entries (${(buf.byteLength / 1e6).toFixed(2)} MB)`);
  return [{ book, trust }];
});
if (!books.length) throw new Error(`no source books in ${SOURCE_DIR}`);

/** Polyglot encoding of a standard UCI move (castling as king-takes-rook). */
function encodeMove(uci: string): number {
  const castles: Record<string, string> = { e1g1: 'e1h1', e1c1: 'e1a1', e8g8: 'e8h8', e8c8: 'e8a8' };
  const u = castles[uci] ?? uci;
  const file = (c: string) => c.charCodeAt(0) - 97;
  const row = (c: string) => Number(c) - 1;
  const promo = { n: 1, b: 2, r: 3, q: 4 }[u[4] as 'n' | 'b' | 'r' | 'q'] ?? 0;
  return file(u[2]) | (row(u[3]) << 3) | (file(u[0]) << 6) | (row(u[1]) << 9) | (promo << 12);
}

/**
 * How the books' votes combine: 'blend' (default) = half the trust-weighted
 * average, half the best single-book vote. A pure average lets one-move
 * engine books (Komodo, Perfect 2021) vote down every alternative another
 * book knows; the max half keeps those real alternatives in play.
 */
const MERGE = (process.env.BOOK_MERGE ?? 'blend') as 'avg' | 'max' | 'blend';

function votes(pos: Chess): Array<[uci: string, score: number]> {
  const key = polyglotKey(pos);
  const scores = new Map<string, number>();
  const best = new Map<string, number>();
  let trustSum = 0;
  for (const { book, trust } of books) {
    const entries = book.probe(key);
    if (!entries.length) continue;
    const total = entries.reduce((s, e) => s + e.weight, 0);
    trustSum += trust;
    for (const e of entries) {
      const m = parseLegalUci(pos, decodePolyglotMove(e.move));
      if (!m) continue;
      const uci = toStandardUci(pos, m);
      const frac = total ? e.weight / total : 1 / entries.length;
      scores.set(uci, (scores.get(uci) ?? 0) + trust * frac);
      best.set(uci, Math.max(best.get(uci) ?? 0, trust * frac));
    }
  }
  if (!trustSum) return [];
  const combine = (uci: string, sum: number) => {
    const avg = sum / trustSum;
    const max = best.get(uci) ?? 0;
    return MERGE === 'avg' ? avg : MERGE === 'max' ? max : (avg + max) / 2;
  };
  return [...scores.entries()].map(([u, s]) => [u, combine(u, s)] as [string, number]).sort((a, b) => b[1] - a[1]);
}

interface Out {
  hi: number;
  lo: number;
  move: number;
  weight: number;
}

const t0 = performance.now();
const done = new Set<string>();
const out: Out[] = [];
let frontier: Chess[] = [positionFromFen(INITIAL_FEN)];
for (let ply = 0; ply < MAX_PLY && frontier.length; ply++) {
  const next: Chess[] = [];
  const { rel, max } = tier(ply);
  for (const pos of frontier) {
    const key = polyglotKey(pos);
    const hex = keyToHex(key);
    if (done.has(hex)) continue; // transposition already expanded
    done.add(hex);
    const list = votes(pos);
    if (!list.length) continue;
    const top = list[0][1];
    for (const [uci, score] of list.filter(([, s]) => s >= top * rel).slice(0, max)) {
      // Weights relative to the best move: 1..10000.
      out.push({ ...key, move: encodeMove(uci), weight: Math.max(1, Math.round((score / top) * 10000)) });
      const child = pos.clone();
      child.play(parseLegalUci(child, uci)!);
      next.push(child);
    }
  }
  frontier = next;
}

out.sort((a, b) => a.hi - b.hi || a.lo - b.lo || b.weight - a.weight);
const buf = Buffer.alloc(out.length * 16);
out.forEach((e, i) => {
  const o = i * 16;
  buf.writeUInt32BE(e.hi, o);
  buf.writeUInt32BE(e.lo, o + 4);
  buf.writeUInt16BE(e.move, o + 8);
  buf.writeUInt16BE(e.weight, o + 10);
  buf.writeUInt32BE(0, o + 12); // learn
});
fs.writeFileSync(OUT, buf);
const sourceBytes = books.reduce((s, b) => s + b.book.entries * 16, 0);
console.log(
  `The Grandmaster Files: ${done.size.toLocaleString()} positions, ${out.length.toLocaleString()} moves, ` +
    `${(buf.byteLength / 1e6).toFixed(2)} MB (from ${(sourceBytes / 1e6).toFixed(1)} MB) in ${Math.round(performance.now() - t0)} ms -> ${OUT}`,
);
