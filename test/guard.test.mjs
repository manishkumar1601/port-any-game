import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEvent, formatDeny } from '../skills/port-any-game/scripts/guard.mjs';

const FIX = fileURLToPath(new URL('./fixtures/hook-payloads/', import.meta.url));
const PAG = fileURLToPath(new URL('../skills/port-any-game/scripts/pag.mjs', import.meta.url));
const fixture = (n) => JSON.parse(readFileSync(path.join(FIX, `${n}.json`), 'utf8'));
const guard = (host, input) => spawnSync(process.execPath, [PAG, 'guard', `--host=${host}`], { input, encoding: 'utf8' });

test('normalizes every recorded payload', () => {
  const files = readdirSync(FIX).filter((f) => /(pretooluse|beforetool|tool-execute|permission-evaluate)/.test(f));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const ev = normalizeEvent(fixture(f.replace('.json', '')), f.split('-')[0]);
    if (f.includes('write')) {
      assert.equal(ev.tool, 'write', f);
      assert.match(ev.path, /build.index\.html$/);
    } else {
      assert.equal(ev.tool, 'shell', f);
      assert.equal(ev.command, 'steamless.exe x game.exe', f);
    }
    assert.ok(ev.cwd, f);
  }
  assert.equal(normalizeEvent(fixture('antigravity-pretooluse')).cwd, 'C:\\work\\proj');
  assert.equal(normalizeEvent(fixture('copilot-sessionstart')).tool, 'other');
  assert.equal(normalizeEvent({ command: 'git status', cwd: '/x' }).command, 'git status', 'cursor beforeShellExecution');
  assert.deepEqual(normalizeEvent({ tool_name: 'apply_patch', cwd: '/x', tool_input: { command: '*** Begin Patch\n*** Add File: game/a.txt\n+x\n*** End Patch' } }).paths, ['game/a.txt']);
  assert.equal(normalizeEvent({ toolName: 'bash', toolArgs: '{"command":"ls"}', cwd: '/x' }).command, 'ls');
  assert.equal(normalizeEvent({ toolName: 'bash', toolArgs: { command: 'ls' }, cwd: '/x' }).command, 'ls');
});

test('formatDeny copilot JSON exit 0', () => {
  const d = formatDeny('copilot', 'nope');
  assert.equal(d.exitCode, 0);
  assert.deepEqual(JSON.parse(d.stdout), { permissionDecision: 'deny', permissionDecisionReason: 'nope' });
  for (const h of ['antigravity', 'agentplugins']) {
    const x = formatDeny(h, 'nope');
    assert.equal(x.exitCode, 0);
    assert.equal(JSON.parse(x.stdout).decision, 'deny');
  }
  const c = formatDeny('codex', 'nope');
  assert.equal(c.exitCode, 0);
  assert.equal(JSON.parse(c.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('formatDeny claude stderr exit 2', () => {
  for (const h of ['claude', 'cursor', 'gemini', 'whatever']) {
    const d = formatDeny(h, 'nope');
    assert.equal(d.exitCode, 2);
    assert.equal(d.stdout, '');
    assert.match(d.stderr, /nope/);
  }
});

test('guard exits 0 and prints nothing on malformed stdin', () => {
  for (const input of ['{not json', '', '\uFEFF\r\n', '[1,2', 'null']) {
    const r = guard('claude', input);
    assert.equal(r.status, 0, JSON.stringify(input));
    assert.equal(r.stdout, '');
  }
  assert.equal(guard('copilot', '{bad').stdout, '');
});

test('guard denies per host and tolerates BOM and CRLF', () => {
  const claude = guard('claude', '\uFEFF' + JSON.stringify(fixture('claude-pretooluse-bash'), null, 2).replace(/\n/g, '\r\n'));
  assert.equal(claude.status, 2);
  assert.equal(claude.stdout, '');
  assert.match(claude.stderr, /DRM/);
  const copilot = guard('copilot', JSON.stringify(fixture('copilot-pretooluse')));
  assert.equal(copilot.status, 0);
  assert.equal(JSON.parse(copilot.stdout).permissionDecision, 'deny');
  assert.equal(JSON.parse(guard('antigravity', JSON.stringify(fixture('antigravity-pretooluse'))).stdout).decision, 'deny');
});

test('guard allows benign and session events silently', () => {
  const n = guard('claude', JSON.stringify({ tool_name: 'Bash', cwd: process.cwd(), tool_input: { command: 'npm test' } }));
  assert.deepEqual([n.status, n.stdout, n.stderr], [0, '', '']);
  const r = guard('copilot', JSON.stringify(fixture('copilot-sessionstart')));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('guard fails open when policy or guard fail to load', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-guard-'));
  try {
    const src = path.dirname(PAG);
    for (const f of ['pag.mjs', 'guard.mjs']) copyFileSync(path.join(src, f), path.join(dir, f));
    writeFileSync(path.join(dir, 'policy.mjs'), 'export const x = ;');
    const input = JSON.stringify(fixture('copilot-pretooluse'));
    const go = () => spawnSync(process.execPath, [path.join(dir, 'pag.mjs'), 'guard', '--host=copilot'], { input, encoding: 'utf8' });
    let r = go();
    assert.deepEqual([r.status, r.stdout], [0, '']);
    assert.match(r.stderr, /allowing/);
    writeFileSync(path.join(dir, 'guard.mjs'), 'export const run = ;');
    r = go();
    assert.deepEqual([r.status, r.stdout], [0, '']);
    assert.match(r.stderr, /allowing/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
