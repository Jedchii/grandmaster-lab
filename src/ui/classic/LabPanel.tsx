// Classic layout: the "Lab" panel inside the bottom sheet. The original
// opponent / thinking / pondering / book / engine / feel settings, plus the
// newer tools: Instamove, Edit Position, PGN and the match history.

import { copyPgn, newGame, resign, sharePgn } from '../../controller';
import { game } from '../../state/game';
import { uiSettings, updateUi } from '../../state/settings';
import { editorOpen } from '../../state/ui';
import { Row, Section, Segmented } from '../controls';
import { MatchHistory } from '../History';
import { EloSlider, PersonaPicker } from '../PersonaPicker';
import {
  AboutSection,
  BoardThemeSection,
  BookSection,
  CoachSection,
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

export function LabPanel(props: { onClose: () => void }) {
  const ui = uiSettings.value;
  return (
    <div class="settings">
      <LayoutSection />
      <Section title="Opponent">
        <PersonaPicker />
        <EloSlider />
        <PersonaStyle />
      </Section>

      <Section title="Game">
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
        <div class="btn-row">
          <button
            class="btn primary"
            onClick={() => {
              newGame(uiSettings.value.playAs);
              props.onClose();
            }}
          >
            Start new game
          </button>
          <button
            class="btn danger"
            disabled={!!game.result.value || game.length.value === 0}
            onClick={() => {
              resign();
              props.onClose();
            }}
          >
            Resign
          </button>
        </div>
        <div class="btn-row three">
          <button
            class="btn"
            onClick={() => {
              props.onClose();
              editorOpen.value = true;
            }}
          >
            Edit position
          </button>
          <button class="btn" onClick={() => void copyPgn()}>
            Copy PGN
          </button>
          <button class="btn" onClick={() => void sharePgn()}>
            Share PGN
          </button>
        </div>
      </Section>

      <CoachSection />
      <ControlsSection />
      <PresetsSection />
      <ThinkingSection />
      <BoardThemeSection />
      <FeelSection />

      <section class="section">
        <MatchHistory onResume={props.onClose} />
      </section>

      <PonderSection />
      <BookSection />
      <EngineSection />
      <ResetSection />
      <AboutSection />
    </div>
  );
}
