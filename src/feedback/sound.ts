// Procedural Web Audio feedback. Each sound is rendered once into an
// AudioBuffer (OfflineAudioContext), so playing is a single buffer-source
// start: lowest possible latency, no audio files to precache.
//
// iOS only allows audio after a user gesture, so unlock() runs on the first
// pointerdown.

export type SoundKind = 'move' | 'capture' | 'check' | 'castle' | 'end' | 'notify';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<SoundKind, AudioBuffer>();
let rendering: Promise<void> | null = null;
let enabled = false;

/** Sound is opt-in. While it's off no AudioContext exists at all, so the app never touches the iOS audio session (background music keeps playing). */
export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on && ctx && ctx.state === 'running') void ctx.suspend();
}

function noiseBuffer(c: BaseAudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  return buf;
}

/** Wooden "tock": band-passed noise transient + a short low body thump. */
function woodHit(c: OfflineAudioContext, at: number, gain: number, pitch: number, body: number): void {
  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c, 0.08);
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = pitch;
  band.Q.value = 1.4;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0, at);
  ng.gain.linearRampToValueAtTime(gain, at + 0.002);
  ng.gain.exponentialRampToValueAtTime(0.0008, at + 0.06);
  noise.connect(band).connect(ng).connect(c.destination);
  noise.start(at);

  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(body * 1.6, at);
  osc.frequency.exponentialRampToValueAtTime(body, at + 0.05);
  const og = c.createGain();
  og.gain.setValueAtTime(0, at);
  og.gain.linearRampToValueAtTime(gain * 0.55, at + 0.003);
  og.gain.exponentialRampToValueAtTime(0.0008, at + 0.09);
  osc.connect(og).connect(c.destination);
  osc.start(at);
  osc.stop(at + 0.1);
}

function tone(c: OfflineAudioContext, at: number, freq: number, dur: number, gain: number): void {
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

async function render(kind: SoundKind, rate: number): Promise<AudioBuffer> {
  const length = kind === 'end' ? 1.1 : kind === 'check' || kind === 'notify' ? 0.35 : 0.2;
  const c = new OfflineAudioContext(1, Math.ceil(rate * length), rate);
  switch (kind) {
    case 'move':
      woodHit(c, 0, 0.9, 1900, 170);
      break;
    case 'capture':
      woodHit(c, 0, 1, 1200, 120);
      woodHit(c, 0.028, 0.55, 2400, 160);
      break;
    case 'castle':
      woodHit(c, 0, 0.8, 1900, 170);
      woodHit(c, 0.07, 0.65, 1700, 150);
      break;
    case 'check':
      woodHit(c, 0, 0.8, 1600, 150);
      tone(c, 0.02, 880, 0.12, 0.18);
      tone(c, 0.1, 1320, 0.18, 0.14);
      break;
    case 'notify':
      tone(c, 0, 660, 0.14, 0.12);
      tone(c, 0.09, 990, 0.2, 0.1);
      break;
    case 'end':
      tone(c, 0, 523.25, 0.9, 0.12);
      tone(c, 0.06, 659.25, 0.85, 0.1);
      tone(c, 0.12, 783.99, 0.8, 0.09);
      break;
  }
  return c.startRendering();
}

/** Call from a user gesture (first pointerdown). Safe to call repeatedly. */
export function unlockAudio(): void {
  if (!enabled) return;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor({ latencyHint: 'interactive' });
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') void ctx.resume();
    if (!rendering) {
      const rate = ctx.sampleRate;
      const kinds: SoundKind[] = ['move', 'capture', 'castle', 'check', 'notify', 'end'];
      rendering = Promise.all(kinds.map(async (k) => buffers.set(k, await render(k, rate)))).then(() => {});
    }
  } catch {
    /* audio unavailable */
  }
}

export function playSound(kind: SoundKind): void {
  if (!enabled || !ctx || !master) return;
  const buffer = buffers.get(kind);
  if (!buffer) return;
  if (ctx.state !== 'running') void ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(master);
  src.start();
}
