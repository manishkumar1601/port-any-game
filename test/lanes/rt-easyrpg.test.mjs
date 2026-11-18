import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, skipReason } from '../e2e/run.mjs'; // sets temp PAG_CACHE / PAG_HOME

const { survey } = await import('../../skills/port-any-game/scripts/survey/survey.mjs');
const { newPort } = await import('../../skills/port-any-game/scripts/new.mjs');
const { LANES } = await import('../../skills/port-any-game/scripts/lanes/index.mjs');
const { loadLock, toolDir } = await import('../../skills/port-any-game/scripts/setup.mjs');
const { cspFor } = await import('../../skills/port-any-game/scripts/pack.mjs');
const { makeRm2k } = await import('../fixtures/make-rm2k.mjs');
const { gencacheIndex, gamePath } = await import('../../skills/port-any-game/assets/lanes/rt-easyrpg/adapter.js');
const lane = LANES['rt-easyrpg'];

const tmp = mkdtempSync(path.join(tmpdir(), 'pag-erpg-'));
after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); cleanup(); });
let n = 0;
const dirOf = () => path.join(tmp, `t${++n}`, 'install');

async function portOf(gameDir, name = 'port') {
  const portDir = path.join(path.dirname(gameDir), name);
  await newPort({ gameDir, outDir: portDir, lane: 'rt-easyrpg' });
  return portDir;
}
// Pretends `pag setup easyrpg` ran (the temp PAG_CACHE): build only checks for the .ok marker.
const fakeTool = () => { const d = toolDir(loadLock()['easyrpg-player-js']); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, '.ok'), ''); return d; };

test('survey picks rt-easyrpg for the fixture', async () => {
  const s = await survey(makeRm2k(dirOf()));
  assert.ok(s.lanes.some((l) => l.lane === 'rt-easyrpg' && l.verdict === 'GO'), JSON.stringify(s.lanes));
  assert.equal(s.verdict.primary_lane, 'rt-easyrpg');
  assert.equal(lane.detect({ engines: [{ id: 'flash-swf' }] }).verdict, 'NO');
  assert.deepEqual(lane.runtime, { tool: 'easyrpg-player-js', files: ['index.js', 'index.wasm'] });
  assert.deepEqual([lane.rung, lane.available, lane.milestone, lane.dataModes, lane.acks], [1, true, 'M2', ['byo'], ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE']]);
});

test('gencacheIndex maps lower-case keys to real names', () => {
  const { metadata, cache } = gencacheIndex(['RPG_RT.ldb', 'RPG_RT.ini', 'TITLE/TITLE.PNG', 'ChipSet/World.png', 'ExFont.png', 'Text/Lang.ini', 'a/b/c/d.png', 'a/b/c/d/e.png']);
  assert.equal(metadata.version, 2);
  assert.match(metadata.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(cache['rpg_rt.ldb'], 'RPG_RT.ldb');
  assert.equal(cache['rpg_rt.ini'], 'RPG_RT.ini');
  assert.equal(cache.title._dirname, 'TITLE');
  assert.equal(cache.title.title, 'TITLE.PNG');
  assert.equal(cache.chipset.world, 'World.png');
  assert.equal(cache.exfont, 'ExFont.png');
  assert.equal(cache.text['lang.ini'], 'Lang.ini', '.ini keeps its extension in a folder');
  assert.equal(cache.a.b.c.d, 'd.png', 'depth 4: three folders deep');
  assert.equal(cache.a.b.c.d._dirname, undefined, 'a fourth folder is past the depth');
  assert.equal(gencacheIndex([], '2026-11-18').metadata.date, '2026-11-18');
});

test('gamePath strips the game prefix and dot segments', () => {
  assert.equal(gamePath('games/g/./index.json', 'g'), 'index.json');
  assert.equal(gamePath('games/g/Title/Title%20A.png', 'g'), 'Title/Title A.png');
  assert.equal(gamePath('index.wasm', 'g'), null);
  assert.equal(gamePath('games/other/RPG_RT.ldb', 'g'), null);
  assert.equal(gamePath('games/g/../x', 'g'), null);
});

test('build finds a root one folder down', async () => {
  fakeTool();
  const dir = makeRm2k(dirOf(), { root: 'Game' });
  appendFileSync(path.join(dir, 'Game', 'RPG_RT.ini'), '[EasyRPG]\r\nEncoding=932\r\n');
  mkdirSync(path.join(dir, 'Game', 'Old'));
  writeFileSync(path.join(dir, 'Game', 'Old', 'rpg_rt.LDB'), 'x'); // deeper copy: the shallowest wins
  const portDir = await portOf(dir, 'My Port (Ünïcode)!!');
  const r = await lane.build(portDir);
  assert.deepEqual(r, { lane_config: { root: 'Game', game: 'my-port-n-code', encoding: '932', rtp: 'full-package' }, verdict: 'GO' });
  assert.deepEqual(JSON.parse(readFileSync(path.join(portDir, 'build', 'lane.json'), 'utf8')), r.lane_config);
  assert.deepEqual(lane.shell({}, { portDir }).lane_config, r.lane_config);
  assert.equal((await lane.build(await portOf(makeRm2k(dirOf()), '日本語'))).lane_config.game, 'game');
  assert.equal((await lane.build(await portOf(makeRm2k(dirOf()), 'x'.repeat(50)))).lane_config.game, 'x'.repeat(40));
});

test('build verdict HARD without a full package', async () => {
  fakeTool();
  const portDir = await portOf(makeRm2k(dirOf(), { fullPackage: false }));
  const r = await lane.build(portDir);
  assert.deepEqual(r, { lane_config: { root: '', game: 'port', rtp: 'needs-rtp' }, verdict: 'HARD' });
  assert.match(readFileSync(path.join(portDir, 'PORTING_LOG.md'), 'utf8'), /FullPackageFlag=1/);
});

test('build fails without the tool', async () => {
  rmSync(toolDir(loadLock()['easyrpg-player-js']), { recursive: true, force: true });
  const portDir = await portOf(makeRm2k(dirOf()));
  await assert.rejects(lane.build(portDir), { message: 'the EasyRPG runtime is not installed; run: pag setup easyrpg --yes' });
});

test('build fails without RPG_RT.ldb', async () => {
  fakeTool();
  const dir = dirOf();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'readme.txt'), 'x');
  await assert.rejects(lane.build(await portOf(dir)), { message: 'no RPG_RT.ldb found in game/' });
});

test('shell adds only unsafe-eval to script-src', async () => {
  const sh = lane.shell({}, { portDir: path.join(tmp, 'none') });
  assert.deepEqual(sh, { csp: { 'script-src': ["'unsafe-eval'"] }, needs_coi: false, verify: { target_fps: 30, inputs: ['Enter'], audio_on_title: false, budget_ready_s: 30 } });
  assert.equal(cspFor(sh.csp), cspFor().replace(/script-src ([^;]*)/, "script-src $1 'unsafe-eval'"));
});

const skip = skipReason();
for (const c of CASES['rt-easyrpg'] ?? [{ name: 'rt-easyrpg e2e cases exist', run: () => assert.fail('no rt-easyrpg e2e cases') }]) {
  test(c.name, { skip, timeout: 240000 }, async (t) => {
    try { await c.run(); } catch (e) { if (e?.skip) return t.skip(e.message); throw e; } // R41: offline tool download skips
  });
}
