// Position editor: free-edit chessground board + piece palette, Clear Board,
// Starting Position, side to move, castling, who you play, FEN import/export.
// "Start sparring" archives the current game and syncs the new start
// position to the game store and the engine worker in one step.

import { h } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { Key, Piece, Role } from '@lichess-org/chessground/types';
import { parseFen } from 'chessops/fen';
import { makeSquare } from 'chessops/util';
import { startFromPosition } from '../controller';
import { INITIAL_FEN, fenError, normalizeFen } from '../shared/chess';
import type { Side } from '../shared/protocol';
import { game } from '../state/game';
import { editorOpen, showToast } from '../state/ui';
import { orientation } from '../state/view';
import { keepBoundsFresh } from './cg-bounds';
import { Segmented } from './controls';

type Tool = 'hand' | 'trash' | `${Side}-${Role}`;

const ROLES: Role[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const EMPTY_BOARD = '8/8/8/8/8/8/8/8';
const START_BOARD = INITIAL_FEN.split(' ')[0];
/** A touch that slides further than this (px) is a drag, not a tap. */
const TAP_SLOP = 10;

const TOOL_HINT = {
  hand: 'Drag a piece to move it, or off the board to remove it.',
  trash: 'Tap a piece to remove it. Dragging still moves pieces.',
  piece: 'Tap a square to place it, tap again to remove. Dragging still moves pieces.',
};

interface Castling {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

function castlingFromFen(fen: string): Castling {
  const field = fen.split(' ')[2] ?? '-';
  return { K: field.includes('K'), Q: field.includes('Q'), k: field.includes('k'), q: field.includes('q') };
}

/** Which castling rights the piece placement allows at all. */
function castlingAllowed(board: string): Castling {
  const setup = parseFen(`${board} w - - 0 1`);
  if (setup.isErr) return { K: false, Q: false, k: false, q: false };
  const b = setup.value.board;
  const is = (sq: number, role: Role, color: Side) => {
    const p = b.get(sq);
    return !!p && p.role === role && p.color === color;
  };
  const wk = is(4, 'king', 'white');
  const bk = is(60, 'king', 'black');
  return { K: wk && is(7, 'rook', 'white'), Q: wk && is(0, 'rook', 'white'), k: bk && is(63, 'rook', 'black'), q: bk && is(56, 'rook', 'black') };
}

export function PositionEditor() {
  if (!editorOpen.value) return null;
  return <EditorModal />;
}

function EditorModal() {
  const initialFen = game.fenAt(game.cursor.value);
  const boardEl = useRef<HTMLDivElement>(null);
  const cgRef = useRef<Api | null>(null);
  const [tool, setTool] = useState<Tool>('hand');
  const toolRef = useRef<Tool>('hand');
  toolRef.current = tool;
  const [board, setBoard] = useState(initialFen.split(' ')[0]);
  const [turn, setTurn] = useState<Side>(initialFen.split(' ')[1] === 'b' ? 'black' : 'white');
  const [castling, setCastling] = useState<Castling>(castlingFromFen(initialFen));
  const [userSide, setUserSide] = useState<Side>(game.userSide.value);
  const [fenInput, setFenInput] = useState('');
  const [imported, setImported] = useState<string | null>(initialFen);

  const allowed = useMemo(() => castlingAllowed(board), [board]);
  const castlingField =
    (['K', 'Q', 'k', 'q'] as const).filter((c) => castling[c] && allowed[c]).join('') || '-';
  // Keep the imported FEN's en-passant / move counters while the board is untouched.
  const fen = useMemo(() => {
    const generated = `${board} ${turn === 'white' ? 'w' : 'b'} ${castlingField} - 0 1`;
    if (imported) {
      const parts = imported.split(' ');
      if (parts[0] === board && parts[1] === (turn === 'white' ? 'w' : 'b') && parts[2] === castlingField) return imported;
    }
    return generated;
  }, [board, turn, castlingField, imported]);
  const error = fenError(fen);

  const close = () => (editorOpen.value = false);

  useEffect(() => {
    const cg = Chessground(boardEl.current!, {
      fen: board,
      orientation: orientation.value,
      coordinates: true,
      animation: { enabled: true, duration: 120 },
      highlight: { lastMove: false, check: false },
      movable: { free: true, color: 'both', showDests: false },
      premovable: { enabled: false },
      draggable: { enabled: true, showGhost: true, deleteOnDropOff: true },
      selectable: { enabled: false },
      drawable: { enabled: false, visible: false },
      blockTouchScroll: true,
      disableContextMenu: true,
      events: { change: () => setBoard(cg.getFen()) },
    });
    cgRef.current = cg;
    const unbindBounds = keepBoundsFresh(boardEl.current!.parentElement!, () => cgRef.current);
    return () => {
      unbindBounds();
      cg.destroy();
      cgRef.current = null;
    };
  }, []);

  // Board pieces are always draggable (chessground): drop on a square to move,
  // drop off the board to remove. With a piece or the eraser picked, a tap -
  // finger down and up on the same square without sliding - places or removes
  // one piece. A slide never paints, and never stops the drag.
  useEffect(() => {
    const node = boardEl.current!;
    let tap: { id: number; x: number; y: number; key: Key } | null = null;
    const squareAt = (x: number, y: number): Key | null => {
      const r = node.getBoundingClientRect();
      const fx = Math.floor(((x - r.left) / r.width) * 8);
      const fy = Math.floor(((y - r.top) / r.height) * 8);
      if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
      const white = orientation.value === 'white';
      return makeSquare((white ? 7 - fy : fy) * 8 + (white ? fx : 7 - fx)) as Key;
    };
    const place = (key: Key) => {
      const cg = cgRef.current!;
      const t = toolRef.current;
      const current = cg.state.pieces.get(key);
      let next: Piece | undefined;
      if (t !== 'trash') {
        const [color, role] = t.split('-') as [Side, Role];
        // Tapping the same piece again takes it off.
        const same = current && current.color === color && current.role === role;
        next = same ? undefined : { color, role };
      }
      cg.setPieces(new Map([[key, next]]));
      setBoard(cg.getFen());
    };
    const onDown = (e: PointerEvent) => {
      tap = null;
      if (!e.isPrimary || toolRef.current === 'hand') return;
      const key = squareAt(e.clientX, e.clientY);
      if (key) tap = { id: e.pointerId, x: e.clientX, y: e.clientY, key };
    };
    const onMove = (e: PointerEvent) => {
      if (tap && e.pointerId === tap.id && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) tap = null;
    };
    const onUp = (e: PointerEvent) => {
      if (!tap || e.pointerId !== tap.id) return;
      const { key } = tap;
      tap = null;
      if (squareAt(e.clientX, e.clientY) === key) place(key);
    };
    const onCancel = () => (tap = null);
    const opts: AddEventListenerOptions = { passive: true };
    node.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    window.addEventListener('pointermove', onMove, opts);
    window.addEventListener('pointerup', onUp, opts);
    window.addEventListener('pointercancel', onCancel, opts);
    return () => {
      node.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove, opts);
      window.removeEventListener('pointerup', onUp, opts);
      window.removeEventListener('pointercancel', onCancel, opts);
    };
  }, []);

  const setBoardTo = (placement: string) => {
    cgRef.current?.set({ fen: placement });
    setBoard(placement);
  };

  const loadFen = (text: string) => {
    const norm = normalizeFen(text);
    if (!norm) {
      showToast(fenError(text) ?? 'Invalid FEN', 2200);
      return;
    }
    setBoardTo(norm.split(' ')[0]);
    setTurn(norm.split(' ')[1] === 'b' ? 'black' : 'white');
    setCastling(castlingFromFen(norm));
    setImported(norm);
    setFenInput('');
    showToast('FEN loaded');
  };

  const paletteDown = (e: PointerEvent, color: Side, role: Role) => {
    setTool(`${color}-${role}`);
    // Also allow dragging straight from the palette onto the board (the drop
    // square is computed from the board's rectangle: measure it fresh).
    cgRef.current?.state.dom.bounds.clear();
    cgRef.current?.dragNewPiece({ color, role }, e as unknown as MouseEvent, true);
  };

  const start = () => {
    const norm = normalizeFen(fen);
    if (!norm) return;
    startFromPosition(norm, userSide);
    close();
  };

  // Each palette sits on the side its pieces are shown on.
  const bottomColour: Side = orientation.value;
  const topColour: Side = bottomColour === 'white' ? 'black' : 'white';
  const palette = (colour: Side) => (
    <div class="cg-wrap palette" aria-label={`${colour} pieces`}>
      {ROLES.map((role) => (
        <button
          key={role}
          class={`pal ${tool === `${colour}-${role}` ? 'on' : ''}`}
          aria-label={`${colour} ${role}`}
          onPointerDown={(e) => paletteDown(e as unknown as PointerEvent, colour, role)}
        >
          {h('piece', { class: `${role} ${colour}` })}
        </button>
      ))}
    </div>
  );

  return (
    <div class="editor-wrap" role="dialog" aria-label="Edit position">
      <div class="editor glass">
        <header class="editor-head">
          <button class="link" onClick={close}>
            Cancel
          </button>
          <strong>Edit Position</strong>
          <button class="link strong" disabled={!!error} onClick={start}>
            Start
          </button>
        </header>

        <div class="editor-body">
          {palette(topColour)}

          <div class="editor-board">
            <div ref={boardEl} class="cg-wrap board" />
          </div>

          {palette(bottomColour)}

          <div class="editor-tools">
            <button class={`tool ${tool === 'hand' ? 'on' : ''}`} onClick={() => setTool('hand')}>
              ✋ Move
            </button>
            <button class={`tool ${tool === 'trash' ? 'on' : ''}`} onClick={() => setTool('trash')}>
              ⌫ Erase
            </button>
            <button class="tool" onClick={() => setBoardTo(EMPTY_BOARD)}>
              Clear Board
            </button>
            <button
              class="tool"
              onClick={() => {
                setBoardTo(START_BOARD);
                setTurn('white');
                setCastling({ K: true, Q: true, k: true, q: true });
              }}
            >
              Starting Position
            </button>
          </div>
          <p class="hint">{TOOL_HINT[tool === 'hand' || tool === 'trash' ? tool : 'piece']}</p>

          <div class="editor-row">
            <span class="row-label">To move</span>
            <Segmented
              value={turn}
              options={[
                { value: 'white', label: 'White' },
                { value: 'black', label: 'Black' },
              ]}
              onChange={setTurn}
            />
          </div>
          <div class="editor-row">
            <span class="row-label">You play</span>
            <Segmented
              value={userSide}
              options={[
                { value: 'white', label: 'White' },
                { value: 'black', label: 'Black' },
              ]}
              onChange={setUserSide}
            />
          </div>
          <div class="editor-row">
            <span class="row-label">Castling</span>
            <div class="castle-toggles">
              {(['K', 'Q', 'k', 'q'] as const).map((c) => (
                <button
                  key={c}
                  class={`castle ${castling[c] && allowed[c] ? 'on' : ''}`}
                  disabled={!allowed[c]}
                  onClick={() => setCastling({ ...castling, [c]: !castling[c] })}
                >
                  {c === 'K' ? 'W O-O' : c === 'Q' ? 'W O-O-O' : c === 'k' ? 'B O-O' : 'B O-O-O'}
                </button>
              ))}
            </div>
          </div>

          <div class="fen-box">
            <div class="fen-current">
              <code>{fen}</code>
              <button
                class="btn small"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fen);
                    showToast('FEN copied');
                  } catch {
                    showToast('Copy failed');
                  }
                }}
              >
                Copy
              </button>
            </div>
            <div class="fen-import">
              <input
                type="text"
                inputMode="text"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                placeholder="Paste a FEN…"
                value={fenInput}
                onInput={(e) => setFenInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && loadFen(fenInput)}
              />
              <button class="btn small" disabled={!fenInput.trim()} onClick={() => loadFen(fenInput)}>
                Load
              </button>
            </div>
            {error && <p class="editor-error">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
