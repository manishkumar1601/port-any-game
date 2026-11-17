// `pag package`: hand a finished port to a player with no tools. Writes <port>/package/<id>-portable/ (dist/ + launchers)
// and <port>/package/<id>.zip. Each launcher serves dist/ on 127.0.0.1 and opens the browser.
import { copyFileSync, mkdirSync, readdirSync, renameSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readPort } from './pack.mjs';
import { parseHeadersFile, stablePort } from './serve.mjs';
import { LANES } from './lanes/index.mjs';
import { createZip } from '../assets/shell/zip.js';

const LAUNCHERS = fileURLToPath(new URL('../assets/launchers/', import.meta.url));
const USAGE = 'usage: pag package [portDir]\n';
const EXEC = new Set(['Play-macOS.command', 'Play-Linux.sh']);
const FILES = ['Play-Windows.bat', 'Play-macOS.command', 'Play-Linux.sh', 'serve-windows.ps1', 'serve-standalone.mjs'];
export const PRIVATE_WARNING = 'Private copy: contains your game files. Do not share publicly.';

const isDir = (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
function* walkFiles(dir, rel = '') {
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) yield* walkFiles(dir, r); else yield r;
  }
}
const readme = (name, mode) => `${name}: play in your browser
==========================================

Double-click the launcher for your system:
  Windows: Play-Windows.bat
  macOS:   Play-macOS.command   (first time: right-click, Open)
  Linux:   Play-Linux.sh        (run it from a terminal if your file manager asks)

It starts a small server that only your own computer can reach, then opens your browser.
Close the launcher window to stop. Nothing is sent over the internet.
macOS and Linux need Node.js (https://nodejs.org); Windows needs nothing extra.

${mode === 'byo' ? 'This package contains no game files: on first start the page asks you to import your own copy of the game.' : mode === 'bundled-public' ? 'This package includes game files that the rights holder allows to be shared.' : PRIVATE_WARNING}
`;

// opts.limits (tests) overrides the 32-bit zip limits; opts.afterCopy(root) runs before the zip (tests inject failures).
const ZIP_LIMITS = { file: 0xffffffff, total: 0xffffffff, entries: 65535 };
export const TOO_BIG = 'package too large for a .zip; share the folder instead';

export async function packagePortable(portDir, { limits = ZIP_LIMITS, afterCopy } = {}) {
  const dir = path.resolve(portDir);
  const port = readPort(dir);
  if (LANES[port.lane]?.external) throw new Error(`${port.lane} routes to an existing web port; there is nothing to package. Run \`pag build\` and follow its message.`);
  const dist = path.join(dir, 'dist');
  if (!isDir(dist)) throw new Error('no dist/: run `pag pack` first');
  let shell = {};
  try { shell = JSON.parse(readFileSync(path.join(dist, 'shell.json'), 'utf8').replace(/^﻿/, '')); } catch { throw new Error('dist/shell.json is missing or unreadable: run `pag pack` again'); }
  const mode = shell.data?.mode ?? port.data?.mode ?? 'byo';

  const warnings = [];
  let headersText = '';
  try { headersText = readFileSync(path.join(dist, '_headers'), 'utf8'); } catch { /* none */ }
  const extra = {
    'launch.json': JSON.stringify({ port: stablePort(port.id), needs_coi: shell.needs_coi === true, case_fallback: shell.serve?.caseFallback === true }, null, 2) + '\n',
    'headers.json': JSON.stringify(parseHeadersFile(headersText, (m) => warnings.push(m)), null, 2) + '\n',
    'README.txt': readme(port.name ?? port.id, mode).replace(/\n/g, '\r\n'),
  };

  const pkg = path.join(dir, 'package');
  const final = path.join(pkg, `${port.id}-portable`);
  const zipPath = path.join(pkg, `${port.id}.zip`);
  const tmpRoot = path.join(pkg, `.tmp-${process.pid}-portable`);
  const tmpZip = path.join(pkg, `.tmp-${process.pid}.zip`);
  mkdirSync(pkg, { recursive: true });
  rmSync(zipPath, { force: true }); // a stale zip must never outlive a failed or oversized run
  rmSync(tmpRoot, { recursive: true, force: true });
  const list = []; // {rel, mode, size}: bytes go to disk now (dist files by copy) and are read again only for the zip
  const put = (rel, data, mode0) => {
    const abs = path.join(tmpRoot, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    if (data) writeFileSync(abs, data); else copyFileSync(path.join(dist, ...rel.slice('dist/'.length).split('/')), abs);
    list.push({ rel, mode: mode0, size: statSync(abs).size });
  };
  try {
    mkdirSync(tmpRoot, { recursive: true });
    for (const f of FILES) {
      let data = readFileSync(path.join(LAUNCHERS, f));
      if (f.endsWith('.bat')) data = Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n')); // cmd.exe needs CRLF
      else if (EXEC.has(f)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
      put(f, data, EXEC.has(f) ? 0o755 : 0o644);
    }
    for (const [f, text] of Object.entries(extra)) put(f, Buffer.from(text));
    for (const rel of walkFiles(dist)) put(`dist/${rel}`);
    afterCopy?.(tmpRoot);

    // zip.js is store-method 32-bit (no zip64): guard before building.
    const total = list.reduce((n, e) => n + e.size + 2 * (port.id.length + 30 + e.rel.length) + 76, 22);
    const tooBig = list.length > limits.entries || total > limits.total || list.some((e) => e.size >= limits.file);
    let zipped = false;
    if (!tooBig) {
      // ponytail: createZip needs every file in memory at once (about the package size); stream if GB-sized packages matter.
      const bytes = createZip(list.map((e) => ({ name: `${port.id}-portable/${e.rel}`, data: readFileSync(path.join(tmpRoot, ...e.rel.split('/'))), ...(e.mode ? { mode: e.mode } : {}) })));
      writeFileSync(tmpZip, bytes);
      zipped = true;
    }
    rmSync(final, { recursive: true, force: true });
    renameSync(tmpRoot, final);
    if (zipped) renameSync(tmpZip, zipPath);
    return { dir: final, zipPath: zipped ? zipPath : null, mode, warnings: tooBig ? [...warnings, TOO_BIG] : warnings };
  } catch (e) {
    rmSync(tmpRoot, { recursive: true, force: true });
    rmSync(tmpZip, { force: true });
    throw e;
  }
}

export async function run(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: {} });
    if (args.positionals.length > 1) throw new Error('too many arguments');
  } catch (e) { io.err(`pag package: ${e.message}\n${USAGE}`); return 2; }
  try {
    const r = await packagePortable(args.positionals[0] ?? '.');
    for (const w of r.warnings) io.err(`pag package: warning: ${w}\n`);
    io.out(`Packaged ${r.dir}\n${r.zipPath ? `Zip: ${r.zipPath}` : 'No zip written.'}\n`);
    if (r.mode !== 'bundled-public' && r.mode !== 'byo') io.out(`${PRIVATE_WARNING}\n`);
    return 0;
  } catch (e) { io.err(`pag package: ${e.message}\n`); return 1; }
}
