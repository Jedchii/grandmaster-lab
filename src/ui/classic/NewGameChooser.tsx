// Classic layout: "+ New" first asks which colour you want, then starts the
// game straight away. The choice also becomes the Lab's "Play as" default.

import { h } from 'preact';
import { newGame } from '../../controller';
import type { Side } from '../../shared/protocol';
import { game } from '../../state/game';
import { uiSettings, updateUi } from '../../state/settings';
import { newGameOpen } from '../../state/ui';

const CHOICES: Array<{ value: Side | 'random'; label: string }> = [
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'random', label: 'Random' },
];

export function NewGameChooser() {
  if (!newGameOpen.value) return null;
  const close = () => (newGameOpen.value = false);
  const start = (choice: Side | 'random') => {
    close();
    updateUi({ playAs: choice });
    newGame(choice);
  };
  const { playAs, autoArchive } = uiSettings.value;
  const inProgress = game.length.value > 0 && !game.result.value;
  return (
    <div class="action-sheet-wrap" onClick={close}>
      <div class="action-sheet" role="dialog" aria-label="New game" onClick={(e) => e.stopPropagation()}>
        <div class="ng">
          <div class="ng-title">New game · play as</div>
          <div class="ng-sides">
            {CHOICES.map((c) => (
              <button key={c.value} class={`ng-side ${playAs === c.value ? 'on' : ''}`} onClick={() => start(c.value)}>
                <span class="cg-wrap ng-piece" aria-hidden="true">
                  {c.value === 'random' ? (
                    <span class="ng-dice">🎲</span>
                  ) : (
                    h('piece', { class: `king ${c.value}` })
                  )}
                </span>
                <span class="ng-label">{c.label}</span>
              </button>
            ))}
          </div>
          {inProgress && (
            <p class="ng-note">
              {autoArchive
                ? 'The current game is saved to Match history.'
                : 'Auto-save is off: the current game will be discarded.'}
            </p>
          )}
        </div>
        <div class="as-group">
          <button class="cancel" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
