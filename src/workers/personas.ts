// Persona layer: how each opponent configures its engine, plans a search and
// picks the final move from the engine's output. One Elo setting (800-3000)
// drives all three personas.

import type { Chess } from 'chessops/chess';
import type { EngineSettings, MoveNote, PersonaId, PlayStyle } from '../shared/protocol';
import { materialBalance, parseLegalUci } from '../shared/chess';
import { chooseDrawfishMove, type RootLine } from './drawfish';
import type { EngineLike } from './uci-engine';
import { scoreValue } from './uci';

export type EngineKind = 'patricia' | 'stockfish';

export interface EngineContext {
  threaded: boolean;
  maxThreads: number;
  /** The persona's own last evaluation in this game (its point of view, centipawns). */
  lastValue?: number;
  /** Material balance at the search root for the side to move (pawns). */
  materialEdge?: number;
}

export interface SearchPlan {
  go: string;
  ponderGo: string;
  /** The engine pauses itself at the ponder caps (Patricia); else the host governs. */
  inEnginePonderCaps: boolean;
  /** Minimum time before the move is shown (natural pacing). */
  minThinkMs: number;
  /** MultiPV lines the persona needs internally. */
  lines: number;
  /** Search budget, used for the host's "engine went silent" deadline. */
  moveTimeMs: number;
}

export interface ChooseContext {
  root: Chess;
  history: readonly string[]; // repetition keys, index = ply, includes root
  lines: readonly RootLine[]; // latest exact line per multipv, sorted
  engineBest: string;
  settings: EngineSettings;
}

export interface Choice {
  uci: string;
  note: MoveNote;
}

export interface Persona {
  id: PersonaId;
  kind: EngineKind;
  configure(engine: EngineLike, s: EngineSettings, ctx: EngineContext): void;
  plan(s: EngineSettings): SearchPlan;
  choose(ctx: ChooseContext): Choice;
}

/** Instamove budget: well inside the 50 ms promise, including host overhead. */
export const INSTAMOVE_MS = 30;

/**
 * Ponder depth cap: the user's thermal cap, and with Instamove (when
 * `eloDepth`) also the Elo depth limit, so a ponder hit never plays stronger
 * than Instamove would.
 */
export function ponderDepthCap(s: EngineSettings, eloDepth = true): number {
  const thermal = s.ponder.maxDepth > 0 ? s.ponder.maxDepth : 0;
  const elo = s.instamove && eloDepth ? instamoveDepth(s.elo) : 0;
  if (thermal && elo) return Math.min(thermal, elo);
  return thermal || elo;
}

function ponderCaps(s: EngineSettings, eloDepth = true): string {
  let caps = '';
  const depth = ponderDepthCap(s, eloDepth);
  if (depth > 0) caps += ` ponderdepth ${depth}`;
  if (s.ponder.maxKNodes > 0) caps += ` pondernodes ${s.ponder.maxKNodes * 1000}`;
  return caps;
}

function pacing(s: EngineSettings, base: number, spread: number): number {
  return s.humanPacing && !s.instamove ? Math.round(base + Math.random() * spread) : 0;
}

const STYLE_OPTION: Record<PlayStyle, string> = {
  classic: 'Classic',
  aggressive: 'Aggressive',
  positional: 'Positional',
  solid: 'Solid',
};

/** Instamove depth cap per Elo: depth 1-2 at club level, time-limited at the top. */
export function instamoveDepth(elo: number): number {
  if (elo < 1100) return 1;
  if (elo < 1500) return 2;
  if (elo < 1900) return 3;
  if (elo < 2300) return 4;
  if (elo < 2700) return 6;
  return 0; // only the time limit
}

function instamoveGo(elo: number): string {
  const depth = instamoveDepth(elo);
  return `go${depth ? ` depth ${depth}` : ''} movetime ${INSTAMOVE_MS}`;
}

/**
 * Controlled blunder variance: below `ceiling` Elo the persona occasionally
 * plays a clearly inferior (never absurd) move from its MultiPV lines.
 */
function eloSlip(ctx: ChooseContext, elo: number, ceiling: number, maxChance: number): string | null {
  if (elo >= ceiling || ctx.lines.length < 2) return null;
  const strength = Math.min(1, (ceiling - elo) / (ceiling - 800));
  if (Math.random() >= maxChance * strength) return null;
  const best = scoreValue(ctx.lines[0].score);
  if (Math.abs(best) > 5000) return null; // never toss (or gift) a forced mate
  const maxLoss = 90 + 230 * strength;
  const options = ctx.lines.filter((l) => {
    const loss = best - scoreValue(l.score);
    return loss >= 40 && loss <= maxLoss && l.pv.length > 0;
  });
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)].pv[0];
}

// ------------------------------------------------------------------ Patricia
//
// Patricia weakens herself. Below 3000 her own human mode (UCI_Elo) searches
// five lines at full depth, then plays a worse one within a running mistake
// budget of 120 - Elo/25 centipawns per move - the calibration her Lichess
// bot littlePatricia runs. The budget only means what it says when the search
// is deep enough to measure the losses, so the host never cuts her depth or
// think time and adds no slips of its own.

/** Did the chosen line give up material (>= 2 pawns) while keeping a good eval? */
function isSacrifice(ctx: ChooseContext, uci: string): boolean {
  const line = ctx.lines.find((l) => l.pv[0] === uci);
  if (!line || line.pv.length < 3 || scoreValue(line.score) < -30) return false;
  const sign = ctx.root.turn === 'white' ? 1 : -1;
  const before = materialBalance(ctx.root) * sign;
  const p = ctx.root.clone();
  for (const mv of line.pv.slice(0, 3)) {
    const move = parseLegalUci(p, mv);
    if (!move) return false;
    p.play(move);
  }
  return materialBalance(p) * sign - before <= -2;
}

const patricia: Persona = {
  id: 'patricia',
  kind: 'patricia',
  configure(engine, s, ctx) {
    engine.setOption('Hash', s.hashMb);
    if (ctx.threaded) engine.setOption('Threads', Math.min(s.threads, ctx.maxThreads));
    engine.setOption('MultiPV', 1);
    engine.setOption('Move_Overhead', 10);
    engine.setOption('Style', STYLE_OPTION[s.patriciaStyle]);
    engine.setOption('UCI_LimitStrength', s.elo < 3000);
    engine.setOption('UCI_Elo', Math.min(3000, Math.max(500, s.elo)));
  },
  plan(s) {
    if (s.instamove) {
      // Time limit only: an Elo depth cap would make her budget misjudge losses.
      return {
        go: `go movetime ${INSTAMOVE_MS}`,
        ponderGo: `go ponder${ponderCaps(s, false)}`,
        inEnginePonderCaps: true,
        minThinkMs: 0,
        lines: s.elo < 3000 ? 5 : 1,
        moveTimeMs: INSTAMOVE_MS,
      };
    }
    return {
      go: `go movetime ${s.thinkMs}`,
      ponderGo: `go ponder movetime ${s.thinkMs}${ponderCaps(s, false)}`,
      inEnginePonderCaps: true,
      minThinkMs: pacing(s, 450, 750),
      lines: s.elo < 3000 ? 5 : 1,
      moveTimeMs: s.thinkMs,
    };
  },
  choose(ctx) {
    // Strength comes from Patricia's own human mode (see above).
    const note: MoveNote = isSacrifice(ctx, ctx.engineBest) ? 'sacrifice' : ctx.settings.instamove ? 'instant' : 'engine';
    return { uci: ctx.engineBest, note };
  },
};

// ----------------------------------------------------------------- Stockfish

/** Stockfish's UCI_Elo bottoms out at 1320; below that, depth caps and slips. */
function stockfishDepthCap(elo: number): number {
  if (elo < 1000) return 2;
  if (elo < 1320) return 4;
  return 0;
}

const stockfish: Persona = {
  id: 'stockfish',
  kind: 'stockfish',
  configure(engine, s, ctx) {
    engine.setOption('Hash', s.hashMb);
    if (ctx.threaded) engine.setOption('Threads', Math.min(s.threads, ctx.maxThreads));
    const slips = s.elo < 1320;
    engine.setOption('MultiPV', slips ? 4 : Math.max(1, Math.min(3, s.analysisLines)));
    engine.setOption('Ponder', true);
    const limited = s.elo < 3000;
    engine.setOption('UCI_LimitStrength', limited);
    if (limited) engine.setOption('UCI_Elo', Math.max(1320, Math.min(3190, s.elo)));
  },
  plan(s) {
    const lines = s.elo < 1320 ? 4 : Math.max(1, Math.min(3, s.analysisLines));
    if (s.instamove) {
      return {
        go: instamoveGo(s.elo),
        ponderGo: 'go ponder',
        inEnginePonderCaps: false,
        minThinkMs: 0,
        lines,
        moveTimeMs: INSTAMOVE_MS,
      };
    }
    const cap = stockfishDepthCap(s.elo);
    return {
      go: `go movetime ${s.thinkMs}${cap ? ` depth ${cap}` : ''}`,
      ponderGo: `go ponder movetime ${s.thinkMs}`,
      inEnginePonderCaps: false,
      minThinkMs: 0,
      lines,
      moveTimeMs: s.thinkMs,
    };
  },
  choose(ctx) {
    const slip = eloSlip(ctx, ctx.settings.elo, 1320, 0.25);
    if (slip && parseLegalUci(ctx.root, slip)) return { uci: slip, note: 'humanSlip' };
    return { uci: ctx.engineBest, note: ctx.settings.instamove ? 'instant' : 'engine' };
  },
};

// ------------------------------------------------------------------ DrawFish

const DRAWFISH_LINES = 6;
/**
 * Clearly winning, the top 6 moves all keep the win, so DrawFish couldn't give
 * it back (or avoid mating). Then she weighs many more moves, at less depth.
 */
const DRAWFISH_WIDE_LINES = 24;
const DRAWFISH_WIDEN_AT = 250; // her last evaluation, centipawns
const DRAWFISH_WIDEN_MATERIAL = 3; // or this many pawns up on the board

export function drawfishLines(ctx: EngineContext): number {
  const winning = (ctx.lastValue ?? 0) >= DRAWFISH_WIDEN_AT || (ctx.materialEdge ?? 0) >= DRAWFISH_WIDEN_MATERIAL;
  return winning ? DRAWFISH_WIDE_LINES : DRAWFISH_LINES;
}

/** Weaker DrawFish = shallower evaluations; the draw logic itself stays on. */
function drawfishDepthCap(elo: number): number {
  if (elo >= 2700) return 0;
  if (elo < 1200) return 4;
  if (elo < 1600) return 6;
  if (elo < 2000) return 9;
  if (elo < 2400) return 13;
  return 17;
}

const drawfish: Persona = {
  id: 'drawfish',
  kind: 'stockfish',
  configure(engine, s, ctx) {
    engine.setOption('Hash', s.hashMb);
    if (ctx.threaded) engine.setOption('Threads', Math.min(s.threads, ctx.maxThreads));
    engine.setOption('MultiPV', drawfishLines(ctx));
    engine.setOption('Ponder', true);
    engine.setOption('UCI_LimitStrength', false);
  },
  plan(s) {
    // Max defence: always full depth, whatever the Elo setting. Original: the
    // Elo setting caps her depth, so a worse position can slip away.
    const max = s.drawfishDefense === 'max';
    if (s.instamove) {
      return {
        go: max ? `go movetime ${INSTAMOVE_MS}` : instamoveGo(s.elo),
        ponderGo: 'go ponder',
        inEnginePonderCaps: false,
        minThinkMs: 0,
        lines: DRAWFISH_LINES,
        moveTimeMs: INSTAMOVE_MS,
      };
    }
    const cap = max ? 0 : drawfishDepthCap(s.elo);
    return {
      go: `go movetime ${s.thinkMs}${cap ? ` depth ${cap}` : ''}`,
      ponderGo: `go ponder movetime ${s.thinkMs}`,
      inEnginePonderCaps: false,
      minThinkMs: pacing(s, 300, 500),
      lines: DRAWFISH_LINES,
      moveTimeMs: s.thinkMs,
    };
  },
  choose(ctx) {
    const s = ctx.settings;
    const choice = chooseDrawfishMove(ctx.root, ctx.history, ctx.lines, s.drawfishMode, ctx.engineBest, s.drawfishDefense);
    return { uci: choice.uci, note: choice.note };
  },
};

export const PERSONAS: Record<PersonaId, Persona> = { patricia, stockfish, drawfish };

/** Full-strength Stockfish for hints and the Move button. */
export const HINT_MOVETIME = 650;
/** Suggestion arrows: a short MultiPV 3 search at the start of the user's turn. */
export const SUGGEST_MOVETIME = 550;
export const SUGGEST_LINES = 3;

/** Full-strength Stockfish for hints (1 line) and suggestion arrows (3 lines). */
export function configureHint(engine: EngineLike, s: EngineSettings, ctx: EngineContext, lines = 1): void {
  engine.setOption('Hash', s.hashMb);
  if (ctx.threaded) engine.setOption('Threads', Math.min(s.threads, ctx.maxThreads));
  engine.setOption('MultiPV', lines);
  engine.setOption('UCI_LimitStrength', false);
}
