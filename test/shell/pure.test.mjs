import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizePath, matchManifest, Sha256, fileHasher, parseVerifyParams, readStoredZip } from '../../skills/port-any-game/assets/shell/pure.js';
import { createZip } from '../../skills/port-any-game/assets/shell/zip.js';
import { sha256File } from '../../skills/port-any-game/scripts/lib/fsx.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-pure-'));
after(() => rmSync(base, { recursive: true, force: true }));
const hex = (...bufs) => { const h = createHash('sha256'); for (const b of bufs) h.update(b); return h.digest('hex'); };
const MiB = 1024 * 1024;

test('normalizePath: separators, dots, NFC, traversal', () => {
  assert.equal(normalizePath('a\\b\\C.TXT'), 'a/b/C.TXT');
  assert.equal(normalizePath('./a//b/./c'), 'a/b/c');
  assert.equal(normalizePath('/abs/x'), 'abs/x');
  assert.equal(normalizePath('café.txt'), 'café.txt');
  assert.equal(normalizePath('a/../b'), null);
  assert.equal(normalizePath(''), null);
  assert.equal(normalizePath('./'), null);
});

const FILES = [
  { path: 'GAME.EXE', size: 10, sha256: 'a' },
  { path: 'data/level1.dat', size: 20, sha256: 'b' },
  { path: 'data/Music.ogg', size: 30, sha256: 'c' },
];

test('matchManifest: exact relative paths', () => {
  const { matched, missing } = matchManifest(FILES, [
    { path: 'GAME.EXE', size: 10 }, { path: 'data/level1.dat', size: 20 }, { path: 'data/Music.ogg', size: 30 }, { path: 'extra.txt', size: 1 },
  ]);
  assert.deepEqual(matched.map((m) => [m.entry.path, m.candidate.path]).sort(), [['GAME.EXE', 'GAME.EXE'], ['data/Music.ogg', 'data/Music.ogg'], ['data/level1.dat', 'data/level1.dat']]);
  assert.deepEqual(missing, []);
});

test('matchManifest: picked parent folder, backslashes and case differences', () => {
  const { matched, missing } = matchManifest(FILES, [
    { path: 'Games\\MyGame\\game.exe', size: 10 },
    { path: 'Games/MyGame/DATA/LEVEL1.DAT', size: 20 },
    { path: 'Games/Other/GAME.EXE', size: 10 }, // a second copy elsewhere must not win
  ]);
  assert.deepEqual(matched.map((m) => [m.entry.path, m.candidate.path]).sort(), [['GAME.EXE', 'Games\\MyGame\\game.exe'], ['data/level1.dat', 'Games/MyGame/DATA/LEVEL1.DAT']]);
  assert.deepEqual(missing.map((e) => e.path), ['data/Music.ogg']);
});

test('matchManifest: size mismatch is not a match, unknown size is', () => {
  const r1 = matchManifest(FILES, [{ path: 'GAME.EXE', size: 11 }]);
  assert.equal(r1.matched.length, 0);
  assert.equal(r1.missing.length, 3);
  const r2 = matchManifest(FILES, [{ path: 'GAME.EXE' }, { path: '../GAME.EXE', size: 10 }]);
  assert.deepEqual(r2.matched.map((m) => m.entry.path), ['GAME.EXE']);
});

test('matchManifest: case fallback only when unambiguous', () => {
  const files = [{ path: 'a.txt', size: 1 }, { path: 'A.TXT', size: 1 }];
  assert.deepEqual(matchManifest(files, [{ path: 'A.txt', size: 1 }]).matched, []);
  assert.deepEqual(matchManifest(files, [{ path: 'A.TXT', size: 1 }]).matched.map((m) => m.entry.path), ['A.TXT']);
});

test('Sha256 matches node:crypto at padding edges and across chunkings', () => {
  for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 100003]) {
    const buf = randomBytes(n);
    assert.equal(new Sha256().update(buf).digest(), hex(buf), `whole n=${n}`);
    const h = new Sha256();
    for (let i = 0; i < n; i += 7 + (i % 61)) h.update(buf.subarray(i, i + 7 + (i % 61)));
    assert.equal(h.digest(), hex(buf), `chunked n=${n}`);
  }
  assert.equal(new Sha256().update(new TextEncoder().encode('abc')).digest(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('fileHasher hashes small files whole, like sha256File', async () => {
  const buf = randomBytes(3 * MiB + 17);
  const f = path.join(base, 'small.bin');
  writeFileSync(f, buf);
  const h = fileHasher(buf.length);
  for (let i = 0; i < buf.length; i += 65536) h.update(buf.subarray(i, i + 65536));
  const want = await sha256File(f, buf.length);
  assert.deepEqual(h.digest(), { sha256: want.sha256, partial: false });
});

test('fileHasher uses first + last MiB above 256 MiB (partial rule)', () => {
  const size = 256 * MiB + 5;
  const chunk = (off, len) => { // byte at absolute position p (every 4 KiB) = p / 4096, so any slicing agrees
    const b = Buffer.alloc(len);
    for (let p = Math.ceil(off / 4096) * 4096; p < off + len; p += 4096) b[p - off] = (p / 4096) & 255;
    return b;
  };
  const h = fileHasher(size);
  const step = 3 * MiB + 1; // chunks straddle both range edges
  for (let off = 0; off < size; off += step) h.update(chunk(off, Math.min(step, size - off)));
  const want = hex(chunk(0, MiB), chunk(size - MiB, MiB));
  assert.deepEqual(h.digest(), { sha256: want, partial: true });
});

test('parseVerifyParams: same-origin import path only', () => {
  assert.deepEqual(parseVerifyParams('?verify_import=/__fixture/&verify_interrupt_after=1&verify_stage=gameplay'),
    { importUrl: '/__fixture/', interruptAfter: 1, stage: 'gameplay' });
  assert.deepEqual(parseVerifyParams(''), { importUrl: null, interruptAfter: 0, stage: null });
  for (const bad of ['https://evil.test/', '//evil.test/x/', '/\\evil.test/', 'javascript:alert(1)', 'rel/']) {
    assert.equal(parseVerifyParams(`?verify_import=${encodeURIComponent(bad)}`).importUrl, null, bad);
  }
  assert.equal(parseVerifyParams('?verify_import=/__fixture').importUrl, '/__fixture/');
  assert.equal(parseVerifyParams('?verify_interrupt_after=-2').interruptAfter, 0);
  assert.equal(parseVerifyParams('?verify_interrupt_after=abc').interruptAfter, 0);
});

test('readStoredZip round-trips createZip and rejects other methods', () => {
  const enc = (s) => new TextEncoder().encode(s);
  const zip = createZip([{ name: 'opfs/slot1.sav', data: enc('save-1') }, { name: 'localStorage.json', data: enc('{"k":"v"}') }]);
  const out = readStoredZip(zip);
  assert.deepEqual(out.map((e) => [e.name, new TextDecoder().decode(e.data)]), [['opfs/slot1.sav', 'save-1'], ['localStorage.json', '{"k":"v"}']]);
  const bad = new Uint8Array(zip);
  new DataView(bad.buffer).setUint16(8, 8, true); // local header method -> deflate
  const cd = Buffer.from(bad).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  new DataView(bad.buffer).setUint16(cd + 10, 8, true);
  assert.throws(() => readStoredZip(bad), /stored|method/i);
  assert.throws(() => readStoredZip(enc('not a zip')), /zip/i);
});

test('browser modules import cleanly without a DOM', async () => {
  for (const f of ['shell.js', 'import.js', 'storage.js', 'input.js', 'audio.js']) {
    await import(`../../skills/port-any-game/assets/shell/${f}`);
  }
  const lane = (await import('../fixtures/lane-test/adapter.js')).default;
  assert.equal(lane.id, 'lane-test');
  for (const k of ['start', 'pause', 'resume', 'frameCounter']) assert.equal(typeof lane[k], 'function', k);
});
