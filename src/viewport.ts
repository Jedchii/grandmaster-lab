// Viewport shielding for iOS Safari / home-screen mode: no pinch zoom, no
// double-tap zoom, no rubber-band bounce. CSS (touch-action, overscroll-
// behavior, a fixed 100dvh body) does most of it; these listeners close the
// gaps Safari leaves open.

export function shieldViewport(): void {
  const block = (e: Event) => e.preventDefault();
  // Safari-only pinch gesture events.
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  document.addEventListener('gestureend', block, { passive: false });

  // Multi-finger touches never scroll or zoom anything here.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) {
        e.preventDefault();
        return;
      }
      // Single-finger drags only scroll inside explicitly scrollable areas.
      const target = e.target as Element | null;
      if (!target?.closest('.sheet-content, .notation, .shelf, .editor-body, .moves, input')) e.preventDefault();
    },
    { passive: false },
  );

  // Double-tap zoom is disabled by `touch-action: manipulation` in CSS. A
  // touchend guard is deliberately not used: it would swallow the second of
  // two quick taps on a button.

  // Keep a stable full-height layout when the iOS toolbar shows/hides.
  const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
  setVh();
  window.addEventListener('resize', setVh, { passive: true });
}
