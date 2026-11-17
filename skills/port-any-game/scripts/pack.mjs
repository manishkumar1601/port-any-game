// `pag pack [portDir] [--mode byo|bundled|bundled-public]`: assemble <port>/dist (spec §8): the shared shell,
// runtime/<lane>/ (adapter + pinned runtime files), shell.json, game/manifest.json (+ the game files unless byo),
// _headers, robots.txt and LICENSES/. Exit 0 ok, 1 failure, 2 usage, 4 policy refusal.
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256File, walk } from './lib/fsx.mjs';
import { loadLock, resolveName, toolDir } from './setup.mjs';
import { isPublicAllowed, PolicyError } from './policy.mjs';
import { LANES } from './lanes/index.mjs';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SHELL_DIR = path.join(ASSETS, 'shell');
const MODES = ['byo', 'bundled', 'bundled-public'];
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
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// The spec §8 / note 05 §9a block. COOP + COEP only when needs_coi; never credentialless.
export function headersFor(shell) {
  return [
    '/*',
    ...(shell.needs_coi ? ['  Cross-Origin-Opener-Policy: same-origin', '  Cross-Origin-Embedder-Policy: require-corp'] : []),
    '  Cross-Origin-Resource-Policy: same-origin',
    `  Content-Security-Policy: ${CSP}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  X-Robots-Tag: noindex, nofollow',
    ...['/index.html', '/shell.json', '/game/manifest.json'].flatMap((p) => [p, '  Cache-Control: no-cache']),
    '/runtime/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}

function shellJson(port, lane, mode) {
  const c = lane.shell?.(port) ?? {};
  const merged = (k) => ({ ...DEFAULTS[k], ...c[k] });
  return {
    schema: 1,
    game_id: port.id,
    lane: lane.id,
    entry: { adapter: `runtime/${lane.id}/adapter.js` },
    requires: merged('requires'),
    needs_coi: c.needs_coi ?? c.requires?.threads === true,
    memory: merged('memory'),
    data: { mode, manifest: 'game/manifest.json', mount: '/game', saves: `/saves/${port.id}` },
    input: merged('input'),
    video: merged('video'),
    ...(c.serve ? { serve: c.serve } : {}),
    ...(c.lane_config ? { lane_config: c.lane_config } : {}),
    verify: merged('verify'),
  };
}

// Entries hash exactly like the survey (fsx.sha256File: files over 256 MiB as first + last 1 MiB, partial: true).
async function gameFiles(src) {
  const files = [];
  for await (const e of walk(src)) {
    if (e.truncated) throw new Error('too many game files');
    if (JUNK.test(path.basename(e.rel))) continue;
    let { size } = e;
    if (e.isSymlink) {
      const st = statSync(e.abs, { throwIfNoEntry: false });
      if (!st?.isFile()) continue; // ponytail: symlinked folders inside the game are not followed
      size = st.size;
    } else if (e.error) throw new Error(`cannot read game file ${e.rel || '.'}: ${e.error}`);
    const h = await sha256File(e.abs, size);
    files.push({ path: e.rel.normalize('NFC'), size, sha256: h.sha256, ...(h.partial ? { partial: true } : {}), abs: e.abs });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function licenseText(e, dir) {
  const lines = [`${e.name} ${e.version}`, `License: ${e.license ?? 'unknown'}`, `Source: ${e.source ?? 'unknown'}`];
  if (/GPL/i.test(e.license ?? '')) lines.push(`The complete corresponding source code is available at ${e.source} (tag/version ${e.version}).`);
  const lf = e.licenseFile && path.join(dir, ...e.licenseFile.split('/'));
  if (lf && existsSync(lf)) lines.push('', readFileSync(lf, 'utf8'));
  return `${lines.join('\n')}\n`;
}

function readPort(dir) {
  try { return JSON.parse(readFileSync(path.join(dir, 'port.json'), 'utf8').replace(/^﻿/, '')); }
  catch (e) { throw new UsageError(`${dir} is not a port folder (no readable port.json: ${e.code ?? e.message})`); }
}

// opts.laneModule overrides LANES[port.lane] (tests and verify use the lane-test fixture); opts.lock overrides loadLock().
export async function pack(portDir, { mode, laneModule, lock } = {}) {
  const dir = path.resolve(portDir);
  const port = readPort(dir);
  mode ??= port.data?.mode ?? 'byo';
  if (!MODES.includes(mode)) throw new UsageError(`unknown data mode '${mode}' (one of ${MODES.join(', ')})`);
  if (mode === 'bundled-public' && !isPublicAllowed(port)) {
    throw new PolicyError('PUBLIC_BUNDLED', 'a bundled-public pack needs port.json data.mode "bundled-public" plus an ACK_RIGHTS_HOLDER acknowledgement or catalog-redistributable data. Ask the user; only they record rights with `pag ack`.');
  }
  const lane = laneModule ?? LANES[port.lane];
  if (!lane) throw new UsageError(`unknown lane '${port.lane}' in port.json`);
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
  const source = isDir(path.join(dir, 'build', 'game')) ? 'build/game' : 'game';
  if (!isDir(path.join(dir, source))) throw new Error('no game files: game/ is missing (pag new links it to your install)');
  const files = await gameFiles(path.join(dir, ...source.split('/')));
  if (mode !== 'byo' && files.some((f) => f.path === 'manifest.json')) throw new Error(`the game has its own manifest.json at the top of ${source}/, which would clash with game/manifest.json`);

  // Everything that can refuse or fail is checked above; only now replace dist (a byo pack must never keep game bytes).
  const dist = path.join(dir, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(path.join(dist, 'shell'), { recursive: true });
  for (const f of readdirSync(SHELL_DIR)) copyFileSync(path.join(SHELL_DIR, f), f === 'index.html' ? path.join(dist, f) : path.join(dist, 'shell', f));

  const rt = path.join(dist, 'runtime', lane.id);
  mkdirSync(path.join(dist, 'LICENSES'), { recursive: true });
  writeFileSync(path.join(dist, 'LICENSES', 'port-any-game-shell.txt'), SHELL_LICENSE);
  if (tool) {
    if (lane.runtime.files) {
      for (const f of lane.runtime.files) {
        const to = path.join(rt, ...f.split('/'));
        mkdirSync(path.dirname(to), { recursive: true });
        copyFileSync(path.join(tool.dir, ...f.split('/')), to);
      }
    } else cpSync(tool.dir, rt, { recursive: true, filter: (s) => path.basename(s) !== '.ok' });
    writeFileSync(path.join(dist, 'LICENSES', `${tool.entry.name}.txt`), licenseText(tool.entry, tool.dir));
  }
  mkdirSync(rt, { recursive: true });
  copyFileSync(adapter, path.join(rt, 'adapter.js'));

  const entries = files.map(({ abs, ...f }) => f);
  const manifest = {
    version: sha256(entries.map((f) => `${f.path}\0${f.size}\0${f.sha256}`).join('\n')),
    source,
    total_bytes: entries.reduce((s, f) => s + f.size, 0),
    files: entries,
  };
  mkdirSync(path.join(dist, 'game'));
  if (mode !== 'byo') {
    for (const f of files) {
      const to = path.join(dist, 'game', ...f.path.split('/'));
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(f.abs, to);
    }
  }
  writeFileSync(path.join(dist, 'game', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const shell = shellJson(port, lane, mode);
  writeFileSync(path.join(dist, 'shell.json'), `${JSON.stringify(shell, null, 2)}\n`);
  writeFileSync(path.join(dist, '_headers'), headersFor(shell));
  writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
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
    const { distDir, shell } = await pack(args.positionals[0] ?? '.', { ...opts, mode: args.values.mode });
    io.out(`Packed ${distDir} (lane ${shell.lane}, data ${shell.data.mode}).\nNext: pag serve ${distDir}, then pag verify.\n`);
    return 0;
  } catch (e) {
    io.err(`pag pack: ${e.message}\n`);
    return e instanceof PolicyError ? 4 : e instanceof UsageError ? 2 : 1;
  }
}
