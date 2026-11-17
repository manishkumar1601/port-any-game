// Injected by pag verify into every frame before any page script (CDP Page.addScriptToEvaluateOnNewDocument, or
// Playwright addInitScript). Plain script, not a module. Exposes window.__pagVerify:
//   sample()  largest visible canvas (same-origin iframes and open shadow roots included) downscaled to 64x48 RGBA, or null
//   audio()   {contexts: AudioContext states, rms: loudest RMS 0..1 across tapped contexts, or null}
//   pad(on)   press/release button 0 and push the left stick of the fake standard gamepad
//   heap()    performance.memory.usedJSHeapSize (Chromium), or null
// Measuring must never break the game: hooks fall through to the real APIs and swallow their own errors.
(() => {
  if (window.__pagVerify) return;
  const V = {};
  Object.defineProperty(window, '__pagVerify', { value: V });

  // Readable WebGL: keep the drawing buffer so drawImage() sees the last frame (headless screenshots of WebGL can be black).
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContextPreserving(type, attrs) {
    if (/^(experimental-)?webgl2?$/.test(type)) attrs = { ...attrs, preserveDrawingBuffer: true };
    return getContext.call(this, type, attrs);
  };

  // Audio: remember every AudioContext; anything connected to a destination also feeds a per-context AnalyserNode.
  const contexts = new Set();
  const analysers = new Map();
  for (const k of ['AudioContext', 'webkitAudioContext']) {
    const C = window[k];
    if (typeof C === 'function') window[k] = { [k]: class extends C { constructor(...a) { super(...a); contexts.add(this); } } }[k];
  }
  const AN = window.AudioNode;
  if (AN) {
    const connect = AN.prototype.connect;
    AN.prototype.connect = function connectTapped(dest, ...rest) {
      const r = connect.call(this, dest, ...rest);
      try {
        if (dest instanceof AudioDestinationNode) {
          contexts.add(dest.context);
          let a = analysers.get(dest.context);
          if (!a) { a = dest.context.createAnalyser(); a.fftSize = 2048; analysers.set(dest.context, a); }
          connect.call(this, a);
        }
      } catch { /* never break the game's audio */ }
      return r;
    };
  }
  const buf = new Float32Array(2048);
  V.audio = () => {
    let rms = null;
    for (const [ctx, a] of analysers) {
      if (ctx.state === 'closed') continue;
      a.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      rms = Math.max(rms ?? 0, Math.sqrt(s / buf.length));
    }
    const out = { contexts: [...contexts].map((c) => c.state), rms };
    // Same-origin child frames carry their own instrument: fold their audio in (an iframe game's AudioContext lives there).
    for (const fr of document.querySelectorAll('iframe, frame')) {
      try {
        const a = fr.contentWindow?.__pagVerify?.audio();
        if (!a) continue;
        out.contexts.push(...a.contexts);
        if (a.rms != null) out.rms = Math.max(out.rms ?? 0, a.rms);
      } catch { /* cross-origin frame */ }
    }
    return out;
  };

  // Fake standard gamepad. Same-origin child frames share the top frame's pad, so pad() reaches iframe games too.
  let pad = null;
  try { if (window.top !== window) pad = window.top.__pagVerify?.padState ?? null; } catch { /* cross-origin parent */ }
  pad ??= {
    id: 'pag verify virtual pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: null,
  };
  V.padState = pad;
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); } catch { /* locked down */ }
  V.pad = (on) => {
    Object.assign(pad.buttons[0], { pressed: on, touched: on, value: on ? 1 : 0 });
    pad.axes[0] = on ? 1 : 0;
    pad.timestamp = performance.now();
  };

  // Canvas sampling: the largest canvas on screen, drawn into a 64x48 scratch canvas.
  const W = 64;
  const H = 48;
  let scratch = null;
  const area = (c) => { const r = c.getBoundingClientRect(); return r.width * r.height; };
  const collect = (doc, out) => {
    out.push(...doc.querySelectorAll('canvas'));
    for (const f of doc.querySelectorAll('iframe, frame')) {
      try { if (f.contentDocument) collect(f.contentDocument, out); } catch { /* cross-origin frame */ }
    }
    // Open shadow roots too (Ruffle draws inside <ruffle-player>); closed ones are not reachable.
    for (const el of doc.querySelectorAll('*')) if (el.shadowRoot) collect(el.shadowRoot, out);
    return out;
  };
  V.sample = () => {
    const shown = collect(document, []).filter((c) => c.width && c.height && area(c) > 0);
    if (!shown.length) return null;
    const c = shown.reduce((a, b) => (area(b) > area(a) ? b : a));
    scratch ??= Object.assign(document.createElement('canvas'), { width: W, height: H });
    try {
      const g = scratch.getContext('2d', { willReadFrequently: true });
      g.clearRect(0, 0, W, H);
      g.drawImage(c, 0, 0, W, H);
      return { w: W, h: H, size: `${c.width}x${c.height}`, data: Array.from(g.getImageData(0, 0, W, H).data) };
    } catch (e) { return { error: String(e?.message ?? e) }; }
  };

  V.heap = () => performance.memory?.usedJSHeapSize ?? null;
})();
