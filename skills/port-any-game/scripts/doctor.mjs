// pag doctor [--json]: what the machine has. findBrowsers() is reused by verify.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statfsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheDir } from './lib/fsx.mjs';

const kindOf = (p) => (/edge/i.test(p) ? 'edge' : /chromium/i.test(p) ? 'chromium' : 'chrome');

function candidates() {
  const e = process.env;
  if (process.platform === 'win32') {
    const pf = [e.ProgramFiles, e['ProgramFiles(x86)']].filter(Boolean);
    return [
      ...pf.map((d) => path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...pf.map((d) => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...(e.LOCALAPPDATA ? [path.join(e.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
    ];
  }
  if (process.platform === 'darwin') {
    return ['Google Chrome', 'Microsoft Edge', 'Chromium'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  }
  const dirs = (e.PATH ?? '').split(path.delimiter).filter(Boolean);
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    .flatMap((n) => dirs.map((d) => path.join(d, n)));
}

// Ordered: PAG_BROWSER, CHROME_PATH, then per-OS install locations. Existing files only, de-duplicated.
export function findBrowsers() {
  const list = [process.env.PAG_BROWSER, process.env.CHROME_PATH, ...candidates()].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (seen.has(p) || !existsSync(p)) continue;
    seen.add(p);
    out.push({ kind: kindOf(path.basename(p)), path: p });
  }
  return out;
}

// ponytail: env-marker heuristic only; add real probes if hosted agents change their markers.
export function detectSandbox(env = process.env) {
  if (env.CLAUDE_CODE_REMOTE || env.CLAUDE_CODE_WEB || env.CLAUDE_CODE_ENTRYPOINT === 'remote') return 'claude-web';
  if (env.CODEX_SANDBOX || env.CODEX_CLOUD || env.CODEX_SANDBOX_NETWORK_DISABLED) return 'codex-cloud';
  return null;
}

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

// Pure; shared with status.mjs. `recommend: false` drops the soft "22+ recommended" nudge.
// M17: the floor is 20.12 (package.json engines): readdirSync({recursive, withFileTypes}) in the lanes needs it.
export const nodeOk = (version) => { const [a, b] = String(version).split('.').map(Number); return a > 20 || (a === 20 && b >= 12); };
export function nodeWarning(version, { recommend = true } = {}) {
  const major = Number(String(version).split('.')[0]);
  if (!nodeOk(version)) return `Node ${version} is too old; need >= 20.12`;
  if (recommend && major < 22) return `Node ${version} works; 22+ is recommended`;
  return null;
}

export async function doctor() {
  const cache = cacheDir();
  const v = process.versions.node;
  const major = Number(v.split('.')[0]);
  const warnings = [];
  let diskFreeBytes = 0;
  try { const s = statfsSync(cache); diskFreeBytes = Number(s.bavail) * Number(s.bsize); }
  catch (e) { warnings.push(`disk free unknown: ${e.message}`); }
  const git = hasGit();
  const browsers = findBrowsers();
  let playwrightCached = false;
  try {
    const tools = path.join(cache, 'tools');
    playwrightCached = readdirSync(tools).some((n) => n.startsWith('playwright-') && existsSync(path.join(tools, n, '.ok')));
  } catch { /* no tools yet */ }
  const nw = nodeWarning(v);
  if (nw) warnings.push(nw);
  if (!git) warnings.push('git not found');
  if (!browsers.length && !playwrightCached) warnings.push('no Chrome/Edge found; verification needs one (or run: pag setup playwright)');
  if (diskFreeBytes && diskFreeBytes < 2 * 1024 ** 3) warnings.push('less than 2 GiB free in the cache dir');
  return {
    os: process.platform, arch: os.arch(),
    node: { version: v, ok: nodeOk(v), recommended: major >= 22 },
    git, diskFreeBytes, browsers, playwrightCached, sandbox: detectSandbox(), cacheDir: cache, warnings,
  };
}

export async function run(argv) {
  const r = await doctor();
  if (argv.includes('--json')) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return 0; }
  const L = [
    `os: ${r.os} ${r.arch}`,
    `node: ${r.node.version} (${r.node.ok ? 'ok' : 'TOO OLD'}${r.node.recommended ? '' : ', 22+ recommended'})`,
    `git: ${r.git ? 'yes' : 'no'}`,
    `disk free: ${(r.diskFreeBytes / 1024 ** 3).toFixed(1)} GiB`,
    `browsers: ${r.browsers.map((b) => `${b.kind} ${b.path}`).join('; ') || 'none'}`,
    `playwright cached: ${r.playwrightCached}`,
    `sandbox: ${r.sandbox ?? 'none'}`,
    `cache: ${r.cacheDir}`,
    ...r.warnings.map((w) => `warning: ${w}`),
  ];
  process.stdout.write(`${L.join('\n')}\n`);
  return 0;
}
