// Rung 3: Ren'Py 8 games are rebuilt with the pinned Ren'Py SDK's own headless `web_build` (from the user's tool
// cache) and served like web-extract: build/game in a same-origin iframe. Bundled: game.zip holds the user's game.
// The build runs the game's init Python once on this machine, as launching the game would (spike h §2).
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLock, toolDir } from '../setup.mjs';
import { finishWebBuild } from './web-extract.mjs';

const SDK = loadLock().renpy.version; // static package data, read once so detect stays pure
const ADAPTER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'lanes', 'web-extract', 'adapter.js');
// The 8.6.1 build's PWA layer: service-worker.js, manifest.json, pwa_catalog.json (its precache list) and icons/
// (icon-{72,96,128,144,152,192,384,512} squared, each plain and -maskable). The shell is the page, so none is needed.
const PWA = new Set(['service-worker.js', 'manifest.json', 'pwa_catalog.json', 'icons']);
const SW_CALL = /navigator\.serviceWorker\.register\([^)]*\);?/g;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi;

const isDir = (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
const segs = (v) => v.split('.').map(Number);

export function renpyVerdict(version, sdk) {
  if (!version) return { verdict: 'HARD', why: 'version unknown; pag build checks game/script_version.txt' };
  const v = segs(version), s = segs(sdk);
  const cmp = s.map((x, i) => Math.sign((v[i] ?? 0) - x)).find((d) => d !== 0) ?? 0;
  if (cmp > 0) return { verdict: 'HARD', why: `needs Ren'Py ${version} or newer; pinned SDK is ${sdk}` };
  if (v[0] === s[0]) return { verdict: 'GO', why: `Ren'Py ${version}; the pinned SDK is ${sdk}` };
  if (v[0] === 7) return { verdict: 'HARD', why: "needs the Ren'Py 7 SDK, not pinned yet" };
  return { verdict: 'HARD', why: `Ren'Py ${version} is older than 7; no SDK for it is pinned` };
}

// game/script_version.txt, written by the SDK's distribute step: "(8, 1, 3)".
export function scriptVersion(text) {
  const m = /^\s*\(\s*(\d+(?:\s*,\s*\d+)*)\s*,?\s*\)/.exec(text);
  return m ? m[1].split(',').map((x) => x.trim()).join('.') : null;
}

export function renpyCommand(sdkDir, project, dest, platform = process.platform, arch = process.arch) {
  const py = platform === 'win32' ? path.join('py3-windows-x86_64', 'python.exe')
    : platform === 'darwin' ? path.join('py3-mac-universal', 'python')
      : path.join(`py3-linux-${arch === 'arm64' ? 'aarch64' : 'x86_64'}`, 'python');
  return { file: path.join(sdkDir, 'lib', py), args: [path.join(sdkDir, 'renpy.py'), path.join(sdkDir, 'launcher'), 'web_build', project, '--destination', dest] };
}

// Drops the debug map and the PWA layer, and the service-worker registration from index.html's inline script; every
// other byte of the page stays (latin1 is one char per byte).
export function cleanWebBuild(dir) {
  for (const f of readdirSync(dir)) if (PWA.has(f) || f.endsWith('.symbols')) rmSync(path.join(dir, f), { recursive: true, force: true });
  const index = path.join(dir, 'index.html');
  writeFileSync(index, readFileSync(index, 'latin1').replace(INLINE_SCRIPT, (s) => s.replace(SW_CALL, '')), 'latin1');
}

// Saves persist in the browser (IDBFS) only under config.save_directory; without it they stay in memory (spike h §5).
function saveWarning(game) {
  const rpy = readdirSync(game, { recursive: true }).filter((f) => /\.rpy$/i.test(f));
  if (!rpy.length) return 'the game ships only compiled scripts, so whether it sets config.save_directory is unknown; without it saves are lost on reload';
  const set = rpy.some((f) => /^[ \t]*(define\s+)?config\.save_directory\s*=\s*['"]/m.test(readFileSync(path.join(game, f), 'utf8')));
  return set ? null : 'no config.save_directory in game/*.rpy: saves are lost on reload';
}

export default {
  id: 'rebuild-renpy', rung: 3, available: true, milestone: 'M2', dataModes: ['bundled'], requiresBuild: true,
  acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], odds: '65-85%',
  checklist: ["Check the Ren'Py version against the pinned SDK", "Rebuild game/ with the SDK's web_build", 'Serve the web build and verify frames and input', 'Check saves survive a reload'],
  detect(s) {
    const hit = (s.engines ?? []).find((e) => e.id === 'renpy');
    return hit ? renpyVerdict(hit.version, SDK) : { verdict: 'NO', why: "no Ren'Py game found" };
  },
  // The web runtime travels inside the build output; the tool is named so pack writes its licence (files: [] copies none).
  runtime: { tool: 'renpy', files: [] },
  adapter: ADAPTER,
  async build(portDir, { spawn = spawnSync } = {}) {
    const dir = path.resolve(portDir);
    const sdk = toolDir(loadLock().renpy);
    if (!existsSync(path.join(sdk, '.ok'))) throw new Error("the Ren'Py SDK is not installed; run: pag setup renpy --yes");
    const build = path.join(dir, 'build');
    const project = path.join(build, 'renpy-project');
    const tmp = path.join(build, `.tmp-${process.pid}`);
    const { file, args } = renpyCommand(sdk, project, tmp);
    // Spike h §1: no Linux arm64 python in the 8.6.1 SDK zip (design §8: say why, do not fail obscurely).
    if (!existsSync(file)) throw new Error(`the Ren'Py ${SDK} SDK has no Python for ${process.platform}-${process.arch}: it ships Python only for Windows x64, macOS (universal) and Linux x64, so rebuild-renpy cannot build on this computer`);
    const game = path.join(dir, 'game', 'game');
    if (!isDir(game)) throw new Error("no Ren'Py game/ folder in the install: point pag new at the folder that holds game/ (and renpy/)");
    let survey = {};
    try { survey = JSON.parse(readFileSync(path.join(dir, 'survey.json'), 'utf8')); } catch { /* no survey */ }
    let version = survey.engines?.find((e) => e.id === 'renpy')?.version ?? null;
    if (!version) try { version = scriptVersion(readFileSync(path.join(game, 'script_version.txt'), 'utf8')); } catch { /* none */ }
    const v = renpyVerdict(version, SDK);

    const out = path.join(build, 'game');
    for (const p of [out, path.join(build, 'lane.json'), project, tmp, `${tmp}.zip`]) rmSync(p, { recursive: true, force: true, maxRetries: 2 });
    // The SDK writes into the project (log, cache, .rpyc), so it builds a copy; a link could pull files from outside the game.
    cpSync(game, path.join(project, 'game'), { recursive: true, filter: (src) => !lstatSync(src).isSymbolicLink() });
    try {
      const r = spawn(file, args, { env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy' }, timeout: 600000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
      const output = [r.stdout, r.stderr, r.error?.message].filter(Boolean).join('\n'); // error: e.g. the timeout
      if (/Web support is not available/.test(output)) throw new Error(`Ren'Py web support is not available in the installed SDK; delete ${sdk} and run: pag setup renpy --yes`);
      if (r.error || r.status !== 0) {
        const tail = output.split(/\r\n|\r|\n/).filter((l) => l.trim()).slice(-20).join('\n'); // progress lines end in \r
        throw new Error(`Ren'Py web build failed (exit ${r.status ?? r.error?.code ?? r.signal}): ${tail}`);
      }
      cleanWebBuild(tmp);
      finishWebBuild(tmp, out);
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 2 });
      throw e; // the project copy stays for its log.txt and traceback.txt
    } finally {
      rmSync(`${tmp}.zip`, { force: true });
    }
    rmSync(project, { recursive: true, force: true, maxRetries: 2 });

    const lane_config = { game_version: version, sdk_version: SDK };
    writeFileSync(path.join(build, 'lane.json'), `${JSON.stringify(lane_config, null, 2)}\n`);
    const warning = saveWarning(game);
    appendFileSync(path.join(dir, 'PORTING_LOG.md'), [
      '', `## rebuild-renpy build (${new Date().toISOString().slice(0, 10)})`, '',
      `- Ren'Py ${version ?? 'version unknown'}, rebuilt with SDK ${SDK} into build/game`,
      `- Verdict ${v.verdict}: ${v.why}`,
      warning ? `- Warning: ${warning}` : '- Saves: config.save_directory is set; saves persist in the browser', '',
    ].join('\n'));
    return { lane_config, verdict: v.verdict, why: v.why, ...(warning ? { warning } : {}) };
  },
  shell: () => ({
    // Spike h §4: the page's inline script sets game.zip's URL, and Ren'Py calls emscripten.run_script (eval).
    csp: { 'script-src': ["'unsafe-eval'", "'unsafe-inline'"] },
    needs_coi: false,
    // Ren'Py draws about 10 frames per second when idle and never calls requestAnimationFrame (the hook counts WebGL draws).
    verify: { target_fps: 5, inputs: ['ArrowDown', 'Enter', 'Click', 'Enter'], audio_on_title: false, budget_ready_s: 30 },
  }),
};
