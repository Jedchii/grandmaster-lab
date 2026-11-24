// DrawFish - the Trollfish persona.
//
// Trollfish (a Stockfish fork) applies one rule inside its search: "if
// winning, prefer the smallest positive evaluation; if losing, play the best
// move". DrawFish applies that rule at the root over Stockfish's MultiPV lines
// and adds explicit draw hunting on top:
//   * claims threefold repetition / 50-move draws the moment they appear,
//   * steers into perpetual checks (PV repeats while we keep checking),
//   * prefers even trades (simplification) and dead opposite-coloured bishop
//     endings, and lines that end in stalemate,
//   * never drops below a safety floor, so it doesn't simply lose,
//   * when every line is a forced mate, plays the slowest one, never mates
//     when it can avoid it,
//   * when every line keeps a big plus anyway, avoids pawn moves and captures
//     so the 50-move rule can end the game.

import type { Chess } from 'chessops/chess';
import type { DrawfishDefense, DrawfishMode, MoveNote } from '../shared/protocol';
import { parseLegalUci, repetitionKey, totalMaterial, materialBalance } from '../shared/chess';
import { scoreValue, type UciScore } from './uci';

export interface RootLine {
  multipv: number;
  depth: number;
  score: UciScore; // side to move at the root
  pv: string[];
}

interface Candidate {
  uci: string;
  value: number;
  instantDraw: boolean;
  stalemateNow: boolean;
  repCount: number;
  givesCheck: boolean;
  pvRepeats: boolean;
  pvStalemate: boolean;
  perpetual: boolean;
  removed: number; // material traded off in the first plies (pawns)
  pawnsRemoved: number; // of which pawns
  balanceShift: number; // our material change over those plies
  oppositeBishops: boolean;
  resetsClock: boolean; // capture or pawn move: restarts the 50-move count
}

/** Every candidate at least this good (centipawns): giving the win back failed. */
const HOPELESS_WIN = 300;

export interface DrawfishChoice {
  uci: string;
  note: MoveNote;
  value: number;
}

function onlyOppositeBishops(pos: Chess): boolean {
  const b = pos.board;
  if (b.knight.nonEmpty() || b.rook.nonEmpty() || b.queen.nonEmpty()) return false;
  const wb = b.bishop.intersect(b.white);
  const bb = b.bishop.intersect(b.black);
  if (wb.size() !== 1 || bb.size() !== 1) return false;
  const sqColor = (sq: number) => ((sq >> 3) + (sq & 7)) & 1;
  return sqColor(wb.first()!) !== sqColor(bb.first()!);
}

function analyse(root: Chess, history: readonly string[], line: RootLine): Candidate | null {
  const us = root.turn;
  const sign = us === 'white' ? 1 : -1;
  const p = root.clone();
  const first = parseLegalUci(p, line.pv[0]);
  if (!first) return null;

  const materialBefore = totalMaterial(root);
  const pawnsBefore = root.board.pawn.size();
  const balanceBefore = materialBalance(root) * sign;
  p.play(first);

  const keyAfter = repetitionKey(p);
  const seen = new Map<string, number>();
  for (const k of history) seen.set(k, (seen.get(k) ?? 0) + 1);
  const repCount = seen.get(keyAfter) ?? 0;
  seen.set(keyAfter, repCount + 1);

  const stalemateNow = p.isStalemate();
  const instantDraw = repCount >= 2 || p.halfmoves >= 100 || stalemateNow || p.isInsufficientMaterial();
  const givesCheck = p.isCheck();
  const resetsClock = p.halfmoves === 0;

  let pvRepeats = repCount > 0;
  let pvStalemate = stalemateNow;
  let ourMoves = 1;
  let ourChecks = givesCheck ? 1 : 0;
  let materialAfter = totalMaterial(p);
  let pawnsAfter = p.board.pawn.size();
  let balanceAfter = materialBalance(p) * sign;

  for (let i = 1; i < line.pv.length && i < 24; i++) {
    const mv = parseLegalUci(p, line.pv[i]);
    if (!mv) break;
    p.play(mv);
    const key = repetitionKey(p);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count >= 2) pvRepeats = true;
    if (i % 2 === 0) {
      ourMoves++;
      if (p.isCheck()) ourChecks++;
    }
    if (i <= 4) {
      materialAfter = totalMaterial(p);
      pawnsAfter = p.board.pawn.size();
      balanceAfter = materialBalance(p) * sign;
    }
    if (p.isStalemate()) pvStalemate = true;
  }

  return {
    uci: line.pv[0],
    value: scoreValue(line.score),
    instantDraw,
    stalemateNow,
    repCount,
    givesCheck,
    pvRepeats,
    pvStalemate,
    perpetual: pvRepeats && ourMoves >= 2 && ourChecks >= ourMoves - 1,
    removed: Math.max(0, materialBefore - materialAfter),
    pawnsRemoved: Math.max(0, pawnsBefore - pawnsAfter),
    balanceShift: balanceAfter - balanceBefore,
    oppositeBishops: onlyOppositeBishops(p),
    resetsClock,
  };
}

function drawishBonus(c: Candidate, behind = false): number {
  let bonus = 0;
  if (c.pvRepeats) bonus += 60;
  if (c.repCount === 1) bonus += 35;
  if (c.pvStalemate) bonus += 50;
  if (c.oppositeBishops) bonus += 70;
  // Even trades simplify towards a draw - except when behind, where trading
  // pieces makes the opponent's win easier. Then only pawn trades count.
  const traded = behind ? c.pawnsRemoved : c.removed;
  if (traded > 0 && Math.abs(c.balanceShift) <= 1) bonus += Math.min(90, traded * 8);
  if (c.givesCheck && Math.abs(c.value) <= 25) bonus += 15;
  return bonus;
}

function noteFor(c: Candidate, best: Candidate): MoveNote {
  if (c.perpetual) return 'perpetual';
  if (c.instantDraw || c.pvRepeats || c.repCount > 0) return 'repetition';
  if (c.oppositeBishops || c.pvStalemate) return 'fortress';
  if (c.removed >= 3 && Math.abs(c.balanceShift) <= 1) return 'simplify';
  return c.uci === best.uci ? 'engine' : 'troll';
}

export function chooseDrawfishMove(
  root: Chess,
  history: readonly string[],
  lines: readonly RootLine[],
  mode: DrawfishMode,
  fallback: string,
  defense: DrawfishDefense = 'max',
): DrawfishChoice {
  const cands = lines
    .filter((l) => l.pv.length > 0)
    .map((l) => analyse(root, history, l))
    .filter((c): c is Candidate => c !== null);
  if (!cands.length) return { uci: fallback, note: 'engine', value: 0 };

  const relentless = mode === 'relentless';
  const best = cands.reduce((a, b) => (b.value > a.value ? b : a));
  const pick = (c: Candidate): DrawfishChoice => ({ uci: c.uci, note: noteFor(c, best), value: c.value });

  // 1. Take an immediate draw (repetition, 50-move, stalemate) - at all costs.
  const instant = cands.filter((c) => c.instantDraw);
  if (instant.length && (relentless || best.value < 250)) {
    return pick(instant.reduce((a, b) => (b.value > a.value ? b : a)));
  }

  // 2. Perpetual check.
  const perpetual = cands.filter((c) => c.perpetual && c.value > -80);
  if (perpetual.length && (relentless || best.value < 150)) {
    return pick(perpetual.reduce((a, b) => (b.value > a.value ? b : a)));
  }

  // 3. Losing: Trollfish "turns Stockfish back on", leaning to drawish lines.
  //    Max defence stays within a hair of the best move and doesn't count
  //    piece trades as drawish; the original allows 0.4 and likes any trade.
  if (best.value < -60) {
    const max = defense === 'max';
    const close = cands.filter((c) => c.value >= best.value - (max ? 25 : 40));
    const defence = (c: Candidate) => c.value + drawishBonus(c, max);
    return pick(close.reduce((a, b) => (defence(b) > defence(a) ? b : a)));
  }

  // 4. Equal or better: hover just above zero and steer towards dead draws.
  // The floor limits how much advantage one move may give back; it is anchored
  // to the best non-mating line, so (like Trollfish) a forced mate is declined.
  const nonMate = cands.filter((c) => Math.abs(c.value) < 90000);
  const ref = Math.min(1000, nonMate.length ? Math.max(...nonMate.map((c) => c.value)) : best.value);
  const floor = relentless ? Math.max(-45, ref - 350) : Math.max(-15, ref - 80);
  const target = relentless ? 0 : 20;
  const viable = nonMate.filter((c) => c.value >= floor);
  if (!viable.length) {
    // Every line is a forced mate for us. Like Trollfish, take the slowest one
    // (never the quickest), and among equally slow ones a move that keeps the
    // 50-move count running, so the game can still end in a draw.
    const mates = cands.filter((c) => c.value >= 90000);
    if (!mates.length) return pick(best);
    const slowness = (c: Candidate) => -c.value - (c.resetsClock ? 5 : 0);
    return pick(mates.reduce((a, b) => (slowness(b) > slowness(a) ? b : a)));
  }
  const utility = (c: Candidate) => -Math.abs(c.value - target) + drawishBonus(c);
  // Hopelessly winning - even the most generous move keeps a big plus: stop
  // pushing pawns and capturing, so the 50-move rule can still end it level.
  const hopeless = Math.min(...viable.map((c) => c.value)) >= HOPELESS_WIN;
  const quiet = viable.filter((c) => !c.resetsClock);
  const pool = hopeless && quiet.length ? quiet : viable;
  return pick(pool.reduce((a, b) => (utility(b) > utility(a) ? b : a)));
}
