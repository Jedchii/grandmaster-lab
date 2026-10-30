/// <reference lib="webworker" />
// Grandmaster Lab service worker.
//
// * Precaches the whole app - JS, CSS, the threaded Patricia + Stockfish
//   builds, Patricia's nets, The Grandmaster Files, icons - so it runs 100%
//   offline. The single-thread fallback builds (only used without
//   cross-origin isolation) are cached the first time they are needed.
// * Re-applies the cross-origin isolation headers to every cached response.
//   Without them an offline launch would lose SharedArrayBuffer and fall back
//   to the single-threaded engines.

import {
  addPlugins,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function withIsolation(response: Response): Response {
  if (response.type === 'opaque' || response.status === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ISOLATION_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

addPlugins([
  {
    cachedResponseWillBeUsed: async ({ cachedResponse }) => (cachedResponse ? withIsolation(cachedResponse) : null),
  },
]);

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/.*/] });
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Fallback engines: cache on first use, then serve offline like the rest.
registerRoute(
  ({ url }) => /\/engines\/(stockfish\/stockfish-19-lite-single|patricia\/patricia-st)\./.test(url.pathname),
  new CacheFirst({
    cacheName: 'gml-fallback-engines',
    plugins: [
      {
        cachedResponseWillBeUsed: async ({ cachedResponse }) => (cachedResponse ? withIsolation(cachedResponse) : null),
      },
    ],
  }),
);

// First install: take control right away so the very first session is
// already offline-capable. Updates wait until the UI asks (no reload mid-game).
self.addEventListener('install', () => {
  if (!self.registration.active) void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
