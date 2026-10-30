// Opening names (ECO) keyed by Polyglot hash, so transpositions resolve to the
// same name. Data: lichess-org/chess-openings (CC0), built by gen-data.py.

export interface OpeningName {
  eco: string;
  name: string;
  /** Ply of the game position the name was found at. */
  ply: number;
}

export class EcoIndex {
  private readonly table: Map<string, [string, string, number]>;

  constructor(json: Record<string, [string, string, number]>) {
    this.table = new Map(Object.entries(json));
  }

  get size(): number {
    return this.table.size;
  }

  /** Deepest named position in the game so far (keys indexed by ply). */
  lookup(hexKeys: readonly string[]): OpeningName | null {
    for (let ply = hexKeys.length - 1; ply >= 0; ply--) {
      const hit = this.table.get(hexKeys[ply]);
      if (hit) return { eco: hit[0], name: hit[1], ply };
    }
    return null;
  }
}
