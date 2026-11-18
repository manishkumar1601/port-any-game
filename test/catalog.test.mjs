import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, matchCatalog } from '../skills/port-any-game/scripts/catalog.mjs';

const cat = loadCatalog();
const none = { steam_appid: null, gog_id: null, title_guess: null };
const f = (rel) => ({ rel, abs: '/x/' + rel, size: 1, isSymlink: false });

test('catalog has schema and >= 25 games', () => {
  assert.equal(cat.schema, 'port-any-game/catalog@1');
  assert.ok(cat.games.length >= 25);
  assert.equal(new Set(cat.games.map((g) => g.id)).size, cat.games.length);
});

test('matches by steam appid', () => {
  const m = matchCatalog(cat, { identity: { ...none, steam_appid: '517790' }, files: [], engines: [] });
  assert.equal(m[0].game_id, 'caesar3');
  assert.equal(m[0].tier, 'store');
  assert.equal(m[0].needs_confirm, false);
  assert.ok(m[0].ports.length > 0);
});

test('matches by signature files', () => {
  const m = matchCatalog(cat, { identity: none, files: [f('Game/DIABDAT.MPQ')], engines: [] });
  assert.equal(m[0].game_id, 'diablo');
  assert.equal(m[0].tier, 'signature');
});

test('matches carry the catalog redistributable flag (I3)', () => {
  const m = matchCatalog(cat, { identity: none, files: [f('freedoom1.wad')], engines: [{ id: 'idtech-doom' }] });
  assert.deepEqual(m.find((x) => x.game_id === 'freedoom'), { game_id: 'freedoom', tier: 'signature', needs_confirm: false, redistributable: true, ports: m.find((x) => x.game_id === 'freedoom').ports });
  assert.equal(m.find((x) => x.game_id === 'doom').redistributable, false);
});

test('engine-only match is tier engine', () => {
  const m = matchCatalog(cat, { identity: none, files: [], engines: [{ id: 'idtech-doom' }] });
  assert.ok(m.length > 0);
  assert.ok(m.every((x) => x.tier === 'engine' && x.needs_confirm));
});

test('fuzzy title needs_confirm', () => {
  const m = matchCatalog(cat, { identity: { ...none, title_guess: 'CAESAR  iii' }, files: [], engines: [] });
  assert.equal(m[0].game_id, 'caesar3');
  assert.equal(m[0].tier, 'title');
  assert.equal(m[0].needs_confirm, true);
  assert.deepEqual(matchCatalog(cat, { identity: { ...none, title_guess: 'caesar' }, files: [], engines: [] }), []);
});

test('ordering is store > signature > engine > title', () => {
  const m = matchCatalog(cat, {
    identity: { ...none, steam_appid: '517790', title_guess: 'Quake' },
    files: [f('DIABDAT.MPQ')],
    engines: [{ id: 'idtech-doom' }],
  });
  const tiers = m.map((x) => x.tier);
  const rank = { store: 0, signature: 1, engine: 2, title: 3 };
  assert.deepEqual(tiers, [...tiers].sort((a, b) => rank[a] - rank[b]));
  assert.deepEqual(tiers.slice(0, 2), ['store', 'signature']);
});

test('no port url points at game data', () => {
  const bad = /\.(wad|pak|pk3|mpq|grp|dat|iso|zip)$/i;
  for (const g of cat.games) for (const p of g.ports) assert.ok(!bad.test(new URL(p.url).pathname), p.url);
});

test('every port has license, legal_risk, verified_at', () => {
  for (const g of cat.games) {
    assert.ok(g.ports.length > 0, g.id);
    for (const p of g.ports) {
      assert.ok(p.license, g.id);
      assert.ok(['low', 'medium', 'high'].includes(p.legal_risk), g.id);
      assert.match(p.verified_at, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(['byo-web', 'reimpl-web'].includes(p.kind));
    }
  }
});

test('high legal_risk is flagged', () => {
  const m = matchCatalog(cat, { identity: { ...none, steam_appid: '12110' }, files: [], engines: [] });
  assert.equal(m[0].ports[0].legal_risk, 'high');
});

const sigsOf = (id) => cat.games.find((g) => g.id === id).signatures;

test('every catalog signature compiles', () => {
  for (const g of cat.games) for (const s of g.signatures) assert.doesNotThrow(() => new RegExp(s.path, 'i'), g.id);
});

test('invalid regex in data is skipped not thrown', () => {
  const bad = { schema: 'x', games: [
    { id: 'bad', title: 'Bad', ids: {}, signatures: [{ path: '(' }], ports: [] },
    { id: 'ok', title: 'Ok', ids: {}, signatures: [{ path: 'ok\\.bin$' }], ports: [] },
  ] };
  const m = matchCatalog(bad, { identity: none, files: [f('ok.bin')], engines: [] });
  assert.deepEqual(m.map((x) => x.game_id), ['ok']);
});

test('size filter excludes wrong-size file', () => {
  const c = { schema: 'x', games: [{ id: 'g', title: 'G', ids: {}, signatures: [{ path: 'a\\.bin$', size: 5 }], ports: [] }] };
  const file = (size) => ({ ...f('a.bin'), size });
  assert.equal(matchCatalog(c, { identity: none, files: [file(4)], engines: [] }).length, 0);
  assert.equal(matchCatalog(c, { identity: none, files: [file(5)], engines: [] })[0].tier, 'signature');
});

test('numeric steam_appid still matches', () => {
  const m = matchCatalog(cat, { identity: { ...none, steam_appid: 517790 }, files: [], engines: [] });
  assert.equal(m[0].tier, 'store');
});

test('generic PopCap main.pak alone does not match pvz', () => {
  const m = matchCatalog(cat, { identity: none, files: [f('main.pak'), f('properties/x.xml')], engines: [] });
  assert.ok(!m.some((x) => x.game_id === 'pvz'));
  assert.ok(sigsOf('pvz').length > 0);
});

test('level1.phd matches tomb-raider entry covering TR1 and Unfinished Business', () => {
  const m = matchCatalog(cat, { identity: none, files: [f('DATA/LEVEL1.PHD')], engines: [] });
  assert.deepEqual(m.map((x) => x.game_id), ['tomb-raider']);
  assert.match(cat.games.find((g) => g.id === 'tomb-raider').title, /Unfinished Business/);
});

test('bare JK.EXE or Res1hi.gob gives no signature match for jkdf2', () => {
  const ids = (n) => matchCatalog(cat, { identity: none, files: [f(n)], engines: [] }).map((x) => x.game_id);
  assert.deepEqual(ids('JK.EXE'), []);
  assert.deepEqual(ids('Res1hi.gob'), []);
});
