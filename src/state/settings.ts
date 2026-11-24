// Persisted user settings (engine + UI). localStorage is a per-device
// convenience; every read/write is guarded because private mode can throw.
// Everything read back is validated, so a corrupt or outdated entry can
// never feed the UI or the engine host an unknown persona or a NaN.

import { effect, signal } from '@preact/signals';
import { DEFAULT_SETTINGS, type EngineSettings, type Side } from '../shared/protocol';

/** Classic: persona card + peek sheet. SmallFish: header shelf + dock, you play from the top. */
export type Layout = 'classic' | 'smallfish';

export type BoardTheme = 'auto' | 'slate' | 'paper' | 'wood' | 'green' | 'ocean' | 'lavender' | 'rose';

/** Where a sideways swipe undoes / redoes (SmallFish; Classic always uses the board). */
export type SwipeZone = 'board' | 'bottom' | 'both';

/** How far undo / redo go: back to your turn (1 or 2 moves), or exactly 1 or 2 moves. */
export type UndoStep = 'smart' | 'one' | 'two';

export interface UiSettings {
  layout: Layout;
  sound: boolean;
  haptics: boolean;
  /** Persona speech bubbles. */
  bubbles: boolean;
  showLines: boolean;
  showEval: boolean;
  showArrows: boolean;
  /** Up to three arrows for your best moves on your turn (brighter = better). */
  suggestArrows: boolean;
  coordinates: boolean;
  /** Board colours ('auto' = the layout's own). */
  boardTheme: BoardTheme;
  /** Save the previous game to Match history when a new one starts. */
  autoArchive: boolean;
  /** Colour for a new game in the classic layout (SmallFish always alternates). */
  playAs: Side | 'random' | 'alternate';
  swipeZone: SwipeZone;
  undoStep: UndoStep;
  /** SmallFish: the header's right pill becomes a lock for the header menu. */
  headerLock: boolean;
  /** SmallFish: the header menu is locked (taps on the header do nothing). */
  headerLocked: boolean;
  /** Classic: the opponent card shrinks to one line, so the board moves up. */
  compactCard: boolean;
  /** Classic: 'left' mirrors the bottom bar's button order. */
  handedness: Handedness;
}

export type Handedness = 'right' | 'left';

export const DEFAULT_UI: UiSettings = {
  layout: 'classic',
  sound: false,
  haptics: true,
  bubbles: false,
  showLines: false,
  showEval: true,
  showArrows: true,
  suggestArrows: false,
  coordinates: true,
  boardTheme: 'auto',
  autoArchive: true,
  playAs: 'white',
  swipeZone: 'board',
  undoStep: 'smart',
  headerLock: false,
  headerLocked: true,
  compactCard: false,
  handedness: 'right',
};

const KEY = 'gml.settings.v1';

const oneOf = <T,>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const num = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;

/** Validates engine settings from storage, a preset or an older version. */
export function sanitizeEngine(raw: unknown): EngineSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const ponder = (r.ponder && typeof r.ponder === 'object' ? r.ponder : {}) as Record<string, unknown>;
  const book = (r.book && typeof r.book === 'object' ? r.book : {}) as Record<string, unknown>;
  // v1 stored one Elo per persona; everything now drives a single Elo.
  const elo = typeof r.elo === 'number' ? r.elo : r.patriciaElo;
  return {
    persona: oneOf(r.persona, ['patricia', 'stockfish', 'drawfish'] as const, d.persona),
    elo: num(elo, 800, 3000, d.elo),
    patriciaStyle: oneOf(r.patriciaStyle, ['classic', 'aggressive', 'positional', 'solid'] as const, d.patriciaStyle),
    drawfishMode: oneOf(r.drawfishMode, ['subtle', 'relentless'] as const, d.drawfishMode),
    drawfishDefense: oneOf(r.drawfishDefense, ['max', 'original'] as const, d.drawfishDefense),
    instamove: bool(r.instamove, d.instamove),
    ponderInstamove: bool(r.ponderInstamove, d.ponderInstamove),
    thinkMs: num(r.thinkMs, 300, 6000, d.thinkMs),
    threads: num(r.threads, 1, 3, d.threads),
    hashMb: oneOf(r.hashMb, [16, 32, 64] as const, d.hashMb),
    ponder: {
      enabled: bool(ponder.enabled, d.ponder.enabled),
      maxDepth: num(ponder.maxDepth, 0, 60, d.ponder.maxDepth),
      maxKNodes: num(ponder.maxKNodes, 0, 100000, d.ponder.maxKNodes),
    },
    book: {
      enabled: bool(book.enabled, d.book.enabled),
      maxPly: num(book.maxPly, 2, 40, d.book.maxPly),
    },
    analysisLines: num(r.analysisLines, 1, 3, d.analysisLines),
    humanPacing: bool(r.humanPacing, d.humanPacing),
  };
}

const THEMES: readonly BoardTheme[] = ['auto', 'slate', 'paper', 'wood', 'green', 'ocean', 'lavender', 'rose'];

/** Validates UI settings from storage or an older version. */
export function sanitizeUi(raw: unknown): UiSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_UI;
  return {
    layout: oneOf(r.layout, ['classic', 'smallfish'] as const, d.layout),
    // Settings saved before bubbles became optional had sound on by default;
    // sound is now opt-in, so it is switched off once for them too.
    sound: 'bubbles' in r ? bool(r.sound, d.sound) : false,
    haptics: bool(r.haptics, d.haptics),
    bubbles: bool(r.bubbles, d.bubbles),
    showLines: bool(r.showLines, d.showLines),
    showEval: bool(r.showEval, d.showEval),
    showArrows: bool(r.showArrows, d.showArrows),
    suggestArrows: bool(r.suggestArrows, d.suggestArrows),
    coordinates: bool(r.coordinates, d.coordinates),
    boardTheme: oneOf(r.boardTheme, THEMES, d.boardTheme),
    autoArchive: bool(r.autoArchive, d.autoArchive),
    playAs: oneOf(r.playAs, ['white', 'black', 'random', 'alternate'] as const, d.playAs),
    swipeZone: oneOf(r.swipeZone, ['board', 'bottom', 'both'] as const, d.swipeZone),
    undoStep: oneOf(r.undoStep, ['smart', 'one', 'two'] as const, d.undoStep),
    headerLock: bool(r.headerLock, d.headerLock),
    headerLocked: bool(r.headerLocked, d.headerLocked),
    compactCard: bool(r.compactCard, d.compactCard),
    handedness: oneOf(r.handedness, ['right', 'left'] as const, d.handedness),
  };
}

function load(): { engine: EngineSettings; ui: UiSettings } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { engine: sanitizeEngine(parsed?.engine), ui: sanitizeUi(parsed?.ui) };
    }
  } catch {
    /* ignore corrupt or unavailable storage */
  }
  return { engine: DEFAULT_SETTINGS, ui: DEFAULT_UI };
}

const initial = load();
export const engineSettings = signal<EngineSettings>(initial.engine);
export const uiSettings = signal<UiSettings>(initial.ui);

effect(() => {
  const data = JSON.stringify({ engine: engineSettings.value, ui: uiSettings.value });
  try {
    localStorage.setItem(KEY, data);
  } catch {
    /* storage full or blocked */
  }
});

export function updateEngine(patch: Partial<EngineSettings>): void {
  engineSettings.value = { ...engineSettings.value, ...patch };
}

export function updateUi(patch: Partial<UiSettings>): void {
  uiSettings.value = { ...uiSettings.value, ...patch };
}

/** Engine back to defaults; threads and hash stay (they are tuned to the device). */
export function resetEngineSettings(): void {
  const { threads, hashMb } = engineSettings.value;
  engineSettings.value = { ...DEFAULT_SETTINGS, threads, hashMb };
}

/** Display & feel back to defaults; the layout you are in stays. */
export function resetUiSettings(): void {
  uiSettings.value = { ...DEFAULT_UI, layout: uiSettings.value.layout };
}

/** Wipes stored settings (used by the crash screen). */
export function clearStoredSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* unavailable */
  }
}
