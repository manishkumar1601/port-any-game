// `pag new <gameDir> <outDir>`: create the port folder (spec §10). Never commits, never records an ack.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync, chmodSync } from 'node:fs';
import { symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { survey as runSurvey } from './survey/survey.mjs';
import { assertLaneAllowed, PolicyError } from './policy.mjs';
import { LANES } from './lanes/index.mjs';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(SKILL, 'assets', 'project');
const CI = process.platform === 'win32' || process.platform === 'darwin';
const USAGE = 'usage: pag new <gameDir> <outDir> [--lane <id>] [--resume]\n';

class UsageError extends Error {}

// M5: a name with no ASCII letters or digits (CJK titles) gets game-<sha8>, so such ports never share one id, port and OPFS.
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `game-${createHash('sha256').update(String(s)).digest('hex').slice(0, 8)}`;
// Free to share only when every confident (store/signature) match says so: an engine or title guess never counts, and
// a folder that also holds a commercial game's files is not free.
const freeToShare = (matches) => { const sure = matches.filter((m) => !m.needs_confirm); return sure.length > 0 && sure.every((m) => m.redistributable === true); };
const exists = (p) => { try { lstatSync(p); return true; } catch { return false; } };
// Real path of p, or of its nearest existing parent plus the rest (the port folder may not exist yet).
const real = (p) => { try { return realpathSync(p); } catch { const up = path.dirname(p); return up === p ? p : path.join(real(up), path.basename(p)); } };
const within = (root, p) => { const r = CI ? path.relative(root.toLowerCase(), p.toLowerCase()) : path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

// M21: never a port inside the install (port.json, .git and builds would land in the user's game folder, and pack would
// walk its own dist), the install inside the port, or a port inside the skill.
function checkPlaces(game, out) {
  const g = real(game), o = real(out);
  if (within(g, o)) throw new UsageError(`the port folder ${out} is inside (or the same folder as) the game folder ${game}; choose a folder outside the game`);
  if (within(o, g)) throw new UsageError(`the game folder ${game} is inside the port folder ${out}; choose a port folder elsewhere`);
  if (within(real(SKILL), o)) throw new UsageError(`the port folder ${out} is inside the port-any-game skill folder; choose a folder outside it`);
}
const asset = (...p) => readFileSync(path.join(ASSETS, ...p), 'utf8');

// Writes only when missing, so --resume keeps everything the user or agent already changed.
function put(file, content, mode) {
  if (exists(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, mode ? { mode } : undefined);
  if (mode) chmodSync(file, mode);
}

export async function newPort({ gameDir, outDir, lane, resume = false, warn = () => {} }) {
  const game = path.resolve(gameDir), out = path.resolve(outDir);
  checkPlaces(game, out);
  const portFile = path.join(out, 'port.json');
  const had = exists(portFile);
  if (had && !resume) throw new UsageError(`${portFile} already exists; pass --resume to continue that port`);

  let s;
  try { s = await runSurvey(game); } catch (e) { throw e.message === 'not a directory' ? new UsageError(`${game} is not a folder`) : e; }
  const laneId = lane ?? s.verdict.primary_lane;
  assertLaneAllowed(s, laneId); // throws STOP_VERDICT before anything is created
  const desc = laneId && LANES[laneId];
  if (!desc) throw new UsageError(laneId ? `unknown lane '${laneId}'` : 'no lane applies to this game; pass --lane <id>');
  if (!desc.available) throw new UsageError(`lane '${laneId}' is not available until ${desc.milestone}; it cannot be ported yet`);

  mkdirSync(out, { recursive: true });
  let port;
  if (had) port = JSON.parse(readFileSync(portFile, 'utf8'));
  else {
    const title = s.store?.title_guess;
    port = {
      schema: 'port-any-game/port@1',
      id: slug(title || path.basename(game)),
      name: title || path.basename(game),
      lane: laneId,
      data: {
        mode: desc.dataModes[0],
        ...(freeToShare(s.catalog_matches) ? { redistributable: true } : {}),
      },
      tools: { node: process.versions.node },
      acks: [],
      created_at: new Date().toISOString(),
    };
    writeFileSync(portFile, JSON.stringify(port, null, 2) + '\n');
  }

  put(path.join(out, 'survey.json'), JSON.stringify(s, null, 2) + '\n');
  put(path.join(out, 'AGENTS.md'), asset('AGENTS.md'));
  put(path.join(out, 'CLAUDE.md'), asset('CLAUDE.md'));
  put(path.join(out, '.gitignore'), asset('gitignore'));
  put(path.join(out, 'PORTING_LOG.md'), asset('PORTING_LOG.md')
    .replace('{{NAME}}', () => port.name).replace('{{LANE}}', () => port.lane)
    .replace('{{CHECKLIST}}', () => (LANES[port.lane]?.checklist ?? desc.checklist).map((c) => `- [ ] ${c}`).join('\n')));
  put(path.join(out, '.githooks', 'pre-commit'), asset('githooks', 'pre-commit'), 0o755);
  put(path.join(out, '.githooks', 'pre-push'), asset('githooks', 'pre-push'), 0o755);
  put(path.join(out, '.githooks', 'check-staged.mjs'), asset('githooks', 'check-staged.mjs'), 0o755);
  mkdirSync(path.join(out, 'lane'), { recursive: true });
  put(path.join(out, 'lane', '.gitkeep'), '');

  if (!exists(path.join(out, 'game'))) await symlink(game, path.join(out, 'game'), process.platform === 'win32' ? 'junction' : 'dir');

  const git = (...a) => spawnSync('git', a, { cwd: out, encoding: 'utf8' });
  const init = exists(path.join(out, '.git')) ? { status: 0 } : git('init');
  if (init.error || init.status !== 0) warn('git is not available: the port was created without a repository or commit guard hooks. Install git, then run `git init` and `git config core.hooksPath .githooks` in the port.');
  else git('config', 'core.hooksPath', '.githooks');
  return port;
}

// CLI entry. Exit codes: 0 ok, 1 failure (I/O), 2 usage error, 4 policy refusal (STOP verdict).
export async function run(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { lane: { type: 'string' }, resume: { type: 'boolean' } } });
    if (args.positionals.length !== 2) throw new UsageError(USAGE.trim());
  } catch (e) { io.err(`pag new: ${e.message}\n${e instanceof UsageError ? '' : USAGE}`); return 2; }
  const [gameDir, outDir] = args.positionals;
  try {
    const port = await newPort({ gameDir, outDir, lane: args.values.lane, resume: args.values.resume, warn: (m) => io.err(`pag new: warning: ${m}\n`) });
    io.out(`Port '${port.id}' ready in ${path.resolve(outDir)} (lane ${port.lane}, data ${port.data.mode}). Nothing was committed.\nNext: read PORTING_LOG.md and start at the first unchecked item.\n`);
    return 0;
  } catch (e) {
    io.err(`pag new: ${e.message}\n`);
    return e instanceof PolicyError ? 4 : e instanceof UsageError ? 2 : 1; // M19
  }
}
