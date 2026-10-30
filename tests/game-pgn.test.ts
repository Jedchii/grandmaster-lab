// Game store rules (orientation per layout, undo/redo, branching, archive) and PGN output.
//   node scripts/run-ts.mjs tests/game-pgn.test.ts

import { archive, archiveCurrentGame, buildPgn } from '../src/state/archive';
import { game } from '../src/state/game';
import { updateUi } from '../src/state/settings';
import { flipped, orientation } from '../src/state/view';

let failures = 0;
function eq<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// SmallFish (BPHH): the engine sits at the bottom, the human on top.
updateUi({ layout: 'smallfish' });
game.newGame('white');
eq('smallfish: human White -> orientation black (White pieces on top)', orientation.value, 'black');
game.newGame('black');
eq('smallfish: human Black -> orientation white (Black pieces on top)', orientation.value, 'white');
flipped.value = true;
eq('smallfish ignores the classic flip', orientation.value, 'white');
flipped.value = false;

// Classic: your colour at the bottom; Flip turns the board.
updateUi({ layout: 'classic' });
game.newGame('white');
eq('classic: human White at the bottom', orientation.value, 'white');
flipped.value = true;
eq('classic: flipped', orientation.value, 'black');
flipped.value = false;
game.newGame('black');
eq('classic: human Black at the bottom', orientation.value, 'black');

// Undo always lands on the human's turn.
game.newGame('white');
const play = (uci: string, byEngine: boolean) =>
  byEngine ? game.playEngine(uci, 'engine', game.moves.value.join(' ')) : game.play(uci);
play('e2e4', false);
play('e7e5', true);
play('g1f3', false);
eq('engine to move after Nf3', game.turn.value, 'black');
game.undo();
eq('undo while engine to move: 1 ply', game.cursor.value, 2);
play('g1f3', false);
play('b8c6', true);
eq('human to move at ply 4', game.cursor.value, 4);
game.undo();
eq('undo on human turn: 2 plies', game.cursor.value, 2);
game.undo();
eq('second undo: back to start', game.cursor.value, 0);
eq('undo at start refused', game.undo(), false);
game.redo();
eq('redo replays human move + stored engine reply', game.cursor.value, 2);
game.redo();
eq('redo to the end', game.cursor.value, 4);
eq('redo at end refused', game.redo(), false);
game.undo();
play('f1c4', false);
eq('move after undo branches (future dropped)', game.line.value.map((p) => p.san), ['e4', 'e5', 'Bc4']);
eq('engine move for a stale line is refused', game.playEngine('b8c6', 'engine', 'e2e4 e7e5 g1f3'), null);
eq('engine move for the live line is accepted', !!game.playEngine('g8f6', 'engine', 'e2e4 e7e5 f1c4'), true);

// Human Black: the engine's opening move cannot be undone past the first human turn.
game.newGame('black');
game.playEngine('d2d4', 'book', '');
eq('human Black: undo past engine opening refused', game.undo(), false);

// Switching sides keeps the human on top.
game.newGame('white');
game.switchSides();
updateUi({ layout: 'smallfish' });
eq('after Flip the human plays Black', game.userSide.value, 'black');
eq('SmallFish: the board turned, human still on top (orientation white)', orientation.value, 'white');
updateUi({ layout: 'classic' });

// PGN: anonymous headers, correct numbering, SetUp/FEN for custom starts.
const pgn = buildPgn({
  startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  sans: ['e4', 'e5', 'Nf3'],
  result: '*',
  startFullmove: 1,
  startTurn: 'white',
});
eq(
  'anonymous PGN headers',
  pgn.split('\n').slice(0, 7),
  ['[Event "?"]', '[Site "?"]', '[Date "????.??.??"]', '[Round "?"]', '[White "?"]', '[Black "?"]', '[Result "*"]'],
);
eq('movetext', pgn.trim().split('\n').pop(), '1. e4 e5 2. Nf3 *');
const custom = buildPgn({
  startFen: '8/8/8/8/8/5k2/8/4K2R b K - 3 40',
  sans: ['Kg3', 'O-O'],
  result: '1/2-1/2',
  startFullmove: 40,
  startTurn: 'black',
});
eq('custom start adds SetUp + FEN', custom.includes('[SetUp "1"]') && custom.includes('[FEN "8/8/8/8/8/5k2/8/4K2R b K - 3 40"]'), true);
eq('black-to-move numbering', custom.trim().split('\n').pop(), '40... Kg3 41. O-O 1/2-1/2');

// Undo / redo step modes: exactly 1 or 2 plies.
game.newGame('white');
play('e2e4', false);
play('e7e5', true);
play('g1f3', false);
play('b8c6', true);
eq('one: undo 1 ply (engine turn)', [game.undo('one'), game.cursor.value], [true, 3]);
eq('one: engine to move, reviewing', [game.turn.value, game.atEnd.value], ['black', false]);
eq('one: redo 1 ply', [game.redo('one'), game.cursor.value], [true, 4]);
eq('two: undo 2 plies', [game.undo('two'), game.cursor.value], [true, 2]);
eq('two: redo 2 plies', [game.redo('two'), game.cursor.value], [true, 4]);
game.jumpTo(1);
eq('two: undo clamps at the start', [game.undo('two'), game.cursor.value], [true, 0]);
eq('one: undo at the start refused', game.undo('one'), false);
game.jumpTo(3);
eq('two: redo clamps at the end', [game.redo('two'), game.cursor.value], [true, 4]);
eq('one: redo at the end refused', game.redo('one'), false);

// Undo right after resigning only takes the resignation back.
game.newGame('white');
play('e2e4', false);
play('e7e5', true);
game.resign();
eq('resigned', game.result.value?.reason, 'resign');
eq('undo after resign succeeds', game.undo(), true);
eq('undo after resign: same position', game.cursor.value, 2);
eq('undo after resign: game goes on', game.result.value, null);
eq('undo after resign: your move', game.userTurn.value, true);

// Archiving the same game twice keeps one entry; an empty game is skipped.
const before = archive.value.length;
archiveCurrentGame('patricia', 1800);
archiveCurrentGame('patricia', 1800);
eq('same game archived twice: one entry', archive.value.length, before + 1);
play('g1f3', false);
archiveCurrentGame('patricia', 1800);
eq('the same live game saved again updates its entry', archive.value.length, before + 1);
eq('the entry holds the newer moves', archive.value[0].plies, 3);
game.newGame('white');
play('d2d4', false);
archiveCurrentGame('patricia', 1800);
eq('a different game is a new entry', archive.value.length, before + 2);
game.newGame('white');
eq('empty game not archived', archiveCurrentGame('patricia', 1800), null);

console.log(failures ? `\n${failures} failure(s)` : '\nall game/PGN checks passed');
process.exitCode = failures ? 1 : 0;
