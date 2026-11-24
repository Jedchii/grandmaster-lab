// Settings validation, engine presets and reset.
//   node scripts/run-ts.mjs tests/settings.test.ts

import { Chess } from 'chessops/chess';
import { DEFAULT_SETTINGS, type EngineSettings } from '../src/shared/protocol';
import { PERSONAS } from '../src/workers/personas';
import {
  BUILT_IN_PRESETS,
  activePresetId,
  applyPreset,
  deletePreset,
  savePreset,
  userPresets,
} from '../src/state/presets';
import {
  DEFAULT_UI,
  engineSettings,
  resetEngineSettings,
  resetUiSettings,
  sanitizeEngine,
  sanitizeUi,
  uiSettings,
  updateEngine,
  updateUi,
} from '../src/state/settings';

let failures = 0;
function eq<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// Corrupt / outdated stored values never reach the engine.
const bad = sanitizeEngine({ persona: 'ghost', elo: 'x', threads: 99, hashMb: 7, ponder: 'nope', book: { source: 'mystery', maxPly: -4 } });
eq('unknown persona -> default', bad.persona, DEFAULT_SETTINGS.persona);
eq('non-numeric Elo -> default', bad.elo, DEFAULT_SETTINGS.elo);
eq('threads clamped', bad.threads, 3);
eq('invalid hash -> default', bad.hashMb, DEFAULT_SETTINGS.hashMb);
eq('missing ponder -> defaults', bad.ponder, DEFAULT_SETTINGS.ponder);
eq('old book source field dropped', 'source' in bad.book, false);
eq('ponder during instamove off by default', sanitizeEngine({}).ponderInstamove, false);
eq('book depth clamped', bad.book.maxPly, 2);
eq('classic (stock) Patricia style kept', sanitizeEngine({ patriciaStyle: 'classic' }).patriciaStyle, 'classic');
eq('unknown style -> default', sanitizeEngine({ patriciaStyle: 'wild' }).patriciaStyle, DEFAULT_SETTINGS.patriciaStyle);

// Patricia weakens herself (UCI_Elo human mode): the host adds no depth cap,
// no think-time cut and no slips, at any Elo.
const patricia = PERSONAS.patricia;
const low: EngineSettings = { ...DEFAULT_SETTINGS, persona: 'patricia', elo: 800 };
const caps = ` ponderdepth ${low.ponder.maxDepth} pondernodes ${low.ponder.maxKNodes * 1000}`;
eq('Patricia: full think time, no depth cap', patricia.plan(low).go, `go movetime ${low.thinkMs}`);
eq('Patricia ponder: thermal caps only', patricia.plan(low).ponderGo, `go ponder movetime ${low.thinkMs}${caps}`);
eq('Patricia Instamove: time limit only', patricia.plan({ ...low, instamove: true }).go, 'go movetime 30');
const root = Chess.default();
const lines = [
  { multipv: 1, depth: 14, score: { cp: 30 }, pv: ['e2e4', 'e7e5'] },
  { multipv: 2, depth: 14, score: { cp: -40 }, pv: ['a2a3', 'e7e5'] },
  { multipv: 3, depth: 14, score: { cp: -250 }, pv: ['g2g4', 'd7d5'] },
];
const picks = new Set(
  Array.from({ length: 300 }, () => patricia.choose({ root, history: [], lines, engineBest: 'd2d4', settings: low }).uci),
);
eq('Patricia always plays her own pick (no host slips)', [...picks], ['d2d4']);

// DrawFish weighs 6 moves normally, 24 when clearly winning (so she can give
// the win back instead of converting it).
const multiPv = (ctx: Parameters<typeof PERSONAS.drawfish.configure>[2]) => {
  let lines = 0;
  const engine = { setOption: (name: string, value: unknown) => name === 'MultiPV' && (lines = Number(value)) };
  PERSONAS.drawfish.configure(engine as never, DEFAULT_SETTINGS, ctx);
  return lines;
};
const base = { threaded: false, maxThreads: 1 };
eq('DrawFish: 6 lines when level', multiPv({ ...base, lastValue: 40, materialEdge: 0 }), 6);
eq('DrawFish: 6 lines when losing', multiPv({ ...base, lastValue: -400, materialEdge: -3 }), 6);
eq('DrawFish: 24 lines when her eval says winning', multiPv({ ...base, lastValue: 320, materialEdge: 0 }), 24);
eq('DrawFish: 24 lines when 3 pawns up', multiPv({ ...base, materialEdge: 3 }), 24);
eq('DrawFish: 24 lines when she has a forced mate', multiPv({ ...base, lastValue: 99980 }), 24);

// DrawFish defence: max = always full depth; original = the Elo setting caps it.
eq('DrawFish defence defaults to max', sanitizeEngine({}).drawfishDefense, 'max');
eq('DrawFish original defence kept', sanitizeEngine({ drawfishDefense: 'original' }).drawfishDefense, 'original');
eq('DrawFish unknown defence -> max', sanitizeEngine({ drawfishDefense: 'turtle' }).drawfishDefense, 'max');
const dfMax: EngineSettings = { ...DEFAULT_SETTINGS, persona: 'drawfish', elo: 1800, drawfishDefense: 'max' };
const dfOrig: EngineSettings = { ...dfMax, drawfishDefense: 'original' };
eq('DrawFish max at 1800: full depth', PERSONAS.drawfish.plan(dfMax).go, 'go movetime 1200');
eq('DrawFish original at 1800: depth 9 cap', PERSONAS.drawfish.plan(dfOrig).go, 'go movetime 1200 depth 9');
eq('DrawFish max Instamove: time limit only', PERSONAS.drawfish.plan({ ...dfMax, instamove: true }).go, 'go movetime 30');
eq('DrawFish original Instamove: Elo depth cap', PERSONAS.drawfish.plan({ ...dfOrig, instamove: true }).go, 'go depth 3 movetime 30');
eq('v1 patriciaElo migrates', sanitizeEngine({ patriciaElo: 2100 }).elo, 2100);
eq('Elo clamped to 800..3000', sanitizeEngine({ elo: 5000 }).elo, 3000);
eq('null input -> defaults', sanitizeEngine(null), DEFAULT_SETTINGS);

// Built-in presets apply; threads and hash stay as the device had them.
updateEngine({ threads: 2, hashMb: 64 });
const blitz = BUILT_IN_PRESETS.find((p) => p.id === 'builtin-blitz')!;
applyPreset(blitz);
eq('preset: persona', engineSettings.value.persona, 'patricia');
eq('preset: instamove', engineSettings.value.instamove, true);
eq('preset: keeps threads', engineSettings.value.threads, 2);
eq('preset: keeps hash', engineSettings.value.hashMb, 64);
eq('active preset detected', activePresetId.value, 'builtin-blitz');
updateEngine({ elo: 1650 });
eq('tweaking clears the active preset', activePresetId.value, null);

// User presets: save, same name replaces, apply, delete.
const mine = savePreset('  My sparring  ')!;
eq('saved name trimmed', mine.name, 'My sparring');
eq('saved preset is active', activePresetId.value, mine.id);
updateEngine({ elo: 900 });
savePreset('my sparring');
eq('same name (any case) replaces', userPresets.value.length, 1);
eq('replacement holds the new Elo', userPresets.value[0].settings.elo, 900);
updateEngine({ elo: 2500, persona: 'stockfish' });
applyPreset(userPresets.value[0]);
eq('user preset applied', [engineSettings.value.persona, engineSettings.value.elo], ['patricia', 900]);
eq('empty name refused', savePreset('   '), null);
deletePreset(userPresets.value[0].id);
eq('preset deleted', userPresets.value.length, 0);

// Reset: engine to defaults (device tuning kept); display keeps the layout.
resetEngineSettings();
eq('engine reset', { ...engineSettings.value, threads: 0, hashMb: 0 }, { ...DEFAULT_SETTINGS, threads: 0, hashMb: 0 });
eq('engine reset keeps threads', engineSettings.value.threads, 2);
updateUi({ layout: 'smallfish', sound: true, boardTheme: 'wood', suggestArrows: true });
resetUiSettings();
eq('display reset keeps layout', uiSettings.value.layout, 'smallfish');
eq('display reset', { ...uiSettings.value, layout: DEFAULT_UI.layout }, DEFAULT_UI);
eq('sound off by default', DEFAULT_UI.sound, false);
eq('bubbles off by default', DEFAULT_UI.bubbles, false);

// Classic bottom bar handedness: right by default, unknown values fall back.
eq('handedness right by default', DEFAULT_UI.handedness, 'right');
eq('left handedness kept', sanitizeUi({ handedness: 'left' }).handedness, 'left');
eq('unknown handedness -> right', sanitizeUi({ handedness: 'both' }).handedness, 'right');
eq('older settings without handedness -> right', sanitizeUi({ layout: 'classic', compactCard: true }).handedness, 'right');
updateUi({ handedness: 'left' });
resetUiSettings();
eq('display reset restores right handedness', uiSettings.value.handedness, 'right');

console.log(failures ? `\n${failures} failure(s)` : '\nall settings checks passed');
process.exitCode = failures ? 1 : 0;
