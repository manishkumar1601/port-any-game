import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, skipReason } from '../e2e/run.mjs'; // sets temp PAG_CACHE / PAG_HOME

const { survey } = await import('../../skills/port-any-game/scripts/survey/survey.mjs');
const { newPort } = await import('../../skills/port-any-game/scripts/new.mjs');
const { LANES } = await import('../../skills/port-any-game/scripts/lanes/index.mjs');
const { extractZip } = await import('../../skills/port-any-game/scripts/lib/archive.mjs');
const { makeWebGame, makeZip, gameFiles } = await import('../fixtures/make-web-game.mjs');
const { makePE } = await import('../fixtures/make-pe.mjs');
const { injectHook, finishWebBuild } = await import('../../skills/port-any-game/scripts/lanes/web-extract.mjs');
const lane = LANES['web-extract'];
const ASSETS = new URL('../../skills/port-any-game/assets/lanes/web-extract/', import.meta.url);

const tmp = mkdtempSync(path.join(tmpdir(), 'pag-we-'));
after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); cleanup(); });
let n = 0;
const dirOf = () => path.join(tmp, `t${++n}`);

// A port for an install folder: {portDir}.
async function portOf(install) {
  const portDir = path.join(path.dirname(install), 'port');
  await newPort({ gameDir: install, outDir: portDir, lane: 'web-extract' });
  return portDir;
}
async function fixturePort(variant) {
  const install = makeWebGame(path.join(dirOf(), 'install'), variant);
  return { install, portDir: await portOf(install) };
}
function writeTree(root, files) {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    writeFileSync(path.join(root, p), c);
  }
}

for (const [variant, label, engine] of [['nwjs', 'NW.js', 'nwjs'], ['electron', 'Electron', 'electron']]) {
  test(`detect GO for ${label} variant`, async () => {
    const { install } = await fixturePort(variant);
    const s = await survey(install);
    assert.ok(s.engines.some((e) => e.id === engine), JSON.stringify(s.engines));
    assert.equal(lane.detect(s).verdict, 'GO');
  });
}

test('web-extract packs only what its build extracted (M4)', () => assert.equal(lane.requiresBuild, true));

test('detect NO without a web engine', () => assert.equal(lane.detect({ engines: [{ id: 'unity' }] }).verdict, 'NO'));

test('build extracts entry and reports node-api uses', async () => {
  const { portDir } = await fixturePort('nwjs');
  const gameBefore = readFileSync(path.join(portDir, 'game', 'package.nw'));
  const clean = await lane.build(portDir);
  assert.equal(clean.entryHtml, 'game/index.html');
  assert.equal(clean.verdict, 'GO');
  assert.equal(clean.nodeApiUses.length, 0);
  assert.equal(clean.caseFixes, 1);
  assert.ok(existsSync(path.join(portDir, 'build', 'game', 'index.html')));
  assert.ok(existsSync(path.join(portDir, 'build', 'game', 'img', 'title.png')));
  // The original is untouched and a second build wipes build/game first.
  assert.deepEqual(readFileSync(path.join(portDir, 'game', 'package.nw')), gameBefore);
  writeFileSync(path.join(portDir, 'build', 'game', 'stale.txt'), 'x');
  await lane.build(portDir);
  assert.ok(!existsSync(path.join(portDir, 'build', 'game', 'stale.txt')));

  // require('fs') injected into a copy of the game (package.nw as a folder).
  const install = path.join(dirOf(), 'install');
  const files = gameFiles();
  files['game.js'] = `${files['game.js']}\nconst fs = require('fs');\n`;
  writeTree(path.join(install, 'package.nw'), files);
  writeFileSync(path.join(install, 'nw.dll'), '');
  const port2 = await portOf(install);
  const r = await lane.build(port2);
  assert.equal(r.nodeApiUses.length, 1, JSON.stringify(r.nodeApiUses));
  assert.equal(r.nodeApiUses[0].file, 'game.js');
  assert.equal(r.nodeApiUses[0].api, 'require');
  assert.equal(r.verdict, 'HARD');
  const log = readFileSync(path.join(port2, 'PORTING_LOG.md'), 'utf8');
  assert.match(log, /## web-extract build/);
  assert.match(log, /game\.js:\d+ require/);
  assert.match(log, /- \[ \] Extract/, 'checklist lines are left alone');
});

test('build ignores uses guarded by Utils.isNwjs()', async () => {
  const install = path.join(dirOf(), 'install');
  writeTree(install, {
    'www/index.html': '<script src="js/a.js"></script>',
    'www/js/a.js': `if (Utils.isNwjs()) {\n  const fs = require('fs');\n}\n${'x;\n'.repeat(5)}require('late');\n`,
    'nw.dll': '',
  });
  const r = await lane.build(await portOf(install));
  assert.deepEqual(r.nodeApiUses.map((u) => u.line), [9]); // only the unguarded one
});

test('build reads the electron asar and fails clearly without content', async () => {
  const { portDir } = await fixturePort('electron');
  assert.equal((await lane.build(portDir)).verdict, 'GO');
  const install = path.join(dirOf(), 'install');
  writeTree(install, { 'nw.dll': '' });
  await assert.rejects(lane.build(await portOf(install)), /no web content found/);
});

test('build injects the frame hook first in <head> of the entry, leaving game/ untouched', async () => {
  const { portDir } = await fixturePort('nwjs');
  await lane.build(portDir);
  const html = readFileSync(path.join(portDir, 'build', 'game', 'index.html'), 'utf8');
  assert.match(html, /<head>\s*<script src="__pag_hook\.js"><\/script>/);
  assert.ok(existsSync(path.join(portDir, 'build', 'game', '__pag_hook.js')));
  assert.ok(!existsSync(path.join(portDir, 'game', '__pag_hook.js')));
});

// T16: the entry page keeps its own bytes (a Latin-1 page is not re-encoded as UTF-8); only the ASCII tag is spliced in.
test('build splices the hook tag into the entry bytes without re-encoding the page', async () => {
  const install = path.join(dirOf(), 'install');
  const page = Buffer.from('<html><head><meta charset="iso-8859-1"><title>Caf\xe9</title></head><body>\xe9t\xe9</body></html>', 'latin1');
  writeTree(install, { 'www/index.html': page, 'nw.dll': '' });
  const portDir = await portOf(install);
  await lane.build(portDir);
  const tag = Buffer.from('<script src="__pag_hook.js"></script>');
  const at = page.indexOf('<head>') + '<head>'.length;
  assert.deepEqual(readFileSync(path.join(portDir, 'build', 'game', 'index.html')), Buffer.concat([page.subarray(0, at), tag, page.subarray(at)]));
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  assert.deepEqual(injectHook(Buffer.concat([bom, Buffer.from('<p>x')]), 'h.js'), Buffer.concat([bom, Buffer.from('<script src="h.js"></script><p>x')]), 'after a BOM');
});

test('injectHook handles uppercase HEAD, no head, no html', () => {
  const tag = '<script src="h.js"></script>';
  assert.equal(injectHook('<!DOCTYPE html><HTML><HEAD lang=x><title>t</title></HEAD>', 'h.js'), `<!DOCTYPE html><HTML><HEAD lang=x>${tag}<title>t</title></HEAD>`);
  assert.equal(injectHook('<!doctype html><html><body>x</body></html>', 'h.js'), `<!doctype html><html>${tag}<body>x</body></html>`);
  assert.equal(injectHook('<!doctype html><p>x', 'h.js'), `<!doctype html>${tag}<p>x`);
  assert.equal(injectHook('<p>x', 'h.js'), `${tag}<p>x`);
  assert.equal(injectHook('<header>x</header><head>', 'h.js'), `<header>x</header><head>${tag}`, 'a <header> is not <head>');
});

test('package.json main wins over index.html, behind a meta-refresh; bad mains are ignored', async () => {
  const build = async (main) => {
    const install = path.join(dirOf(), 'install');
    writeTree(install, { 'nw.dll': '', 'package.nw/package.json': JSON.stringify({ main }), 'package.nw/index.html': '<p>index</p>', 'package.nw/app/start.html': '<head></head>start', 'package.nw/start.html': '<p>root</p>' });
    const portDir = await portOf(install);
    await lane.build(portDir);
    return path.join(portDir, 'build', 'game');
  };
  let out = await build('app/start.html');
  assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /url=app\/start\.html/);
  assert.match(readFileSync(path.join(out, 'app', 'start.html'), 'utf8'), /<head><script src="\.\.\/__pag_hook\.js">/, 'hook path is relative to the entry');
  assert.ok(readFileSync(path.join(out, '__pag_index_orig.html'), 'utf8').includes('index'), 'the original index.html is kept');
  for (const bad of ['../start.html', '/start.html', 'missing.html', 'main.js']) {
    out = await build(bad);
    assert.match(readFileSync(path.join(out, 'index.html'), 'utf8'), /<p>index<\/p>/, `${bad} falls back to index.html`);
    assert.ok(!existsSync(path.join(out, '__pag_index_orig.html')), bad);
  }
});

test('a failed build leaves no build/game behind', async () => {
  const install = path.join(dirOf(), 'install');
  writeTree(install, { 'nw.dll': '', 'package.nw/readme.txt': 'no html' });
  const portDir = await portOf(install);
  await assert.rejects(lane.build(portDir), /no entry HTML/);
  assert.ok(!existsSync(path.join(portDir, 'build', 'game')));
  assert.deepEqual(readdirSync(path.join(portDir, 'build')), []);
});

test('frame hook counts one frame per distinct timestamp, however many rAF consumers', () => {
  const cbs = [];
  const parent = { n: 0, __pagFrame() { this.n++; } };
  const win = { parent, requestAnimationFrame: (cb) => cbs.push(cb), addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL('frame-hook.js', ASSETS), 'utf8'), { window: win });
  const tick = (t) => { cbs.splice(0).forEach((cb) => cb(t)); };
  let calls = 0;
  const loop = () => { calls++; win.requestAnimationFrame(loop); };
  win.requestAnimationFrame(loop);
  win.requestAnimationFrame(loop); // a second consumer in the same frame
  tick(16);
  assert.equal(win.__pagFrames.frames, 1);
  tick(33);
  assert.equal(win.__pagFrames.frames, 2);
  assert.equal(parent.n, 2);
  assert.equal(calls, 4, 'every callback still runs');
});

// Runs the adapter against a fake iframe that behaves like a browser's: one contentWindow object for the iframe's whole
// life; each navigation swaps its document, and listeners live on the current document's global (the old ones are gone).
// fetch decides the HEAD result. Like Chrome, appending the iframe (no src yet) fires a synchronous load for the initial
// about:blank document (no meta refresh, so it looks like a finished entry); setting src then loads the meta-refresh stub.
async function startAdapter(headStatus = 200) {
  const newDoc = (refresh) => ({ target: new EventTarget(), querySelector: () => (refresh ? {} : null) });
  const win = {
    document: newDoc(false),
    location: { href: 'about:blank' },
    focusCalls: 0,
    focus() { this.focusCalls++; },
    addEventListener(...a) { this.document.target.addEventListener(...a); },
    dispatchEvent(e) { return this.document.target.dispatchEvent(e); },
  };
  const frame = Object.assign(new EventTarget(), { style: {}, setAttribute() {}, focus() {}, contentWindow: win });
  Object.defineProperty(frame, 'src', {
    set(v) {
      queueMicrotask(() => { win.location.href = `http://127.0.0.1/${v}`; win.document = newDoc(true); frame.dispatchEvent(new Event('load')); });
    },
  });
  const host = { append() { frame.dispatchEvent(new Event('load')); } }; // the synchronous about:blank load
  const saved = Object.fromEntries(['window', 'document', 'KeyboardEvent', 'fetch'].map((k) => [k, globalThis[k]]));
  globalThis.window = new EventTarget();
  globalThis.document = { createElement: () => frame };
  globalThis.KeyboardEvent = class extends Event { constructor(t, o) { super(t, o); this.code = o.code; this.key = o.key; } };
  globalThis.fetch = async () => ({ ok: headStatus === 200, status: headStatus });
  const restore = () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } };
  const adapter = (await import(new URL('adapter.js', ASSETS).href)).default;
  // start() resolves only after the real entry loads; the fake frame loads the meta-refresh stub first and stops there.
  const started = adapter.start({ host, audio: {}, reportFrame() {}, reportError() {} });
  started.catch(() => restore());
  if (headStatus !== 200) await started;
  await new Promise((r) => setTimeout(r, 5)); // the stub's load event
  return { frame, win, restore, started, navigate() { win.document = newDoc(false); frame.dispatchEvent(new Event('load')); } };
}

test('adapter mirrors iframe keys as cancelable events on the redirected document, once per document', async () => {
  const a = await startAdapter();
  try {
    assert.equal(a.win.focusCalls, 0, 'no focus on the meta-refresh stub');
    const press = (type) => {
      const seen = [];
      const on = (e) => { seen.push(e); e.preventDefault(); };
      window.addEventListener(type, on);
      const real = new KeyboardEvent(type, { code: 'Tab', key: 'Tab', cancelable: true });
      a.win.dispatchEvent(real);
      window.removeEventListener(type, on);
      return { seen, real };
    };
    let p = press('keydown');
    assert.equal(p.seen.length, 1, 'stub document: mirrored once');
    assert.equal(p.real.defaultPrevented, true);
    let resolved = false;
    a.started.then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(resolved, false, 'start() waits for the real entry, not the stub');
    a.navigate(); // the real entry loads in the same WindowProxy, with a fresh global
    await a.started;
    assert.equal(a.win.focusCalls, 1, 'focus once the real entry has loaded');
    p = press('keydown');
    assert.equal(p.seen.length, 1, 'redirected document: mirrored, not duplicated');
    assert.equal(p.seen[0].cancelable, true);
    assert.equal(p.real.defaultPrevented, true, 'the real iframe event is cancelled');
    a.frame.dispatchEvent(new Event('load')); // a repeated load event for the same document adds nothing
    assert.equal(press('keydown').seen.length, 1);
  } finally { a.restore(); }
});

test('adapter start() ignores the initial about:blank load (no early resolve or focus)', async () => {
  const a = await startAdapter(); // append fired the about:blank load; the meta-refresh stub has loaded too
  try {
    let resolved = false;
    a.started.then(() => { resolved = true; });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(resolved, false, 'about:blank is not the game');
    assert.equal(a.win.focusCalls, 0);
    a.navigate();
    await a.started;
    assert.equal(a.win.focusCalls, 1);
  } finally { a.restore(); }
});

test('adapter start() throws when the entry is a 404', async () => {
  await assert.rejects(startAdapter(404), /game\/index\.html \(HTTP 404\)/);
});

test('build prefers the main exe with a zip overlay over other exes', async () => {
  const install = path.join(dirOf(), 'install');
  mkdirSync(install, { recursive: true });
  const other = { ...gameFiles(), 'index.html': '<p>other</p>' };
  const big = { ...gameFiles(), 'pad.bin': randomBytes(20000) }; // the larger exe is the survey's main
  writeFileSync(path.join(install, 'Game.exe'), Buffer.concat([makePE(), makeZip(big)]));
  writeFileSync(path.join(install, 'A-helper.exe'), Buffer.concat([makePE(), makeZip(other)]));
  const portDir = await portOf(install);
  const sp = path.join(portDir, 'survey.json');
  const s = JSON.parse(readFileSync(sp, 'utf8'));
  assert.equal(s.executables.find((e) => e.role === 'main').path, 'Game.exe');
  s.executables.sort((x, y) => (x.role === 'main') - (y.role === 'main')); // main last: only the role preference picks it
  writeFileSync(sp, JSON.stringify(s));
  await lane.build(portDir);
  assert.ok(existsSync(path.join(portDir, 'build', 'game', 'pad.bin')));
  assert.ok(!readFileSync(path.join(portDir, 'build', 'game', 'index.html'), 'utf8').includes('<p>other</p>'));
});

test('extractZip copes with a zip64 record and locator in front of a valid 32-bit EOCD', async () => {
  const d = dirOf();
  mkdirSync(d, { recursive: true });
  const z = makeZip({ 'a.txt': 'hello' });
  const eocd = z.length - 22;
  const rec = Buffer.alloc(56); rec.writeUInt32LE(0x06064b50, 0);
  const loc = Buffer.alloc(20); loc.writeUInt32LE(0x07064b50, 0);
  writeFileSync(path.join(d, 'z.zip'), Buffer.concat([z.subarray(0, eocd), rec, loc, z.subarray(eocd)]));
  assert.deepEqual(await extractZip(path.join(d, 'z.zip'), path.join(d, 'out')), ['a.txt']);
  writeFileSync(path.join(d, 'z.exe'), Buffer.concat([makePE(), z]));
  assert.deepEqual(await extractZip(path.join(d, 'z.exe'), path.join(d, 'out2')), ['a.txt']);
});

test('extractZip refuses an entry that inflates past its declared size', async () => {
  const d = dirOf();
  mkdirSync(d, { recursive: true });
  const z = makeZip({ 'bomb.txt': 'a'.repeat(5000) });
  const cd = z.length - 22 - (46 + 'bomb.txt'.length); // the only central header; uncompressed size at +24
  z.writeUInt32LE(10, cd + 24);
  writeFileSync(path.join(d, 'b.zip'), z);
  await assert.rejects(extractZip(path.join(d, 'b.zip'), path.join(d, 'out')));
});

test('extractZip handles a zip appended to an exe', async () => {
  const d = dirOf();
  mkdirSync(d, { recursive: true });
  const exe = path.join(d, 'Game.exe');
  writeFileSync(exe, Buffer.concat([makePE(), makeZip({ 'index.html': '<p>hi</p>', 'a/b.txt': 'b' })]));
  const names = await extractZip(exe, path.join(d, 'out'));
  assert.deepEqual(names.sort(), ['a/b.txt', 'index.html']);
  assert.equal(readFileSync(path.join(d, 'out', 'a', 'b.txt'), 'utf8'), 'b');
});

test('build extracts a zip appended to the exe', async () => {
  const install = path.join(dirOf(), 'install');
  mkdirSync(install, { recursive: true });
  writeFileSync(path.join(install, 'Game.exe'), Buffer.concat([makePE(), makeZip(gameFiles())]));
  const portDir = await portOf(install);
  const r = await lane.build(portDir);
  assert.equal(r.verdict, 'GO');
  assert.ok(existsSync(path.join(portDir, 'build', 'game', 'index.html')));
});

test('shell() carries the R36 values', () => {
  const s = lane.shell({});
  assert.equal(s.serve.caseFallback, true);
  assert.deepEqual(s.verify, { target_fps: 30, inputs: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], audio_on_title: false, budget_ready_s: 30 });
  // R61: RPG Maker MV/MZ, Twine and many plugins need eval and inline scripts.
  assert.deepEqual(s.csp, { 'script-src': ["'unsafe-eval'", "'unsafe-inline'"] });
});

const skip = skipReason();
for (const c of CASES['web-extract']) test(c.name, { skip, timeout: 240000 }, c.run);

test('finishWebBuild injects the hook and swaps in', () => {
  const d = dirOf(), t = path.join(d, 'tmp'), out = path.join(d, 'out');
  mkdirSync(t, { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'old.txt'), 'x');
  writeFileSync(path.join(t, 'index.html'), '<!doctype html><html><head><title>t</title></head><body></body></html>');
  assert.deepEqual(finishWebBuild(t, out), { entry: 'index.html' });
  assert.ok(readFileSync(path.join(out, 'index.html'), 'utf8').includes('<head><script src="__pag_hook.js"></script>'));
  assert.ok(existsSync(path.join(out, '__pag_hook.js')));
  assert.ok(!existsSync(t));
  assert.ok(!existsSync(path.join(out, 'old.txt')));
});

test('finishWebBuild leaves out untouched on failure', () => {
  const d = dirOf(), t = path.join(d, 'tmp'), out = path.join(d, 'out');
  mkdirSync(t, { recursive: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'marker'), 'x');
  assert.throws(() => finishWebBuild(t, out), /no entry HTML found/);
  assert.ok(existsSync(path.join(out, 'marker')));
});
