// Bottom dock (SmallFish): Game · Options · Flip · Move · Hint · •••

import { copyPgn, engine, hintButton, moveButton, redo, resign, sharePgn, switchSides, undo } from '../controller';
import { game } from '../state/game';
import { uiSettings, updateUi } from '../state/settings';
import { moreOpen, optionsOpen, shelfOpen } from '../state/ui';

export function Dock() {
  const thinking = engine.state.value === 'thinking' && game.atEnd.value && game.turn.value === game.engineSide.value;
  const toggle = (which: 'shelf' | 'options' | 'more') => {
    const s = which === 'shelf' ? shelfOpen : which === 'options' ? optionsOpen : moreOpen;
    const next = !s.value;
    shelfOpen.value = false;
    optionsOpen.value = false;
    moreOpen.value = false;
    s.value = next;
  };
  return (
    <nav class="dock" aria-label="Game controls">
      <button class={shelfOpen.value ? 'on' : ''} onClick={() => toggle('shelf')}>
        Game
      </button>
      <button class={optionsOpen.value ? 'on' : ''} onClick={() => toggle('options')}>
        Options
      </button>
      <button onClick={switchSides} aria-label="Flip: switch sides">
        Flip
      </button>
      <button onClick={moveButton} aria-label={thinking ? 'Move now' : 'Engine move'}>
        {thinking ? 'Now' : 'Move'}
      </button>
      <button onClick={hintButton}>Hint</button>
      <button class={`more ${moreOpen.value ? 'on' : ''}`} onClick={() => toggle('more')} aria-label="More">
        •••
      </button>
    </nav>
  );
}

export function MoreMenu() {
  if (!moreOpen.value) return null;
  const ui = uiSettings.value;
  const close = () => (moreOpen.value = false);
  const act = (fn: () => void) => () => {
    fn();
    close();
  };
  return (
    <div class="action-sheet-wrap" onClick={close}>
      <div class="action-sheet glass" role="menu" onClick={(e) => e.stopPropagation()}>
        <div class="as-group">
          <button onClick={act(() => void copyPgn())}>Copy PGN</button>
          <button onClick={act(() => void sharePgn())}>Share PGN…</button>
        </div>
        <div class="as-group">
          <button onClick={act(() => undo())}>Undo move (swipe →)</button>
          <button onClick={act(() => redo())}>Redo move (swipe ←)</button>
          <button onClick={act(() => updateUi({ suggestArrows: !ui.suggestArrows }))}>
            {ui.suggestArrows ? 'Hide' : 'Show'} move suggestions
          </button>
          <button onClick={act(() => updateUi({ showArrows: !ui.showArrows }))}>
            {ui.showArrows ? 'Hide' : 'Show'} engine arrows
          </button>
          <button onClick={act(() => updateUi({ showEval: !ui.showEval }))}>{ui.showEval ? 'Hide' : 'Show'} eval bar</button>
          <button onClick={act(() => updateUi({ showLines: !ui.showLines }))}>
            {ui.showLines ? 'Hide' : 'Show'} engine lines
          </button>
        </div>
        <div class="as-group">
          <button class="danger" disabled={!!game.result.value || game.length.value === 0} onClick={act(resign)}>
            Resign
          </button>
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
