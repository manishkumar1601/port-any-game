import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newPort } from '../skills/port-any-game/scripts/new.mjs';
import { makePE } from './fixtures/make-pe.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-hooks-'));
process.env.PAG_CACHE = path.join(base, 'cache');
after(() => rmSync(base, { recursive: true, force: true }));

const skip = spawnSync('sh', ['-c', 'exit 0']).error ? 'no sh on PATH' : false;

let n = 0;
async function port() {
  const g = path.join(base, `g${n}`);
  mkdirSync(g, { recursive: true });
  writeFileSync(path.join(g, 'package.nw'), 'PK');
  writeFileSync(path.join(g, 'Game.exe'), makePE());
  const o = path.join(base, `o${n++}`);
  await newPort({ gameDir: g, outDir: o });
  return o;
}
const run = (cwd, cmd, ...a) => spawnSync(cmd, a, { cwd, encoding: 'utf8' });
const stage = (cwd, rel, content) => {
  mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
  writeFileSync(path.join(cwd, rel), content);
  run(cwd, 'git', 'add', '-f', rel);
};
const hook = (cwd) => run(cwd, 'sh', '.githooks/pre-commit');

test('pre-commit rejects staged WAD', { skip }, async () => {
  const o = await port();
  stage(o, 'lane/data.bin', Buffer.concat([Buffer.from('IWAD'), Buffer.alloc(64)]));
  const r = hook(o);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lane\/data\.bin/);
  assert.match(r.stderr, /IWAD/);
});

test('pre-commit rejects >5MiB binary', { skip }, async () => {
  const o = await port();
  stage(o, 'lane/big.bin', Buffer.alloc(5 * 1024 * 1024 + 1));
  const r = hook(o);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /binary over 5 MiB/);
});

test('pre-commit rejects a survey hash match', { skip }, async () => {
  const o = await port();
  stage(o, 'lane/Game.exe', makePE()); // identical bytes to the surveyed executable
  const r = hook(o);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /survey\.json/);
});

test('pre-commit allows lane source', { skip }, async () => {
  const o = await port();
  stage(o, 'lane/shim.js', 'export const x = 1;\n');
  const r = hook(o);
  assert.equal(r.status, 0, r.stderr);
});

// R63/M8: the same rights-only rule as policy.isPublicAllowed; data.mode alone unlocks nothing.
test('guard is skipped only when the user holds the rights or the data is redistributable', { skip }, async () => {
  const wad = Buffer.concat([Buffer.from('PWAD'), Buffer.alloc(8)]);
  for (const [p, skipped] of [
    [{ data: { mode: 'bundled-public' } }, false],
    [{ data: { mode: 'bundled-public' }, acks: [{ id: 'ACK_RIGHTS_HOLDER' }] }, false], // no timestamp: not recorded by pag
    [{ data: { mode: 'byo' }, acks: [{ id: 'ACK_RIGHTS_HOLDER', at: '2026-11-18T00:00:00Z', note: 'I made this game' }] }, true],
    [{ data: { mode: 'bundled', redistributable: true } }, true],
  ]) {
    const o = await port();
    writeFileSync(path.join(o, 'port.json'), JSON.stringify(p));
    stage(o, 'lane/data.bin', wad);
    assert.equal(hook(o).status, skipped ? 0 : 1, JSON.stringify(p));
  }
});

test('pre-push rejects a committed WAD', { skip }, async () => {
  const o = await port();
  stage(o, 'lane/data.bin', Buffer.concat([Buffer.from('PWAD'), Buffer.alloc(8)]));
  run(o, 'git', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=none', 'commit', '-m', 'x');
  const sha = run(o, 'git', 'rev-parse', 'HEAD').stdout.trim();
  const r = spawnSync('sh', ['.githooks/pre-push', 'origin', 'x'], {
    cwd: o, encoding: 'utf8', input: `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /PWAD/);
});
