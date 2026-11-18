// rt-easyrpg adapter: EasyRPG Player 0.8.1.1 (web build, GPL-3.0-or-later, in this hashed runtime folder) plays the
// user's RPG Maker 2000/2003 game from OPFS. The player fetches every game file with XMLHttpRequest
// (emscripten_async_wget2 on games/<game>/<path>); a page-wide XHR shim answers from ctx.files instead (spike f §3).
// No DOM at module top level: the Node tests import gencacheIndex and gamePath.

const lower = (s) => s.toLowerCase().normalize('NFKC');
const noExt = (s) => s.replace(/\.[^.]*$/, '');

// EasyRPG's index.json (gencache format v2, spike f §2) for paths relative to the game root: root files keyed by their
// full lower-case name (ExFont.* as exfont), folders as nested {_dirname} objects whose files are keyed without their
// extension (except .ini/.po), three folders deep at most (gencache's default depth 4).
export function gencacheIndex(paths, date = new Date().toISOString().slice(0, 10)) {
  const cache = {};
  for (const p of paths) {
    const dirs = p.split('/');
    const name = dirs.pop();
    if (dirs.length > 3 || [...dirs, name].includes('_dirname')) continue; // gencache's reserved key
    let node = cache;
    for (const d of dirs) node = typeof node[lower(d)] === 'object' ? node[lower(d)] : (node[lower(d)] = { _dirname: d });
    const key = lower(name);
    if (!dirs.length) node[noExt(key) === 'exfont' ? 'exfont' : key] = name;
    else node[/\.(ini|po)$/.test(key) ? key : noExt(key)] = name;
  }
  return { metadata: { version: 2, date }, cache };
}

// 'games/<game>/./Title/A%20B.png' -> 'Title/A B.png'; null for any other URL.
export function gamePath(url, game) {
  const m = /^games\/([^/]+)\/(.+)$/.exec(String(url));
  if (m?.[1] !== game) return null;
  let segs;
  try { segs = decodeURIComponent(m[2]).split('/').filter((s) => s && s !== '.'); } catch { return null; }
  return segs.length && !segs.includes('..') ? segs.join('/') : null;
}

let frames = 0;
let running = true;
let player = null;

// R46: like Ruffle's splash, the player's own start-up (black, its logo, black again) is not counted as game frames.
// A 16x12 copy of the canvas, taken right after each frame is drawn, tells the phases apart until the game shows.
// ponytail: a game that opens on a black screen is counted from STARTUP_MAX frames on (10 s at 60 fps).
const STARTUP_MAX = 600;
let phase = 0; // 0 black, 1 logo, 2 black, 3 game
let loops = 0;
let probe = null;
function lit(canvas) {
  probe ??= Object.assign(document.createElement('canvas'), { width: 16, height: 12 }).getContext('2d', { willReadFrequently: true });
  probe.drawImage(canvas, 0, 0, 16, 12);
  return probe.getImageData(0, 0, 16, 12).data.some((v, i) => i % 4 !== 3 && v > 32);
}

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

// ponytail: replaces XMLHttpRequest for the whole page; the player is its only user (its wasm comes through fetch).
function installXhr(files, { root, game }) {
  const under = root ? `${root}/` : '';
  const index = new TextEncoder().encode(JSON.stringify(gencacheIndex(files.list().filter((p) => p.startsWith(under)).map((p) => p.slice(under.length)))));
  const read = async (rel) => (rel === 'index.json' ? index : files.read(under + rel)); // files looks paths up case-insensitively
  window.XMLHttpRequest = class GameXhr {
    status = 0;
    readyState = 0;
    response = null;
    responseType = '';
    open(_method, url) { this.url = String(url); this.readyState = 1; }
    setRequestHeader() {}
    abort() { this.aborted = true; this.onabort?.({}); }
    send() {
      const done = (status, b) => {
        if (this.aborted) return;
        Object.assign(this, { status, readyState: 4, response: b ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : null });
        (status ? this.onload : this.onerror)?.({});
      };
      const rel = gamePath(this.url, game);
      if (!rel) queueMicrotask(() => done(0, null));
      else read(rel).then((b) => done(200, b), () => done(404, null));
    }
  };
}

export default {
  id: 'rt-easyrpg',
  async start(ctx) {
    const cfg = ctx.config.lane_config ?? {};
    if (!cfg.game) throw new Error('shell.json has no lane_config.game (run pag build, then pag pack)');
    const canvas = Object.assign(document.createElement('canvas'), { id: 'canvas', tabIndex: -1 }); // the player and SDL look it up by id
    // The player sizes its drawing buffer to the canvas's box; in the host's grid that buffer would grow the box past
    // the host (1280x1280 at 1280x800). Out of the grid, the box is the host's.
    canvas.style.cssText = 'position:absolute;inset:0';
    ctx.host.append(canvas);
    installXhr(ctx.files, cfg);
    await loadScript(new URL('index.js', import.meta.url).href);
    // Upstream's pre-js replaces a setStatus passed in here and writes its start-up messages into any #status (the
    // shell's), which the shell resets once start() returns. From onRuntimeInitialized on, the player is silent.
    player = await window.createEasyRpgPlayer({
      game: cfg.game,
      onRuntimeInitialized() {
        this.setStatus = () => {};
        // the final argv: without it the shell page's own query string would reach the player as flags
        this.arguments.splice(0, Infinity, 'easyrpg-player', '--save-path', 'Save', '--game', cfg.game, ...(cfg.encoding ? ['--encoding', cfg.encoding] : []));
      },
      preMainLoop: () => running,
      postMainLoop() {
        if (phase < 3 && (++loops > STARTUP_MAX || lit(canvas) === (phase !== 1))) phase++;
        if (phase === 3) { frames++; ctx.reportFrame(); }
      },
    });
    canvas.focus();
  },
  pause() { running = false; },
  resume() { running = true; },
  frameCounter: () => frames,
  // Saves live in IndexedDB (IDBFS at /easyrpg/<game>/Save); the player syncs after each save, this forces one.
  saveNow() {
    const fs = player?.FS;
    return fs ? new Promise((resolve, reject) => fs.syncfs(false, (err) => (err ? reject(err) : resolve()))) : Promise.resolve();
  },
};
