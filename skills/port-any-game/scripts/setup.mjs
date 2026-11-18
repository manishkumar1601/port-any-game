// pag setup <core|ruffle|jsdos|playwright> [--yes]: install pinned lane runtimes into <cacheDir>/tools.
// Never downloads without --yes. Download resumes <file>.part (HTTP Range), verifies SHA-256 BEFORE extracting,
// extracts into a temp dir, renames into place, writes .ok last.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { cacheDir } from './lib/fsx.mjs';
import { extractTarGz, extractZip } from './lib/archive.mjs';

const ALIASES = { ruffle: 'ruffle-selfhosted', jsdos: 'js-dos' };
const here = path.dirname(fileURLToPath(import.meta.url));

export function loadLock(file = path.join(here, 'toolchain.lock.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export const toolDir = (e) => path.join(cacheDir(), 'tools', `${e.name}-${e.version}`);
export const resolveName = (n) => ALIASES[n] ?? n;

const sha256File = (f) => new Promise((res, rej) => {
  const h = createHash('sha256');
  createReadStream(f).on('data', (c) => h.update(c)).on('error', rej).on('end', () => res(h.digest('hex')));
});

async function download(e, part) {
  mkdirSync(path.dirname(part), { recursive: true });
  let have = existsSync(part) ? statSync(part).size : 0;
  if (have > e.size) { rmSync(part); have = 0; }
  if (have === e.size) return;
  const res = await fetch(e.url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} for ${e.url}`);
  const resumed = res.status === 206; // 200 = server ignored Range: rewrite from scratch
  await pipeline(Readable.fromWeb(res.body), createWriteStream(part, { flags: resumed ? 'a' : 'w' }));
}

// Default runner: node + npm-cli.js beside the running node when present (no shell needed on Windows).
function defaultRun(cmd, args, env) {
  let file = cmd;
  let a = args;
  if (cmd === 'node') file = process.execPath;
  else {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(cli)) { file = process.execPath; a = [cli, ...args]; }
  }
  const r = spawnSync(file, a, { stdio: 'inherit', env });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed (exit ${r.status})`);
}

async function installPlaywright(e, dir, run) {
  mkdirSync(dir, { recursive: true });
  // The driver reads the same place: an explicit PLAYWRIGHT_BROWSERS_PATH, else <cacheDir>/ms-playwright.
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(cacheDir(), 'ms-playwright') };
  run('npm', ['i', '--prefix', dir, `playwright@${e.version}`, '--no-audit', '--no-fund'], env);
  run('node', [path.join(dir, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'], env);
}

// Returns <cacheDir>/tools/<name>-<version>/. No-op when .ok exists.
export async function ensureTool(name, { lock = loadLock(), run = defaultRun } = {}) {
  const e = lock[resolveName(name)];
  if (!e) throw new Error(`unknown tool '${name}' (known: ${Object.keys(lock).join(', ')})`);
  const dir = toolDir(e);
  if (existsSync(path.join(dir, '.ok'))) return dir;

  if (e.special === 'npm') {
    rmSync(dir, { recursive: true, force: true });
    await installPlaywright(e, dir, run);
    writeFileSync(path.join(dir, '.ok'), '');
    return dir;
  }

  const part = path.join(cacheDir(), 'downloads', `${e.name}-${e.version}.${e.archive}.part`);
  await download(e, part);
  const got = await sha256File(part);
  if (got !== e.sha256) {
    rmSync(part, { force: true }); // bad bytes must not be resumed
    throw new Error(`sha256 mismatch for ${e.name}: expected ${e.sha256}, got ${got}`);
  }
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    if (e.archive === 'zip') await extractZip(part, tmp);
    else await extractTarGz(part, tmp, { strip: e.strip ?? 0 });
    rmSync(dir, { recursive: true, force: true }); // stale half-installed dir without .ok
    renameSync(tmp, dir);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  writeFileSync(path.join(dir, '.ok'), '');
  rmSync(part, { force: true });
  return dir;
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

export async function run(argv, opts = {}) {
  const yes = argv.includes('--yes');
  const [target] = argv.filter((a) => !a.startsWith('--'));
  const out = (s) => process.stdout.write(`${s}\n`);
  if (target === 'core') { cacheDir(); out('core: nothing to download; cache dir ok'); return 0; }
  const lock = opts.lock ?? loadLock();
  const e = lock[resolveName(target ?? '')];
  if (!e) { process.stderr.write('usage: pag setup <core|ruffle|jsdos|playwright> [--yes]\n'); return 2; }
  const where = toolDir(e);
  if (existsSync(path.join(where, '.ok'))) { out(`${e.name} ${e.version}: already installed at ${where}`); return 0; }
  const what = e.special ? 'npm package plus Chromium browser (several hundred MB)' : `${e.url} (${mb(e.size)})`;
  if (!yes) { out(`${e.name} ${e.version} would download ${what} into ${where}. Re-run with --yes to proceed.`); return 0; }
  out(`installing ${e.name} ${e.version} ...`);
  try { out(`ok: ${await ensureTool(e.name, { lock, run: opts.runner })}`); return 0; }
  catch (err) { process.stderr.write(`pag setup: ${err.message}\n`); return 1; }
}
