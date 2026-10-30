// Match history (archived games): resume, share PGN, delete. Used by the
// SmallFish shelf and the Classic Lab panel.

import { useState } from 'preact/hooks';
import { resumeArchived, saveCurrentGame, sharePgn } from '../controller';
import { PROFILES } from '../personas/meta';
import { archive, removeArchived, type ArchivedGame } from '../state/archive';
import { game } from '../state/game';
import { uiSettings, updateUi } from '../state/settings';
import { showToast } from '../state/ui';
import { Toggle } from './controls';

const RESULT_LABEL: Record<string, string> = { '1-0': '1–0', '0-1': '0–1', '1/2-1/2': '½–½', '*': '…' };

function outcome(g: ArchivedGame): string {
  if (g.result === '*') return 'unfinished';
  if (g.result === '1/2-1/2') return 'draw';
  const userWon = (g.result === '1-0') === (g.userSide === 'white');
  return userWon ? 'won' : 'lost';
}

function HistoryItem(props: { g: ArchivedGame; open: boolean; onToggle: () => void; onResume: () => void }) {
  const { g } = props;
  const p = PROFILES[g.persona];
  const date = new Date(g.savedAt);
  const when =
    date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return (
    <li class={`hist-item ${props.open ? 'open' : ''}`}>
      <button class="hist-row" onClick={props.onToggle}>
        <span class="hist-avatar">{p.avatar}</span>
        <span class="hist-main">
          <span class="hist-title">
            {p.name} · {g.elo >= 3000 ? 'full' : g.elo}
          </span>
          <span class="hist-sub">
            You {g.userSide === 'white' ? 'White' : 'Black'} · {Math.ceil(g.plies / 2)} moves · {when}
          </span>
        </span>
        <span class={`hist-result ${outcome(g)}`}>{RESULT_LABEL[g.result]}</span>
      </button>
      {props.open && (
        <div class="hist-actions">
          <button
            class="btn small"
            onClick={() => {
              resumeArchived(g);
              props.onResume();
            }}
          >
            Resume
          </button>
          <button class="btn small" onClick={() => void sharePgn(g.pgn)}>
            Share PGN
          </button>
          <button
            class="btn small danger"
            onClick={() => {
              removeArchived(g.id);
              showToast('Removed from history');
            }}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Collapsed to a single row by default ("Match history · 12 saved ▸"); tap it
 * to see the games, the auto-save switch and "Save current game".
 */
export function MatchHistory(props: { onResume: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const history = archive.value;
  const autoArchive = uiSettings.value.autoArchive;
  return (
    <div class={`hist ${expanded ? 'expanded' : ''}`}>
      <button class="hist-head" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <span>Match history</span>
        <span class="muted">
          {history.length ? `${history.length} saved` : 'empty'}
          {!autoArchive && ' · auto-save off'}
        </span>
        <svg class="hist-chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {expanded && (
        <div class="hist-body">
          <Toggle
            label="Auto-save games"
            hint="Save the previous game here whenever a new one starts"
            checked={autoArchive}
            onChange={(v) => updateUi({ autoArchive: v })}
          />
          <button class="btn small hist-save" disabled={game.length.value === 0} onClick={saveCurrentGame}>
            Save current game now
          </button>
          {history.length ? (
            <ul class="hist-list">
              {history.map((g) => (
                <HistoryItem
                  key={g.id}
                  g={g}
                  open={openId === g.id}
                  onToggle={() => setOpenId(openId === g.id ? null : g.id)}
                  onResume={props.onResume}
                />
              ))}
            </ul>
          ) : (
            <p class="hint">No saved games yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
