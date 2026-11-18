// Installs port-any-game for agents without a plugin marketplace. It only copies files and prints each copy; it never
// writes or edits an agent's config file (it prints the lines to merge) and never starts an agent.
// usage: node scripts/install.mjs --host=<opencode|skills> (--global | --project <dir>) [--dry-run]
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = 'skills/port-any-game';
const USAGE = 'usage: node scripts/install.mjs --host=<opencode|skills> (--global | --project <dir>) [--dry-run]\n';
// OpenCode 1.x does not auto-discover plugin subdirectories, only top-level files (spike c), hence this shim.
const SHIM = 'export { default } from "./port-any-game/index.js";\n';

// -> {steps: [{from: repo-relative src, to} | {text, to}], configDirs: dirs whose opencode.json(c) we must not touch}
function plan(host, global, project) {
  const home = homedir(); // `~`: %USERPROFILE% on Windows, $HOME elsewhere
  const steps = [];
  const copy = (from, ...to) => steps.push({ from, to: path.join(...to) });
  if (host === 'skills') {
    if (global) for (const d of ['.agents', '.claude']) copy(SKILL, home, d, 'skills', 'port-any-game');
    else copy(SKILL, project, '.agents', 'skills', 'port-any-game');
    return { steps, configDirs: [] };
  }
  // The plugin imports ../../skills/port-any-game/scripts/policy.mjs, so the skill goes into the same OpenCode dir.
  const base = global ? path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode') : path.join(project, '.opencode');
  copy(SKILL, base, 'skills', 'port-any-game');
  for (const d of ['agents', 'commands']) for (const f of readdirSync(path.join(ROOT, 'opencode', d)).sort()) copy(`opencode/${d}/${f}`, base, d, f);
  copy('opencode/plugin', base, 'plugins', 'port-any-game');
  steps.push({ text: SHIM, to: path.join(base, 'plugins', 'port-any-game.js') });
  return { steps, configDirs: global ? [base] : [project, base] };
}

export function run(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let v;
  try {
    ({ values: v } = parseArgs({ args: argv, options: { host: { type: 'string' }, global: { type: 'boolean' }, project: { type: 'string' }, 'dry-run': { type: 'boolean' } } }));
  } catch (e) { io.err(`install: ${e.message}\n${USAGE}`); return 2; }
  if (!['opencode', 'skills'].includes(v.host) || !v.global === !v.project) { io.err(USAGE); return 2; }
  const project = v.project && path.resolve(v.project);
  if (project && !(existsSync(project) && statSync(project).isDirectory())) { io.err(`install: project folder not found: ${project}\n`); return 2; }

  const dry = v['dry-run'];
  const { steps, configDirs } = plan(v.host, v.global, project);
  try {
    for (const s of steps) {
      io.out(`${dry ? 'would ' : ''}${s.from ? `copy ${s.from} -> ${s.to}` : `write ${s.to}`}\n`);
      if (dry) continue;
      mkdirSync(path.dirname(s.to), { recursive: true });
      if (s.from) cpSync(path.join(ROOT, s.from), s.to, { recursive: true });
      else writeFileSync(s.to, s.text);
    }
  } catch (e) { io.err(`install: ${e.message}\n`); return 1; }

  if (v.host === 'opencode') {
    const existing = configDirs.flatMap((d) => ['opencode.json', 'opencode.jsonc'].map((n) => path.join(d, n))).filter((f) => existsSync(f));
    const example = readFileSync(path.join(ROOT, 'opencode', 'opencode.jsonc.example'), 'utf8');
    io.out(existing.length
      ? `\nLeft unchanged: ${existing.join(', ')}. Optional OpenCode 2.x rules to merge into it:\n${example}`
      : `\nOptional OpenCode 2.x rules (not written): create ${path.join(configDirs[0], 'opencode.jsonc')} with:\n${example}`);
    io.out('Restart OpenCode to load the plugin. For other agents too, also run --host=skills.\n');
  }
  io.out(dry ? 'dry run: nothing written\n' : 'done\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
