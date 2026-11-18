// Copied by `pag build` to build/game/__pag_hook.js and loaded first in the entry HTML's <head> (R39), so it runs before any
// game script. Reports error/unhandledrejection to the shell (even before load). Wraps requestAnimationFrame and counts one frame per distinct timestamp (all callbacks of a frame share it).
// Fallback for pages that never use rAF (timer-driven WebGL): one frame per browser task that issues a draw call, only while no rAF frame was counted.
(() => {
  if (window.__pagFrames) return;
  const s = (window.__pagFrames = { frames: 0, last: null });
  const report = () => { try { window.parent.__pagFrame?.(s.frames); } catch { /* cross-origin parent */ } };
  const raf = window.requestAnimationFrame.bind(window);
  let viaRaf = false;
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (t !== s.last) {
      s.last = t;
      viaRaf = true;
      s.frames++;
      report();
    }
    return cb(t);
  });
  let pending = false;
  let mc;
  const task = () => {
    if (!mc) {
      mc = new MessageChannel();
      mc.port1.onmessage = () => {
        pending = false;
        if (viaRaf) return;
        s.frames++;
        report();
      };
    }
    mc.port2.postMessage(0);
  };
  const wrap = (proto, name) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...a) {
      if (!pending && !viaRaf) { pending = true; task(); }
      return orig.apply(this, a);
    };
  };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (C) for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements']) wrap(C.prototype, n);
  }
  const up = (e) => { try { window.parent.__pagError?.(e); } catch { /* cross-origin parent */ } };
  window.addEventListener('error', (e) => up(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => up(e.reason));
})();
