import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createZip } from '../../skills/port-any-game/assets/shell/zip.js';
import { extractZip, listZip } from '../../skills/port-any-game/scripts/lib/archive.mjs';

const enc = (s) => new TextEncoder().encode(s);

test('createZip round-trips through extractZip', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-zip-'));
  try {
    const zip = createZip([
      { name: 'a.txt', data: enc('hello') },
      { name: 'sub/b.bin', data: new Uint8Array([0, 1, 2, 255]) },
      { name: 'empty', data: new Uint8Array(0) },
    ]);
    const zipPath = path.join(dir, 'x.zip');
    writeFileSync(zipPath, zip);
    const out = path.join(dir, 'out');
    const names = await extractZip(zipPath, out);
    assert.deepEqual(names.sort(), ['a.txt', 'empty', 'sub/b.bin']);
    assert.equal(readFileSync(path.join(out, 'a.txt'), 'utf8'), 'hello');
    assert.deepEqual([...readFileSync(path.join(out, 'sub', 'b.bin'))], [0, 1, 2, 255]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createZip sets 0755 external attr', () => {
  const zip = Buffer.from(createZip([{ name: 'run.sh', data: enc('#!/bin/sh\n'), mode: 0o755 }]));
  const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(cd >= 0);
  assert.equal(zip.readUInt32LE(cd + 38), ((0o100000 | 0o755) << 16) >>> 0);
  assert.deepEqual(listZip(zip).map((e) => [e.name, e.size, e.method]), [['run.sh', 10, 0]]);
});

test('extractZip rejects ../ entries', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-zip-'));
  try {
    const zipPath = path.join(dir, 'evil.zip');
    writeFileSync(zipPath, createZip([{ name: '../evil.txt', data: enc('x') }]));
    await assert.rejects(extractZip(zipPath, path.join(dir, 'out')), /escape/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
