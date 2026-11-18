import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, keepPort, skipReason } from './e2e/run.mjs';

const tmp = mkdtempSync(path.join(tmpdir(), 'pag-ci-'));
after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); cleanup(); });

test('PAG_E2E=0 skips browser e2e; anything else defers to the browser check', () => {
  assert.match(skipReason({ PAG_E2E: '0' }), /PAG_E2E=0/);
  assert.notEqual(skipReason({ PAG_E2E: '1' }), 'PAG_E2E=0; browser e2e skipped');
});

test("the 'all' target holds every lane's cases", () => {
  const lanes = Object.keys(CASES).filter((k) => k !== 'all');
  assert.deepEqual(CASES.all.map((c) => c.name), lanes.flatMap((l) => CASES[l].map((c) => c.name)));
  assert.equal(CASES.all.length, 7);
});

test('PAG_E2E_KEEP copies the port with its verify/ report; unset keeps nothing', () => {
  const port = path.join(tmp, 'port');
  mkdirSync(path.join(port, 'verify'), { recursive: true });
  writeFileSync(path.join(port, 'verify', 'report.json'), '{}');
  assert.equal(keepPort(port, 'x', {}), null);
  const keep = path.join(tmp, 'keep');
  assert.equal(keepPort(port, 'web-extract-case-1', { PAG_E2E_KEEP: keep }), path.join(keep, 'web-extract-case-1'));
  assert.ok(existsSync(path.join(keep, 'web-extract-case-1', 'verify', 'report.json')));
});

// Not a YAML parser (no dependency): checks the shape CI relies on, line by line.
test('ci.yml has the agreed shape', () => {
  const y = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const lines = y.split('\n');
  assert.ok(!y.includes('\t'), 'tabs are invalid in YAML');
  assert.ok(lines.every((l) => (l.match(/^ */)[0].length % 2) === 0), 'two-space indentation');
  assert.match(y, /^on:\n {2}push:\n {2}pull_request:$/m);
  assert.match(y, /^permissions:\n {2}contents: read$/m);
  assert.match(y, /fail-fast: false/);
  assert.match(y, /os: \[windows-latest, macos-latest, ubuntu-latest\]/);
  assert.match(y, /node-version: 22/);
  assert.match(y, /timeout-minutes: \d+/);
  assert.doesNotMatch(y, /secrets\./);
  for (const m of y.matchAll(/uses: (\S+)/g)) assert.match(m[1], /^actions\/(checkout|setup-node|cache|upload-artifact)@v4$/, m[1]);
  const order = ['npm test', 'node scripts/validate.mjs', 'gen-wrappers.mjs --check', 'setup ruffle --yes', 'setup jsdos --yes', 'npm run e2e', 'upload-artifact'].map((s) => y.indexOf(s));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), `step order ${order}`);
  assert.match(y, /PAG_E2E: '0'/);
  assert.match(y, /if: failure\(\)/);
  assert.match(y, /toolchain\.lock\.json/);
});
