// Rung 3: LÖVE games run on love.js 11.4.1 (LÖVE 11.4 in wasm, MIT; the compat build, from the user's tool cache).
// BYO: the adapter writes the user's .love, or the zip inside a fused exe, into love.js's file system; dist never holds
// game bytes. build() finds the container, reads conf.lua's t.version and writes build/lane.json; no game file is written.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listZip, zipEntryData } from '../lib/archive.mjs';
import { loadLock, toolDir } from '../setup.mjs';

const TOOL = 'love.js';

const isFile = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() === true;
const depth = (rel) => rel.split('/').length;
const nameList = (entries) => entries.map((e) => e.name).join('\n');

// The zip start in a .love or a fused exe. A `copy /b love.exe+game.love` exe keeps zip-relative offsets, so the bytes
// from the first entry on are the .love itself. An exe whose offsets were made absolute (Info-ZIP -A) does not re-parse
// once sliced; it is passed whole (offset 0), and love.js's PhysFS finds the zip from the end (spike g Q4).
export function loveContainer(buf) {
  let entries;
  try { entries = listZip(buf); } catch { throw new Error('not a LÖVE game: no zip found'); }
  if (!entries.some((e) => e.name === 'main.lua')) throw new Error('main.lua is not at the root of the game zip');
  const start = Math.min(...entries.map((e) => e.offset));
  let same = false;
  try { same = start > 0 && nameList(listZip(buf.subarray(start))) === nameList(entries); } catch { /* absolute offsets */ }
  return { offset: same ? start : 0 };
}

// Spike g Q5: love.js runs LÖVE 11.4, whose compatibility list is 11.0-11.4. No native code exists on the web.
export function loveVerdict({ conf, lua, names }) {
  const code = (conf ?? '').replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--.*/g, '');
  const version = /\b[A-Za-z_]\w*\.version\s*=\s*["'](\d+\.\d+(?:\.\d+)?)["']/.exec(code)?.[1] ?? null;
  const out = (verdict, why) => ({ version, verdict, why });
  const native = names.find((n) => /\.(dll|so|dylib)$/i.test(n));
  if (native) return out('NO', `the game zip carries native code (${native}); the browser cannot load it`);
  if (/\brequire\s*\(?\s*["']ffi["']|\bpackage\.loadlib\b/.test(lua)) return out('NO', 'the game calls native code (ffi or package.loadlib), which love.js does not have');
  if (!version) return out('HARD', 'conf.lua sets no t.version, so the LÖVE version is unknown; love.js runs 11.4');
  const [major, minor] = version.split('.').map(Number);
  if (major === 11 && minor <= 4) return out('GO', `made for LÖVE ${version}; love.js runs 11.4`);
  if (major === 11 && minor === 5) return out('GO', 'made for LÖVE 11.5 and run on the 11.4 runtime: a few 11.5-only functions may be missing');
  if (major === 0 || major === 10) return out('HARD', `made for LÖVE ${version}; it runs on 11.4 but older games often draw wrong (0-255 colours) or call removed functions`);
  if (major === 12) return out('NO', `made for LÖVE ${version}; love.js has only 11.4`);
  return out('HARD', `unknown LÖVE version ${version}; love.js runs 11.4`);
}

// In order: the shallowest loose *.love; else a survey exe with a zip overlay (the main one first); else a macOS
// .app/Contents/Resources/*.love.
function findContainer(dir, game) {
  const loves = readdirSync(game, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.love$/i.test(e.name))
    .map((e) => path.relative(game, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/'))
    .sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : 1));
  const loose = loves.find((p) => !/\.app\//i.test(p));
  if (loose) return loose;
  let survey = {};
  try { survey = JSON.parse(readFileSync(path.join(dir, 'survey.json'), 'utf8')); } catch { /* no survey */ }
  const exe = (survey.executables ?? []).filter((e) => e.overlay?.magic === 'zip' && isFile(path.join(game, e.path))).sort((a, b) => (b.role === 'main') - (a.role === 'main'))[0];
  if (exe) return exe.path.split('\\').join('/');
  const app = loves.find((p) => /\.app\/Contents\/Resources\/[^/]+\.love$/i.test(p));
  if (app) return app;
  throw new Error('no LÖVE game found in game/: no .love file, no exe with a zip appended (see survey.json) and no .app/Contents/Resources/*.love');
}

export default {
  id: 'rebuild-love', rung: 3, available: true, milestone: 'M2', dataModes: ['byo'],
  acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], odds: '60-80%',
  checklist: ['Find the game (.love, fused exe or .app) and read conf.lua', 'Check the LÖVE version and native code', 'Bundle love.js in the shell', 'Verify frames, input and saves'],
  detect(s) {
    const hit = (s.engines ?? []).some((e) => e.id === 'love');
    return hit ? { verdict: 'GO', why: 'LÖVE game; version checked by pag build' } : { verdict: 'NO', why: 'no LÖVE game found' };
  },
  // The compat build: the threaded one needs SharedArrayBuffer, so COOP/COEP (spike g Q3).
  runtime: { tool: TOOL, files: ['src/compat/love.js', 'src/compat/love.wasm'] },
  async build(portDir) {
    const dir = path.resolve(portDir);
    if (!existsSync(path.join(toolDir(loadLock()[TOOL]), '.ok'))) throw new Error('the love.js runtime is not installed; run: pag setup love --yes');
    const game = path.join(dir, 'game');
    const file = findContainer(dir, game);
    // ponytail: reads the whole container; a fused exe of several hundred MB still fits in memory.
    const buf = readFileSync(path.join(game, file));
    const { offset } = loveContainer(buf);
    const entries = listZip(buf).filter((e) => !e.name.endsWith('/'));
    const text = (e) => zipEntryData(buf, e).toString('utf8');
    const conf = entries.find((e) => e.name === 'conf.lua');
    const v = loveVerdict({ conf: conf ? text(conf) : null, lua: entries.filter((e) => /\.lua$/i.test(e.name)).map(text).join('\n'), names: entries.map((e) => e.name) });
    const lane_config = { file, offset, version: v.version };
    mkdirSync(path.join(dir, 'build'), { recursive: true });
    writeFileSync(path.join(dir, 'build', 'lane.json'), `${JSON.stringify(lane_config, null, 2)}\n`);
    appendFileSync(path.join(dir, 'PORTING_LOG.md'), [
      '', `## rebuild-love build (${new Date().toISOString().slice(0, 10)})`, '',
      `- Game: game/${file}${offset ? ` (the zip starts at byte ${offset})` : ''}; LÖVE ${v.version ?? 'version unknown'}`,
      `- Verdict ${v.verdict}: ${v.why}`, '',
    ].join('\n'));
    return { lane_config, verdict: v.verdict, why: v.why };
  },
  shell(_port, { portDir } = {}) {
    let lane_config;
    try { lane_config = JSON.parse(readFileSync(path.join(portDir, 'build', 'lane.json'), 'utf8')); } catch { /* not built yet: pack refuses */ }
    return {
      ...(lane_config ? { lane_config } : {}),
      needs_coi: false,
      verify: { target_fps: 30, inputs: ['Click', 'Enter', 'Space'], audio_on_title: false, budget_ready_s: 30 },
    };
  },
};
