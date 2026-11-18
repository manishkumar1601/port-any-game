import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, skipReason } from '../e2e/run.mjs'; // sets temp PAG_CACHE / PAG_HOME

const { survey } = await import('../../skills/port-any-game/scripts/survey/survey.mjs');
const { newPort } = await import('../../skills/port-any-game/scripts/new.mjs');
const { LANES } = await import('../../skills/port-any-game/scripts/lanes/index.mjs');
const { loadLock, toolDir } = await import('../../skills/port-any-game/scripts/setup.mjs');
const { loveContainer, loveVerdict } = await import('../../skills/port-any-game/scripts/lanes/rebuild-love.mjs');
const { default: adapter } = await import('../../skills/port-any-game/assets/lanes/rebuild-love/adapter.js');
const { makeLove, STUB_BYTES } = await import('../fixtures/make-love.mjs');
const { makeZip } = await import('../fixtures/make-web-game.mjs');
const lane = LANES['rebuild-love'];

const tmp = mkdtempSync(path.join(tmpdir(), 'pag-love-'));
after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); cleanup(); });
let n = 0;
const dirOf = () => path.join(tmp, `t${++n}`, 'install');
const fixture = (variant) => makeLove(dirOf(), { variant });
const fileOf = (dir) => readFileSync(path.join(dir, readdirSync(dir).find((f) => /\.(love|exe)$/.test(f))));

async function portOf(gameDir) {
  const portDir = path.join(path.dirname(gameDir), 'port');
  await newPort({ gameDir, outDir: portDir, lane: 'rebuild-love' });
  return portDir;
}
// Pretends `pag setup love` ran (the temp PAG_CACHE): build only checks for the .ok marker.
const fakeTool = () => { const d = toolDir(loadLock()['love.js']); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, '.ok'), ''); return d; };

test('survey picks rebuild-love for the plain and fused fixtures', async () => {
  for (const variant of ['plain', 'fused']) {
    const s = await survey(fixture(variant));
    assert.ok(s.lanes.some((l) => l.lane === 'rebuild-love' && l.verdict === 'GO'), JSON.stringify(s.lanes));
    assert.equal(s.verdict.primary_lane, 'rebuild-love', variant);
    if (variant === 'fused') assert.equal(s.executables.find((e) => e.path === 'game.exe')?.overlay?.magic, 'zip');
  }
  assert.deepEqual(lane.detect({ engines: [{ id: 'love' }] }), { verdict: 'GO', why: 'LÖVE game; version checked by pag build' });
  assert.equal(lane.detect({ engines: [{ id: 'flash-swf' }] }).verdict, 'NO');
  assert.deepEqual(lane.runtime, { tool: 'love.js', files: ['src/compat/love.js', 'src/compat/love.wasm'] });
  assert.deepEqual([lane.rung, lane.available, lane.milestone, lane.dataModes, lane.acks, lane.odds], [3, true, 'M2', ['byo'], ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], '60-80%']);
});

test('loveContainer finds the zip start of each container', () => {
  assert.deepEqual(loveContainer(fileOf(fixture('plain'))), { offset: 0 });
  assert.deepEqual(loveContainer(fileOf(fixture('fused'))), { offset: STUB_BYTES });
  assert.deepEqual(loveContainer(fileOf(fixture('fused-abs'))), { offset: 0 }, 'absolute offsets: the whole file');
  assert.throws(() => loveContainer(makeZip({ 'game/main.lua': 'x', 'game/conf.lua': 'y' })), { message: 'main.lua is not at the root of the game zip' });
  assert.throws(() => loveContainer(Buffer.alloc(5000, 1)), { message: 'not a LÖVE game: no zip found' });
});

test('loveVerdict reads t.version and native code', () => {
  const v = (conf, lua = '', names = ['main.lua', 'conf.lua']) => loveVerdict({ conf, lua, names });
  const c = (ver) => `function love.conf(t)\n  t.identity = "x"\n  t.version = "${ver}"\nend\n`;
  assert.deepEqual([v(c('11.4')).version, v(c('11.4')).verdict], ['11.4', 'GO']);
  assert.equal(v(c('11.0')).verdict, 'GO');
  assert.equal(v(c('11.5')).verdict, 'GO');
  assert.match(v(c('11.5')).why, /11\.4/);
  assert.deepEqual([v(c('0.10.2')).version, v(c('0.10.2')).verdict], ['0.10.2', 'HARD']);
  assert.equal(v(c('10.0')).verdict, 'HARD');
  assert.equal(v(c('12.0')).verdict, 'NO');
  assert.equal(v(c('11.9')).verdict, 'HARD');
  assert.deepEqual([v(null).version, v(null).verdict], [null, 'HARD']);
  assert.equal(v('function love.conf(t)\n  -- t.version = "11.4"\nend').version, null, 'a commented-out line is no version');
  const decoy = v('game = {}\ngame.version = "1.2"\nfunction love.conf(t)\n  t.version = "11.4"\nend\n');
  assert.deepEqual([decoy.version, decoy.verdict], ['11.4', 'GO'], "the game's own version field is not LÖVE's");
  assert.equal(v('function love.conf(c)\n  c.version = "11.3"\nend\n').version, '11.3', 'the love.conf parameter name');
  assert.equal(v('love.conf = function( cfg )\n  cfg.version = "11.2"\nend\n').version, '11.2');
  assert.equal(v(c('11.4'), '', ['main.lua', 'lib/x.dll']).verdict, 'NO');
  assert.match(v(c('11.4'), '', ['main.lua', 'lib/x.dll']).why, /lib\/x\.dll/);
  assert.equal(v(c('11.4'), '', ['main.lua', 'luasteam.so']).verdict, 'NO');
  for (const lua of ['local ffi = require("ffi")', "local ffi = require 'ffi'", 'package.loadlib("x", "y")']) assert.equal(v(c('11.4'), lua).verdict, 'NO', lua);
});

test('build writes file, offset and version for each container', async () => {
  fakeTool();
  const cases = [
    ['plain', { file: 'game.love', offset: 0, version: '11.4' }, 'GO'],
    ['fused', { file: 'game.exe', offset: STUB_BYTES, version: '11.4' }, 'GO'],
    ['fused-abs', { file: 'game.exe', offset: 0, version: '11.4' }, 'GO'],
    ['old', { file: 'game.love', offset: 0, version: '0.10.2' }, 'HARD'],
    ['ffi', { file: 'game.love', offset: 0, version: '11.4' }, 'NO'],
  ];
  for (const [variant, lane_config, verdict] of cases) {
    const portDir = await portOf(fixture(variant));
    const r = await lane.build(portDir);
    assert.deepEqual([r.lane_config, r.verdict], [lane_config, verdict], variant);
    assert.deepEqual(readdirSync(path.join(portDir, 'build')), ['lane.json'], 'no game bytes under build/');
    assert.deepEqual(JSON.parse(readFileSync(path.join(portDir, 'build', 'lane.json'), 'utf8')), lane_config);
    assert.deepEqual(lane.shell({}, { portDir }).lane_config, lane_config);
    assert.match(readFileSync(path.join(portDir, 'PORTING_LOG.md'), 'utf8'), new RegExp(`rebuild-love build[\\s\\S]*Verdict ${verdict}`));
  }
});

test('build finds a .love inside a macOS .app, and a loose .love first', async () => {
  fakeTool();
  const dir = fixture('plain');
  mkdirSync(path.join(dir, 'Game.app', 'Contents', 'Resources'), { recursive: true });
  renameSync(path.join(dir, 'game.love'), path.join(dir, 'Game.app', 'Contents', 'Resources', 'game.love'));
  const portDir = await portOf(dir);
  assert.equal((await lane.build(portDir)).lane_config.file, 'Game.app/Contents/Resources/game.love');
  makeLove(path.join(dir, 'sub'));
  assert.equal((await lane.build(portDir)).lane_config.file, 'sub/game.love');
});

test('build fails without the tool or without a game', async () => {
  rmSync(toolDir(loadLock()['love.js']), { recursive: true, force: true });
  await assert.rejects(lane.build(await portOf(fixture('plain'))), { message: 'the love.js runtime is not installed; run: pag setup love --yes' });
  fakeTool();
  const dir = dirOf();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'readme.txt'), 'x');
  await assert.rejects(lane.build(await portOf(dir)), /no LÖVE game found in game\//);
});

test('shell has no CSP relaxation and no isolation', () => {
  assert.deepEqual(lane.shell({}, { portDir: path.join(tmp, 'none') }), { needs_coi: false, verify: { target_fps: 30, inputs: ['Click', 'Enter', 'Space'], audio_on_title: false, budget_ready_s: 30 } });
});

test('saveNow rejects before love.js has started', async () => {
  await assert.rejects(adapter.saveNow(), /not started/);
});

const skip = skipReason();
for (const c of CASES['rebuild-love'] ?? [{ name: 'rebuild-love e2e cases exist', run: () => assert.fail('no rebuild-love e2e cases') }]) {
  test(c.name, { skip, timeout: 240000 }, async (t) => {
    try { await c.run(); } catch (e) { if (e?.skip) return t.skip(e.message); throw e; } // R41: offline tool download skips
  });
}
