import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, skipReason } from '../e2e/run.mjs'; // sets temp PAG_CACHE / PAG_HOME

const { survey } = await import('../../skills/port-any-game/scripts/survey/survey.mjs');
const { newPort } = await import('../../skills/port-any-game/scripts/new.mjs');
const { LANES } = await import('../../skills/port-any-game/scripts/lanes/index.mjs');
const { extractZip } = await import('../../skills/port-any-game/scripts/lib/archive.mjs');
const { makeWebGame, makeZip, gameFiles } = await import('../fixtures/make-web-game.mjs');
const { makePE } = await import('../fixtures/make-pe.mjs');
const lane = LANES['web-extract'];

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
});

const skip = skipReason();
for (const c of CASES['web-extract']) test(c.name, { skip, timeout: 240000 }, c.run);
