// Service worker lifecycle for the installed app:
// * "Ready to play offline" notice and a tap-to-update toast (never reloads by
//   itself in the middle of a game; the live game is saved anyway).
// * Home Screen apps on iOS are resumed rather than relaunched, so the app
//   also looks for a new version whenever it comes back to the foreground.
// * Asks the browser to keep the offline copy and saved games (persistent
//   storage) once the app runs from the Home Screen.
// * AppStatus (Lab → Engine → About): version, offline state, manual update.
// * The native iOS app (__NATIVE__) has everything bundled: no service worker,
//   no install hint, and updates come as a new .ipa.

import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import { showToast } from '../state/ui';

type OfflineState = 'unsupported' | 'dev' | 'saving' | 'ready' | 'bundled';

const needRefresh = signal(false);
const offlineReady = signal(false);
const offlineState = signal<OfflineState>('unsupported');
const checking = signal(false);
let registration: ServiceWorkerRegistration | undefined;
let lastCheck = 0;

/** Foreground update checks at most this often (manual checks always run). */
const AUTO_CHECK_MS = 30 * 60 * 1000;

const isIos = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Running from the Home Screen (iOS) or as an installed app (elsewhere). */
export const isStandalone = (): boolean =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true ||
  matchMedia('(display-mode: standalone)').matches;

function requestPersistentStorage(): void {
  // Only when installed: Safari grants it to Home Screen apps, and a browser
  // tab (Firefox) would otherwise show a permission prompt.
  if (!isStandalone()) return;
  try {
    void navigator.storage
      ?.persisted?.()
      .then((done) => done || navigator.storage.persist())
      .catch(() => {});
  } catch {
    /* not supported */
  }
}

export function registerServiceWorker(): void {
  if (__NATIVE__) {
    offlineState.value = 'bundled';
    return;
  }
  requestPersistentStorage();
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) {
    offlineState.value = 'dev';
    return;
  }
  // A controlling worker has finished precaching (install waits for it).
  offlineState.value = navigator.serviceWorker.controller ? 'ready' : 'saving';
  registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh.value = true;
    },
    onOfflineReady() {
      offlineState.value = 'ready';
      offlineReady.value = true;
      setTimeout(() => (offlineReady.value = false), 4000);
    },
    onRegisteredSW(_url, reg) {
      registration = reg;
      lastCheck = Date.now();
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > AUTO_CHECK_MS) void checkForUpdate(false);
  });
}

/**
 * Switches to the downloaded version and reloads (the live game is saved on
 * every move, so it comes back). The plugin's own reload only fires when the
 * page already had a service worker when it opened, which is not the case for
 * the first session after installing - and iOS resumes that session for a
 * long time - so the reload is done here.
 */
function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (!waiting) {
    // Already activated (e.g. by another window); this page just runs old code.
    window.location.reload();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => window.location.reload(), 4000); // safety net
}

/** Looks for a new version; `onNeedRefresh` fires once it has downloaded. */
async function checkForUpdate(manual: boolean): Promise<void> {
  if (needRefresh.value) return;
  if (!registration) {
    if (manual) showToast('Updates need the installed app');
    return;
  }
  if (!navigator.onLine) {
    if (manual) showToast('Offline: connect to check for updates');
    return;
  }
  lastCheck = Date.now();
  checking.value = true;
  try {
    await registration.update();
    if (manual) {
      showToast(registration.installing || registration.waiting ? 'Downloading the update…' : 'You have the latest version');
    }
  } catch {
    if (manual) showToast('Could not reach the update server');
  } finally {
    checking.value = false;
  }
}

export function UpdateToast() {
  if (needRefresh.value) {
    return (
      <button class="toast" onClick={applyUpdate}>
        Update ready — tap to reload
      </button>
    );
  }
  if (offlineReady.value) {
    return <div class="toast quiet">✓ Ready to play offline</div>;
  }
  return null;
}

const BUILT = new Date(__BUILD_TIME__).toLocaleString(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Version, offline state and a manual update check (About section). */
export function AppStatus() {
  const state = offlineState.value;
  const [storedMb, setStoredMb] = useState<number | null>(null);
  useEffect(() => {
    if (state !== 'ready') return;
    void navigator.storage
      ?.estimate?.()
      .then((e) => setStoredMb(e.usage ? Math.round(e.usage / (1024 * 1024)) : null))
      .catch(() => {});
  }, [state]);

  const offline =
    state === 'bundled'
      ? '✓ Native app: everything is built in and works offline'
      : state === 'ready'
        ? `✓ Works offline${storedMb ? ` · ${storedMb} MB on this device` : ''}`
        : state === 'saving'
          ? 'Saving the app for offline use… keep it open for a moment'
          : state === 'dev'
            ? 'Dev server: no offline copy'
            : 'This browser can’t keep an offline copy';

  return (
    <div class="app-status">
      <p class="hint mono">
        Version {__APP_VERSION__} · built {BUILT}
      </p>
      <p class="hint">{offline}</p>
      {!__NATIVE__ && isIos() && !isStandalone() && (
        <p class="hint">Install: tap Share, then Add to Home Screen. It opens full screen and works offline.</p>
      )}
      {__NATIVE__ ? (
        <p class="hint">Updates: install a newer .ipa with Sideloadly.</p>
      ) : needRefresh.value ? (
        <button class="btn primary" onClick={applyUpdate}>
          Update ready: tap to reload
        </button>
      ) : (
        <button
          class="btn"
          disabled={checking.value || state === 'dev' || state === 'unsupported'}
          onClick={() => void checkForUpdate(true)}
        >
          {checking.value ? 'Checking…' : 'Check for update'}
        </button>
      )}
    </div>
  );
}
