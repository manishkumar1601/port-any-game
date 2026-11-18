// `pag pack [portDir] [--mode byo|bundled|bundled-public]`: assemble <port>/dist (spec §8): the shared shell,
// runtime/<lane>-<hash8>/ (adapter + pinned runtime files), shell.json, pag-manifest.json (+ the game files in game/
// unless byo), _headers, robots.txt and LICENSES/. Exit 0 ok, 1 failure, 2 usage, 4 policy refusal.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256File, walk } from './lib/fsx.mjs';
import { loadLock, resolveName, toolDir } from './setup.mjs';
import { isPublicAllowed, PolicyError, RIGHTS } from './policy.mjs';
import { LANES } from './lanes/index.mjs';
import { normalizePath } from '../assets/shell/pure.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SHELL_DIR = path.join(ASSETS, 'shell');
const GPL2_TEXT = path.join(ASSETS, 'licenses', 'GPL-2.0.txt');
const MODES = ['byo', 'bundled', 'bundled-public'];
const MANIFEST = 'pag-manifest.json'; // M3: outside game/, so a game's own manifest.json (PWA exports) is just a game file
const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i; // OS litter differs per copy; never ask the user for it
const USAGE = 'usage: pag pack [portDir] [--mode byo|bundled|bundled-public]\n';
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'";
const SHELL_LICENSE = `port-any-game web shell (index.html, shell/*)
License: MIT
Source: shipped unminified in this build (index.html, shell/)

MIT License

Copyright (c) 2026 port-any-game contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
const DEFAULTS = {
  requires: { webgl2: false, webgpu: false, threads: false, simd: false, jspi: false },
  memory: { initial_mb: 64, maximum_mb: 512 },
  input: { keyboard: true, mouse: 'absolute', gamepad: 'standard', touch: false },
  video: { aspect: '4:3', scaling: 'fit' },
  verify: { target_fps: 30, inputs: [], audio_on_title: false, budget_ready_s: 15 },
};

class UsageError extends Error {}

const isDir = (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
const exists = (p) => !!lstatSync(p, { throwIfNoEntry: false });
const inside = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const rmrf = (p) => rmSync(p, { recursive: true, force: true, maxRetries: 2 });

// One port.json reader for pack and build. Throws UsageError when the folder is not a port.
export function readPort(dir) {
  try { return JSON.parse(readFileSync(path.join(dir, 'port.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { throw new UsageError(`${dir} is not a port folder (no readable port.json: ${e.code ?? e.message})`); }
}

// R61 (note 05 §9a): a lane may add CSP keywords to a directive the base policy has (shell.json `csp`, e.g. web-extract's
// 'unsafe-eval' 'unsafe-inline' for the game's own code); verify reports it. Keywords only, never a host or scheme.
export function cspFor(extra = {}) {
  const dirs = new Map(CSP.split('; ').map((d) => { const [k, ...v] = d.split(' '); return [k, v]; }));
  for (const [k, add] of Object.entries(extra)) {
    if (!dirs.has(k)) throw new Error(`lane csp: unknown directive '${k}'`);
    for (const s of add) {
      if (!/^'[a-z-]+'$/.test(s)) throw new Error(`lane csp: '${s}' is not a CSP keyword`);
      if (!dirs.get(k).includes(s)) dirs.get(k).push(s);
    }
  }
  return [...dirs].map(([k, v]) => [k, ...v].join(' ')).join('; ');
}

// The spec §8 / note 05 §9a block. COOP + COEP only when needs_coi; never credentialless.
// X-Robots-Tag is for private builds, so a bundled-public build leaves it out (spec §8).
export function headersFor(shell) {
  return [
    '/*',
    ...(shell.needs_coi ? ['  Cross-Origin-Opener-Policy: same-origin', '  Cross-Origin-Embedder-Policy: require-corp'] : []),
    '  Cross-Origin-Resource-Policy: same-origin',
    `  Content-Security-Policy: ${cspFor(shell.csp)}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    ...(shell.data?.mode === 'bundled-public' ? [] : ['  X-Robots-Tag: noindex, nofollow']),
    ...['/index.html', '/shell.json', `/${MANIFEST}`].flatMap((p) => [p, '  Cache-Control: no-cache']),
    '/runtime/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}

function shellJson(port, lane, mode, runtimeDir, portDir) {
  const c = lane.shell?.(port, { portDir }) ?? {};
  const merged = (k) => ({ ...DEFAULTS[k], ...c[k] });
  return {
    schema: 1,
    game_id: port.id,
    lane: lane.id,
    entry: { adapter: `runtime/${runtimeDir}/adapter.js` },
    requires: merged('requires'),
    needs_coi: c.needs_coi ?? c.requires?.threads === true,
    memory: merged('memory'),
    data: { mode, manifest: MANIFEST, mount: '/game', saves: `/saves/${port.id}` },
    input: merged('input'),
    video: merged('video'),
    ...(c.serve ? { serve: c.serve } : {}),
    ...(c.lane_config ? { lane_config: c.lane_config } : {}),
    ...(c.csp ? { csp: c.csp } : {}),
    verify: merged('verify'),
  };
}

// Manifest names must reach the browser unchanged (the shell's own normalizePath) and stay unique ignoring case
// (Windows copies and the import's case fallback cannot tell such twins apart).
export function checkGameNames(paths) {
  const folded = new Map();
  for (const p of paths) {
    if (normalizePath(p) !== p) throw new Error(`game file name ${JSON.stringify(p)} cannot be used in a browser (backslash or dot segment); rename it`);
    const twin = folded.get(p.toLowerCase());
    if (twin) throw new Error(`game files ${twin} and ${p} differ only by case; browsers and Windows copies cannot tell them apart`);
    folded.set(p.toLowerCase(), p);
  }
}

// Regular files only, hashed exactly like the survey (fsx.sha256File: over 256 MiB = first + last 1 MiB, partial).
// A link must resolve inside the game folder: a link out could put any file on this machine into a bundled dist.
async function gameFiles(src, warn) {
  const root = realpathSync(src); // game/ itself is a link to the user's install
  const found = [];
  for await (const e of walk(src)) {
    if (e.truncated) throw new Error('too many game files');
    if (JUNK.test(path.basename(e.rel))) continue;
    let abs = e.abs;
    if (e.isSymlink) {
      try { abs = realpathSync(e.abs); } catch { warn(`${e.rel}: broken link, skipped`); continue; }
      if (!inside(root, abs)) throw new Error(`game file ${e.rel} links outside the game folder; refusing to pack it (put the real file there instead)`);
    } else if (e.error) throw new Error(`cannot read game file ${e.rel || '.'}: ${e.error}`);
    const st = statSync(abs);
    if (st.isDirectory()) { warn(`${e.rel}: linked folder inside the game folder, not followed`); continue; }
    if (!st.isFile()) { warn(`${e.rel}: not a regular file, skipped`); continue; }
    found.push({ path: e.rel.normalize('NFC'), size: st.size, abs });
  }
  found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  checkGameNames(found.map((f) => f.path));
  const files = [];
  for (const f of found) {
    const h = await sha256File(f.abs, f.size);
    files.push({ path: f.path, size: f.size, sha256: h.sha256, ...(h.partial ? { partial: true } : {}), abs: f.abs });
  }
  return files;
}

// Adapter + pinned tool files, named by a hash of their paths and bytes (R30): /runtime/* is served immutable.
async function runtimeFiles(lane, adapter, tool) {
  const files = new Map(); // rel -> abs
  if (tool && lane.runtime.files) for (const f of lane.runtime.files) files.set(f, path.join(tool.dir, ...f.split('/')));
  else if (tool) {
    for await (const e of walk(tool.dir)) {
      if (e.error) throw new Error(`cannot read runtime file ${e.rel}: ${e.error}`);
      if (e.rel !== '.ok' && !e.truncated) files.set(e.rel, e.abs);
    }
  }
  files.set('adapter.js', adapter);
  const h = createHash('sha256');
  for (const rel of [...files.keys()].sort()) h.update(`${rel}\0`).update(readFileSync(files.get(rel))).update('\0');
  return { files, dir: `${lane.id}-${h.digest('hex').slice(0, 8)}` };
}

function licenseText(e, dir) {
  const lines = [`${e.name} ${e.version}`, `License: ${e.license ?? 'unknown'}`, `Source: ${e.source ?? 'unknown'}`];
  if (/GPL/i.test(e.license ?? '')) lines.push(`The complete corresponding source code is available at ${e.source} (tag/version ${e.version}).`);
  const lf = e.licenseFile && path.join(dir, ...e.licenseFile.split('/'));
  if (lf && existsSync(lf)) lines.push('', readFileSync(lf, 'utf8'));
  // GPL-2.0 §1: the licence text goes with the binary (js-dos ships none of its own).
  if (/^GPL-2\.0(\+|-only|-or-later)?$/.test(e.license ?? '')) lines.push('', readFileSync(GPL2_TEXT, 'utf8').trimEnd());
  return `${lines.join('\n')}\n`;
}

const copyTo = (from, to) => { mkdirSync(path.dirname(to), { recursive: true }); copyFileSync(from, to); };

function writeDist(out, { port, lane, mode, tool, runtime, files, source, portDir }) {
  mkdirSync(path.join(out, 'shell'), { recursive: true });
  for (const f of readdirSync(SHELL_DIR)) copyFileSync(path.join(SHELL_DIR, f), f === 'index.html' ? path.join(out, f) : path.join(out, 'shell', f));
  for (const [rel, abs] of runtime.files) copyTo(abs, path.join(out, 'runtime', runtime.dir, ...rel.split('/')));
  mkdirSync(path.join(out, 'LICENSES'));
  writeFileSync(path.join(out, 'LICENSES', 'port-any-game-shell.txt'), SHELL_LICENSE);
  if (tool) writeFileSync(path.join(out, 'LICENSES', `${tool.entry.name}.txt`), licenseText(tool.entry, tool.dir));

  const entries = files.map(({ abs, ...f }) => f);
  const manifest = {
    version: sha256(entries.map((f) => `${f.path}\0${f.size}\0${f.sha256}`).join('\n')),
    source,
    total_bytes: entries.reduce((s, f) => s + f.size, 0),
    files: entries,
  };
  if (mode !== 'byo') for (const f of files) copyTo(f.abs, path.join(out, 'game', ...f.path.split('/')));
  writeFileSync(path.join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

  const shell = shellJson(port, lane, mode, runtime.dir, portDir);
  writeFileSync(path.join(out, 'shell.json'), `${JSON.stringify(shell, null, 2)}\n`);
  writeFileSync(path.join(out, '_headers'), headersFor(shell));
  writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  return shell;
}

// opts.laneModule overrides LANES[port.lane] (tests and verify use the lane-test fixture); opts.lock overrides loadLock().
export async function pack(portDir, { mode, laneModule, lock, warn = () => {} } = {}) {
  const dir = path.resolve(portDir);
  const port = readPort(dir);
  mode ??= port.data?.mode ?? 'byo';
  if (!MODES.includes(mode)) throw new UsageError(`unknown data mode '${mode}' (one of ${MODES.join(', ')})`);
  if (mode === 'bundled-public' && !isPublicAllowed(port)) throw new PolicyError('PUBLIC_BUNDLED', `a bundled-public pack puts game files in a build meant for sharing. ${RIGHTS}`);
  const lane = laneModule ?? LANES[port.lane];
  if (!lane) throw new UsageError(`unknown lane '${port.lane}' in port.json`);
  if (lane.external) throw new Error(`${lane.id} routes to an existing web port; there is nothing to pack. Run \`pag build\` and follow its message.`);
  // R29: bundled-public is lane-independent (gated only by isPublicAllowed above); byo/bundled must be in dataModes.
  if (mode !== 'bundled-public' && !lane.dataModes?.includes(mode)) throw new UsageError(`lane ${lane.id} supports data modes ${lane.dataModes?.join(', ')}; not '${mode}'`);

  const adapter = lane.adapter ?? path.join(ASSETS, 'lanes', lane.id, 'adapter.js');
  if (!existsSync(adapter)) throw new Error(`lane ${lane.id} has no browser adapter yet`);
  let tool = null;
  if (lane.runtime) {
    const lk = lock ?? loadLock();
    const name = resolveName(lane.runtime.tool);
    if (!Object.hasOwn(lk, name)) throw new Error(`runtime tool '${lane.runtime.tool}' is not in toolchain.lock.json`);
    tool = { entry: lk[name], dir: toolDir(lk[name]) };
    if (!existsSync(path.join(tool.dir, '.ok'))) throw new Error(`${name} ${tool.entry.version} is not installed; run \`pag setup ${lane.runtime.tool} --yes\` first`);
  }
  const runtime = await runtimeFiles(lane, adapter, tool);
  const source = isDir(path.join(dir, 'build', 'game')) ? 'build/game' : 'game';
  if (!isDir(path.join(dir, source))) throw new Error('no game files: the game/ folder is missing (pag new links it to your install)');
  const files = await gameFiles(path.join(dir, ...source.split('/')), warn);

  // Build beside dist (under the git-ignored work/), then swap it in, so a failure leaves the previous dist whole
  // and a byo pack never keeps game bytes from an earlier bundled one.
  mkdirSync(path.join(dir, 'work'), { recursive: true });
  const dist = path.join(dir, 'dist');
  const tmp = path.join(dir, 'work', `pack-tmp-${process.pid}`);
  const old = path.join(dir, 'work', `pack-old-${process.pid}`);
  rmrf(tmp);
  rmrf(old);
  let shell;
  try {
    shell = writeDist(tmp, { port, lane, mode, tool, runtime, files, source, portDir: dir });
    if (exists(dist)) renameSync(dist, old);
    renameSync(tmp, dist);
  } catch (e) {
    if (!exists(dist) && exists(old)) renameSync(old, dist);
    rmrf(tmp);
    throw e;
  }
  try { rmrf(old); } catch (e) { warn(`could not remove the previous dist at ${old}: ${e.message}`); }
  // R63: the rights gate passed, so the port is public from now on (pag writes port.json; the guard blocks the agent).
  if (mode === 'bundled-public' && port.data?.mode !== 'bundled-public') {
    const file = path.join(dir, 'port.json');
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ ...port, data: { ...port.data, mode } }, null, 2)}\n`);
    renameSync(tmp, file);
  }
  return { distDir: dist, shell };
}

// opts (tests): {laneModule, lock}.
export async function run(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, opts = {}) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { mode: { type: 'string' } } });
    if (args.positionals.length > 1) throw new Error('too many arguments');
  } catch (e) { io.err(`pag pack: ${e.message}\n${USAGE}`); return 2; }
  try {
    const { distDir, shell } = await pack(args.positionals[0] ?? '.', { ...opts, mode: args.values.mode, warn: (m) => io.err(`pag pack: warning: ${m}\n`) });
    io.out(`Packed ${distDir} (lane ${shell.lane}, data ${shell.data.mode}).\nNext: pag verify "${distDir}" --soak 5 (verify serves the build itself).\n`);
    return 0;
  } catch (e) {
    io.err(`pag pack: ${e.message}\n`);
    return e instanceof PolicyError ? 4 : e instanceof UsageError ? 2 : 1;
  }
}
