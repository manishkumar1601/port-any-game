// Pure shell helpers: no DOM, no Node. Shared by the page, the import Worker and the Node tests.
const MiB = 1024 * 1024;
const PARTIAL_OVER = 256 * MiB; // same rule as scripts/lib/fsx.mjs sha256File

// Relative POSIX path, NFC, no empty/'.' segments. null for '..' or nothing left.
export function normalizePath(p) {
  const segs = [];
  for (const s of String(p).replace(/\\/g, '/').split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') return null;
    segs.push(s.normalize('NFC'));
  }
  return segs.length ? segs.join('/') : null;
}

// Exact path first, then case-insensitive when exactly one entry folds to it (DOS/Windows games ignore case).
export function pathLookup(entries, key = (e) => e) {
  const exact = new Map();
  const folded = new Map();
  for (const e of entries) {
    const k = key(e);
    exact.set(k, e);
    const f = k.toLowerCase();
    folded.set(f, folded.has(f) ? null : e);
  }
  return (p) => exact.get(p) ?? folded.get(p.toLowerCase()) ?? undefined;
}

// Identify picked/dropped files against manifest.files by relative path + size (size undefined = unknown).
// The picked folder may be the game folder or any parent of it: the leading folder prefix with most hits wins.
export function matchManifest(files, candidates) {
  const find = pathLookup(files, (f) => f.path);
  const fits = (e, c) => e && (c.size === undefined || c.size === e.size);
  const segsOf = candidates.map((c) => normalizePath(c.path)?.split('/') ?? []);
  const votes = new Map();
  segsOf.forEach((segs, i) => {
    for (let k = 0; k < segs.length; k++) {
      if (!fits(find(segs.slice(k).join('/')), candidates[i])) continue;
      const pre = segs.slice(0, k).join('/');
      votes.set(pre, (votes.get(pre) ?? 0) + 1);
    }
  });
  let prefix = '';
  let best = 0;
  for (const [pre, v] of votes) if (v > best || (v === best && pre.length < prefix.length)) [prefix, best] = [pre, v];
  const drop = prefix ? prefix.split('/').length : 0;
  const matched = [];
  const taken = new Set();
  segsOf.forEach((segs, i) => {
    if (segs.length <= drop || segs.slice(0, drop).join('/') !== prefix) return;
    const e = find(segs.slice(drop).join('/'));
    if (!fits(e, candidates[i]) || taken.has(e.path)) return;
    taken.add(e.path);
    matched.push({ entry: e, candidate: candidates[i] });
  });
  return { matched, missing: files.filter((f) => !taken.has(f.path)) };
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// Incremental SHA-256 (crypto.subtle has no update(); whole-buffer digests of multi-GB files run out of memory).
export class Sha256 {
  #h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  #w = new Uint32Array(64);
  #buf = new Uint8Array(64);
  #n = 0;
  #len = 0;

  update(data) {
    let i = 0;
    this.#len += data.length;
    if (this.#n) {
      i = Math.min(64 - this.#n, data.length);
      this.#buf.set(data.subarray(0, i), this.#n);
      this.#n += i;
      if (this.#n < 64) return this;
      this.#block(this.#buf, 0);
      this.#n = 0;
    }
    for (; i + 64 <= data.length; i += 64) this.#block(data, i);
    if (i < data.length) { this.#buf.set(data.subarray(i)); this.#n = data.length - i; }
    return this;
  }

  digest() {
    const bits = this.#len * 8;
    const pad = new Uint8Array(((this.#n + 9 + 63) & ~63) - this.#n);
    const dv = new DataView(pad.buffer);
    pad[0] = 0x80;
    dv.setUint32(pad.length - 8, Math.floor(bits / 2 ** 32));
    dv.setUint32(pad.length - 4, bits >>> 0);
    this.update(pad);
    return Array.from(this.#h, (x) => x.toString(16).padStart(8, '0')).join('');
  }

  #block(d, o) {
    const w = this.#w;
    const H = this.#h;
    for (let t = 0; t < 16; t++, o += 4) w[t] = (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], e0 = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (e0 + t1) | 0; e0 = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += e0; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
}

// Streaming file hash that matches the manifest: whole file up to 256 MiB, else first + last 1 MiB (partial).
// Feed every chunk in order; bytes outside the hashed ranges are skipped.
export function fileHasher(size) {
  const h = new Sha256();
  const partial = size > PARTIAL_OVER;
  const ranges = partial ? [[0, MiB], [size - MiB, size]] : [[0, size]];
  let off = 0;
  return {
    update(chunk) {
      for (const [a, b] of ranges) {
        const s = Math.max(a, off);
        const e = Math.min(b, off + chunk.length);
        if (s < e) h.update(chunk.subarray(s - off, e - off));
      }
      off += chunk.length;
    },
    digest: () => ({ sha256: h.digest(), partial }),
  };
}

// Verify hooks, read from location.search only. verify_import must stay a same-origin absolute path.
export function parseVerifyParams(search) {
  const q = new URLSearchParams(search);
  let importUrl = null;
  const raw = q.get('verify_import');
  if (raw?.startsWith('/')) {
    try {
      const u = new URL(raw, 'https://pag.invalid/');
      if (u.origin === 'https://pag.invalid') importUrl = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
    } catch { /* not a URL */ }
  }
  const n = Number.parseInt(q.get('verify_interrupt_after') ?? '', 10);
  return { importUrl, interruptAfter: n > 0 ? n : 0, stage: q.get('verify_stage') };
}

// Reads the stored (method 0) zips that exportSaves writes. Returns [{name, data}].
export function readStoredZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const dec = new TextDecoder();
  const out = [];
  let p = dv.getUint32(eocd + 16, true);
  for (let i = dv.getUint16(eocd + 10, true); i > 0; i--) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt zip file');
    const nlen = dv.getUint16(p + 28, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    if (dv.getUint16(p + 10, true) !== 0) throw new Error(`${name}: only stored (method 0) zips written by exportSaves are supported`);
    const off = dv.getUint32(p + 42, true);
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    out.push({ name, data: u8.slice(start, start + dv.getUint32(p + 20, true)) });
    p += 46 + nlen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}
