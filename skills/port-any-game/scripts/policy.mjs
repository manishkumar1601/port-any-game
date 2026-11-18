// Single authoritative guardrail (spec §11). Every pag command and every agent hook calls it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

export class PolicyError extends Error {
  constructor(code, message) { super(`port-any-game: ${message}`); this.name = 'PolicyError'; this.code = code; }
}

const ASK = 'Ask the user. Do not edit port.json yourself; the user records consent with `pag ack`.';
// R63: the one way to public use. The agent asks openly and never words the statement (references/legal.md).
export const RIGHTS = 'Ask the user. Do not edit port.json yourself. Public use needs the rights to the game data: only if the user says, in their own words, that they hold them, record exactly that with `pag ack ACK_RIGHTS_HOLDER --note "<their words>"` (free-to-share data from the catalog is marked by `pag new`).';
const PROTECTED = ['game', 'work', 'build', 'analysis', 'dist', 'extracted', 'recomp'];
// Distinctive names are refused anywhere in a command; generic words only as command names or executable-like tokens.
const DISTINCT_RE = /(?<![a-z0-9])(steamless|noceg|steam_?emu|smartsteamemu)(?![a-z0-9])/i;
const NAME_RE = /^(crack|goldberg|unlicense|nocd|no-cd)(?![a-z0-9])/i;
const EXE_LIKE_RE = /\.(exe|dll|py|bat|cmd|ps1|sh|com|jar)$/i;
const EMU_FILE_RE = /^(steam_api(64)?\.dll|steam_emu\.ini|smartsteamemu.*|.*\.cdx)$/i;
const HOST_RE = /(?:[a-z][a-z0-9+.-]*:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
const HOME_RE = /^(~|\$\{?HOME\}?|%USERPROFILE%|\$env:USERPROFILE|\$env:HOME)(?=$|[\\/])/i;
const SHELLS = new Set(['cmd', 'bash', 'sh', 'zsh', 'dash', 'powershell', 'pwsh']);
const RUNNERS = new Set(['sudo', 'env', 'command', 'time', 'nohup', 'npx', 'bunx', 'exec', 'call']);
const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const DEPLOYERS = new Set(['wrangler', 'vercel', 'netlify', 'surge', 'gh-pages', 'butler', 'firebase']);
const VERCEL_OTHER = new Set(['dev', 'env', 'login', 'logout', 'link', 'pull', 'whoami', 'ls', 'list', 'inspect', 'logs', 'domains', 'dns', 'certs',
  'help', 'switch', 'teams', 'bisect', 'build', 'rm', 'remove', 'alias', 'git', 'project', 'integration', 'telemetry', 'init', 'cache']);
const ANY_ARG_WRITERS = new Set(['rm', 'del', 'erase', 'rmdir', 'rd', 'touch', 'mkdir', 'md', 'tee', 'truncate', 'ren', 'rename',
  'mv', 'move', 'remove-item', 'set-content', 'add-content', 'out-file', 'new-item', 'move-item', 'rename-item', 'clear-content']);
// I2: deleters and their recursive flags: POSIX bundles (-r, -rf, -R), --recursive, PowerShell -Recurse in any accepted
// prefix or case (-r, -rec, -Recurse:$true; rm/rmdir/rd/del/erase/ri are its aliases there), cmd's /s (also /s/q).
const DELETERS = new Set(['rm', 'rmdir', 'rd', 'del', 'erase', 'remove-item', 'ri']);
const RECURSIVE_RE = /^(--recursive|-[rfivd]*r[rfivd]*|-r(e(c(u(r(se?)?)?)?)?)?(:\$true)?|(\/[a-z])*\/s(\/[a-z])*)$/i;
const DEST_WRITERS = new Set(['cp', 'copy', 'xcopy', 'robocopy', 'install', 'rsync', 'copy-item', 'cpi', 'expand-archive']);
// Options whose value is a destination path. ci = case-insensitive (PowerShell).
const DEST_OPTS = {
  tar: { o: ['-C', '--directory'] }, unzip: { o: ['-d'] }, curl: { o: ['-o', '--output', '--output-dir'] },
  wget: { o: ['-O', '-P', '--output-document', '--directory-prefix'] },
  'expand-archive': { ci: 1, o: ['-destinationpath', '-dest'] }, 'copy-item': { ci: 1, o: ['-destination'] }, cpi: { ci: 1, o: ['-destination'] },
  'invoke-webrequest': { ci: 1, o: ['-outfile'] }, iwr: { ci: 1, o: ['-outfile'] },
};

let domains;
const piracyDomains = () => (domains ??= JSON.parse(readFileSync(new URL('./policy-domains.json', import.meta.url), 'utf8')).piracy);

const CI = process.platform === 'win32' || process.platform === 'darwin';
const posix = (p) => p.replaceAll('\\', '/');
const rp = (dir, p) => path.resolve(dir, posix(String(p).replace(HOME_RE, homedir()))); // ~ / $HOME / %USERPROFILE% aware
const rel = (root, p) => (CI ? path.relative(root.toLowerCase(), p.toLowerCase()) : path.relative(root, p));
const within = (root, p) => { const r = rel(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

// R63: public use is gated on rights only: the user (never the agent) recorded them via `pag ack` (pag adds `at`),
// or `pag new` found catalog-redistributable data. data.mode follows (pack persists it); it unlocks nothing itself.
// check-staged.mjs inlines the same rule (it runs without the skill).
export function isPublicAllowed(port) {
  return port?.data?.redistributable === true || (port?.acks ?? []).some((a) => a?.id === 'ACK_RIGHTS_HOLDER' && a.at);
}

// Our port.json in dir, or null (none, or someone else's).
function portAt(dir) {
  const f = path.join(dir, 'port.json');
  if (!existsSync(f)) return null;
  try {
    const j = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
    return !j.schema || String(j.schema).startsWith('port-any-game/port@') ? j : null; // someone else's port.json
  } catch { return { data: { mode: 'byo' } }; } // unreadable port.json: assume the strictest non-public mode
}

// Nearest port.json at or above `start` (a file or directory, need not exist).
function findPort(start) {
  let dir = path.resolve(start);
  for (;;) {
    const port = portAt(dir);
    if (port) return { root: dir, port, public: isPublicAllowed(port) };
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

const baseName = (t) => path.basename(posix(t)).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '');

// Strip env assignments, runners and package-manager exec wrappers so t[0] is the real command.
function unwrap(t) {
  t = t.filter((x) => x !== '}');
  for (let n = 0; n < 8 && t.length; n++) {
    const h = t[0].toLowerCase();
    const name = baseName(t[0]);
    if (/^[A-Za-z_]\w*=/.test(t[0]) || RUNNERS.has(h) || h === '{') t = t.slice(1);
    else if (h.startsWith('-') && t.length > 1) t = t.slice(1);
    else if (PKG.has(name) && ['exec', 'x', 'dlx'].includes(t[1])) t = t.slice(2).filter((x, i, a) => !(x.startsWith('-') && a.slice(0, i).every((y) => y.startsWith('-'))));
    else if (PKG.has(name) && DEPLOYERS.has(baseName(t[1] ?? ''))) t = t.slice(1);
    else break;
  }
  return t;
}

// Message/body option values are prose, never commands: git commit -m, gh pr/issue --body.
function dropProse(name, args) {
  const re = name === 'git' && args.includes('commit') ? /^(-[a-zA-Z]*[mF]|--(message|file))$/
    : name === 'gh' && args.some((a) => ['pr', 'issue', 'release'].includes(a)) ? /^(-[a-zA-Z]*[btnF]|--(body|title|notes|body-file|notes-file))$/ : null;
  if (!re) return args;
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (re.test(args[i])) i++;
    else if (!/^--(message|body|title|notes|file|body-file|notes-file)=/.test(args[i])) out.push(args[i]);
  }
  return out;
}

function deploys(name, a) {
  const script = () => { const i = a.findIndex((x) => x === 'run' || x === 'run-script'); const s = i >= 0 ? a[i + 1] : name === 'yarn' ? a[0] : undefined; return /^(deploy|publish|release)(:|$)/.test(s ?? ''); };
  switch (name) {
    case 'wrangler': return a.includes('deploy') || a.includes('publish');
    case 'netlify': case 'firebase': return a.includes('deploy');
    case 'gh-pages': case 'surge': return true;
    case 'vercel': { if (a.some((x) => /^(--help|-h|--version|-v)$/.test(x))) return false; const sub = a.find((x) => !x.startsWith('-')); return !sub || !VERCEL_OTHER.has(sub); }
    case 'butler': return a[0] === 'push';
    case 'npm': case 'pnpm': case 'yarn': case 'bun': return a.includes('publish') || script();
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
// Paths `git add` would stage (respects .gitignore); null when git cannot say.
function dryRun(d, toks) {
  const r = spawnSync('git', ['add', '--dry-run', ...toks], { cwd: d, encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).map((l) => /^(?:add|remove) '(.*)'$/.exec(l)?.[1]).filter(Boolean);
}

const globRe = (s) => new RegExp(`^${s.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

// M9: the port's git hooks are layer 4 (AGENTS.md rule 4): no --no-verify, no core.hooksPath change, inside a port.
function hooksBypass(sub, args, cfg) {
  const deny = (what) => { throw new PolicyError('GIT_HOOKS_BYPASS', `${what} would switch off the port's git hooks, which keep game data out of git. Never bypass them; if a hook refuses, tell the user why.`); };
  if (cfg.some((c) => /^core\.hookspath=/i.test(c))) deny('git -c core.hooksPath');
  if (sub === 'config') {
    const k = args.findIndex((a) => a.toLowerCase() === 'core.hookspath');
    const writes = args.slice(k + 1).some((a) => !a.startsWith('-')) || args.some((a) => /^(--(unset|unset-all|replace-all|add|edit)|set|unset)$/.test(a));
    if (k >= 0 && writes) deny('git config core.hooksPath');
  }
  if (sub !== 'commit' && sub !== 'push') return;
  for (let j = 0; j < args.length && args[j] !== '--'; j++) {
    const t = args[j];
    if (t === '--no-verify') deny(`git ${sub} --no-verify`);
    if (/^--(message|file|author|date|reuse-message|reedit-message|template|fixup|squash|trailer|pathspec-from-file)$/.test(t)) { j++; continue; }
    if (sub !== 'commit' || !/^-[a-zA-Z]+$/.test(t)) continue; // push -n is --dry-run
    const letters = t.slice(1);
    const v = letters.search(/[mFCct]/); // a value-taking letter ends the bundle
    if ((v < 0 ? letters : letters.slice(0, v)).includes('n')) deny('git commit -n (--no-verify)');
    if (v === letters.length - 1) j++; // its value is the next token
  }
}

function gitCheck(toks, dir) {
  let d = dir, i = 0;
  const cfg = [];
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-C') d = rp(d, toks[++i] ?? '.');
    else if (t === '-c') cfg.push(toks[++i] ?? '');
    else if (t === '--git-dir' || t === '--work-tree' || t === '--namespace') i++;
    else if (!t.startsWith('-')) break;
  }
  const sub = (toks[i] ?? '').toLowerCase();
  if (findPort(d)) hooksBypass(sub, toks.slice(i + 1), cfg);
  if (!['add', 'stage', 'commit', 'push'].includes(sub)) return;
  const ctx = findPort(d);
  if (!ctx || ctx.public) return;
  const deny = (what) => {
    throw new PolicyError('PUBLIC_BUNDLED', `${what} would include game data (${PROTECTED.join('/, ')}/), which stays private. Add only lane/ or source files by name. ${RIGHTS}`);
  };
  const exists = () => PROTECTED.some((p) => existsSync(path.join(ctx.root, p)));
  const isProtected = (abs) => { const r = posix(rel(ctx.root, abs)); return !r.startsWith('..') && PROTECTED.includes(r.split('/')[0].toLowerCase()); };
  if (sub === 'push') { if (gitHas(ctx.root, ['ls-files'])) deny('git push'); return; }

  let all = false, dd = false;
  const specs = [];
  for (let j = i + 1; j < toks.length; j++) {
    const t = toks[j];
    if (dd) { specs.push(t); continue; }
    if (t === '--') { dd = true; continue; }
    if (sub === 'commit' ? (t === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(t)) : (t === '-u' || t === '--update')) all ||= 'tracked';
    else if (sub !== 'commit' && (t === '-A' || t === '--all')) all = true;
    if (/^(-[a-zA-Z]*[mFCct]|--(message|file|author|date|reuse-message|template|pathspec-from-file))$/.test(t)) { j++; continue; }
    if (!t.startsWith('-')) specs.push(t);
  }
  let needDry = all === true && !specs.length, globs = false;
  for (const s of specs) {
    if (s.startsWith(':') && !/^:(\/|\(top\))/.test(s)) continue;
    const abs = rp(d, s.startsWith(':') ? '.' : s);
    const r = posix(rel(ctx.root, abs));
    const outside = r.startsWith('..') || path.isAbsolute(r);
    if (s.startsWith(':') || r === '' || (outside && within(abs, ctx.root))) { needDry = true; continue; }
    if (outside) continue;
    const seg = r.split('/')[0];
    if (PROTECTED.includes(seg.toLowerCase())) deny(`git ${sub} ${s}`);
    if (/[*?[]/.test(seg)) { needDry = globs = true; }
  }
  if (sub !== 'commit' && needDry) {
    const listed = dryRun(d, toks.slice(i + 1).filter((x) => x !== '-n' && x !== '--dry-run'));
    if (listed) { if (listed.some((p) => isProtected(rp(d, p)))) deny(`git ${sub}`); }
    else if (globs) { for (const s of specs) { const seg = posix(rel(ctx.root, rp(d, s))).split('/')[0]; if (/[*?[]/.test(seg) && PROTECTED.some((p) => globRe(seg).test(p) && existsSync(path.join(ctx.root, p)))) deny(`git ${sub} ${s}`); } }
    else if (exists()) deny(`git ${sub}`);
  }
  if (all === 'tracked' && gitHas(ctx.root, ['diff', '--name-only'])) deny(`git ${sub} --all`);
  if (sub === 'commit' && !specs.length && gitHas(ctx.root, ['diff', '--cached', '--name-only'])) deny('git commit');
}

// Throws for the read-only originals and for port.json (only `pag` writes it, from node).
function writeTarget(p, dir) {
  if (p === undefined || p === '') return;
  const abs = rp(dir, p);
  const ctx = findPort(abs);
  if (!ctx) return;
  if (within(path.join(ctx.root, 'game'), abs)) throw new PolicyError('GAME_DIR_WRITE', `${p} is inside game/, the read-only original. Work on a copy under work/ instead.`);
  if (rel(ctx.root, abs).toLowerCase() === 'port.json') throw new PolicyError('PORT_JSON_WRITE', `port.json is written only by pag. ${ASK}`);
}

// A port root at or below dir. Links are never followed (the game link leads into the install).
// ponytail: bounded scan (depth 4, 5000 entries); a port buried deeper under a deleted folder is missed unless the
// command runs from inside it (recursiveDelete also checks the cwd's own port).
function portBelow(dir, depth = 4, budget = { n: 5000 }) {
  if (portAt(dir)) return dir;
  if (!depth) return null;
  let ents;
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of ents) {
    if (--budget.n < 0) return null;
    if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git') continue;
    const hit = portBelow(path.join(dir, e.name), depth - 1, budget);
    if (hit) return hit;
  }
  return null;
}

// I2: a recursive delete of a port folder, or of a folder above one, is refused.
function recursiveDelete(name, args, dir) {
  if (!DELETERS.has(name) || !args.some((a) => RECURSIVE_RE.test(a))) return;
  const here = findPort(dir)?.root;
  for (const x of args.filter((a) => !a.startsWith('-') && !/^(\/[a-z?])+$/i.test(a))) {
    const segs = posix(x).split('/');
    const w = segs.findIndex((s) => /[*?[]/.test(s));
    const target = rp(dir, w < 0 ? x : segs.slice(0, w).join('/') || '.'); // a glob deletes inside its folder
    const hit = (here && within(target, here) ? here : null) ?? portBelow(target);
    if (!hit) continue;
    const g = path.join(hit, 'game');
    throw new PolicyError('GAME_LINK_DELETE', `${name} ${x} would delete the port folder ${hit} recursively. Its game/ is a link to the user's real install, and on Windows PowerShell 5.1 a recursive delete follows it and deletes the game itself. Ask the user to do it: first remove only the link (Windows: cmd /c rmdir "${g}" or (Get-Item "${g}").Delete(); macOS/Linux: rm "${g}"), then delete the folder.`);
  }
}

function optValues(name, args) {
  const spec = DEST_OPTS[name];
  if (!spec) return [];
  const norm = (x) => (spec.ci ? x.toLowerCase() : x);
  const out = [];
  args.forEach((a, i) => {
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    if (eq > 0 && spec.o.includes(norm(a.slice(0, eq)))) out.push(a.slice(eq + 1));
    else if (spec.o.includes(norm(a)) && args[i + 1] !== undefined) out.push(args[i + 1]);
  });
  return out;
}

function shellCheck(command, cwd, depth = 0) {
  const heredocs = /\bgit\b[\s\S]*\bcommit\b|\bgh\b/i.test(command) ? command.replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2(?=\s|$|\))/g, ' ') : command;
  const segs = segments(heredocs).map(unwrap).filter((t) => t.length);
  const scan = [];
  for (const t of segs) {
    const name = baseName(t[0]);
    const args = dropProse(name, t.slice(1));
    scan.push(...args);
    if (NAME_RE.test(name)) scan.push(`bad:${name}`);
    for (const a of [t[0], ...args]) {
      if (!/[\\/]/.test(a) && !EXE_LIKE_RE.test(a)) continue;
      if (EXE_LIKE_RE.test(a) && posix(a).split('/').some((c) => NAME_RE.test(c))) scan.push(`bad:${a}`);
    }
  }
  const text = scan.join(' ');
  if (DISTINCT_RE.test(text) || scan.some((x) => x.startsWith('bad:')) || segs.some((t) => DISTINCT_RE.test(t[0]))) {
    throw new PolicyError('CIRCUMVENTION', 'DRM removal, emulation and crack tooling is refused (spec §11); this skill never bypasses copy protection.');
  }
  piracyCheck(`${segs.map((t) => t[0]).join(' ')} ${text}`);

  let dir = cwd;
  for (const t of segs) {
    const name = baseName(t[0]);
    const args = t.slice(1);
    if (['cd', 'chdir', 'set-location', 'pushd'].includes(name)) {
      const a = args.find((x) => !/^\/d$/i.test(x) && !x.startsWith('-'));
      if (a) dir = rp(dir, a);
      continue;
    }
    if (SHELLS.has(name)) {
      const k = args.findIndex((x) => /^(-[a-z]*c|-command|\/c|\/k)$/i.test(x));
      if (k >= 0 && depth < 3) shellCheck(args.slice(k + 1).join(' '), dir, depth + 1);
      continue;
    }
    if (name === 'git') { gitCheck(args, dir); continue; }
    const low = args.map((x) => x.toLowerCase());
    if (deploys(name, low)) {
      const cands = [dir, ...args.filter((x) => !x.startsWith('-') || /^--[\w-]+=/.test(x)).map((x) => x.replace(/^--[\w-]+=/, ''))];
      for (const c of cands) {
        const ctx = findPort(rp(dir, c));
        if (ctx && !ctx.public) throw new PolicyError('PUBLIC_BUNDLED', `${name} would publish this port's build, which contains game data. ${RIGHTS}`);
      }
    }
    recursiveDelete(name, args, dir);
    const pos = args.filter((x) => !(x.startsWith('-') || /^\/[a-z?]$/i.test(x)));
    if (ANY_ARG_WRITERS.has(name)) pos.forEach((x) => writeTarget(x, dir));
    else if (DEST_WRITERS.has(name) && pos.length > 1) writeTarget(name === 'robocopy' ? pos[1] : pos.at(-1), dir);
    else if (name === 'sed' && args.some((x) => /^(-i|--in-place)/.test(x))) pos.slice(1).forEach((x) => writeTarget(x, dir));
    optValues(name, args).forEach((x) => writeTarget(x, dir));
    for (let j = 0; j < t.length; j++) { // redirects, resolved against the cd-tracked dir
      const m = /^(?:\d|&)?>>?(.*)$/.exec(t[j]);
      if (m) writeTarget(m[1] || t[j + 1], dir);
    }
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
  writeTarget(p, cwd);
  const abs = rp(cwd, p);
  if (findPort(abs) && EMU_FILE_RE.test(path.basename(abs))) throw new PolicyError('CIRCUMVENTION', `${path.basename(abs)} is a DRM-emulator file; creating it in a port is refused.`);
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
  if (target === 'lan') {
    if (!password) throw new PolicyError('LAN_NO_PASSWORD', 'serving beyond 127.0.0.1 needs a password (--password-env VAR).');
    // M7: spec §11 Warn item, checked here because the port is at hand (a folder outside any port needs the password only).
    if (port?.id && !(port.acks ?? []).some((a) => a?.id === 'ACK_WARN_BEYOND_LOOPBACK' && a.at)) {
      throw new PolicyError('LAN_NO_ACK', `serving this port beyond 127.0.0.1 needs the user's OK first: ask them the ACK_WARN_BEYOND_LOOPBACK question (references/legal.md), and only after a yes run \`pag ack ACK_WARN_BEYOND_LOOPBACK\`. ${ASK}`);
    }
    return;
  }
  if (target === 'public') {
    if (!isPublicAllowed(port)) throw new PolicyError('PUBLIC_BUNDLED', `a public target needs game data the user holds the rights to. ${RIGHTS}`);
    return;
  }
  throw new Error(`unknown target '${target}'`);
}
