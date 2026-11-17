// web-extract adapter: the game's own HTML5 build in a same-origin iframe (game/index.html, served beside the shell).
let frames = 0;
let running = true;
let audio = null;

export default {
  id: 'web-extract',
  async start(ctx) {
    const f = document.createElement('iframe');
    f.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000';
    f.setAttribute('allow', 'autoplay; gamepad; fullscreen');
    audio = ctx.audio.context;
    const err = (e) => ctx.reportError(e instanceof Error ? e : new Error(String(e)));
    const mirror = (t, make) => (w) => w.addEventListener(t, (e) => window.dispatchEvent(make(e)), true);
    const hooks = [
      (w) => { const raf = w.requestAnimationFrame.bind(w); w.requestAnimationFrame = (cb) => raf((t) => { if (running) { frames++; ctx.reportFrame(); } cb(t); }); },
      (w) => w.addEventListener('error', (e) => err(e.error ?? e.message)),
      (w) => w.addEventListener('unhandledrejection', (e) => err(e.reason)),
      // Input in the iframe never reaches the shell's own listeners (its input accounting), so mirror it up.
      ...['keydown', 'keyup'].map((t) => mirror(t, (e) => new KeyboardEvent(t, { code: e.code, key: e.key }))),
      ...['pointerdown', 'pointerup'].map((t) => mirror(t, () => new Event(t))),
    ];
    // Navigation swaps the iframe's global (the WindowProxy stays), so a patch made before it is lost and a `load` hook is
    // late. Hook each new document as soon as it is visible: a 5 ms poll, plus DOMContentLoaded and load as fallbacks.
    // ponytail: a script that runs within the first ~5 ms and caches requestAnimationFrame escapes the wrap (self-rescheduling
    // loops are counted from their second frame). Serve game/index.html through a script-injecting document if a game needs it.
    const seen = new WeakSet();
    const attach = () => {
      let w, d;
      try { w = f.contentWindow; d = w?.document; } catch { return; }
      if (!d || d.URL === 'about:blank' || seen.has(d)) return;
      seen.add(d);
      for (const h of hooks) h(w);
    };
    setInterval(attach, 5);
    ctx.host.append(f);
    await new Promise((resolve, reject) => { f.onload = resolve; f.onerror = () => reject(new Error('could not load game/index.html')); f.src = 'game/index.html'; });
    attach();
    f.focus();
    f.contentWindow.focus();
  },
  pause() { running = false; audio?.suspend().catch(() => {}); },
  resume() { running = true; audio?.resume().catch(() => {}); },
  frameCounter: () => frames,
};
