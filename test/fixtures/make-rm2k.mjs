// Synthetic RPG Maker 2000 game (our own bytes, MIT; spike f §6): a database that names a title graphic, a window skin
// and the three title commands, an empty map tree, RPG_RT.ini, and two 8-bit palette PNGs. EasyRPG shows a title
// screen with a command window whose cursor flashes (two skin cursor frames, white and transparent), so the picture
// keeps changing for verify. Enter on New Game shows "The game has no start location set."
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const ber = (n) => { const out = [n & 0x7f]; while ((n >>>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
const str = (s) => [...Buffer.from(s, 'latin1')];
const chunk = (id, data) => [...ber(id), ...ber(data.length), ...data];

// RPG_RT only loads images of 8 bits per pixel or less. pixel(x, y) -> palette index; index 0 is transparent.
function palettePng(w, h, palette, pixel) {
  const pchunk = (type, data) => {
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = pixel(x, y);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), pchunk('IHDR', ihdr), pchunk('PLTE', Buffer.from(palette.flat())), pchunk('IDAT', deflateSync(raw)), pchunk('IEND', Buffer.alloc(0))]);
}

// 16 colour bands.
const titlePng = () => palettePng(320, 240, Array.from({ length: 16 }, (_, i) => [i * 16, 255 - i * 16, (i * 64) & 255]), (_x, y) => Math.floor(y / 15));
// Window skin (160x80): background (0,0), frame (32,0), cursor frames (64,0) white and (96,0) transparent, text colours below.
const systemPng = () => palettePng(160, 80, [[0, 0, 0], [40, 40, 120], [200, 200, 200], [255, 255, 255], [255, 220, 0]],
  (x, y) => (y >= 32 ? 4 : x < 32 ? 1 : x < 64 ? 2 : x < 96 ? 3 : x < 128 ? 0 : 4));

export function makeRm2k(dir, { root = '', fullPackage = true, upperCaseTitle = false } = {}) {
  const at = path.join(dir, root);
  const title = upperCaseTitle ? path.join('TITLE', 'TITLE.PNG') : path.join('Title', 'Title.png');
  mkdirSync(path.join(at, path.dirname(title)), { recursive: true });
  mkdirSync(path.join(at, 'System'), { recursive: true });
  // Terms (0x15): new_game, load_game, exit_game. System (0x16): title_name, system_name. All else: liblcf defaults.
  const terms = chunk(0x15, [...chunk(0x72, str('New Game')), ...chunk(0x73, str('Continue')), ...chunk(0x75, str('Shutdown')), 0]);
  const system = chunk(0x16, [...chunk(0x11, str('Title')), ...chunk(0x13, str('System')), 0]);
  writeFileSync(path.join(at, 'RPG_RT.ldb'), Buffer.from([...ber(11), ...str('LcfDataBase'), ...terms, ...system]));
  writeFileSync(path.join(at, 'RPG_RT.lmt'), Buffer.from([...ber(10), ...str('LcfMapTree'), 0, 0, 0, 0]));
  writeFileSync(path.join(at, 'RPG_RT.ini'), `[RPG_RT]\r\nGameTitle=pag\r\n${fullPackage ? 'FullPackageFlag=1\r\n' : ''}`);
  writeFileSync(path.join(at, title), titlePng());
  writeFileSync(path.join(at, 'System', 'System.png'), systemPng());
  return dir;
}
