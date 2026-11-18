import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = mkdtempSync(path.join(tmpdir(), 'pag-pack-'));
process.env.PAG_CACHE = path.join(base, 'cache'); // never the real home or tool cache
process.env.PAG_HOME = path.join(base, 'home');
after(() => rmSync(base, { recursive: true, force: true }));

const { pack, headersFor, run, checkGameNames } = await import('../skills/port-any-game/scripts/pack.mjs');
const { run: runBuild } = await import('../skills/port-any-game/scripts/build.mjs');
const { toolDir } = await import('../skills/port-any-game/scripts/setup.mjs');
const { startServer, parseHeadersFile } = await import('../skills/port-any-game/scripts/serve.mjs');

const ADAPTER = fileURLToPath(new URL('./fixtures/lane-test/adapter.js', import.meta.url));
const GPL2 = fileURLToPath(new URL('../skills/port-any-game/assets/licenses/GPL-2.0.txt', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');

test('GPL-2.0 text is the verbatim gnu.org file', () => {
  // sha256 of https://www.gnu.org/licenses/old-licenses/gpl-2.0.txt as fetched 2026-11-18 (see assets/licenses/README.md).
  assert.equal(sha(readFileSync(GPL2)), 'edaef632cbb643e4e7a221717a6c441a4c1a7c918e6e4d56debc3d8739b233f6');
});

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
// linkGame: game/ is a link to a separate "install" folder, like a real port made by pag new.
function makePort({ mode = 'byo', acks = [], redistributable, laneId = 'lane-test', linkGame = false } = {}) {
  const dir = path.join(base, `port-${++n}`);
  const src = linkGame ? path.join(base, `install-${n}`) : path.join(dir, 'game');
  const game = {
    'GAME.EXE': Buffer.concat([Buffer.from('MZ'), randomBytes(4094)]),
    'data/level1.dat': randomBytes(3000),
    'data/Music.ogg': randomBytes(2048),
  };
  for (const [rel, data] of Object.entries(game)) {
    mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    writeFileSync(path.join(src, rel), data);
  }
  writeFileSync(path.join(src, 'Thumbs.db'), 'os junk');
  mkdirSync(dir, { recursive: true });
  if (linkGame) symlinkSync(src, path.join(dir, 'game'), 'junction');
  const port = { schema: 'port-any-game/port@1', id: `test-game-${n}`, name: 'Test Game', lane: laneId,
    data: { mode, ...(redistributable ? { redistributable: true } : {}) }, tools: {}, acks, created_at: '2026-11-17T00:00:00Z' };
  writeFileSync(path.join(dir, 'port.json'), JSON.stringify(port, null, 2));
  return { dir, src, game, port };
}
const ACK = [{ id: 'ACK_RIGHTS_HOLDER', at: '2026-11-17T00:00:00Z' }];

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p); else yield p;
  }
}
const io = () => { const o = { out: '', err: '' }; return { o, io: { out: (t) => (o.out += t), err: (t) => (o.err += t) } }; };
const runtimeDir = (distDir, shell) => path.dirname(path.join(distDir, ...shell.entry.adapter.split('/')));

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
  assert.match(shell.entry.adapter, /^runtime\/lane-test-[0-9a-f]{8}\/adapter\.js$/, 'content-hashed runtime folder (R30)');
  assert.deepEqual(shell.data, { mode: 'byo', manifest: 'game/manifest.json', mount: '/game', saves: `/saves/${port.id}` });
  assert.equal(shell.needs_coi, false);
  assert.deepEqual(shell.verify.inputs, ['ArrowRight']);
  assert.equal(shell.verify.audio_on_title, true);
  assert.equal(typeof shell.verify.target_fps, 'number');
  assert.equal(shell.input.mouse, 'none');
  assert.equal(shell.input.keyboard, true, 'lane contribution merges into defaults');
  assert.deepEqual(shell.lane_config, { exe: 'GAME.EXE' });
  for (const k of ['webgl2', 'webgpu', 'threads', 'simd', 'jspi']) assert.equal(typeof shell.requires[k], 'boolean', k);

  const rt = runtimeDir(distDir, shell);
  assert.deepEqual(readdirSync(d('runtime')), [path.basename(rt)]);
  assert.deepEqual(readFileSync(path.join(rt, 'adapter.js')), readFileSync(ADAPTER));
  assert.equal(readFileSync(path.join(rt, 'runtime.js'), 'utf8'), 'export const rt = 1;\n');
  assert.ok(existsSync(path.join(rt, 'sub', 'runtime.wasm')));
  assert.ok(!existsSync(path.join(rt, '.ok')));

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
  // GPL-2.0 §1: the licence text travels with the binary; appended after the notice lines.
  assert.ok(lic.indexOf('GNU GENERAL PUBLIC LICENSE\n                       Version 2, June 1991') > lic.indexOf('complete corresponding source'), 'GPL-2.0 text after the notice');
  assert.ok(lic.endsWith(readFileSync(GPL2, 'utf8')));
  assert.match(readFileSync(d('LICENSES', 'port-any-game-shell.txt'), 'utf8'), /MIT License[\s\S]*Permission is hereby granted/);
  assert.deepEqual(readdirSync(path.join(dir, 'work')), [], 'no temp dirs left behind');

  const srv = await startServer({ root: distDir, log: () => {} });
  try {
    const r = await fetch(`${srv.url}/index.html`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    assert.equal(r.headers.get('cross-origin-embedder-policy'), null);
    assert.equal((await fetch(`${srv.url}/shell/shell.js`)).status, 200);
    const a = await fetch(`${srv.url}/${shell.entry.adapter}`);
    assert.equal(a.status, 200, 'entry.adapter resolves');
    assert.equal(a.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  } finally { await srv.close(); }
});

test('runtime folder hash changes when the adapter changes (R30)', async () => {
  const adapter = path.join(base, 'adapter-copy.js');
  copyFileSync(ADAPTER, adapter);
  const { dir } = makePort();
  const a = await pack(dir, opts({ laneModule: lane({ adapter }) }));
  assert.equal((await pack(dir, opts({ laneModule: lane({ adapter }) }))).shell.entry.adapter, a.shell.entry.adapter, 'deterministic');
  appendFileSync(adapter, '// changed\n');
  const b = await pack(dir, opts({ laneModule: lane({ adapter }) }));
  assert.notEqual(b.shell.entry.adapter, a.shell.entry.adapter);
  assert.equal(readFileSync(path.join(b.distDir, ...b.shell.entry.adapter.split('/')), 'utf8'), readFileSync(adapter, 'utf8'));
  assert.ok(!existsSync(path.join(b.distDir, ...a.shell.entry.adapter.split('/'))), 'the old runtime folder went with the old dist');
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

  const acked = makePort({ mode: 'bundled-public', acks: ACK });
  const r1 = await pack(acked.dir, opts());
  assert.equal(r1.shell.data.mode, 'bundled-public');
  assert.deepEqual(readFileSync(path.join(r1.distDir, 'game', 'GAME.EXE')), acked.game['GAME.EXE']);

  const redist = makePort({ mode: 'bundled-public', redistributable: true });
  assert.equal((await pack(redist.dir, opts())).shell.data.mode, 'bundled-public');
});

// R63: once the rights are recorded, `pack --mode bundled-public` persists data.mode; the refusal names the way forward.
test('pack --mode bundled-public persists data.mode once the rights gate passes', async () => {
  const refused = makePort();
  let c = io();
  assert.equal(await run([refused.dir, '--mode', 'bundled-public'], c.io, opts()), 4);
  assert.match(c.o.err, /pag ack ACK_RIGHTS_HOLDER/);
  assert.doesNotMatch(c.o.err, /data\.mode/);
  assert.equal(JSON.parse(readFileSync(path.join(refused.dir, 'port.json'), 'utf8')).data.mode, 'byo');

  const owned = makePort({ acks: ACK });
  c = io();
  assert.equal(await run([owned.dir, '--mode', 'bundled-public'], c.io, opts()), 0, c.o.err);
  assert.equal(JSON.parse(readFileSync(path.join(owned.dir, 'port.json'), 'utf8')).data.mode, 'bundled-public');
  assert.equal((await pack(owned.dir, opts())).shell.data.mode, 'bundled-public', 'the next pack keeps it');
});

test('bundled-public is lane-independent; byo and bundled must be in dataModes (R29)', async () => {
  const byoOnly = lane({ dataModes: ['byo'] });
  const acked = makePort({ mode: 'bundled-public', acks: ACK });
  const r = await pack(acked.dir, opts({ laneModule: byoOnly }));
  assert.equal(r.shell.data.mode, 'bundled-public');
  assert.deepEqual(readFileSync(path.join(r.distDir, 'game', 'data', 'level1.dat')), acked.game['data/level1.dat'], 'game bytes present');

  const c = io();
  assert.equal(await run([acked.dir, '--mode', 'bundled'], c.io, { lock: LOCK, laneModule: byoOnly }), 2);
  assert.match(c.o.err, /lane-test supports data modes byo; not 'bundled'/);

  const noAck = makePort({ mode: 'bundled-public' });
  await assert.rejects(pack(noAck.dir, opts({ laneModule: byoOnly })), (e) => e.code === 'PUBLIC_BUNDLED');
});

test('pack CLI: data mode outside the lane, missing adapter, missing runtime tool, missing game folder', async () => {
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

  const noGame = makePort();
  rmSync(path.join(noGame.dir, 'game'), { recursive: true });
  c = io();
  assert.equal(await run([noGame.dir], c.io, opts()), 1);
  assert.match(c.o.err, /game\/ folder is missing/);
  assert.ok(!existsSync(path.join(noGame.dir, 'dist')));

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

test('a lane csp relaxation is merged into the CSP and recorded in shell.json (R61)', async () => {
  const csp = { 'script-src': ["'unsafe-eval'", "'unsafe-inline'", "'self'"] };
  const rules = Object.fromEntries(parseHeadersFile(headersFor({ csp })).map((r) => [r.pattern, r.headers]));
  assert.equal(rules['/*']['Content-Security-Policy'], "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'");
  assert.throws(() => headersFor({ csp: { 'frame-src': ['*'] } }), /frame-src/, 'only directives the base policy has');
  assert.throws(() => headersFor({ csp: { 'script-src': ['https://evil.example'] } }), /evil/, 'keywords only, never a host');

  const { dir } = makePort();
  const { distDir, shell } = await pack(dir, opts({ laneModule: lane({ shell: () => ({ csp }) }) }));
  assert.deepEqual(shell.csp, csp);
  assert.match(readFileSync(path.join(distDir, '_headers'), 'utf8'), /script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline';/);
  const plain = await pack(makePort().dir, opts());
  assert.equal('csp' in plain.shell, false, 'no relaxation unless the lane declares one');
});

test('X-Robots-Tag is for private builds only (none on bundled-public)', async () => {
  for (const mode of ['byo', 'bundled']) assert.match(headersFor({ needs_coi: false, data: { mode } }), /X-Robots-Tag: noindex, nofollow/, mode);
  const pub = headersFor({ needs_coi: false, data: { mode: 'bundled-public' } });
  assert.doesNotMatch(pub, /X-Robots-Tag/);
  assert.match(pub, /Content-Security-Policy/);
  const acked = makePort({ mode: 'bundled-public', acks: ACK });
  const { distDir } = await pack(acked.dir, opts());
  assert.doesNotMatch(readFileSync(path.join(distDir, '_headers'), 'utf8'), /X-Robots-Tag/);
  assert.equal(readFileSync(path.join(distDir, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
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

test('a failed pack leaves the previous dist whole and no temp dirs', async () => {
  const { dir } = makePort();
  await pack(dir, opts());
  const before = readFileSync(path.join(dir, 'dist', 'shell.json'), 'utf8');
  const broken = lane({ shell: () => { throw new Error('lane shell broke'); } });
  await assert.rejects(pack(dir, opts({ laneModule: broken, mode: 'bundled' })), /lane shell broke/);
  assert.equal(readFileSync(path.join(dir, 'dist', 'shell.json'), 'utf8'), before);
  assert.deepEqual(readdirSync(path.join(dir, 'dist', 'game')), ['manifest.json'], 'no bundled bytes leaked into the kept dist');
  assert.deepEqual(readdirSync(path.join(dir, 'work')), []);
});

test('a game manifest.json clashes in any letter case', async () => {
  const p = makePort();
  writeFileSync(path.join(p.dir, 'game', 'MANIFEST.JSON'), '{"name":"pwa"}');
  await assert.rejects(pack(p.dir, opts({ mode: 'bundled' })), /MANIFEST\.JSON .*clash with game\/manifest\.json/);
  const m = JSON.parse(readFileSync(path.join((await pack(p.dir, opts())).distDir, 'game', 'manifest.json'), 'utf8'));
  assert.ok(m.files.some((f) => f.path === 'MANIFEST.JSON'), 'byo copies no game files, so no clash');
});

test('checkGameNames refuses names the browser cannot use', () => {
  checkGameNames(['GAME.EXE', 'data/a.bin', 'Data2/a.bin']);
  assert.throws(() => checkGameNames(['dir\\file.dat']), /cannot be used in a browser/);
  assert.throws(() => checkGameNames(['a/./b']), /cannot be used in a browser/);
  assert.throws(() => checkGameNames(['data/Level1.dat', 'data/level1.DAT']), /differ only by case/);
});

test('case-only twins on disk are refused (case-sensitive file systems)', async (t) => {
  const p = makePort();
  writeFileSync(path.join(p.dir, 'game', 'Twin.dat'), 'a');
  writeFileSync(path.join(p.dir, 'game', 'twin.dat'), 'b');
  if (!readdirSync(path.join(p.dir, 'game')).includes('Twin.dat') || !readdirSync(path.join(p.dir, 'game')).includes('twin.dat')) return t.skip('case-insensitive file system');
  await assert.rejects(pack(p.dir, opts()), /differ only by case/);
});

test('links must stay inside the game folder; other non-regular entries are skipped', async (t) => {
  const outside = path.join(base, 'outside');
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, 'id_rsa'), 'PRIVATE KEY');

  let real;
  try { real = makePort({ linkGame: true }); } catch (e) { return t.skip(`cannot create links here (${e.code})`); }
  // A folder link out (a junction needs no admin rights on Windows) is refused before anything is written.
  symlinkSync(outside, path.join(real.src, 'escape'), 'junction');
  await assert.rejects(pack(real.dir, opts({ mode: 'bundled' })), /escape links outside the game folder/);
  assert.ok(!existsSync(path.join(real.dir, 'dist')));

  // A folder link that stays inside (game/ itself is a link, as pag new makes it) is skipped with a warning.
  const ok = makePort({ linkGame: true });
  symlinkSync(path.join(ok.src, 'data'), path.join(ok.src, 'alias'), 'junction');
  const warns = [];
  const r = await pack(ok.dir, opts({ mode: 'bundled', warn: (m) => warns.push(m) }));
  assert.match(warns.join('\n'), /alias: linked folder inside the game folder, not followed/);
  const m = JSON.parse(readFileSync(path.join(r.distDir, 'game', 'manifest.json'), 'utf8'));
  assert.deepEqual(m.files.map((f) => f.path), ['GAME.EXE', 'data/Music.ogg', 'data/level1.dat']);

  if (process.platform !== 'win32' && spawnSync('mkfifo', [path.join(ok.src, 'pipe')]).status === 0) {
    const w = [];
    await pack(ok.dir, opts({ mode: 'bundled', warn: (x) => w.push(x) }));
    assert.match(w.join('\n'), /pipe: not a regular file, skipped/);
  } else t.diagnostic('FIFO case skipped (no mkfifo)');

  const fileLink = makePort();
  try { symlinkSync(path.join(outside, 'id_rsa'), path.join(fileLink.dir, 'game', 'key.dat'), 'file'); }
  catch (e) { return t.diagnostic(`file-symlink case skipped (${e.code}: file symlinks need admin rights on Windows)`); }
  await assert.rejects(pack(fileLink.dir, opts({ mode: 'bundled' })), /key\.dat links outside the game folder/);
  assert.ok(!existsSync(path.join(fileLink.dir, 'dist')));
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
  const rt = runtimeDir(distDir, shell);
  assert.deepEqual(readdirSync(rt).sort(), ['adapter.js', 'runtime.js']);
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
  assert.match(c.o.err, /not a port folder/);
});
