// dos-jsdos adapter (R42): js-dos 8.5.4's raw emulators API runs DOSBox (backend `dosbox`) in a Web Worker on the user's
// files from OPFS. The .jsdos bundle (a zip) is built here in the browser and never leaves it. js-dos itself sits in
// this hashed runtime folder under dist/emulators/. No DOM at module top level: build and the Node tests import
// dosPath, dosboxConf and keyCode.
// zip.js is the shell's own, imported relative to this file: runtime/<lane>-<hash>/ -> shell/ in dist, and
// assets/lanes/dos-jsdos/ -> assets/shell/ in the repo (runtime.files can only name files of the js-dos tool).
import { createZip } from '../../shell/zip.js';

// DOSBox's name for one path segment (drive_cache CreateShortName): upper case, spaces dropped; a base over 8
// characters, an extension over 3 or a second dot gives the first 6 characters + "~1" + the last extension cut to 3.
// ponytail: always ~1; DOSBox numbers long names that share their first letters ~2, ~3 in directory order.
function short83(seg) {
  const up = seg.toUpperCase();
  const t = up.replace(/ /g, '');
  const first = t.indexOf('.');
  const last = t.lastIndexOf('.');
  const base = first < 0 ? t : t.slice(0, first);
  const ext = last < 0 ? '' : t.slice(last + 1);
  if (t === up && base.length <= 8 && ext.length <= 3 && first === last) return t;
  return `${base.slice(0, 6)}~1${ext ? `.${ext.slice(0, 3)}` : ''}`;
}

// 'data/Game.exe' -> 'DATA/GAME.EXE' (relative, '/'-separated, each segment as DOSBox shows it).
export const dosPath = (rel) => rel.split(/[\\/]/).filter(Boolean).map(short83).join('/');

// The bundle's .jsdos/dosbox.conf: mount the bundle root as C: and run the exe (cd into its folder first).
export function dosboxConf({ exe, cycles = 'auto' }) {
  const dirs = dosPath(exe).split('/');
  const name = dirs.pop();
  return ['[cpu]', `cycles=${cycles}`, '', '[autoexec]', 'mount c .', 'c:', ...(dirs.length ? [`cd ${dirs.join('\\')}`] : []), name, ''].join('\n');
}

// KeyboardEvent.code -> ci.sendKeyEvent code, from the KBD_* table in js-dos 8.5.4 dist/js-dos.js (GLFW numbering).
const KEYS = {
  Space: 32, Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47, Semicolon: 59, Equal: 61, BracketLeft: 91,
  Backslash: 92, BracketRight: 93, Backquote: 96, Escape: 256, Enter: 257, Tab: 258, Backspace: 259, Insert: 260,
  Delete: 261, ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265, PageUp: 266, PageDown: 267, Home: 268,
  End: 269, CapsLock: 280, ScrollLock: 281, NumLock: 282, PrintScreen: 283, Pause: 284, NumpadDecimal: 330,
  NumpadDivide: 331, NumpadMultiply: 332, NumpadSubtract: 333, NumpadAdd: 334, NumpadEnter: 335, ShiftLeft: 340,
  ControlLeft: 341, AltLeft: 342, ShiftRight: 344, ControlRight: 345, AltRight: 346, IntlBackslash: 348,
};
for (let i = 0; i < 26; i++) KEYS[`Key${String.fromCharCode(65 + i)}`] = 65 + i;
for (let i = 0; i < 10; i++) { KEYS[`Digit${i}`] = 48 + i; KEYS[`Numpad${i}`] = 320 + i; }
for (let i = 1; i <= 12; i++) KEYS[`F${i}`] = 289 + i;
export const keyCode = (code) => KEYS[code];

let ci = null;
let frames = 0;
let running = true;
const down = new Set();

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
});

function onKey(e) {
  const k = KEYS[e.code];
  if (!ci || !running || k === undefined) return;
  e.preventDefault();
  const pressed = e.type === 'keydown';
  if (pressed) down.add(k); else down.delete(k);
  ci.sendKeyEvent(k, pressed); // repeats too, like a real keyboard's typematic make codes (and js-dos's own UI)
}

function releaseKeys() {
  for (const k of down) ci?.sendKeyEvent(k, false);
  down.clear();
}

// onSoundPush gives mono Float32 chunks at ci.soundFrequency(); each is queued as a buffer source just behind the last.
// ponytail: best effort; after an underrun the queue restarts 50 ms ahead, and more than 0.5 s queued is dropped.
function soundOut(ac) {
  let at = 0;
  return (samples) => {
    const rate = ci.soundFrequency();
    if (!running || !rate || !samples?.length || ac.state !== 'running') return;
    const now = ac.currentTime;
    if (at < now) at = now + 0.05;
    else if (at > now + 0.5) return;
    const b = ac.createBuffer(1, samples.length, rate);
    b.copyToChannel(samples, 0);
    const src = ac.createBufferSource();
    src.buffer = b;
    src.connect(ac.destination);
    src.start(at);
    at += b.duration;
  };
}

export default {
  id: 'dos-jsdos',
  async start(ctx) {
    const exe = ctx.config.lane_config?.exe;
    if (!exe) throw new Error('shell.json has no lane_config.exe (run pag build, then pag pack)');
    const base = new URL('dist/emulators/', import.meta.url).href;
    const entries = [];
    for (const name of ctx.files.list()) entries.push({ name, data: await ctx.files.read(name) });
    // ponytail: the whole game sits in memory twice while zipping; stream into js-dos initFs entries if big games need it.
    entries.push({ name: '.jsdos/dosbox.conf', data: new TextEncoder().encode(dosboxConf({ exe })) });
    const bundle = createZip(entries);

    await loadScript(`${base}emulators.js`);
    const emu = window.emulators;
    emu.pathPrefix = base;
    // The CSP has no 'unsafe-eval', and js-dos eval()s wdosbox.js on this thread only to hand the worker its compiled
    // wasm. Seed js-dos 8.5.4's module cache (window.compiled.WDOSBOX) with that wasm instead; the worker then runs
    // wdosbox.js from a blob: URL (worker-src blob:).
    const r = await fetch(`${base}wdosbox.wasm`);
    if (!r.ok) throw new Error(`could not load ${base}wdosbox.wasm (HTTP ${r.status})`);
    window.compiled.WDOSBOX = { wasmModule: await WebAssembly.compile(await r.arrayBuffer()) };
    ci = await emu.dosboxWorker(bundle);

    const canvas = document.createElement('canvas'); // on screen from its first frame: an unpainted canvas is a black box
    canvas.style.imageRendering = 'pixelated';
    const g = canvas.getContext('2d');
    let img = null;
    const fit = (w, h) => {
      if (!w || !h || (img && img.width === w && img.height === h)) return;
      canvas.width = w;
      canvas.height = h;
      img = g.createImageData(w, h);
    };
    const ev = ci.events();
    ev.onFrameSize(fit);
    ev.onFrame((rgb, rgba) => {
      const src = rgba ?? rgb;
      if (!src || !running) return;
      fit(ci.width(), ci.height());
      if (!img) return;
      const d = img.data;
      const step = rgba ? 4 : 3;
      for (let i = 0, o = 0; o < d.length && i + 2 < src.length; i += step, o += 4) {
        d[o] = src[i];
        d[o + 1] = src[i + 1];
        d[o + 2] = src[i + 2];
        d[o + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      if (!frames) ctx.host.append(canvas);
      frames++;
      ctx.reportFrame();
    });
    // DOSBox's ordinary logs ([LOG_EXEC], [LOG_SB], ...) also arrive as 'error'; js-dos itself treats only [panic] as
    // fatal, and [worker] is the worker's own onerror.
    ev.onMessage((type, msg) => { if (type === 'error' && /^\[(panic|worker)\]/.test(msg)) ctx.reportError(new Error(`js-dos: ${msg}`)); });
    ev.onExit(() => ctx.reportError(new Error('DOSBox exited')));
    const ac = ctx.audio.context;
    if (ac) {
      let push = soundOut(ac);
      ev.onSoundPush((s) => {
        try { push?.(s); } catch (e) { console.warn('[dos-jsdos] audio off:', e); push = null; }
      });
    }
    addEventListener('keydown', onKey);
    addEventListener('keyup', onKey);
    addEventListener('blur', releaseKeys);
  },
  pause() { running = false; releaseKeys(); ci?.pause(); },
  resume() { running = true; ci?.resume(); },
  frameCounter: () => frames,
};
