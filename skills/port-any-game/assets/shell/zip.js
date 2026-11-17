// Isomorphic ZIP writer (store method, CRC-32). Pure Uint8Array: no Node or DOM imports.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, keeps output deterministic

// entries: Array<{name: string, data: Uint8Array, mode?: number}> -> Uint8Array
export function createZip(entries) {
  const enc = new TextEncoder();
  const prepared = entries.map((e) => ({
    name: enc.encode(e.name),
    data: e.data,
    crc: crc32(e.data),
    attr: ((0o100000 | (e.mode ?? 0o644)) << 16) >>> 0,
  }));
  let total = 22;
  for (const e of prepared) total += 30 + e.name.length + e.data.length + 46 + e.name.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let p = 0;
  const offsets = [];
  for (const e of prepared) {
    offsets.push(p);
    dv.setUint32(p, 0x04034b50, true);
    dv.setUint16(p + 4, 20, true);
    dv.setUint16(p + 6, 0x0800, true); // UTF-8 names
    dv.setUint16(p + 8, 0, true); // store
    dv.setUint16(p + 10, DOS_TIME, true);
    dv.setUint16(p + 12, DOS_DATE, true);
    dv.setUint32(p + 14, e.crc, true);
    dv.setUint32(p + 18, e.data.length, true);
    dv.setUint32(p + 22, e.data.length, true);
    dv.setUint16(p + 26, e.name.length, true);
    dv.setUint16(p + 28, 0, true);
    out.set(e.name, p + 30);
    out.set(e.data, p + 30 + e.name.length);
    p += 30 + e.name.length + e.data.length;
  }
  const cdStart = p;
  prepared.forEach((e, i) => {
    dv.setUint32(p, 0x02014b50, true);
    dv.setUint16(p + 4, (3 << 8) | 20, true); // made by Unix so external attr carries the mode
    dv.setUint16(p + 6, 20, true);
    dv.setUint16(p + 8, 0x0800, true);
    dv.setUint16(p + 10, 0, true);
    dv.setUint16(p + 12, DOS_TIME, true);
    dv.setUint16(p + 14, DOS_DATE, true);
    dv.setUint32(p + 16, e.crc, true);
    dv.setUint32(p + 20, e.data.length, true);
    dv.setUint32(p + 24, e.data.length, true);
    dv.setUint16(p + 28, e.name.length, true);
    // extra, comment, disk, internal attrs stay 0
    dv.setUint32(p + 38, e.attr, true);
    dv.setUint32(p + 42, offsets[i], true);
    out.set(e.name, p + 46);
    p += 46 + e.name.length;
  });
  dv.setUint32(p, 0x06054b50, true);
  dv.setUint16(p + 8, prepared.length, true);
  dv.setUint16(p + 10, prepared.length, true);
  dv.setUint32(p + 12, p - cdStart, true);
  dv.setUint32(p + 16, cdStart, true);
  return out;
}
