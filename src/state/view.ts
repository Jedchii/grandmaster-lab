// Board perspective, which depends on the layout:
//
// * SmallFish locks the "BPHH" rule: the human ALWAYS plays from the top,
//   pushing down, so chessground's orientation (the colour at the bottom) is
//   the engine's colour.
// * Classic keeps the original behaviour: your colour at the bottom, and the
//   Flip button turns the board around.

import { computed, signal } from '@preact/signals';
import type { Side } from '../shared/protocol';
import { game } from './game';
import { uiSettings } from './settings';

/** Classic only: the board has been turned with the Flip button. */
export const flipped = signal(false);

/** chessground orientation = the colour shown at the bottom. */
export const orientation = computed<Side>(() => {
  if (uiSettings.value.layout === 'smallfish') return game.engineSide.value;
  return flipped.value ? game.engineSide.value : game.userSide.value;
});

/** Is the human playing from the top of the screen? */
export const humanOnTop = computed(() => orientation.value !== game.userSide.value);
