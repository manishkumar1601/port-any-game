import { chmodSync, mkdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';

// Resolve an archive entry name under destDir; reject anything that escapes it (zip-slip).
function safeJoin(destDir, name) {
  const root = path.resolve(destDir);
  const target = path.resolve(root, ...name.split('/'));
  if (path.isAbsolute(name) || /^[a-zA-Z]:/.test(name) || (target !== root && !target.startsWith(root + path.sep))) {
    throw new Error(`archive entry escapes destination: ${name}`);
  }
  return target;
}

function writeOut(target, data, mode) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, data);
  if (mode && process.platform !== 'win32') chmodSync(target, mode & 0o777);
}

// ---- ZIP (store + deflate) ----
export function listZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  // A zip appended to an exe has offsets relative to the zip start: base is how far the zip is shifted.
  const base = Math.max(0, eocd - buf.readUInt32LE(eocd + 12) - buf.readUInt32LE(eocd + 16));
  let p = buf.readUInt32LE(eocd + 16) + base;
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    out.push({
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
      size: buf.readUInt32LE(p + 24),
      method: buf.readUInt16LE(p + 10),
      offset: buf.readUInt32LE(p + 42) + base,
      csize: buf.readUInt32LE(p + 20),
      attr: buf.readUInt32LE(p + 38),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// Returns the relative forward-slash names of the files written.
export async function extractZip(zipPath, destDir) {
  const buf = readFileSync(zipPath);
  const entries = listZip(buf);
  for (const e of entries) safeJoin(destDir, e.name); // validate everything before writing anything
  const written = [];
  for (const e of entries) {
    const target = safeJoin(destDir, e.name);
    if (e.name.endsWith('/')) { mkdirSync(target, { recursive: true }); continue; }
    const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
    const raw = buf.subarray(start, start + e.csize);
    let data;
    if (e.method === 0) data = raw;
    else if (e.method === 8) data = inflateRawSync(raw);
    else throw new Error(`unsupported zip method ${e.method} for ${e.name}`);
    writeOut(target, data, (e.attr >>> 16) & 0o111 ? (e.attr >>> 16) : 0);
    written.push(e.name);
  }
  return written;
}

// ---- tar.gz (ustar + GNU long names + pax path) ----
// Regular files and directories only; links and devices are skipped.
export async function extractTarGz(tgzPath, destDir, { strip = 0 } = {}) {
  const tar = gunzipSync(readFileSync(tgzPath));
  const str = (o, n) => { const s = tar.toString('utf8', o, o + n); const z = s.indexOf('\0'); return z < 0 ? s : s.slice(0, z); };
  const written = [];
  let longName = null;
  let paxPath = null;
  for (let p = 0; p + 512 <= tar.length;) {
    if (tar.readUInt8(p) === 0) break; // end-of-archive block
    const size = parseInt(str(p + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(tar[p + 156] || 0x30);
    const mode = parseInt(str(p + 100, 8).trim() || '0', 8);
    const prefix = str(p + 345, 155);
    let name = str(p, 100);
    if (prefix) name = `${prefix}/${name}`;
    const body = tar.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (m) paxPath = m[1];
      continue;
    }
    if (type === 'g') continue;
    name = paxPath ?? longName ?? name;
    longName = paxPath = null;
    const parts = name.split('/').filter((s) => s && s !== '.');
    const rel = parts.slice(strip).join('/');
    if (!rel) continue;
    const target = safeJoin(destDir, rel);
    if (type === '5') mkdirSync(target, { recursive: true });
    else if (type === '0' || type === '\0') {
      writeOut(target, body, mode & 0o111 ? mode : 0);
      written.push(rel);
    }
  }
  return written;
}

// ---- asar ----
// Layout checked against @electron/asar 4.3.2 (lib/disk.js readArchiveHeaderSync, lib/pickle.js):
//   [4..7] UInt32LE headerSize (length of the header pickle); header pickle = UInt32 payload size,
//   UInt32 JSON length (file offset 12), JSON padded to 4 (starts at offset 16); data starts at 8 + headerSize.
//   File nodes carry {size, offset (decimal string)}; `unpacked` files live outside the archive.
export function readAsar(asarPath) {
  const fd = openSync(asarPath, 'r');
  try {
    const total = fstatSync(fd).size;
    const prefix = Buffer.alloc(16);
    if (readSync(fd, prefix, 0, 16, 0) !== 16) throw new Error('not an asar: too short');
    const headerSize = prefix.readUInt32LE(4);
    const jsonLen = prefix.readUInt32LE(12);
    if (headerSize > total - 8 || jsonLen > headerSize) throw new Error('not an asar: bad header size');
    const json = Buffer.alloc(jsonLen);
    readSync(fd, json, 0, jsonLen, 16);
    const base = 8 + headerSize;
    const files = [];
    (function visit(node, prefixPath) {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const p = prefixPath ? `${prefixPath}/${name}` : name;
        if (child.files) visit(child, p);
        else if (child.offset !== undefined && !child.unpacked && !child.link) {
          files.push({ path: p, size: child.size, offset: base + Number(child.offset) });
        }
      }
    })(JSON.parse(json.toString('utf8')), '');
    const byPath = new Map(files.map((f) => [f.path, f]));
    return {
      files,
      read(p) {
        const f = byPath.get(p);
        if (!f) throw new Error(`asar entry not found: ${p}`);
        const out = Buffer.alloc(f.size);
        const fd2 = openSync(asarPath, 'r');
        try { readSync(fd2, out, 0, f.size, f.offset); } finally { closeSync(fd2); }
        return out;
      },
    };
  } finally {
    closeSync(fd);
  }
}

export async function extractAsar(asarPath, destDir) {
  const a = readAsar(asarPath);
  for (const f of a.files) safeJoin(destDir, f.path);
  for (const f of a.files) writeOut(safeJoin(destDir, f.path), a.read(f.path));
  return a.files.map((f) => f.path);
}
