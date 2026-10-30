// Classic layout: persona card, edge-to-edge board (your colour at the
// bottom), eval strip, move strip, engine lines and the pull-up Lab sheet.

import { Board } from '../Board';
import { EngineLines, EvalStrip } from '../EvalBar';
import { GameOver } from '../GameOver';
import { ClassicSheet } from './ClassicSheet';
import { MoveStrip } from './MoveStrip';
import { NewGameChooser } from './NewGameChooser';
import { PersonaCard } from './PersonaCard';

export function ClassicApp() {
  return (
    <>
      <main class="stage">
        <PersonaCard />
        <div class="board-area">
          <Board />
          <GameOver />
        </div>
        <EvalStrip />
        <MoveStrip />
        <EngineLines />
      </main>
      <ClassicSheet />
      <NewGameChooser />
    </>
  );
}
