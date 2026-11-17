// `pag package`: hand a finished port to a player with no tools. Writes <port>/package/<id>-portable/ (dist/ + launchers)
// and <port>/package/<id>.zip. Each launcher serves dist/ on 127.0.0.1 and opens the browser.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

export async function packagePortable(portDir) {
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
    'launch.json': JSON.stringify({ port: stablePort(port.id), needs_coi: shell.needs_coi === true }, null, 2) + '\n',
    'headers.json': JSON.stringify(parseHeadersFile(headersText, (m) => warnings.push(m)), null, 2) + '\n',
    'README.txt': readme(port.name ?? port.id, mode).replace(/\n/g, '\r\n'),
  };

  const pkg = path.join(dir, 'package');
  const root = path.join(pkg, `${port.id}-portable`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const entries = [];
  const put = (rel, data, mode0) => {
    const abs = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    entries.push({ name: `${port.id}-portable/${rel}`, data, ...(mode0 ? { mode: mode0 } : {}) });
  };
  for (const f of FILES) {
    let data = readFileSync(path.join(LAUNCHERS, f));
    if (f.endsWith('.bat')) data = Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n')); // cmd.exe needs CRLF
    else if (EXEC.has(f)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
    put(f, data, EXEC.has(f) ? 0o755 : 0o644);
  }
  for (const [f, text] of Object.entries(extra)) put(f, Buffer.from(text));
  for (const rel of walkFiles(dist)) put(`dist/${rel}`, readFileSync(path.join(dist, ...rel.split('/'))));

  const zipPath = path.join(pkg, `${port.id}.zip`);
  writeFileSync(zipPath, createZip(entries));
  return { dir: root, zipPath, mode, warnings };
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
    io.out(`Packaged ${r.dir}\nZip: ${r.zipPath}\n`);
    if (r.mode !== 'bundled-public' && r.mode !== 'byo') io.out(`${PRIVATE_WARNING}\n`);
    return 0;
  } catch (e) { io.err(`pag package: ${e.message}\n`); return 1; }
}
