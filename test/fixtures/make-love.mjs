// Synthetic LÖVE 11.4 game (our own Lua, MIT; spike g Q8): a colour cycle with a moving bar (the picture changes every
// frame), a key counter, and a run counter kept in love.filesystem (runs.txt in the save folder).
//   plain:     <dir>/game.love
//   fused:     <dir>/game.exe = a minimal 4096-byte PE (so the survey sees the zip overlay) + the zip (copy /b), love.dll
//   fused-abs: the same, with the zip's offsets made absolute (Info-ZIP `zip -A`)
//   old:       game.love with t.version = "0.10.2"
//   ffi:       game.love whose main.lua calls require("ffi")
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeZip } from './make-web-game.mjs';
import { makePE } from './make-pe.mjs';

const MAIN = `-- port-any-game test fixture (MIT)
local frame, keys, runs = 0, 0, 0
function love.load()
  if love.filesystem.getInfo("runs.txt") then runs = tonumber((love.filesystem.read("runs.txt"))) or 0 end
  runs = runs + 1
  love.filesystem.write("runs.txt", tostring(runs))
  print("RUNS " .. runs)
end
function love.update() frame = frame + 1 end
function love.keypressed(k) keys = keys + 1; print("KEY " .. k .. " " .. keys) end
function love.draw()
  local v = (frame % 60) / 60
  love.graphics.clear(v, 1 - v, 0.5, 1)
  love.graphics.setColor(1, 1, 1, 1)
  love.graphics.rectangle("fill", (frame * 4) % 640, 120, 160, 240)
  love.graphics.print("frame " .. frame .. " keys " .. keys .. " runs " .. runs, 10, 10)
end
`;

const conf = (version) => `-- port-any-game test fixture (MIT)
function love.conf(t)
  t.identity = "pagfixture"
  t.version = "${version}"
  t.window.title = "pag love fixture"
  t.window.width = 640
  t.window.height = 480
end
`;

export const STUB_BYTES = 4096;
// 0x400 headers + 0x200 .idata + 2560 bytes of .text.
const stub = () => makePE({ machine: 'amd64', sections: [{ name: '.text', size: STUB_BYTES - 0x600 }] });

// Info-ZIP `zip -A`: the central directory and local-header offsets count from the file start, not the zip start.
function absolute(b, shift) {
  const eocd = b.length - 22;
  const cd = b.readUInt32LE(eocd + 16) + shift;
  b.writeUInt32LE(cd, eocd + 16);
  for (let p = cd, n = b.readUInt16LE(eocd + 10); n--; p += 46 + b.readUInt16LE(p + 28) + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32)) {
    b.writeUInt32LE(b.readUInt32LE(p + 42) + shift, p + 42);
  }
  return b;
}

export function makeLove(dir, { variant = 'plain' } = {}) {
  const zip = makeZip({
    'main.lua': variant === 'ffi' ? `local ffi = require("ffi")\n${MAIN}` : MAIN,
    'conf.lua': conf(variant === 'old' ? '0.10.2' : '11.4'),
  });
  mkdirSync(dir, { recursive: true });
  if (['plain', 'old', 'ffi'].includes(variant)) writeFileSync(path.join(dir, 'game.love'), zip);
  else if (variant === 'fused' || variant === 'fused-abs') {
    const exe = Buffer.concat([stub(), zip]);
    writeFileSync(path.join(dir, 'game.exe'), variant === 'fused' ? exe : absolute(exe, STUB_BYTES));
    writeFileSync(path.join(dir, 'love.dll'), '');
  } else throw new Error(`unknown variant ${variant}`);
  return dir;
}
