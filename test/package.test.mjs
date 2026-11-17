import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = mkdtempSync(path.join(tmpdir(), 'pag-package-'));
after(() => rmSync(base, { recursive: true, force: true }));

const { packagePortable, run } = await import('../skills/port-any-game/scripts/package.mjs');
const { stablePort } = await import('../skills/port-any-game/scripts/serve.mjs');
const { listZip } = await import('../skills/port-any-game/scripts/lib/archive.mjs');

let n = 0;
// A finished port: port.json plus a hand-made dist/ shaped like pack output.
function makePort({ mode = 'byo', coi = true, lane = 'lane-test', dist = true } = {}) {
  const dir = path.join(base, `port-${++n}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'port.json'), JSON.stringify({ id: `test-game-${n}`, name: 'Test Game', lane, data: { mode } }));
  if (dist) {
    const d = path.join(dir, 'dist');
    mkdirSync(path.join(d, 'game'), { recursive: true });
    writeFileSync(path.join(d, 'index.html'), '<h1>hi</h1>');
    writeFileSync(path.join(d, 'ten.bin'), '0123456789');
    writeFileSync(path.join(d, 'game', 'level.dat'), 'bytes');
    writeFileSync(path.join(d, 'shell.json'), JSON.stringify({ needs_coi: coi, data: { mode } }));
    writeFileSync(path.join(d, '_headers'), `/*\n${coi ? '  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n' : ''}  Cache-Control: no-cache\n`);
  }
  return dir;
}
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
// fetch() normalises dot segments before sending, so traversal needs a raw request.
const rawStatus = (port, p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { r.resume(); res(r.statusCode); }).on('error', rej));
const io = () => { const o = { out: '', err: '' }; return { o, io: { out: (t) => (o.out += t), err: (t) => (o.err += t) } }; };

test('stablePort is deterministic and in range', () => {
  assert.equal(stablePort('abc'), stablePort('abc'));
  for (const id of ['a', 'abc', 'zzz'.repeat(50)]) assert.ok(stablePort(id) >= 20000 && stablePort(id) <= 29999);
});

test('package writes launchers and zip', async () => {
  const dir = makePort();
  const id = `test-game-${n}`;
  const r = await packagePortable(dir);
  assert.equal(r.dir, path.join(dir, 'package', `${id}-portable`));
  assert.equal(r.zipPath, path.join(dir, 'package', `${id}.zip`));
  for (const f of ['Play-Windows.bat', 'Play-macOS.command', 'Play-Linux.sh', 'serve-windows.ps1', 'serve-standalone.mjs', 'launch.json', 'headers.json', 'README.txt', 'dist/index.html', 'dist/game/level.dat']) assert.ok(existsSync(path.join(r.dir, f)), f);
  assert.deepEqual(JSON.parse(readFileSync(path.join(r.dir, 'launch.json'), 'utf8')), { port: stablePort(id), needs_coi: true });
  const hj = JSON.parse(readFileSync(path.join(r.dir, 'headers.json'), 'utf8'));
  assert.deepEqual(hj, [{ pattern: '/*', headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-cache' } }]);
  assert.equal(readFileSync(path.join(r.dir, 'Play-Windows.bat'), 'utf8'), '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-windows.ps1"\r\n');
  assert.ok(!readFileSync(path.join(r.dir, 'Play-Linux.sh'), 'utf8').includes('\r'), 'LF in sh');
  assert.match(readFileSync(path.join(r.dir, 'Play-Linux.sh'), 'utf8'), /^#!\/bin\/sh\n/);
  const names = listZip(readFileSync(r.zipPath)).map((e) => e.name);
  for (const f of ['Play-Windows.bat', 'serve-standalone.mjs', 'launch.json', 'dist/index.html', 'dist/game/level.dat']) assert.ok(names.includes(`${id}-portable/${f}`), f);
});

test('zip keeps 0755 on .command and .sh', async () => {
  const r = await packagePortable(makePort());
  const mode = (name) => (listZip(readFileSync(r.zipPath)).find((e) => e.name.endsWith(`/${name}`)).attr >>> 16) & 0o777;
  assert.equal(mode('Play-macOS.command'), 0o755);
  assert.equal(mode('Play-Linux.sh'), 0o755);
  assert.equal(mode('Play-Windows.bat'), 0o644);
});

test('prints private warning for bundled, not for byo or bundled-public', async () => {
  const W = 'Private copy: contains your game files. Do not share publicly.';
  for (const [mode, warns] of [['bundled', true], ['byo', false], ['bundled-public', false]]) {
    const { o, io: i } = io();
    assert.equal(await run([makePort({ mode })], i), 0, o.err);
    assert.equal(o.out.includes(W), warns, mode);
  }
  const dir = makePort({ mode: 'byo' });
  const r = await packagePortable(dir);
  assert.match(readFileSync(path.join(r.dir, 'README.txt'), 'utf8'), /import your own/);
});

test('package refuses known-port and a missing dist', async () => {
  let { o, io: i } = io();
  assert.equal(await run([makePort({ lane: 'known-port', dist: false })], i), 1);
  assert.match(o.err, /existing web port; there is nothing to package/);
  ({ o, io: i } = io());
  assert.equal(await run([makePort({ dist: false })], i), 1);
  assert.match(o.err, /no dist\/: run `pag pack` first/);
});

// Spawn a launcher server and wait for its "Playing at" line.
function launch(cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, PAG_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => { clearInterval(check); reject(new Error(`launcher not ready: ${out}`)); }, 20000);
    const check = setInterval(() => { if (/Playing at/.test(out)) { clearTimeout(t); clearInterval(check); resolve(); } }, 50);
    child.once('exit', () => { clearTimeout(t); clearInterval(check); reject(new Error(`launcher exited early: ${out}`)); });
  });
  return { child, ready };
}
const withPort = async (r) => {
  const port = await freePort();
  writeFileSync(path.join(r.dir, 'launch.json'), JSON.stringify({ port, needs_coi: true }));
  return port;
};

test('serve-standalone serves with COOP/COEP, noindex, Range, and refuses traversal', async () => {
  const r = await packagePortable(makePort());
  const port = await withPort(r);
  const l = launch(process.execPath, ['serve-standalone.mjs'], r.dir);
  try {
    await l.ready;
    const u = `http://127.0.0.1:${port}`;
    const res = await fetch(u + '/');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '<h1>hi</h1>');
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    const rg = await fetch(u + '/ten.bin', { headers: { Range: 'bytes=2-4' } });
    assert.equal(rg.status, 206);
    assert.equal(await rg.text(), '234');
    assert.equal(rg.headers.get('content-range'), 'bytes 2-4/10');
    assert.equal((await fetch(u + '/ten.bin', { headers: { Range: 'bytes=50-' } })).status, 416);
    assert.equal((await fetch(u + '/game/')).status, 404, 'no directory listing');
    assert.equal(await rawStatus(port, '/%2e%2e/launch.json'), 400, 'traversal');
    assert.equal(await rawStatus(port, '/..%5Claunch.json'), 400, 'backslash traversal');
    assert.equal((await fetch(u + '/launch.json')).status, 404, 'only dist/ is served');
  } finally { l.child.kill(); }
});

test('launcher with the port already in use assumes the game is running and exits 0', async () => {
  const r = await packagePortable(makePort());
  const port = await withPort(r);
  const blocker = net.createServer().listen(port, '127.0.0.1');
  await new Promise((res) => blocker.once('listening', res));
  try {
    const p = spawnSync(process.execPath, ['serve-standalone.mjs'], { cwd: r.dir, env: { ...process.env, PAG_NO_OPEN: '1' }, encoding: 'utf8', timeout: 20000 });
    assert.equal(p.status, 0, p.stderr);
    assert.match(p.stdout, /already running/);
  } finally { await new Promise((res) => blocker.close(res)); }
});

test('Windows launcher serves headers', { skip: process.platform !== 'win32' && 'windows only' }, async () => {
  const r = await packagePortable(makePort());
  const port = await withPort(r);
  const l = launch('cmd.exe', ['/d', '/c', path.join(r.dir, 'Play-Windows.bat')], r.dir);
  try {
    await l.ready;
    const u = `http://127.0.0.1:${port}`;
    const res = await fetch(u + '/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
    const rg = await fetch(u + '/ten.bin', { headers: { Range: 'bytes=2-4' } });
    assert.equal(rg.status, 206);
    assert.equal(await rg.text(), '234');
    assert.ok([400, 403, 404].includes(await rawStatus(port, '/%2e%2e/launch.json')), '/%2e%2e/launch.json refused (HttpListener may answer before our code)');
    assert.ok([400, 403, 404].includes(await rawStatus(port, '/..%5Claunch.json')), '/..%5Claunch.json refused (HttpListener may answer before our code)');
    assert.ok([400, 403, 404].includes(await rawStatus(port, '/../launch.json')), '/../launch.json refused (HttpListener may answer before our code)');
    assert.equal((await fetch(u + '/game/')).status, 404);
  } finally {
    spawnSync('taskkill', ['/PID', String(l.child.pid), '/T', '/F']);
    await new Promise((res) => setTimeout(res, 500));
    const still = await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false);
    assert.equal(still, false, 'no powershell left serving');
  }
});
