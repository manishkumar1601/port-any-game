import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, skipReason } from '../e2e/run.mjs'; // sets temp PAG_CACHE / PAG_HOME

const { survey } = await import('../../skills/port-any-game/scripts/survey/survey.mjs');
const { newPort } = await import('../../skills/port-any-game/scripts/new.mjs');
const { LANES } = await import('../../skills/port-any-game/scripts/lanes/index.mjs');
const { loadLock, toolDir } = await import('../../skills/port-any-game/scripts/setup.mjs');
const { makeAnimSwf, makeProjector } = await import('../fixtures/make-swf.mjs');
const { swfFromProjector } = await import('../../skills/port-any-game/assets/lanes/rt-ruffle/adapter.js');
const lane = LANES['rt-ruffle'];

const tmp = mkdtempSync(path.join(tmpdir(), 'pag-rf-'));
after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); cleanup(); });
let n = 0;
const dirOf = () => path.join(tmp, `t${++n}`);

function install(files) {
  const dir = path.join(dirOf(), 'install');
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), c);
  }
  return dir;
}
async function portOf(gameDir) {
  const portDir = path.join(path.dirname(gameDir), 'port');
  await newPort({ gameDir, outDir: portDir, lane: 'rt-ruffle' });
  return portDir;
}
// Pretends `pag setup ruffle` ran (the temp PAG_CACHE): build only checks for the .ok marker.
const fakeTool = () => { const d = toolDir(loadLock()['ruffle-selfhosted']); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, '.ok'), ''); return d; };

test('makeAnimSwf has FWS header and declared length', () => {
  const b = makeAnimSwf();
  assert.equal(b.toString('latin1', 0, 3), 'FWS');
  assert.equal(b[3], 6);
  assert.equal(b.readUInt32LE(4), b.length);
  assert.deepEqual([...b.subarray(-2)], [0, 0], 'ends with the End tag');
  assert.equal(b.readUInt16LE(19), 60, 'frame count after 8-byte header, 9-byte RECT (5 + 4*15 bits), 2-byte rate');
});

test('detect GO for swf and projector', async () => {
  const swf = makeAnimSwf();
  const a = await survey(install({ 'game.swf': swf }));
  assert.ok(a.engines.some((e) => e.id === 'flash-swf'), JSON.stringify(a.engines));
  assert.equal(lane.detect(a).verdict, 'GO');
  const b = await survey(install({ 'Game.exe': makeProjector(swf) }));
  assert.ok(b.engines.some((e) => e.id === 'flash-projector'), JSON.stringify(b.engines));
  assert.equal(lane.detect(b).verdict, 'GO');
  assert.equal(lane.detect({ engines: [{ id: 'unity' }] }).verdict, 'NO');
});

test('projector trailer extraction returns original swf', () => {
  const swf = makeAnimSwf();
  const out = swfFromProjector(new Uint8Array(makeProjector(swf)));
  assert.ok(Buffer.from(out).equals(swf));
  assert.throws(() => swfFromProjector(new Uint8Array(swf)), /projector/i);
  const bad = Buffer.from(makeProjector(swf));
  bad.writeUInt32LE(bad.length, bad.length - 4); // length beyond the file
  assert.throws(() => swfFromProjector(new Uint8Array(bad)), /projector/i);
});

test('build fails without the ruffle tool and never downloads', async () => {
  const portDir = await portOf(install({ 'game.swf': makeAnimSwf() }));
  await assert.rejects(lane.build(portDir), /pag setup ruffle --yes/);
});

test('build records the swf, or the main projector exe, in build/lane.json', async () => {
  fakeTool();
  const swf = makeAnimSwf();
  const a = await portOf(install({ 'data/game.swf': swf, 'readme.txt': 'x' }));
  const ra = await lane.build(a);
  assert.deepEqual(ra, { lane_config: { swf: 'data/game.swf', projector: false }, verdict: 'GO' });
  assert.deepEqual(JSON.parse(readFileSync(path.join(a, 'build', 'lane.json'), 'utf8')), ra.lane_config);
  assert.deepEqual(lane.shell({}, { portDir: a }).lane_config, ra.lane_config);
  assert.equal(lane.shell({}, { portDir: a }).verify.audio_on_title, false);

  const p = await portOf(install({ 'Game.exe': makeProjector(swf) }));
  assert.deepEqual((await lane.build(p)).lane_config, { swf: 'Game.exe', projector: true });
});

test('build fails clearly when there is no Flash content', async () => {
  fakeTool();
  const portDir = await portOf(install({ 'readme.txt': 'x' }));
  await assert.rejects(lane.build(portDir), /no SWF/i);
});

const skip = skipReason();
for (const c of CASES['rt-ruffle']) {
  test(c.name, { skip, timeout: 240000 }, async (t) => {
    try { await c.run(); } catch (e) { if (e?.skip) return t.skip(e.message); throw e; } // R41: offline tool download skips
  });
}
