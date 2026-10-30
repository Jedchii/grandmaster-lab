// Settings validation, engine presets and reset.
//   node scripts/run-ts.mjs tests/settings.test.ts

import { DEFAULT_SETTINGS } from '../src/shared/protocol';
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

console.log(failures ? `\n${failures} failure(s)` : '\nall settings checks passed');
process.exitCode = failures ? 1 : 0;
