// Minimal, allocation-light UCI output parsing.

export interface UciScore {
  cp?: number;
  mate?: number;
}

export interface UciInfo {
  multipv: number;
  depth: number;
  seldepth: number;
  score?: UciScore;
  bound?: 'lower' | 'upper';
  nodes: number;
  nps: number;
  time: number;
  pv: string[];
}

/** Parses an `info` line carrying a score/pv; returns null for other info lines. */
export function parseInfo(line: string): UciInfo | null {
  const t = line.split(' ');
  if (t[0] !== 'info') return null;
  const info: UciInfo = { multipv: 1, depth: 0, seldepth: 0, nodes: 0, nps: 0, time: 0, pv: [] };
  let hasDepth = false;
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case 'depth':
        info.depth = +t[++i];
        hasDepth = true;
        break;
      case 'seldepth':
        info.seldepth = +t[++i];
        break;
      case 'multipv':
        info.multipv = +t[++i];
        break;
      case 'nodes':
        info.nodes = +t[++i];
        break;
      case 'nps':
        info.nps = +t[++i];
        break;
      case 'time':
        info.time = +t[++i];
        break;
      case 'score': {
        const kind = t[++i];
        const value = +t[++i];
        info.score = kind === 'mate' ? { mate: value } : { cp: value };
        if (t[i + 1] === 'lowerbound') {
          info.bound = 'lower';
          i++;
        } else if (t[i + 1] === 'upperbound') {
          info.bound = 'upper';
          i++;
        }
        break;
      }
      case 'pv':
        info.pv = t.slice(i + 1).filter(Boolean);
        i = t.length;
        break;
      case 'string':
        return null;
      default:
        break;
    }
  }
  return hasDepth && info.score ? info : null;
}

export interface UciBestMove {
  move: string | null;
  ponder?: string;
}

export function parseBestMove(line: string): UciBestMove {
  const t = line.split(' ');
  const move = t[1] && t[1] !== '(none)' && t[1] !== '0000' ? t[1] : null;
  const pi = t.indexOf('ponder');
  return { move, ponder: pi > 0 ? t[pi + 1] : undefined };
}

/** Collapses a score into a single sortable number (mates dominate). */
export function scoreValue(score: UciScore | undefined): number {
  if (!score) return 0;
  if (score.mate !== undefined) {
    if (score.mate > 0) return 100000 - score.mate * 10;
    if (score.mate < 0) return -100000 - score.mate * 10;
    return -100000;
  }
  return score.cp ?? 0;
}

export function negateScore(score: UciScore): UciScore {
  return score.mate !== undefined ? { mate: -score.mate } : { cp: -(score.cp ?? 0) };
}
