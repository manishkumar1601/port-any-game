import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newPort, run } from '../skills/port-any-game/scripts/new.mjs';
import { LANES } from '../skills/port-any-game/scripts/lanes/index.mjs';
import { PolicyError } from '../skills/port-any-game/scripts/policy.mjs';
import { makePE } from './fixtures/make-pe.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-new-'));
process.env.PAG_CACHE = path.join(base, 'cache');
process.env.PAG_HOME = path.join(base, 'home');
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
function game(files, name = `g${n++}`) {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(dir, rel), content);
  return dir;
}
const nw = (name) => game({ 'package.nw': 'PK', 'nw.pak': 'x', 'Game.exe': makePE() }, name);
const out = () => path.join(base, `out${n++}`);
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

test('new creates layout, port.json and log checklist', async () => {
  const g = nw(), o = out();
  const port = await newPort({ gameDir: g, outDir: o });
  assert.equal(port.schema, 'port-any-game/port@1');
  assert.equal(port.lane, 'web-extract');
  assert.equal(port.data.mode, 'bundled');
  assert.equal(port.data.redistributable, undefined);
  assert.deepEqual(port.acks, []);
  assert.deepEqual(JSON.parse(readFileSync(path.join(o, 'port.json'), 'utf8')), port);
  for (const f of ['survey.json', 'AGENTS.md', 'CLAUDE.md', '.gitignore', 'PORTING_LOG.md', '.githooks/pre-commit', '.githooks/pre-push', '.githooks/check-staged.mjs']) {
    assert.ok(existsSync(path.join(o, f)), f);
  }
  assert.equal(readFileSync(path.join(o, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
  assert.ok(readFileSync(path.join(o, 'AGENTS.md'), 'utf8').split('\n').length <= 40);
  for (const d of ['game/', 'work/', 'build/', 'dist/', 'analysis/', 'package/']) assert.ok(readFileSync(path.join(o, '.gitignore'), 'utf8').split('\n').includes(d));
  const log = readFileSync(path.join(o, 'PORTING_LOG.md'), 'utf8');
  for (const c of LANES['web-extract'].checklist) assert.ok(log.includes(`- [ ] ${c}`), c);
  assert.ok(lstatSync(path.join(o, 'game')).isSymbolicLink());
  assert.equal(realpathSync(path.join(o, 'game')), realpathSync(g));
  assert.equal(git(o, 'config', 'core.hooksPath').stdout.trim(), '.githooks');
  assert.doesNotMatch(readFileSync(path.join(o, 'survey.json'), 'utf8'), /pag-new-/); // relative paths only
});

test('new refuses STOP verdict and creates nothing', async () => {
  const g = game({ 'game.exe': makePE({ sections: [{ name: '.bind', size: 512 }] }), 'package.nw': 'PK' });
  const o = out();
  await assert.rejects(newPort({ gameDir: g, outDir: o }), (e) => e instanceof PolicyError && e.code === 'STOP_VERDICT');
  assert.equal(existsSync(o), false);
  assert.equal(await run([g, o], { out() {}, err() {} }), 4);
});

test('new refuses unknown and unavailable lanes', async () => {
  const g = nw();
  await assert.rejects(newPort({ gameDir: g, outDir: out(), lane: 'nope' }), /unknown lane/);
  const stub = Object.values(LANES).find((l) => !l.available).id;
  await assert.rejects(newPort({ gameDir: g, outDir: out(), lane: stub }), /not available/);
});

test('new refuses existing port without --resume, keeps files with --resume', async () => {
  const g = nw(), o = out();
  await newPort({ gameDir: g, outDir: o });
  writeFileSync(path.join(o, 'PORTING_LOG.md'), 'MINE\n');
  await assert.rejects(newPort({ gameDir: g, outDir: o }), /--resume/);
  assert.equal(readFileSync(path.join(o, 'PORTING_LOG.md'), 'utf8'), 'MINE\n');
  rmSync(path.join(o, 'AGENTS.md'));
  const before = readFileSync(path.join(o, 'port.json'), 'utf8');
  await newPort({ gameDir: g, outDir: o, resume: true });
  assert.equal(readFileSync(path.join(o, 'PORTING_LOG.md'), 'utf8'), 'MINE\n');
  assert.equal(readFileSync(path.join(o, 'port.json'), 'utf8'), before);
  assert.ok(existsSync(path.join(o, 'AGENTS.md')));
});

test('new links unicode game dir', async () => {
  const g = nw('juego-ñandú-ゲーム'), o = out();
  const port = await newPort({ gameDir: g, outDir: o });
  assert.match(port.id, /^[a-z0-9-]+$/);
  assert.ok(existsSync(path.join(o, 'game', 'package.nw')));
});

test('new does not create commits', async () => {
  const o = out();
  await newPort({ gameDir: nw(), outDir: o });
  assert.equal(git(o, 'rev-list', '--all').stdout.trim(), '');
});

// I3/R63: a confident catalog match on free-to-share data marks the port redistributable, which unlocks bundled-public.
test('catalog-redistributable data reaches port.json and unlocks a bundled-public pack end to end', async () => {
  const { run: pack } = await import('../skills/port-any-game/scripts/pack.mjs');
  const wad = Buffer.concat([Buffer.from('IWAD'), Buffer.alloc(60)]);
  const g = game({ 'package.nw': 'PK', 'nw.pak': 'x', 'Game.exe': makePE(), 'freedoom1.wad': wad }), o = out();
  const port = await newPort({ gameDir: g, outDir: o, lane: 'web-extract' });
  assert.equal(port.data.redistributable, true);
  const msgs = { out: '', err: '' };
  assert.equal(await pack([o, '--mode', 'bundled-public'], { out: (t) => (msgs.out += t), err: (t) => (msgs.err += t) }), 0, msgs.err);
  assert.equal(JSON.parse(readFileSync(path.join(o, 'port.json'), 'utf8')).data.mode, 'bundled-public');
  assert.deepEqual(readFileSync(path.join(o, 'dist', 'game', 'freedoom1.wad')), wad);

  // A commercial WAD only engine-matches freedoom (needs_confirm), and a folder with both is not free to share.
  for (const files of [{ 'doom.wad': wad }, { 'doom.wad': wad, 'freedoom1.wad': wad }]) {
    const p = await newPort({ gameDir: game({ 'package.nw': 'PK', 'Game.exe': makePE(), ...files }), outDir: out(), lane: 'web-extract' });
    assert.equal(p.data.redistributable, undefined, Object.keys(files).join(' '));
  }
});
