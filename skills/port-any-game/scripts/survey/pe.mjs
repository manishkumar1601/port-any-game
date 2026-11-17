// Bounded, read-only executable parser. Never executes or loads anything.
// All reads go through `read` (default fsx.readRange; tests inject a counting reader)
// and are hard-capped at 4 MiB in total per executable.
import { readRange } from '../lib/fsx.mjs';

const MiB = 1024 * 1024;
const BUDGET = 4 * MiB;
const ENTROPY_BUDGET = 2 * MiB; // at most 1 MiB per section
const SCAN = 512 * 1024; // per .rdata/.data/.rsrc scan
const MAX_DLLS = 256;
const MACHINES = { 0x14c: 'i386', 0x8664: 'amd64', 0xaa64: 'arm64' };
const MACHO = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe];

// Returns null when the file is not an executable; malformed headers yield partial info, never a throw.
export async function parseExecutable(abs, size, { read = readRange } = {}) {
  let used = 0;
  const rd = async (off, len) => {
    len = Math.max(0, Math.min(len, BUDGET - used, size - off));
    if (len <= 0) return Buffer.alloc(0);
    used += len;
    return read(abs, off, len);
  };

  async function parseNewHeader(info, lfanew) {
    const h = await rd(lfanew, 4 + 20 + 240 + 40 * 96);
    const sig = h.toString('latin1', 0, 2);
    if (sig === 'NE') { info.format = 'NE'; return; }
    if (sig === 'LE' || sig === 'LX') { info.format = sig; return; }
    if (h.toString('latin1', 0, 4) !== 'PE\0\0') return;

    const nSec = Math.min(h.readUInt16LE(6), 96), optSize = h.readUInt16LE(20), o = 24;
    const magic = h.readUInt16LE(o);
    const p = magic === 0x20b;
    if (magic !== 0x10b && !p) return;
    info.format = p ? 'PE32+' : 'PE32';
    info.machine = MACHINES[h.readUInt16LE(4)] ?? 'other';
    const sub = h.readUInt16LE(o + 68);
    info.subsystem = sub === 2 ? 'gui' : sub === 3 ? 'console' : 'other';
    info.linker = `${h[o + 2]}.${h[o + 3]}`;
    const ts = h.readUInt32LE(8);
    info.timestamp = ts ? new Date(ts * 1000).toISOString() : null; // low trust: trivially forged
    const imageBase = p ? Number(h.readBigUInt64LE(o + 24)) : h.readUInt32LE(o + 28);
    const nDirs = Math.min(h.readUInt32LE(o + (p ? 108 : 92)), 16);
    const dir = (n) => {
      if (n >= nDirs) return { rva: 0, size: 0 };
      const at = o + (p ? 112 : 96) + n * 8;
      return { rva: h.readUInt32LE(at), size: h.readUInt32LE(at + 4) };
    };

    const secs = [];
    for (let i = 0; i < nSec; i++) {
      const at = o + optSize + i * 40;
      if (at + 40 > h.length) break;
      secs.push({
        name: h.toString('latin1', at, at + 8).replace(/\0.*$/, ''),
        vsize: h.readUInt32LE(at + 8), va: h.readUInt32LE(at + 12),
        rawSize: h.readUInt32LE(at + 16), rawPtr: h.readUInt32LE(at + 20),
      });
    }
    const secOf = (rva) => secs.find((x) => rva >= x.va && rva < x.va + Math.max(x.vsize, x.rawSize));
    const toOff = (rva) => { const s = secOf(rva); return s ? s.rawPtr + rva - s.va : -1; };
    const cstr = async (rva) => {
      const off = toOff(rva);
      if (off < 0) return null;
      const b = await rd(off, 128);
      const end = b.indexOf(0);
      return (end < 0 ? b : b.subarray(0, end)).toString('latin1').toLowerCase() || null;
    };
    // Only DLL names are collected (function thunks, 4- or 8-byte, are not needed), so one table read per directory.
    const dllTable = async (d, stride, nameAt, delay) => {
      const off = d.rva ? toOff(d.rva) : -1;
      if (off < 0) return [];
      const t = await rd(off, stride * (MAX_DLLS + 1));
      const out = [];
      for (let i = 0; (i + 1) * stride <= t.length; i++) {
        let nameRva = t.readUInt32LE(i * stride + nameAt);
        if (!nameRva) break;
        if (delay && !(t.readUInt32LE(i * stride) & 1)) nameRva -= imageBase; // pre-VC7 tables hold VAs
        const n = await cstr(nameRva);
        if (n) out.push(n);
      }
      return out;
    };
    info.imports = await dllTable(dir(1), 20, 12, false);
    info.delayImports = await dllTable(dir(13), 32, 4, true);
    info.clr = dir(14).rva !== 0;

    // Overlay: after the last raw section byte, minus a trailing Authenticode blob (dir 4 "rva" is a file offset).
    const end = Math.max(0, ...secs.map((s) => s.rawPtr + s.rawSize));
    const cert = dir(4).rva;
    const limit = cert >= end && cert <= size ? cert : size;
    if (end < limit) info.overlay = await overlayInfo(end, limit - end);

    const named = new Set([...info.imports, ...info.delayImports]);
    const found = new Set();
    for (const s of secs.filter((x) => x.name === '.rdata' || x.name === '.data')) {
      const text = (await rd(s.rawPtr, Math.min(s.rawSize, SCAN))).toString('latin1');
      for (const m of text.matchAll(/[\w.-]{1,64}\.dll(?=\0)/gi)) found.add(m[0].toLowerCase());
    }
    info.dllStrings = [...found].filter((x) => !named.has(x));
    const rs = dir(2).rva ? secOf(dir(2).rva) : null;
    if (rs) info.productName = productNameOf(await rd(rs.rawPtr, Math.min(rs.rawSize, SCAN)));

    let eBudget = ENTROPY_BUDGET;
    for (const s of secs) {
      const len = Math.min(s.rawSize, MiB, eBudget);
      let entropy = 0;
      if (s.rawSize && len > 0) { eBudget -= len; entropy = shannon(await rd(s.rawPtr, len)); }
      else if (s.rawSize) entropy = null; // budget exhausted: not measured
      info.sections.push({ name: s.name, rawSize: s.rawSize, entropy });
    }
  }

  async function overlayInfo(offset, bytes) {
    const start = await rd(offset, 16);
    const tail = await rd(offset + Math.max(0, bytes - 4096), Math.min(bytes, 4096));
    const at = (s) => start.toString('latin1', 0, s.length) === s;
    let magic = null;
    if (/^[FCZ]WS/.test(start.toString('latin1', 0, 3))) magic = 'swf';
    else if (at('PK\x03\x04')) magic = 'zip';
    else if (at('CLIB\x1a')) magic = 'ags-clib';
    else if (at('GDPC') || tail.toString('latin1', Math.max(0, tail.length - 4)) === 'GDPC') magic = 'godot-pck';
    else if (at('PAME') || at('PAMU')) magic = 'clickteam';
    else if (tail.includes(Buffer.from('MEI\x0c\x0b\x0a\x0b\x0e', 'latin1'))) magic = 'pyinstaller';
    else if (tail.length >= 8 && tail.readUInt32BE(tail.length - 8) === 0x563412fa) {
      // projector trailer: 56 34 12 FA + uint32 length of the embedded SWF
      const len = tail.readUInt32LE(tail.length - 4);
      if (len > 0 && len <= bytes - 8) {
        const swf = await rd(offset + bytes - 8 - len, 3);
        if (/^[FCZ]WS$/.test(swf.toString('latin1'))) magic = 'swf';
      }
    }
    return { offset, bytes, magic };
  }

  try {
    const head = await rd(0, 64);
    if (head.length >= 4) {
      if (head.readUInt32BE(0) === 0x7f454c46) return base('ELF');
      if (MACHO.includes(head.readUInt32BE(0))) return base('MachO');
    }
    if (head.length < 64 || head.toString('latin1', 0, 2) !== 'MZ') return null;
    const info = base('MZ');
    try {
      const lfanew = head.readUInt32LE(0x3c);
      if (lfanew >= 64 && lfanew + 4 <= size) await parseNewHeader(info, lfanew);
    } catch { /* malformed: keep what was parsed */ }
    return info;
  } catch {
    return null;
  }
}

function base(format) {
  return { format, machine: null, subsystem: null, clr: false, sections: [], imports: [], delayImports: [],
    dllStrings: [], overlay: null, linker: null, timestamp: null, productName: null };
}

function shannon(buf) {
  const c = new Array(256).fill(0);
  for (const b of buf) c[b]++;
  let h = 0;
  for (const n of c) if (n) h -= (n / buf.length) * Math.log2(n / buf.length);
  return h;
}

// VS_VERSIONINFO String: 6-byte header, UTF-16LE key, pad to 4 (relative to the struct), then the value.
function productNameOf(buf) {
  const k = buf.indexOf(Buffer.from('ProductName\0', 'utf16le'));
  if (k < 6) return null;
  const v = k - 6 + 32; // header 6 + key 24 = 30, padded to 32
  let e = v;
  while (e + 1 < buf.length && (buf[e] || buf[e + 1])) e += 2;
  return buf.toString('utf16le', v, e) || null;
}
