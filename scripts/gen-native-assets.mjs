#!/usr/bin/env node
// Builds the native iOS app's icon and launch image (ios-app/assets/) from the
// same artwork as the PWA:
// * AppIcon-1024.png: the full-bleed (maskable) icon on an opaque background,
//   like apple-touch-icon.png. iOS rounds the corners itself.
// * Splash-2732.png: the PWA launch screen (icon + "Grandmaster Lab" on the
//   app background), as one square image. The launch storyboard scales it to
//   fill the screen height, so the logo matches the Home Screen app's splash
//   on every iPhone; only empty background is cropped at the sides.
// ios-app/scripts/prepare-ios.sh copies both into the Xcode project.
//   node scripts/gen-native-assets.mjs [path-to-chrome]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'ios-app/assets');
const BACKGROUND = '#050608'; // app background (--chrome), same as gen-splash.mjs
const ICON_BACKGROUND = '#07090f'; // same as apple-touch-icon.png

const chrome =
  process.argv[2] ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => fs.existsSync(p));
if (!chrome) throw new Error('Chrome not found; pass its path as an argument');

const svg = (file, size) =>
  fs
    .readFileSync(path.join(root, 'public/icons', file), 'utf8')
    .replace('width="512" height="512"', `width="${size}" height="${size}"`);

fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gml-native-'));

function shoot(name, cssSize, dpr, body) {
  const html = path.join(tmp, `${name}.html`);
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;width:${cssSize}px;height:${cssSize}px;${body}</body></html>`);
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--force-device-scale-factor=${dpr}`,
      `--window-size=${cssSize},${cssSize}`,
      `--screenshot=${path.join(outDir, name)}`,
      `file:///${html.replace(/\\/g, '/')}`,
    ],
    { stdio: 'ignore' },
  );
  console.log('wrote', path.relative(root, path.join(outDir, name)));
}

// 1024 x 1024 app icon.
shoot('AppIcon-1024.png', 1024, 1, `background:${ICON_BACKGROUND}">${svg('icon-maskable.svg', 1024)}`);

// 2732 x 2732 launch image: a 1366 pt square at 2x. gen-splash.mjs lays out a
// 956 pt tall screen with a 112 pt icon, 20 pt gap and 19 pt title; scaled by
// 1366 / 956 so that, filled to a 956 pt screen, it is the same size.
const k = 1366 / 956;
shoot(
  'Splash-2732.png',
  1366,
  2,
  `background:${BACKGROUND};display:flex;flex-direction:column;align-items:center;justify-content:center;` +
    `gap:${20 * k}px;font-family:-apple-system,'Segoe UI',system-ui,sans-serif">` +
    `<div style="width:${112 * k}px;height:${112 * k}px">${svg('icon.svg', 112 * k)}</div>` +
    `<div style="color:#d8dbe6;font-size:${19 * k}px;font-weight:700;letter-spacing:${0.3 * k}px">Grandmaster Lab</div>`,
);

fs.rmSync(tmp, { recursive: true, force: true });
