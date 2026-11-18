import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, cleanup, skipReason } from '../e2e/run.mjs'; // sets temp PAG_CACHE / PAG_HOME

const { survey } = await import('../../skills/port-any-game/scripts/survey/survey.mjs');
const { newPort } = await import('../../skills/port-any-game/scripts/new.mjs');
const { LANES } = await import('../../skills/port-any-game/scripts/lanes/index.mjs');
const { loadLock, toolDir } = await import('../../skills/port-any-game/scripts/setup.mjs');
const { renpyVerdict, scriptVersion, renpyCommand, cleanWebBuild } = await import('../../skills/port-any-game/scripts/lanes/rebuild-renpy.mjs');
const { makeRenpy } = await import('../fixtures/make-renpy.mjs');
const lane = LANES['rebuild-renpy'];
const WEB_EXTRACT_ADAPTER = fileURLToPath(new URL('../../skills/port-any-game/assets/lanes/web-extract/adapter.js', import.meta.url));

const tmp = mkdtempSync(path.join(tmpdir(), 'pag-renpy-'));
after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }); cleanup(); });
let n = 0;
const dirOf = () => path.join(tmp, `t${++n}`, 'install');

async function portOf(gameDir) {
  const portDir = path.join(path.dirname(gameDir), 'port');
  await newPort({ gameDir, outDir: portDir, lane: 'rebuild-renpy' });
  return portDir;
}
// Pretends `pag setup renpy` ran (the temp PAG_CACHE): build only checks for the .ok marker.
const fakeTool = () => { const d = toolDir(loadLock().renpy); mkdirSync(d, { recursive: true }); writeFileSync(path.join(d, '.ok'), ''); return d; };

// The structure of the 8.6.1 web build's index.html (observed in spike h), written by us; the title has a non-ASCII byte.
const REGISTER = "navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'all' });";
const INDEX = `<!doctype html>
<html lang="en-us">

<head>
  <meta charset="utf-8">
  <title>Café</title>
  <link rel="manifest" href="manifest.json" crossorigin="use-credentials" />
  <link rel="icon" href="icons/icon-72x72.png" sizes="72x72" type="image/png" />
</head>

<body>
  <canvas id="canvas" oncontextmenu="event.preventDefault()" tabindex=-1></canvas>
  <script>
      // The URL to game.zip, relative to the URL of this file.
      window.gameZipURL = 'game.zip';

      // Register the service worker.
      if (navigator.serviceWorker) {
          if (!navigator.serviceWorker.controller) {
              ${REGISTER}
          }
      }
  </script>
  <script src="renpy-pre.js"></script>
  <script async type="text/javascript" src="renpy.js"></script>
</body>

</html>
`;
function writeWebBuild(dir) {
  mkdirSync(path.join(dir, 'icons'), { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), INDEX);
  for (const f of ['renpy.wasm', 'renpy.js', 'game.zip', 'web-presplash.jpg', 'index.html.symbols', 'service-worker.js', 'manifest.json', 'pwa_catalog.json', 'icons/icon-72x72.png', 'icons/icon-72x72-maskable.png']) {
    writeFileSync(path.join(dir, ...f.split('/')), 'x');
  }
}

// A stand-in for spawnSync: records the call and, on success, writes a web build where the SDK would.
const fakeSpawn = (calls, { status = 0, stdout = '', stderr = '', error } = {}) => (file, args, opts) => {
  calls.push({ file, args, opts, script: existsSync(path.join(args[3], 'game', 'script.rpy')), install: existsSync(path.join(args[3], 'renpy')) });
  if (status === 0) {
    writeWebBuild(args[5]);
    writeFileSync(`${args[5]}.zip`, 'zip');
  }
  return { status, stdout, stderr, error };
};

test("survey reads the Ren'Py version and picks rebuild-renpy", async () => {
  const s = await survey(makeRenpy(dirOf()));
  assert.equal(s.engines.find((e) => e.id === 'renpy')?.version, '8.6.1.26111705');
  assert.ok(s.lanes.some((l) => l.lane === 'rebuild-renpy' && l.verdict === 'GO'), JSON.stringify(s.lanes));
  assert.equal(s.verdict.primary_lane, 'rebuild-renpy');
  assert.deepEqual([lane.rung, lane.available, lane.milestone, lane.dataModes, lane.acks, lane.odds, lane.requiresBuild], [3, true, 'M2', ['bundled'], ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], '65-85%', true]);
  assert.deepEqual(lane.runtime, { tool: 'renpy', files: [] });
  assert.equal(lane.adapter, WEB_EXTRACT_ADAPTER);
  assert.equal(lane.detect({ engines: [{ id: 'renpy', version: '7.4.11' }] }).verdict, 'HARD');
  assert.equal(lane.detect({ engines: [{ id: 'love' }] }).verdict, 'NO');
});

test('renpyVerdict compares by numeric segments against the pinned SDK', () => {
  const v = (x) => renpyVerdict(x, '8.6.1');
  assert.equal(v('8.1.3.23091805').verdict, 'GO');
  assert.equal(v('8.6.1.26111705').verdict, 'GO');
  assert.equal(v('8.10.0').verdict, 'HARD', 'numeric, not text: 10 > 6');
  assert.deepEqual(v('8.7.0'), { verdict: 'HARD', why: "needs Ren'Py 8.7.0 or newer; pinned SDK is 8.6.1" });
  assert.deepEqual([v('7.8.7').verdict, v('7.8.7').why], ['HARD', "needs the Ren'Py 7 SDK, not pinned yet"]);
  assert.equal(v('6.99.14').verdict, 'HARD');
  assert.equal(v('9.0.0').verdict, 'HARD');
  assert.deepEqual(v(null), { verdict: 'HARD', why: 'version unknown; pag build checks game/script_version.txt' });
});

test('scriptVersion reads game/script_version.txt', () => {
  assert.equal(scriptVersion('(8, 1, 3)'), '8.1.3');
  assert.equal(scriptVersion('(7, 4, 11)\n'), '7.4.11');
  assert.equal(scriptVersion('garbage'), null);
  assert.equal(scriptVersion(''), null);
});

test('renpyCommand picks the python of each OS and keeps paths with spaces as single arguments', () => {
  const sdk = path.join(tmp, 'my tools', 'renpy-8.6.1');
  const proj = path.join(tmp, 'my port', 'build', 'renpy-project');
  const dest = path.join(tmp, 'my port', 'build', '.tmp-1');
  const args = [path.join(sdk, 'renpy.py'), path.join(sdk, 'launcher'), 'web_build', proj, '--destination', dest];
  assert.deepEqual(renpyCommand(sdk, proj, dest, 'win32', 'x64'), { file: path.join(sdk, 'lib', 'py3-windows-x86_64', 'python.exe'), args });
  assert.equal(renpyCommand(sdk, proj, dest, 'darwin', 'arm64').file, path.join(sdk, 'lib', 'py3-mac-universal', 'python'));
  assert.equal(renpyCommand(sdk, proj, dest, 'linux', 'x64').file, path.join(sdk, 'lib', 'py3-linux-x86_64', 'python'));
  assert.equal(renpyCommand(sdk, proj, dest, 'linux', 'arm64').file, path.join(sdk, 'lib', 'py3-linux-aarch64', 'python'));
  assert.deepEqual(renpyCommand(sdk, proj, dest).args, args);
});

test('cleanWebBuild drops the service-worker registration and PWA files', () => {
  const d = path.join(tmp, 'clean');
  writeWebBuild(d);
  cleanWebBuild(d);
  assert.deepEqual(readdirSync(d).sort(), ['game.zip', 'index.html', 'renpy.js', 'renpy.wasm', 'web-presplash.jpg']);
  assert.deepEqual(readFileSync(path.join(d, 'index.html')), Buffer.from(INDEX.replace(REGISTER, '')), 'only the register call goes; every other byte stays');
});

test('build runs the SDK with dummy SDL drivers and finishes the web build', async () => {
  const sdk = fakeTool();
  const portDir = await portOf(makeRenpy(dirOf()));
  const calls = [];
  const r = await lane.build(portDir, { spawn: fakeSpawn(calls) });
  assert.deepEqual(r, { lane_config: { game_version: '8.6.1.26111705', sdk_version: '8.6.1' }, verdict: 'GO', why: "Ren'Py 8.6.1.26111705; the pinned SDK is 8.6.1" });
  assert.equal(calls.length, 1);
  const [{ file, args, opts, script, install }] = calls;
  const build = path.join(portDir, 'build');
  assert.deepEqual({ file, args }, renpyCommand(sdk, path.join(build, 'renpy-project'), args[5]));
  assert.match(path.basename(args[5]), /^\.tmp-\d+$/);
  assert.deepEqual([opts.env.SDL_VIDEODRIVER, opts.env.SDL_AUDIODRIVER, opts.env.PATH ?? opts.env.Path], ['dummy', 'dummy', process.env.PATH ?? process.env.Path]);
  assert.equal(opts.shell, undefined, 'no shell');
  assert.equal(opts.timeout, 600000);
  assert.deepEqual([script, install], [true, false], "the project copy holds the game's game/ only");
  assert.ok(existsSync(path.join(build, 'game', '__pag_hook.js')));
  const html = readFileSync(path.join(build, 'game', 'index.html'), 'utf8');
  assert.match(html, /<head><script src="__pag_hook\.js"><\/script>/);
  assert.ok(!html.includes('serviceWorker.register'));
  assert.ok(!existsSync(path.join(build, 'game', 'service-worker.js')));
  assert.deepEqual(readdirSync(build).sort(), ['game', 'lane.json'], 'no temp folder, sibling zip or project copy left');
  assert.deepEqual(JSON.parse(readFileSync(path.join(build, 'lane.json'), 'utf8')), r.lane_config);
  const log = readFileSync(path.join(portDir, 'PORTING_LOG.md'), 'utf8');
  assert.match(log, /rebuild-renpy build[\s\S]*Verdict GO/);
  assert.match(log, /config\.save_directory is set/);
});

test('build failure leaves no build/game and reports the SDK output', async () => {
  fakeTool();
  const portDir = await portOf(makeRenpy(dirOf()));
  await lane.build(portDir, { spawn: fakeSpawn([]) });
  await assert.rejects(lane.build(portDir, { spawn: fakeSpawn([], { status: 1, stdout: 'Building...\r50%\r', stderr: 'boom' }) }), /Ren'Py web build failed \(exit 1\)[\s\S]*boom/);
  assert.ok(!existsSync(path.join(portDir, 'build', 'game')));
  assert.deepEqual(readdirSync(path.join(portDir, 'build')), ['renpy-project'], 'only the project copy stays, for its log.txt');
  await assert.rejects(lane.build(portDir, { spawn: fakeSpawn([], { status: 1, stdout: 'Web support is not available. Please download web support' }) }), /web support is not available[\s\S]*pag setup renpy --yes/);
  const enoent = Object.assign(new Error('spawnSync python ENOENT'), { code: 'ENOENT' });
  await assert.rejects(lane.build(portDir, { spawn: fakeSpawn([], { status: null, error: enoent }) }), /failed \(exit ENOENT\): spawnSync python ENOENT/);
});

test('build fails without the SDK or without a game/ folder', async () => {
  rmSync(toolDir(loadLock().renpy), { recursive: true, force: true });
  await assert.rejects(lane.build(await portOf(makeRenpy(dirOf())), { spawn: fakeSpawn([]) }), { message: "the Ren'Py SDK is not installed; run: pag setup renpy --yes" });
  fakeTool();
  const dir = makeRenpy(dirOf());
  const portDir = await portOf(dir);
  renameSync(path.join(dir, 'game'), path.join(dir, 'other'));
  await assert.rejects(lane.build(portDir, { spawn: fakeSpawn([]) }), /no Ren'Py game\/ folder/);
});

test('build falls back to game/script_version.txt and warns about saves', async () => {
  fakeTool();
  const at = async (edit) => {
    const dir = makeRenpy(dirOf());
    rmSync(path.join(dir, 'renpy'), { recursive: true });
    edit(dir);
    const portDir = await portOf(dir);
    const r = await lane.build(portDir, { spawn: fakeSpawn([]) });
    return { r, log: readFileSync(path.join(portDir, 'PORTING_LOG.md'), 'utf8') };
  };
  let { r, log } = await at((d) => writeFileSync(path.join(d, 'game', 'script_version.txt'), '(8, 1, 3)'));
  assert.deepEqual([r.lane_config.game_version, r.verdict], ['8.1.3', 'GO']);
  ({ r } = await at((d) => writeFileSync(path.join(d, 'game', 'script_version.txt'), '(7, 4, 11)')));
  assert.deepEqual([r.verdict, r.why], ['HARD', "needs the Ren'Py 7 SDK, not pinned yet"]);
  ({ r, log } = await at((d) => writeFileSync(path.join(d, 'game', 'options.rpy'), 'define config.name = "x"\n')));
  assert.deepEqual([r.lane_config.game_version, r.verdict], [null, 'HARD']);
  assert.match(r.warning, /no config\.save_directory/);
  assert.match(log, /no config\.save_directory/);
  ({ r } = await at((d) => {
    for (const f of ['script', 'options']) renameSync(path.join(d, 'game', `${f}.rpy`), path.join(d, 'game', `${f}.rpyc`));
  }));
  assert.match(r.warning, /only compiled scripts/);
});

test('shell adds unsafe-eval and unsafe-inline; target_fps 5', () => {
  const s = lane.shell({}, { portDir: path.join(tmp, 'none') });
  assert.deepEqual(s, {
    csp: { 'script-src': ["'unsafe-eval'", "'unsafe-inline'"] },
    needs_coi: false,
    verify: { target_fps: 5, inputs: ['ArrowDown', 'Enter', 'Click', 'Enter'], audio_on_title: false, budget_ready_s: 30 },
  });
});

const skip = skipReason();
for (const c of CASES['rebuild-renpy'] ?? [{ name: 'rebuild-renpy e2e cases exist', run: () => assert.fail('no rebuild-renpy e2e cases') }]) {
  test(c.name, { skip, timeout: 600000 }, async (t) => {
    try { await c.run(); } catch (e) { if (e?.skip) return t.skip(e.message); throw e; } // R41: offline tool download skips
  });
}
