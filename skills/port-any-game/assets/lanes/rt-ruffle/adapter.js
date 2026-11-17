// rt-ruffle adapter: Ruffle (self-hosted, same hashed runtime folder as this file) plays the user's SWF from OPFS.
// No DOM access at module top level: the Node tests import swfFromProjector.

// Flash projector: [exe][swf][56 34 12 FA][u32 LE swf length]. Returns the SWF bytes (a copy).
export function swfFromProjector(b) {
  const n = b.length;
  const ok = n >= 8 && b[n - 8] === 0x56 && b[n - 7] === 0x34 && b[n - 6] === 0x12 && b[n - 5] === 0xFA;
  const len = ok ? new DataView(b.buffer, b.byteOffset, n).getUint32(n - 4, true) : 0;
  if (!ok || len < 8 || len > n - 8) throw new Error('not a Flash projector: no SWF trailer at the end of the file');
  const swf = b.slice(n - 8 - len, n - 8);
  if (!/^[FCZ]WS$/.test(String.fromCharCode(swf[0], swf[1], swf[2]))) throw new Error('not a Flash projector: the trailer does not point at a SWF (no FWS/CWS/ZWS header)');
  return swf;
}

let frames = 0;
let running = true;
let player = null;
let raf = 0;

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

export default {
  id: 'rt-ruffle',
  async start(ctx) {
    const { swf, projector } = ctx.config.lane_config ?? {};
    if (!swf) throw new Error('shell.json has no lane_config.swf (run pag build, then pag pack)');
    const base = new URL('./', import.meta.url).href;
    window.RufflePlayer = { config: { publicPath: base } };
    await loadScript(new URL('ruffle.js', base).href);
    let bytes = await ctx.files.read(swf);
    if (projector) bytes = swfFromProjector(bytes);
    player = window.RufflePlayer.newest().createPlayer();
    player.style.cssText = 'width:100%;height:100%;display:block';
    ctx.host.append(player);
    await player.load({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), autoplay: 'on', preferredRenderer: 'webgl', letterbox: 'on', unmuteOverlay: 'hidden' });
    let panicked = false;
    // R46: count only frames Ruffle has rendered. Ruffle 0.7.1 shows its canvas when the movie's metadata arrives
    // (readyState 2 = Loaded; before that the canvas container is display:none behind the splash). Counting starts
    // one tick after Loaded is first seen, so Ruffle's own rAF tick has run (and drawn the movie) at least once since,
    // whichever of the two rAF callbacks runs first in a frame.
    let shown = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!panicked && player.shadowRoot?.querySelector('#panic')) { panicked = true; ctx.reportError(new Error('Ruffle panicked (see the player for details)')); }
      if (running && !panicked && shown && player.ruffle?.().is_playing?.() !== false) { frames++; ctx.reportFrame(); }
      shown ||= player.readyState === 2;
    };
    raf = requestAnimationFrame(tick);
  },
  pause() { running = false; player?.ruffle?.().pause?.(); },
  resume() { running = true; player?.ruffle?.().play?.(); },
  frameCounter: () => frames,
};
