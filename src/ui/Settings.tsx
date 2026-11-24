// Settings sections, shared by both layouts:
// * SmallFish: the Options sheet (persona / Elo / Instamove / New Game live
//   in the shelf).
// * Classic: the Lab panel in the bottom sheet (see classic/LabPanel.tsx).

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { engine } from '../controller';
import { unlockAudio } from '../feedback/sound';
import { PROFILES } from '../personas/meta';
import { BOOK_NAME } from '../shared/protocol';
import {
  BUILT_IN_PRESETS,
  activePresetId,
  applyPreset,
  deletePreset,
  savePreset,
  userPresets,
  type EnginePreset,
} from '../state/presets';
import {
  engineSettings,
  resetEngineSettings,
  resetUiSettings,
  uiSettings,
  updateEngine,
  updateUi,
} from '../state/settings';
import { closePanels, showToast } from '../state/ui';
import { Row, Section, Segmented, Slider, Toggle } from './controls';
import { THEME_ORDER, themeColours } from './themes';
import { AppStatus } from './UpdateToast';

const kNodes = (k: number) => (k === 0 ? 'Off' : k >= 1000 ? `${(k / 1000).toFixed(1)}M nodes` : `${k}k nodes`);

export function LayoutSection() {
  const layout = uiSettings.value.layout;
  return (
    <Section title="Layout">
      <Segmented
        value={layout}
        options={[
          { value: 'classic', label: 'Classic' },
          { value: 'smallfish', label: 'SmallFish' },
        ]}
        onChange={(v) => {
          closePanels();
          updateUi({ layout: v });
        }}
      />
      <p class="hint">
        {layout === 'classic'
          ? 'Persona card, your colour at the bottom, controls in the pull-up sheet.'
          : 'Tap the header for the game menu, dock at the bottom; you always play from the top of the board.'}
      </p>
    </Section>
  );
}

export function CoachSection() {
  const ui = uiSettings.value;
  return (
    <Section title="Coach">
      <Toggle
        label="Move suggestions"
        hint="On your turn, up to 3 green arrows for your best moves. The brighter the arrow, the better the move."
        checked={ui.suggestArrows}
        onChange={(v) => updateUi({ suggestArrows: v })}
      />
    </Section>
  );
}

const STEP_HINT = {
  smart: 'Undo goes back to your previous turn (1 or 2 moves); redo replays your move and the reply.',
  one: 'Exactly one move each time. On the engine’s turn it waits until you redo, play on, or press Move.',
  two: 'Two moves each time: your move and the engine’s reply.',
} as const;

/** Undo / redo step for every layout; swipe zone and header lock (SmallFish); compact card (Classic). */
export function ControlsSection() {
  const ui = uiSettings.value;
  const smallfish = ui.layout === 'smallfish';
  return (
    <Section title="Undo, redo & gestures">
      <Row label="Undo / redo step">
        <Segmented
          value={ui.undoStep}
          options={[
            { value: 'smart', label: 'To your turn' },
            { value: 'one', label: '1 move' },
            { value: 'two', label: '2 moves' },
          ]}
          onChange={(v) => updateUi({ undoStep: v })}
        />
      </Row>
      <p class="hint">{STEP_HINT[ui.undoStep]}</p>
      {smallfish ? (
        <>
          <Row label="Swipe to undo / redo">
            <Segmented
              value={ui.swipeZone}
              options={[
                { value: 'board', label: 'Board' },
                { value: 'bottom', label: 'Bottom' },
                { value: 'both', label: 'Both' },
              ]}
              onChange={(v) => updateUi({ swipeZone: v })}
            />
          </Row>
          <p class="hint">
            Swipe right to undo, left to redo: on the board, on the player bar and moves below it, or on both.
          </p>
          <Row label="Header menu">
            <Segmented
              value={ui.headerLock ? 'lock' : 'none'}
              options={[
                { value: 'none', label: 'No lock' },
                { value: 'lock', label: 'Lock button' },
              ]}
              onChange={(v) => updateUi({ headerLock: v === 'lock', headerLocked: true })}
            />
          </Row>
          <p class="hint">
            {ui.headerLock
              ? 'Tap the clock pill at the top right (🔒) to lock or unlock. While locked, tapping the header does nothing; Game in the dock still opens the menu.'
              : 'Tapping anywhere on the header opens the game menu.'}
          </p>
        </>
      ) : (
        <>
          <Toggle
            label="Compact opponent card"
            hint="One slim line instead of the full card, so the board sits higher. You can also tap the card."
            checked={ui.compactCard}
            onChange={(v) => updateUi({ compactCard: v })}
          />
          <Row label="Bottom bar for">
            <Segmented
              value={ui.handedness}
              options={[
                { value: 'right', label: 'Right thumb' },
                { value: 'left', label: 'Left thumb' },
              ]}
              onChange={(v) => updateUi({ handedness: v })}
            />
          </Row>
          <p class="hint">
            {ui.handedness === 'right'
              ? 'Back and Next sit on the left, Lab on the right.'
              : 'Mirrored: Lab on the left, Back and Next on the right.'}
          </p>
        </>
      )}
    </Section>
  );
}

export function PresetsSection() {
  const [name, setName] = useState('');
  const active = activePresetId.value;
  const chip = (p: EnginePreset) => (
    <div key={p.id} class={`preset ${active === p.id ? 'on' : ''}`}>
      <button
        class="preset-apply"
        aria-pressed={active === p.id}
        onClick={() => {
          applyPreset(p);
          showToast(`Preset: ${p.name}`);
        }}
      >
        {p.name}
      </button>
      {!p.builtIn && (
        <button
          class="preset-del"
          aria-label={`Delete preset ${p.name}`}
          onClick={() => {
            deletePreset(p.id);
            showToast('Preset deleted');
          }}
        >
          ×
        </button>
      )}
    </div>
  );
  return (
    <Section
      title="Engine presets"
      hint="Opponent, Elo, style, think time, pondering and book in one tap. Threads and hash stay as they are."
    >
      <div class="preset-list">
        {BUILT_IN_PRESETS.map(chip)}
        {userPresets.value.map(chip)}
      </div>
      <form
        class="preset-save"
        onSubmit={(e) => {
          e.preventDefault();
          const saved = savePreset(name);
          if (saved) {
            setName('');
            (document.activeElement as HTMLElement | null)?.blur();
            showToast(`Saved preset “${saved.name}”`);
          }
        }}
      >
        <input
          type="text"
          placeholder="Save current setup as…"
          maxLength={40}
          autocomplete="off"
          autocapitalize="sentences"
          spellcheck={false}
          enterKeyHint="done"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button class="btn small" type="submit" disabled={!name.trim()}>
          Save
        </button>
      </form>
    </Section>
  );
}

export function BoardThemeSection() {
  const { boardTheme, layout } = uiSettings.value;
  return (
    <Section title="Board colours">
      <div class="theme-grid" role="radiogroup">
        {THEME_ORDER.map((t) => {
          const c = themeColours(t, layout);
          return (
            <button
              key={t}
              role="radio"
              aria-checked={boardTheme === t}
              class={`theme ${boardTheme === t ? 'on' : ''}`}
              onClick={() => updateUi({ boardTheme: t })}
            >
              <span class="theme-swatch" style={{ '--l': c.light, '--d': c.dark }} />
              <span class="theme-name">{t === 'auto' ? 'Auto' : c.label}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** Two-step button: the first tap arms it, the second (within 2.5 s) acts. */
export function ConfirmButton(props: {
  label: ComponentChildren;
  armedLabel?: ComponentChildren;
  class?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2500);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => {
    if (props.disabled) setArmed(false);
  }, [props.disabled]);
  return (
    <button
      class={`${props.class ?? 'btn'} ${armed ? 'danger armed' : ''}`}
      disabled={props.disabled}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        props.onConfirm();
      }}
    >
      {armed ? (props.armedLabel ?? 'Tap again to reset') : props.label}
    </button>
  );
}

export function ResetSection() {
  return (
    <Section title="Saved settings" hint="Every change is saved on this device automatically and restored next time.">
      <div class="reset-row">
        <ConfirmButton
          label="Reset engine"
          onConfirm={() => {
            resetEngineSettings();
            showToast('Engine settings back to defaults');
          }}
        />
        <ConfirmButton
          label="Reset display"
          onConfirm={() => {
            resetUiSettings();
            showToast('Display settings back to defaults');
          }}
        />
      </div>
    </Section>
  );
}

/** Persona-specific playing style (Patricia style, DrawFish mode). */
export function PersonaStyle() {
  const s = engineSettings.value;
  return (
    <>
      {s.persona === 'patricia' && (
        <>
          <Row label="Playstyle">
            <Segmented
              value={s.patriciaStyle}
              options={[
                { value: 'classic', label: 'Classic' },
                { value: 'aggressive', label: 'Hyper-Aggressive' },
                { value: 'positional', label: 'Positional' },
                { value: 'solid', label: 'Solid' },
              ]}
              onChange={(v) => updateEngine({ patriciaStyle: v })}
            />
          </Row>
          <p class="hint">
            {s.patriciaStyle === 'classic' &&
              'Stock Patricia 5.1, exactly as Adam Kulju tuned her. Already the most aggressive engine around.'}
            {s.patriciaStyle === 'aggressive' &&
              'Sacrifices, king hunts and initiative. Patricia’s sacrifice net and bonuses turned up.'}
            {s.patriciaStyle === 'positional' &&
              'Space, pawn structure and quiet pressure. Sacrifice bonuses off, structure terms on.'}
            {s.patriciaStyle === 'solid' &&
              'Counter-punching defence: king shelter first, happy to simplify, waits for your mistakes.'}
          </p>
        </>
      )}
      {s.persona === 'drawfish' && (
        <>
          <Row label="Draw hunting">
            <Segmented
              value={s.drawfishMode}
              options={[
                { value: 'subtle', label: 'Subtle troll' },
                { value: 'relentless', label: 'Relentless' },
              ]}
              onChange={(v) => updateEngine({ drawfishMode: v })}
            />
          </Row>
          <p class="hint">
            Hunts threefold repetitions, perpetual checks, even trades, opposite-bishop fortresses and stalemate tricks.
          </p>
          <Row label="Defence">
            <Segmented
              value={s.drawfishDefense}
              options={[
                { value: 'max', label: 'Max defence' },
                { value: 'original', label: 'Original' },
              ]}
              onChange={(v) => updateEngine({ drawfishDefense: v })}
            />
          </Row>
          <p class="hint">
            {s.drawfishDefense === 'max'
              ? 'Always thinks at full depth and fights a worse position back to a draw. The Elo slider doesn’t weaken him.'
              : 'The first DrawFish: the Elo slider limits how deep he thinks, so a worse position can slip away and he can lose.'}
          </p>
        </>
      )}
      {s.persona === 'stockfish' && (
        <p class="hint">Stockfish 19 lite NNUE. Below 1320 Elo it adds depth limits and controlled slips.</p>
      )}
    </>
  );
}

export function ThinkingSection() {
  const s = engineSettings.value;
  return (
    <Section title="Thinking">
      <Toggle
        label="Instamove"
        hint={s.instamove ? 'Replies in < 50 ms, still Elo-scaled' : 'Realistic think time'}
        checked={s.instamove}
        onChange={(v) => updateEngine({ instamove: v })}
      />
      <Toggle
        label="Ponder during Instamove"
        hint={
          s.instamove
            ? 'Keeps thinking on your time; when you play the expected move the reply is still instant, from a deeper search'
            : 'Only matters while Instamove is on'
        }
        checked={s.ponderInstamove}
        onChange={(v) => updateEngine({ ponderInstamove: v })}
      />
      <Slider
        label="Think time per move"
        min={300}
        max={6000}
        step={100}
        value={s.thinkMs}
        format={(v) => `${(v / 1000).toFixed(1)} s`}
        onCommit={(v) => updateEngine({ thinkMs: v })}
      />
      <Toggle
        label="Human pacing"
        hint="Short natural pauses before Patricia and DrawFish move"
        checked={s.humanPacing}
        onChange={(v) => updateEngine({ humanPacing: v })}
      />
    </Section>
  );
}

export function PonderSection() {
  const s = engineSettings.value;
  return (
    <Section title="Pondering" hint="Thinks on your time. Caps pause the search so the phone stays cool.">
      <Toggle
        label="Ponder on your move"
        checked={s.ponder.enabled}
        onChange={(v) => updateEngine({ ponder: { ...s.ponder, enabled: v } })}
      />
      {s.ponder.enabled && (
        <>
          <Slider
            label="Max ponder depth"
            min={8}
            max={24}
            step={1}
            value={s.ponder.maxDepth}
            format={(v) => `depth ${v}`}
            onCommit={(v) => updateEngine({ ponder: { ...s.ponder, maxDepth: v } })}
          />
          <Slider
            label="Max ponder nodes"
            min={0}
            max={5000}
            step={250}
            value={s.ponder.maxKNodes}
            format={kNodes}
            onCommit={(v) => updateEngine({ ponder: { ...s.ponder, maxKNodes: v } })}
          />
        </>
      )}
    </Section>
  );
}

export function BookSection() {
  const s = engineSettings.value;
  return (
    <Section
      title="Opening book"
      hint={`${BOOK_NAME}: Komodo, Codekiddy, Perfect 2021 and GM 2001 merged into one book. Answers instantly, before any search starts.`}
    >
      <Toggle
        label={`Use ${BOOK_NAME}`}
        checked={s.book.enabled}
        onChange={(v) => updateEngine({ book: { ...s.book, enabled: v } })}
      />
      {s.book.enabled && (
        <>
          <Slider
            label="Book depth"
            min={2}
            max={40}
            step={1}
            value={s.book.maxPly}
            format={(v) => `${v} plies`}
            onCommit={(v) => updateEngine({ book: { ...s.book, maxPly: v } })}
          />
        </>
      )}
    </Section>
  );
}

export function EngineSection() {
  const s = engineSettings.value;
  const identity = engine.identity.value;
  const threadedAvailable = identity?.threaded ?? false;
  return (
    <Section title="Engine">
      {threadedAvailable && (
        <Row label="Threads">
          <Segmented
            value={s.threads}
            options={[
              { value: 1, label: '1 · cool' },
              { value: 2, label: '2' },
              { value: 3, label: '3 · max' },
            ]}
            onChange={(v) => updateEngine({ threads: v })}
          />
        </Row>
      )}
      <Row label="Hash table">
        <Segmented
          value={s.hashMb}
          options={[
            { value: 16, label: '16 MB' },
            { value: 32, label: '32 MB' },
            { value: 64, label: '64 MB' },
          ]}
          onChange={(v) => updateEngine({ hashMb: v })}
        />
      </Row>
      <p class="hint mono">
        {identity
          ? `${identity.name} · ${identity.threaded ? 'multi-threaded (SharedArrayBuffer)' : 'single-threaded'} · loaded in ${identity.loadMs} ms`
          : 'Loading engine…'}
        {typeof self !== 'undefined' && !self.crossOriginIsolated && ' · page not cross-origin isolated'}
      </p>
    </Section>
  );
}

export function FeelSection() {
  const s = engineSettings.value;
  const ui = uiSettings.value;
  return (
    <Section title="Display & feel">
      <Toggle
        label="Sound"
        checked={ui.sound}
        onChange={(v) => {
          updateUi({ sound: v });
          if (v) unlockAudio(); // inside the tap, so iOS lets audio start
        }}
      />
      <Toggle
        label="Speech bubbles"
        hint="The opponent comments on the game"
        checked={ui.bubbles}
        onChange={(v) => updateUi({ bubbles: v })}
      />
      <Toggle
        label="Haptics"
        hint="Your moves, captures, checks and swipes"
        checked={ui.haptics}
        onChange={(v) => updateUi({ haptics: v })}
      />
      <Toggle label="Eval bar" checked={ui.showEval} onChange={(v) => updateUi({ showEval: v })} />
      <Toggle
        label="Engine arrows"
        hint="Candidate moves drawn on the board while the engine thinks"
        checked={ui.showArrows}
        onChange={(v) => updateUi({ showArrows: v })}
      />
      <Toggle
        label="Engine lines"
        hint="The opponent’s principal variations (spoilers!)"
        checked={ui.showLines}
        onChange={(v) => updateUi({ showLines: v })}
      />
      {ui.showLines && (
        <Row label="Lines">
          <Segmented
            value={s.analysisLines}
            options={[
              { value: 1, label: '1' },
              { value: 2, label: '2' },
              { value: 3, label: '3' },
            ]}
            onChange={(v) => updateEngine({ analysisLines: v })}
          />
        </Row>
      )}
      <Toggle label="Coordinates" checked={ui.coordinates} onChange={(v) => updateUi({ coordinates: v })} />
    </Section>
  );
}

export function AboutSection() {
  return (
    <Section title="About">
      <AppStatus />
      <p class="hint">
        Grandmaster Lab runs fully offline. Swipe right on the board to undo, left to redo. Patricia 5.1 by Adam Kulju
        (MIT) compiled to WebAssembly; Stockfish 19 via stockfish.js (GPLv3); DrawFish logic after Trollfish. Board by
        Lichess chessground, opening names from lichess-org/chess-openings (CC0).
      </p>
    </Section>
  );
}

/** SmallFish Options sheet content. */
export function Settings() {
  const persona = PROFILES[engineSettings.value.persona];
  return (
    <div class="settings">
      <LayoutSection />
      <CoachSection />
      <ControlsSection />
      <PresetsSection />
      <Section title={`${persona.name} style`}>
        <PersonaStyle />
      </Section>
      <ThinkingSection />
      <BoardThemeSection />
      <FeelSection />
      <PonderSection />
      <BookSection />
      <EngineSection />
      <ResetSection />
      <AboutSection />
    </div>
  );
}
