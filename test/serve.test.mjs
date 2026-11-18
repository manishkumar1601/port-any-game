import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer, parseHeadersFile, run } from '../skills/port-any-game/scripts/serve.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-serve-'));
after(() => rmSync(base, { recursive: true, force: true }));

const root = path.join(base, 'dist');
const fix = path.join(base, 'fx');
for (const d of [root, path.join(root, 'data'), path.join(root, 'empty'), path.join(root, 'u'), fix]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(base, 'secret.txt'), 'SECRET');
writeFileSync(path.join(root, 'index.html'), '<h1>hi</h1>');
writeFileSync(path.join(root, 'a.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
writeFileSync(path.join(root, 'ten.bin'), '0123456789');
writeFileSync(path.join(root, 'data', 'file.bin'), 'case');
writeFileSync(path.join(root, 'u', 'héllo wörld ☃.txt'), 'unicode');
writeFileSync(path.join(root, '_headers'), '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n/ten.bin\n  X-Extra: yes\n');
writeFileSync(path.join(fix, 'f.txt'), 'fixture');

async function serving(opts, fn) {
  const s = await startServer({ root, log: () => {}, ...opts });
  try { await fn(s.url); } finally { await s.close(); }
}
const raw = (url, p) => new Promise((resolve, reject) => {
  const u = new URL(url);
  http.get({ host: u.hostname, port: u.port, path: p }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => resolve({ status: r.statusCode, body: b })); }).on('error', reject);
});

test('binds 127.0.0.1 by default', async () => serving({}, async (url) => {
  const s = await startServer({ root, log: () => {} });
  try { assert.equal(s.address, '127.0.0.1'); } finally { await s.close(); }
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const r = await fetch(url + '/');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>hi</h1>');
}));

// M6: loopback serving answers 421 to any Host but this server's own loopback names (DNS rebinding); --lan does not.
const hostStatus = (url, host) => new Promise((resolve, reject) => {
  const u = new URL(url);
  http.get({ host: u.hostname, port: u.port, path: '/', headers: { Host: host } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
});
test('loopback serving refuses a foreign Host header with 421', async () => serving({}, async (url) => {
  const p = Number(new URL(url).port);
  assert.equal(await hostStatus(url, `evil.example:${p}`), 421);
  assert.equal(await hostStatus(url, `127.0.0.1:${p + 1}`), 421, 'another port');
  for (const h of [`127.0.0.1:${p}`, `localhost:${p}`, `LocalHost:${p}`, `[::1]:${p}`]) assert.equal(await hostStatus(url, h), 200, h);
  const lan = await startServer({ root, host: '0.0.0.0', log: () => {} });
  try { assert.equal(await hostStatus(lan.url, 'my-pc.local'), 200, 'a LAN server is reached by other names'); } finally { await lan.close(); }
}));

test('parseHeadersFile reads Netlify format', () => {
  assert.deepEqual(parseHeadersFile('# c\n/*\n  A: 1\n  B: x:y\n/p\n  C: 2\n'), [
    { pattern: '/*', headers: { A: '1', B: 'x:y' } }, { pattern: '/p', headers: { C: '2' } }]);
});

test('applies _headers incl COOP/COEP', async () => serving({}, async (url) => {
  const r = await fetch(url + '/ten.bin');
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(r.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(r.headers.get('x-extra'), 'yes');
  assert.equal((await fetch(url + '/a.wasm')).headers.get('x-extra'), null);
}));

test('noindex on every response', async () => serving({}, async (url) => {
  for (const [p, st] of [['/', 200], ['/nope', 404], ['/ten.bin', 200]]) {
    const r = await fetch(url + p);
    assert.equal(r.status, st);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  const m = await fetch(url + '/', { method: 'POST' });
  assert.equal(m.status, 405);
  assert.equal(m.headers.get('x-robots-tag'), 'noindex, nofollow');
  const r416 = await fetch(url + '/ten.bin', { headers: { range: 'bytes=50-' } });
  assert.equal(r416.status, 416);
  assert.equal(r416.headers.get('x-robots-tag'), 'noindex, nofollow');
}));

test('wasm MIME', async () => serving({}, async (url) => {
  assert.equal((await fetch(url + '/a.wasm')).headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(url + '/ten.bin')).headers.get('content-type'), 'application/octet-stream');
}));

test('range 206 and 416', async () => serving({}, async (url) => {
  const r = await fetch(url + '/ten.bin', { headers: { range: 'bytes=2-4' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 2-4/10');
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.equal(await r.text(), '234');
  const suf = await fetch(url + '/ten.bin', { headers: { range: 'bytes=-3' } });
  assert.equal(await suf.text(), '789');
  const open = await fetch(url + '/ten.bin', { headers: { range: 'bytes=8-' } });
  assert.equal(await open.text(), '89');
  const bad = await fetch(url + '/ten.bin', { headers: { range: 'bytes=10-20' } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('content-range'), 'bytes */10');
  await bad.text();
  const head = await fetch(url + '/ten.bin', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), '10');
}));

test('no directory listing', async () => serving({}, async (url) => {
  assert.equal((await fetch(url + '/empty/')).status, 404);
  assert.equal((await fetch(url + '/data')).status, 404);
}));

test('rejects ../ traversal', async () => serving({}, async (url) => {
  for (const p of ['/../secret.txt', '/data/../../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt', '/data/%2E%2E/%2e%2e/secret.txt', '/a%00', '/..%5csecret.txt']) {
    const r = await raw(url, p);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.body.includes('SECRET'));
  }
}));

test('basic auth 401 then 200', async () => serving({ password: 'pw' }, async (url) => {
  const r = await fetch(url + '/');
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('www-authenticate'), 'Basic realm="port-any-game"');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  const auth = (pw) => ({ authorization: 'Basic ' + Buffer.from(`anyone:${pw}`).toString('base64') });
  assert.equal((await fetch(url + '/', { headers: auth('wrong') })).status, 401);
  assert.equal((await fetch(url + '/', { headers: auth('pw') })).status, 200);
}));

test('serves percent-encoded unicode names', async () => serving({}, async (url) => {
  const r = await fetch(url + '/u/' + encodeURIComponent('héllo wörld ☃.txt'));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'unicode');
}));

test('case-insensitive fallback for bundled', async () => {
  const logs = [];
  await serving({ caseFallback: true, log: (m) => logs.push(m) }, async (url) => {
    const r = await fetch(url + '/Data/FILE.BIN');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'case');
  });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^case-fallback: \/Data\/FILE\.BIN -> /);
  await serving({ caseFallback: false }, async (url) => assert.equal((await fetch(url + '/Data/FILE.BIN')).status, 404));
});

test('fixture mount', async () => serving({ fixtureDir: fix }, async (url) => {
  const r = await fetch(url + '/__fixture/f.txt');
  assert.equal(await r.text(), 'fixture');
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.ok([400, 404].includes((await raw(url, '/__fixture/%2e%2e/dist/index.html')).status));
  assert.equal((await fetch(url + '/f.txt')).status, 404);
}));

test('fixtureIndex is served beside the mount at /__fixture.index.json, never shadowing a game file (R34)', async () => {
  const index = [{ path: 'f.txt', size: 7 }, { path: 'index.json', size: 14 }];
  writeFileSync(path.join(fix, 'index.json'), '{"game":true}\n'); // a game's own top-level index.json
  try {
    await serving({ fixtureDir: fix, fixtureIndex: index }, async (url) => {
      const r = await fetch(url + '/__fixture.index.json');
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /^application\/json/);
      assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
      assert.deepEqual(await r.json(), index);
      assert.equal(await (await fetch(url + '/__fixture/index.json')).text(), '{"game":true}\n', 'the game file is not shadowed');
      assert.equal((await fetch(url + '/__fixture/f.txt')).status, 200);
    });
    await serving({ fixtureDir: fix }, async (url) => assert.equal((await fetch(url + '/__fixture.index.json')).status, 404));
  } finally { rmSync(path.join(fix, 'index.json')); }
});

test('cli: usage and policy refusals', async () => {
  const io = () => { const o = { text: '' }; return [o, { out: (t) => (o.text += t), err: (t) => (o.text += t) }]; };
  let [o, i] = io();
  assert.equal(await run([path.join(base, 'missing')], i), 2);
  [o, i] = io();
  delete process.env.PAG_TEST_PW;
  assert.equal(await run([root, '--lan', '--password-env', 'PAG_TEST_PW'], i), 4);
  assert.match(o.text, /--password-env/);
  [o, i] = io();
  assert.equal(await run([root, '--port', 'x'], i), 2);
});

test('_headers cannot override X-Robots-Tag', async () => {
  const d = path.join(base, 'robots'); mkdirSync(d);
  writeFileSync(path.join(d, 'index.html'), 'x');
  writeFileSync(path.join(d, '_headers'), '/*\n  X-Robots-Tag: all\n');
  const s = await startServer({ root: d, log: () => {} });
  try {
    for (const p of ['/', '/nope']) assert.equal((await fetch(s.url + p)).headers.get('x-robots-tag'), 'noindex, nofollow');
  } finally { await s.close(); }
});

test('aborted download releases the file handle', async () => {
  writeFileSync(path.join(root, 'big.bin'), Buffer.alloc(16 * 1024 * 1024));
  const open = fs.open, close = fs.close;
  let opened = 0, closed = 0;
  fs.open = (...a) => { if (String(a[0]).endsWith('big.bin')) opened++; return open.apply(fs, a); };
  fs.close = (...a) => { closed++; return close.apply(fs, a); };
  const s = await startServer({ root, log: () => {} });
  try {
    const u = new URL(s.url);
    await new Promise((resolve, reject) => {
      const req = http.get({ host: u.hostname, port: u.port, path: '/big.bin' }, (r) => r.once('data', () => { req.destroy(); resolve(); }));
      req.on('error', () => {});
    });
    const until = Date.now() + 5000;
    while (closed < opened && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    assert.equal(opened, 1);
    assert.equal(closed, opened);
  } finally { fs.open = open; fs.close = close; await s.close(); }
});

test('malformed _headers lines are skipped with a warning', async () => {
  const d = path.join(base, 'badhdr'); mkdirSync(d);
  writeFileSync(path.join(d, 'index.html'), 'x');
  writeFileSync(path.join(d, '_headers'), '/*\n  Bad Name: x\n  X-Good: ok\n');
  const logs = [];
  const s = await startServer({ root: d, log: (m) => logs.push(m) });
  try {
    const r = await fetch(s.url + '/');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('x-good'), 'ok');
    assert.match(logs.join('\n'), /invalid header/);
  } finally { await s.close(); }
});

test('symlink escaping the root is refused', async (t) => {
  const outside = path.join(base, 'outside'); mkdirSync(outside);
  writeFileSync(path.join(outside, 'o.txt'), 'SECRET');
  try { symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { return t.skip(`cannot create symlink: ${e.code}`); }
  await serving({}, async (url) => {
    const r = await fetch(url + '/link/o.txt');
    assert.equal(r.status, 404);
    assert.ok(!(await r.text()).includes('SECRET'));
  });
});

test('reversed range is ignored (200 full)', async () => serving({}, async (url) => {
  const r = await fetch(url + '/ten.bin', { headers: { range: 'bytes=5-2' } });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '0123456789');
}));

test('stablePort is deterministic and in 20000-29999', async () => {
  const { stablePort } = await import('../skills/port-any-game/scripts/serve.mjs');
  assert.equal(stablePort('some-game'), stablePort('some-game'));
  assert.notEqual(stablePort('some-game'), stablePort('other-game'));
  for (const id of ['a', 'b', 'c', 'dos-keen', 'x'.repeat(100)]) { const p = stablePort(id); assert.ok(Number.isInteger(p) && p >= 20000 && p <= 29999, id); }
});

test('cli: port in use gives a clear error and exit 1', async () => {
  const { stablePort } = await import('../skills/port-any-game/scripts/serve.mjs');
  const net = await import('node:net');
  const d = path.join(base, 'busy'); mkdirSync(path.join(d, 'dist'), { recursive: true });
  writeFileSync(path.join(d, 'port.json'), JSON.stringify({ id: 'busy-game' }));
  writeFileSync(path.join(d, 'dist', 'index.html'), 'x');
  const blocker = net.createServer();
  const listening = await new Promise((r) => blocker.once('error', () => r(false)).listen(stablePort('busy-game'), '127.0.0.1', () => r(true)));
  // when the stable port is already taken on this machine, that is exactly the condition under test
  try {
    let text = '';
    const code = await run([path.join(d, 'dist')], { out: (t) => (text += t), err: (t) => (text += t) });
    assert.equal(code, 1, text);
    assert.match(text, /port \d+ is in use \(another copy of this game may already be running\); pass --port/);
  } finally { if (listening) await new Promise((r) => blocker.close(r)); }
});
