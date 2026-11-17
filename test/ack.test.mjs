import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, ACK_IDS } from '../skills/port-any-game/scripts/ack.mjs';
import { LANES } from '../skills/port-any-game/scripts/lanes/index.mjs';

const PAG = fileURLToPath(new URL('../skills/port-any-game/scripts/pag.mjs', import.meta.url));
const base = mkdtempSync(path.join(tmpdir(), 'pag-ack-'));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
const port = () => {
  const d = path.join(base, `p${++n}`);
  mkdirSync(path.join(d, 'sub', 'deep'), { recursive: true });
  writeFileSync(path.join(d, 'port.json'), `${JSON.stringify({ schema: 'port-any-game/port@1', id: 'g', lane: 'dos-jsdos', acks: [] }, null, 2)}\n`);
  return d;
};
const acks = (d) => JSON.parse(readFileSync(path.join(d, 'port.json'), 'utf8')).acks;
const ack = async (argv, cwd = base) => {
  let out = '', err = '';
  const code = await run(argv, { cwd, out: (t) => { out += t; }, err: (t) => { err += t; } });
  return { code, out, err };
};

test('ack appends timestamped id', async () => {
  const d = port();
  const before = Date.now();
  const r = await ack(['ACK_PRIVATE_USE_ONLY', d]);
  assert.equal(r.code, 0, r.err);
  const a = acks(d);
  assert.equal(a.length, 1);
  assert.equal(a[0].id, 'ACK_PRIVATE_USE_ONLY');
  assert.ok(Date.parse(a[0].at) >= before - 1000 && Date.parse(a[0].at) <= Date.now(), a[0].at);
  assert.equal('note' in a[0], false);
  assert.match(r.out, /ACK_PRIVATE_USE_ONLY/);
});

test('finds the nearest port.json above the current folder', async () => {
  const d = port();
  const r = await ack(['ACK_RUNTIME_LICENSE'], path.join(d, 'sub', 'deep'));
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(acks(d).map((a) => a.id), ['ACK_RUNTIME_LICENSE']);
});

test('unknown ID exits 2 and changes nothing', async () => {
  const d = port();
  const was = readFileSync(path.join(d, 'port.json'), 'utf8');
  const r = await ack(['ACK_I_OWN_EVERYTHING', d]);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown acknowledgement/);
  assert.equal(readFileSync(path.join(d, 'port.json'), 'utf8'), was);
});

test('re-acking an existing ID is a no-op that says so', async () => {
  const d = port();
  assert.equal((await ack(['ACK_PRIVATE_USE_ONLY', d])).code, 0);
  const was = readFileSync(path.join(d, 'port.json'), 'utf8');
  const r = await ack(['ACK_PRIVATE_USE_ONLY', d]);
  assert.equal(r.code, 0);
  assert.match(r.out, /already recorded/);
  assert.equal(readFileSync(path.join(d, 'port.json'), 'utf8'), was);
});

test('ACK_RIGHTS_HOLDER without a note exits 2', async () => {
  const d = port();
  for (const argv of [['ACK_RIGHTS_HOLDER', d], ['ACK_RIGHTS_HOLDER', d, '--note', '   ']]) {
    const r = await ack(argv);
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.err, /--note/);
  }
  assert.deepEqual(acks(d), []);
});

test('the note is stored verbatim', async () => {
  const d = port();
  const note = '  I made this game myself in 2003 — "Foo", all art is mine.\n';
  const r = await ack(['ACK_RIGHTS_HOLDER', '--note', note, d]);
  assert.equal(r.code, 0, r.err);
  assert.equal(acks(d)[0].note, note);
});

test('outside a port folder exits 2', async () => {
  const d = path.join(base, 'not-a-port');
  mkdirSync(d, { recursive: true });
  const r = await ack(['ACK_PRIVATE_USE_ONLY', d]);
  assert.equal(r.code, 2);
  assert.match(r.err, /port\.json/);
});

test('accepts every acknowledgement the survey or an available lane can ask for', () => {
  const asked = ['ACK_UPX_PACKED', 'ACK_PROTECTION_WARN', ...Object.values(LANES).filter((l) => l.available).flatMap((l) => l.acks)];
  for (const id of asked) assert.ok(ACK_IDS.includes(id), id);
  for (const id of ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE', 'ACK_GREY_ASSET_EXTRACT', 'ACK_GREY_DECOMPILE', 'ACK_RIGHTS_HOLDER']) assert.ok(ACK_IDS.includes(id), id);
});

test('pag ack is registered in the CLI', () => {
  const d = port();
  const r = spawnSync(process.execPath, [PAG, 'ack', 'ACK_PRIVATE_USE_ONLY', d], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(acks(d).map((a) => a.id), ['ACK_PRIVATE_USE_ONLY']);
});
