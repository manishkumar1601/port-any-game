import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, keepPort, parseE2eArgs, skipExit, skipReason } from './e2e/run.mjs';

const tmp = mkdtempSync(path.join(tmpdir(), 'pag-ci-'));
after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); cleanup(); });

test('PAG_E2E=0 skips browser e2e; anything else defers to the browser check', () => {
  assert.match(skipReason({ PAG_E2E: '0' }), /PAG_E2E=0/);
  assert.doesNotMatch(String(skipReason({ PAG_E2E: '1' })), /PAG_E2E=0/);
});

test('PAG_E2E_REQUIRE_BROWSER=1 turns a missing browser into a failure, only then', () => {
  const why = 'no Chrome/Edge found';
  assert.equal(skipExit(why, {}), 0);
  assert.equal(skipExit(why, { PAG_E2E_REQUIRE_BROWSER: '1' }), 1);
  assert.equal(skipExit(false, { PAG_E2E_REQUIRE_BROWSER: '1' }), 0);
  assert.equal(skipExit('PAG_E2E=0; browser e2e skipped', { PAG_E2E_REQUIRE_BROWSER: '1' }), 0);
});

test("the 'all' target holds every lane's cases", () => {
  const lanes = Object.keys(CASES).filter((k) => k !== 'all');
  assert.deepEqual(CASES.all.map((c) => c.name), lanes.flatMap((l) => CASES[l].map((c) => c.name)));
  assert.equal(CASES.all.length, 8);
});

// I5: the Playwright verify tier runs through the same lane cases.
test('e2e runner options: --runner cdp|playwright and --headed', () => {
  assert.deepEqual(parseE2eArgs(['web-extract']), { target: 'web-extract', runner: 'cdp', headed: false });
  assert.deepEqual(parseE2eArgs(['web-extract', '--runner', 'playwright', '--headed']), { target: 'web-extract', runner: 'playwright', headed: true });
  assert.throws(() => parseE2eArgs(['web-extract', '--runner', 'firefox']), /runner/);
  assert.throws(() => parseE2eArgs(['nope']), /usage/);
  assert.match(String(skipReason({}, 'playwright')), /Playwright is not installed|^false$/);
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
  for (const m of y.matchAll(/uses: (\S+)/g)) assert.match(m[1], /^actions\/(checkout|setup-node|cache\/restore|cache\/save|upload-artifact)@v4$/, m[1]);
  const order = ['npm test', 'node scripts/validate.mjs', 'gen-wrappers.mjs --check', 'setup ruffle --yes', 'setup jsdos --yes', 'npm run e2e', 'upload-artifact'].map((s) => y.indexOf(s));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), `step order ${order}`);
  assert.match(y, /PAG_E2E: '0'/);
  assert.match(y, /PAG_E2E_REQUIRE_BROWSER: '1'/);
  assert.match(y, /actions\/cache\/restore@v4/);
  assert.match(y, /actions\/cache\/save@v4/);
  assert.match(y, /if: always\(\)/);
  assert.doesNotMatch(y, /^ {4}env:\n(?: {6}.*\n)*? {6}PAG_E2E_KEEP/m, 'PAG_E2E_KEEP is step-level only');
  const testJob = y.slice(y.indexOf('\n  test:\n'), y.indexOf('\n    steps:', y.indexOf('\n  test:\n')));
  assert.doesNotMatch(testJob.slice(testJob.indexOf('\n    env:')), /runner\./, 'job-level env cannot use the runner context');
  assert.match(y, /if: failure\(\)/);
  assert.match(y, /toolchain\.lock\.json/);
  // I5: one ubuntu job installs Playwright into the runner temp and runs a lane e2e through it under Xvfb.
  const at = y.indexOf('\n  playwright:\n');
  assert.ok(at > 0, 'a playwright job');
  const pw = y.slice(at);
  assert.match(pw, /^ {4}runs-on: ubuntu-latest$/m);
  assert.match(pw, /node-version: 22/);
  assert.match(pw, /PAG_CACHE: \$\{\{ env\.PAG_E2E_TOOLS \}\}$/m);
  assert.match(pw, /PLAYWRIGHT_BROWSERS_PATH: \$\{\{ env\.PAG_E2E_TOOLS \}\}\/ms-playwright$/m);
  assert.ok(pw.indexOf('setup playwright --yes') > 0 && pw.indexOf('setup playwright --yes') < pw.indexOf('xvfb-run'), 'setup before the e2e');
  assert.match(pw, /xvfb-run -a node test\/e2e\/run\.mjs web-extract --runner playwright --headed$/m);
  assert.match(pw, /PAG_E2E_REQUIRE_BROWSER: '1'/);
});
