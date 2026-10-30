// A UCI engine running in its own (nested) worker. Every engine binary we ship
// - Patricia and Stockfish, threaded or cooperative - is a classic worker
// script that speaks plain UCI over postMessage, so they are interchangeable.

import { parseBestMove, parseInfo, type UciBestMove, type UciInfo } from './uci';

export interface SearchHandle {
  readonly done: Promise<UciBestMove>;
}

/** What the host needs from an engine (lets tests plug in a scripted fake). */
export interface EngineLike {
  readonly name: string;
  readonly url: string;
  onDeath: ((reason: string) => void) | null;
  send(cmd: string): void;
  ready(timeoutMs?: number): Promise<void>;
  setOption(name: string, value: string | number | boolean): void;
  newGame(): Promise<void>;
  search(position: string, go: string, onInfo: (info: UciInfo) => void): SearchHandle;
  ponderhit(): void;
  stop(timeoutMs?: number): Promise<UciBestMove | null>;
  terminate(): void;
}

export type EngineBooter = (url: string, timeoutMs: number) => Promise<EngineLike>;

interface PendingSearch {
  resolve: (best: UciBestMove) => void;
  onInfo: (info: UciInfo) => void;
}

export class UciEngine implements EngineLike {
  name = 'engine';
  private readonly options = new Map<string, string>();
  private readyWaiters: Array<() => void> = [];
  private uciWaiter: (() => void) | null = null;
  private current: PendingSearch | null = null;
  private currentDone: Promise<UciBestMove> | null = null;
  private dead = false;
  onDeath: ((reason: string) => void) | null = null;
  onLog: ((line: string) => void) | null = null;

  private constructor(
    private readonly worker: Worker,
    readonly url: string,
  ) {
    worker.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') this.onLine(e.data);
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault();
      this.fail(`worker error: ${e.message || 'unknown'}`);
    };
  }

  /** Spawns the engine worker and completes the uci/isready handshake. */
  static async boot(url: string, timeoutMs = 15000): Promise<UciEngine> {
    const engine = new UciEngine(new Worker(url), url);
    let timer = 0;
    try {
      await Promise.race([
        (async () => {
          await new Promise<void>((resolve) => {
            engine.uciWaiter = resolve;
            engine.send('uci');
          });
          await engine.ready();
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`engine boot timed out: ${url}`)), timeoutMs);
        }),
        new Promise<never>((_, reject) => {
          engine.onDeath = (reason) => reject(new Error(reason));
        }),
      ]);
    } catch (err) {
      engine.terminate();
      throw err;
    } finally {
      clearTimeout(timer);
      engine.onDeath = null;
    }
    return engine;
  }

  get searching(): boolean {
    return this.current !== null;
  }

  get alive(): boolean {
    return !this.dead;
  }

  send(cmd: string): void {
    if (!this.dead) this.worker.postMessage(cmd);
  }

  /** isready/readyok round trip; with a timeout, a silent engine is killed (onDeath). */
  ready(timeoutMs = 0): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      this.readyWaiters.push(waiter);
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter);
          this.fail('engine did not answer isready');
          resolve();
        }, timeoutMs);
      }
      this.send('isready');
    });
  }

  /** Sends `setoption` only when the value actually changes. */
  setOption(name: string, value: string | number | boolean): void {
    const v = String(value);
    if (this.options.get(name) === v) return;
    this.options.set(name, v);
    this.send(`setoption name ${name} value ${v}`);
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame');
    await this.ready();
  }

  search(position: string, go: string, onInfo: (info: UciInfo) => void): SearchHandle {
    if (this.current) throw new Error('search already running');
    const done = new Promise<UciBestMove>((resolve) => {
      this.current = { resolve, onInfo };
    });
    this.currentDone = done;
    this.send(position);
    this.send(go);
    return { done };
  }

  ponderhit(): void {
    if (this.current) this.send('ponderhit');
  }

  /**
   * Stops the running search (if any) and resolves once bestmove arrived.
   * Watchdog: an engine that never answers (e.g. stockfish.js single-thread
   * after a ponder search finished on its own) is killed and reported via
   * onDeath, so the host can boot a fresh one instead of hanging.
   */
  stop(timeoutMs = 2500): Promise<UciBestMove | null> {
    if (!this.current || !this.currentDone) return Promise.resolve(null);
    this.send('stop');
    const done = this.currentDone;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.fail('engine did not answer stop');
        resolve(null);
      }, timeoutMs);
      void done.then((best) => {
        clearTimeout(timer);
        resolve(best);
      });
    });
  }

  terminate(): void {
    this.dead = true;
    this.worker.terminate();
    this.current?.resolve({ move: null });
    this.current = null;
  }

  private fail(reason: string): void {
    if (this.dead) return;
    this.dead = true;
    this.worker.terminate();
    this.current?.resolve({ move: null });
    this.current = null;
    this.onDeath?.(reason);
  }

  private onLine(line: string): void {
    if (line.startsWith('info')) {
      if (this.current) {
        const info = parseInfo(line);
        if (info) this.current.onInfo(info);
      }
      if (line.startsWith('info string')) this.onLog?.(line);
      return;
    }
    if (line.startsWith('bestmove')) {
      const pending = this.current;
      this.current = null;
      this.currentDone = null;
      pending?.resolve(parseBestMove(line));
      return;
    }
    if (line === 'readyok') {
      this.readyWaiters.shift()?.();
      return;
    }
    if (line === 'uciok') {
      this.uciWaiter?.();
      this.uciWaiter = null;
      return;
    }
    if (line.startsWith('id name ')) {
      this.name = line.slice(8).trim();
    }
  }
}
