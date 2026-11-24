// Message protocol between the UI thread and the engine host worker.
// The UI never parses UCI: the host turns engine output into these objects.
//
// Every engine result carries the exact move line (`line`) it was computed
// for. Both sides drop results whose line no longer matches the active game,
// so a takeback can never be answered by a move meant for another position.

export type PersonaId = 'patricia' | 'stockfish' | 'drawfish';
export type PlayStyle = 'classic' | 'aggressive' | 'positional' | 'solid';
export type Side = 'white' | 'black';
export type DrawfishMode = 'subtle' | 'relentless';
/** max: always full depth, defends worse positions hard. original: Elo caps depth, as first built. */
export type DrawfishDefense = 'max' | 'original';

export interface PonderSettings {
  enabled: boolean;
  /** Pause pondering after this depth (0 = no cap). */
  maxDepth: number;
  /** Pause pondering after this many thousand nodes (0 = no cap). */
  maxKNodes: number;
}

/** The opening book: "The Grandmaster Files" (scripts/build-book.ts). */
export interface BookSettings {
  enabled: boolean;
  /** Stop using the book after this many plies. */
  maxPly: number;
}

export const BOOK_FILE = 'The-Grandmaster-Files.bin';
export const BOOK_NAME = 'The Grandmaster Files';

export interface EngineSettings {
  persona: PersonaId;
  /** Estimated strength for every persona, 800..3000 (3000 = full strength). */
  elo: number;
  patriciaStyle: PlayStyle;
  drawfishMode: DrawfishMode;
  drawfishDefense: DrawfishDefense;
  /** Reply in < 50 ms (book, shallow Elo-scaled search, controlled slips). */
  instamove: boolean;
  /** Keep pondering on your time while Instamove is on (a hit replies at once, from the deeper search). */
  ponderInstamove: boolean;
  thinkMs: number; // base think time per move when instamove is off
  threads: number; // 1..3, only used when cross-origin isolated
  hashMb: number;
  ponder: PonderSettings;
  book: BookSettings;
  analysisLines: number; // PV lines streamed to the UI (1..3)
  humanPacing: boolean; // minimum think time so moves don't feel robotic
}

export interface GameSync {
  gameId: number;
  startFen: string;
  moves: string[]; // UCI from startFen - the *active* history (up to the cursor)
  engineSide: Side;
  /** Neither move nor ponder (game over, reviewing a line with redo moves). */
  paused: boolean;
  /** Analyse the user's turn for the suggestion arrows (top 3 moves). */
  suggest?: boolean;
}

export type HostRequest =
  | { type: 'init'; baseUrl: string; isolated: boolean; cores: number; settings: EngineSettings }
  | { type: 'settings'; settings: EngineSettings }
  | { type: 'sync'; sync: GameSync }
  | { type: 'visibility'; hidden: boolean }
  /** Best move for the side to move (the user); `autoplay` = the Move button. */
  | { type: 'hint'; gameId: number; line: string; autoplay: boolean }
  /** Engine is thinking: play the best move found so far, right now. */
  | { type: 'moveNow' };

/** Score from White's point of view. */
export interface Score {
  cp?: number;
  mate?: number;
}

export interface PvLine {
  multipv: number;
  depth: number;
  scoreWhite: Score;
  bound?: 'lower' | 'upper';
  san: string[];
  /** First moves of the line in UCI, for board arrows. */
  uci: string[];
}

/** `suggest`: full-strength MultiPV 3 analysis of the user's turn for the arrows. */
export type SearchMode = 'move' | 'ponder' | 'hint' | 'suggest';

export interface SearchInfo {
  gameId: number;
  /** Move line of the searched root position, space separated. */
  line: string;
  ply: number;
  mode: SearchMode;
  depth: number;
  seldepth: number;
  nodes: number;
  nps: number;
  timeMs: number;
  lines: PvLine[];
}

export type EngineState = 'loading' | 'idle' | 'book' | 'thinking' | 'pondering' | 'hint' | 'error';

export type MoveNote =
  | 'book'
  | 'engine'
  | 'instant'
  | 'ponderhit'
  | 'sacrifice'
  | 'humanSlip'
  | 'repetition'
  | 'perpetual'
  | 'simplify'
  | 'troll'
  | 'fortress';

export type PersonaSignal =
  | { kind: 'blunderFound'; swing: number }
  | { kind: 'mateFound'; mateIn: number }
  | { kind: 'losing' }
  | { kind: 'winning' }
  | { kind: 'outOfBook'; eco?: string; name?: string };

export interface BestMove {
  gameId: number;
  /** Move line the move answers (must equal the UI's active history). */
  line: string;
  ply: number;
  uci: string;
  san: string;
  note: MoveNote;
  scoreWhite?: Score;
  depth?: number;
  thinkMs: number;
}

export interface HintResult {
  gameId: number;
  line: string;
  uci: string;
  san: string;
  scoreWhite?: Score;
  autoplay: boolean;
}

export type HostEvent =
  | { type: 'engine'; persona: PersonaId; name: string; threaded: boolean; loadMs: number }
  | { type: 'state'; state: EngineState; detail?: string }
  | { type: 'opening'; gameId: number; ply: number; eco: string; name: string; inBook: boolean }
  | { type: 'info'; info: SearchInfo }
  | { type: 'bestmove'; move: BestMove }
  | { type: 'hint'; hint: HintResult }
  | { type: 'ponder'; gameId: number; ply: number; san: string | null }
  | { type: 'signal'; gameId: number; signal: PersonaSignal }
  | { type: 'error'; message: string };

export const lineKey = (moves: readonly string[]): string => moves.join(' ');

export const DEFAULT_SETTINGS: EngineSettings = {
  persona: 'patricia',
  elo: 1800,
  patriciaStyle: 'aggressive',
  drawfishMode: 'relentless',
  drawfishDefense: 'max',
  instamove: false,
  ponderInstamove: false,
  thinkMs: 1200,
  threads: 1,
  hashMb: 32,
  ponder: { enabled: true, maxDepth: 14, maxKNodes: 1500 },
  book: { enabled: true, maxPly: 16 },
  analysisLines: 2,
  humanPacing: true,
};
