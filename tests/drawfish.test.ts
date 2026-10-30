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

console.log(failures ? `\n${failures} failure(s)` : '\nall drawfish checks passed');
process.exitCode = failures ? 1 : 0;
