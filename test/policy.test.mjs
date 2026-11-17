import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkToolUse, assertLaneAllowed, assertTarget, PolicyError } from '../skills/port-any-game/scripts/policy.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-policy-'));
after(() => rmSync(base, { recursive: true, force: true }));

function port(name, mode = 'byo', extra = {}) {
  const root = path.join(base, name);
  for (const d of ['game', 'work', 'build', 'lane']) mkdirSync(path.join(root, d), { recursive: true });
  writeFileSync(path.join(root, 'port.json'), JSON.stringify({ schema: 'port-any-game/port@1', id: name, name, lane: 'web-extract', data: { mode, ...extra.data }, tools: {}, acks: extra.acks ?? [], created_at: '2026-11-17T00:00:00Z' }));
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
  const root = port('p3', 'bundled-public', { acks: [{ id: 'ACK_RIGHTS_HOLDER', at: '2026-11-17T00:00:00Z' }] });
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
  assert.throws(() => assertTarget({ data: { mode: 'bundled-public' } }, 'public'), (e) => e.code === 'PUBLIC_BUNDLED');
  assertTarget({ data: { mode: 'bundled-public' }, acks: [{ id: 'ACK_RIGHTS_HOLDER', at: 'x' }] }, 'public');
  assertTarget({ data: { mode: 'bundled-public', redistributable: true } }, 'public');
});

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const hasGit = git(base, '--version').status === 0;
const env = (k, v, fn) => { const o = process.env[k]; process.env[k] = v; try { return fn(); } finally { if (o === undefined) delete process.env[k]; else process.env[k] = o; } };
const fwd = (p) => p.replaceAll('\\', '/');

test('bundled-public without ACK_RIGHTS_HOLDER is not public', () => {
  const root = port('q1', 'bundled-public');
  const r = sh('git add game/', root);
  assert.equal(r.deny, true);
  assert.match(r.reason, /Ask the user\. Do not edit port\.json yourself/);
  assert.equal(sh('wrangler deploy', root).deny, true);
});

test('bundled-public with ACK_RIGHTS_HOLDER is public', () => {
  const a = port('q2', 'bundled-public', { acks: [{ id: 'ACK_RIGHTS_HOLDER', at: '2026-11-17T00:00:00Z' }] });
  const b = port('q3', 'bundled-public', { data: { redistributable: true } });
  for (const r of [a, b]) { assert.equal(sh('git add game/', r).deny, false); assert.equal(sh('vercel --prod', r).deny, false); }
});

test('write tool to port.json is denied', () => {
  const root = port('q4');
  assert.equal(checkToolUse({ tool: 'write', path: path.join(root, 'port.json'), cwd: base }).code, 'PORT_JSON_WRITE');
  assert.equal(checkToolUse({ tool: 'write', path: 'port.json', cwd: root }).deny, true);
  assert.equal(sh('echo {} > port.json', root).deny, true);
  assert.equal(sh('sed -i s/byo/bundled-public/ port.json', root).deny, true);
  assert.equal(sh('cat port.json', root).deny, false);
});

test('refuse words only as commands or executable-like tokens', () => {
  const heredoc = 'git commit -m "$(cat <<\'EOF\'\nfix: say "no" to crack loaders and steamless\nEOF\n)"';
  for (const c of ['grep -rn crack docs', 'cat UNLICENSE', 'ls /home/jane.goldberg/project', 'git add docs/crack-notes.md',
    'gh pr create --title "guard" --body "refuses crack loaders and steamless"', 'git commit -m "fix: refuse steamless"', heredoc]) {
    assert.equal(sh(c, base).deny, false, c);
  }
  for (const c of ['crack game.exe', 'goldberg.exe', 'python unlicense.py a.exe', 'copy crack\\loader.exe .', 'run nocd.exe', 'wine no-cd.exe', 'steamless', 'bash -ec "steamless.exe x"']) {
    assert.equal(sh(c, base).code, 'CIRCUMVENTION', c);
  }
});

test('expands ~, $HOME and %USERPROFILE%', () => {
  const home = path.join(base, 'home');
  const root = path.join(home, 'ports', 'p8');
  for (const d of ['game', 'lane']) mkdirSync(path.join(root, d), { recursive: true });
  writeFileSync(path.join(root, 'port.json'), JSON.stringify({ schema: 'port-any-game/port@1', data: { mode: 'byo' } }));
  env('HOME', home, () => env('USERPROFILE', home, () => {
    for (const c of ['git -C ~/ports/p8 add game', 'cd ~/ports/p8 && git add game', 'rm -rf ~/ports/p8/game', 'rm -rf $HOME/ports/p8/game', 'rm -rf %USERPROFILE%/ports/p8/game', 'wrangler deploy ~/ports/p8/build']) {
      assert.equal(sh(c, base).deny, true, c);
    }
    assert.equal(sh('git -C ~/ports/p8 add lane', base).deny, false);
  }));
});

test('antigravity and opencode v2 writes are normalised and checked', async () => {
  const { normalizeEvent } = await import('../skills/port-any-game/scripts/guard.mjs');
  const root = port('q5');
  for (const name of ['write_to_file', 'replace_file_content', 'multi_replace_file_content']) {
    const ev = normalizeEvent({ toolCall: { name, args: { TargetFile: path.join(root, 'game', 'x') } } });
    assert.equal(ev.tool, 'write', name);
    assert.equal(checkToolUse(ev).deny, true, name);
  }
  const oc = normalizeEvent({ action: 'edit', resources: [path.join(root, 'lane', 'a'), path.join(root, 'game', 'x')] });
  assert.equal(oc.paths.length, 2);
  assert.equal(normalizeEvent({ cwd: '/top', tool_name: 'Shell', tool_input: { command: 'ls', working_directory: '/tool' } }).cwd, '/tool');
});

test('deploy targets are found from args, not just cwd', () => {
  const root = port('q6');
  const R = fwd(root);
  for (const c of [`npx wrangler pages deploy ${R}/build --project-name x`, `netlify deploy --prod --dir=${R}/build`]) assert.equal(sh(c, base).deny, true, c);
  for (const c of ['npm exec -- wrangler deploy', 'yarn wrangler pages deploy build', 'pnpm wrangler pages deploy build', 'bun x wrangler deploy', 'npm run deploy', 'vercel', 'vercel --prod']) {
    assert.equal(sh(c, root).deny, true, c);
  }
  for (const c of ['vercel dev', 'vercel env pull', 'vercel login', 'npm run build', 'npm test']) assert.equal(sh(c, root).deny, false, c);
  assert.equal(sh('npm run deploy', base).deny, false);
});

test('shell writers into game/ and cd-tracked redirects', () => {
  const root = port('q7');
  const inRoot = ['Copy-Item work\\a.bin game\\a.bin', 'Copy-Item -Destination game\\a.bin -Path work\\a.bin', 'cpi a game/b', 'cd game && echo x > a.txt',
    'tar -xf x.tar -C game', 'unzip x.zip -d game', 'Expand-Archive x.zip -DestinationPath game', 'curl -o game/a.bin https://example.com/a', 'wget -O game/a.bin https://example.com/a',
    'Invoke-WebRequest https://example.com/a -OutFile game/a.bin', 'bash -ec "rm -rf game"', 'powershell -Command "& { Remove-Item game\\a }"'];
  for (const c of inRoot) assert.equal(sh(c, root).deny, true, c);
  assert.equal(sh(`cd ${fwd(root)} && echo x > game/a.txt`, base).deny, true);
  assert.equal(sh('tar -xf game/x.tar -C work', root).deny, false);
  assert.equal(sh('curl -o work/a.bin https://example.com/a', root).deny, false);
});

test('git add . is denied when game/ is not ignored, allowed when gitignored', { skip: !hasGit }, () => {
  const root = port('q8');
  git(root, 'init', '-q');
  writeFileSync(path.join(root, 'game', 'd.bin'), 'x');
  writeFileSync(path.join(root, 'lane', 'a.mjs'), 'x');
  assert.equal(sh('git add .', root).deny, true, 'game/ not ignored');
  assert.equal(sh('git add -A', root).deny, true);
  assert.equal(sh('git add -A lane/', root).deny, false, 'pathspec limits -A');
  assert.equal(sh('git commit -a -m x', root).deny, false, 'nothing tracked under game/');
  writeFileSync(path.join(root, '.gitignore'), 'game/\nwork/\nbuild/\n');
  assert.equal(sh('git add .', root).deny, false, 'game/ is gitignored');
  assert.equal(sh('git add -A', root).deny, false);
  assert.equal(sh('git add game/d.bin', root).deny, true, 'explicit path still denied');
  git(root, 'add', '-f', 'game/d.bin');
  assert.equal(sh('git commit -m x', root).deny, true, 'staged game file');
});
