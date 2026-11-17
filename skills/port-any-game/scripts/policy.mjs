// Single authoritative guardrail (spec §11). Every pag command and every agent hook calls it.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export class PolicyError extends Error {
  constructor(code, message) { super(`port-any-game: ${message}`); this.name = 'PolicyError'; this.code = code; }
}

const PROTECTED = ['game', 'work', 'build', 'analysis', 'dist', 'extracted', 'recomp'];
const TOOL_RE = /(?<![a-z0-9])(steamless|noceg|goldberg|steam_?emu|smartsteamemu|unlicense|crack)(?![a-z0-9])/i;
const EMU_FILE_RE = /^(steam_api(64)?\.dll|steam_emu\.ini|smartsteamemu.*|.*\.cdx)$/i;
const MSG_RE = /(?:-[a-zA-Z]*m|--message)(?:=|\s*)("(?:[^"\\]|\\.)*"|'[^']*')/g;
const HOST_RE = /(?:[a-z][a-z0-9+.-]*:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
const SHELLS = new Set(['cmd', 'bash', 'sh', 'zsh', 'dash', 'powershell', 'pwsh']);
const RUNNERS = new Set(['sudo', 'env', 'command', 'time', 'nohup', 'npx', 'bunx', 'exec', 'call']);
const ANY_ARG_WRITERS = new Set(['rm', 'del', 'erase', 'rmdir', 'rd', 'touch', 'mkdir', 'md', 'tee', 'truncate', 'ren', 'rename',
  'mv', 'move', 'remove-item', 'set-content', 'add-content', 'out-file', 'new-item', 'move-item', 'rename-item', 'clear-content']);
const DEST_WRITERS = new Set(['cp', 'copy', 'xcopy', 'robocopy', 'install', 'rsync']);

let domains;
const piracyDomains = () => (domains ??= JSON.parse(readFileSync(new URL('./policy-domains.json', import.meta.url), 'utf8')).piracy);

const posix = (p) => p.replaceAll('\\', '/');
const within = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

// Nearest port.json at or above `start` (a file or directory, need not exist).
function findPort(start) {
  let dir = path.resolve(start);
  for (;;) {
    const f = path.join(dir, 'port.json');
    if (existsSync(f)) {
      let port = { data: { mode: 'byo' } }; // unreadable port.json: assume the strictest non-public mode
      try {
        const j = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
        port = !j.schema || String(j.schema).startsWith('port-any-game/port@') ? j : null; // someone else's port.json
      } catch { /* keep strict */ }
      if (port) return { root: dir, port, public: port.data?.mode === 'bundled-public' };
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// Split a command line into segments of tokens (quotes honoured, backslashes literal for Windows paths).
function segments(cmd) {
  const segs = []; let toks = [], cur = '', has = false, q = null;
  const flush = () => { if (has) toks.push(cur); cur = ''; has = false; };
  const end = () => { flush(); if (toks.length) segs.push(toks); toks = []; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (q === '"' && c === '\\' && cmd[i + 1] === '"') { cur += '"'; i++; } else cur += c;
    } else if (c === '"' || c === "'") { q = c; has = true; }
    else if (c !== '\n' && /\s/.test(c)) flush();
    else if (';|&\n()`'.includes(c)) end();
    else { cur += c; has = true; }
  }
  end();
  return segs;
}

function deploys(name, a) {
  switch (name) {
    case 'wrangler': return a.includes('deploy') || a.includes('publish');
    case 'netlify': case 'firebase': return a.includes('deploy');
    case 'gh-pages': case 'vercel': case 'surge': return true;
    case 'butler': return a[0] === 'push';
    case 'npm': case 'pnpm': case 'yarn': case 'bun': return a.includes('publish');
    case 'gh': return a.includes('release') && (a.includes('upload') || a.includes('create'));
    case 'aws': return a.includes('s3') && a.some((x) => x.includes('public-read'));
    default: return false;
  }
}

// ponytail: git is asked only for tracked/staged protected files; rebase/cherry-pick/--amend are not modelled.
const gitHas = (root, args) => {
  const r = spawnSync('git', [...args, '--', ...PROTECTED], { cwd: root, encoding: 'utf8', timeout: 5000 });
  return r.status === 0 && r.stdout.trim() !== '';
};

const globRe = (s) => new RegExp(`^${s.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

function gitCheck(toks, dir) {
  let d = dir, i = 0;
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-C') d = path.resolve(d, posix(toks[++i] ?? '.'));
    else if (t === '-c' || t === '--git-dir' || t === '--work-tree' || t === '--namespace') i++;
    else if (!t.startsWith('-')) break;
  }
  const sub = (toks[i] ?? '').toLowerCase();
  if (!['add', 'stage', 'commit', 'push'].includes(sub)) return;
  const ctx = findPort(d);
  if (!ctx || ctx.public) return;
  const deny = (what) => {
    throw new PolicyError('PUBLIC_BUNDLED', `${what} would include game data (${PROTECTED.join('/, ')}/), which stays private. Add only lane/ or source files by name, or use a bundled-public port if you hold the rights.`);
  };
  const exists = () => PROTECTED.some((p) => existsSync(path.join(ctx.root, p)));
  if (sub === 'push') { if (gitHas(ctx.root, ['ls-files'])) deny('git push'); return; }

  let all = false, dd = false;
  const specs = [];
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (dd) { specs.push(t); continue; }
    if (t === '--') { dd = true; continue; }
    if (t === '-A' || t === '--all') all = true;
    else if (sub === 'commit' && /^-[a-zA-Z]*a[a-zA-Z]*$/.test(t)) all ||= 'tracked';
    if (/^(-[a-zA-Z]*[mFCct]|--(message|file|author|date|reuse-message|template|pathspec-from-file))$/.test(t)) { j++; continue; }
    if (!t.startsWith('-')) specs.push(t);
  }
  if (all === true && exists()) deny(`git ${sub} --all`);
  for (const s of specs) {
    if (s.startsWith(':') && !/^:(\/|\(top\))/.test(s)) continue;
    const abs = path.resolve(d, s.startsWith(':') ? '.' : s);
    const rel = posix(path.relative(ctx.root, abs));
    const outside = rel.startsWith('..') || path.isAbsolute(rel);
    if (s.startsWith(':') || rel === '' || (outside && within(abs, ctx.root))) { if (exists()) deny(`git ${sub} ${s}`); continue; }
    if (outside) continue;
    const seg = rel.split('/')[0];
    if (PROTECTED.includes(seg.toLowerCase()) || (/[*?[]/.test(seg) && PROTECTED.some((p) => globRe(seg).test(p) && existsSync(path.join(ctx.root, p))))) deny(`git ${sub} ${s}`);
  }
  if (sub === 'commit' && !specs.length) {
    if (gitHas(ctx.root, ['diff', '--cached', '--name-only']) || (all === 'tracked' && gitHas(ctx.root, ['diff', '--name-only']))) deny('git commit');
  }
}

function inGame(p, dir) {
  const abs = path.resolve(dir, posix(p));
  const ctx = findPort(abs);
  return ctx && within(path.join(ctx.root, 'game'), abs);
}
const gameDenied = (p) => { throw new PolicyError('GAME_DIR_WRITE', `${p} is inside game/, the read-only original. Work on a copy under work/ instead.`); };

function shellCheck(command, cwd, depth = 0) {
  const text = /\bgit\b[\s\S]*\bcommit\b/i.test(command) ? command.replace(MSG_RE, ' ') : command;
  if (TOOL_RE.test(text)) throw new PolicyError('CIRCUMVENTION', 'DRM removal, emulation and crack tooling is refused (spec §11); this skill never bypasses copy protection.');
  piracyCheck(text);
  let dir = cwd;
  for (const seg of segments(command)) {
    let t = seg;
    for (;;) {
      const h = (t[0] ?? '').toLowerCase();
      if (/^[A-Za-z_]\w*=/.test(t[0] ?? '') || RUNNERS.has(h)) t = t.slice(1);
      else if (t[0]?.startsWith('-') && t.length > 1) t = t.slice(1);
      else if ((h === 'pnpm' || h === 'yarn') && ['dlx', 'exec'].includes(t[1])) t = t.slice(2);
      else break;
    }
    if (!t.length) continue;
    const name = path.basename(posix(t[0])).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');
    const args = t.slice(1);
    if (['cd', 'chdir', 'set-location', 'pushd'].includes(name)) {
      const a = args.find((x) => !/^\/d$/i.test(x) && !x.startsWith('-'));
      if (a) dir = path.resolve(dir, posix(a));
      continue;
    }
    if (SHELLS.has(name)) {
      const k = args.findIndex((x) => /^(-c|-lc|-command|\/c|\/k)$/i.test(x));
      if (k >= 0 && depth < 3) shellCheck(args.slice(k + 1).join(' '), dir, depth + 1);
      continue;
    }
    if (name === 'git') { gitCheck(args, dir); continue; }
    const ctx = findPort(dir);
    if (ctx && !ctx.public && deploys(name, args.map((x) => x.toLowerCase()))) {
      throw new PolicyError('PUBLIC_BUNDLED', `${name} would publish this port's build, which contains game data. Publishing needs a bundled-public port (rights-holder or redistributable data only).`);
    }
    const pos = args.filter((x) => !(x.startsWith('-') || /^\/[a-z?]$/i.test(x)));
    if (ANY_ARG_WRITERS.has(name)) pos.forEach((x) => inGame(x, dir) && gameDenied(x));
    else if (DEST_WRITERS.has(name) && pos.length > 1) { const dest = name === 'robocopy' ? pos[1] : pos.at(-1); if (inGame(dest, dir)) gameDenied(dest); }
    else if (name === 'sed' && args.some((x) => /^(-i|--in-place)/.test(x))) pos.slice(1).forEach((x) => inGame(x, dir) && gameDenied(x));
  }
  for (const m of command.matchAll(/(?:^|[^>\d&])\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g)) {
    const target = m[1].replace(/^["']|["']$/g, '');
    if (inGame(target, cwd)) gameDenied(target);
  }
}

function piracyCheck(text) {
  if (/magnet:\?|\.torrent(?![a-z0-9])/i.test(text)) throw new PolicyError('PIRACY_SOURCE', 'peer-to-peer downloads are refused; game data comes only from your own install or media.');
  for (const m of text.matchAll(HOST_RE)) {
    const h = m[1].toLowerCase();
    if (piracyDomains().some((d) => h === d || h.endsWith(`.${d}`))) throw new PolicyError('PIRACY_SOURCE', `${h} is a piracy/abandonware source; game data comes only from your own install or media.`);
  }
}

function writeCheck(p, cwd) {
  const abs = path.resolve(cwd, posix(p));
  const ctx = findPort(abs);
  if (!ctx) return;
  if (within(path.join(ctx.root, 'game'), abs)) gameDenied(p);
  if (EMU_FILE_RE.test(path.basename(abs))) throw new PolicyError('CIRCUMVENTION', `${path.basename(abs)} is a DRM-emulator file; creating it in a port is refused.`);
}

export function checkToolUse({ tool, command, path: p, url, cwd = process.cwd() }) {
  try {
    if (tool === 'shell' && command) shellCheck(String(command), cwd);
    else if (tool === 'write' && p) writeCheck(p, cwd);
    else if (tool === 'fetch' && url) piracyCheck(String(url));
  } catch (e) {
    if (e instanceof PolicyError) return { deny: true, reason: e.message, code: e.code };
    throw e;
  }
  return { deny: false, reason: '' };
}

export function assertLaneAllowed(survey, laneId) {
  if (survey?.verdict?.overall === 'STOP' && laneId !== 'remote-play') {
    throw new PolicyError('STOP_VERDICT', `survey verdict is STOP: lane '${laneId}' is refused. Only remote-play (your own PC, original game) remains.`);
  }
}

export function assertTarget(port, target, { password } = {}) {
  if (target === 'local') return;
  if (target === 'lan') { if (!password) throw new PolicyError('LAN_NO_PASSWORD', 'serving beyond 127.0.0.1 needs --password.'); return; }
  if (target === 'public') {
    if (port?.data?.mode !== 'bundled-public') throw new PolicyError('PUBLIC_BUNDLED', 'a public target needs a bundled-public port (rights-holder or redistributable data only).');
    return;
  }
  throw new Error(`unknown target '${target}'`);
}
