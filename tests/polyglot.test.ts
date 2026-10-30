// Verifies the Polyglot hasher and book reader against python-chess.
//   node scripts/run-ts.mjs tests/polyglot.test.ts

import fs from 'node:fs';
import { replay, positionFromFen, parseLegalUci, INITIAL_FEN } from '../src/shared/chess';
import { polyglotKey, keyToHex, PolyglotBook, bookMoves, pickBookMove } from '../src/workers/book/polyglot';

interface Vector {
  fen: string;
  moves: string[];
  keys: string[];
}

let failures = 0;
const vectors: Vector[] = JSON.parse(fs.readFileSync('scripts/polyglot-vectors.json', 'utf8'));
let checked = 0;
for (const v of vectors) {
  const pos = positionFromFen(v.fen);
  const keys = [keyToHex(polyglotKey(pos))];
  for (const uci of v.moves) {
    const move = parseLegalUci(pos, uci);
    if (!move) throw new Error(`illegal ${uci}`);
    pos.play(move);
    keys.push(keyToHex(polyglotKey(pos)));
  }
  for (let i = 0; i < keys.length; i++) {
    checked++;
    if (keys[i] !== v.keys[i]) {
      failures++;
      if (failures < 5) console.log(`key mismatch ply ${i}: ${keys[i]} != ${v.keys[i]} (${v.moves.slice(0, i).join(' ')})`);
    }
  }
}
console.log(`${failures ? 'FAIL' : 'PASS'} polyglot keys: ${checked - failures}/${checked} match python-chess`);

const start = positionFromFen(INITIAL_FEN);
console.log(`start key ${keyToHex(polyglotKey(start))} (expected 463b96181691fc9c)`);
if (keyToHex(polyglotKey(start)) !== '463b96181691fc9c') failures++;

const books = ['The-Grandmaster-Files'].map(
  (n) => new PolyglotBook(n, new Uint8Array(fs.readFileSync(`public/books/${n}.bin`)).buffer),
);
const t0 = performance.now();
let probes = 0;
for (let i = 0; i < 2000; i++) {
  bookMoves(books, start);
  probes++;
}
const perProbe = (performance.now() - t0) / probes;
console.log(`${perProbe < 1 ? 'PASS' : 'FAIL'} book probe + SAN: ${perProbe.toFixed(4)} ms per call`);
if (perProbe >= 1) failures++;

const startMoves = bookMoves(books, start);
console.log('startpos:', startMoves.map((m) => `${m.san} ${(m.share * 100).toFixed(1)}%`).join(', '));
const sicilian = replay(INITIAL_FEN, ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3']).pos;
const najdorf = bookMoves(books, sicilian);
console.log('open sicilian:', najdorf.map((m) => `${m.san} ${(m.share * 100).toFixed(1)}%`).join(', '));
if (!najdorf.length) failures++;

// Castling must come out in standard UCI.
const ruy = replay(INITIAL_FEN, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6']).pos;
const ruyMoves = bookMoves(books, ruy);
console.log('ruy lopez:', ruyMoves.map((m) => `${m.san}=${m.uci}`).join(', '));
if (!ruyMoves.some((m) => m.uci === 'e1g1')) {
  failures++;
  console.log('FAIL castling not converted to e1g1');
}
const pick = pickBookMove(startMoves);
console.log('random pick:', pick?.san);

console.log(failures ? `\n${failures} failure(s)` : '\nall polyglot checks passed');
process.exitCode = failures ? 1 : 0;
