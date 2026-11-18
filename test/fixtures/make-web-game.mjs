// Emits the web-extract fixture game (test/fixtures/web-game, our own code) as an NW.js or an Electron install.
//   nwjs:     <dir>/package.nw (zip) + empty nw.dll
//   electron: <dir>/resources/app.asar + empty v8_context_snapshot.bin
// The game refers to Img/Title.PNG; the file inside the package is img/title.png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { makeAsar } from './make-asar.mjs';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web-game');
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// A valid 4x4 RGBA png, built from bytes (no binary file in the repo).
export function tinyPng() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(16, 0xcc)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat([row, row, row, row]))), chunk('IEND', Buffer.alloc(0))]);
}

// Minimal zip writer (deflate). files: {name: Buffer|string}
export function makeZip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), comp = deflateRawSync(data), nm = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, comp);
    central.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

export function gameFiles() {
  return {
    'package.json': JSON.stringify({ name: 'web-game-fixture', main: 'index.html', window: { width: 640, height: 480 } }),
    'index.html': readFileSync(path.join(SRC, 'index.html')),
    'game.js': readFileSync(path.join(SRC, 'game.js')),
    'img/title.png': tinyPng(),
  };
}

const WEBGL_TIMER_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>webgl-timer fixture</title><style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="640" height="480"></canvas>
<script>
const gl = document.getElementById('c').getContext('webgl');
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1]), gl.STATIC_DRAW);
let n = 0;
setInterval(() => {
  n++;
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(0.3 + (n % 50) / 80, 0.3 + (n % 30) / 50, 0.3 + (n % 70) / 100, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(100 + (n % 200), 100, 200, 150);
  gl.clearColor(1, 1, 0.2, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 0);
}, 16);
</script></body></html>
`;

const put = (file, data) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data); };

// variant: 'nwjs' | 'electron' | 'webgl-timer' (never calls rAF; draws on setInterval) | 'nwjs-redirect' (package.json main is start.html; there is no index.html). Returns dir.
export function makeWebGame(dir, variant = 'nwjs') {
  const files = gameFiles();
  if (variant === 'nwjs-redirect') {
    files['package.json'] = JSON.stringify({ name: 'web-game-fixture', main: 'start.html' });
    files['start.html'] = files['index.html'];
    delete files['index.html'];
  }
  if (variant === 'webgl-timer') {
    files['index.html'] = WEBGL_TIMER_HTML;
    delete files['game.js'];
  }
  if (variant === 'nwjs' || variant === 'webgl-timer' || variant === 'nwjs-redirect') {
    put(path.join(dir, 'package.nw'), makeZip(files));
    put(path.join(dir, 'nw.dll'), '');
  } else if (variant === 'electron') {
    put(path.join(dir, 'resources', 'app.asar'), makeAsar(files));
    put(path.join(dir, 'v8_context_snapshot.bin'), '');
  } else throw new Error(`unknown variant ${variant}`);
  return dir;
}
