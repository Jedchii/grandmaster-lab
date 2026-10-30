/// <reference lib="webworker" />
// Engine host worker entry. Everything chess-computational lives below this
// line: UCI engines (nested workers), opening books, persona move selection,
// pondering and UCI parsing. The UI thread only exchanges typed messages.

import type { HostEvent, HostRequest } from '../shared/protocol';
import { EngineHost } from './host';

declare const self: DedicatedWorkerGlobalScope;

const host = new EngineHost((event: HostEvent) => self.postMessage(event));

// A failing request is reported, never left to kill message handling.
self.onmessage = (e: MessageEvent<HostRequest>) => {
  try {
    host.handle(e.data);
  } catch (err) {
    self.postMessage({ type: 'error', message: `host: ${err instanceof Error ? err.message : String(err)}` } satisfies HostEvent);
  }
};
