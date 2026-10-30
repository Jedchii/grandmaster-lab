// Game record on the UI thread. Rules checks here are microsecond-cheap and
// synchronous on purpose: a move is validated and shown in the same frame the
// finger lifts, with no worker round trip.
//
// Model: `line` is the move tree's active branch (including moves you can
// redo) and `cursor` is the active ply. The engine is synced to the history up
// to the cursor; it only plays when the cursor is at the end of the line.
//
// Board orientation depends on the layout and lives in ./view.ts.

import { batch, computed, signal } from '@preact/signals';
import type { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { INITIAL_FEN, parseLegalUci, positionFromFen, repetitionKey, toStandardUci } from '../shared/chess';
import { lineKey, type MoveNote, type Side } from '../shared/protocol';

/** 'smart': back / forward to the human's turn; 'one' / 'two': exactly 1 or 2 moves (plies). */
export type StepMode = 'smart' | 'one' | 'two';

export interface PlyRecord {
  uci: string;
  san: string;
  fen: string;
  key: string;
  by: Side;
  capture: boolean;
  check: boolean;
  note?: MoveNote;
}

export type ResultReason = 'checkmate' | 'stalemate' | 'threefold' | 'fifty' | 'insufficient' | 'resign';

export interface GameResult {
  winner: Side | null;
  reason: ResultReason;
}

export interface SavedGame {
  v: 1;
  gameId: number;
  startFen: string;
  userSide: Side;
  moves: Array<{ uci: string; note?: MoveNote }>;
  cursor: number;
  resigned: { ply: number; winner: Side } | null;
}

export const opposite = (s: Side): Side => (s === 'white' ? 'black' : 'white');

export function resultToken(result: GameResult | null): '1-0' | '0-1' | '1/2-1/2' | '*' {
  if (!result) return '*';
  if (result.winner === null) return '1/2-1/2';
  return result.winner === 'white' ? '1-0' : '0-1';
}

class GameStore {
  readonly gameId = signal(1);
  readonly startFen = signal(INITIAL_FEN);
  readonly userSide = signal<Side>('white');
  readonly line = signal<PlyRecord[]>([]);
  readonly cursor = signal(0);
  readonly resigned = signal<{ ply: number; winner: Side } | null>(null);

  readonly engineSide = computed(() => opposite(this.userSide.value));
  readonly length = computed(() => this.line.value.length);
  readonly atEnd = computed(() => this.cursor.value === this.line.value.length);
  /** Active history (UCI) up to the cursor - what the engine is synced to. */
  readonly moves = computed(() => this.line.value.slice(0, this.cursor.value).map((p) => p.uci));
  readonly turn = computed<Side>(() => this.turnAt(this.cursor.value));
  readonly result = computed<GameResult | null>(() => this.resultAt(this.cursor.value));
  readonly userTurn = computed(() => this.turn.value === this.userSide.value && !this.result.value);
  /** Full-move number and side to move of the start position (for notation). */
  readonly start = computed(() => {
    const setup = parseFen(this.startFen.value).unwrap();
    return { fullmove: setup.fullmoves, turn: setup.turn as Side };
  });

  private startKey = repetitionKey(positionFromFen(INITIAL_FEN));

  fenAt(ply: number): string {
    return ply <= 0 ? this.startFen.value : this.line.value[ply - 1].fen;
  }

  positionAt(ply: number): Chess {
    return positionFromFen(this.fenAt(ply));
  }

  turnAt(ply: number): Side {
    const startTurn = this.start.value.turn;
    return ply % 2 === 0 ? startTurn : opposite(startTurn);
  }

  /** Move number label for the ply that is played from position `ply`. */
  moveNumberAt(ply: number): number {
    const { fullmove, turn } = this.start.value;
    return fullmove + Math.floor((ply + (turn === 'black' ? 1 : 0)) / 2);
  }

  resultAt(ply: number): GameResult | null {
    const resigned = this.resigned.value;
    if (resigned && resigned.ply === ply) return { winner: resigned.winner, reason: 'resign' };
    const pos = this.positionAt(ply);
    if (pos.isCheckmate()) return { winner: opposite(pos.turn), reason: 'checkmate' };
    if (pos.isStalemate()) return { winner: null, reason: 'stalemate' };
    if (pos.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' };
    const line = this.line.value;
    const key = ply === 0 ? this.startKey : line[ply - 1].key;
    let count = this.startKey === key ? 1 : 0;
    for (let i = 0; i < ply; i++) if (line[i].key === key) count++;
    if (count >= 3) return { winner: null, reason: 'threefold' };
    if (pos.halfmoves >= 100) return { winner: null, reason: 'fifty' };
    return null;
  }

  newGame(userSide: Side, startFen = INITIAL_FEN): void {
    batch(() => {
      this.gameId.value++;
      this.startFen.value = startFen;
      this.startKey = repetitionKey(positionFromFen(startFen));
      this.userSide.value = userSide;
      this.line.value = [];
      this.cursor.value = 0;
      this.resigned.value = null;
    });
  }

  private record(pos: Chess, uci: string, note?: MoveNote): PlyRecord | null {
    const move = parseLegalUci(pos, uci);
    if (!move) return null;
    const by = pos.turn;
    const target = pos.board.get(move.to);
    const capture =
      (target !== undefined && target.color !== by) ||
      (pos.board.get(move.from)?.role === 'pawn' && pos.epSquare === move.to);
    const standard = toStandardUci(pos, move);
    const san = makeSanAndPlay(pos, move);
    return {
      uci: standard,
      san,
      fen: makeFen(pos.toSetup()),
      key: repetitionKey(pos),
      by,
      capture,
      check: pos.isCheck(),
      note,
    };
  }

  /**
   * The human's move at the cursor. Playing anywhere but the end of the line
   * starts a new branch (the redo moves are discarded), so the engine always
   * answers a fresh position.
   */
  play(uci: string): PlyRecord | null {
    if (!this.userTurn.value) return null;
    const ply = this.cursor.value;
    const rec = this.record(this.positionAt(ply), uci);
    if (!rec) return null;
    batch(() => {
      this.line.value = [...this.line.value.slice(0, ply), rec];
      this.cursor.value = ply + 1;
      this.resigned.value = null;
    });
    return rec;
  }

  /** Engine move: only accepted for exactly the line it was computed for. */
  playEngine(uci: string, note: MoveNote | undefined, expectedLine: string): PlyRecord | null {
    if (!this.atEnd.value || this.result.value) return null;
    if (this.turn.value !== this.engineSide.value) return null;
    if (lineKey(this.moves.value) !== expectedLine) return null;
    const ply = this.cursor.value;
    const rec = this.record(this.positionAt(ply), uci, note);
    if (!rec) return null;
    batch(() => {
      this.line.value = [...this.line.value, rec];
      this.cursor.value = ply + 1;
    });
    return rec;
  }

  /**
   * Undo. 'smart' (default): back to the human's previous turn (1 ply if the
   * engine is to move, else 2); 'one' / 'two': exactly that many plies, which
   * may stop on the engine's turn (the engine then waits, as when reviewing).
   * Right after a resignation it just takes the resignation back.
   */
  undo(mode: StepMode = 'smart'): boolean {
    const resigned = this.resigned.value;
    if (resigned && resigned.ply === this.cursor.value) {
      this.resigned.value = null;
      return true;
    }
    if (mode !== 'smart') {
      if (this.cursor.value === 0) return false;
      this.cursor.value = Math.max(0, this.cursor.value - (mode === 'one' ? 1 : 2));
      return true;
    }
    let target = this.cursor.value - 1;
    while (target >= 0 && this.turnAt(target) !== this.userSide.value) target--;
    if (target < 0) return false;
    this.cursor.value = target;
    return true;
  }

  /** Redo along the stored line ('smart' also replays the engine's stored reply). */
  redo(mode: StepMode = 'smart'): boolean {
    const len = this.line.value.length;
    let target = this.cursor.value;
    if (target >= len) return false;
    if (mode !== 'smart') {
      this.cursor.value = Math.min(len, target + (mode === 'one' ? 1 : 2));
      return true;
    }
    target++;
    if (target < len && this.turnAt(target) !== this.userSide.value) target++;
    this.cursor.value = target;
    return true;
  }

  jumpTo(ply: number): void {
    this.cursor.value = Math.max(0, Math.min(this.line.value.length, ply));
  }

  /** Drop the redo moves so play continues from the cursor. */
  truncateFuture(): void {
    if (this.atEnd.value) return;
    this.line.value = this.line.value.slice(0, this.cursor.value);
  }

  /** Swap colours mid-game (SmallFish "Flip": the human stays on top, so the board turns). */
  switchSides(): void {
    batch(() => {
      this.userSide.value = opposite(this.userSide.value);
      this.resigned.value = null;
    });
  }

  resign(): void {
    if (this.result.value) return;
    batch(() => {
      this.truncateFuture();
      this.resigned.value = { ply: this.cursor.value, winner: this.engineSide.value };
    });
  }

  snapshot(): SavedGame {
    return {
      v: 1,
      gameId: this.gameId.value,
      startFen: this.startFen.value,
      userSide: this.userSide.value,
      moves: this.line.value.map((p) => ({ uci: p.uci, note: p.note })),
      cursor: this.cursor.value,
      resigned: this.resigned.value,
    };
  }

  /** Restores a saved / archived game; stops at the first illegal move. */
  load(saved: Omit<SavedGame, 'v'>): void {
    let pos: Chess;
    try {
      pos = positionFromFen(saved.startFen);
    } catch {
      return;
    }
    const line: PlyRecord[] = [];
    for (const m of saved.moves) {
      const rec = this.record(pos, m.uci, m.note);
      if (!rec) break;
      line.push(rec);
    }
    batch(() => {
      this.gameId.value = Math.max(this.gameId.value + 1, saved.gameId);
      this.startFen.value = saved.startFen;
      this.startKey = repetitionKey(positionFromFen(saved.startFen));
      this.userSide.value = saved.userSide;
      this.line.value = line;
      this.cursor.value = Math.max(0, Math.min(line.length, saved.cursor));
      this.resigned.value = saved.resigned && saved.resigned.ply <= line.length ? saved.resigned : null;
    });
  }
}

export const game = new GameStore();
