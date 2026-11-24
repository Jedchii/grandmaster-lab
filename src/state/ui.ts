// Transient UI state (panels, toasts). Not persisted.

import { signal } from '@preact/signals';
import type { PlyRecord } from './game';

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
/** Classic layout: the open Lab sheet is pulled up to full height (else half). */
export const labFull = signal(false);

export type LabTab = 'play' | 'opponent' | 'display' | 'engine';
/** Classic layout: the Lab tab last shown (kept while the app is open). */
export const labTab = signal<LabTab>('play');

/**
 * The finished game whose result card was dismissed with "Review". Compared
 * by reference, so a new move (new line) or a resignation shows it again.
 */
export const gameOverDismissed = signal<{ line: PlyRecord[]; resigned: unknown } | null>(null);

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
  labFull.value = false;
  newGameOpen.value = false;
}
