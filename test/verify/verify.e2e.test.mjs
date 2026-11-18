// Browser end-to-end tests for pag verify, driven against the lane-test fixture (test/fixtures/lane-test/adapter.js).
// They need Chrome or Edge (PAG_BROWSER, CHROME_PATH or an OS install) and Node 22+ (global WebSocket); otherwise they skip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = mkdtempSync(path.join(tmpdir(), 'pag-verify-test-'));
process.env.PAG_CACHE = path.join(base, 'cache'); // never the real home or tool cache
process.env.PAG_HOME = path.join(base, 'home');
after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5 }));

const { pack } = await import('../../skills/port-any-game/scripts/pack.mjs');
const { verify, run } = await import('../../skills/port-any-game/scripts/verify/verify.mjs');
const { findBrowser } = await import('../../skills/port-any-game/scripts/verify/browser.mjs');

const ADAPTER = fileURLToPath(new URL('../fixtures/lane-test/adapter.js', import.meta.url));
const PAG = fileURLToPath(new URL('../../skills/port-any-game/scripts/pag.mjs', import.meta.url));
const laneModule = (verifyExtra) => ({
  id: 'lane-test', dataModes: ['byo', 'bundled'], adapter: ADAPTER,
  // Hosted macOS/Windows runners are GPU-less VMs that run rAF well below 30 fps: CI judges the fixture against a lower
  // target. The product thresholds (checks.mjs) are untouched.
  shell: () => ({ verify: { target_fps: process.env.GITHUB_ACTIONS === 'true' ? 10 : 30, inputs: ['ArrowRight', 'Click'], audio_on_title: true, budget_ready_s: 10, ...verifyExtra } }),
});

let n = 0;
async function packed(verifyExtra = {}) {
  const dir = path.join(base, `port-${++n}`);
  mkdirSync(path.join(dir, 'game', 'data'), { recursive: true });
  writeFileSync(path.join(dir, 'game', 'GAME.EXE'), randomBytes(4096));
  writeFileSync(path.join(dir, 'game', 'data', 'level1.dat'), randomBytes(3000));
  writeFileSync(path.join(dir, 'game', 'index.json'), '{"a game file":true}\n'); // R34: must not be shadowed by the fixture index
  writeFileSync(path.join(dir, 'port.json'), JSON.stringify({ schema: 'port-any-game/port@1', id: `verify-test-${n}`, name: 'Verify Test', lane: 'lane-test', data: { mode: 'byo' }, tools: {}, acks: [] }));
  const { distDir } = await pack(dir, { laneModule: laneModule(verifyExtra) });
  return { dir, distDir };
}
const check = (r, name) => r.checks.find((c) => c.name === name);
const failing = (r) => JSON.stringify(r.checks.filter((c) => c.status !== 'pass'), null, 1);

const browser = findBrowser();
const skip = !browser ? 'no Chrome/Edge found (install one or set PAG_BROWSER); browser e2e skipped'
  : typeof WebSocket !== 'function' ? 'the CDP runner needs Node 22+ (global WebSocket); browser e2e skipped' : false;
if (browser) console.log(`# verify e2e browser: ${browser.kind} ${browser.path}`);

// Each run is ~10-18 s of mostly fixed waits (10 samples 0.5 s apart, the 3 s input window, a reload). Concurrent
// browsers were slower in total here, so runs are sequential; only the ok run adds the soak and a stage hook.
const listing = (dir) => readdirSync(dir, { recursive: true }).sort();
async function verifyMode(query, { soakSec = 0, stages } = {}) {
  const p = await packed(stages ? { stages } : {});
  const gameBefore = listing(path.join(p.dir, 'game'));
  const t0 = Date.now();
  const r = await verify(p.distDir, { runner: 'cdp', soakSec, query });
  console.log(`# lane-test ${query}: ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { ...p, gameBefore, r };
}

test('lane-test ok passes', { skip }, async () => {
  const { dir, gameBefore, r } = await verifyMode('mode=ok', { soakSec: 2, stages: ['gameplay'] });
  assert.equal(r.status, 'pass', failing(r));
  for (const name of ['blank', 'frozen', 'fps', 'input', 'audio', 'save', 'viewports', 'loop', 'privacy', 'errors', 'requests', 'stages']) {
    assert.equal(check(r, name)?.status, 'pass', `${name}: ${failing(r)}`);
  }
  assert.equal(check(r, 'memory')?.status, 'skip', failing(r)); // R37: a 2 s soak is too short to judge memory
  assert.match(check(r, 'save').detail, /lane saveNow ran/); // R64
  // M10: 'Click' is a trusted click on the stage: pointerdown + pointerup on top of the key's keydown + keyup.
  assert.ok(r.runs[0].measures.input.events >= 4, JSON.stringify(r.runs[0].measures.input));
  const out = path.join(dir, 'verify');
  assert.equal(JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')).status, 'pass');
  assert.ok(existsSync(path.join(out, 'console.log')));
  assert.ok(r.runs[0].measures.fps.seconds >= 9, `sample window ${r.runs[0].measures.fps.seconds} s (spec: 10 s)`);
  const shots = readdirSync(out).filter((f) => /^step-.*\.png$/.test(f));
  assert.ok(shots.length >= 5, shots.join(', '));
  // R31: the BYO fixture is served from the game folder, which verify never writes into.
  assert.deepEqual(listing(path.join(dir, 'game')), gameBefore);
  // The import Worker's fixture fetches are seen (privacy covers them), each file once, and the game's own
  // top-level index.json is imported as a game file: the fixture index lives beside the mount (R34).
  const fx = r.runs[0].requests.filter((q) => q.url.startsWith('/__fixture'));
  assert.deepEqual(fx.map((q) => q.url).sort(), ['/__fixture.index.json', '/__fixture/GAME.EXE', '/__fixture/data/level1.dat', '/__fixture/index.json']);
});

test('lane-test black fails blank', { skip }, async () => {
  const { r } = await verifyMode('mode=black');
  assert.equal(r.status, 'fail');
  assert.equal(check(r, 'blank').status, 'fail', failing(r));
});

test('lane-test frozen fails frozen', { skip }, async () => {
  const { r } = await verifyMode('mode=frozen');
  assert.equal(r.status, 'fail');
  assert.equal(check(r, 'frozen').status, 'fail', failing(r));
  assert.equal(check(r, 'blank').status, 'pass', failing(r));
});

test('lane-test throw fails page error', { skip }, async () => {
  const { r } = await verifyMode('mode=throw');
  assert.equal(r.status, 'fail');
  assert.equal(check(r, 'errors').status, 'fail', failing(r));
  assert.match(check(r, 'errors').detail, /thrown in the first frame/);
});

// R46: verify waits for the first game frame, capped; a lane that never paints is still judged, not hung or masked.
test('lane-test never-painting lane fails blank and fps after the first-frame cap', { skip }, async () => {
  const t0 = Date.now();
  const { r } = await verifyMode('mode=never');
  assert.equal(r.status, 'fail');
  assert.equal(check(r, 'blank').status, 'fail', failing(r));
  assert.equal(check(r, 'fps').status, 'fail', failing(r));
  assert.match(check(r, 'ready').detail, /no game frame within 10 s of Play/);
  assert.ok(Date.now() - t0 < 120000, 'bounded');
});

test('lane-test silent warns audio', { skip }, async () => {
  const { r } = await verifyMode('mode=silent');
  assert.equal(check(r, 'audio').status, 'warn', failing(r));
  assert.equal(r.status, 'warn', failing(r));
});

// One run for these: lane-test with a too-wide element, a POST, a popup window and an uncaught page error at start.
let misbehaving;
const misbehave = () => (misbehaving ??= verifyMode('mode=ok&wide=1&post=1&popup=1&pageerror=1'));

test('mobile viewport overflow fails', { skip }, async () => {
  const { r } = await misbehave();
  assert.equal(r.status, 'fail');
  const c = check(r, 'viewports');
  assert.equal(c.status, 'fail', failing(r));
  assert.match(c.detail, /mobile 390x844/);
  assert.doesNotMatch(c.detail, /desktop/);
});

// M2: a page error while the game keeps running is reported (errors fails) but does not end the session.
test('a page error while running is logged, not fatal', { skip }, async () => {
  const { r } = await misbehave();
  assert.equal(check(r, 'errors').status, 'fail', failing(r));
  assert.match(check(r, 'errors').detail, /lane-test: page error while running/);
  assert.equal(check(r, 'shell').status, 'pass', failing(r));
  assert.equal(check(r, 'fps').status, 'pass', failing(r));
});

test('byo privacy: POST fails', { skip }, async () => {
  const { r } = await misbehave();
  assert.equal(r.status, 'fail');
  const c = check(r, 'privacy');
  assert.equal(c.status, 'fail', failing(r));
  assert.match(c.detail, /POST/);
  assert.match(c.detail, /popup/, 'a popup is a window whose requests are not checked');
});

// Review Focus 4. PAG_BROWSER pointing at a missing file pins "no browser" (no fallback to an installed one).
test('verify exits 3 when no browser and no playwright', async () => {
  const { distDir } = await packed();
  const cache = mkdtempSync(path.join(base, 'empty-cache-'));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [PAG, 'verify', distDir], {
    encoding: 'utf8', timeout: 60000,
    env: { ...process.env, PAG_BROWSER: path.join(base, 'nonexistent', 'chrome'), CHROME_PATH: '', PAG_CACHE: cache },
  });
  assert.equal(r.status, 3, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /unsupported environment/i);
  assert.ok(Date.now() - t0 < 30000, 'no hang');
});

test('cli: --soak must be a finite number of seconds up to 3600', async () => {
  for (const bad of ['Infinity', '3601', '-1', 'abc', '1e9']) {
    let err = '';
    assert.equal(await run(['dist', '--soak', bad], { out: () => {}, err: (t) => (err += t) }), 1, bad);
    assert.match(err, /--soak/, bad);
  }
});

test('an unreadable port.json stops the search and is reported', async () => {
  const { dir, distDir } = await packed();
  writeFileSync(path.join(dir, 'port.json'), '{ broken');
  await assert.rejects(verify(distDir, { runner: 'cdp', soakSec: 0 }), /port\.json/);
});
