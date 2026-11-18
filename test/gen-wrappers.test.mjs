import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../scripts/gen-wrappers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GEN = path.join(ROOT, 'scripts', 'gen-wrappers.mjs');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const fixture = (n) => read(`test/fixtures/hook-payloads/${n}.json`);
const body = (md) => md.slice(md.indexOf('\n---\n', 4) + 5);
const perms = (md) => [...md.matchAll(/^ {2}- \{ action: "([^"]+)", resource: "([^"]+)", effect: "(\w+)" \}$/gm)].map((m) => m.slice(1).join(' '));

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
    'shell node *pag.mjs doctor* allow', 'shell node *pag.mjs survey* allow',
  ]);
  assert.deepEqual(perms(out.get('opencode/agents/port-verifier.md')), [
    '* * deny', 'read * allow', 'external_directory * ask', 'shell node *pag.mjs verify* allow',
  ]);
  assert.match(out.get('opencode/commands/port-game.md'), /^@port-any-game Port the game in: \$ARGUMENTS$/m);
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
  assert.equal(pre.matcher, 'Bash|Write|Edit|MultiEdit|WebFetch');
  assert.deepEqual(pre.hooks[0], { type: 'command', command: 'node', args: [pag, 'guard', '--host=claude'] });
  assert.deepEqual(hooks.SessionStart[0].hooks[0], { type: 'command', command: 'node', args: [pag, 'status', '--host=claude'] });
  // Run it the way Claude does: no shell, the placeholder substituted into each arg.
  const args = pre.hooks[0].args.map((a) => a.replace('${CLAUDE_PLUGIN_ROOT}', ROOT));
  const r = spawnSync(process.execPath, args, { input: fixture('claude-pretooluse-bash'), encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /DRM removal/);
});

test('codex and copilot hook commands follow spike b and deny in their shell', () => {
  const codex = JSON.parse(read('hooks/codex.json')).hooks;
  const copilot = JSON.parse(read('com.github.copilot/hooks/hooks.json'));
  assert.equal(copilot.version, 1);
  const pre = codex.PreToolUse[0];
  assert.equal(pre.matcher, 'Bash|apply_patch');
  const cases = [
    ['codex', pre.hooks[0].command, pre.hooks[0].commandWindows],
    ['copilot', copilot.hooks.preToolUse[0].bash, copilot.hooks.preToolUse[0].powershell],
  ];
  for (const [host, posix, ps] of cases) {
    assert.ok(ps.endsWith('; exit $LASTEXITCODE'), ps);
    assert.ok(posix.endsWith(`guard --host=${host}`), posix);
    // Each OS runs its own form (Windows: PowerShell; elsewhere: sh). Codex and Copilot deny with JSON at exit 0.
    const env = { ...process.env, PLUGIN_ROOT: ROOT };
    const r = process.platform === 'win32'
      ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { input: fixture(`${host}-pretooluse`), encoding: 'utf8', env })
      : spawnSync('sh', ['-c', posix], { input: fixture(`${host}-pretooluse`), encoding: 'utf8', env });
    assert.equal(r.status, 0, `${host}: ${r.stderr}`);
    assert.match(r.stdout, /"permissionDecision":"deny"/, host);
  }
  assert.match(codex.SessionStart[0].hooks[0].command, /status --host=codex$/);
  assert.match(codex.SessionStart[0].hooks[0].commandWindows, /status --host=codex; exit \$LASTEXITCODE$/);
  assert.match(copilot.hooks.sessionStart[0].bash, /status --host=copilot$/);
  assert.match(copilot.hooks.sessionStart[0].powershell, /status --host=copilot; exit \$LASTEXITCODE$/);
});
