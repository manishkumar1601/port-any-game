import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const r = await fetch(url + '/');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '<h1>hi</h1>');
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

test('cli: usage and policy refusals', async () => {
  const io = () => { const o = { text: '' }; return [o, { out: (t) => (o.text += t), err: (t) => (o.text += t) }]; };
  let [o, i] = io();
  assert.equal(await run([path.join(base, 'missing')], i), 2);
  [o, i] = io();
  delete process.env.PAG_TEST_PW;
  assert.equal(await run([root, '--lan', '--password-env', 'PAG_TEST_PW'], i), 4);
  assert.match(o.text, /--password/);
  [o, i] = io();
  assert.equal(await run([root, '--port', 'x'], i), 2);
});
