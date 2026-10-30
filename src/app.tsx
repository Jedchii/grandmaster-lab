// Two layouts over the same game, engine and settings:
// * Classic - persona card, your colour at the bottom, pull-up Lab sheet.
// * SmallFish - header shelf, dock, you always play from the top.
// Switch in Options / Lab -> Layout.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { swipeStep } from './controller';
import { uiSettings } from './state/settings';
import { closePanels, editorOpen, shelfOpen, toast } from './state/ui';
import { Board } from './ui/Board';
import { ClassicApp } from './ui/classic/ClassicApp';
import { Dock, MoreMenu } from './ui/Dock';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { EvalBar } from './ui/EvalBar';
import { GameOver } from './ui/GameOver';
import { Header } from './ui/Header';
import { Notation } from './ui/Notation';
import { OptionsSheet } from './ui/OptionsSheet';
import { PlayerBar } from './ui/PlayerBar';
import { PositionEditor } from './ui/PositionEditor';
import { Shelf } from './ui/Shelf';
import { attachSwipe } from './ui/swipe';
import { themeColours } from './ui/themes';
import { UpdateToast } from './ui/UpdateToast';

/** SmallFish bottom area (player bar + notation): swipe right = undo, left = redo, when enabled. */
function SwipeZone(props: { children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      attachSwipe(ref.current!, {
        accept: () => uiSettings.value.swipeZone !== 'board' && !shelfOpen.value,
        onSwipe: swipeStep,
      }),
    [],
  );
  return (
    <div ref={ref} class="swipe-zone">
      {props.children}
    </div>
  );
}

function SmallFishApp() {
  const lowered = shelfOpen.value;
  return (
    <>
      <Header />
      <div class="viewport">
        <Shelf />
        <main class={`stage ${lowered ? 'lowered' : ''}`}>
          <div class="board-row">
            <EvalBar />
            <div class="board-area">
              <Board />
              <GameOver />
            </div>
          </div>
          <SwipeZone>
            <PlayerBar />
            <Notation />
          </SwipeZone>
          {/* Tapping the lowered board snaps it back up (and never moves a piece). */}
          {lowered && <div class="stage-shield" onPointerDown={() => closePanels()} />}
        </main>
      </div>
      <Dock />
      <OptionsSheet />
      <MoreMenu />
    </>
  );
}

export function App() {
  const { layout, boardTheme, compactCard } = uiSettings.value;
  const colours = themeColours(boardTheme, layout);
  const t = toast.value;
  return (
    <div
      class={`app ${layout} ${layout === 'classic' && compactCard ? 'compact-card' : ''}`}
      style={{ '--sq-light': colours.light, '--sq-dark': colours.dark }}
    >
      <ErrorBoundary area={layout === 'smallfish' ? 'SmallFish layout' : 'Classic layout'} root key={layout}>
        {layout === 'smallfish' ? <SmallFishApp /> : <ClassicApp />}
      </ErrorBoundary>
      <ErrorBoundary area="position editor" onDismiss={() => (editorOpen.value = false)}>
        <PositionEditor />
      </ErrorBoundary>
      {t && (
        <div key={t.id} class="toast quiet" role="status">
          {t.text}
        </div>
      )}
      <UpdateToast />
    </div>
  );
}
