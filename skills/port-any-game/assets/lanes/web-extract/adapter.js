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
    // M2: the game's own uncaught errors are page errors (fatal only if its loop stops), not lane failures.
    window.__pagError = (e) => (ctx.reportPageError ?? ctx.reportError)(e instanceof Error ? e : new Error(String(e)));
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
    // A meta-refresh entry loads two documents in the same WindowProxy, each with a fresh global: attach per document.
    const seen = new WeakSet();
    const hook = () => {
      const w = f.contentWindow;
      if (seen.has(w.document)) return;
      seen.add(w.document);
      for (const t of ['keydown', 'keyup']) mirror(w, t);
      for (const t of ['pointerdown', 'pointerup']) w.addEventListener(t, () => window.dispatchEvent(new Event(t)), true);
    };
    // start() resolves once the real entry has loaded (not the meta-refresh stub, which would show a blank first frame);
    // ponytail: a game that is itself a meta-refresh page is released by a 10 s timer.
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 10000);
      f.addEventListener('load', () => {
        // Chrome fires a synchronous load for the initial about:blank document on append, before src navigates.
        if (f.contentWindow.location.href === 'about:blank') return;
        hook();
        if (f.contentWindow.document.querySelector('meta[http-equiv="refresh" i]')) return; // the redirect stub
        clearTimeout(timer);
        f.focus();
        f.contentWindow.focus();
        resolve();
      });
      ctx.host.append(f);
      f.src = entry;
    });
  },
  pause() { running = false; audio?.suspend().catch(() => {}); },
  resume() { running = true; audio?.resume().catch(() => {}); },
  frameCounter: () => frames,
};
