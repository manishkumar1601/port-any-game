import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { doctor, findBrowsers, detectSandbox } from '../skills/port-any-game/scripts/doctor.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-doctor-'));
after(() => rmSync(base, { recursive: true, force: true }));
process.env.PAG_CACHE = path.join(base, 'cache');

test('doctor reports node ok and cacheDir', async () => {
  const r = await doctor();
  assert.equal(r.node.ok, true);
  assert.equal(r.node.version, process.versions.node);
  assert.equal(r.cacheDir, process.env.PAG_CACHE);
  assert.ok(r.diskFreeBytes > 0);
  assert.equal(r.os, process.platform);
  assert.ok(Array.isArray(r.warnings));
});

test('doctor finds browser from PAG_BROWSER env', async () => {
  const fake = path.join(base, 'my-msedge');
  writeFileSync(fake, '');
  const prev = process.env.PAG_BROWSER;
  process.env.PAG_BROWSER = fake;
  try {
    assert.deepEqual(findBrowsers()[0], { kind: 'edge', path: fake });
    assert.equal((await doctor()).browsers[0].path, fake);
  } finally {
    if (prev === undefined) delete process.env.PAG_BROWSER; else process.env.PAG_BROWSER = prev;
  }
});

test('detectSandbox reads env markers', () => {
  assert.equal(detectSandbox({}), null);
  assert.equal(detectSandbox({ CLAUDE_CODE_REMOTE: 'true' }), 'claude-web');
  assert.equal(detectSandbox({ CODEX_SANDBOX: '1' }), 'codex-cloud');
});
