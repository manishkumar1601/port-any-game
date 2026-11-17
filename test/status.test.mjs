import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { status, run } from '../skills/port-any-game/scripts/status.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-status-'));
after(() => rmSync(base, { recursive: true, force: true }));
const mk = (name, port, log) => {
  const d = path.join(base, name); mkdirSync(path.join(d, 'sub', 'deep'), { recursive: true });
  if (port !== undefined) writeFileSync(path.join(d, 'port.json'), typeof port === 'string' ? port : JSON.stringify(port));
  if (log !== undefined) writeFileSync(path.join(d, 'PORTING_LOG.md'), log);
  return d;
};
const P = { schema: 'port-any-game/port@1', id: 'g', name: 'Game', lane: 'c-emscripten' };
const cap = async (cwd, argv = []) => { let out = ''; const code = await run(argv, { cwd, out: (t) => { out += t; }, err: () => {} }); return { out, code }; };

test('finds port.json in parent', () => {
  const d = mk('parent', P, '');
  assert.equal(status(path.join(d, 'sub', 'deep')).port.id, 'g');
});

test('reports first unchecked checklist item', async () => {
  const d = mk('items', P, '# Log\n- [x] done one\n- [ ] wire audio\n- [ ] later\n');
  assert.equal(status(d).nextItem, 'wire audio');
  const { out, code } = await cap(path.join(d, 'sub'), ['--host=codex']);
  assert.equal(code, 0);
  assert.match(out, /^Port Game · lane c-emscripten · next: wire audio · last verify never\n$/);
});

test('all done and missing log give null next item', async () => {
  const d = mk('done', P, '- [x] a\n');
  assert.equal(status(d).nextItem, null);
  assert.match((await cap(d)).out, /next: all checklist items done/);
  assert.equal(status(mk('nolog', P)).nextItem, null);
});

test('silent outside a port', async () => {
  const d = mk('none');
  assert.equal(status(d).port, null);
  assert.deepEqual(await cap(d), { out: '', code: 0 });
});

test('includes node<20 warning', () => {
  const d = mk('old', P, '');
  assert.deepEqual(status(d, { nodeVersion: '18.19.0' }).warnings, ['Node 18.19.0 is too old; need >= 20']);
  assert.deepEqual(status(d, { nodeVersion: '20.1.0' }).warnings, []);
});

test('fail-open on corrupt port.json', async () => {
  const d = mk('corrupt', '{nope');
  assert.deepEqual(await cap(d), { out: '', code: 0 });
});

test('foreign-schema port.json is ignored (keeps walking)', () => {
  const d = mk('foreign', P, '');
  writeFileSync(path.join(d, 'sub', 'port.json'), JSON.stringify({ schema: 'other/thing@1', id: 'x' }));
  assert.equal(status(path.join(d, 'sub', 'deep')).port.id, 'g');
  assert.equal(status(mk('foreign2', { schema: 'other@1' })).port, null);
});

test('reads last verify from report.json; --json shape', async () => {
  const d = mk('ver', P, '- [ ] x\n');
  mkdirSync(path.join(d, 'verify'));
  writeFileSync(path.join(d, 'verify', 'report.json'), JSON.stringify({ status: 'pass', at: '2026-11-01T10:00:00.000Z' }));
  assert.deepEqual(status(d).lastVerify, { status: 'pass', at: '2026-11-01T10:00:00.000Z' });
  assert.match((await cap(d)).out, /last verify pass 2026-11-01/);
  const j = JSON.parse((await cap(d, ['--json'])).out);
  assert.deepEqual(Object.keys(j), ['port', 'nextItem', 'lastVerify', 'warnings']);
  assert.equal(j.nextItem, 'x');
});

test('lastVerify falls back to mtime; missing status and corrupt report are tolerated', async () => {
  const d = mk('veredge', { ...P, lane: undefined }, '');
  mkdirSync(path.join(d, 'verify'));
  const rf = path.join(d, 'verify', 'report.json');
  writeFileSync(rf, JSON.stringify({ status: 'warn' }));
  const lv = status(d).lastVerify;
  assert.equal(lv.status, 'warn');
  assert.ok(Math.abs(Date.parse(lv.at) - Date.now()) < 60_000);
  assert.match((await cap(d)).out, /lane \? ·/);
  writeFileSync(rf, JSON.stringify({ at: '2026-01-02T00:00:00Z' }));
  assert.deepEqual(status(d).lastVerify, { status: 'unknown', at: '2026-01-02T00:00:00Z' });
  writeFileSync(rf, '{corrupt');
  assert.deepEqual(status(d).lastVerify, { status: 'unreadable', at: null });
  assert.match((await cap(d)).out, /last verify unreadable\n/);
});

test('pag status fails open when status.mjs cannot load', () => {
  const d = path.join(base, 'loadfail'); mkdirSync(d);
  copyFileSync(new URL('../skills/port-any-game/scripts/pag.mjs', import.meta.url), path.join(d, 'pag.mjs'));
  writeFileSync(path.join(d, 'status.mjs'), 'this is not javascript');
  const r = spawnSync(process.execPath, [path.join(d, 'pag.mjs'), 'status'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /pag status: load error/);
});
