// Board: chessground (Lichess's touch-tuned board) driven by game signals.
//
// * Orientation comes from state/view.ts: SmallFish locks the BPHH rule (the
//   human always plays from the top, pushing down); Classic puts your colour
//   at the bottom and can be flipped. chessground maps touches through the
//   same orientation, so drag and tap targets stay exact either way.
// * chessground's cached board rectangle is refreshed on every touch
//   (see cg-bounds.ts) - the board moves with CSS transforms.
// * Swipes: right = undo, left = redo. A gesture that starts on your own
//   movable piece (or on a legal destination of the selected piece) is always
//   a piece move - so a horizontal rook drag is never mistaken for a swipe.
//   Anything else becomes a swipe once it travels > 40 px, mostly sideways.
// * Arrows: the hint; else your best moves on your turn (suggestion arrows,
//   brighter = better); else the engine's top candidates while it thinks.

import { useSignalEffect } from '@preact/signals';
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawBrushes, DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { chessgroundDests } from 'chessops/compat';
import { makeSquare, parseSquare } from 'chessops/util';
import { engine, hintArrow, suggestions, swipeStep, userMove } from '../controller';
import { unlockAudio } from '../feedback/sound';
import { lineKey, type Side } from '../shared/protocol';
import { game } from '../state/game';
import { uiSettings } from '../state/settings';
import { shelfOpen } from '../state/ui';
import { orientation } from '../state/view';
import { keepBoundsFresh } from './cg-bounds';
import { attachSwipe } from './swipe';

interface Promotion {
  orig: Key;
  dest: Key;
  color: Side;
}

const PROMO_ROLES = ['queen', 'knight', 'rook', 'bishop'] as const;
const PROMO_CHAR: Record<(typeof PROMO_ROLES)[number], string> = { queen: 'q', knight: 'n', rook: 'r', bishop: 'b' };

const BRUSHES: DrawBrushes = {
  // chessground's defaults (required by the type), plus ours.
  green: { key: 'g', color: '#15781B', opacity: 1, lineWidth: 10 },
  red: { key: 'r', color: '#882020', opacity: 1, lineWidth: 10 },
  blue: { key: 'b', color: '#003088', opacity: 1, lineWidth: 10 },
  yellow: { key: 'y', color: '#e68f00', opacity: 1, lineWidth: 10 },
  engine1: { key: 'e1', color: '#3d5afe', opacity: 0.92, lineWidth: 12 },
  engine2: { key: 'e2', color: '#3d5afe', opacity: 0.55, lineWidth: 10 },
  engine3: { key: 'e3', color: '#3d5afe', opacity: 0.32, lineWidth: 9 },
  hint: { key: 'hi', color: '#17c47a', opacity: 0.95, lineWidth: 13 },
};

// chessground brushes carry the opacity, so suggestions use one brush per step.
const SUGGEST_STEPS = [0.18, 0.26, 0.35, 0.45, 0.56, 0.68, 0.8, 0.95];
SUGGEST_STEPS.forEach((opacity, i) => {
  BRUSHES[`sug${i}`] = { key: `s${i}`, color: '#1fbf6a', opacity, lineWidth: 12 };
});
function suggestBrush(opacity: number): string {
  let best = 0;
  SUGGEST_STEPS.forEach((step, i) => {
    if (Math.abs(step - opacity) < Math.abs(SUGGEST_STEPS[best] - opacity)) best = i;
  });
  return `sug${best}`;
}

export function Board() {
  const shell = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [promo, setPromo] = useState<Promotion | null>(null);
  const promoRef = useRef<Promotion | null>(null);
  promoRef.current = promo;

  // Pushes the active position into chessground.
  const resync = () => {
    const cg = api.current;
    if (!cg) return;
    const ply = game.cursor.value;
    const line = game.line.value;
    const pos = game.positionAt(ply);
    const userSide = game.userSide.value;
    const canMove = game.userTurn.value && !promoRef.current;
    const last = ply > 0 ? line[ply - 1] : null;
    cg.set({
      fen: game.fenAt(ply),
      orientation: orientation.value,
      turnColor: pos.turn,
      check: pos.isCheck(),
      lastMove: last ? [last.uci.slice(0, 2) as Key, last.uci.slice(2, 4) as Key] : undefined,
      coordinates: uiSettings.value.coordinates,
      movable: {
        color: canMove ? userSide : undefined,
        dests: canMove ? (chessgroundDests(pos) as Map<Key, Key[]>) : new Map(),
      },
    });
  };

  useEffect(() => {
    const cg = Chessground(el.current!, {
      orientation: orientation.value,
      coordinates: true,
      animation: { enabled: true, duration: 170 },
      highlight: { lastMove: true, check: true },
      movable: {
        free: false,
        showDests: true,
        rookCastle: true,
        events: {
          after: (orig, dest) => {
            const pos = game.positionAt(game.cursor.value);
            const from = parseSquare(orig);
            const piece = from === undefined ? undefined : pos.board.get(from);
            if (piece?.role === 'pawn' && (dest[1] === '8' || dest[1] === '1')) {
              setPromo({ orig, dest, color: piece.color });
              return;
            }
            if (!userMove(orig + dest)) resync();
          },
        },
      },
      premovable: { enabled: false },
      draggable: { enabled: true, distance: 3, autoDistance: true, showGhost: true, deleteOnDropOff: false },
      selectable: { enabled: true },
      drawable: { enabled: false, visible: true, defaultSnapToValidMove: false, brushes: BRUSHES },
      blockTouchScroll: true,
      disableContextMenu: true,
      touchIgnoreRadius: 1,
    });
    api.current = cg;
    if (import.meta.env.DEV) Object.assign(window, { __cg: cg });
    resync();
    const unbindBounds = keepBoundsFresh(shell.current!, () => api.current);
    return () => {
      unbindBounds();
      cg.destroy();
      api.current = null;
    };
  }, []);

  useSignalEffect(() => {
    void game.cursor.value;
    void game.line.value;
    void game.userSide.value;
    void game.resigned.value;
    void orientation.value;
    void uiSettings.value.coordinates;
    resync();
  });

  // Hint, suggestion and candidate-move arrows.
  useSignalEffect(() => {
    const cg = api.current;
    if (!cg) return;
    const current = lineKey(game.moves.value);
    const hint = hintArrow.value;
    const suggested = suggestions.value;
    const shapes: DrawShape[] = [];
    if (hint && hint.line === current) {
      shapes.push({ orig: hint.uci.slice(0, 2) as Key, dest: hint.uci.slice(2, 4) as Key, brush: 'hint' });
    } else if (
      suggested &&
      suggested.line === current &&
      suggested.gameId === game.gameId.value &&
      uiSettings.value.suggestArrows &&
      game.userTurn.value
    ) {
      for (const a of suggested.arrows) {
        shapes.push({ orig: a.uci.slice(0, 2) as Key, dest: a.uci.slice(2, 4) as Key, brush: suggestBrush(a.opacity) });
      }
    } else if (uiSettings.value.showArrows) {
      const info = engine.info.value;
      const thinking = engine.state.value === 'thinking';
      if (info && thinking && info.mode === 'move' && info.line === current && game.turn.value === game.engineSide.value) {
        const seen = new Set<string>();
        for (const l of info.lines) {
          const uci = l.uci[0];
          if (!uci || seen.has(uci) || seen.size >= 3) continue;
          seen.add(uci);
          shapes.push({
            orig: uci.slice(0, 2) as Key,
            dest: uci.slice(2, 4) as Key,
            brush: (['engine1', 'engine2', 'engine3'] as const)[seen.size - 1],
          });
        }
      }
    }
    cg.setAutoShapes(shapes);
  });

  // Horizontal swipe = undo / redo, isolated from piece dragging. In
  // SmallFish the swipe zone can be the board, the bottom area or both.
  useEffect(() => {
    const squareAt = (x: number, y: number): number | null => {
      const r = el.current!.getBoundingClientRect();
      const fx = Math.floor(((x - r.left) / r.width) * 8);
      const fy = Math.floor(((y - r.top) / r.height) * 8);
      if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
      const white = orientation.value === 'white';
      const file = white ? fx : 7 - fx;
      const rank = white ? 7 - fy : fy;
      return rank * 8 + file;
    };

    const isPieceGesture = (sq: number): boolean => {
      if (!game.userTurn.value) return false;
      const piece = game.positionAt(game.cursor.value).board.get(sq);
      if (piece && piece.color === game.userSide.value) return true;
      const cg = api.current;
      const selected = cg?.state.selected;
      if (selected) {
        const dests = cg!.state.movable.dests?.get(selected);
        if (dests?.includes(makeSquare(sq) as Key)) return true;
      }
      return false;
    };

    const boardSwipes = () => {
      const { layout, swipeZone } = uiSettings.value;
      return layout === 'classic' || swipeZone !== 'bottom';
    };

    return attachSwipe(shell.current!, {
      accept: (e) => {
        if (!boardSwipes() || shelfOpen.value || promoRef.current) return false;
        const sq = squareAt(e.clientX, e.clientY);
        return sq !== null && !isPieceGesture(sq);
      },
      onSwipe: (dir) => {
        api.current?.selectSquare(null);
        swipeStep(dir);
      },
    });
  }, []);

  const choosePromotion = (role: (typeof PROMO_ROLES)[number] | null) => {
    const p = promo;
    setPromo(null);
    promoRef.current = null;
    if (p && role && userMove(p.orig + p.dest + PROMO_CHAR[role])) return;
    resync();
  };

  // Promotion picker: a column from the promotion square towards the centre.
  let picker = null;
  if (promo) {
    const asWhite = orientation.value === 'white';
    const file = promo.dest.charCodeAt(0) - 97;
    const col = asWhite ? file : 7 - file;
    const top = (promo.dest[1] === '8') === asWhite;
    picker = (
      <div class="promo-layer cg-wrap" onPointerDown={(e) => e.target === e.currentTarget && choosePromotion(null)}>
        {PROMO_ROLES.map((role, i) => (
          <button
            key={role}
            class="promo-choice"
            aria-label={`Promote to ${role}`}
            style={{ left: `${col * 12.5}%`, top: `${(top ? i : 7 - i) * 12.5}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              choosePromotion(role);
            }}
          >
            {h('piece', { class: `${role} ${promo.color}` })}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={shell} class="board-shell" onPointerDown={unlockAudio}>
      <div ref={el} class="cg-wrap board" />
      {picker}
    </div>
  );
}
