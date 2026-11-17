// Copied by `pag build` to build/game/__pag_hook.js and loaded first in the entry HTML's <head> (R39), so it runs before any
// game script. Reports error/unhandledrejection to the shell (even before load). Wraps requestAnimationFrame and counts one frame per distinct timestamp (all callbacks of a frame share it).
(() => {
  if (window.__pagFrames) return;
  const s = (window.__pagFrames = { frames: 0, last: null });
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (t !== s.last) {
      s.last = t;
      s.frames++;
      try { window.parent.__pagFrame?.(s.frames); } catch { /* cross-origin parent */ }
    }
    return cb(t);
  });
  const up = (e) => { try { window.parent.__pagError?.(e); } catch { /* cross-origin parent */ } };
  window.addEventListener('error', (e) => up(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => up(e.reason));
})();
