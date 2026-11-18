import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../scripts/gen-wrappers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GEN = path.join(ROOT, 'scripts', 'gen-wrappers.mjs');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = (n) => read(`test/fixtures/hook-payloads/${n}.json`);
const body = (md) => md.slice(md.indexOf('\n---\n', 4) + 5);
const rules = (md) => [...md.matchAll(/^ {2}- \{ action: "([^"]+)", resource: "([^"]+)", effect: "(\w+)" \}$/gm)].map((m) => m.slice(1));
const perms = (md) => rules(md).map((r) => r.join(' '));

test('build generates copilot and opencode agents', () => {
  const out = generate(ROOT);
  assert.deepEqual([...out.keys()].sort(), [
    'com.github.copilot/agents/game-surveyor.agent.md',
    'com.github.copilot/agents/port-verifier.agent.md',
    'opencode/agents/game-surveyor.md',
    'opencode/agents/port-verifier.md',
    'opencode/commands/port-game.md',
  ]);
  for (const name of ['game-surveyor', 'port-verifier']) {
    const canonical = body(read(`agents/${name}.md`));
    assert.equal(body(out.get(`com.github.copilot/agents/${name}.agent.md`)), canonical, name);
    assert.equal(body(out.get(`opencode/agents/${name}.md`)), canonical, name);
    assert.match(out.get(`opencode/agents/${name}.md`), /^mode: subagent$/m);
  }
  assert.match(out.get('com.github.copilot/agents/game-surveyor.agent.md'), /^tools: \["read","search","execute"\]$/m);
  assert.match(out.get('com.github.copilot/agents/port-verifier.agent.md'), /^tools: \["read","execute"\]$/m);
  // v2 permissions: deny everything first (last match wins), then only the canonical tools and the pag commands the body runs.
  assert.deepEqual(perms(out.get('opencode/agents/game-surveyor.md')), [
    '* * deny', 'read * allow', 'glob * allow', 'grep * allow', 'external_directory * ask',
    'shell node *pag.mjs* doctor* allow', 'shell node *pag.mjs* survey* allow',
  ]);
  assert.deepEqual(perms(out.get('opencode/agents/port-verifier.md')), [
    '* * deny', 'read * allow', 'external_directory * ask', 'shell node *pag.mjs* verify* allow',
  ]);
  assert.match(out.get('opencode/commands/port-game.md'), /^@port-any-game Port the game in: \$ARGUMENTS$/m);
});

// OpenCode-style wildcard (`*` = any text, whole-string match) and v2 evaluation: the last matching rule wins.
const glob = (p) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's');
function shellEffect(md, cmd) {
  let effect;
  for (const [action, resource, e] of rules(md)) if ((action === '*' || action === 'shell') && glob(resource).test(cmd)) effect = e;
  return effect;
}

test('opencode subagents may run their own pag commands, also with quoted paths that contain spaces', () => {
  const out = generate(ROOT);
  const surveyor = out.get('opencode/agents/game-surveyor.md');
  const verifier = out.get('opencode/agents/port-verifier.md');
  const pag = (...a) => ['node', '"C:\\Users\\Jo Smith\\.agents\\skills\\port-any-game\\scripts\\pag.mjs"', ...a].join(' ');
  assert.equal(shellEffect(surveyor, pag('survey', '"D:\\My Games\\Doom"')), 'allow');
  assert.equal(shellEffect(surveyor, pag('doctor', '--json')), 'allow');
  assert.equal(shellEffect(surveyor, 'node /home/jo/.agents/skills/port-any-game/scripts/pag.mjs survey /games/doom --json'), 'allow');
  assert.equal(shellEffect(surveyor, pag('new', '"D:\\g"', '"D:\\p"')), 'deny');
  assert.equal(shellEffect(surveyor, 'rm -rf /'), 'deny');
  assert.equal(shellEffect(verifier, pag('verify', '"D:\\My Port\\dist"', '--soak', '120')), 'allow');
  assert.equal(shellEffect(verifier, pag('survey', '"D:\\g"')), 'deny');
});

test('PowerShell and NotebookEdit map like Bash and Edit for the other hosts (I1)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-gen-'));
  try {
    mkdirSync(path.join(dir, 'agents'));
    writeFileSync(path.join(dir, 'agents', 'x.md'), '---\nname: x\ndescription: "x"\ntools: Read, PowerShell, NotebookEdit\n---\nRun `node <skill-dir>/scripts/pag.mjs verify`.\n');
    const out = generate(dir);
    assert.match(out.get('com.github.copilot/agents/x.agent.md'), /^tools: \["read","execute","edit"\]$/m);
    assert.deepEqual(perms(out.get('opencode/agents/x.md')), ['* * deny', 'read * allow', 'edit * allow', 'external_directory * ask', 'shell node *pag.mjs* verify* allow']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('build --check passes on the committed files', () => {
  const r = spawnSync(process.execPath, [GEN, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('build --check detects drift', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-gen-'));
  try {
    for (const p of ['agents', 'com.github.copilot', 'opencode']) cpSync(path.join(ROOT, p), path.join(dir, p), { recursive: true });
    mkdirSync(path.join(dir, 'scripts'));
    cpSync(GEN, path.join(dir, 'scripts', 'gen-wrappers.mjs'));
    const gen = (...a) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'gen-wrappers.mjs'), ...a], { encoding: 'utf8' });
    assert.equal(gen('--check').status, 0);

    const f = path.join(dir, 'opencode', 'agents', 'port-verifier.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('effect: "deny"', 'effect: "allow"'));
    writeFileSync(path.join(dir, 'com.github.copilot', 'agents', 'old.agent.md'), 'stale\n');
    const r = gen('--check');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /opencode\/agents\/port-verifier\.md/);
    assert.match(r.stderr, /com\.github\.copilot\/agents\/old\.agent\.md/);

    assert.equal(gen().status, 0);
    assert.equal(gen('--check').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('claude hooks.json uses exec form with CLAUDE_PLUGIN_ROOT', () => {
  const { hooks } = JSON.parse(read('hooks/hooks.json'));
  const pag = '${CLAUDE_PLUGIN_ROOT}/skills/port-any-game/scripts/pag.mjs';
  const pre = hooks.PreToolUse[0];
  assert.equal(pre.matcher, 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch');
  assert.deepEqual(pre.hooks[0], { type: 'command', command: 'node', args: [pag, 'guard', '--host=claude'] });
  assert.deepEqual(hooks.SessionStart[0].hooks[0], { type: 'command', command: 'node', args: [pag, 'status', '--host=claude'] });
  // Run it the way Claude does: no shell, the placeholder substituted into each arg.
  const args = pre.hooks[0].args.map((a) => a.replace('${CLAUDE_PLUGIN_ROOT}', ROOT));
  const r = spawnSync(process.execPath, args, { input: fixture('claude-pretooluse-bash'), encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /DRM removal/);
});

// I1: Claude Code's built-in tools (Windows adds PowerShell). Every one the guard classifies must reach it, and the
// matcher names no tool the guard ignores.
test('the claude matcher covers every Claude tool the guard classifies', async () => {
  const { normalizeEvent } = await import('../skills/port-any-game/scripts/guard.mjs');
  const CLAUDE_TOOLS = ['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Read',
    'Glob', 'Grep', 'LS', 'Task', 'TodoWrite', 'NotebookRead', 'BashOutput', 'KillShell', 'ExitPlanMode', 'Skill', 'SlashCommand'];
  const { matcher } = JSON.parse(read('hooks/hooks.json')).hooks.PreToolUse[0];
  const matches = (t) => new RegExp(`^(?:${matcher})$`).test(t);
  const guarded = CLAUDE_TOOLS.filter((t) => normalizeEvent({ tool_name: t, tool_input: {} }).tool !== 'other');
  assert.deepEqual(guarded.filter((t) => !matches(t)), [], 'guarded tools the matcher misses');
  assert.deepEqual(matcher.split('|').filter((t) => normalizeEvent({ tool_name: t, tool_input: {} }).tool === 'other'), [], 'matcher names the guard ignores');
  assert.ok(matches('PowerShell') && matches('NotebookEdit'));
});

// Run a hook command string the way this OS's form runs (Windows: PowerShell; elsewhere: sh).
const shell = (posix, ps, input, env) => (process.platform === 'win32'
  ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input, encoding: 'utf8', env })
  : spawnSync('sh', ['-c', posix], { input, encoding: 'utf8', env }));
const withRoot = { ...process.env, PLUGIN_ROOT: ROOT };
const noRoot = { ...process.env };
delete noRoot.PLUGIN_ROOT;
delete noRoot.CLAUDE_PLUGIN_ROOT;

test('codex hook commands follow spike b and deny in their shell', () => {
  const codex = JSON.parse(read('hooks/codex.json')).hooks;
  const pre = codex.PreToolUse[0];
  assert.equal(pre.matcher, 'Bash|apply_patch');
  const { command, commandWindows } = pre.hooks[0];
  assert.ok(command.endsWith('guard --host=codex'), command);
  assert.ok(commandWindows.endsWith('guard --host=codex; exit $LASTEXITCODE'), commandWindows);
  // Codex sets PLUGIN_ROOT and CLAUDE_PLUGIN_ROOT (documented); both forms fall back to the latter. Deny = JSON at exit 0.
  for (const env of [withRoot, { ...noRoot, CLAUDE_PLUGIN_ROOT: ROOT }]) {
    const r = shell(command, commandWindows, fixture('codex-pretooluse'), env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"permissionDecision":"deny"/);
  }
  assert.match(codex.SessionStart[0].hooks[0].command, /status --host=codex$/);
  assert.match(codex.SessionStart[0].hooks[0].commandWindows, /status --host=codex; exit \$LASTEXITCODE$/);
});

test('every copilot hook command fails open on a launch failure and still denies via JSON (R56)', () => {
  const copilot = JSON.parse(read('com.github.copilot/hooks/hooks.json'));
  assert.equal(copilot.version, 1);
  const entries = Object.values(copilot.hooks).flat();
  assert.equal(entries.length, 2);
  for (const h of entries) {
    assert.ok(h.bash.endsWith(' || true'), h.bash);
    assert.ok(h.powershell.endsWith('; exit 0'), h.powershell);
    // No plugin root: node cannot find pag.mjs, yet the hook exits 0 (Copilot preToolUse fails closed on non-zero).
    assert.equal(shell(h.bash, h.powershell, fixture('copilot-pretooluse'), noRoot).status, 0, h.bash);
  }
  const pre = copilot.hooks.preToolUse[0];
  assert.match(pre.bash, /guard --host=copilot \|\| true$/);
  const r = shell(pre.bash, pre.powershell, fixture('copilot-pretooluse'), withRoot);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"permissionDecision":"deny"/);
  assert.match(copilot.hooks.sessionStart[0].powershell, /status --host=copilot; exit 0$/);
});

test('codex manifest parses and points at an existing hooks file', () => {
  const m = JSON.parse(read('.codex-plugin/plugin.json'));
  const claude = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(m.name, claude.name);
  assert.equal(m.version, claude.version);
  assert.equal(m.hooks, './hooks/codex.json'); // Codex: ./-prefixed, inside the plugin root
  assert.ok(existsSync(path.join(ROOT, m.hooks)));
  assert.ok(JSON.parse(read(m.hooks)).hooks.PreToolUse);
  // Claude reads only .claude-plugin/, whose manifest does not redirect hooks: Claude keeps hooks/hooks.json.
  assert.equal(claude.hooks, undefined);
});
