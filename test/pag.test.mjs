import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePE } from './fixtures/make-pe.mjs';

const PAG = fileURLToPath(new URL('../skills/port-any-game/scripts/pag.mjs', import.meta.url));
const base = mkdtempSync(path.join(tmpdir(), 'pag-cli-'));
after(() => rmSync(base, { recursive: true, force: true }));
const run = (...args) => spawnSync(process.execPath, [PAG, ...args], { encoding: 'utf8', env: { ...process.env, PAG_CACHE: path.join(base, 'cache') } });

function game(name, files) {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, c] of Object.entries(files)) writeFileSync(path.join(dir, rel), c);
  return dir;
}
const stop = () => game('stop', { 'game.exe': makePE({ sections: [{ name: '.bind', size: 512 }] }) });
const go = () => game('go', { 'package.nw': 'PK' });

test('pag survey exit 4 on STOP', () => {
  const r = run('survey', stop());
  assert.equal(r.status, 4);
  assert.match(r.stdout, /STOP/);
  assert.match(r.stdout, /remote-play/);
  assert.ok(r.stdout.trimEnd().split('\n').length <= 8);
});

test('pag survey exit 0 on GO with <= 8 lines', () => {
  const r = run('survey', go());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GO/);
  assert.match(r.stdout, /web-extract/);
  assert.ok(r.stdout.trimEnd().split('\n').length <= 8);
});

test('pag survey --json is valid JSON', () => {
  const r = run('survey', go(), '--json');
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.schema, 'port-any-game/survey@1');
  assert.equal(j.verdict.overall, 'GO');
});

test('pag survey --out writes JSON', () => {
  const out = path.join(base, 'out.json');
  const r = run('survey', go(), '--out', out);
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).verdict.primary_lane, 'web-extract');
});

test('--out to an unwritable path exits 2 without leaking an absolute path', () => {
  const bad = path.join(base, 'no-such-dir', 'out.json');
  const r = run('survey', go(), '--out', bad);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out/);
  assert.ok(!r.stderr.includes(base));
});

test('human output keeps the remote-play line on STOP even with warnings', () => {
  const dir = game('stopwarn', { 'game.exe': makePE({ sections: [{ name: '.bind', size: 512 }, { name: 'UPX0', size: 512 }, { name: 'UPX1', size: 512 }] }) });
  const r = run('survey', dir);
  assert.equal(r.status, 4);
  assert.match(r.stdout, /remote-play/);
  assert.ok(r.stdout.trimEnd().split('\n').length <= 8);
});

test('usage errors exit 2', () => {
  assert.equal(run().status, 2);
  assert.equal(run('nope').status, 2);
  assert.match(run('nope').stderr, /usage/i);
  assert.equal(run('survey').status, 2);
  assert.equal(run('survey', path.join(base, 'missing')).status, 2);
  assert.equal(run('survey', go(), '--bogus').status, 2);
});
