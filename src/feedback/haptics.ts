// Haptic feedback.
//
// navigator.vibrate is used where it exists (Android/Chrome). iOS Safari has
// no Vibration API, but since iOS 18 toggling an <input type="checkbox"
// switch> plays the system "selection" haptic - so on iPhone we click a
// hidden switch. Like all iOS haptics from the web it only fires inside a
// user gesture, i.e. for your own moves.

export type HapticKind = 'tick' | 'capture' | 'check';

let enabled = true;
let label: HTMLLabelElement | null = null;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

function iosSwitch(): HTMLLabelElement {
  if (label) return label;
  label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  return label;
}

const PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 8,
  capture: [14, 40, 10],
  check: [22, 50, 22],
};

export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(PATTERNS[kind]);
      return;
    }
    const el = iosSwitch();
    el.click();
    if (kind !== 'tick') setTimeout(() => el.click(), 70);
  } catch {
    /* no haptics on this device */
  }
}
