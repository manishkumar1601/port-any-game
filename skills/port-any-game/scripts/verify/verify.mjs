// `pag verify [dist]`: run a packed build and judge it (spec §9 steps 1-14, research note 05 §7b/§7c). Serves dist/,
// drives the user's Chrome/Edge over CDP (or Playwright from the tool cache), samples frames, audio, input, console
// and network, and writes <port>/verify/{report.json, step-*.png, console.log}.
// Exit 0 pass, 1 fail (also: not a packed build, bad arguments), 2 warn only, 3 unsupported environment.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { readPort } from '../pack.mjs';
import { startServer } from '../serve.mjs';
import { findBrowser, playwrightEntry } from './browser.mjs';
import { frameStats, heapGrowth, isCrossOrigin, judge, meanAbsDiff, THRESHOLDS as T } from './checks.mjs';
import { probe, staticChecks } from './static.mjs';

const INSTRUMENT = fileURLToPath(new URL('./instrument.js', import.meta.url));
const BROWSERS = ['chromium', 'firefox', 'webkit'];
const EXIT = { pass: 0, fail: 1, warn: 2, unsupported: 3 };
const SAMPLES = 21; // frame samples 0.5 s apart: 10 s while running (spec §9 step 7)
const MAX_SOAK_S = 3600;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
const isDir = (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;

// Page-side functions, sent as source text through Driver.evaluate: they must not close over anything in Node.
const PAGE = {
  state: () => ({ state: window.__shell?.state ?? null, lastError: window.__shell?.stats.lastError ?? null, status: document.getElementById('status')?.textContent ?? '' }),
  tick: () => {
    const s = window.__shell;
    const v = window.__pagVerify;
    return { state: s?.state ?? null, lastError: s?.stats.lastError ?? null, gameFrames: s?.stats.gameFrames ?? 0, inputEvents: s?.stats.inputEvents ?? 0, frame: v?.sample() ?? null, audio: v?.audio() ?? null };
  },
  soak: () => ({ heap: window.__pagVerify?.heap() ?? null, gameFrames: window.__shell?.stats.gameFrames ?? 0 }),
  play: () => {
    const r = document.getElementById('play')?.getBoundingClientRect();
    return r?.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  },
  env: () => {
    let renderer = null;
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      renderer = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch { /* no WebGL */ }
    return { coi: globalThis.crossOriginIsolated === true, renderer, userAgent: navigator.userAgent };
  },
  pad: (on) => window.__pagVerify?.pad(on),
  saveWrite: async (token) => {
    const selfTest = await window.__shell.storage.selfTest();
    await window.__shell.storage.exportSaves(); // runs the lane's saveNow()
    localStorage.setItem('pag-verify-token', token);
    return selfTest;
  },
  saveRead: () => {
    const t = localStorage.getItem('pag-verify-token');
    localStorage.removeItem('pag-verify-token');
    return t;
  },
  overflow: () => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }),
};
const call = (d, fn, arg) => d.evaluate(fn.toString(), arg);
const pixels = (f) => (f?.data ? Uint8Array.from(f.data) : null);

// Polls __shell.state until it is in `want`, reaches a dead end (error, needs-files) or times out.
async function waitState(d, want, timeoutS) {
  const t0 = Date.now();
  for (;;) {
    const s = await call(d, PAGE.state).catch(() => null); // null while the page navigates or is busy
    const secs = (Date.now() - t0) / 1000;
    if (s && [...want, 'error', 'needs-files'].includes(s.state)) return { ...s, secs };
    if (secs > timeoutS) return { ...s, secs, timedOut: timeoutS };
    await sleep(100);
  }
}

// auto: the user's Chrome/Edge over CDP, else Playwright from the tool cache, else unsupported (exit 3).
function pickRunner(runner, browser) {
  const exe = browser === 'chromium' && typeof WebSocket === 'function' ? findBrowser() : null;
  if (runner !== 'playwright' && exe) return { kind: 'cdp', exe };
  if (runner !== 'cdp' && playwrightEntry()) return { kind: 'playwright' };
  const pin = process.env.PAG_BROWSER ? ` (PAG_BROWSER=${process.env.PAG_BROWSER})` : '';
  return {
    unsupported: [
      runner !== 'playwright' && (browser !== 'chromium' ? `the CDP runner drives Chrome/Edge only, not ${browser}`
        : typeof WebSocket !== 'function' ? 'the CDP runner needs Node 22+ (global WebSocket)' : `no Chrome or Edge found${pin}`),
      runner !== 'cdp' && 'Playwright is not installed (pag setup playwright --yes)',
    ].filter(Boolean).join('; '),
  };
}

// Steps 3-13 in one browser. Returns {runner, browserPath, unsupported?, checks, measures, requests, console}.
async function runBrowser(browser, o) {
  const pick = pickRunner(o.runner, browser);
  const env = (why, extra = {}) => ({ runner: pick.kind ?? null, unsupported: why, checks: [{ name: 'environment', status: 'unsupported', detail: why }], ...extra });
  if (pick.unsupported) return env(pick.unsupported);
  const initScript = readFileSync(INSTRUMENT, 'utf8');
  let d;
  try {
    d = pick.kind === 'cdp'
      ? await (await import('./driver-cdp.mjs')).openCdp({ path: pick.exe.path, headless: !o.headed, initScript })
      : await (await import('./driver-playwright.mjs')).openPlaywright({ browser, headless: !o.headed, initScript });
  } catch (e) { return env(`cannot start ${pick.exe?.path ?? `Playwright ${browser}`}: ${e.message}`); }

  const m = { checks: [], errors: { pageErrors: [], consoleErrors: [] } };
  const requests = [];
  const responses = [];
  const lines = [];
  const origin = new URL(o.url).origin;
  const rel = (u) => (isCrossOrigin(u, origin) || !u.startsWith(origin) ? u : u.slice(origin.length));
  d.onConsole(({ level, text }) => {
    lines.push(`[${o.prefix}${level}] ${text}`);
    if (level === 'pageerror') m.errors.pageErrors.push(text);
    else if (level === 'error') m.errors.consoleErrors.push(text);
  });
  d.onRequest((q) => requests.push(q));
  d.onResponse((r) => responses.push(r));
  const popups = [];
  d.onPopup(({ url }) => popups.push(url));
  let n = 0;
  const shot = (name) => d.screenshot(path.join(o.out, `step-${o.prefix}${++n}-${name}.png`)).catch(() => {});
  const play = async () => {
    const at = await call(d, PAGE.play);
    if (!at) throw new Error('the Play button is not visible in state ready');
    await d.click(at.x, at.y); // trusted click: the shell creates the AudioContext inside it
    return waitState(d, ['running'], 60);
  };
  let unsupported = null;

  const steps = async () => {
    // 4-5: instrumented load (BYO imports the fixture through the real OPFS pipeline via ?verify_import).
    await d.setViewport(1280, 800);
    await d.open(o.url);
    const first = await waitState(d, ['ready'], T.readyFirstS);
    m.ready = { firstS: first.secs, budget: o.shell.verify?.budget_ready_s ?? 15, timedOut: first.timedOut, mbps: o.byo && first.secs > 0 ? o.manifest.total_bytes / 1e6 / first.secs : null };
    m.shell = first;
    await shot('ready');
    // 3: the shell reports missing capabilities as "Unsupported environment"; that is not the lane's failure.
    if (first.state === 'error' && /Unsupported environment/.test(first.lastError ?? '')) { unsupported = first.lastError; return; }
    if (first.state !== 'ready') return;
    m.env = await call(d, PAGE.env);
    if (o.shell.needs_coi && !m.env.coi) m.checks.push({ name: 'isolation', status: 'fail', detail: 'needs_coi, but the page is not cross-origin isolated' });

    // 6-7, 9: Play, then 10 s of samples (frames, game frame rate and stalls, audio).
    m.shell = await play();
    if (m.shell.state !== 'running') return;
    await shot('play');
    m.frames = [];
    m.diffs = [];
    m.loop = { window: [] };
    let firstTick, last, prev, t0, t1;
    let rms = 0;
    for (let i = 0; i < SAMPLES; i++) {
      if (i) await sleep(500);
      last = await call(d, PAGE.tick);
      t1 = Date.now();
      firstTick ??= last;
      t0 ??= t1;
      m.loop.window.push({ t: (t1 - t0) / 1000, frames: last.gameFrames });
      const px = pixels(last.frame);
      m.frames.push(px && frameStats(px, last.frame.w, last.frame.h));
      if (px && prev) m.diffs.push(meanAbsDiff(prev, px));
      prev = px ?? prev;
      rms = Math.max(rms, last.audio?.rms ?? 0);
      if (last.state !== 'running') break;
    }
    m.fps = { frames: last.gameFrames - firstTick.gameFrames, seconds: (t1 - t0) / 1000, target: o.shell.verify?.target_fps ?? 30, software: SOFTWARE.test(m.env.renderer ?? '') };
    m.audio = { contexts: last.audio?.contexts.length ?? 0, running: last.audio?.contexts.includes('running') ?? false, rms, expected: o.shell.verify?.audio_on_title === true };
    m.shell = last;
    if (last.state !== 'running') return;

    // 8: the lane's input script (keys by KeyboardEvent.code) plus the fake gamepad; the picture must change within 3 s.
    const inputs = o.shell.verify?.inputs ?? [];
    if (inputs.length) {
      const before = await call(d, PAGE.tick);
      const px0 = pixels(before.frame);
      for (const code of inputs) await d.key(code);
      await call(d, PAGE.pad, true);
      await sleep(100);
      await call(d, PAGE.pad, false);
      m.input = { events: 0, diff: 0 };
      for (const end = Date.now() + T.inputWindowS * 1000; Date.now() < end; await sleep(250)) {
        const s = await call(d, PAGE.tick);
        const px = pixels(s.frame);
        m.input.events = s.inputEvents - before.inputEvents;
        if (px && px0) m.input.diff = Math.max(m.input.diff, meanAbsDiff(px0, px));
        if (m.input.events > 0 && m.input.diff >= T.frozenDiff) break;
      }
      await shot('input');
    }

    // 11 (before 10, while this session is running, so a reload needs Play again only for the soak and stages):
    // viewports; the layout must not overflow horizontally.
    m.viewports = [];
    for (const [name, w, h] of [['desktop', 1280, 800], ['mobile', 390, 844]]) {
      await d.setViewport(w, h);
      await sleep(300);
      m.viewports.push({ name, w, h, ...(await call(d, PAGE.overflow)) });
      await shot(name);
    }
    await d.setViewport(1280, 800);

    // 10: save round-trip across a reload (also the cached ready time).
    const token = randomUUID();
    const selfTest = await call(d, PAGE.saveWrite, token);
    const tr = Date.now();
    await d.reload();
    const again = await waitState(d, ['ready'], T.readyCachedS);
    m.ready.cachedS = (Date.now() - tr) / 1000;
    if (again.timedOut) m.ready.timedOut = T.readyCachedS;
    m.save = { ok: selfTest?.ok === true && (await call(d, PAGE.saveRead)) === token, persisted: selfTest?.persisted === true };
    if (!selfTest?.ok) m.save.error = `storage self-test failed: ${selfTest?.error ?? 'no OPFS'}`;
    m.shell = again;
    if (again.state !== 'ready') return;

    // 12: soak: the loop keeps running (no gameFrames stall over 2 s) and the JS heap does not grow.
    if (o.soakSec > 0) {
      m.shell = await play();
      if (m.shell.state !== 'running') return;
      const heap = [];
      const ts = Date.now();
      m.loop.soak = [];
      for (;;) {
        const z = await call(d, PAGE.soak);
        m.loop.soak.push({ t: (Date.now() - ts) / 1000, frames: z.gameFrames });
        heap.push(z.heap);
        if (Date.now() - ts >= o.soakSec * 1000) break;
        await sleep(Math.min(1000, o.soakSec * 1000));
      }
      const secs = (Date.now() - ts) / 1000;
      m.memory = { seconds: secs, growthPctPerMin: heapGrowth(heap, secs) };
      await shot('soak');
      m.shell = await call(d, PAGE.state);
    }

    // Stage hooks (spec §8): each stage must reach running and show a non-blank picture.
    const stages = o.shell.verify?.stages ?? [];
    if (stages.length) {
      m.stages = [];
      for (const name of stages) {
        await d.open(`${o.url}&verify_stage=${encodeURIComponent(name)}`);
        let s = await waitState(d, ['ready'], T.readyCachedS);
        if (s.state === 'ready') s = await play();
        if (s.state === 'running') await sleep(1000);
        const t = await call(d, PAGE.tick);
        const px = pixels(t.frame);
        m.stages.push({ name, state: t.state, frame: px && frameStats(px, t.frame.w, t.frame.h) });
        await shot(`stage-${name.replace(/[^\w-]/g, '_')}`);
      }
    }
  };

  try { await steps(); } catch (e) { m.checks.push({ name: 'run', status: 'fail', detail: e.message }); } finally { await d.close(); }

  // 13: requests. Own-origin ones must succeed; BYO sends no bodies, nothing cross-origin and opens no popups
  // (a popup's own requests are not recorded).
  m.requests = responses.filter((r) => /^https?:/.test(r.url) && !isCrossOrigin(r.url, origin)).map((r) => ({ ...r, url: rel(r.url) }));
  if (o.byo) m.privacy = { withBody: requests.filter((q) => q.hasBody).map((q) => `${q.method} ${rel(q.url)}`), crossOrigin: requests.filter((q) => q.crossOrigin).map((q) => q.url), popups };
  const extra = {
    browserPath: pick.exe?.path ?? null, measures: m, console: lines, popups,
    requests: requests.filter((q) => /^https?:/.test(q.url)).map((q) => ({ method: q.method, url: rel(q.url), ...(q.hasBody ? { hasBody: true } : {}), ...(q.crossOrigin ? { crossOrigin: true } : {}) })),
  };
  if (unsupported) return env(unsupported, extra);
  return { runner: pick.kind, ...extra, checks: judge(m).checks };
}

// Nearest port.json at or above dist. The first one found decides: an unreadable one is an error (readPort throws),
// never a reason to report into some other port further up.
function portOf(dist) {
  for (let d = dist; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, 'port.json'))) return { dir: d, port: readPort(d) };
    if (path.dirname(d) === d) return { dir: null, port: null };
  }
}

export async function verify(distDir, { runner = 'auto', soakSec = 60, headed = false, fixtureDir, browsers = ['chromium'], query = '' } = {}) {
  const dist = path.resolve(distDir);
  let shell;
  let manifest;
  try {
    shell = readJson(path.join(dist, 'shell.json'));
    manifest = readJson(path.join(dist, 'game', 'manifest.json'));
  } catch (e) { throw new Error(`${dist} is not a packed build (${e.code === 'ENOENT' ? 'no shell.json or game/manifest.json' : e.message}); run pag pack first`); }
  const { dir: port, port: portJson } = portOf(dist);
  const out = path.join(port ?? path.dirname(dist), 'verify');
  mkdirSync(out, { recursive: true });
  // Only our own files: without a port.json, out is <dist>/../verify, which could be a folder of the user's.
  for (const f of readdirSync(out)) if (/^(report\.json|console\.log|step-.*\.png)$/.test(f)) rmSync(path.join(out, f), { force: true });

  const checks = await staticChecks(dist, shell, manifest, portJson);
  const byo = shell.data?.mode === 'byo';
  // R31/R34: BYO imports straight from the port's game files; nothing is written into that folder.
  const fixture = !byo ? null : fixtureDir ? path.resolve(fixtureDir) : port && path.join(port, ...String(manifest.source ?? 'game').split('/'));
  if (byo) checks.push(fixture && isDir(fixture) ? { name: 'fixture', status: 'pass', detail: fixture }
    : { name: 'fixture', status: 'fail', detail: `BYO verify imports the game files from ${fixture ?? '<port>/game (no port.json found)'}, which is not a folder; pass --fixture <game folder>` });

  const serverLog = [];
  const srv = await startServer({
    root: dist, fixtureDir: fixture ?? undefined, caseFallback: shell.serve?.caseFallback === true, log: (msg) => serverLog.push(msg),
    fixtureIndex: byo ? (manifest.files ?? []).map((f) => ({ path: f.path, size: f.size })) : undefined,
  });
  const runs = [];
  try {
    checks.push(await probe(srv.url, shell, dist));
    const url = `${srv.url}/?verify=1${byo ? '&verify_import=/__fixture/' : ''}${query ? `&${query.replace(/^[?&]+/, '')}` : ''}`;
    for (const browser of browsers) {
      const prefix = browsers.length > 1 ? `${browser}-` : '';
      runs.push({ browser, ...(await runBrowser(browser, { runner, headed, url, shell, manifest, byo, soakSec, out, prefix })) });
    }
  } finally { await srv.close(); }

  const all = [...checks, ...runs.flatMap((r) => r.checks.map((c) => (browsers.length > 1 ? { ...c, name: `${r.browser} ${c.name}` } : c)))];
  const judged = judge({ checks: all }).status;
  const status = judged !== 'fail' && runs.some((r) => r.unsupported) ? 'unsupported' : judged;
  const count = (s) => all.filter((c) => c.status === s).length;
  const worst = all.find((c) => c.status === 'fail') ?? all.find((c) => c.status === 'unsupported') ?? all.find((c) => c.status === 'warn');
  const label = status === 'unsupported' ? 'UNSUPPORTED ENVIRONMENT' : status.toUpperCase();
  const summary = `verify ${label}: ${shell.game_id} (lane ${shell.lane}, ${shell.data?.mode}) on ${runs.map((r) => `${r.browser} via ${r.runner ?? 'nothing'}`).join(', ')}; `
    + `${count('fail')} fail, ${count('warn')} warn${worst ? `; ${worst.name}: ${worst.detail}` : ''}`;
  const report = {
    schema: 1, status, at: new Date().toISOString(), summary, dist, port, reportDir: out, lane: shell.lane, mode: shell.data?.mode,
    checks: all, runs: runs.map(({ checks: _c, console: _l, ...r }) => r), serverLog,
  };
  writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(out, 'console.log'), `${runs.flatMap((r) => r.console ?? []).join('\n')}\n`);
  return report;
}

const USAGE = 'usage: pag verify [dist] [--runner auto|cdp|playwright] [--soak SECONDS] [--headed] [--browser chromium|firefox|webkit|all] [--fixture DIR] [--query K=V&...] [--json]\n';

export async function run(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let args;
  try {
    args = parseArgs({
      args: argv, allowPositionals: true,
      options: { runner: { type: 'string', default: 'auto' }, soak: { type: 'string', default: '60' }, headed: { type: 'boolean', default: false }, browser: { type: 'string', default: 'chromium' }, fixture: { type: 'string' }, query: { type: 'string', default: '' }, json: { type: 'boolean', default: false } },
    });
    const v = args.values;
    if (args.positionals.length > 1) throw new Error('too many arguments');
    if (!['auto', 'cdp', 'playwright'].includes(v.runner)) throw new Error(`unknown runner '${v.runner}'`);
    const soak = Number(v.soak);
    if (!Number.isFinite(soak) || soak < 0 || soak > MAX_SOAK_S) throw new Error(`--soak takes 0 to ${MAX_SOAK_S} seconds, not '${v.soak}'`);
    if (![...BROWSERS, 'all'].includes(v.browser)) throw new Error(`unknown browser '${v.browser}'`);
  } catch (e) { io.err(`pag verify: ${e.message}\n${USAGE}`); return 1; }
  const v = args.values;
  try {
    const r = await verify(args.positionals[0] ?? 'dist', {
      runner: v.runner, soakSec: Number(v.soak), headed: v.headed, fixtureDir: v.fixture, query: v.query,
      browsers: v.browser === 'all' ? BROWSERS : [v.browser],
    });
    if (v.json) io.out(`${JSON.stringify(r, null, 2)}\n`);
    else io.out(`${[r.summary, ...r.checks.filter((c) => c.status !== 'pass').map((c) => `  ${c.status}: ${c.name}: ${c.detail}`), `report: ${path.join(r.reportDir, 'report.json')}`].join('\n')}\n`);
    return EXIT[r.status];
  } catch (e) { io.err(`pag verify: ${e.message}\n`); return 1; }
}
