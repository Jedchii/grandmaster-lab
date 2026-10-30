import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// Cross-origin isolation unlocks SharedArrayBuffer, which the threaded
// Patricia / Stockfish builds need. The service worker re-applies these
// headers to every cached response, so isolation survives offline too.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

// iPhone testing needs HTTPS (service workers + SharedArrayBuffer require a
// secure context, and only localhost is exempt). HTTPS switches on with
// `--host` (or HTTPS=1). If certs/dev-cert.pem + certs/dev-key.pem exist (e.g.
// from mkcert, trusted on the phone) they are used; otherwise a throwaway
// self-signed certificate is generated. HTTPS=0 forces plain http.
const wantHttps = process.env.HTTPS === '1' || (process.env.HTTPS !== '0' && process.argv.includes('--host'));

function httpsPlugins(): Plugin[] {
  if (!wantHttps) return [];
  const cert = path.resolve('certs/dev-cert.pem');
  const key = path.resolve('certs/dev-key.pem');
  if (fs.existsSync(cert) && fs.existsSync(key)) {
    return [
      {
        name: 'gml-local-cert',
        config: () => ({
          server: { https: { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } },
          preview: { https: { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } },
        }),
      },
    ];
  }
  return [basicSsl({ name: 'grandmaster-lab' })];
}

export default defineConfig({
  plugins: [
    preact(),
    ...httpsPlugins(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // public/manifest.webmanifest is hand-written
      injectManifest: {
        globPatterns: ['**/*.{html,js,css,wasm,bin,json,webmanifest,svg,png,txt}'],
        // The single-thread engine builds are only a fallback for browsers
        // without cross-origin isolation (an iPhone with the app's headers
        // uses the threaded builds). They are cached on first use instead
        // (see src/sw.ts), which keeps ~2 MB out of every install.
        globIgnores: ['**/engines/stockfish/stockfish-19-lite-single.*', '**/engines/patricia/patricia-st.*'],
        // Patricia's nets are 4.7 MB; the engines are ~1.8 MB each.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // Engine glue files are fetched by URL, never revisioned by name.
        dontCacheBustURLsMatching: /^assets\//,
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  worker: {
    format: 'es',
  },
  build: {
    target: 'safari16',
    cssTarget: 'safari16',
    assetsInlineLimit: 0,
    sourcemap: false,
    reportCompressedSize: false,
  },
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
});
