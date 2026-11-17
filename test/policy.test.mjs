import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkToolUse, assertLaneAllowed, assertTarget, PolicyError } from '../skills/port-any-game/scripts/policy.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-policy-'));
after(() => rmSync(base, { recursive: true, force: true }));

function port(name, mode = 'byo') {
  const root = path.join(base, name);
  for (const d of ['game', 'work', 'build', 'lane']) mkdirSync(path.join(root, d), { recursive: true });
  writeFileSync(path.join(root, 'port.json'), JSON.stringify({ schema: 'port-any-game/port@1', id: name, name, lane: 'web-extract', data: { mode }, tools: {}, acks: [], created_at: '2026-11-17T00:00:00Z' }));
  return root;
}
const sh = (command, cwd) => checkToolUse({ tool: 'shell', command, cwd });

test('denies steamless', () => {
  const r = sh('steamless.exe x game.exe', base);
  assert.equal(r.deny, true);
  assert.equal(r.code, 'CIRCUMVENTION');
  for (const c of ['Steamless.CLI.exe "C:\\Program Files\\g\\a.exe"', 'noceg a.exe', 'cp goldberg_emu/steam_api64.dll .', 'python unlicense.py a.exe', 'copy crack\\loader.exe .']) {
    assert.equal(sh(c, base).deny, true, c);
  }
});

test('denies piracy domains by hostname, not substring', () => {
  assert.equal(sh('curl -O https://www.vimm.net/vault/123', base).deny, true);
  assert.equal(sh('curl https://notvimm.net/x', base).deny, false);
  assert.equal(checkToolUse({ tool: 'fetch', url: 'https://cdn.myabandonware.com/a.zip', cwd: base }).deny, true);
  assert.equal(sh('aria2c "magnet:?xt=urn:btih:abc"', base).deny, true);
  assert.equal(checkToolUse({ tool: 'fetch', url: 'https://example.com/readme', cwd: base }).deny, false);
});

test('denies git add game/', () => {
  const root = port('p1');
  const r = sh('git add game/', root);
  assert.equal(r.deny, true);
  assert.equal(r.code, 'PUBLIC_BUNDLED');
  for (const c of ['git add .', 'git add -A', 'git add --all', 'git -C ' + root + ' add work/x', 'git add -- build/index.html', 'git add *', 'cd ' + root + ' && git add game', 'git add lane game/x']) {
    assert.equal(sh(c, c.startsWith('git -C') ? base : root).deny, true, c);
  }
});

test('allows git add lane/', () => {
  const root = port('p2');
  assert.equal(sh('git add lane/', root).deny, false);
  assert.equal(sh('git add lane/a.mjs README.md', root).deny, false);
  assert.equal(sh('git add .', path.join(root, 'lane')).deny, false);
  assert.equal(sh('git commit -m "refuse steamless and game/ in git add"', root).deny, false);
  const bare = path.join(base, 'plain');
  mkdirSync(path.join(bare, 'game'), { recursive: true });
  assert.equal(sh('git add .', bare).deny, false, 'no port.json, not ours');
});

test('allows git add game/ in bundled-public port', () => {
  const root = port('p3', 'bundled-public');
  assert.equal(sh('git add game/', root).deny, false);
  assert.equal(sh('wrangler pages deploy build', root).deny, false);
});

test('denies git push when protected files are tracked', () => {
  const root = port('p4');
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  if (git('init', '-q').status !== 0) return; // no git on this machine
  assert.equal(sh('git push origin main', root).deny, false);
  writeFileSync(path.join(root, 'game', 'data.bin'), 'x');
  git('add', '-f', 'game/data.bin');
  assert.equal(sh('git push origin main', root).deny, true);
  assert.equal(sh('git commit -m x', root).deny, true, 'staged game file');
});

test('denies wrangler deploy of bundled port', () => {
  const root = port('p5', 'bundled');
  for (const c of ['wrangler deploy', 'wrangler pages deploy build', 'npx wrangler pages deploy build --project-name x', 'netlify deploy --prod', 'vercel --prod', 'surge build', 'butler push build me/game:html', 'npm publish', 'npx gh-pages -d build', 'powershell -NoProfile -Command "wrangler deploy"']) {
    assert.equal(sh(c, root).deny, true, c);
  }
  assert.equal(sh('wrangler deploy', base).deny, false, 'outside a port folder');
});

test('denies write into game/', () => {
  const root = port('p6');
  assert.equal(checkToolUse({ tool: 'write', path: path.join(root, 'game', 'a.txt'), cwd: base }).code, 'GAME_DIR_WRITE');
  assert.equal(checkToolUse({ tool: 'write', path: 'game/a.txt', cwd: root }).deny, true);
  assert.equal(checkToolUse({ tool: 'write', path: 'work/a.txt', cwd: root }).deny, false);
  assert.equal(checkToolUse({ tool: 'write', path: 'work/steam_api64.dll', cwd: root }).deny, true);
  assert.equal(sh('rm -rf game', root).code, 'GAME_DIR_WRITE');
  assert.equal(sh('cp work/a.bin game/a.bin', root).deny, true);
  assert.equal(sh('echo x > game/a.txt', root).deny, true);
  assert.equal(sh('cp game/a.bin work/a.bin', root).deny, false, 'reading the original is fine');
  assert.equal(sh('node pag.mjs survey game', root).deny, false);
});

test('allows unrelated commands', () => {
  const root = port('p7');
  for (const c of ['npm test', 'node --test "test/**/*.test.mjs"', 'git status', 'git log --oneline -5', 'git diff HEAD~1', 'ls -la', 'cat package.json', 'npm install --save-dev prettier',
    'node skills/port-any-game/scripts/pag.mjs survey "D:/Games/My Game"', 'git commit -m "feat: add lane"', 'curl -s https://registry.npmjs.org/left-pad', 'grep -rn TODO src', 'mkdir -p lane/x && cd lane && ls']) {
    assert.deepEqual(sh(c, root), { deny: false, reason: '' }, c);
    assert.equal(sh(c, base).deny, false, c);
  }
  assert.equal(checkToolUse({ tool: 'other', cwd: root }).deny, false);
});

test('assertLaneAllowed throws STOP_VERDICT', () => {
  assert.throws(() => assertLaneAllowed({ verdict: { overall: 'STOP' } }, 'web-extract'), (e) => e instanceof PolicyError && e.code === 'STOP_VERDICT');
  assertLaneAllowed({ verdict: { overall: 'STOP' } }, 'remote-play');
  assertLaneAllowed({ verdict: { overall: 'GO' } }, 'web-extract');
  assertLaneAllowed({ verdict: { overall: 'HARD' } }, 'web-extract');
});

test('assertTarget lan without password throws', () => {
  const p = { data: { mode: 'byo' } };
  assert.throws(() => assertTarget(p, 'lan', {}), (e) => e.code === 'LAN_NO_PASSWORD');
  assertTarget(p, 'lan', { password: 'x' });
  assertTarget(p, 'local');
  assert.throws(() => assertTarget({ data: { mode: 'bundled' } }, 'public'), (e) => e.code === 'PUBLIC_BUNDLED');
  assertTarget({ data: { mode: 'bundled-public' } }, 'public');
});
