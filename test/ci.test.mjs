import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CASES, cleanup, ghError, keepPort, parseE2eArgs, skipExit, targetFpsOverride, mergeTargetFps, skipReason } from './e2e/run.mjs';

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
  assert.equal(CASES.all.length, 14);
});

// I5: the Playwright verify tier runs through the same lane cases.
test('e2e runner options: --runner cdp|playwright and --headed', () => {
  assert.deepEqual(parseE2eArgs(['web-extract']), { target: 'web-extract', runner: 'cdp', headed: false });
  assert.deepEqual(parseE2eArgs(['web-extract', '--runner', 'playwright', '--headed']), { target: 'web-extract', runner: 'playwright', headed: true });
  assert.throws(() => parseE2eArgs(['web-extract', '--runner', 'firefox']), /runner/);
  assert.throws(() => parseE2eArgs(['nope']), /usage/);
  assert.match(String(skipReason({}, 'playwright')), /Playwright is not installed|^false$/);
});

test('e2e ghError: a multi-line failure is one annotation line that keeps its second line', () => {
  const write = process.stdout.write;
  let out = '';
  process.stdout.write = (s) => { out += s; return true; };
  const prev = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  try { ghError('web-extract case', 'verify failed\n  checks: [{"name":"fps","status":"fail"}]'); } finally {
    process.stdout.write = write;
    if (prev === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = prev;
  }
  assert.equal(out.split('\n').length, 2, out);
  assert.match(out, /^::error title=web-extract case::verify failed checks: \[\{"name":"fps"/);
});

test('PAG_E2E_TARGET_FPS: unset, empty or not a positive number means no override (R68)', () => {
  for (const v of [undefined, '', ' ', '0', '-5', 'abc']) assert.equal(targetFpsOverride({ PAG_E2E_TARGET_FPS: v }), null, String(v));
  assert.equal(targetFpsOverride({}), null);
  assert.equal(targetFpsOverride({ PAG_E2E_TARGET_FPS: '10' }), 10);
});

test('PAG_E2E_TARGET_FPS lowers but never raises target_fps', () => {
  assert.equal(mergeTargetFps({ target_fps: 30 }, 10).target_fps, 10);
  assert.equal(mergeTargetFps({ target_fps: 5 }, 10).target_fps, 5);
  assert.equal(mergeTargetFps({}, 10).target_fps, 10);
  assert.equal(mergeTargetFps(undefined, 10).target_fps, 10);
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

test('github reporter: one escaped ::error per failed test', async () => {
  const { default: reporter, annotation } = await import('./reporters/github.mjs');
  assert.equal(annotation({ name: 'a: b, c', message: '100%\r\nx' }), '::error title=a%3A b%2C c::100%25%0D%0Ax\n');
  const evs = [{ type: 'test:pass', data: { name: 'ok' } }, { type: 'test:fail', data: { name: 't', file: 'file:///x/y.test.mjs', line: 7, details: { error: { cause: { message: 'boom\nmore' } } } } }];
  let out = '';
  for await (const l of reporter((async function* () { yield* evs; })())) out += l;
  assert.match(out, /^::error file=[^,]*y\.test\.mjs,line=7,title=t::boom more\n$/);
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
  const order = ['--test-reporter=./test/reporters/github.mjs', 'node scripts/validate.mjs', 'gen-wrappers.mjs --check', 'setup ruffle --yes', 'setup jsdos --yes', 'setup easyrpg --yes', 'setup love --yes', 'npm run e2e', 'upload-artifact'].map((s) => y.indexOf(s));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), `step order ${order}`);
  assert.match(y, /run: node --test --test-concurrency=1 --test-reporter=spec --test-reporter-destination=stdout --test-reporter=\.\/test\/reporters\/github\.mjs --test-reporter-destination=stdout "test\/\*\*\/\*\.test\.mjs"/, 'unit tests print spec and ::error annotations');
  assert.match(y, /^ {10}PAG_E2E_TARGET_FPS: \$\{\{ matrix\.os == 'macos-latest' && '10' \|\| '' \}\}$/m, 'R68: macOS-only fps target on the Lane e2e step');
  const laneStep = y.slice(y.indexOf('- name: Lane e2e\n'), y.indexOf('# Saved even when e2e fails'));
  assert.match(laneStep, /PAG_E2E_TARGET_FPS/, 'set on the Lane e2e step only');
  assert.equal((y.match(/PAG_E2E_TARGET_FPS/g) ?? []).length, 1);
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
