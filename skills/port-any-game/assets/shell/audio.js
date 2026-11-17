// Audio: one AudioContext for the lane, created inside the Play click and resumed there (autoplay policy),
// suspended while the tab is hidden. A tap on connections to any context's destination feeds stats.audioRms,
// so lanes whose runtime makes its own context are measured too. No DOM at module top level.
const analysers = new Map(); // AudioContext -> AnalyserNode
let buf = new Float32Array(2048);

// Call once at boot, before any lane code creates audio nodes.
export function installAudioTap() {
  const AN = globalThis.AudioNode;
  if (!AN || AN.prototype.connect.pagTap) return;
  const orig = AN.prototype.connect;
  const tapped = function connect(dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    try {
      if (dest instanceof AudioDestinationNode) {
        let a = analysers.get(dest.context);
        if (!a) { a = dest.context.createAnalyser(); a.fftSize = 2048; analysers.set(dest.context, a); }
        orig.call(this, a);
      }
    } catch { /* measuring must never break the game's audio */ }
    return r;
  };
  tapped.pagTap = true;
  AN.prototype.connect = tapped;
}

// Loudest RMS (0..1) across tapped contexts this frame; null when nothing has played into a destination.
export function audioRms() {
  let max = 0;
  for (const [ctx, a] of analysers) {
    if (ctx.state === 'closed') { analysers.delete(ctx); continue; }
    if (buf.length !== a.fftSize) buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    max = Math.max(max, Math.sqrt(s / buf.length));
  }
  return analysers.size ? max : null;
}

// Must run synchronously inside the Play click handler.
export function createAudio() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  ctx.resume?.().catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (ctx.state !== 'closed') (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => {});
  });
  return ctx;
}
