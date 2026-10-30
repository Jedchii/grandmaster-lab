// UI-side handle to the engine host worker. Holds no chess logic: it forwards
// typed requests and turns host events into signals.
//
// If the worker crashes it is respawned (up to 3 times a minute, with
// back-off) and handed the latest settings, game and visibility again, so a
// crash costs an engine reload, not the game.

import { signal } from '@preact/signals';
import type {
  BestMove,
  EngineSettings,
  EngineState,
  GameSync,
  HintResult,
  HostEvent,
  HostRequest,
  PersonaId,
  PersonaSignal,
  SearchInfo,
} from '../shared/protocol';

export interface OpeningInfo {
  eco: string;
  name: string;
  inBook: boolean;
}

export interface EngineIdentity {
  persona: PersonaId;
  name: string;
  threaded: boolean;
  loadMs: number;
}

const MAX_RESTARTS = 3;

export class EngineClient {
  private worker!: Worker;
  private initMsg: Extract<HostRequest, { type: 'init' }> | null = null;
  private lastSync: GameSync | null = null;
  private hidden = false;
  private restarts: number[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  readonly state = signal<EngineState>('loading');
  readonly detail = signal('Waking up…');
  readonly identity = signal<EngineIdentity | null>(null);
  readonly info = signal<SearchInfo | null>(null);
  readonly opening = signal<OpeningInfo | null>(null);
  readonly ponderSan = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);

  onBestMove: (move: BestMove) => void = () => {};
  onHint: (hint: HintResult) => void = () => {};
  onSignal: (signal: PersonaSignal, gameId: number) => void = () => {};

  constructor() {
    this.spawn();
  }

  private spawn(): void {
    const worker = new Worker(new URL('../workers/engine-host.worker.ts', import.meta.url), {
      type: 'module',
      name: 'engine-host',
    });
    worker.onmessage = (e: MessageEvent<HostEvent>) => this.onEvent(e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      this.onCrash(e.message || 'engine host crashed');
    };
    this.worker = worker;
  }

  private onCrash(message: string): void {
    this.lastError.value = message;
    console.warn('[engine] host crashed:', message);
    const now = performance.now();
    this.restarts = this.restarts.filter((t) => now - t < 60_000);
    if (this.restartTimer || this.restarts.length >= MAX_RESTARTS) {
      if (!this.restartTimer) this.state.value = 'error';
      return;
    }
    this.restarts.push(now);
    this.state.value = 'loading';
    this.detail.value = 'Restarting engine…';
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.worker.terminate();
      this.spawn();
      // Replay what the old host knew: settings, visibility and the game.
      if (this.initMsg) this.worker.postMessage(this.initMsg);
      if (this.hidden) this.worker.postMessage({ type: 'visibility', hidden: true } satisfies HostRequest);
      if (this.lastSync) this.worker.postMessage({ type: 'sync', sync: this.lastSync } satisfies HostRequest);
    }, 400 * this.restarts.length);
  }

  private post(msg: HostRequest): void {
    this.worker.postMessage(msg);
  }

  init(settings: EngineSettings): void {
    this.initMsg = {
      type: 'init',
      baseUrl: import.meta.env.BASE_URL,
      isolated: self.crossOriginIsolated === true,
      cores: navigator.hardwareConcurrency || 2,
      settings,
    };
    this.post(this.initMsg);
  }

  setSettings(settings: EngineSettings): void {
    if (this.initMsg) this.initMsg = { ...this.initMsg, settings };
    this.post({ type: 'settings', settings });
  }

  sync(sync: GameSync): void {
    this.lastSync = sync;
    this.post({ type: 'sync', sync });
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.post({ type: 'visibility', hidden });
  }

  hint(gameId: number, line: string, autoplay: boolean): void {
    this.post({ type: 'hint', gameId, line, autoplay });
  }

  moveNow(): void {
    this.post({ type: 'moveNow' });
  }

  private onEvent(event: HostEvent): void {
    switch (event.type) {
      case 'engine':
        this.identity.value = event;
        break;
      case 'state':
        this.state.value = event.state;
        this.detail.value = event.detail ?? '';
        if (event.state !== 'pondering') this.ponderSan.value = null;
        break;
      case 'opening':
        this.opening.value = event.name ? { eco: event.eco, name: event.name, inBook: event.inBook } : null;
        break;
      case 'info':
        this.info.value = event.info;
        break;
      case 'bestmove':
        this.onBestMove(event.move);
        break;
      case 'hint':
        this.onHint(event.hint);
        break;
      case 'ponder':
        this.ponderSan.value = event.san;
        break;
      case 'signal':
        this.onSignal(event.signal, event.gameId);
        break;
      case 'error':
        this.lastError.value = event.message;
        console.warn('[engine]', event.message);
        break;
    }
  }
}
