#!/usr/bin/env node
// Builds Patricia 5.1 (Grandmaster Lab fork) to WebAssembly.
//
//   node engines/patricia/build.mjs            # both flavours
//   node engines/patricia/build.mjs mt         # threaded only
//
// Outputs to public/engines/patricia/:
//   patricia-mt.js/.wasm   pthreads build (needs cross-origin isolation)
//   patricia-st.js/.wasm   cooperative single-thread build (Asyncify)
//   patricia-nets.bin      the three NNUE nets, fetched by both flavours
//
// Requires the Emscripten SDK. Set EMSDK to its folder (default: F:/emsdk on
// Windows, ~/emsdk elsewhere).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const outDir = path.join(projectRoot, 'public/engines/patricia');
const tmpDir = path.join(here, '.build');
const isWin = process.platform === 'win32';
const emsdk = process.env.EMSDK || (isWin ? 'F:/emsdk' : path.join(os.homedir(), 'emsdk'));

function findDir(parent) {
  const entries = fs.existsSync(parent) ? fs.readdirSync(parent) : [];
  return entries.length ? path.join(parent, entries[0]) : null;
}

const emscriptenDir = path.join(emsdk, 'upstream/emscripten');
const nodeDir = findDir(path.join(emsdk, 'node'));
const pythonDir = findDir(path.join(emsdk, 'python'));
const env = {
  ...process.env,
  EMSDK: emsdk,
  EM_CONFIG: path.join(emsdk, '.emscripten'),
  PATH: [emscriptenDir, nodeDir && path.join(nodeDir, 'bin'), nodeDir, pythonDir, process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter),
};
if (nodeDir) env.EMSDK_NODE = path.join(nodeDir, isWin ? 'node.exe' : 'bin/node');
if (pythonDir) env.EMSDK_PYTHON = path.join(pythonDir, isWin ? 'python.exe' : 'bin/python3');

const tool = (name) => path.join(emscriptenDir, isWin ? `${name}.exe` : name);

function run(cmd, args) {
  console.log(`\n> ${path.basename(cmd)} ${args.join(' ')}\n`);
  const res = spawnSync(cmd, args, { cwd: here, env, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`${path.basename(cmd)} failed (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

const common = [
  '-O3',
  '-msimd128',
  '-ffast-math',
  '-DNDEBUG',
  '-fno-exceptions',
  '-Wno-c23-extensions',
];

const flavours = {
  mt: {
    cflags: ['-pthread'],
    ldflags: [
      '-pthread',
      '-sPTHREAD_POOL_SIZE=3',
      '-sDEFAULT_PTHREAD_STACK_SIZE=4MB',
      '-sMAXIMUM_MEMORY=512MB',
    ],
    cooperative: false,
  },
  st: {
    cflags: [],
    ldflags: [
      '-sASYNCIFY=1',
      '-sASYNCIFY_STACK_SIZE=1048576',
      '-sASYNCIFY_IGNORE_INDIRECT=1',
      '-sMAXIMUM_MEMORY=1GB',
    ],
    cooperative: true,
  },
};

function writeNets() {
  const order = ['fingolfin.nnue', 'finarfin.nnue', 'feanor.nnue'];
  const buffers = order.map((name) => fs.readFileSync(path.join(here, 'nets', name)));
  fs.writeFileSync(path.join(outDir, 'patricia-nets.bin'), Buffer.concat(buffers));
  console.log(`wrote patricia-nets.bin (${buffers.reduce((n, b) => n + b.length, 0)} bytes)`);
}

function build(name) {
  const f = flavours[name];
  const flagFile = path.join(tmpDir, `flags-${name}.js`);
  fs.writeFileSync(flagFile, `var GML_COOPERATIVE = ${f.cooperative};\n`);

  const tbObj = path.join(tmpDir, `tbprobe-${name}.o`);
  run(tool('emcc'), [...common, ...f.cflags, '-c', 'src/fathom/src/tbprobe.c', '-o', tbObj]);

  run(tool('em++'), [
    ...common,
    ...f.cflags,
    '-std=c++20',
    'wasm/patricia_wasm.cpp',
    tbObj,
    '-o',
    path.join(outDir, `patricia-${name}.js`),
    '--no-entry',
    '-sENVIRONMENT=worker',
    '-sINITIAL_MEMORY=96MB',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sSTACK_SIZE=8MB',
    '-sFILESYSTEM=0',
    '-sEXPORTED_FUNCTIONS=_uci_command,_patricia_init,_patricia_alloc,_patricia_set_net,_patricia_net_bytes,_patricia_alloc_size',
    '-sEXPORTED_RUNTIME_METHODS=ccall,addRunDependency,removeRunDependency',
    '-sINCOMING_MODULE_JS_API=print,printErr,preRun,onRuntimeInitialized,locateFile,instantiateWasm',
    `--pre-js=${flagFile}`,
    '--pre-js=wasm/pre.js',
    '--post-js=wasm/post.js',
    ...f.ldflags,
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });
const wanted = process.argv.slice(2).filter((a) => a in flavours);
for (const name of wanted.length ? wanted : Object.keys(flavours)) build(name);
writeNets();
fs.copyFileSync(path.join(here, 'LICENSE'), path.join(outDir, 'LICENSE.txt'));
console.log('\nPatricia WASM build complete ->', path.relative(projectRoot, outDir));
