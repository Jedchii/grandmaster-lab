#!/usr/bin/env node
// Headless UCI smoke test for the cooperative (single-threaded) Patricia build.
// Emulates a dedicated Web Worker inside a Node worker_thread, so the exact
// file that ships in public/engines/ is exercised: boot, search, stop latency,
// isready during search, ponder caps / ponderhit / held bestmove, strength
// limiting and playstyles.
//
//   node scripts/engine-smoke.mjs
//
// (stockfish.js detects Node and switches to its CLI mode, so Stockfish is
// verified in the browser instead.)

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const which = 'patricia';
const script = path.join(root, 'public/engines/patricia/patricia-st.js');

const shim = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
globalThis.self = globalThis;
globalThis.WorkerGlobalScope = function WorkerGlobalScope() {};
const href = require('node:url').pathToFileURL(workerData.script).href + (workerData.hash || '');
globalThis.location = new URL(href);
globalThis.postMessage = (m) => parentPort.postMessage(m);
globalThis.close = () => process.exit(0);
globalThis.onmessage = null;
globalThis.importScripts = () => {};
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  u.hash = '';
  const data = fs.readFileSync(u);
  const type = u.pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
  return new Response(data, { headers: { 'Content-Type': type, 'Content-Length': String(data.length) } });
};
parentPort.on('message', (m) => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data: m }); });
(0, eval)(fs.readFileSync(workerData.script, 'utf8'));
`;

const worker = new Worker(shim, { eval: true, workerData: { script, hash: '' } });

const lines = [];
const waiters = [];
worker.on('message', (line) => {
  line = String(line);
  lines.push({ t: performance.now(), line });
  if (process.env.VERBOSE || /^(bestmove|uciok|readyok|id name|info string)/.test(line)) console.log('  <', line);
  for (const w of [...waiters]) {
    if (w.re.test(line)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(line);
    }
  }
});
worker.on('error', (e) => {
  console.error('worker error', e);
  process.exit(1);
});

const send = (cmd) => {
  console.log('  >', cmd);
  worker.postMessage(cmd);
};
const waitFor = (re, ms = 30000) =>
  new Promise((resolve, reject) => {
    const w = { re, resolve };
    waiters.push(w);
    setTimeout(() => reject(new Error(`timeout waiting for ${re}`)), ms);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lastInfo = () => [...lines].reverse().find((l) => /^info .*depth/.test(l.line))?.line ?? '';

let failures = 0;
const check = (ok, label) => {
  console.log(ok ? `PASS ${label}` : `FAIL ${label}`);
  if (!ok) failures++;
};

try {
  let t0 = performance.now();
  send('uci');
  await waitFor(/^uciok/);
  check(true, `boot + uci in ${(performance.now() - t0).toFixed(0)} ms`);

  send('isready');
  await waitFor(/^readyok/);

  send('position startpos');
  t0 = performance.now();
  send('go depth 12');
  let bm = await waitFor(/^bestmove/);
  check(/^bestmove [a-h][1-8][a-h][1-8]/.test(bm), `depth 12 search (${(performance.now() - t0).toFixed(0)} ms): ${bm}`);
  console.log('   last info:', lastInfo());

  // stop must interrupt an infinite search quickly (cooperative yielding)
  send('position startpos moves e2e4 c7c5');
  send('go infinite');
  await sleep(600);
  t0 = performance.now();
  send('stop');
  bm = await waitFor(/^bestmove/, 5000);
  const stopLatency = performance.now() - t0;
  check(stopLatency < 250, `stop latency ${stopLatency.toFixed(1)} ms -> ${bm}`);

  // isready must be answered while searching
  send('position startpos moves d2d4');
  send('go infinite');
  await sleep(300);
  t0 = performance.now();
  send('isready');
  await waitFor(/^readyok/, 3000);
  check(performance.now() - t0 < 250, `isready during search answered in ${(performance.now() - t0).toFixed(1)} ms`);
  send('stop');
  await waitFor(/^bestmove/);

  if (which === 'patricia') {
    // ponder with a depth cap: search must pause (no info past depth 8)
    send('position startpos moves e2e4 e7e5 g1f3');
    send('go ponder movetime 800 ponderdepth 8');
    await sleep(1500);
    const before = lines.length;
    const depthLine = lastInfo();
    await sleep(700);
    const newInfos = lines.slice(before).filter((l) => /^info .*depth/.test(l.line));
    const maxDepth = Number((depthLine.match(/ depth (\d+)/) || [])[1] || 0);
    check(maxDepth <= 8 && newInfos.length === 0, `ponder paused at depth cap (last depth ${maxDepth}, ${newInfos.length} new infos while capped)`);
    t0 = performance.now();
    send('ponderhit');
    bm = await waitFor(/^bestmove/, 5000);
    const hitTime = performance.now() - t0;
    check(hitTime > 500 && hitTime < 1500, `ponderhit resumed with 800 ms budget -> ${bm} after ${hitTime.toFixed(0)} ms`);
    console.log('   last info:', lastInfo());

    // ponder miss: stop must end a ponder search and report bestmove
    send('position startpos moves e2e4 e7e5 g1f3 b8c6');
    send('go ponder movetime 500');
    await sleep(400);
    t0 = performance.now();
    send('stop');
    bm = await waitFor(/^bestmove/, 3000);
    check(performance.now() - t0 < 250, `ponder stop -> ${bm} in ${(performance.now() - t0).toFixed(1)} ms`);

    // a ponder search that finishes on its own must wait for ponderhit
    send('position startpos moves e2e4');
    send('go ponder depth 4');
    await sleep(600);
    const prematureBest = lines.slice(-20).some((l) => /^bestmove/.test(l.line) && performance.now() - l.t < 600);
    check(!prematureBest, 'finished ponder search holds bestmove until ponderhit');
    send('ponderhit');
    bm = await waitFor(/^bestmove/, 3000);
    check(true, `held bestmove released on ponderhit: ${bm}`);

    // human-like strength limiting
    send('setoption name UCI_LimitStrength value true');
    send('setoption name UCI_Elo value 1200');
    send('position startpos moves e2e4 e7e5');
    send('go movetime 400');
    bm = await waitFor(/^bestmove/);
    check(/^bestmove [a-h][1-8][a-h][1-8]/.test(bm), `Elo 1200 move: ${bm}`);

    // human mode's mistake budget: a ponder search that is stopped (the
    // opponent played another move) must leave it alone; played moves count.
    const budget = async () => {
      const reply = waitFor(/^info string budget/, 3000);
      send('budget');
      return Number((await reply).split(' ').pop());
    };
    const b1 = await budget();
    send('position startpos moves e2e4 e7e5 g1f3 b8c6');
    send('go ponder movetime 300');
    await sleep(250);
    send('stop');
    await waitFor(/^bestmove/);
    const b2 = await budget();
    check(b2 === b1, `stopped ponder search leaves the budget alone (${b1} -> ${b2})`);
    let b3 = b2;
    for (let i = 0; i < 3 && b3 === b2; i++) {
      send('position startpos moves e2e4 e7e5 g1f3 b8c6');
      send('go ponder movetime 300');
      await sleep(100);
      send('ponderhit');
      await waitFor(/^bestmove/);
      b3 = await budget();
    }
    check(b3 !== b2, `a ponder hit counts towards the budget (${b2} -> ${b3})`);
    send('ucinewgame');
    const b4 = await budget();
    check(b4 === 0, `ucinewgame resets the budget (${b4})`);
    send('setoption name UCI_LimitStrength value false');

    for (const style of ['Classic', 'Positional', 'Solid', 'Aggressive']) {
      send(`setoption name Style value ${style}`);
      send('position fen r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
      send('go depth 10');
      bm = await waitFor(/^bestmove/);
      check(bm === 'bestmove h5f7', `${style}: mate-in-1 found (${bm})`);
    }

    send('setoption name Style value Aggressive');
    send('position startpos');
    send('go depth 14');
    bm = await waitFor(/^bestmove/, 60000);
    const nps = Number((lastInfo().match(/ nps (\d+)/) || [])[1] || 0);
    console.log(`   depth 14 nps: ${nps}`);
  }
} catch (err) {
  console.error('FAIL', err.message);
  failures++;
}

await worker.terminate();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
