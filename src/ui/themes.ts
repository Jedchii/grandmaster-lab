// Board colour themes. 'auto' keeps each layout's own colours (Slate for
// Classic, Paper for SmallFish); the rest override --sq-light / --sq-dark,
// which the board, the coordinates and the position editor all read.

import type { BoardTheme, Layout } from '../state/settings';

export interface ThemeColours {
  label: string;
  light: string;
  dark: string;
}

export const BOARD_THEMES: Record<Exclude<BoardTheme, 'auto'>, ThemeColours> = {
  slate: { label: 'Slate', light: '#dfe4ec', dark: '#8798b0' },
  paper: { label: 'Paper', light: '#ececec', dark: '#b2b2b2' },
  wood: { label: 'Wood', light: '#f0d9b5', dark: '#b58863' },
  green: { label: 'Green', light: '#eeeed2', dark: '#769656' },
  ocean: { label: 'Ocean', light: '#dee3e6', dark: '#7c9cb0' },
  lavender: { label: 'Lavender', light: '#ece6f6', dark: '#9785c2' },
  rose: { label: 'Rose', light: '#f5e6e3', dark: '#c98b86' },
};

export const THEME_ORDER: BoardTheme[] = ['auto', 'slate', 'paper', 'wood', 'green', 'ocean', 'lavender', 'rose'];

/** The colours a theme resolves to in a layout. */
export function themeColours(theme: BoardTheme, layout: Layout): ThemeColours {
  if (theme !== 'auto') return BOARD_THEMES[theme];
  return layout === 'smallfish' ? BOARD_THEMES.paper : BOARD_THEMES.slate;
}
