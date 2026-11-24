// Classic layout: the Lab sheet's four tabs.
// * Play: quick actions (new game, resign, flip, edit position, PGN), Play as
//   and Match history.
// * Opponent: persona, Elo, style, presets, thinking.
// * Display: coach, controls & gestures, board colours, display & feel, layout.
// * Engine: pondering, book, engine, saved settings, about.

import { copyPgn, flipBoard, newGame, resign, sharePgn } from '../../controller';
import { game } from '../../state/game';
import { uiSettings, updateUi } from '../../state/settings';
import { editorOpen, type LabTab } from '../../state/ui';
import { Icon, Row, Section, Segmented } from '../controls';
import { MatchHistory } from '../History';
import { EloSlider, PersonaPicker } from '../PersonaPicker';
import {
  AboutSection,
  BoardThemeSection,
  BookSection,
  CoachSection,
  ConfirmButton,
  ControlsSection,
  EngineSection,
  FeelSection,
  LayoutSection,
  PersonaStyle,
  PonderSection,
  PresetsSection,
  ResetSection,
  ThinkingSection,
} from '../Settings';

function QuickAction(props: { icon: string; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button class="qa" disabled={props.disabled} onClick={props.onClick}>
      <Icon name={props.icon} />
      <span>{props.label}</span>
    </button>
  );
}

function PlayTab(props: { onClose: () => void }) {
  const ui = uiSettings.value;
  const canResign = !game.result.value && game.length.value > 0;
  return (
    <>
      <Section title="Game">
        <div class="qa-grid">
          <QuickAction
            icon="plus"
            label="New game"
            onClick={() => {
              newGame(uiSettings.value.playAs);
              props.onClose();
            }}
          />
          <ConfirmButton
            class="qa"
            disabled={!canResign}
            label={
              <>
                <Icon name="flag" />
                <span>Resign</span>
              </>
            }
            armedLabel={
              <>
                <Icon name="flag" />
                <span>Tap again</span>
              </>
            }
            onConfirm={() => {
              resign();
              props.onClose();
            }}
          />
          <QuickAction
            icon="flip"
            label="Flip board"
            onClick={() => {
              flipBoard();
              props.onClose();
            }}
          />
          <QuickAction
            icon="edit"
            label="Edit position"
            onClick={() => {
              props.onClose();
              editorOpen.value = true;
            }}
          />
          <QuickAction icon="copy" label="Copy PGN" onClick={() => void copyPgn()} />
          <QuickAction icon="share" label="Share PGN" onClick={() => void sharePgn()} />
        </div>
        <Row label="Play as">
          <Segmented
            value={ui.playAs}
            options={[
              { value: 'white', label: 'White' },
              { value: 'black', label: 'Black' },
              { value: 'alternate', label: 'Alternate' },
              { value: 'random', label: 'Random' },
            ]}
            onChange={(v) => updateUi({ playAs: v })}
          />
        </Row>
        <p class="hint">New game above uses this colour; New in the bar asks each time.</p>
      </Section>
      <section class="section">
        <MatchHistory onResume={props.onClose} />
      </section>
    </>
  );
}

export function LabPanel(props: { tab: LabTab; onClose: () => void }) {
  switch (props.tab) {
    case 'play':
      return (
        <div class="settings">
          <PlayTab onClose={props.onClose} />
        </div>
      );
    case 'opponent':
      return (
        <div class="settings">
          <Section title="Opponent">
            <PersonaPicker />
            <EloSlider />
            <PersonaStyle />
          </Section>
          <PresetsSection />
          <ThinkingSection />
        </div>
      );
    case 'display':
      return (
        <div class="settings">
          <CoachSection />
          <ControlsSection />
          <BoardThemeSection />
          <FeelSection />
          <LayoutSection />
        </div>
      );
    case 'engine':
      return (
        <div class="settings">
          <PonderSection />
          <BookSection />
          <EngineSection />
          <ResetSection />
          <AboutSection />
        </div>
      );
  }
}
