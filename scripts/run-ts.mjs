#!/usr/bin/env node
// Runs a TypeScript test file in Node by bundling it with Vite (SSR mode).
//   node scripts/run-ts.mjs tests/polyglot.test.ts

import { build } from 'vite';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.resolve(process.argv[2]);
const outDir = path.join(root, 'node_modules/.tmp/run-ts');
const name = path.basename(entry).replace(/\.tsx?$/, '');

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    ssr: entry,
    outDir,
    emptyOutDir: false,
    target: 'node20',
    rollupOptions: { output: { entryFileNames: `${name}.mjs`, format: 'es' } },
  },
});

await import(pathToFileURL(path.join(outDir, `${name}.mjs`)).href);
