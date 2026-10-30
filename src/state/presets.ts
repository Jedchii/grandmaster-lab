// Engine presets: a few built-in sparring setups plus the user's own saved
// ones (localStorage). A preset never touches threads or hash size - those
// are tuned to the device, not to the opponent.

import { computed, signal } from '@preact/signals';
import { DEFAULT_SETTINGS, type EngineSettings } from '../shared/protocol';
import { engineSettings, sanitizeEngine } from './settings';

export type PresetSettings = Omit<EngineSettings, 'threads' | 'hashMb'>;

export interface EnginePreset {
  id: string;
  name: string;
  builtIn?: boolean;
  settings: PresetSettings;
}

const KEY = 'gml.presets.v1';
const MAX_PRESETS = 30;

function strip(s: EngineSettings): PresetSettings {
  const { threads: _threads, hashMb: _hash, ...rest } = s;
  return rest;
}

const base = strip(DEFAULT_SETTINGS);

export const BUILT_IN_PRESETS: EnginePreset[] = [
  {
    id: 'builtin-blitz',
    name: '⚡ Blitz sparring',
    builtIn: true,
    settings: { ...base, persona: 'patricia', elo: 1600, patriciaStyle: 'aggressive', instamove: true },
  },
  {
    id: 'builtin-club',
    name: '🐇 Club player',
    builtIn: true,
    settings: { ...base, persona: 'patricia', elo: 1400, patriciaStyle: 'positional', thinkMs: 1200, humanPacing: true },
  },
  {
    id: 'builtin-master',
    name: '🎓 Master',
    builtIn: true,
    settings: { ...base, persona: 'patricia', elo: 2400, patriciaStyle: 'solid', thinkMs: 2500 },
  },
  {
    id: 'builtin-stockfish',
    name: '🐟 Full Stockfish',
    builtIn: true,
    settings: { ...base, persona: 'stockfish', elo: 3000, thinkMs: 3000, humanPacing: false },
  },
  {
    id: 'builtin-drawfish',
    name: '🐡 Draw troll',
    builtIn: true,
    settings: { ...base, persona: 'drawfish', elo: 2200, drawfishMode: 'relentless' },
  },
];

function load(): EnginePreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
      .map((p) => ({ id: p.id, name: p.name.slice(0, 40), settings: strip(sanitizeEngine(p.settings)) }));
  } catch {
    return [];
  }
}

export const userPresets = signal<EnginePreset[]>(load());

function persist(list: EnginePreset[]): void {
  userPresets.value = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: keep the in-memory list */
  }
}

/** Saves the current engine settings under a name (replacing a preset with the same name). */
export function savePreset(name: string): EnginePreset | null {
  const clean = name.trim().slice(0, 40);
  if (!clean) return null;
  const preset: EnginePreset = {
    id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    settings: strip(engineSettings.value),
  };
  const others = userPresets.value.filter((p) => p.name.toLowerCase() !== clean.toLowerCase());
  persist([preset, ...others].slice(0, MAX_PRESETS));
  return preset;
}

export function deletePreset(id: string): void {
  persist(userPresets.value.filter((p) => p.id !== id));
}

export function applyPreset(preset: EnginePreset): void {
  const { threads, hashMb } = engineSettings.value;
  engineSettings.value = sanitizeEngine({ ...preset.settings, threads, hashMb });
}

/** sanitizeEngine always emits the same key order, so this compares by value. */
const canonical = (s: PresetSettings) => JSON.stringify(strip(sanitizeEngine(s)));

/** The preset matching the current engine settings exactly, if any. */
export const activePresetId = computed(() => {
  const current = canonical(strip(engineSettings.value));
  const all = [...userPresets.value, ...BUILT_IN_PRESETS];
  return all.find((p) => canonical(p.settings) === current)?.id ?? null;
});
