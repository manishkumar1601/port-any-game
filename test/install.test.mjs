import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INSTALL = fileURLToPath(new URL('../scripts/install.mjs', import.meta.url));
const WIN = process.platform === 'win32';

// R5: every run gets a fake home, a decoy home and a fake XDG dir; the real user's config is never touched.
// `home` is where `~` must resolve (USERPROFILE on Windows, HOME elsewhere); `decoy` is the other variable.
function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-install-'));
  const [home, decoy, xdg, project] = ['home', 'decoy', 'xdg', 'project'].map((n) => path.join(dir, n));
  for (const d of [home, decoy, xdg, project]) mkdirSync(d);
  const env = { ...process.env, HOME: WIN ? decoy : home, USERPROFILE: WIN ? home : decoy, XDG_CONFIG_HOME: xdg };
  const run = (...args) => spawnSync(process.execPath, [INSTALL, ...args], { encoding: 'utf8', env });
  return { home, decoy, xdg, project, run, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('install --dry-run lists opencode targets for project and global, and writes nothing', () => {
  const s = sandbox();
  try {
    const targets = [['skills', 'port-any-game'], ['agents', 'game-surveyor.md'], ['agents', 'port-verifier.md'],
      ['commands', 'port-game.md'], ['plugins', 'port-any-game'], ['plugins', 'port-any-game.js']];
    for (const [args, base] of [[['--project', s.project], path.join(s.project, '.opencode')], [['--global'], path.join(s.xdg, 'opencode')]]) {
      const r = s.run('--host=opencode', ...args, '--dry-run');
      assert.equal(r.status, 0, r.stderr);
      for (const t of targets) assert.ok(r.stdout.includes(path.join(base, ...t)), `${t.join('/')} missing from:\n${r.stdout}`);
    }
    for (const d of [s.home, s.decoy, s.xdg, s.project]) assert.deepEqual(readdirSync(d), [], `dry run wrote into ${d}`);
  } finally {
    s.done();
  }
});

test('install never overwrites opencode.json', () => {
  const s = sandbox();
  try {
    const cfg = path.join(s.project, 'opencode.json');
    writeFileSync(cfg, '{"model":"mine"}\n');
    const r = s.run('--host=opencode', '--project', s.project);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(cfg, 'utf8'), '{"model":"mine"}\n');
    assert.ok(r.stdout.includes(cfg), r.stdout);
    assert.match(r.stdout, /"permissions"/); // the lines to merge
    assert.ok(existsSync(path.join(s.project, '.opencode', 'plugins', 'port-any-game.js')));
  } finally {
    s.done();
  }
});

test('install refuses to overwrite opencode.jsonc', () => {
  const s = sandbox();
  try {
    const cfg = path.join(s.xdg, 'opencode', 'opencode.jsonc');
    mkdirSync(path.dirname(cfg));
    writeFileSync(cfg, '// mine\n{}\n');
    const r = s.run('--host=opencode', '--global');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(cfg, 'utf8'), '// mine\n{}\n');
    assert.ok(r.stdout.includes(cfg), r.stdout);
  } finally {
    s.done();
  }
});

test('install --host=skills resolves ~ to USERPROFILE on Windows and HOME elsewhere', () => {
  const s = sandbox();
  try {
    assert.equal(s.run('--host=skills', '--global').status, 0);
    for (const d of ['.agents', '.claude']) assert.ok(existsSync(path.join(s.home, d, 'skills', 'port-any-game', 'SKILL.md')), d);
    assert.deepEqual(readdirSync(s.decoy), []);
    assert.equal(s.run('--host=skills', '--project', s.project).status, 0);
    assert.ok(existsSync(path.join(s.project, '.agents', 'skills', 'port-any-game', 'scripts', 'pag.mjs')));
    assert.equal(s.run('--host=skills').status, 2, 'needs --global or --project');
  } finally {
    s.done();
  }
});

test('the opencode shim resolves the plugin and its policy import in the installed layout', async () => {
  const s = sandbox();
  try {
    for (const [args, base] of [[['--project', s.project], path.join(s.project, '.opencode')], [['--global'], path.join(s.xdg, 'opencode')]]) {
      const r = s.run('--host=opencode', ...args);
      assert.equal(r.status, 0, r.stderr);
      const { default: plugin } = await import(pathToFileURL(path.join(base, 'plugins', 'port-any-game.js')).href);
      assert.equal(plugin.id, 'port-any-game');
      // A deny proves ../../skills/port-any-game/scripts/policy.mjs resolved (a failed import fails open).
      const before = (await plugin.server({ directory: s.project }))['tool.execute.before'];
      await assert.rejects(before({ tool: 'bash' }, { args: { command: 'steamless.exe a' } }), /DRM removal/);
    }
    assert.ok(!existsSync(path.join(s.project, 'opencode.jsonc')), 'install never writes agent config');
    assert.ok(!existsSync(path.join(s.xdg, 'opencode', 'opencode.jsonc')), 'install never writes agent config');
  } finally {
    s.done();
  }
});
