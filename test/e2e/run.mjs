// Lane e2e cases: fixture game -> survey -> newPort -> build -> pack -> verify, through the real pipeline.
// `node test/e2e/run.mjs <lane> [--runner cdp|playwright] [--headed]` runs that lane's cases (exit 0 pass or skipped, 1
// failure, 2 usage); the lane test files import CASES and run them under node:test. Tasks 17-18 add their lanes to CASES.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { annotation } from '../reporters/github.mjs';

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
const { makeAnimSwf } = await import('../fixtures/make-swf.mjs');
const { makeAnimCom } = await import('../fixtures/make-dos-com.mjs');
const { makeMZ } = await import('../fixtures/make-pe.mjs');
const { ensureTool } = await import(`${SCRIPTS}/setup.mjs`);
const { startServer } = await import(`${SCRIPTS}/serve.mjs`);
const { openCdp } = await import(`${SCRIPTS}/verify/driver-cdp.mjs`);
const { openPlaywright } = await import(`${SCRIPTS}/verify/driver-playwright.mjs`);
const { playwrightEntry } = await import(`${SCRIPTS}/verify/browser.mjs`);
const { setTimeout: sleep } = await import('node:timers/promises');

// I5: the verify runner for every case. `--runner playwright` (CI: Linux under Xvfb, `--headed`) uses the Playwright
// installed by `pag setup playwright --yes` into the e2e tool cache.
const opts = { runner: 'cdp', headed: false };

// PAG_E2E=0 turns every browser e2e case off (CI runs them once, via `npm run e2e`, not again under `npm test`).
export const skipReason = (env = process.env, runner = opts.runner) => {
  if (env.PAG_E2E === "0") return "PAG_E2E=0; browser e2e skipped";
  if (runner === 'playwright') return inToolCache(playwrightEntry) ? false : `Playwright is not installed in ${TOOL_CACHE} (PAG_CACHE=<it> pag setup playwright --yes); browser e2e skipped`;
  const b = findBrowser();
  if (!b) return 'no Chrome/Edge found (install one or set PAG_BROWSER); browser e2e skipped';
  if (typeof WebSocket !== 'function') return 'the CDP runner needs Node 22+ (global WebSocket); browser e2e skipped';
  return false;
};

// R41: runtime tools (Ruffle, js-dos) come from one cache shared by every e2e run on this machine, so each downloads once.
// Ports and every other temp dir stay per-run; the user's real cache is never touched.
export const TOOL_CACHE = path.join(tmpdir(), 'pag-e2e-tools');
export async function withToolCache(fn) {
  const prev = process.env.PAG_CACHE;
  process.env.PAG_CACHE = TOOL_CACHE;
  try { return await fn(); } finally { process.env.PAG_CACHE = prev; }
}
function inToolCache(fn) {
  const prev = process.env.PAG_CACHE;
  process.env.PAG_CACHE = TOOL_CACHE;
  try { return fn(); } finally { process.env.PAG_CACHE = prev; }
}
// Only a network/fetch failure skips; a sha mismatch, bad lock entry or extract bug must fail loudly.
// Matched on error codes and names (the error or its cause), never on words in a message, except fetch's own "fetch failed".
const NET_CODE = /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/;
const NET_NAME = /^(AbortError|TimeoutError)$/;
export const isNetworkError = (e) => [e, e?.cause].some((x) => NET_CODE.test(x?.code ?? '') || NET_NAME.test(x?.name ?? ''))
  || /fetch failed/i.test(e?.message ?? '');
// Installs the tool into the shared cache (sha-verified). `ensure` is injectable for tests.
export async function e2eTool(name, ensure = ensureTool) {
  try { return await withToolCache(() => ensure(name)); } catch (e) {
    if (!isNetworkError(e)) throw e;
    throw Object.assign(new Error(`could not download the ${name} runtime (network): ${e.message}; e2e case skipped`), { skip: true });
  }
}

let n = 0;
// PAG_E2E_KEEP=<dir>: copy each case's port (with its verify/ report) there, so CI can upload them when a case fails.
export function keepPort(portDir, tag, env = process.env) {
  if (!env.PAG_E2E_KEEP) return null;
  const to = path.join(env.PAG_E2E_KEEP, tag);
  cpSync(portDir, to, { recursive: true });
  return to;
}
const failing = (r) => JSON.stringify(r.checks.filter((c) => c.status !== 'pass'), null, 1);

// fixture(dir) makes the game install and returns its folder; the lane builds it. Returns {portDir, distDir, built, survey, report}.
export async function pipeline(laneId, fixture, { soakSec = 5, mode = 'bundled', tools = [], query = '' } = {}) {
  for (const t of tools) await e2eTool(t);
  return pipelineIn(laneId, fixture, { soakSec, mode, query });
}
async function pipelineIn(laneId, fixture, { soakSec, mode, query }) {
  const dir = path.join(base, `case-${++n}`);
  const gameDir = fixture(path.join(dir, 'install'));
  const s = await survey(gameDir);
  const portDir = path.join(dir, 'port');
  await newPort({ gameDir, outDir: portDir, lane: laneId });
  // build and pack look the tool up in PAG_CACHE
  const { built, distDir } = await withToolCache(async () => ({ built: await LANES[laneId].build(portDir), ...(await pack(portDir, { mode })) }));
  const t0 = Date.now();
  const report = await withToolCache(() => verify(distDir, { runner: opts.runner, headed: opts.headed, soakSec, query })); // Playwright lives there
  keepPort(portDir, `${laneId}-${path.basename(dir)}`);
  console.log(`# ${laneId}: verify ${report.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  assert.equal(report.runs[0].runner, opts.runner, `verify ran on ${report.runs[0].runner}, not the requested ${opts.runner} runner`);
  return { portDir, distDir, built, survey: s, report };
}

// One browser run per variant; the mixed-case case reads the NW.js run.
const runs = {};
const once = (variant) => (runs[variant] ??= pipeline('web-extract', (d) => makeWebGame(d, variant)));

async function passes(variant) {
  const r = await once(variant);
  assert.equal(r.report.status, 'pass', failing(r.report));
  assert.equal(r.built.verdict, 'GO');
  // R61: the fixture needs an inline script and eval; the relaxation is reported, not warned.
  assert.equal(r.report.checks.find((c) => c.name === 'csp')?.status, 'info', failing(r.report));
  assert.match(r.report.checks.find((c) => c.name === 'save').detail, /lane save path not exercised/); // R64
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

// package.json main is start.html: index.html is a meta-refresh, so the iframe loads two documents (input mirroring must follow).
async function redirected() {
  const r = await once('nwjs-redirect');
  assert.equal(r.report.status, 'pass', failing(r.report));
  assert.equal(r.report.checks.find((c) => c.name === 'input')?.status, 'pass', failing(r.report));
  assert.match(readFileSync(path.join(r.portDir, 'build', 'game', 'index.html'), 'utf8'), /http-equiv="refresh"/);
}

// ---- rt-ruffle (BYO): the SWF is imported into OPFS from the fixture mount; dist must hold no game bytes.
const distFiles = (d) => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath ?? e.path, e.name));
const swfInstall = (extra = {}) => (dir) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'anim.swf'), makeAnimSwf());
  for (const [name, size] of Object.entries(extra)) writeFileSync(path.join(dir, name), randomBytes(size));
  return dir;
};

async function ruffleByo() {
  const r = await pipeline('rt-ruffle', swfInstall(), { mode: 'byo', tools: ['ruffle'] });
  assert.equal(r.report.status, 'pass', failing(r.report));
  assert.equal(r.built.verdict, 'GO');
  const swf = makeAnimSwf();
  const files = distFiles(r.distDir);
  assert.ok(files.some((f) => /[\\/]runtime[\\/]rt-ruffle-[0-9a-f]{8}[\\/]ruffle\.js$/.test(f)), 'ruffle.js is in the hashed runtime folder');
  for (const f of files) {
    const b = readFileSync(f);
    assert.equal(b.includes(swf.subarray(0, 64)) || b.includes(swf.subarray(100, 164)), false, `game bytes in dist: ${f}`);
  }
  assert.equal(existsSync(path.join(r.distDir, 'game')), false, 'a byo dist has no game/ folder');
}

// Review Focus 5: an import interrupted after one file resumes; files already marked .done are not fetched again.
async function ruffleResume() {
  const MiB = 1024 * 1024;
  const r = await pipeline('rt-ruffle', swfInstall({ 'pad1.bin': MiB, 'pad2.bin': MiB }), { mode: 'byo', tools: ['ruffle'], query: 'verify_interrupt_after=1' });
  assert.equal(r.report.status, 'pass', failing(r.report));
  assert.equal(r.report.runs[0].measures.shell.state, 'running');
  const gets = {};
  for (const q of r.report.runs[0].requests) if (q.method === 'GET' && q.url.startsWith('/__fixture/')) gets[q.url] = (gets[q.url] ?? 0) + 1;
  // The reload fetches the fixture index again before any file; with the interrupt ignored the first load fetches it once.
  const all = r.report.runs[0].requests.filter((q) => q.method === 'GET').map((q) => q.url);
  assert.ok(all.filter((u) => u === '/__fixture.index.json').length >= 2, `the interrupt did not fire: ${JSON.stringify(all)}`);
  const swfAt = all.indexOf('/__fixture/anim.swf');
  assert.ok(swfAt >= 0 && swfAt < all.lastIndexOf('/__fixture.index.json') && swfAt < all.indexOf('/__fixture/pad1.bin'), `one file copied, then the page reloaded: ${JSON.stringify(all)}`);
  assert.equal(Object.keys(gets).length > 0, true, `no fixture GETs recorded: ${JSON.stringify(r.report.runs[0].requests.map((q) => q.url))}`);
  for (const [u, c] of Object.entries(gets)) assert.ok(c <= 1, `${u} fetched ${c} times`);
}

// ---- dos-jsdos (BYO): the browser zips the imported files into a .jsdos bundle; dist must hold no game bytes.
// A .COM has no header, so the survey only calls the folder DOS through an MZ file: an installer stub stands in for it.
const dosInstall = (dir) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'ANIM.COM'), makeAnimCom());
  writeFileSync(path.join(dir, 'INSTALL.EXE'), makeMZ());
  return dir;
};

const dosRun = () => (runs.dos ??= pipeline('dos-jsdos', dosInstall, { mode: 'byo', tools: ['jsdos'] }));

async function dosByo() {
  const r = await dosRun();
  assert.equal(r.report.status, 'pass', failing(r.report));
  assert.deepEqual(r.built, { lane_config: { exe: 'ANIM.COM' }, verdict: 'GO' });
  assert.match(r.report.checks.find((c) => c.name === 'save').detail, /lane saveNow ran/); // R64
  console.log(`# dos-jsdos: ${r.report.checks.filter((c) => ['ready', 'fps', 'blank', 'frozen'].includes(c.name)).map((c) => `${c.name}: ${c.detail}`).join(' | ')}`);
  const files = distFiles(r.distDir);
  const rt = files.map((f) => path.relative(r.distDir, f).split(path.sep).join('/')).filter((f) => f.startsWith('runtime/')).sort();
  assert.match(rt[0] ?? '', /^runtime\/dos-jsdos-[0-9a-f]{8}\//);
  assert.deepEqual(rt.map((f) => f.replace(/^runtime\/[^/]+\//, '')), ['adapter.js', 'dist/emulators/emulators.js', 'dist/emulators/wdosbox.js', 'dist/emulators/wdosbox.wasm', 'dist/emulators/wlibzip.js', 'dist/emulators/wlibzip.wasm', 'package.json']);
  const com = makeAnimCom();
  for (const f of files) {
    const b = readFileSync(f);
    assert.equal(b.includes(com.subarray(0, 28)) || b.includes(com.subarray(27)), false, `game bytes in dist: ${f}`);
  }
  assert.equal(existsSync(path.join(r.distDir, 'game')), false, 'a byo dist has no game/ folder');
  const lic = readFileSync(path.join(r.distDir, 'LICENSES', 'js-dos.txt'), 'utf8');
  assert.match(lic, /^js-dos 8\.5\.4\nLicense: GPL-2\.0\nSource: https:\/\/github\.com\/caiiiycuk\/js-dos\n/);
  assert.match(lic, /complete corresponding source code is available at https:\/\/github\.com\/caiiiycuk\/js-dos \(tag\/version 8\.5\.4\)/);
  assert.match(lic, /GNU GENERAL PUBLIC LICENSE\s+Version 2, June 1991/, 'the GPL-2.0 text itself');
}

// I4/R64: a file written into the DOS disk survives a reload (ci.persist -> OPFS saves folder -> second bundle), and a
// later save keeps the earlier one. Drives the packed build directly (one browser profile, so OPFS survives reloads).
async function dosSaves() {
  const r = await dosRun();
  const manifest = JSON.parse(readFileSync(path.join(r.distDir, 'pag-manifest.json'), 'utf8'));
  const srv = await startServer({ root: r.distDir, fixtureDir: path.join(r.portDir, 'game'), fixtureIndex: manifest.files.map((f) => ({ path: f.path, size: f.size })), log: () => {} });
  const d = opts.runner === 'playwright' ? await withToolCache(() => openPlaywright({ headless: !opts.headed }))
    : await openCdp({ path: findBrowser().path, headless: !opts.headed });
  try {
    const ev = (fn, arg) => d.evaluate(fn.toString(), arg);
    const until = async (fn, what) => {
      for (const end = Date.now() + 90000; Date.now() < end; await sleep(200)) if (await ev(fn).catch(() => false)) return;
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify(await ev(() => [window.__shell?.state, window.__shell?.stats.lastError]).catch(() => null))}`);
    };
    const play = async () => {
      await until(() => window.__shell?.state === 'ready', 'ready');
      const at = await ev(() => { const b = document.getElementById('play').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await d.click(at.x, at.y);
      await until(() => window.__shell?.state === 'running' && window.__shell.stats.gameFrames > 0, 'the first DOS frame');
    };
    const save = (name, text) => ev(async ([n, t]) => {
      await window.__shell.lane.debugCi().fsWriteFile(n, new TextEncoder().encode(t));
      return window.__shell.lane.saveNow();
    }, [name, text]);
    const read = (names) => ev(async (ns) => {
      const ci = window.__shell.lane.debugCi();
      const one = (n) => Promise.race([ci.fsReadFile(n).then((b) => new TextDecoder().decode(b)), new Promise((res) => setTimeout(() => res('(no file)'), 5000))]);
      const out = [];
      for (const n of ns) out.push(await one(n).catch((e) => `error: ${e.message}`));
      return out;
    }, names);
    await d.open(`${srv.url}/?verify=1&verify_import=/__fixture/`);
    await play();
    assert.ok((await save('PAGSAVE1.DAT', 'one')).bytes > 0, 'saveNow wrote the changes');
    await d.reload();
    await play();
    assert.deepEqual(await read(['PAGSAVE1.DAT']), ['one'], 'the save survived a reload');
    await save('PAGSAVE2.DAT', 'two');
    await d.reload();
    await play();
    assert.deepEqual(await read(['PAGSAVE1.DAT', 'PAGSAVE2.DAT']), ['one', 'two'], 'a later save keeps the earlier one');
  } finally {
    await d.close();
    await srv.close();
  }
}

const LANE_CASES = {
  'web-extract': [
    { name: 'web-extract NW.js fixture passes verify', run: () => passes('nwjs') },
    { name: 'web-extract Electron fixture passes verify', run: () => passes('electron') },
    { name: 'web-extract fixture with mixed-case refs passes', run: mixedCase },
    { name: 'web-extract redirected main (start.html) passes verify incl. input', run: redirected },
  ],
  'rt-ruffle': [
    { name: 'rt-ruffle BYO fixture passes verify with zero game bytes in dist', run: ruffleByo },
    { name: 'rt-ruffle import resumes after interrupted import', run: ruffleResume },
  ],
  'dos-jsdos': [
    { name: 'dos-jsdos BYO fixture passes verify with zero game bytes in dist', run: dosByo },
    { name: 'dos-jsdos saves survive a reload (ci.persist to OPFS, second bundle)', run: dosSaves },
  ],
};

// 'all' = every lane's cases, in lane order.
export const CASES = { ...LANE_CASES, all: Object.values(LANE_CASES).flat() };

// Exit code when the browser e2e cannot run: a skip is 0, unless CI demands a browser (PAG_E2E_REQUIRE_BROWSER=1) and one is missing.
export const skipExit = (why, env = process.env) => (why && env.PAG_E2E_REQUIRE_BROWSER === '1' && !/PAG_E2E=0/.test(why) ? 1 : 0);

const USAGE = `usage: node test/e2e/run.mjs <${Object.keys(CASES).join('|')}> [--runner cdp|playwright] [--headed]`;
export function parseE2eArgs(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { runner: { type: 'string', default: 'cdp' }, headed: { type: 'boolean', default: false } } });
  if (positionals.length !== 1 || !CASES[positionals[0]]) throw new Error(USAGE);
  if (!['cdp', 'playwright'].includes(values.runner)) throw new Error(`unknown runner '${values.runner}'\n${USAGE}`);
  return { target: positionals[0], runner: values.runner, headed: values.headed };
}

// GitHub Actions: an ::error annotation per failed case, so a red run names it without the job log.
const ghError = (title, msg) => { if (process.env.GITHUB_ACTIONS === 'true') process.stdout.write(annotation({ name: title, message: String(msg).split('\n')[0] })); };
async function main(argv) {
  let a;
  try { a = parseE2eArgs(argv); } catch (e) { console.error(e.message); return 2; }
  Object.assign(opts, { runner: a.runner, headed: a.headed });
  const cases = CASES[a.target];
  const why = skipReason();
  if (why) { const code = skipExit(why); console.log(`${code ? 'FAIL' : 'SKIP'} ${a.target}: ${why}${code ? ' (PAG_E2E_REQUIRE_BROWSER=1)' : ''}`); if (code) ghError(a.target, why); return code; }
  console.log(`# runner ${a.runner}${a.headed ? ', headed' : ''}`);
  let failed = 0;
  for (const c of cases) {
    try { await c.run(); console.log(`ok   ${c.name}`); } catch (e) {
      if (e?.skip) { console.log(`SKIP ${c.name}: ${e.message}`); continue; } failed++; console.log(`FAIL ${c.name}\n${e.stack ?? e}`); }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 1;
  try { code = await main(process.argv.slice(2)); } finally { cleanup(); }
  process.exit(code);
}
