// Which engine build the host boots. The threaded builds need SharedArrayBuffer,
// which only exists in a cross-origin isolated page; the native iOS app
// (WKWebView on capacitor://) is not isolated, so it must get the
// single-thread builds without anyone changing a setting.
//   node scripts/run-ts.mjs tests/engine-fallback.test.ts

import { INITIAL_FEN } from '../src/shared/chess';
import { DEFAULT_SETTINGS, type EngineSettings, type HostEvent, type PersonaId } from '../src/shared/protocol';
import { EngineHost } from '../src/workers/host';
import type { EngineLike } from '../src/workers/uci-engine';

const g = globalThis as unknown as Record<string, unknown>;
g.self = globalThis;
g.location = { origin: 'capacitor://localhost' };
g.fetch = async () => new Response('missing', { status: 404 }); // books are not needed here

let failures = 0;
function check(ok: boolean, label: string): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}

function fakeEngine(url: string): EngineLike {
  return {
    name: url.split('/').pop() ?? url,
    url,
    onDeath: null,
    send() {},
    ready: async () => {},
    setOption() {},
    newGame: async () => {},
    search: () => ({ done: new Promise(() => {}) }),
    ponderhit() {},
    stop: async () => null,
    terminate() {},
  };
}

interface Run {
  booted: string[];
  identity: Extract<HostEvent, { type: 'engine' }> | null;
  errors: string[];
}

/** Boots one host and reports which engine URLs it tried. */
async function run(opts: {
  persona: PersonaId;
  isolated: boolean;
  sab: boolean;
  failThreaded?: boolean;
}): Promise<Run> {
  const savedSab = globalThis.SharedArrayBuffer;
  g.crossOriginIsolated = opts.isolated;
  if (!opts.sab) delete g.SharedArrayBuffer;
  const out: Run = { booted: [], identity: null, errors: [] };
  try {
    const host = new EngineHost(
      (e) => {
        if (e.type === 'engine') out.identity = e;
        if (e.type === 'error') out.errors.push(e.message);
      },
      async (url) => {
        out.booted.push(url.replace('capacitor://localhost/', ''));
        if (opts.failThreaded && !/-st\.js$|-single\.js$/.test(url)) throw new Error('worker error: no SharedArrayBuffer');
        return fakeEngine(url);
      },
    );
    const settings: EngineSettings = { ...DEFAULT_SETTINGS, persona: opts.persona };
    // The page reports its own isolation (client.ts); the host re-checks inside the worker.
    host.handle({ type: 'init', baseUrl: '/', isolated: opts.isolated, cores: 6, settings });
    host.handle({
      type: 'sync',
      sync: { gameId: 1, startFen: INITIAL_FEN, moves: [], engineSide: 'black', paused: false, suggest: false },
    });
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    g.SharedArrayBuffer = savedSab;
  }
  return out;
}

// Native iOS app / any non-isolated page: no SharedArrayBuffer, no isolation.
{
  const r = await run({ persona: 'patricia', isolated: false, sab: false });
  check(r.booted.join() === 'engines/patricia/patricia-st.js', `patricia, no isolation, no SAB → single-thread only (${r.booted.join()})`);
  check(r.identity?.threaded === false, 'reported as single-threaded');
}
{
  const r = await run({ persona: 'stockfish', isolated: false, sab: false });
  check(
    r.booted.join() === 'engines/stockfish/stockfish-19-lite-single.js',
    `stockfish, no isolation, no SAB → single-thread only (${r.booted.join()})`,
  );
}
{
  const r = await run({ persona: 'drawfish', isolated: false, sab: true });
  check(
    r.booted.join() === 'engines/stockfish/stockfish-19-lite-single.js',
    `drawfish, SAB present but page not isolated → single-thread (${r.booted.join()})`,
  );
}
// Claims isolation but SharedArrayBuffer is missing (e.g. a WebView that drops it).
{
  const r = await run({ persona: 'patricia', isolated: true, sab: false });
  check(r.booted.join() === 'engines/patricia/patricia-st.js', `isolated flag but no SAB → single-thread (${r.booted.join()})`);
}
// Isolated with SAB (the PWA on Vercel): threaded build first, unchanged.
{
  const r = await run({ persona: 'patricia', isolated: true, sab: true });
  check(r.booted.join() === 'engines/patricia/patricia-mt.js', `isolated + SAB → threaded build (${r.booted.join()})`);
  check(r.identity?.threaded === true, 'reported as multi-threaded');
}
// Threaded build fails to start anyway → falls back by itself.
{
  const r = await run({ persona: 'stockfish', isolated: true, sab: true, failThreaded: true });
  check(
    r.booted.join() === 'engines/stockfish/stockfish-19-lite.js,engines/stockfish/stockfish-19-lite-single.js',
    `threaded boot fails → retries single-thread (${r.booted.join()})`,
  );
  check(r.identity?.threaded === false, 'reported as single-threaded after the retry');
  check(r.errors.some((m) => m.includes('using single-thread build')), 'logs why it fell back');
}

console.log(failures ? `\n${failures} failure(s)` : '\nall engine fallback checks passed');
process.exit(failures ? 1 : 0);
