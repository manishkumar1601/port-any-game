import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { extractTarGz, readAsar, extractAsar } from '../../skills/port-any-game/scripts/lib/archive.mjs';
import { makeAsar } from '../fixtures/make-asar.mjs';

function tarEntry(name, body) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0' + '00', 257);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([h, body, pad]);
}

test('extractTarGz strips leading component', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-tar-'));
  try {
    const tar = Buffer.concat([
      tarEntry('pkg-1.0/README', Buffer.from('hi')),
      tarEntry('pkg-1.0/bin/tool', Buffer.from('data')),
      Buffer.alloc(1024),
    ]);
    const tgz = path.join(dir, 'a.tar.gz');
    writeFileSync(tgz, gzipSync(tar));
    const names = await extractTarGz(tgz, path.join(dir, 'out'), { strip: 1 });
    assert.deepEqual(names.sort(), ['README', 'bin/tool']);
    assert.equal(readFileSync(path.join(dir, 'out', 'bin', 'tool'), 'utf8'), 'data');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('extractTarGz rejects entries that escape destDir', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-tar-'));
  try {
    const tgz = path.join(dir, 'evil.tar.gz');
    writeFileSync(tgz, gzipSync(Buffer.concat([tarEntry('../evil', Buffer.from('x')), Buffer.alloc(1024)])));
    await assert.rejects(extractTarGz(tgz, path.join(dir, 'out')), /escape/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAsar reads a file from asar built by test/fixtures/make-asar.mjs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-asar-'));
  try {
    const p = path.join(dir, 'app.asar');
    writeFileSync(p, makeAsar({ 'index.html': '<html>', 'js/main.js': 'console.log(1)' }));
    const a = readAsar(p);
    assert.deepEqual(a.files.map((f) => f.path).sort(), ['index.html', 'js/main.js']);
    assert.equal(a.read('js/main.js').toString(), 'console.log(1)');
    assert.throws(() => a.read('nope'), /not found/i);
    const names = await extractAsar(p, path.join(dir, 'out'));
    assert.deepEqual(names.sort(), ['index.html', 'js/main.js']);
    assert.equal(readFileSync(path.join(dir, 'out', 'index.html'), 'utf8'), '<html>');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
