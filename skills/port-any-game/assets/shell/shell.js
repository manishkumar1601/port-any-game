// port-any-game web shell: lifecycle, capability checks, BYO import, Play, window.__shell. Every lane runs inside it.
// No-black-screen rules (spec §8): readyState-safe boot; a live placeholder under the Play overlay; the adapter's
// start() and every shell frame run in try/catch -> reportError (uncaught page errors too, but while the game runs only
// once its loop stops: M2);
// fixed layer order (shell.css). No network beyond same-origin GETs of this build's own files.
import { normalizePath, pathLookup, parseVerifyParams, stallWatch } from './pure.js';
import * as storage from './storage.js';
import { fromDataTransfer, fromDirectoryHandle, fromFileList, fromFixture, importFiles, missingFiles, opfsFiles } from './import.js';
import { installInput } from './input.js';
import { audioRms, createAudio, installAudioTap } from './audio.js';

const STATES = new Set(['boot', 'checking', 'needs-files', 'importing', 'downloading', 'ready', 'running', 'paused', 'error']);
// i8x16.popcnt probe (wasm-feature-detect)
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

let state = 'boot';
let config, manifest, files, lane, input, placeholder, verifyParams;
let starting = false;
const stats = { rafFrames: 0, gameFrames: 0, inputEvents: 0, wasmBytes: 0, audioRms: null, lastError: null };
const $ = (id) => document.getElementById(id);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

function setStatus(text) { $('status').textContent = text; }

// The only way state changes. Fires `shell:state` on window with {state, prev}.
function setState(next, status) {
  if (!STATES.has(next)) throw new Error(`unknown shell state '${next}'`);
  const prev = state;
  state = next;
  document.body.dataset.state = next;
  if (status !== undefined) setStatus(status);
  if (prev !== next) window.dispatchEvent(new CustomEvent('shell:state', { detail: { state: next, prev } }));
}

function explain(msg) {
  if (location.protocol === 'file:') return 'Open this build through `pag serve` (or a launcher); browsers block it on file://.';
  if (/cross-origin isolation|SharedArrayBuffer/i.test(msg)) return 'This build needs cross-origin isolation. Serve it with its _headers file (`pag serve` does).';
  if (/WebGL|WebGPU|SIMD|JSPI/.test(msg)) return 'Try an up-to-date Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
  return 'The details above help when you report the problem.';
}

function reportError(err, where = 'lane') {
  const msg = String(err?.stack || err?.message || err);
  stats.lastError = msg;
  console.error(`[shell] ${where} error:`, err);
  $('error-text').textContent = msg;
  $('error-help').textContent = explain(msg);
  setState('error');
}

const reportFrame = () => { stats.gameFrames++; };

// M2: while the game runs, an uncaught page (or game iframe) error is logged and kept in stats.lastError; it turns into
// the error screen only if the game loop stops after it. Before Play it is fatal as always.
const stall = stallWatch();
function pageError(err) {
  if (state !== 'running' && state !== 'paused') return reportError(err, 'page');
  stats.lastError = String(err?.stack || err?.message || err);
  console.error('[shell] page error (the game keeps running):', err);
  stall.error(err, stats.gameFrames, performance.now());
}

function missingCapabilities(req = {}, needsCoi = false, byo = false) {
  const missing = [];
  if (byo && !navigator.storage?.getDirectory) missing.push('origin private file storage (open the build over https or localhost)');
  if (req.webgl2) {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (!gl) missing.push('WebGL2');
  }
  if (req.webgpu && !navigator.gpu) missing.push('WebGPU');
  if ((req.threads || needsCoi) && !(globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function')) missing.push('threads (cross-origin isolation)');
  if (req.simd && !WebAssembly.validate(SIMD_PROBE)) missing.push('WebAssembly SIMD');
  if (req.jspi && !('Suspending' in WebAssembly)) missing.push('JSPI');
  return missing;
}

async function getJson(url, init) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// ctx.files: manifest paths. BYO reads OPFS File snapshots; bundled builds read game/ over HTTP.
function makeFiles(opfs) {
  const paths = manifest.files.map((f) => f.path);
  const find = pathLookup(paths);
  const key = (p) => {
    const k = find(normalizePath(p) ?? '');
    if (!k) throw new Error(`no such game file: ${p}`);
    return k;
  };
  const httpUrl = (k) => new URL(`game/${k.split('/').map(encodeURIComponent).join('/')}`, location.href).href;
  const blobUrls = new Map();
  return {
    list: () => paths.slice(),
    url(p) {
      const k = key(p);
      if (!opfs) return httpUrl(k);
      if (!blobUrls.has(k)) blobUrls.set(k, URL.createObjectURL(opfs.get(k)));
      return blobUrls.get(k);
    },
    async read(p) {
      const k = key(p);
      if (opfs) return new Uint8Array(await opfs.get(k).arrayBuffer());
      const r = await fetch(httpUrl(k));
      if (!r.ok) throw new Error(`${k}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

async function byoReady() {
  files = makeFiles(await opfsFiles(manifest));
  setState('ready', 'Ready.');
}

// pending: the candidate list, or a promise of it (started synchronously by the caller).
async function runImport(pending) {
  if (state !== 'needs-files' && state !== 'checking') return;
  setState('importing', 'Reading the folder…');
  try {
    const candidates = await pending;
    setStatus('Copying game files into this browser. Nothing leaves this device.');
    const r = await importFiles(manifest, candidates, {
      interruptAfter: verifyParams.interruptAfter,
      onProgress: (done, total) => { const p = $('progress'); p.max = total || 1; p.value = done; },
    });
    const left = await missingFiles(manifest);
    if (!left.length) { await storage.persist(); return byoReady(); }
    const why = new Map(r.failed.map((f) => [f.path, f.error]));
    const lines = left.slice(0, 5).map((e) => `${e.path}: ${why.get(e.path) ?? 'not found in the chosen folder'}`);
    setState('needs-files', `${left.length} of ${manifest.files.length} game files are still missing. Choose the folder that has them.\n${lines.join('\n')}`);
  } catch (e) { reportError(e, 'import'); }
}

async function checkByo() {
  if (!(await missingFiles(manifest)).length) return byoReady();
  if (verifyParams.importUrl) return runImport(fromFixture(verifyParams.importUrl));
  setState('needs-files', `This build plays your own copy of the game. Choose its folder (${manifest.files.length} files, ${mb(manifest.total_bytes)}); the files stay on this device.`);
}

async function pickFolder() {
  if (!window.showDirectoryPicker) return $('dir-input').click();
  try { await runImport(fromDirectoryHandle(await window.showDirectoryPicker({ mode: 'read' }))); }
  catch (e) { if (e?.name !== 'AbortError') setStatus(`${e.message} Try the classic folder chooser.`); }
}

async function play() {
  if (state !== 'ready' || starting) return;
  starting = true;
  let audio = null;
  try { audio = createAudio(); } catch (e) { console.warn('[shell] no audio:', e); } // synchronous: inside the click
  setStatus('Starting…');
  try {
    lane = (await import(new URL(config.entry.adapter, location.href).href)).default;
    if (typeof lane?.start !== 'function') throw new Error(`${config.entry.adapter} does not export a lane adapter`);
    window.__shell.lane = lane;
    placeholder?.remove();
    placeholder = null;
    await lane.start({ host: $('host'), files, audio: { context: audio }, reportFrame, reportError, reportPageError: pageError, config });
    if (state === 'ready') setState('running', '');
  } catch (e) { reportError(e, 'start'); }
}

function callLane(method) {
  try { lane?.[method]?.(); } catch (e) { reportError(e, method); }
}

function drawPlaceholder() {
  const g = placeholder.getContext('2d');
  const t = stats.rafFrames / 3;
  const grad = g.createLinearGradient(0, 0, placeholder.width, placeholder.height);
  grad.addColorStop(0, `hsl(${t % 360} 40% 24%)`);
  grad.addColorStop(1, `hsl(${(t + 140) % 360} 40% 12%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, placeholder.width, placeholder.height);
}

function tick() {
  requestAnimationFrame(tick);
  stats.rafFrames++;
  try {
    input.poll();
    stats.audioRms = audioRms();
    if (placeholder) drawPlaceholder();
    if (state === 'running' && typeof lane.frameCounter === 'function') {
      const n = lane.frameCounter();
      if (Number.isFinite(n) && n > stats.gameFrames) stats.gameFrames = n;
    }
    const stopped = state === 'running' && stall.tick(stats.gameFrames, performance.now());
    if (stopped) reportError(stopped, 'page');
  } catch (e) { reportError(e, 'frame'); }
}

async function boot() {
  verifyParams = parseVerifyParams(location.search);
  const api = {
    stats,
    lane: null,
    storage: {
      selfTest: () => storage.selfTest(),
      async exportSaves() {
        try { await lane?.saveNow?.(); } catch (e) { reportError(e, 'saveNow'); }
        return storage.exportSaves(config?.data.saves);
      },
      importSaves: (blob) => storage.importSaves(blob, config?.data.saves),
    },
    debug: {
      // Lanes may replace this (e.g. WebGPU readback).
      captureFrame() {
        const c = [...$('host').querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
        return c ? c.toDataURL('image/png') : null;
      },
    },
  };
  Object.defineProperty(api, 'state', { get: () => state, enumerable: true });
  window.__shell = api;
  window.addEventListener('error', (e) => pageError(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => pageError(e.reason));
  installAudioTap();
  input = installInput(api);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (/\.wasm(\?|$)/.test(e.name)) stats.wasmBytes += e.decodedBodySize || e.transferSize || 0;
    }).observe({ type: 'resource', buffered: true });
  } catch { /* no resource timing */ }

  placeholder = Object.assign(document.createElement('canvas'), { width: 320, height: 200, className: 'placeholder' });
  $('host').append(placeholder);
  requestAnimationFrame(tick);

  $('play').addEventListener('click', play);
  $('pick').addEventListener('click', pickFolder);
  $('dir-input').addEventListener('change', (e) => runImport(fromFileList(e.target.files)));
  const stage = $('stage');
  stage.addEventListener('dragover', (e) => { if (state === 'needs-files') e.preventDefault(); });
  stage.addEventListener('drop', (e) => {
    if (state !== 'needs-files') return;
    e.preventDefault();
    runImport(fromDataTransfer(e.dataTransfer)); // synchronous call: items vanish after this handler
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'running') { callLane('pause'); if (state === 'running') setState('paused', 'Paused.'); }
    else if (!document.hidden && state === 'paused') { stall.resume(performance.now()); callLane('resume'); if (state === 'paused') setState('running', ''); }
  });

  setState('checking', 'Checking this browser…');
  try {
    config = await getJson('shell.json', { cache: 'no-store' }); // it names the content-hashed runtime folder (R30)
    if (config.schema !== 1) throw new Error(`shell.json schema ${config.schema} is not supported by this shell`);
    $('title').textContent = config.game_id;
    document.title = config.game_id;
    const missing = missingCapabilities(config.requires, config.needs_coi, config.data.mode === 'byo');
    if (missing.length) throw new Error(`Unsupported environment: this browser lacks ${missing.join(', ')}.`);
    manifest = await getJson(config.data.manifest);
    if (config.data.mode === 'byo') await checkByo();
    else { files = makeFiles(null); setState('ready', 'Ready.'); }
  } catch (e) { reportError(e, 'boot'); }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
