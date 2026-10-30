// Engine host: owns the engines, opening books and persona logic.
//
// The UI sends a GameSync after every change; the host reconciles the desired
// activity (idle / think for a move / ponder on the predicted reply / hint /
// suggest - a short MultiPV 3 analysis of the user's turn for the arrows)
// with what is running and transitions with the cheapest UCI command:
//   predicted reply played  -> `ponderhit` (search continues, warm)
//   anything else changed   -> `stop`, then start the new search
// Book moves are answered synchronously before any engine is touched.
//
// Every piece of state that refers to a position (answered, prediction,
// capped ponder, hint request, pending move) is keyed by the exact position
// id - game, engine side and the full move line - never by ply count. After a
// takeback the same ply can hold a different position, and a ply-keyed guard
// is exactly what used to leave the engine idle after "undo, then move".

import type { Chess } from 'chessops/chess';
import {
  BOOK_FILE,
  DEFAULT_SETTINGS,
  lineKey,
  type BestMove,
  type EngineSettings,
  type EngineState,
  type GameSync,
  type HostEvent,
  type HostRequest,
  type PersonaId,
  type PvLine,
  type SearchMode,
} from '../shared/protocol';
import {
  INITIAL_FEN,
  parseLegalUci,
  positionFromFen,
  repetitionKey,
  toStandardUci,
  uciLineToSan,
} from '../shared/chess';
import { makeSanAndPlay } from 'chessops/san';
import { EcoIndex } from './book/eco';
import { PolyglotBook, bookMoves, keyToHex, pickBookMove, polyglotKey } from './book/polyglot';
import type { RootLine } from './drawfish';
import {
  HINT_MOVETIME,
  PERSONAS,
  SUGGEST_LINES,
  SUGGEST_MOVETIME,
  configureHint,
  ponderDepthCap,
  type EngineKind,
  type SearchPlan,
} from './personas';
import { negateScore, scoreValue, type UciBestMove, type UciInfo, type UciScore } from './uci';
import { UciEngine, type EngineBooter, type EngineLike, type SearchHandle } from './uci-engine';

type Emit = (event: HostEvent) => void;

interface GameView {
  sync: GameSync;
  /** Position id of the active position. */
  id: string;
  pos: Chess;
  keys: string[]; // repetition keys by ply
  polyKeys: string[]; // polyglot hex keys by ply
  over: boolean;
}

type Desired =
  | { kind: 'idle'; reason: string }
  | { kind: 'move'; id: string; gameId: number; ply: number; moves: string[] }
  | { kind: 'ponder'; id: string; gameId: number; ply: number; moves: string[]; predicted: string }
  | { kind: 'hint'; id: string; gameId: number; ply: number; moves: string[]; autoplay: boolean }
  | { kind: 'suggest'; id: string; gameId: number; ply: number; moves: string[] };

type Work = Exclude<Desired, { kind: 'idle' }>;

interface DisplayLine {
  depth: number;
  score: UciScore;
  bound?: 'lower' | 'upper';
  pv: string[];
}

interface ActiveSearch {
  mode: SearchMode;
  /** Position id of the searched root. */
  id: string;
  gameId: number;
  ply: number;
  moves: string[];
  root: Chess;
  rootKeys: string[];
  personaId: PersonaId | 'hint';
  epoch: number;
  plan: SearchPlan;
  engine: EngineLike;
  handle: SearchHandle | null;
  startedAt: number;
  stopping: boolean;
  forceNow: boolean;
  autoplay: boolean;
  capped: boolean;
  lines: Map<number, RootLine>;
  display: Map<number, DisplayLine>;
  deadline: ReturnType<typeof setTimeout> | null;
  depth: number;
  seldepth: number;
  nodes: number;
  nps: number;
  time: number;
  blunderSignalled: boolean;
}

interface EngineSlot {
  promise: Promise<EngineLike>;
  engine: EngineLike | null;
  threaded: boolean;
  gameId: number;
  /** Background `ucinewgame` started when a new game was synced. */
  preparing: { gameId: number; done: Promise<void> } | null;
  name: string;
  loadMs: number;
}


const HINT_PLAN: SearchPlan = {
  go: `go movetime ${HINT_MOVETIME}`,
  ponderGo: '',
  inEnginePonderCaps: false,
  minThinkMs: 0,
  lines: 1,
  moveTimeMs: HINT_MOVETIME,
};

const SUGGEST_PLAN: SearchPlan = {
  go: `go movetime ${SUGGEST_MOVETIME}`,
  ponderGo: '',
  inEnginePonderCaps: false,
  minThinkMs: 0,
  lines: SUGGEST_LINES,
  moveTimeMs: SUGGEST_MOVETIME,
};

/** Hints and suggestions run on full-strength Stockfish, not the persona. */
const isAnalysis = (kind: SearchMode | Work['kind']): kind is 'hint' | 'suggest' => kind === 'hint' || kind === 'suggest';

export function positionCommand(startFen: string, moves: readonly string[]): string {
  const base = startFen === INITIAL_FEN ? 'position startpos' : `position fen ${startFen}`;
  return moves.length ? `${base} moves ${moves.join(' ')}` : base;
}

export class EngineHost {
  private settings: EngineSettings = DEFAULT_SETTINGS;
  private epoch = 0;
  private baseUrl = '/';
  private canThread = false;
  private maxThreads = 1;
  private initialised = false;

  private readonly engines = new Map<EngineKind, EngineSlot>();
  private readonly bootedKinds = new Set<EngineKind>();
  private announced: string | null = null;
  /** "The Grandmaster Files" (one merged book; empty until loaded). */
  private books: PolyglotBook[] = [];
  private eco: EcoIndex | null = null;
  private assets: Promise<void> | null = null;

  private view: GameView | null = null;
  private hidden = false;
  private active: ActiveSearch | null = null;
  /** Position id the engine already produced a move for. */
  private answered: string | null = null;
  /** Predicted user move in the position (id) where the user is to move. */
  private prediction: { userId: string; uci: string } | null = null;
  /** Ponder root the governor already capped - don't restart it. */
  private cappedPonder: string | null = null;
  private hintRequest: { id: string; autoplay: boolean } | null = null;
  /** Position id whose suggestion arrows are complete. */
  private suggested: string | null = null;
  private lastEval: { gameId: number; moves: string[]; value: number } | null = null;
  /** Set when the game rewound (undo / branch / jump): resync the engine. */
  private rewound = false;
  private bookStreak = false;
  private flags = { gameId: -1, winning: false, losing: false };
  private lastOpening = '';
  private state: EngineState | null = null;
  private stateDetail = '';

  /** A chosen move waiting out its human-pacing delay. */
  private pending: { move: BestMove; id: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private dirty = false;
  private looping = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly emit: Emit,
    private readonly bootEngine: EngineBooter = UciEngine.boot,
  ) {}

  handle(msg: HostRequest): void {
    switch (msg.type) {
      case 'init':
        this.init(msg.baseUrl, msg.isolated, msg.cores, msg.settings);
        break;
      case 'settings':
        this.applySettings(msg.settings);
        break;
      case 'sync':
        this.onSync(msg.sync);
        break;
      case 'visibility':
        this.hidden = msg.hidden;
        this.requestReconcile();
        break;
      case 'hint':
        this.onHint(msg.gameId, msg.line, msg.autoplay);
        break;
      case 'moveNow':
        this.moveNow();
        break;
    }
  }

  // ------------------------------------------------------------ lifecycle

  private init(baseUrl: string, isolated: boolean, cores: number, settings: EngineSettings): void {
    this.baseUrl = new URL(baseUrl, self.location.origin).href;
    this.canThread = isolated && self.crossOriginIsolated === true && wasmThreadsSupported();
    this.maxThreads = this.canThread ? Math.max(1, Math.min(3, cores - 1)) : 1;
    this.settings = settings;
    this.initialised = true;
    this.assets = this.loadAssets();
    this.setState('loading', 'Waking up…');
    void this.getEngine(PERSONAS[settings.persona].kind).catch(() => {});
    this.requestReconcile();
  }

  private async loadAssets(): Promise<void> {
    const fetchBook = async () => {
      const res = await fetch(`${this.baseUrl}books/${BOOK_FILE}`);
      if (!res.ok) throw new Error(`book: HTTP ${res.status}`);
      this.books = [new PolyglotBook(BOOK_FILE, await res.arrayBuffer())];
    };
    const fetchEco = async () => {
      const res = await fetch(`${this.baseUrl}books/eco.json`);
      if (!res.ok) throw new Error(`eco.json: HTTP ${res.status}`);
      this.eco = new EcoIndex(await res.json());
    };
    const results = await Promise.allSettled([fetchBook(), fetchEco()]);
    for (const r of results) {
      if (r.status === 'rejected') this.emit({ type: 'error', message: String(r.reason) });
    }
    this.emitOpening();
  }

  private applySettings(settings: EngineSettings): void {
    const prev = this.settings;
    this.settings = settings;
    this.epoch++;
    if (prev.persona !== settings.persona) {
      // Pre-warm the engine the new persona needs (hot swap).
      void this.getEngine(PERSONAS[settings.persona].kind).catch(() => {});
      this.lastEval = null;
    }
    this.requestReconcile();
  }

  private idFor(gameId: number, engineSide: string, moves: readonly string[]): string {
    return `${gameId}|${engineSide}|${lineKey(moves)}`;
  }

  private onSync(sync: GameSync): void {
    const prevView = this.view;
    // Fast path for the common case (a move or two appended to the line we
    // already hold): replay only the new moves instead of the whole game.
    const appended =
      !!prevView &&
      prevView.sync.gameId === sync.gameId &&
      prevView.sync.startFen === sync.startFen &&
      prevView.sync.moves.length <= sync.moves.length &&
      prevView.sync.moves.every((m, i) => sync.moves[i] === m);
    let pos: Chess;
    let keys: string[];
    let polyKeys: string[];
    let legalPlies: number;
    if (appended) {
      pos = prevView.pos.clone();
      keys = prevView.keys.slice();
      polyKeys = prevView.polyKeys.slice();
      legalPlies = prevView.sync.moves.length;
    } else {
      pos = positionFromFen(sync.startFen);
      keys = [repetitionKey(pos)];
      polyKeys = [keyToHex(polyglotKey(pos))];
      legalPlies = 0;
    }
    for (const uci of sync.moves.slice(legalPlies)) {
      const move = parseLegalUci(pos, uci);
      if (!move) break;
      pos.play(move);
      keys.push(repetitionKey(pos));
      polyKeys.push(keyToHex(polyglotKey(pos)));
      legalPlies++;
    }
    if (legalPlies !== sync.moves.length) {
      this.emit({ type: 'error', message: `illegal move in game record at ply ${legalPlies + 1}` });
      sync = { ...sync, moves: sync.moves.slice(0, legalPlies) };
    }
    const current = keys[keys.length - 1];
    const repeats = keys.filter((k) => k === current).length;
    const over = pos.isEnd() || pos.isInsufficientMaterial() || repeats >= 3 || pos.halfmoves >= 100;

    const prev = this.view?.sync;
    if (!prev || prev.gameId !== sync.gameId) {
      this.prediction = null;
      this.cappedPonder = null;
      this.answered = null;
      this.hintRequest = null;
      this.lastEval = null;
      this.bookStreak = false;
      this.flags = { gameId: sync.gameId, winning: false, losing: false };
      this.lastOpening = '';
    } else {
      const extends_ =
        prev.startFen === sync.startFen &&
        prev.engineSide === sync.engineSide &&
        prev.moves.length <= sync.moves.length &&
        prev.moves.every((m, i) => sync.moves[i] === m);
      if (!extends_) {
        // Undo / branch / jump / side switch: everything position-bound is
        // void, and the engine gets a clean resync after the stop.
        this.rewound = true;
        this.answered = null;
        this.lastEval = null;
        this.bookStreak = false;
      }
    }
    if (!prev || prev.gameId !== sync.gameId) this.prepareNewGame(sync.gameId);
    // Arrows switched (back) on: analyse the current position again.
    if (sync.suggest && !prev?.suggest) this.suggested = null;
    const id = this.idFor(sync.gameId, sync.engineSide, sync.moves);
    if (this.hintRequest && this.hintRequest.id !== id) this.hintRequest = null;
    if (this.pending && this.pending.id !== id) this.cancelPending();
    this.view = { sync, id, pos, keys, polyKeys, over };
    this.emitOpening();
    this.requestReconcile();
  }

  /**
   * Clear the idle engines' hash/history for a new game right away, so the
   * first move of the game doesn't pay for `ucinewgame` (matters for instamove).
   */
  private prepareNewGame(gameId: number): void {
    for (const [kind, slot] of this.engines) {
      const engine = slot.engine;
      if (!engine || !this.bootedKinds.has(kind) || slot.gameId === gameId) continue;
      if (this.active?.engine === engine) continue; // stopped first; startSearch handles it
      const done = engine.newGame().then(() => {
        if (slot.preparing?.done === done) slot.preparing = null;
        slot.gameId = gameId;
      });
      slot.preparing = { gameId, done };
    }
  }

  private onHint(gameId: number, line: string, autoplay: boolean): void {
    const v = this.view;
    if (!v || v.sync.gameId !== gameId || lineKey(v.sync.moves) !== line) return;
    this.hintRequest = { id: v.id, autoplay };
    this.requestReconcile();
  }

  private moveNow(): void {
    const a = this.active;
    if (a && a.mode === 'move' && !a.stopping) {
      a.forceNow = true;
      void a.engine.stop();
      return;
    }
    if (this.pending) {
      const { move, id, timer } = this.pending;
      clearTimeout(timer);
      this.pending = null;
      this.emitBest(move, id);
    }
  }

  private emitOpening(): void {
    const v = this.view;
    if (!v || !this.eco) return;
    const hit = this.eco.lookup(v.polyKeys);
    const inBook = this.books.length > 0 && bookMoves(this.books, v.pos).length > 0;
    const id = hit ? `${v.sync.gameId}:${hit.eco}:${hit.name}:${inBook}` : `${v.sync.gameId}:none`;
    if (id === this.lastOpening) return;
    this.lastOpening = id;
    this.emit({
      type: 'opening',
      gameId: v.sync.gameId,
      ply: v.sync.moves.length,
      eco: hit?.eco ?? '',
      name: hit?.name ?? '',
      inBook,
    });
  }

  // --------------------------------------------------------------- engines

  private engineUrl(kind: EngineKind, threaded: boolean): string {
    if (kind === 'patricia') return `${this.baseUrl}engines/patricia/patricia-${threaded ? 'mt' : 'st'}.js`;
    return `${this.baseUrl}engines/stockfish/stockfish-19-lite${threaded ? '' : '-single'}.js`;
  }

  private getEngine(kind: EngineKind): Promise<EngineLike> {
    const existing = this.engines.get(kind);
    if (existing) return existing.promise;
    const slot: EngineSlot = { promise: null!, engine: null, threaded: false, gameId: -1, preparing: null, name: '', loadMs: 0 };
    slot.promise = (async () => {
      const t0 = performance.now();
      let engine: EngineLike | null = null;
      if (this.canThread) {
        try {
          engine = await this.bootEngine(this.engineUrl(kind, true), 8000);
          slot.threaded = true;
        } catch (err) {
          this.emit({ type: 'error', message: `threaded ${kind} unavailable, using single-thread build (${err})` });
        }
      }
      if (!engine) engine = await this.bootEngine(this.engineUrl(kind, false), 20000);
      const booted = engine;
      booted.onDeath = (reason) => {
        this.bootedKinds.delete(kind);
        if (this.engines.get(kind) === slot) this.engines.delete(kind);
        if (this.active?.engine === booted) this.active = null;
        this.emit({ type: 'error', message: `${kind} engine stopped: ${reason}` });
        this.requestReconcile();
      };
      slot.engine = booted;
      // A freshly booted engine is already clean for the current game.
      slot.gameId = this.view?.sync.gameId ?? -1;
      slot.name = booted.name;
      slot.loadMs = Math.round(performance.now() - t0);
      this.bootedKinds.add(kind);
      this.requestReconcile();
      return booted;
    })();
    slot.promise.catch((err) => {
      if (this.engines.get(kind) === slot) this.engines.delete(kind);
      this.emit({ type: 'error', message: `could not start ${kind}: ${err}` });
      this.setState('error', 'Engine failed to load');
    });
    this.engines.set(kind, slot);
    return slot.promise;
  }

  // ------------------------------------------------------------- reconcile

  private requestReconcile(): void {
    this.dirty = true;
    if (!this.looping) void this.loop();
  }

  private async loop(): Promise<void> {
    this.looping = true;
    try {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.reconcile();
        } catch (err) {
          this.emit({ type: 'error', message: `host: ${err instanceof Error ? err.message : err}` });
        }
      }
    } finally {
      this.looping = false;
    }
  }

  private desired(): Desired {
    const v = this.view;
    if (!this.initialised || !v) return { kind: 'idle', reason: 'no game' };
    const { sync } = v;
    if (v.over) return { kind: 'idle', reason: 'game over' };
    const ply = sync.moves.length;
    const userToMove = v.pos.turn !== sync.engineSide;

    // Hints are allowed while reviewing; they never move for the engine.
    if (userToMove && this.hintRequest?.id === v.id) {
      return { kind: 'hint', id: v.id, gameId: sync.gameId, ply, moves: sync.moves, autoplay: this.hintRequest.autoplay };
    }
    if (sync.paused) return { kind: 'idle', reason: 'paused' };

    if (!userToMove) {
      if (this.answered === v.id) return { kind: 'idle', reason: 'answered' };
      return { kind: 'move', id: v.id, gameId: sync.gameId, ply, moves: sync.moves };
    }

    // Suggestion arrows first (one short search per position), then ponder.
    if (sync.suggest && !this.hidden && this.suggested !== v.id) {
      return { kind: 'suggest', id: v.id, gameId: sync.gameId, ply, moves: sync.moves };
    }

    const s = this.settings;
    if (!s.ponder.enabled || (s.instamove && !s.ponderInstamove) || this.hidden) return { kind: 'idle', reason: 'your move' };
    // Nothing worth pondering once a forced mate is on the board.
    if (this.lastEval?.gameId === sync.gameId && Math.abs(this.lastEval.value) >= 90000) {
      return { kind: 'idle', reason: 'your move' };
    }
    const p = this.prediction;
    if (!p || p.userId !== v.id || !parseLegalUci(v.pos, p.uci)) return { kind: 'idle', reason: 'your move' };
    const moves = [...sync.moves, p.uci];
    const id = this.idFor(sync.gameId, sync.engineSide, moves);
    if (this.cappedPonder === id) return { kind: 'idle', reason: 'pondered' };
    return { kind: 'ponder', id, gameId: sync.gameId, ply: ply + 1, moves, predicted: p.uci };
  }

  private personaKey(d: Work): PersonaId | 'hint' {
    return isAnalysis(d.kind) ? 'hint' : this.settings.persona;
  }

  private same(a: ActiveSearch, d: Desired): boolean {
    return (
      d.kind !== 'idle' &&
      a.mode === d.kind &&
      a.id === d.id &&
      a.epoch === this.epoch &&
      a.personaId === this.personaKey(d)
    );
  }

  /** Tells the UI which engine binary backs the current persona. */
  private announceEngine(): void {
    const persona = this.settings.persona;
    const kind = PERSONAS[persona].kind;
    const slot = this.engines.get(kind);
    if (!slot || !this.bootedKinds.has(kind)) return;
    const id = `${persona}:${slot.name}:${slot.threaded}`;
    if (id === this.announced) return;
    this.announced = id;
    this.emit({ type: 'engine', persona, name: slot.name, threaded: slot.threaded, loadMs: slot.loadMs });
  }

  private async reconcile(): Promise<void> {
    this.announceEngine();
    const d = this.desired();
    const a = this.active;
    if (a) {
      const hit =
        d.kind === 'move' &&
        a.mode === 'ponder' &&
        !a.stopping &&
        !a.capped &&
        a.id === d.id &&
        a.epoch === this.epoch &&
        a.personaId === this.settings.persona;
      if (hit) {
        // The user played the predicted move: keep the warm search running.
        a.mode = 'move';
        a.startedAt = performance.now();
        a.engine.ponderhit();
        if (this.settings.instamove) {
          // Instamove: answer at once with what the ponder search found.
          a.forceNow = true;
          void a.engine.stop();
        } else {
          this.armDeadline(a);
        }
        this.setState('thinking', 'Ponder hit');
        return;
      }
      if (this.same(a, d)) return;
      // Undo, branch, settings change or ponder miss: abort right away.
      await this.stopActive();
      if (this.dirty) return; // state moved on while stopping; re-evaluate
    }

    if (this.rewound) {
      this.rewound = false;
      await this.resyncEngine();
      if (this.dirty) return;
    }

    if (d.kind === 'idle') {
      if (d.reason === 'answered' && this.pending) return; // still "thinking" for the user
      const kind = PERSONAS[this.settings.persona].kind;
      if (this.bootedKinds.has(kind)) this.setState('idle', d.reason);
      else if (this.engines.has(kind)) this.setState('loading', 'Waking up');
      return;
    }

    if (d.kind === 'move') {
      if (this.assets) await this.assets;
      if (this.tryBookMove(d)) return;
    }
    await this.startSearch(d);
  }

  private async stopActive(): Promise<void> {
    const a = this.active;
    if (!a) return;
    a.stopping = true;
    await a.engine.stop();
    if (this.active === a) this.active = null;
  }

  /**
   * After a rewind: hand the engine the sanitized active history and make sure
   * it is responsive again (readyok within 2.5 s, else it is restarted).
   */
  private async resyncEngine(): Promise<void> {
    const v = this.view;
    if (!v) return;
    const slot = this.engines.get(PERSONAS[this.settings.persona].kind);
    const engine = slot?.engine;
    if (!engine || !this.bootedKinds.has(PERSONAS[this.settings.persona].kind)) return;
    engine.send(positionCommand(v.sync.startFen, v.sync.moves));
    await engine.ready(2500);
  }

  private stillDesired(d: Work): boolean {
    const now = this.desired();
    return now.kind === d.kind && now.id === d.id;
  }

  // ------------------------------------------------------------------ book

  private tryBookMove(d: Extract<Desired, { kind: 'move' }>): boolean {
    const { book } = this.settings;
    const v = this.view;
    if (!v || v.id !== d.id || !book.enabled || d.ply >= book.maxPly || !this.books.length) return false;
    const moves = bookMoves(this.books, v.pos);
    if (!moves.length) return false;
    const sharpness = this.settings.persona === 'stockfish' ? 2 : this.settings.persona === 'drawfish' ? 1.6 : 1.1;
    const pick = pickBookMove(moves, sharpness);
    if (!pick) return false;
    this.answered = d.id;
    this.prediction = null;
    this.bookStreak = true;
    const hit = this.eco?.lookup(v.polyKeys);
    this.setState('book', hit ? `${hit.eco} · ${hit.name}` : 'Opening book');
    this.emitBest(
      { gameId: d.gameId, line: lineKey(d.moves), ply: d.ply, uci: pick.uci, san: pick.san, note: 'book', thinkMs: 0 },
      d.id,
    );
    return true;
  }

  // ---------------------------------------------------------------- search

  private async startSearch(d: Work): Promise<void> {
    const analysis = isAnalysis(d.kind);
    const persona = PERSONAS[this.settings.persona];
    const kind: EngineKind = analysis ? 'stockfish' : persona.kind;
    let engine: EngineLike;
    try {
      engine = await this.getEngine(kind);
    } catch {
      return; // reported by getEngine
    }
    if (!this.stillDesired(d) || this.active) return;

    const slot = this.engines.get(kind)!;
    if (slot.gameId !== d.gameId) {
      if (slot.preparing?.gameId === d.gameId) await slot.preparing.done;
      else await engine.newGame();
      slot.gameId = d.gameId;
      if (!this.stillDesired(d) || this.active) return;
    }

    const ctx = { threaded: slot.threaded, maxThreads: this.maxThreads };
    if (analysis) configureHint(engine, this.settings, ctx, d.kind === 'suggest' ? SUGGEST_LINES : 1);
    else persona.configure(engine, this.settings, ctx);
    const plan = d.kind === 'suggest' ? SUGGEST_PLAN : d.kind === 'hint' ? HINT_PLAN : persona.plan(this.settings);

    const startFen = this.view!.sync.startFen;
    const root = positionFromFen(startFen);
    const rootKeys = [repetitionKey(root)];
    for (const uci of d.moves) {
      const move = parseLegalUci(root, uci);
      if (!move) return;
      root.play(move);
      rootKeys.push(repetitionKey(root));
    }

    const a: ActiveSearch = {
      mode: d.kind,
      id: d.id,
      gameId: d.gameId,
      ply: d.ply,
      moves: d.moves,
      root,
      rootKeys,
      personaId: this.personaKey(d),
      epoch: this.epoch,
      plan,
      engine,
      handle: null,
      startedAt: performance.now(),
      stopping: false,
      forceNow: false,
      autoplay: d.kind === 'hint' && d.autoplay,
      capped: false,
      lines: new Map(),
      display: new Map(),
      deadline: null,
      depth: 0,
      seldepth: 0,
      nodes: 0,
      nps: 0,
      time: 0,
      blunderSignalled: false,
    };
    const go = d.kind === 'ponder' ? plan.ponderGo : plan.go;
    this.active = a;
    a.handle = engine.search(positionCommand(startFen, d.moves), go, (info) => this.onInfo(a, info));
    void a.handle.done.then((best) => this.onSearchDone(a, best));
    if (d.kind !== 'ponder') this.armDeadline(a);
    if (d.kind === 'ponder') {
      this.setState('pondering', 'Pondering…');
      const san = uciLineToSan(this.view!.pos, [d.predicted], 1)[0] ?? null;
      this.emit({ type: 'ponder', gameId: d.gameId, ply: d.ply - 1, san });
    } else if (d.kind === 'suggest') {
      // Quiet background analysis: the UI keeps showing "Your move".
      this.setState('idle', 'Your move');
    } else {
      this.setState(analysis ? 'hint' : 'thinking', analysis ? (a.autoplay ? 'Finding a move…' : 'Finding a hint…') : 'Thinking…');
    }
  }

  private onInfo(a: ActiveSearch, info: UciInfo): void {
    if (!info.bound) {
      a.lines.set(info.multipv, { multipv: info.multipv, depth: info.depth, score: info.score!, pv: info.pv });
    }
    if (info.pv.length) {
      a.display.set(info.multipv, { depth: info.depth, score: info.score!, bound: info.bound, pv: info.pv });
    }
    if (info.multipv === 1) {
      a.depth = Math.max(a.depth, info.depth);
      a.seldepth = Math.max(a.seldepth, info.seldepth);
    }
    a.nodes = info.nodes || a.nodes;
    a.nps = info.nps || a.nps;
    a.time = info.time || a.time;

    // Thermal / battery governor for engines without in-engine ponder caps.
    // Depth 60 is a hard backstop even when the user disables the caps.
    if (a.mode === 'ponder' && !a.plan.inEnginePonderCaps && !a.stopping && !a.capped) {
      const { maxKNodes } = this.settings.ponder;
      const depthCap = ponderDepthCap(this.settings) || 60;
      if (info.depth >= depthCap || (maxKNodes > 0 && info.nodes >= maxKNodes * 1000)) {
        a.capped = true;
        this.cappedPonder = a.id;
        void a.engine.stop();
        this.setState('idle', `Pondered to depth ${info.depth}`);
      }
    }

    // "Blunder found!" - the user's last move swung the eval in our favour.
    // Only meaningful when the previous search was two plies up this line.
    const last = this.lastEval;
    if (
      a.mode === 'move' &&
      !a.blunderSignalled &&
      info.multipv === 1 &&
      !info.bound &&
      info.depth >= 8 &&
      last &&
      last.gameId === a.gameId &&
      a.moves.length === last.moves.length + 2 &&
      last.moves.every((m, i) => a.moves[i] === m)
    ) {
      const value = scoreValue(info.score);
      const swing = value - last.value;
      if (swing >= 150 && value >= 120) {
        a.blunderSignalled = true;
        this.emit({ type: 'signal', gameId: a.gameId, signal: { kind: 'blunderFound', swing } });
      }
    }

    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 100);
  }

  private flush(): void {
    this.flushTimer = null;
    const a = this.active;
    if (!a || a.stopping) return;
    const turnSign = a.root.turn === 'white' ? 1 : -1;
    const lines: PvLine[] = [...a.display.entries()]
      .sort((x, y) => x[0] - y[0])
      .slice(0, Math.max(3, this.settings.analysisLines))
      .map(([multipv, l]) => ({
        multipv,
        depth: l.depth,
        scoreWhite: turnSign === 1 ? l.score : negateScore(l.score),
        bound: l.bound,
        san: uciLineToSan(a.root, l.pv, 12),
        uci: l.pv.slice(0, 3),
      }));
    this.emit({
      type: 'info',
      info: {
        gameId: a.gameId,
        line: lineKey(a.moves),
        ply: a.ply,
        mode: a.mode,
        depth: a.depth,
        seldepth: a.seldepth,
        nodes: a.nodes,
        nps: a.nps,
        timeMs: a.time,
        lines,
      },
    });
  }

  /**
   * If a search overruns its budget by a wide margin, ask for the move;
   * EngineLike.stop() restarts the engine if it doesn't answer either.
   */
  private armDeadline(a: ActiveSearch): void {
    if (a.deadline) clearTimeout(a.deadline);
    a.deadline = setTimeout(() => {
      a.deadline = null;
      if (this.active === a && a.mode !== 'ponder' && !a.stopping) void a.engine.stop();
    }, a.plan.moveTimeMs + 3000);
  }

  private onSearchDone(a: ActiveSearch, best: UciBestMove): void {
    if (a.deadline) {
      clearTimeout(a.deadline);
      a.deadline = null;
    }
    if (this.active === a) {
      this.flush();
      this.active = null;
    }
    if (this.flushTimer && !this.active) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const v = this.view;
    const stale = !v || v.id !== a.id;
    if (a.mode === 'suggest') {
      // The final info flush above carried the finished lines to the UI.
      // Done for this position if it ran to the end, or an explicit hint cut
      // it short; otherwise (hidden, switched off, settings changed) it runs
      // again when it is wanted.
      if (!stale && (!a.stopping || this.hintRequest?.id === a.id)) this.suggested = a.id;
      this.requestReconcile();
      return;
    }
    if ((a.stopping && !a.forceNow) || a.mode === 'ponder' || !best.move || stale) {
      this.requestReconcile();
      return;
    }

    if (a.mode === 'hint') {
      const move = parseLegalUci(a.root, best.move);
      if (move) {
        const line = [...a.lines.values()].find((l) => l.multipv === 1);
        const turnSign = a.root.turn === 'white' ? 1 : -1;
        this.emit({
          type: 'hint',
          hint: {
            gameId: a.gameId,
            line: lineKey(a.moves),
            uci: toStandardUci(a.root, move),
            san: makeSanAndPlay(a.root.clone(), move),
            scoreWhite: line ? (turnSign === 1 ? line.score : negateScore(line.score)) : undefined,
            autoplay: a.autoplay,
          },
        });
      }
      this.hintRequest = null;
      this.setState('idle', 'Your move');
      this.requestReconcile();
      return;
    }

    const persona = PERSONAS[a.personaId as PersonaId];
    const lines = [...a.lines.values()].sort((x, y) => x.multipv - y.multipv);
    let choice = persona.choose({
      root: a.root,
      history: a.rootKeys,
      lines,
      engineBest: best.move,
      settings: this.settings,
    });
    let move = parseLegalUci(a.root, choice.uci);
    if (!move) {
      choice = { uci: best.move, note: 'engine' };
      move = parseLegalUci(a.root, best.move);
    }
    if (!move) {
      this.emit({ type: 'error', message: `engine returned an illegal move: ${best.move}` });
      this.requestReconcile();
      return;
    }
    const uci = toStandardUci(a.root, move);
    const san = makeSanAndPlay(a.root.clone(), move);
    const line = lines.find((l) => l.pv[0] === uci || l.pv[0] === choice.uci);
    const ponderMove = uci === best.move ? (best.ponder ?? line?.pv[1]) : line?.pv[1];
    const sync = v!.sync;
    this.prediction = ponderMove
      ? { userId: this.idFor(a.gameId, sync.engineSide, [...a.moves, uci]), uci: ponderMove }
      : null;
    this.cappedPonder = null;

    const score = line?.score;
    const value = scoreValue(score);
    this.lastEval = score ? { gameId: a.gameId, moves: a.moves, value } : null;
    this.answered = a.id;
    this.emitSignals(a, score, value);

    const turnSign = a.root.turn === 'white' ? 1 : -1;
    const elapsed = performance.now() - a.startedAt;
    const result: BestMove = {
      gameId: a.gameId,
      line: lineKey(a.moves),
      ply: a.ply,
      uci,
      san,
      note: choice.note,
      scoreWhite: score ? (turnSign === 1 ? score : negateScore(score)) : undefined,
      depth: a.depth,
      thinkMs: Math.round(elapsed),
    };
    const wait = a.forceNow ? 0 : Math.max(0, a.plan.minThinkMs - elapsed);
    if (wait > 0) {
      const timer = setTimeout(() => {
        if (this.pending?.move === result) this.pending = null;
        this.emitBest(result, a.id);
      }, wait);
      this.pending = { move: result, id: a.id, timer };
    } else {
      this.emitBest(result, a.id);
    }
    this.requestReconcile();
  }

  private cancelPending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending = null;
  }

  private emitSignals(a: ActiveSearch, score: UciScore | undefined, value: number): void {
    const gameId = a.gameId;
    if (this.bookStreak) {
      this.bookStreak = false;
      const hit = this.view && this.eco?.lookup(this.view.polyKeys);
      this.emit({ type: 'signal', gameId, signal: { kind: 'outOfBook', eco: hit?.eco, name: hit?.name } });
    }
    if (!score) return;
    if (score.mate !== undefined && score.mate > 0) {
      this.emit({ type: 'signal', gameId, signal: { kind: 'mateFound', mateIn: score.mate } });
    } else if (value >= 300 && !this.flags.winning) {
      this.flags.winning = true;
      this.emit({ type: 'signal', gameId, signal: { kind: 'winning' } });
    } else if (value <= -300 && !this.flags.losing) {
      this.flags.losing = true;
      this.emit({ type: 'signal', gameId, signal: { kind: 'losing' } });
    }
  }

  private emitBest(move: BestMove, id: string): void {
    const v = this.view;
    // Drop the move unless it answers exactly the active position.
    if (!v || v.id !== id || v.sync.paused) {
      if (this.answered === id) this.answered = null;
      this.requestReconcile();
      return;
    }
    this.emit({ type: 'bestmove', move });
    if (!this.active && move.note !== 'book') this.setState('idle', 'Your move');
  }

  private setState(state: EngineState, detail = ''): void {
    if (state === this.state && detail === this.stateDetail) return;
    this.state = state;
    this.stateDetail = detail;
    this.emit({ type: 'state', state, detail });
  }
}

function wasmThreadsSupported(): boolean {
  try {
    if (typeof SharedArrayBuffer !== 'function') return false;
    const mem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return mem.buffer instanceof SharedArrayBuffer;
  } catch {
    return false;
  }
}

export type { PersonaId };
