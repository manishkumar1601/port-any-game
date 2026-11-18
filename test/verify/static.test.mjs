// verify steps 1-2 without a browser: static checks on dist/ and the serve probe.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = mkdtempSync(path.join(tmpdir(), 'pag-verify-static-'));
process.env.PAG_CACHE = path.join(base, 'cache');
process.env.PAG_HOME = path.join(base, 'home');
after(() => rmSync(base, { recursive: true, force: true }));

const { pack } = await import('../../skills/port-any-game/scripts/pack.mjs');
const { startServer } = await import('../../skills/port-any-game/scripts/serve.mjs');
const { staticChecks, probe } = await import('../../skills/port-any-game/scripts/verify/static.mjs');

const laneModule = { id: 'lane-test', dataModes: ['byo', 'bundled'], adapter: fileURLToPath(new URL('../fixtures/lane-test/adapter.js', import.meta.url)) };
const ACK = [{ id: 'ACK_RIGHTS_HOLDER', at: '2026-11-17T00:00:00Z' }];
let n = 0;
async function packed(data, acks = []) {
  const dir = path.join(base, `port-${++n}`);
  mkdirSync(path.join(dir, 'game'), { recursive: true });
  writeFileSync(path.join(dir, 'game', 'GAME.EXE'), 'MZ test');
  const port = { schema: 'port-any-game/port@1', id: `static-${n}`, name: 'Static', lane: 'lane-test', data, tools: {}, acks };
  writeFileSync(path.join(dir, 'port.json'), JSON.stringify(port));
  const { distDir, shell } = await pack(dir, { laneModule });
  const manifest = JSON.parse(readFileSync(path.join(distDir, shell.data.manifest), 'utf8'));
  return { distDir, shell, manifest, port };
}
const status = (checks, name) => checks.find((c) => c.name === name)?.status;

test('static: a bundled-public build fails unless the port allows public data (spec §9 step 1)', async () => {
  const pub = await packed({ mode: 'bundled-public' }, ACK);
  let checks = await staticChecks(pub.distDir, pub.shell, pub.manifest, pub.port);
  assert.equal(status(checks, 'public'), 'pass', JSON.stringify(checks));
  assert.equal(status(checks, 'manifest'), 'pass');
  // The same dist once the rights-holder acknowledgement is gone from port.json, and with no port.json at all.
  checks = await staticChecks(pub.distDir, pub.shell, pub.manifest, { ...pub.port, acks: [] });
  assert.equal(status(checks, 'public'), 'fail');
  assert.equal(status(await staticChecks(pub.distDir, pub.shell, pub.manifest, null), 'public'), 'fail');
  const byo = await packed({ mode: 'byo' });
  assert.equal(status(await staticChecks(byo.distDir, byo.shell, byo.manifest, byo.port), 'public'), undefined, 'only public builds are gated');
});

test('static: a lane CSP relaxation is reported as info, never warn (R61)', async () => {
  const p = await packed({ mode: 'bundled' });
  assert.equal(status(await staticChecks(p.distDir, p.shell, p.manifest, p.port), 'csp'), undefined);
  const shell = { ...p.shell, csp: { 'script-src': ["'unsafe-eval'", "'unsafe-inline'"] } };
  const c = (await staticChecks(p.distDir, shell, p.manifest, p.port)).find((x) => x.name === 'csp');
  assert.equal(c?.status, 'info');
  assert.match(c.detail, /script-src.*'unsafe-eval' 'unsafe-inline'/);
});

test('probe: headers, Range 206 and auth 401/200 (spec §9 step 2)', async () => {
  const { distDir, shell } = await packed({ mode: 'byo' });
  const srv = await startServer({ root: distDir, log: () => {} });
  try {
    const c = await probe(srv.url, shell, distDir);
    assert.equal(c.status, 'pass', c.detail);
    assert.match(c.detail, /Range 206/);
    assert.match(c.detail, /auth 401\/200/);
  } finally { await srv.close(); }
});
