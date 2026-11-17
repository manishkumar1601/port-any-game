// web-extract adapter: the game's own HTML5 build in a same-origin iframe (game/index.html, served beside the shell).
// Frames and errors come from game/__pag_hook.js (injected first in the entry <head> by `pag build`, R39), which calls window.__pagFrame / window.__pagError.
let frames = 0;
let running = true;
let audio = null;

export default {
  id: 'web-extract',
  async start(ctx) {
    const entry = 'game/index.html';
    const head = await fetch(entry, { method: 'HEAD', cache: 'no-store' }); // an iframe's onerror does not fire on a 404
    if (!head.ok) throw new Error(`could not load ${entry} (HTTP ${head.status})`);
    audio = ctx.audio.context;
    window.__pagFrame = (n) => { if (running) { frames = n; ctx.reportFrame(); } };
    window.__pagError = (e) => ctx.reportError(e instanceof Error ? e : new Error(String(e)));
    const f = document.createElement('iframe');
    f.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000';
    f.setAttribute('allow', 'autoplay; gamepad; fullscreen');
    // Input inside the iframe never reaches the shell's own listeners (input accounting and game-key protection), so
    // mirror it up as a cancelable event and honour the shell's preventDefault on the real one.
    const mirror = (w, t) => w.addEventListener(t, (e) => {
      const m = new KeyboardEvent(t, { code: e.code, key: e.key, cancelable: true });
      window.dispatchEvent(m);
      if (m.defaultPrevented) e.preventDefault();
    }, true);
    // Every load gets a fresh global (a meta-refresh entry loads twice), so attach per load, once per window.
    const seen = new WeakSet();
    const hook = () => {
      const w = f.contentWindow;
      if (seen.has(w)) return;
      seen.add(w);
      for (const t of ['keydown', 'keyup']) mirror(w, t);
      for (const t of ['pointerdown', 'pointerup']) w.addEventListener(t, () => window.dispatchEvent(new Event(t)), true);
    };
    f.addEventListener('load', () => { hook(); f.focus(); f.contentWindow.focus(); });
    ctx.host.append(f);
    await new Promise((resolve) => { f.addEventListener('load', resolve, { once: true }); f.src = entry; });
  },
  pause() { running = false; audio?.suspend().catch(() => {}); },
  resume() { running = true; audio?.resume().catch(() => {}); },
  frameCounter: () => frames,
};
