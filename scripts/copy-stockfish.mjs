#!/usr/bin/env node
// Copies the Stockfish 19 "lite" WASM builds (multi-threaded + single-threaded)
// from node_modules/stockfish into public/engines/stockfish. The full 99 MB
// nets are intentionally left out: the lite net is far stronger than any human
// and loads instantly on an iPhone.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('stockfish/package.json'));
const { buildVersion } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
const outDir = path.join(root, 'public/engines/stockfish');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  `stockfish-${buildVersion}-lite.js`,
  `stockfish-${buildVersion}-lite.wasm`,
  `stockfish-${buildVersion}-lite-single.js`,
  `stockfish-${buildVersion}-lite-single.wasm`,
];

let copied = 0;
for (const file of files) {
  const src = path.join(pkgDir, 'bin', file);
  const dst = path.join(outDir, file);
  const srcStat = fs.statSync(src);
  if (fs.existsSync(dst) && fs.statSync(dst).size === srcStat.size) continue;
  fs.copyFileSync(src, dst);
  copied++;
}
fs.copyFileSync(path.join(pkgDir, 'Copying.txt'), path.join(outDir, 'Copying.txt'));
console.log(`stockfish ${buildVersion} lite: ${copied} file(s) copied to public/engines/stockfish`);
