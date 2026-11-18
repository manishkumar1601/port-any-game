// rebuild-love adapter: love.js 11.4.1 (LÖVE 11.4 in wasm, MIT; the compat build, in this hashed runtime folder) plays the
// user's .love from OPFS. Its bytes go straight into love.js's in-memory file system as /game.love (spike g Q2): no
// game.data, no love.js CLI. No DOM at module top level: the Node tests import this file.

const SAVE_EVERY_MS = 30000;
let frames = 0;
let running = true;
let started = false;
let syncSaves = null;

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

// Saves live in IDBFS under /home/web_user/love; love.js writes them to IndexedDB only from the beforeunload listener
// it adds while Love() runs, and does not export FS (spike g Q6). A synthetic beforeunload would also reach SDL, which
// answers it with SDL_APP_TERMINATING, and LÖVE quits. So start() keeps that listener and saveNow() calls it directly.
async function saveNow() {
  if (!started) throw new Error('love.js has not started: nothing to save');
  if (!syncSaves) throw new Error('love.js registered no beforeunload save listener; saves cannot be synced');
  syncSaves(new Event('beforeunload'));
}
const saveQuietly = () => saveNow().catch(() => {});

export default {
  id: 'rebuild-love',
  async start(ctx) {
    const { file, offset = 0 } = ctx.config.lane_config ?? {};
    if (!file) throw new Error('shell.json has no lane_config.file (run pag build, then pag pack)');
    const canvas = Object.assign(document.createElement('canvas'), { id: 'canvas', tabIndex: -1 }); // SDL's mouse handlers look it up by id
    // SDL scales mouse positions by the canvas's CSS box, so the box must be the picture (no object-fit letterbox).
    // ponytail: the game's own size, shrunk to fit but never enlarged; scale it up with a ResizeObserver if wanted.
    canvas.style.cssText = 'position:absolute;inset:0;margin:auto;width:auto;height:auto;max-width:100%;max-height:100%;outline:none';
    ctx.host.append(canvas);
    const bytes = (await ctx.files.read(file)).subarray(offset);
    // A Lua error screen still paints frames: love's own error text is the signal.
    let failed = false;
    let last = '';
    const fail = (msg) => { if (!failed) { failed = true; ctx.reportError(new Error(msg)); } };
    const out = (log) => (t) => {
      log('[love]', t);
      last = t;
      if (/^Error|stack traceback/.test(t)) fail(`the game stopped with a Lua error: ${t}`);
    };
    // For the page's lifetime: LÖVE's version-mismatch message box is a blocking alert() (spike g Q5), and love.js
    // reports some start-up failures with emscripten_run_script("alert(...)"), an eval the CSP blocks.
    window.alert = (msg) => console.warn('[rebuild-love]', msg);
    window.eval = () => fail(`the game failed to start: ${last}`);
    await loadScript(new URL('src/compat/love.js', import.meta.url).href);
    const Module = {
      arguments: ['./game.love'],
      INITIAL_MEMORY: 16777216,
      canvas,
      locateFile: (p) => new URL(`src/compat/${p}`, import.meta.url).href,
      print: out(console.log),
      printErr: out(console.warn),
      preRun: [() => Module.FS_createDataFile('/', 'game.love', bytes, true, true, true)],
      preMainLoop: () => running,
      postMainLoop() { frames++; ctx.reportFrame(); },
    };
    let ready;
    window.addEventListener = (type, fn, ...rest) => {
      if (type === 'beforeunload') syncSaves ??= fn;
      return EventTarget.prototype.addEventListener.call(window, type, fn, ...rest);
    };
    try { ready = window.Love(Module); } finally { delete window.addEventListener; }
    await ready;
    started = true;
    canvas.focus();
    // ponytail: saves sync every 30 s, when the tab hides (the shell calls pause()) and on pagehide; a save made seconds
    // before a crash can be lost.
    setInterval(saveQuietly, SAVE_EVERY_MS);
    addEventListener('pagehide', saveQuietly);
  },
  pause() { saveQuietly(); running = false; },
  resume() { running = true; },
  frameCounter: () => frames,
  saveNow,
};
