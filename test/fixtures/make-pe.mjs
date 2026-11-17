// Synthetic executables for tests. No real game binaries anywhere.
// Layout: DOS header, PE headers padded to 0x400, then sections (RVA == file offset).
import { randomBytes } from 'node:crypto';

const MACHINE = { i386: 0x14c, amd64: 0x8664, arm64: 0xaa64, other: 0x1c0 };
const ALIGN = 0x200;
const HDR = 0x400;
const LFANEW = 0x80;
const up = (n) => Math.ceil(n / ALIGN) * ALIGN;

export function makeMZ(code = Buffer.alloc(0)) {
  const b = Buffer.alloc(64);
  b.write('MZ', 0, 'latin1'); // e_lfanew stays 0: plain DOS
  return Buffer.concat([b, code]);
}

export function makeNE() {
  const b = Buffer.alloc(0x100);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(LFANEW, 0x3c);
  b.write('NE', LFANEW, 'latin1');
  return b;
}

// imports/delayImports: {dll: [function names]}. sections: [{name, size, fill?, data?}] (data = bytes placed at section start).
// Extensions over the brief: section `data`, plus `linker` and `timestamp` options.
export function makePE({ machine = 'i386', subsystem = 'gui', imports = {}, delayImports = {}, sections = [],
  clr = false, overlay, productName, linker = [6, 0], timestamp = 0 } = {}) {
  const pe32p = machine === 'amd64' || machine === 'arm64';
  const tsz = pe32p ? 8 : 4;
  const secs = [{ name: '.idata' }, ...(productName ? [{ name: '.rsrc' }] : []), ...sections.map((s) => ({ ...s }))];

  // .idata content: [import descs][delay descs][clr header][thunks + names]; RVA of .idata is HDR.
  const nImp = Object.keys(imports).length, nDel = Object.keys(delayImports).length;
  const impAt = 0, delAt = 20 * (nImp + 1), clrAt = delAt + 32 * (nDel + 1);
  let cur = clrAt + 72;
  const blobs = [];
  const place = (buf) => { const at = cur; blobs.push([at, buf]); cur += buf.length + (buf.length & 1); return HDR + at; };
  const descs = (table, size, tableAt, delay) => Object.entries(table).forEach(([dll, fns], i) => {
    const hn = fns.map((f) => place(Buffer.concat([Buffer.alloc(2), Buffer.from(f + '\0')])));
    const thunks = Buffer.alloc(tsz * (fns.length + 1));
    hn.forEach((rva, k) => (pe32p ? thunks.writeBigUInt64LE(BigInt(rva), k * 8) : thunks.writeUInt32LE(rva, k * 4)));
    const thunkRva = place(thunks);
    const nameRva = place(Buffer.from(dll + '\0'));
    const d = Buffer.alloc(size);
    if (delay) { d.writeUInt32LE(1, 0); d.writeUInt32LE(nameRva, 4); d.writeUInt32LE(thunkRva, 16); }
    else { d.writeUInt32LE(thunkRva, 0); d.writeUInt32LE(nameRva, 12); d.writeUInt32LE(thunkRva, 16); }
    blobs.push([tableAt + i * size, d]);
  });
  descs(imports, 20, impAt, false);
  descs(delayImports, 32, delAt, true);
  secs[0].size = cur; secs[0].blobs = blobs;

  if (productName) {
    // VS_VERSIONINFO String: wLength, wValueLength, wType, key (UTF-16LE), pad to 4, value.
    const key = Buffer.from('ProductName\0', 'utf16le'), val = Buffer.from(productName + '\0', 'utf16le');
    const s = Buffer.alloc(32 + val.length + 4);
    s.writeUInt16LE(s.length, 0); s.writeUInt16LE(productName.length + 1, 2); s.writeUInt16LE(1, 4);
    key.copy(s, 6); val.copy(s, 32);
    secs[1].size = 16 + s.length; secs[1].blobs = [[16, s]];
  }
  let rva = HDR;
  for (const s of secs) { s.raw = up(s.size); s.rva = rva; rva += s.raw; }

  const optSize = pe32p ? 240 : 224;
  const h = Buffer.alloc(HDR);
  h.write('MZ', 0, 'latin1'); h.writeUInt32LE(LFANEW, 0x3c);
  h.write('PE\0\0', LFANEW, 'latin1');
  const c = LFANEW + 4;
  h.writeUInt16LE(MACHINE[machine], c); h.writeUInt16LE(secs.length, c + 2);
  h.writeUInt32LE(timestamp, c + 4); h.writeUInt16LE(optSize, c + 16);
  const o = c + 20;
  h.writeUInt16LE(pe32p ? 0x20b : 0x10b, o); h[o + 2] = linker[0]; h[o + 3] = linker[1];
  h.writeUInt16LE(subsystem === 'console' ? 3 : 2, o + 68);
  h.writeUInt32LE(16, o + (pe32p ? 108 : 92));
  const dir = (n, r, sz) => { const at = o + (pe32p ? 112 : 96) + n * 8; h.writeUInt32LE(r, at); h.writeUInt32LE(sz, at + 4); };
  if (nImp) dir(1, HDR + impAt, 20 * (nImp + 1));
  if (productName) dir(2, secs[1].rva, secs[1].size);
  if (nDel) dir(13, HDR + delAt, 32 * (nDel + 1));
  if (clr) dir(14, HDR + clrAt, 72);
  secs.forEach((s, i) => {
    const at = o + optSize + i * 40;
    h.write(s.name, at, 'latin1');
    h.writeUInt32LE(s.size, at + 8); h.writeUInt32LE(s.rva, at + 12);
    h.writeUInt32LE(s.raw, at + 16); h.writeUInt32LE(s.rva, at + 20);
  });

  const body = secs.map((s) => {
    const b = s.fill === 'random' ? randomBytes(s.raw) : Buffer.alloc(s.raw);
    for (const [at, buf] of s.blobs ?? []) buf.copy(b, at);
    if (s.data) s.data.copy(b, 0);
    return b;
  });
  return Buffer.concat([h, ...body, ...(overlay ? [overlay] : [])]);
}
