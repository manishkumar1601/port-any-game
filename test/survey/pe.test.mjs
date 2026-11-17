import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseExecutable } from '../../skills/port-any-game/scripts/survey/pe.mjs';
import { readRange } from '../../skills/port-any-game/scripts/lib/fsx.mjs';
import { makePE, makeMZ, makeNE } from '../fixtures/make-pe.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'pag-pe-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let n = 0;
async function parse(buf, opts) {
  const f = path.join(dir, `f${n++}.exe`);
  writeFileSync(f, buf);
  return parseExecutable(f, buf.length, opts);
}

test('detects DOS MZ without PE', async () => {
  const i = await parse(makeMZ(Buffer.from('code')));
  assert.equal(i.format, 'MZ');
  assert.equal(i.machine, null);
});

test('detects NE', async () => {
  assert.equal((await parse(makeNE())).format, 'NE');
});

test('parses PE32 imports d3d8.dll dsound.dll', async () => {
  const i = await parse(makePE({ machine: 'i386', subsystem: 'gui',
    imports: { 'D3D8.dll': ['Direct3DCreate8'], 'dsound.dll': ['DirectSoundCreate'] }, linker: [6, 0] }));
  assert.equal(i.format, 'PE32');
  assert.equal(i.machine, 'i386');
  assert.equal(i.subsystem, 'gui');
  assert.equal(i.linker, '6.0');
  assert.deepEqual(i.imports, ['d3d8.dll', 'dsound.dll']);
  assert.equal(i.overlay, null);
});

test('parses PE32+ imports with 8-byte thunks', async () => {
  const i = await parse(makePE({ machine: 'amd64', subsystem: 'console', imports: { 'kernel32.dll': ['ExitProcess', 'Sleep'], 'xinput1_4.dll': ['XInputGetState'] } }));
  assert.equal(i.format, 'PE32+');
  assert.equal(i.machine, 'amd64');
  assert.equal(i.subsystem, 'console');
  assert.deepEqual(i.imports, ['kernel32.dll', 'xinput1_4.dll']);
});

test('reads delay imports', async () => {
  const i = await parse(makePE({ machine: 'amd64', imports: { 'kernel32.dll': ['Sleep'] }, delayImports: { 'd3d9.dll': ['Direct3DCreate9'] } }));
  assert.deepEqual(i.delayImports, ['d3d9.dll']);
});

test('flags CLR header', async () => {
  const i = await parse(makePE({ imports: { 'mscoree.dll': ['_CorExeMain'] }, clr: true }));
  assert.equal(i.clr, true);
  assert.ok(i.imports.includes('mscoree.dll'));
});

test('finds dllStrings not in imports', async () => {
  const i = await parse(makePE({ imports: { 'kernel32.dll': ['Sleep'] },
    sections: [{ name: '.rdata', size: 256, data: Buffer.from('d3d9.dll\0kernel32.dll\0') }] }));
  assert.deepEqual(i.dllStrings, ['d3d9.dll']);
});

test('detects SWF projector overlay', async () => {
  const swf = Buffer.concat([Buffer.from('FWS'), Buffer.alloc(61, 7)]);
  const trailer = Buffer.from([0x56, 0x34, 0x12, 0xfa, 0, 0, 0, 0]);
  trailer.writeUInt32LE(swf.length, 4);
  const exe = makePE({ overlay: Buffer.concat([swf, trailer]) });
  const i = await parse(exe);
  assert.equal(i.overlay.magic, 'swf');
  assert.equal(i.overlay.offset, exe.length - swf.length - 8);
  assert.equal(i.overlay.bytes, swf.length + 8);
});

test('detects other overlay magics', async () => {
  for (const [bytes, magic] of [['PK\x03\x04zzzz', 'zip'], ['CLIB\x1azz', 'ags-clib'], ['PAMEzzzz', 'clickteam'], ['junk', null]]) {
    assert.equal((await parse(makePE({ overlay: Buffer.from(bytes, 'latin1') }))).overlay.magic, magic);
  }
  const py = Buffer.concat([Buffer.alloc(100, 1), Buffer.from('MEI\x0c\x0b\x0a\x0b\x0e', 'latin1'), Buffer.alloc(60)]);
  assert.equal((await parse(makePE({ overlay: py }))).overlay.magic, 'pyinstaller');
  const pck = Buffer.concat([Buffer.alloc(100, 1), Buffer.from('GDPC')]);
  assert.equal((await parse(makePE({ overlay: pck }))).overlay.magic, 'godot-pck');
});

test('computes high entropy for random section > 7.5', async () => {
  const i = await parse(makePE({ sections: [{ name: '.text', size: 65536, fill: 'random' }, { name: '.pad', size: 4096, fill: 'zero' }] }));
  const by = Object.fromEntries(i.sections.map((s) => [s.name, s]));
  assert.ok(by['.text'].entropy > 7.5);
  assert.equal(by['.pad'].entropy, 0);
  assert.equal(by['.text'].rawSize, 65536);
});

test('reads productName', async () => {
  assert.equal((await parse(makePE({ productName: 'Space Quest' }))).productName, 'Space Quest');
  assert.equal((await parse(makePE({}))).productName, null);
});

test('returns null for non-executable', async () => {
  assert.equal(await parse(Buffer.from('hello world, definitely text, long enough to pass 64 bytes of header read......')), null);
  assert.equal(await parse(Buffer.alloc(0)), null);
});

test('does not throw on truncated PE', async () => {
  const i = await parse(makePE({ imports: { 'a.dll': ['f'] } }).subarray(0, 0x120));
  assert.equal(i.format, 'PE32');
  assert.deepEqual(i.imports, []);
});

test('never reads more than 4 MiB', async () => {
  const exe = makePE({ imports: { 'kernel32.dll': ['Sleep'] }, sections: [
    ...Array.from({ length: 6 }, (_, k) => ({ name: `.s${k}`, size: 8 * 1024 * 1024, fill: 'zero' })), { name: '.rdata', size: 4096 }] });
  assert.ok(exe.length > 48 * 1024 * 1024);
  let total = 0;
  const read = (abs, off, len) => { total += len; return readRange(abs, off, len); };
  const i = await parse(exe, { read });
  assert.equal(i.format, 'PE32');
  assert.ok(total <= 4 * 1024 * 1024, `read ${total}`);
  assert.ok(total > 1024 * 1024);
});
