// Engine-host state machine tests: the real EngineHost + the real game store
// against a scripted fake UCI engine. Covers the post-undo deadlock, undo
// during a search, ponderhit/miss, Move/Hint, suggestion arrows, instamove latency, and a long
// randomised stress run with liveness and safety invariants.
//   node scripts/run-ts.mjs tests/host-sync.test.ts

import fs from 'node:fs';
import path from 'node:path';
import { effect, signal } from '@preact/signals';
import type { Chess } from 'chessops/chess';
import { makeSquare } from 'chessops/util';
import { INITIAL_FEN, parseLegalUci, positionFromFen, toStandardUci } from '../src/shared/chess';
import { DEFAULT_SETTINGS, lineKey, type EngineSettings, type HostEvent } from '../src/shared/protocol';
import { game } from '../src/state/game';
import { EngineHost } from '../src/workers/host';
import type { EngineLike, SearchHandle } from '../src/workers/uci-engine';
import type { UciBestMove, UciInfo } from '../src/workers/uci';

// ------------------------------------------------------------ environment
const g = globalThis as unknown as Record<string, unknown>;
g.self = globalThis;
g.location = { origin: 'http://test.local' };
g.crossOriginIsolated = false;
g.fetch = async (url: string) => {
  const file = path.join('public', new URL(url).pathname);
  if (!fs.existsSync(file)) return new Response('missing', { status: 404 });
  const data = fs.readFileSync(file);
  return new Response(data, { headers: { 'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
};

let seed = 0x5eed;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
Math.random = rand;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(ok: boolean, label: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}

// ------------------------------------------------------------ fake engine
function legalMoves(pos: Chess): string[] {
  const out: string[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const m = parseLegalUci(pos, makeSquare(from) + makeSquare(to));
      if (m) out.push(toStandardUci(pos, m));
    }
  }
  return [...new Set(out)].sort();
}

function parsePosition(cmd: string): Chess {
  const t = cmd.split(' ');
  let i = 2;
  let pos: Chess;
  if (t[1] === 'startpos') pos = positionFromFen(INITIAL_FEN);
  else {
    pos = positionFromFen(t.slice(2, 8).join(' '));
    i = 8;
  }
  if (t[i] === 'moves') {
    for (const uci of t.slice(i + 1)) {
      const m = parseLegalUci(pos, uci);
      if (!m) throw new Error(`illegal move ${uci} in "${cmd}"`);
      pos.play(m);
    }
  }
  return pos;
}

const engineLog = { newGames: 0, searches: 0, concurrentGo: 0, illegal: 0, resyncs: 0, ponders: 0, ponderhits: 0, stops: 0 };

class FakeEngine implements EngineLike {
  readonly name = 'FakeFish';
  onDeath: ((reason: string) => void) | null = null;
  private current: { resolve: (b: UciBestMove) => void; best: string | null; ponder: boolean; timer?: ReturnType<typeof setTimeout> } | null = null;
  constructor(readonly url: string) {}

  send(cmd: string): void {
    if (cmd.startsWith('position')) {
      engineLog.resyncs++;
      try {
        parsePosition(cmd);
      } catch {
        engineLog.illegal++;
      }
    }
  }
  async ready(): Promise<void> {}
  setOption(): void {}
  async newGame(): Promise<void> {
    engineLog.newGames++;
    await sleep(60); // Stockfish's ucinewgame + isready costs ~60 ms in WASM
  }

  search(position: string, go: string, onInfo: (info: UciInfo) => void): SearchHandle {
    if (this.current) {
      engineLog.concurrentGo++;
      throw new Error('search already running');
    }
    engineLog.searches++;
    let pos: Chess;
    try {
      pos = parsePosition(position);
    } catch {
      engineLog.illegal++;
      pos = positionFromFen(INITIAL_FEN);
    }
    const moves = legalMoves(pos);
    const best = moves.length ? moves[Math.floor(rand() * moves.length)] : null;
    let reply: string | undefined;
    if (best) {
      const p2 = pos.clone();
      p2.play(parseLegalUci(p2, best)!);
      reply = legalMoves(p2)[0];
    }
    const ponder = / ponder\b/.test(go);
    if (ponder) engineLog.ponders++;
    const done = new Promise<UciBestMove>((resolve) => {
      this.current = { resolve, best, ponder };
    });
    if (best) {
      setTimeout(() => {
        onInfo({ multipv: 1, depth: 10, seldepth: 14, score: { cp: Math.round(rand() * 60 - 30) }, nodes: 5000, nps: 1e6, time: 3, pv: reply ? [best, reply] : [best] });
      }, 1);
    }
    const movetime = Number((go.match(/movetime (\d+)/) || [])[1] || 0);
    if (!ponder) this.finishIn(Math.min(movetime || 20, 25), reply);
    else (this.current as { reply?: string }).reply = reply;
    return { done };
  }

  private finishIn(ms: number, reply?: string): void {
    const c = this.current;
    if (!c) return;
    clearTimeout(c.timer);
    c.timer = setTimeout(() => {
      if (this.current !== c) return;
      this.current = null;
      c.resolve({ move: c.best, ponder: reply });
    }, ms);
  }

  ponderhit(): void {
    engineLog.ponderhits++;
    if (this.current?.ponder) {
      this.current.ponder = false;
      this.finishIn(15, (this.current as { reply?: string }).reply);
    }
  }

  stop(): Promise<UciBestMove | null> {
    engineLog.stops++;
    const c = this.current;
    if (!c) return Promise.resolve(null);
    return new Promise((resolve) => {
      clearTimeout(c.timer);
      setTimeout(() => {
        if (this.current === c) this.current = null;
        const b = { move: c.best };
        c.resolve(b);
        resolve(b);
      }, 2);
    });
  }

  terminate(): void {}
}

// ------------------------------------------------------------- mini UI
const events: HostEvent[] = [];
let applied = 0;
let rejectedCurrent = 0;
let lastBestAt = 0;
const host = new EngineHost(
  (e) => {
    events.push(e);
    if (e.type === 'bestmove') {
      const current = lineKey(game.moves.value);
      const rec = game.playEngine(e.move.uci, e.move.note, e.move.line);
      if (rec) {
        applied++;
        lastBestAt = performance.now();
      } else if (e.move.line === current && game.atEnd.value && !game.result.value) {
        rejectedCurrent++; // host answered the live position but the UI refused: a bug
      }
    }
    if (e.type === 'hint' && e.hint.autoplay && e.hint.line === lineKey(game.moves.value)) game.play(e.hint.uci);
  },
  async (url) => new FakeEngine(url),
);

let settings: EngineSettings = { ...DEFAULT_SETTINGS, humanPacing: false, thinkMs: 20 };
host.handle({ type: 'init', baseUrl: '/', isolated: false, cores: 4, settings });
const suggestOn = signal(false);
effect(() => {
  host.handle({
    type: 'sync',
    sync: {
      gameId: game.gameId.value,
      startFen: game.startFen.value,
      moves: game.moves.value,
      engineSide: game.engineSide.value,
      paused: !game.atEnd.value || game.result.value !== null,
      suggest: suggestOn.value,
    },
  });
});
const setSettings = (patch: Partial<EngineSettings>) => {
  settings = { ...settings, ...patch };
  host.handle({ type: 'settings', settings });
};

const engineToMove = () => game.atEnd.value && !game.result.value && game.turn.value === game.engineSide.value;
async function waitEngine(ms = 2000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (!engineToMove()) return true;
    await sleep(2);
  }
  return false;
}
const userPlayAny = () => {
  const moves = legalMoves(game.positionAt(game.cursor.value));
  return moves.length ? game.play(moves[Math.floor(rand() * moves.length)]) : null;
};

// ------------------------------------------------------- scenarios
game.newGame('white');
await sleep(50); // books load

// 1. The reported deadlock: move, engine replies, undo, different move, engine must reply.
game.play('e2e4');
check(await waitEngine(), 'engine answers 1.e4 (book)');
game.play('g1f3');
check(await waitEngine(), 'engine answers 2.Nf3');
const lineBefore = lineKey(game.moves.value);
check(game.undo(), 'undo back to the human turn');
check(game.cursor.value === 2 && game.turn.value === 'white', `undo rewound 2 plies (cursor ${game.cursor.value})`);
game.play('d2d4');
check(lineKey(game.moves.value) !== lineBefore, 'played a different move after undo');
check(await waitEngine(), 'engine answers after undo + new move (no deadlock)');

// 2. Same ply, different position: the old ply-keyed guard deadlocked here.
for (let i = 0; i < 6; i++) {
  game.undo();
  userPlayAny();
  check(await waitEngine(), `undo/replay cycle ${i + 1}: engine answers`);
}

// 3. Undo while the engine is thinking (no book: out of theory, slow search).
setSettings({ book: { ...settings.book, enabled: false }, thinkMs: 400 });
game.play(legalMoves(game.positionAt(game.cursor.value))[0]);
await sleep(30);
check(engineToMove(), 'engine is thinking');
const stopsBefore = engineLog.stops;
game.undo();
await sleep(20);
check(engineLog.stops > stopsBefore, 'undo sent stop to the active search');
check(engineLog.resyncs > 0, 'engine resynced with the active history after the rewind');
const appliedBefore = applied;
await sleep(450);
check(applied === appliedBefore, 'aborted search never plays a stale move');
userPlayAny();
check(await waitEngine(1500), 'engine answers after undo during search');
setSettings({ thinkMs: 20 });

// 4. Undo then Move button: engine to move at a position it answered before.
game.undo(); // human's turn
game.undo(); // further back
const target = game.cursor.value + 1;
game.redo(); // replays human move + stored engine reply
game.jumpTo(target); // engine's turn, with redo moves stored -> paused
check(!game.atEnd.value && game.turn.value === game.engineSide.value, 'reviewing: engine to move, paused');
await sleep(60);
check(game.cursor.value === target, 'engine does not move while reviewing');
game.truncateFuture(); // what the Move button does
check(await waitEngine(), 'Move button: engine answers a previously answered position');

// 5. Ponder hit / miss.
setSettings({ thinkMs: 20, ponder: { enabled: true, maxDepth: 0, maxKNodes: 0 } });
userPlayAny();
await waitEngine();
await sleep(20);
const ponderEvent = [...events].reverse().find((e) => e.type === 'ponder');
check(!!ponderEvent && engineLog.ponders > 0, 'engine ponders on the predicted reply');
const pred = (host as unknown as { prediction: { uci: string } | null }).prediction?.uci;
const hitsBefore = engineLog.ponderhits;
if (pred) game.play(pred);
check(await waitEngine(), 'ponder hit: engine answers');
check(engineLog.ponderhits > hitsBefore, 'ponderhit was sent');
await sleep(20);
const others = legalMoves(game.positionAt(game.cursor.value));
const predNow = (host as unknown as { prediction: { uci: string } | null }).prediction?.uci;
game.play(others.find((m) => m !== predNow) ?? others[0]);
check(await waitEngine(), 'ponder miss: engine answers');

// 6. Hint + autoplay (Move on the human's turn).
await sleep(20);
const hintsBefore = events.filter((e) => e.type === 'hint').length;
host.handle({ type: 'hint', gameId: game.gameId.value, line: lineKey(game.moves.value), autoplay: false });
await sleep(800);
check(events.filter((e) => e.type === 'hint').length > hintsBefore, 'hint returned for the human');
const cur = game.cursor.value;
host.handle({ type: 'hint', gameId: game.gameId.value, line: lineKey(game.moves.value), autoplay: true });
await sleep(800);
check(game.cursor.value > cur, 'Move on your turn played a move for you');
check(await waitEngine(), 'engine answers the auto-played move');

// 7. Move now while thinking.
setSettings({ thinkMs: 3000 });
userPlayAny();
await sleep(20);
const t0 = performance.now();
host.handle({ type: 'moveNow' });
check(await waitEngine(500), `move now: engine moved in ${Math.round(performance.now() - t0)} ms`);
setSettings({ thinkMs: 20 });

// 8. Instamove latency (host overhead + 30 ms search budget capped by the fake at 25 ms).
setSettings({ instamove: true, ponder: { ...settings.ponder, enabled: false } });
await sleep(20);
const lat: number[] = [];
for (let i = 0; i < 10 && !game.result.value; i++) {
  if (!userPlayAny()) break;
  const s0 = performance.now();
  if (!(await waitEngine())) break;
  lat.push(lastBestAt - s0);
}
const worst = Math.max(...lat);
check(lat.length > 0 && worst < 50, `instamove replies < 50 ms (worst ${worst.toFixed(1)} ms over ${lat.length})`);
setSettings({ instamove: false });

// 8a. Ponder during Instamove: a ponder hit still answers instantly.
setSettings({
  instamove: true,
  ponderInstamove: true,
  elo: 3000,
  book: { ...settings.book, enabled: false },
  ponder: { enabled: true, maxDepth: 0, maxKNodes: 0 },
});
userPlayAny();
await waitEngine();
await sleep(30);
const pondersBefore8a = engineLog.ponders;
const pred8a = (host as unknown as { prediction: { uci: string } | null }).prediction?.uci;
check(!!pred8a, 'instamove + ponder: the engine has a predicted reply');
await sleep(20);
check(engineLog.ponders >= pondersBefore8a && engineLog.ponders > 0, 'instamove + ponder: pondering on your time');
const hits8a = engineLog.ponderhits;
const t8a = performance.now();
if (pred8a) game.play(pred8a);
await waitEngine();
const hitMs = lastBestAt - t8a;
check(engineLog.ponderhits > hits8a && hitMs < 50, `instamove ponder hit answers in ${hitMs.toFixed(1)} ms`);
setSettings({ ponderInstamove: false });
await sleep(20);
userPlayAny();
await waitEngine();
const pondersNow = engineLog.ponders;
await sleep(60);
check(engineLog.ponders === pondersNow, 'instamove without the option: no pondering');
setSettings({ instamove: false, elo: DEFAULT_SETTINGS.elo, book: { ...settings.book, enabled: true } });

// 8b. First move of a new game is instant too: ucinewgame runs in the
//     background as soon as the new game is synced.
for (const persona of ['stockfish', 'patricia'] as const) {
  setSettings({ persona, instamove: true, book: { ...settings.book, enabled: false }, ponder: { ...settings.ponder, enabled: false } });
  await sleep(100);
  game.newGame('white');
  await sleep(150); // the human looks at the board for a moment
  userPlayAny();
  const f0 = performance.now();
  await waitEngine();
  const first = lastBestAt - f0;
  check(first < 50, `instamove first move of a new game (${persona}): ${first.toFixed(1)} ms`);
}
setSettings({ instamove: false, persona: 'patricia', book: { ...settings.book, enabled: true } });

// 9. Switch sides and new game alternation keep working.
game.switchSides();
check(await waitEngine() , 'after switching sides the engine moves if it is its turn');
game.newGame(game.userSide.value === 'white' ? 'black' : 'white');
check(await waitEngine(), 'new game as Black: engine (White) opens');

// 9b. Suggestion arrows: one MultiPV analysis of the user's turn, then the
//     game goes on (ponder / engine reply), including a move mid-analysis.
setSettings({ ponder: { ...settings.ponder, enabled: true } });
await waitEngine();
const suggestInfos = () =>
  events.filter((e) => e.type === 'info' && e.info.mode === 'suggest' && e.info.line === lineKey(game.moves.value)).length;
suggestOn.value = true;
await sleep(120);
check(suggestInfos() > 0, 'suggestions: the user turn was analysed');
const settled = suggestInfos();
await sleep(150);
check(suggestInfos() === settled, 'suggestions: one analysis per position (not repeated)');
userPlayAny();
check(await waitEngine(), 'suggestions on: engine answers');
await sleep(3); // the next analysis is running now
userPlayAny();
check(await waitEngine(), 'move during the suggestion analysis: engine answers');
await sleep(120);
check(suggestInfos() > 0, 'suggestions: the new user turn was analysed');
suggestOn.value = false;

// 10. Randomised stress: user moves, undo (incl. mid-search), redo, jumps,
//     Move, hints, persona / instamove / ponder / suggestion toggles, new games.
let stalls = 0;
let steps = 0;
const tStress = performance.now();
for (; steps < 1500; steps++) {
  if (game.result.value) {
    game.newGame(rand() < 0.5 ? 'white' : 'black');
    continue;
  }
  const r = rand();
  if (r < 0.06) setSettings({ persona: (['patricia', 'stockfish', 'drawfish'] as const)[Math.floor(rand() * 3)] });
  else if (r < 0.09) setSettings({ instamove: !settings.instamove });
  else if (r < 0.11) setSettings({ ponder: { ...settings.ponder, enabled: !settings.ponder.enabled } });
  else if (r < 0.13) setSettings({ book: { ...settings.book, enabled: !settings.book.enabled } });
  else if (r < 0.15) suggestOn.value = !suggestOn.value;
  else if (r < 0.17) setSettings({ ponderInstamove: !settings.ponderInstamove });

  const a = rand();
  if (engineToMove()) {
    if (a < 0.25) game.undo(); // undo while the engine thinks
    else if (a < 0.3) host.handle({ type: 'moveNow' });
    else if (!(await waitEngine(2000))) {
      stalls++;
      console.log('STALL at', lineKey(game.moves.value), 'state', events.filter((e) => e.type === 'state').slice(-3));
      game.truncateFuture();
    }
  } else if (game.atEnd.value && game.turn.value === game.userSide.value) {
    if (a < 0.6) userPlayAny();
    else if (a < 0.75) game.undo();
    else if (a < 0.82) game.redo();
    else if (a < 0.86) game.jumpTo(Math.floor(rand() * (game.length.value + 1)));
    else if (a < 0.9) host.handle({ type: 'hint', gameId: game.gameId.value, line: lineKey(game.moves.value), autoplay: rand() < 0.5 });
    else if (a < 0.93) game.switchSides();
    else userPlayAny();
  } else {
    // reviewing (redo moves exist)
    if (a < 0.35) game.redo();
    else if (a < 0.6) game.truncateFuture();
    else if (a < 0.8 && game.turn.value === game.userSide.value) userPlayAny();
    else game.jumpTo(game.length.value);
  }
  await sleep(rand() < 0.3 ? 0 : Math.floor(rand() * 15));
}
// Final liveness: whatever state we ended in, the engine must answer.
if (!game.atEnd.value) game.jumpTo(game.length.value);
if (game.turn.value === game.userSide.value && !game.result.value) userPlayAny();
const finalOk = await waitEngine(2000);
check(stalls === 0 && finalOk, `stress: ${steps} actions in ${Math.round(performance.now() - tStress)} ms, ${stalls} stalls`);
check(engineLog.concurrentGo === 0, `engine never got overlapping searches (${engineLog.searches} searches)`);
check(engineLog.illegal === 0, 'engine never received an illegal position');
check(rejectedCurrent === 0, `UI never refused a move for the live line (${applied} engine moves applied)`);

console.log(failures ? `\n${failures} failure(s)` : '\nall host sync checks passed');
process.exit(failures ? 1 : 0);
