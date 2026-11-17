import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, skipReason } from '../e2e/run.mjs'; // sets temp PAG_CACHE / PAG_HOME

const { survey } = await import('../../skills/port-any-game/scripts/survey/survey.mjs');
const { newPort } = await import('../../skills/port-any-game/scripts/new.mjs');
const { LANES } = await import('../../skills/port-any-game/scripts/lanes/index.mjs');
const { loadLock, toolDir } = await import('../../skills/port-any-game/scripts/setup.mjs');
const { makeAnimCom } = await import('../fixtures/make-dos-com.mjs');
const { makeMZ } = await import('../fixtures/make-pe.mjs');
const { keyCode } = await import('../../skills/port-any-game/assets/lanes/dos-jsdos/adapter.js');
const lane = LANES['dos-jsdos'];

const tmp = mkdtempSync(path.join(tmpdir(), 'pag-jd-'));
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
  await newPort({ gameDir, outDir: portDir, lane: 'dos-jsdos' });
  return portDir;
}
// Pretends `pag setup jsdos` ran (the temp PAG_CACHE): build only checks for the .ok marker.
const fakeTool = () => { const d = toolDir(loadLock()['js-dos']); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, '.ok'), ''); return d; };
// The e2e fixture folder: a .COM has no header, so the MZ stub is what makes the survey call the folder DOS.
const comFolder = () => install({ 'ANIM.COM': makeAnimCom(), 'INSTALL.EXE': makeMZ() });

test('makeAnimCom starts with B8 13 00 CD 10', () => {
  const b = makeAnimCom();
  assert.deepEqual([...b.subarray(0, 5)], [0xB8, 0x13, 0x00, 0xCD, 0x10], 'mov ax,13h / int 10h');
  assert.equal(b.length, 55);
  const rel8 = (at) => at + 2 + (b[at + 1] << 24 >> 24); // target of a 2-byte jump at `at`
  assert.deepEqual([b[35], rel8(35)], [0xE2, 30], 'loop fill lands on mov ax,di');
  assert.deepEqual([b[43], rel8(43), b[12]], [0x74, 12, 0xBA], 'jz frame lands on mov dx,3DAh');
  assert.equal(b.at(-1), 0xC3, 'ret');
});

test('dosboxConf autoexec mounts and runs exe', () => {
  assert.equal(lane.dosboxConf({ exe: 'ANIM.COM' }), '[cpu]\ncycles=auto\n\n[autoexec]\nmount c .\nc:\nANIM.COM\n');
  assert.equal(lane.dosboxConf({ exe: 'data/sub/game.exe', cycles: 'max' }), '[cpu]\ncycles=max\n\n[autoexec]\nmount c .\nc:\ncd DATA\\SUB\nGAME.EXE\n');
  assert.match(lane.dosboxConf({ exe: 'Long Name Game.exe' }), /\nc:\nLONGNA~1\.EXE\n$/);
});

test('detect GO for MZ-only folder', async () => {
  const a = await survey(install({ 'GAME.EXE': makeMZ() }));
  assert.equal(a.executables.find((e) => e.role === 'main')?.format, 'MZ');
  assert.equal(lane.detect(a).verdict, 'GO');
  const b = await survey(comFolder());
  assert.ok(b.engines.some((e) => e.id === 'dos'), JSON.stringify(b.engines));
  assert.equal(lane.detect(b).verdict, 'GO');
  assert.equal(lane.detect({ engines: [{ id: 'unity' }], executables: [{ role: 'main', format: 'PE32' }] }).verdict, 'NO');
});

test('build fails without the js-dos tool and never downloads', async () => {
  rmSync(toolDir(loadLock()['js-dos']), { recursive: true, force: true });
  const portDir = await portOf(install({ 'GAME.EXE': makeMZ() }));
  await assert.rejects(lane.build(portDir), /run: pag setup jsdos --yes/);
});

test('build records the main DOS exe (upper-cased 8.3) in build/lane.json', async () => {
  fakeTool();
  const a = await portOf(install({ 'Data/Game.exe': makeMZ(Buffer.alloc(300)), 'Data/setup.exe': makeMZ(Buffer.alloc(900)), 'readme.txt': 'x' }));
  const ra = await lane.build(a);
  assert.deepEqual(ra, { lane_config: { exe: 'DATA/GAME.EXE' }, verdict: 'GO' });
  assert.deepEqual(JSON.parse(readFileSync(path.join(a, 'build', 'lane.json'), 'utf8')), ra.lane_config);
  assert.deepEqual(readdirSync(path.join(a, 'build')), ['lane.json'], 'build copies no runtime files (R40)');
  const sh = lane.shell({}, { portDir: a });
  assert.deepEqual(sh.lane_config, ra.lane_config);
  assert.equal(sh.needs_coi, false);
  assert.deepEqual(sh.verify, { target_fps: 30, inputs: [], audio_on_title: false, budget_ready_s: 30 });
  // A .COM is not in the survey (no header): with only an installer MZ beside it, the largest .COM runs.
  assert.deepEqual((await lane.build(await portOf(comFolder()))).lane_config, { exe: 'ANIM.COM' });
});

test('build fails clearly when there is no DOS executable', async () => {
  fakeTool();
  await assert.rejects(lane.build(await portOf(install({ 'readme.txt': 'x' }))), /no DOS executable/i);
});

test('runtime ships only the minimal dosbox backend set and the license', () => {
  assert.deepEqual(lane.runtime, {
    tool: 'js-dos',
    files: ['dist/emulators/emulators.js', 'dist/emulators/wdosbox.js', 'dist/emulators/wdosbox.wasm', 'dist/emulators/wlibzip.js', 'dist/emulators/wlibzip.wasm', 'package.json'],
  });
});

test('keyCode follows the js-dos 8.5.4 KBD_ table', () => {
  // Values read from dist/js-dos.js (KBD_a 65, KBD_0 48, KBD_esc 256, KBD_enter 257, KBD_left 263, KBD_up 265,
  // KBD_leftshift 340, KBD_rightctrl 345, KBD_f1 290, KBD_f12 301, KBD_kp5 325, KBD_kpenter 335, KBD_space 32).
  const want = { KeyA: 65, KeyZ: 90, Digit0: 48, Escape: 256, Enter: 257, ArrowLeft: 263, ArrowUp: 265, ShiftLeft: 340,
    ControlRight: 345, F1: 290, F12: 301, Numpad5: 325, NumpadEnter: 335, Space: 32, Backquote: 96 };
  for (const [code, k] of Object.entries(want)) assert.equal(keyCode(code), k, code);
  assert.equal(keyCode('MetaLeft'), undefined);
});

const skip = skipReason();
for (const c of CASES['dos-jsdos'] ?? [{ name: 'dos-jsdos e2e cases exist', run: () => assert.fail('no dos-jsdos e2e cases') }]) {
  test(c.name, { skip, timeout: 240000 }, async (t) => {
    try { await c.run(); } catch (e) { if (e?.skip) return t.skip(e.message); throw e; } // R41: offline tool download skips
  });
}
