#!/usr/bin/env node
// Builds the app icons (SVG + PNGs) using the cburnett knight from chessground
// and headless Chrome for rasterising.
//   node scripts/gen-icons.mjs [path-to-chrome]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/icons');
fs.mkdirSync(outDir, { recursive: true });

const css = fs.readFileSync(path.join(root, 'node_modules/@lichess-org/chessground/assets/chessground.cburnett.css'), 'utf8');
const match = css.match(/piece\.knight\.white\s*\{\s*background-image:\s*url\('data:image\/svg\+xml;base64,([^']+)'\)/);
if (!match) throw new Error('knight not found in chessground.cburnett.css');
const knight = Buffer.from(match[1], 'base64').toString('utf8');
const inner = knight.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

function iconSvg({ maskable }) {
  const corner = maskable ? 0 : 116;
  const scale = maskable ? 6.2 : 7.3;
  const offset = 256 - 22.5 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a1d52"/>
      <stop offset="0.55" stop-color="#121628"/>
      <stop offset="1" stop-color="#07090f"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.44" r="0.5">
      <stop offset="0" stop-color="#ff5d73" stop-opacity="0.55"/>
      <stop offset="0.6" stop-color="#7a5cff" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="${corner}" fill="url(#bg)"/>
  <rect width="512" height="512" rx="${corner}" fill="url(#glow)"/>
  <circle cx="256" cy="250" r="${maskable ? 150 : 176}" fill="none" stroke="#ff5d73" stroke-width="16" opacity="0.5" filter="url(#soft)"/>
  <circle cx="256" cy="250" r="${maskable ? 150 : 176}" fill="none" stroke="#ff8a9a" stroke-width="5" opacity="0.95"/>
  <g transform="translate(${offset} ${offset - 6}) scale(${scale})">${inner}</g>
</svg>`;
}

fs.writeFileSync(path.join(outDir, 'icon.svg'), iconSvg({ maskable: false }));
fs.writeFileSync(path.join(outDir, 'icon-maskable.svg'), iconSvg({ maskable: true }));

const chrome =
  process.argv[2] ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => fs.existsSync(p));
if (!chrome) throw new Error('Chrome not found; pass its path as an argument');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gml-icons-'));
function rasterise(svgFile, size, outFile, background = 'transparent') {
  const html = path.join(tmp, `${path.basename(outFile)}.html`);
  const svg = fs.readFileSync(path.join(outDir, svgFile), 'utf8');
  fs.writeFileSync(
    html,
    `<!doctype html><html><body style="margin:0;background:${background}">` +
      `<div style="width:${size}px;height:${size}px">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</div></body></html>`,
  );
  execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    '--default-background-color=00000000',
    `--screenshot=${path.join(outDir, outFile)}`,
    `file:///${html.replace(/\\/g, '/')}`,
  ], { stdio: 'ignore' });
  console.log('wrote', outFile);
}

rasterise('icon.svg', 192, 'icon-192.png');
rasterise('icon.svg', 512, 'icon-512.png');
rasterise('icon-maskable.svg', 512, 'icon-maskable-512.png');
// Apple touch icons must be opaque; iOS rounds the corners itself.
rasterise('icon-maskable.svg', 180, 'apple-touch-icon.png', '#07090f');
fs.rmSync(tmp, { recursive: true, force: true });
