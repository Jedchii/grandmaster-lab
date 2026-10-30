// Transient UI state (panels, toasts). Not persisted.

import { signal } from '@preact/signals';

/** Slide-down shelf under the header (board translates down). */
export const shelfOpen = signal(false);
/** Options bottom sheet. */
export const optionsOpen = signal(false);
/** ••• action sheet. */
export const moreOpen = signal(false);
/** Position editor modal. */
export const editorOpen = signal(false);
/** Classic layout: the pull-up sheet is open on the Lab panel. */
export const labOpen = signal(false);
/** Classic layout: the "+ New" colour chooser. */
export const newGameOpen = signal(false);

export const toast = signal<{ id: number; text: string } | null>(null);
let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, ms = 1600): void {
  toast.value = { id: ++toastId, text };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), ms);
}

export function closePanels(): void {
  shelfOpen.value = false;
  optionsOpen.value = false;
  moreOpen.value = false;
  labOpen.value = false;
  newGameOpen.value = false;
}
