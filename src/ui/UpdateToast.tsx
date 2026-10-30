// Service worker lifecycle: "ready offline" notice and a tap-to-update toast
// (never reloads by itself in the middle of a game).

import { signal } from '@preact/signals';
import { registerSW } from 'virtual:pwa-register';

const needRefresh = signal(false);
const offlineReady = signal(false);
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh.value = true;
    },
    onOfflineReady() {
      offlineReady.value = true;
      setTimeout(() => (offlineReady.value = false), 4000);
    },
  });
}

export function UpdateToast() {
  if (needRefresh.value) {
    return (
      <button class="toast" onClick={() => updateSW?.(true)}>
        Update ready — tap to reload
      </button>
    );
  }
  if (offlineReady.value) {
    return <div class="toast quiet">✓ Ready to play offline</div>;
  }
  return null;
}
