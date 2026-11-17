// Synthetic Flash fixtures. Hand-assembled uncompressed SWF v6, our own bytes (no third-party SWF).
// Layout: "FWS" | version | u32 file length | FrameSize RECT | frame rate (8.8) | frame count | tags... | End.
//   SetBackgroundColor (9):  RGB #3366CC
//   DefineShape (2):         id 1, 100x100 px solid #FFCC00 rectangle (one fill style, four straight edges)
//   PlaceObject2 (26):       frame 1 places id 1 at depth 1 (HasCharacter|HasMatrix), the rest move it +8 px in x (Move|HasMatrix)
//   ShowFrame (1) after each of the 60 frames, then End (0).
import { makePE } from './make-pe.mjs';

const TWIPS = 20;

// MSB-first bit writer.
function bits() {
  const out = [];
  let cur = 0;
  let n = 0;
  const w = {
    ub(v, count) { for (let i = count - 1; i >= 0; i--) { cur = (cur << 1) | ((v >> i) & 1); if (++n === 8) { out.push(cur); cur = 0; n = 0; } } return w; },
    sb(v, count) { return w.ub(v & ((1 << count) - 1), count); },
    bytes() { if (n) { out.push(cur << (8 - n)); cur = 0; n = 0; } return Buffer.from(out); },
  };
  return w;
}

const rect = (xMax, yMax, nb) => bits().ub(nb, 5).sb(0, nb).sb(xMax, nb).sb(0, nb).sb(yMax, nb).bytes();
const tag = (type, body) => {
  const h = Buffer.alloc(2);
  h.writeUInt16LE((type << 6) | body.length); // every body here is < 63 bytes: short header
  return Buffer.concat([h, body]);
};
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };

function shapeBody() {
  const side = 100 * TWIPS; // 2000 twips: 12 signed bits
  const edges = bits()
    .ub(1, 4).ub(0, 4) // NumFillBits 1, NumLineBits 0
    .ub(0, 1).ub(0, 1).ub(0, 1).ub(1, 1).ub(0, 1).ub(1, 1) // style change: not an edge, FillStyle1 + MoveTo
    .ub(1, 5).sb(0, 1).sb(0, 1) // MoveTo (0,0) with 1 bit each
    .ub(1, 1); // FillStyle1 = 1
  for (const [dx, dy] of [[side, 0], [0, side], [-side, 0], [0, -side]]) edges.ub(1, 1).ub(1, 1).ub(10, 4).ub(1, 1).sb(dx, 12).sb(dy, 12); // straight, NumBits-2 = 10, general line
  edges.ub(0, 1).ub(0, 5); // EndShapeRecord
  return Buffer.concat([u16(1), rect(side, side, 12), Buffer.from([1, 0x00, 0xFF, 0xCC, 0x00, 0]), edges.bytes()]); // 1 solid fill #FFCC00, 0 line styles
}

function place(i) {
  const m = bits().ub(0, 1).ub(0, 1).ub(15, 5).sb(i * 8 * TWIPS, 15).sb(190 * TWIPS, 15).bytes(); // no scale/rotate, translate only
  return i === 0
    ? tag(26, Buffer.concat([Buffer.from([0x06]), u16(1), u16(1), m]))
    : tag(26, Buffer.concat([Buffer.from([0x05]), u16(1), m]));
}

export function makeAnimSwf() {
  const FRAMES = 60;
  const frameSize = rect(640 * TWIPS, 480 * TWIPS, 15);
  const head = Buffer.concat([frameSize, Buffer.from([0x00, 30]), u16(FRAMES)]); // 30.0 fps as 8.8 fixed
  const tags = [tag(9, Buffer.from([0x33, 0x66, 0xCC])), tag(2, shapeBody())];
  for (let i = 0; i < FRAMES; i++) tags.push(place(i), tag(1, Buffer.alloc(0)));
  tags.push(tag(0, Buffer.alloc(0)));
  const body = Buffer.concat([head, ...tags]);
  const hdr = Buffer.alloc(8);
  hdr.write('FWS', 0, 'latin1');
  hdr[3] = 6;
  hdr.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([hdr, body]);
}

// A Flash projector: a PE executable with the SWF appended, then 56 34 12 FA + u32 LE swf length.
export function makeProjector(swf) {
  const t = Buffer.alloc(8);
  Buffer.from([0x56, 0x34, 0x12, 0xFA]).copy(t);
  t.writeUInt32LE(swf.length, 4);
  return Buffer.concat([makePE(), swf, t]);
}
