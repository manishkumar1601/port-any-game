// Lane e2e cases: fixture game -> survey -> newPort -> build -> pack -> verify, through the real pipeline.
// `node test/e2e/run.mjs <lane>` runs that lane's cases (exit 0 pass or skipped, 1 failure, 2 usage); the lane test
// files import CASES and run them under node:test. Tasks 17-18 add their lanes to CASES.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = '../../skills/port-any-game/scripts';

// Temp PAG_CACHE/PAG_HOME for the whole process; call cleanup() when done.
const base = mkdtempSync(path.join(tmpdir(), 'pag-e2e-'));
process.env.PAG_CACHE = path.join(base, 'cache');
process.env.PAG_HOME = path.join(base, 'home');
export const cleanup = () => rmSync(base, { recursive: true, force: true, maxRetries: 5 });

const { findBrowser } = await import(`${SCRIPTS}/verify/browser.mjs`);
const { survey } = await import(`${SCRIPTS}/survey/survey.mjs`);
const { newPort } = await import(`${SCRIPTS}/new.mjs`);
const { LANES } = await import(`${SCRIPTS}/lanes/index.mjs`);
const { pack } = await import(`${SCRIPTS}/pack.mjs`);
const { verify } = await import(`${SCRIPTS}/verify/verify.mjs`);
const { makeWebGame } = await import('../fixtures/make-web-game.mjs');

export const skipReason = () => {
  const b = findBrowser();
  if (!b) return 'no Chrome/Edge found (install one or set PAG_BROWSER); browser e2e skipped';
  if (typeof WebSocket !== 'function') return 'the CDP runner needs Node 22+ (global WebSocket); browser e2e skipped';
  return false;
};

let n = 0;
const failing = (r) => JSON.stringify(r.checks.filter((c) => c.status !== 'pass'), null, 1);

// fixture(dir) makes the game install and returns its folder; the lane builds it. Returns {portDir, distDir, built, survey, report}.
export async function pipeline(laneId, fixture, { soakSec = 5 } = {}) {
  const dir = path.join(base, `case-${++n}`);
  const gameDir = fixture(path.join(dir, 'install'));
  const s = await survey(gameDir);
  const portDir = path.join(dir, 'port');
  await newPort({ gameDir, outDir: portDir, lane: laneId });
  const built = await LANES[laneId].build(portDir);
  const { distDir } = await pack(portDir, { mode: 'bundled' });
  const t0 = Date.now();
  const report = await verify(distDir, { runner: 'cdp', soakSec });
  console.log(`# ${laneId}: verify ${report.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { portDir, distDir, built, survey: s, report };
}

// One browser run per variant; the mixed-case case reads the NW.js run.
const runs = {};
const once = (variant) => (runs[variant] ??= pipeline('web-extract', (d) => makeWebGame(d, variant)));

async function passes(variant) {
  const r = await once(variant);
  assert.equal(r.report.status, 'pass', failing(r.report));
  assert.equal(r.built.verdict, 'GO');
}

// Review Focus 3: the mixed-case reference is served through caseFallback, so no request fails.
async function mixedCase() {
  const r = await once('nwjs');
  assert.equal(r.report.status, 'pass', failing(r.report));
  assert.equal(r.built.caseFixes, 1, 'the Img/Title.PNG reference');
  assert.equal(r.report.checks.find((c) => c.name === 'requests')?.status, 'pass', failing(r.report));
  const got = r.report.runs.flatMap((x) => x.measures.requests);
  assert.deepEqual(got.filter((q) => q.status === 0 || q.status >= 400), []);
  const title = got.find((q) => /\/game\/Img\/Title\.PNG$/.test(q.url));
  assert.equal(title?.status, 200, `title image: ${JSON.stringify(got.map((q) => [q.url, q.status]))}`);
}

export const CASES = {
  'web-extract': [
    { name: 'web-extract NW.js fixture passes verify', run: () => passes('nwjs') },
    { name: 'web-extract Electron fixture passes verify', run: () => passes('electron') },
    { name: 'web-extract fixture with mixed-case refs passes', run: mixedCase },
  ],
};

async function main(argv) {
  const cases = CASES[argv[0]];
  if (!cases) { console.error(`usage: node test/e2e/run.mjs <${Object.keys(CASES).join('|')}>`); return 2; }
  const why = skipReason();
  if (why) { console.log(`SKIP ${argv[0]}: ${why}`); return 0; }
  let failed = 0;
  for (const c of cases) {
    try { await c.run(); console.log(`ok   ${c.name}`); } catch (e) { failed++; console.log(`FAIL ${c.name}\n${e.stack ?? e}`); }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 1;
  try { code = await main(process.argv.slice(2)); } finally { cleanup(); }
  process.exit(code);
}
