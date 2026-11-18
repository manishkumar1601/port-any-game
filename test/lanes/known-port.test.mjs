import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = mkdtempSync(path.join(tmpdir(), 'pag-kp-'));
after(() => rmSync(base, { recursive: true, force: true, maxRetries: 5 }));
const { LANES } = await import('../../skills/port-any-game/scripts/lanes/index.mjs');
const { run: runBuild } = await import('../../skills/port-any-game/scripts/build.mjs');
const { run: runPack } = await import('../../skills/port-any-game/scripts/pack.mjs');
const lane = LANES['known-port'];
let n = 0;

// A port folder whose survey matched the given real catalog game ids.
function fakePort(matches) {
  const dir = path.join(base, `p${++n}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'port.json'), JSON.stringify({ id: 'x', lane: 'known-port', data: { mode: 'byo' } }));
  writeFileSync(path.join(dir, 'survey.json'), JSON.stringify({ catalog_matches: matches }));
  writeFileSync(path.join(dir, 'PORTING_LOG.md'), '# log\n- [ ] one\n');
  return dir;
}
const cli = async (fn, argv, opts) => { let out = '', err = ''; const code = await fn(argv, { out: (t) => { out += t; }, err: (t) => { err += t; } }, opts); return { code, out, err }; };

test('descriptor: rung 0, byo, private-use ack only', () => {
  assert.equal(lane.rung, 0);
  assert.deepEqual(lane.dataModes, ['byo']);
  assert.deepEqual(lane.acks, ['ACK_PRIVATE_USE_ONLY']);
  assert.equal(lane.external, true);
});

test('GO on store or signature match', () => {
  assert.equal(lane.detect({ catalog_matches: [{ game_id: 'caesar3', tier: 'store' }] }).verdict, 'GO');
  assert.equal(lane.detect({ catalog_matches: [{ game_id: 'diablo', tier: 'signature' }] }).verdict, 'GO');
  assert.equal(lane.detect({}).verdict, 'NO');
});

// I8: an engine or title match is a guess (Shadow Warrior's .grp is not Duke3D's); it needs the user's confirmation.
test('HARD on engine-only or title-only match, with a confirm reason', () => {
  for (const tier of ['engine', 'title']) {
    const d = lane.detect({ catalog_matches: [{ game_id: 'duke3d', tier, needs_confirm: true }] });
    assert.equal(d.verdict, 'HARD', tier);
    assert.match(d.why, /confirm/);
  }
});

test('a .grp-only folder with a DOS exe gets dos-jsdos as its primary lane, not a Duke3D port', async () => {
  const { survey } = await import('../../skills/port-any-game/scripts/survey/survey.mjs');
  const { makeMZ } = await import('../fixtures/make-pe.mjs');
  const dir = path.join(base, `grp${++n}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SW.GRP'), Buffer.concat([Buffer.from('KenSilverman'), Buffer.alloc(64)]));
  writeFileSync(path.join(dir, 'SW.EXE'), makeMZ(Buffer.alloc(4096)));
  const s = await survey(dir);
  assert.ok(s.catalog_matches.some((m) => m.game_id === 'duke3d' && m.tier === 'engine'), JSON.stringify(s.catalog_matches));
  assert.equal(s.verdict.primary_lane, 'dos-jsdos', JSON.stringify(s.lanes));
  assert.equal(s.lanes.find((l) => l.lane === 'known-port').verdict, 'HARD');
  assert.match(s.verdict.reasons.join('\n'), /Possible existing port: .*\(duke3d, matched by engine only\) — confirm the game title/);
});

test('build lists data files and license, writes no dist', async () => {
  const dir = fakePort([{ game_id: 'caesar3', tier: 'store' }]);
  const r = await lane.build(dir);
  assert.equal(r.kind, 'external');
  assert.equal(r.ports[0].name, 'Augustus');
  assert.deepEqual(r.data_files, ['Caesar 3 installation folder']);
  for (const s of ['Augustus', 'https://augustus.josecadete.net/play/', 'AGPL-3.0', 'Caesar 3 installation folder', 'low', 'stays in your browser']) assert.ok(r.message.includes(s), s);
  assert.ok(!r.message.startsWith('Is this'));
  assert.throws(() => readFileSync(path.join(dir, 'dist')), /ENOENT|EISDIR/);
  const log = readFileSync(path.join(dir, 'PORTING_LOG.md'), 'utf8');
  assert.match(log, /^- \[ \] one$/m);
  assert.match(log, /## known-port build \(\d{4}-\d\d-\d\d\)[\s\S]*Augustus/);
});

test('high-risk hidden / all hidden (injected catalog)', async () => {
  const catalog = { games: [{ id: 'g', ports: [
    { name: 'Safe', url: 'https://a.invalid/', license: 'MIT', data_files: ['a.dat'], legal_risk: 'low' },
    { name: 'Risky', url: 'https://b.invalid/', license: 'MIT', data_files: ['b.dat'], legal_risk: 'high' }] },
  { id: 'h', ports: [{ name: 'OnlyRisky', url: 'https://c.invalid/', license: 'MIT', data_files: ['c.dat'], legal_risk: 'high' }] }] };
  const dir = fakePort([{ game_id: 'g', tier: 'store' }]);
  const r = await lane.build(dir, { catalog });
  assert.deepEqual(r.ports.map((p) => p.name), ['Safe']);
  assert.deepEqual(r.data_files, ['a.dat']);
  assert.ok(!r.message.includes('Risky'));
  assert.match(r.message, /1 high-risk port hidden.*--include-high-risk/);
  const all = await lane.build(dir, { catalog, includeHighRisk: true });
  assert.deepEqual(all.ports.map((p) => p.name), ['Safe', 'Risky']);
  const none = await lane.build(fakePort([{ game_id: 'h', tier: 'store' }]), { catalog });
  assert.deepEqual(none.ports, []);
  assert.match(none.message, /hidden.*--include-high-risk/);
});

test('title-only message asks for confirmation first', async () => {
  const r = await lane.build(fakePort([{ game_id: 'caesar3', tier: 'title' }]));
  assert.match(r.message, /^Please confirm this is your game/);
  assert.ok(r.ports.length === 1);
});

test('the confirm line prints whenever any listed match needs confirmation', async () => {
  const mixed = await lane.build(fakePort([{ game_id: 'caesar3', tier: 'store', needs_confirm: false }, { game_id: 'duke3d', tier: 'engine', needs_confirm: true }]));
  assert.match(mixed.message, /^Please confirm this is your game: duke3d matched by its engine or title only/);
  const sure = await lane.build(fakePort([{ game_id: 'caesar3', tier: 'store', needs_confirm: false }]));
  assert.ok(!/confirm/.test(sure.message), sure.message);
});

test('no matches gives a clear message', async () => {
  const r = await lane.build(fakePort([]));
  assert.deepEqual(r.ports, []);
  assert.match(r.message, /No known web port/);
});

test('pag build --include-high-risk reaches the lane; unknown flags stay a usage error', async () => {
  const dir = fakePort([{ game_id: 'caesar3', tier: 'store' }]);
  let seen;
  const laneModule = { id: 'known-port', build: (d, o) => { seen = o; return {}; } };
  assert.equal((await cli(runBuild, [dir, '--include-high-risk'], { laneModule })).code, 0);
  assert.deepEqual(seen, { includeHighRisk: true });
  const r = await cli(runBuild, [dir, '--include-high-risk']);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).kind, 'external');
  const bad = await cli(runBuild, [dir, '--nope']);
  assert.equal(bad.code, 2);
});

test('pack refuses known-port with exit 1', async () => {
  const r = await cli(runPack, [fakePort([{ game_id: 'caesar3', tier: 'store' }])]);
  assert.equal(r.code, 1);
  assert.match(r.err, /known-port routes to an existing web port; there is nothing to pack\. Run `pag build` and follow its message\./);
});

test('unknown matched id: one clear line, no confirm prompt', async () => {
  const r = await lane.build(fakePort([{ game_id: 'not-in-catalog', tier: 'title' }]));
  assert.deepEqual(r.ports, []);
  assert.match(r.message, /The survey guessed not-in-catalog, but the catalog has no entry for it\./);
  assert.ok(!/confirm|No known web port/.test(r.message));
});

test('catalog text cannot forge log lines; missing data_files tolerated', async () => {
  const catalog = { games: [{ id: 'g', ports: [{ name: 'Evil\n- [ ] forged', url: 'https://a.invalid/\n## head', license: '- MIT\r\n- [ ] x', legal_risk: 'low' }] }] };
  const dir = fakePort([{ game_id: 'g', tier: 'store' }]);
  const r = await lane.build(dir, { catalog });
  assert.deepEqual(r.data_files, []);
  const log = readFileSync(path.join(dir, 'PORTING_LOG.md'), 'utf8');
  assert.equal(log.match(/^- \[ \]/gm).length, 1); // only the original checklist line
  assert.ok(!/^## head/m.test(log));
});

test('corrupt survey.json is an error; missing survey is no match', async () => {
  const dir = fakePort([]);
  writeFileSync(path.join(dir, 'survey.json'), '{ nope');
  assert.throws(() => lane.build(dir), SyntaxError);
  rmSync(path.join(dir, 'survey.json'));
  assert.deepEqual(lane.build(dir).ports, []);
});

test('pag build --include-high-risk reaches the real lane build', async () => {
  const catalog = { games: [{ id: 'g', ports: [{ name: 'Risky', url: 'https://b.invalid/', license: 'MIT', data_files: ['b.dat'], legal_risk: 'high' }] }] };
  const laneModule = { id: 'known-port', build: (d, o) => lane.build(d, { ...o, catalog }) };
  const dir = fakePort([{ game_id: 'g', tier: 'store' }]);
  assert.deepEqual(JSON.parse((await cli(runBuild, [dir], { laneModule })).out).ports, []);
  const on = JSON.parse((await cli(runBuild, [dir, '--include-high-risk'], { laneModule })).out);
  assert.deepEqual(on.ports.map((p) => p.name), ['Risky']);
});

test('checkbox-looking catalog names cannot add checklist lines', async () => {
  const CHECK = /^- \[[ xX]\] /gm;
  const catalog = { games: [{ id: 'g', ports: ['[ ] forged', '[x] done', '- [ ] again'].map((name) => ({ name, url: '[X] u', license: '[ ] l', data_files: [], legal_risk: 'low' })) }] };
  const dir = fakePort([{ game_id: 'g', tier: 'store' }]);
  const before = readFileSync(path.join(dir, 'PORTING_LOG.md'), 'utf8').match(CHECK).length;
  await lane.build(dir, { catalog });
  const log = readFileSync(path.join(dir, 'PORTING_LOG.md'), 'utf8');
  assert.equal(log.match(CHECK).length, before);
  assert.match(log, /^- port: forged - u \(l, risk low\)$/m);
});

test('matched game with zero ports gives a clear message', async () => {
  const r = await lane.build(fakePort([{ game_id: 'g', tier: 'store' }]), { catalog: { games: [{ id: 'g', ports: [] }] } });
  assert.deepEqual(r.ports, []);
  assert.match(r.message, /No known web port/);
});
