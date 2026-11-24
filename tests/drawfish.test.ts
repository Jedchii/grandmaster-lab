// DrawFish move-selection checks.
//   node scripts/run-ts.mjs tests/drawfish.test.ts

import { INITIAL_FEN, replay } from '../src/shared/chess';
import { chooseDrawfishMove, type RootLine } from '../src/workers/drawfish';

let failures = 0;
function expect(label: string, actual: string, expected: string) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: got ${actual}${ok ? '' : `, expected ${expected}`}`);
}

const line = (multipv: number, pv: string[], cp: number): RootLine => ({ multipv, depth: 18, score: { cp }, pv });

// 1. Claims a threefold repetition even when a much better move exists.
{
  const g = replay(INITIAL_FEN, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1']);
  const lines = [line(1, ['e7e5', 'e2e4'], 300), line(2, ['f6g8', 'g1f3'], 0)];
  const c = chooseDrawfishMove(g.pos, g.keys, lines, 'relentless', 'e7e5');
  expect('threefold claim (relentless)', `${c.uci}/${c.note}`, 'f6g8/repetition');
  const s = chooseDrawfishMove(g.pos, g.keys, [line(1, ['e7e5'], 120), line(2, ['f6g8'], 0)], 'subtle', 'e7e5');
  expect('threefold claim (subtle, small edge)', s.uci, 'f6g8');
}

// 2. Winning: Trollfish rule - hover just above zero instead of maximising.
{
  const g = replay(INITIAL_FEN, []);
  const lines = [
    line(1, ['e2e4', 'e7e5'], 40),
    line(2, ['d2d4', 'd7d5'], 35),
    line(3, ['g1f3', 'g8f6'], 25),
    line(4, ['a2a3', 'e7e5'], 5),
    line(5, ['g2g4', 'd7d5'], -80),
  ];
  const r = chooseDrawfishMove(g.pos, g.keys, lines, 'relentless', 'e2e4');
  expect('relentless picks the most level move', r.uci, 'a2a3');
  const s = chooseDrawfishMove(g.pos, g.keys, lines, 'subtle', 'e2e4');
  expect('subtle hovers at a small plus', `${s.uci}/${s.note}`, 'g1f3/troll');
}

// 3. Losing: turn Stockfish back on.
{
  const g = replay(INITIAL_FEN, ['f2f3', 'e7e5']);
  const lines = [line(1, ['g2g4', 'd8h4'], -320), line(2, ['e2e4', 'b8c6'], -60), line(3, ['a2a4'], -150)];
  const c = chooseDrawfishMove(g.pos, g.keys, lines, 'relentless', 'e2e4');
  expect('never walks into a forced loss', c.uci, 'e2e4');
}

// 4. Mate available but a level line exists: DrawFish declines the win.
{
  const g = replay(INITIAL_FEN, ['f2f3', 'e7e5', 'g2g4']);
  const lines: RootLine[] = [
    { multipv: 1, depth: 20, score: { mate: 1 }, pv: ['d8h4'] },
    line(2, ['g8f6', 'e2e4'], 30),
  ];
  const c = chooseDrawfishMove(g.pos, g.keys, lines, 'relentless', 'd8h4');
  expect('declines mate in 1 (troll)', c.uci, 'g8f6');
}

// 5. Every line is a forced mate for her: she takes the slowest one, never
//    the mate in 1 (K+Q vs K, white Kf6 Qg1, black Kh8).
{
  const g = replay('7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', []);
  const lines: RootLine[] = [
    { multipv: 1, depth: 30, score: { mate: 1 }, pv: ['g1g7'] },
    { multipv: 2, depth: 30, score: { mate: 2 }, pv: ['g1g2', 'h8h7'] },
    { multipv: 3, depth: 30, score: { mate: 4 }, pv: ['g1a1', 'h8h7'] },
  ];
  for (const mode of ['relentless', 'subtle'] as const) {
    const c = chooseDrawfishMove(g.pos, g.keys, lines, mode, 'g1g7');
    expect(`all lines mate (${mode}): slowest mate, not mate in 1`, c.uci, 'g1a1');
  }
}

// 6. Equally slow mates: keep the 50-move count running (no pawn move).
{
  const g = replay('7k/8/5K2/8/8/8/P7/6Q1 w - - 0 1', []);
  const lines: RootLine[] = [
    { multipv: 1, depth: 30, score: { mate: 3 }, pv: ['a2a3', 'h8h7'] },
    { multipv: 2, depth: 30, score: { mate: 3 }, pv: ['g1b1', 'h8h7'] },
  ];
  const c = chooseDrawfishMove(g.pos, g.keys, lines, 'relentless', 'a2a3');
  expect('equally slow mates: no clock reset', c.uci, 'g1b1');
}

// 7. Hopelessly winning (every move keeps +4 or more): she avoids pawn moves
//    and captures, so the 50-move rule can end it, even if a pawn push is the
//    move closest to level.
{
  const g = replay('7k/8/5K2/8/8/8/P7/6Q1 w - - 0 1', []);
  const lines = [line(1, ['g1d4', 'h8g8'], 600), line(2, ['a2a3', 'h8h7'], 420), line(3, ['g1b1', 'h8h7'], 480)];
  const c = chooseDrawfishMove(g.pos, g.keys, lines, 'relentless', 'g1d4');
  expect('hopeless win: no pawn move or capture', c.uci, 'g1b1');
  const level = [line(1, ['g1d4', 'h8g8'], 120), line(2, ['a2a3', 'h8h7'], 10), line(3, ['g1b1', 'h8h7'], 60)];
  const d = chooseDrawfishMove(g.pos, g.keys, level, 'relentless', 'g1d4');
  expect('not hopeless: closest to level, pawn move allowed', d.uci, 'a2a3');
}

// 8. Behind: no bonus for trading pieces (it helps the side that's ahead),
//    pawn trades still count. Black to move can trade knights (Nxd4 Qxd4) or
//    pawns (dxe4 fxe4), or play a quiet move.
{
  const g = replay('r1bqkb1r/ppp2ppp/2n5/3p4/3NP3/5P2/PPP3PP/RNBQKB1R b KQkq - 0 6', []);
  const quiet = line(1, ['a7a6', 'b1c3'], -120);
  const knights = line(2, ['c6d4', 'd1d4'], -135);
  const pawns = line(3, ['d5e4', 'f3e4'], -130);
  const c = chooseDrawfishMove(g.pos, g.keys, [quiet, knights], 'relentless', 'a7a6');
  expect('behind: no piece trade for its own sake', c.uci, 'a7a6');
  const d = chooseDrawfishMove(g.pos, g.keys, [quiet, knights, pawns], 'relentless', 'a7a6');
  expect('behind: pawn trade still welcome', d.uci, 'd5e4');
  const o = chooseDrawfishMove(g.pos, g.keys, [quiet, knights], 'relentless', 'a7a6', 'original');
  expect('behind, original defence: still likes the piece trade', o.uci, 'c6d4');
}

console.log(failures ? `\n${failures} failure(s)` : '\nall drawfish checks passed');
process.exitCode = failures ? 1 : 0;
