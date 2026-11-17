import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = mkdtempSync(path.join(tmpdir(), 'pag-pack-'));
process.env.PAG_CACHE = path.join(base, 'cache'); // never the real home or tool cache
process.env.PAG_HOME = path.join(base, 'home');
after(() => rmSync(base, { recursive: true, force: true }));

const { pack, headersFor, run } = await import('../skills/port-any-game/scripts/pack.mjs');
const { run: runBuild } = await import('../skills/port-any-game/scripts/build.mjs');
const { toolDir } = await import('../skills/port-any-game/scripts/setup.mjs');
const { startServer, parseHeadersFile } = await import('../skills/port-any-game/scripts/serve.mjs');

const ADAPTER = fileURLToPath(new URL('./fixtures/lane-test/adapter.js', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');

const LOCK = { 'fake-rt': { name: 'fake-rt', version: '1.2.3', license: 'GPL-2.0', source: 'https://example.invalid/fake-rt', licenseFile: 'COPYING' } };
const tool = toolDir(LOCK['fake-rt']);
mkdirSync(path.join(tool, 'sub'), { recursive: true });
writeFileSync(path.join(tool, 'runtime.js'), 'export const rt = 1;\n');
writeFileSync(path.join(tool, 'sub', 'runtime.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
writeFileSync(path.join(tool, 'COPYING'), 'GNU GENERAL PUBLIC LICENSE Version 2 (fake text)\n');
writeFileSync(path.join(tool, '.ok'), '');

const lane = (over = {}) => ({
  id: 'lane-test', dataModes: ['byo', 'bundled'], adapter: ADAPTER, runtime: { tool: 'fake-rt' },
  shell: () => ({ verify: { inputs: ['ArrowRight'], audio_on_title: true }, lane_config: { exe: 'GAME.EXE' }, input: { mouse: 'none' } }),
  ...over,
});
const opts = (o = {}) => ({ laneModule: lane(), lock: LOCK, ...o });

let n = 0;
function makePort({ mode = 'byo', acks = [], redistributable, laneId = 'lane-test' } = {}) {
  const dir = path.join(base, `port-${++n}`);
  const game = {
    'GAME.EXE': Buffer.concat([Buffer.from('MZ'), randomBytes(4094)]),
    'data/level1.dat': randomBytes(3000),
    'data/Music.ogg': randomBytes(2048),
  };
  for (const [rel, data] of Object.entries(game)) {
    mkdirSync(path.dirname(path.join(dir, 'game', rel)), { recursive: true });
    writeFileSync(path.join(dir, 'game', rel), data);
  }
  writeFileSync(path.join(dir, 'game', 'Thumbs.db'), 'os junk');
  const port = { schema: 'port-any-game/port@1', id: `test-game-${n}`, name: 'Test Game', lane: laneId,
    data: { mode, ...(redistributable ? { redistributable: true } : {}) }, tools: {}, acks, created_at: '2026-11-17T00:00:00Z' };
  writeFileSync(path.join(dir, 'port.json'), JSON.stringify(port, null, 2));
  return { dir, game, port };
}

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p); else yield p;
  }
}
const io = () => { const o = { out: '', err: '' }; return { o, io: { out: (t) => (o.out += t), err: (t) => (o.err += t) } }; };

test('pack writes shell, manifest, _headers, robots, LICENSES', async () => {
  const { dir, game, port } = makePort();
  const { distDir, shell } = await pack(dir, opts());
  assert.equal(distDir, path.join(dir, 'dist'));
  const d = (...p) => path.join(distDir, ...p);

  for (const f of ['index.html', 'shell/shell.js', 'shell/shell.css', 'shell/import.js', 'shell/storage.js', 'shell/input.js', 'shell/audio.js', 'shell/zip.js', 'shell/pure.js']) assert.ok(existsSync(d(f)), f);
  const html = readFileSync(d('index.html'), 'utf8');
  for (const tag of html.match(/<script\b[^>]*>/g)) assert.match(tag, /\bsrc=/, 'no inline scripts (CSP)');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers (CSP)');
  assert.doesNotMatch(html + readFileSync(d('shell/shell.css'), 'utf8'), /https?:\/\//, 'no third-party URLs');

  assert.deepEqual(JSON.parse(readFileSync(d('shell.json'), 'utf8')), shell);
  assert.equal(shell.schema, 1);
  assert.equal(shell.game_id, port.id);
  assert.equal(shell.lane, 'lane-test');
  assert.deepEqual(shell.entry, { adapter: 'runtime/lane-test/adapter.js' });
  assert.deepEqual(shell.data, { mode: 'byo', manifest: 'game/manifest.json', mount: '/game', saves: `/saves/${port.id}` });
  assert.equal(shell.needs_coi, false);
  assert.deepEqual(shell.verify.inputs, ['ArrowRight']);
  assert.equal(shell.verify.audio_on_title, true);
  assert.equal(typeof shell.verify.target_fps, 'number');
  assert.equal(shell.input.mouse, 'none');
  assert.equal(shell.input.keyboard, true, 'lane contribution merges into defaults');
  assert.deepEqual(shell.lane_config, { exe: 'GAME.EXE' });
  for (const k of ['webgl2', 'webgpu', 'threads', 'simd', 'jspi']) assert.equal(typeof shell.requires[k], 'boolean', k);

  assert.deepEqual(readFileSync(d('runtime/lane-test/adapter.js')), readFileSync(ADAPTER));
  assert.equal(readFileSync(d('runtime/lane-test/runtime.js'), 'utf8'), 'export const rt = 1;\n');
  assert.ok(existsSync(d('runtime/lane-test/sub/runtime.wasm')));
  assert.ok(!existsSync(d('runtime/lane-test/.ok')));

  const m = JSON.parse(readFileSync(d('game/manifest.json'), 'utf8'));
  assert.equal(m.source, 'game');
  assert.match(m.version, /^[0-9a-f]{64}$/);
  assert.deepEqual(m.files, Object.keys(game).sort().map((p) => ({ path: p, size: game[p].length, sha256: sha(game[p]) })), 'sorted, OS junk skipped');
  assert.equal(m.total_bytes, Object.values(game).reduce((s, b) => s + b.length, 0));

  assert.equal(readFileSync(d('_headers'), 'utf8'), headersFor(shell));
  assert.equal(readFileSync(d('robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
  const lic = readFileSync(d('LICENSES', 'fake-rt.txt'), 'utf8');
  for (const s of ['fake-rt', '1.2.3', 'License: GPL-2.0', 'Source: https://example.invalid/fake-rt', 'GNU GENERAL PUBLIC LICENSE Version 2 (fake text)']) assert.ok(lic.includes(s), s);
  assert.match(lic, /complete corresponding source.*https:\/\/example\.invalid\/fake-rt.*1\.2\.3/is);
  assert.match(readFileSync(d('LICENSES', 'port-any-game-shell.txt'), 'utf8'), /MIT License[\s\S]*Permission is hereby granted/);

  const srv = await startServer({ root: distDir, log: () => {} });
  try {
    const r = await fetch(`${srv.url}/index.html`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.equal(r.headers.get('cross-origin-embedder-policy'), null);
    assert.equal((await fetch(`${srv.url}/shell/shell.js`)).status, 200);
  } finally { await srv.close(); }
});

test('byo pack contains no game bytes', async () => {
  const { dir, game } = makePort();
  const bundled = await pack(dir, opts({ mode: 'bundled' }));
  assert.equal(bundled.shell.data.mode, 'bundled');
  for (const [rel, data] of Object.entries(game)) assert.deepEqual(readFileSync(path.join(bundled.distDir, 'game', rel)), data, `bundled copies ${rel}`);

  const { distDir, shell } = await pack(dir, opts()); // re-pack as byo over the bundled dist
  assert.equal(shell.data.mode, 'byo');
  assert.deepEqual(readdirSync(path.join(distDir, 'game')), ['manifest.json']);
  const blobs = [...files(distDir)].map((f) => [f, readFileSync(f)]);
  for (const [rel, data] of Object.entries(game)) {
    for (const [f, b] of blobs) assert.ok(!b.includes(data), `${rel} bytes found in ${path.relative(distDir, f)}`);
  }
});

test('bundled-public refused without ACK_RIGHTS_HOLDER', async () => {
  const noAck = makePort({ mode: 'bundled-public' });
  await assert.rejects(pack(noAck.dir, opts()), (e) => e.code === 'PUBLIC_BUNDLED');
  assert.ok(!existsSync(path.join(noAck.dir, 'dist')), 'nothing written on refusal');

  const byo = makePort();
  await assert.rejects(pack(byo.dir, opts({ mode: 'bundled-public' })), (e) => e.code === 'PUBLIC_BUNDLED', 'a mode argument cannot unlock it');
  const { o, io: cli } = io();
  assert.equal(await run([noAck.dir], cli, { lock: LOCK }), 4, 'policy refusal exits 4 before the lane is looked up');
  assert.match(o.err, /bundled-public|ACK_RIGHTS_HOLDER/);

  const acked = makePort({ mode: 'bundled-public', acks: [{ id: 'ACK_RIGHTS_HOLDER', at: '2026-11-17T00:00:00Z' }] });
  const r1 = await pack(acked.dir, opts());
  assert.equal(r1.shell.data.mode, 'bundled-public');
  assert.deepEqual(readFileSync(path.join(r1.distDir, 'game', 'GAME.EXE')), acked.game['GAME.EXE']);

  const redist = makePort({ mode: 'bundled-public', redistributable: true });
  assert.equal((await pack(redist.dir, opts())).shell.data.mode, 'bundled-public');
});

test('pack CLI: data mode outside the lane, missing adapter, missing runtime tool', async () => {
  const ruffle = makePort({ laneId: 'rt-ruffle' });
  let c = io();
  assert.equal(await run([ruffle.dir, '--mode', 'bundled'], c.io), 2);
  assert.match(c.o.err, /rt-ruffle.*byo/);
  c = io();
  assert.equal(await run([ruffle.dir, '--mode', 'nonsense'], c.io), 2);

  const p = makePort();
  c = io();
  assert.equal(await run([p.dir], c.io, { lock: LOCK, laneModule: lane({ adapter: path.join(base, 'nope', 'adapter.js') }) }), 1);
  assert.match(c.o.err, /lane-test has no browser adapter yet/);

  c = io();
  assert.equal(await run([p.dir], c.io, { lock: {}, laneModule: lane() }), 1);
  assert.match(c.o.err, /fake-rt/);
  const missingTool = { 'fake-rt': { ...LOCK['fake-rt'], version: '9.9.9' } };
  c = io();
  assert.equal(await run([p.dir], c.io, { lock: missingTool, laneModule: lane() }), 1);
  assert.match(c.o.err, /pag setup/);

  c = io();
  assert.equal(await run([path.join(base, 'not-a-port')], c.io), 2);
  c = io();
  assert.equal(await run([p.dir], c.io, opts()), 0);
  assert.match(c.o.out, /dist/);
});

test('headersFor adds COOP/COEP only when needs_coi', () => {
  const plain = headersFor({ needs_coi: false });
  const coi = headersFor({ needs_coi: true });
  assert.doesNotMatch(plain, /Cross-Origin-Opener-Policy|Cross-Origin-Embedder-Policy/);
  assert.match(coi, /^ {2}Cross-Origin-Opener-Policy: same-origin$/m);
  assert.match(coi, /^ {2}Cross-Origin-Embedder-Policy: require-corp$/m);
  for (const h of [plain, coi]) {
    assert.doesNotMatch(h, /credentialless/);
    const rules = Object.fromEntries(parseHeadersFile(h).map((r) => [r.pattern, r.headers]));
    assert.deepEqual(Object.keys(rules), ['/*', '/index.html', '/shell.json', '/game/manifest.json', '/runtime/*']);
    assert.equal(rules['/*']['Cross-Origin-Resource-Policy'], 'same-origin');
    assert.equal(rules['/*']['Content-Security-Policy'], "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'");
    assert.equal(rules['/*']['X-Content-Type-Options'], 'nosniff');
    assert.equal(rules['/*']['Referrer-Policy'], 'no-referrer');
    assert.equal(rules['/*']['X-Robots-Tag'], 'noindex, nofollow');
    for (const p of ['/index.html', '/shell.json', '/game/manifest.json']) assert.deepEqual(rules[p], { 'Cache-Control': 'no-cache' });
    assert.deepEqual(rules['/runtime/*'], { 'Cache-Control': 'public, max-age=31536000, immutable' });
  }
  assert.equal(headersFor({ requires: { threads: true } }), plain, 'only needs_coi decides');
});

test('manifest version changes when a file changes', async () => {
  const { dir } = makePort();
  const v = async () => JSON.parse(readFileSync(path.join((await pack(dir, opts())).distDir, 'game', 'manifest.json'), 'utf8'));
  const a = await v();
  assert.equal((await v()).version, a.version, 'deterministic');
  const f = path.join(dir, 'game', 'data', 'level1.dat');
  const b = readFileSync(f); b[100] ^= 0xff; writeFileSync(f, b); // same size, new content
  const c = await v();
  assert.notEqual(c.version, a.version);
  assert.equal(c.files.find((e) => e.path === 'data/level1.dat').sha256, sha(b));
});

test('pack prefers build/game, copies only listed runtime files, needs_coi follows threads', async () => {
  const { dir } = makePort();
  mkdirSync(path.join(dir, 'build', 'game'), { recursive: true });
  writeFileSync(path.join(dir, 'build', 'game', 'index.html'), '<p>built</p>');
  const laneModule = lane({ runtime: { tool: 'fake-rt', files: ['runtime.js'] }, shell: () => ({ requires: { threads: true } }) });
  const { distDir, shell } = await pack(dir, opts({ laneModule, mode: 'bundled' }));
  const m = JSON.parse(readFileSync(path.join(distDir, 'game', 'manifest.json'), 'utf8'));
  assert.equal(m.source, 'build/game');
  assert.deepEqual(m.files.map((e) => e.path), ['index.html']);
  assert.equal(readFileSync(path.join(distDir, 'game', 'index.html'), 'utf8'), '<p>built</p>');
  assert.ok(!existsSync(path.join(distDir, 'game', 'GAME.EXE')));
  assert.ok(existsSync(path.join(distDir, 'runtime', 'lane-test', 'runtime.js')));
  assert.ok(!existsSync(path.join(distDir, 'runtime', 'lane-test', 'sub')));
  assert.equal(shell.needs_coi, true);
  assert.match(readFileSync(path.join(distDir, '_headers'), 'utf8'), /Cross-Origin-Embedder-Policy: require-corp/);
  assert.ok(statSync(path.join(distDir, 'LICENSES', 'fake-rt.txt')).size > 0);
});

test('pag build dispatches to the lane build or explains it has none', async () => {
  const p = makePort();
  let c = io();
  assert.equal(await runBuild([p.dir], c.io, { laneModule: lane() }), 1);
  assert.match(c.o.err, /lane lane-test has no build step yet/);
  const calls = [];
  c = io();
  assert.equal(await runBuild([p.dir], c.io, { laneModule: lane({ build: async (d) => (calls.push(d), { ok: 1 }) }) }), 0);
  assert.deepEqual(calls, [path.resolve(p.dir)]);
  c = io();
  assert.equal(await runBuild([path.join(base, 'not-a-port')], c.io), 2);
});
