// Rung 1: DOS programs run on js-dos (DOSBox wasm, GPL-2.0, from the user's tool cache; never vendored). BYO: the user's
// files are imported into OPFS and zipped into a .jsdos bundle in the browser; dist never holds game bytes.
// R40: build() only checks the tool is installed and records the exe in build/lane.json; pack copies the runtime.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadLock, toolDir } from '../setup.mjs';
import { dosboxConf, dosPath } from '../../assets/lanes/dos-jsdos/adapter.js';

const TOOL = 'js-dos';
const DOS_FORMATS = ['MZ', 'LE', 'LX'];

const isFile = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() === true;

export default {
  id: 'dos-jsdos', rung: 1, available: true, milestone: 'M1', dataModes: ['byo'],
  acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], odds: '85-95%',
  checklist: ['Find the real DOS executable (and the disc image if any)', 'Write dosbox.conf', 'Build the js-dos bundle', 'Verify boot and input'],
  dosboxConf,
  detect(s) {
    const main = (s.executables ?? []).find((e) => e.role === 'main');
    if (main && DOS_FORMATS.includes(main.format)) return { verdict: 'GO', why: `main executable is ${main.format} (DOS)` };
    const hit = (s.engines ?? []).find((e) => e.id === 'dos' || e.id === 'dosbox-wrapper');
    return hit ? { verdict: 'GO', why: `DOS content (${hit.id})` } : { verdict: 'NO', why: 'no DOS executable found' };
  },
  // R42: the minimal `dosbox` backend set (no dosboxX files) plus the lock's licenseFile.
  runtime: {
    tool: TOOL,
    files: ['dist/emulators/emulators.js', 'dist/emulators/wdosbox.js', 'dist/emulators/wdosbox.wasm', 'dist/emulators/wlibzip.js', 'dist/emulators/wlibzip.wasm', 'package.json'],
  },
  async build(portDir) {
    const dir = path.resolve(portDir);
    if (!existsSync(path.join(toolDir(loadLock()[TOOL]), '.ok'))) throw new Error('the js-dos runtime is not installed; run: pag setup jsdos --yes');
    const game = path.join(dir, 'game');
    let survey = {};
    try { survey = JSON.parse(readFileSync(path.join(dir, 'survey.json'), 'utf8')); } catch { /* no survey: the .COM fallback only */ }
    // The largest non-installer DOS program the survey parsed (its main one when that is DOS). A .COM has no header,
    // so the survey never lists one: the largest .COM in game/ is the fallback.
    // ponytail: largest wins; a game started by a .BAT or a small loader needs the user's pick.
    const exe = (survey.executables ?? []).map((e) => ({ ...e, path: e.path.split('\\').join('/') }))
      .filter((e) => DOS_FORMATS.includes(e.format) && e.role !== 'installer' && isFile(path.join(game, e.path)))
      .sort((a, b) => b.bytes - a.bytes)[0]?.path;
    const com = () => readdirSync(game, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.com$/i.test(e.name))
      .map((e) => { const rel = path.relative(game, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/'); return { rel, size: statSync(path.join(game, rel)).size }; })
      .sort((a, b) => b.size - a.size)[0]?.rel;
    const rel = exe ?? com();
    if (!rel) throw new Error('no DOS executable: the survey found no MZ/LE/LX program and game/ has no .COM file');
    const lane_config = { exe: dosPath(rel) };
    mkdirSync(path.join(dir, 'build'), { recursive: true });
    writeFileSync(path.join(dir, 'build', 'lane.json'), `${JSON.stringify(lane_config, null, 2)}\n`);
    return { lane_config, verdict: 'GO' };
  },
  shell(_port, { portDir } = {}) {
    let lane_config;
    try { lane_config = JSON.parse(readFileSync(path.join(portDir, 'build', 'lane.json'), 'utf8')); } catch { /* not built yet: pack's R27 check reports it */ }
    return {
      ...(lane_config ? { lane_config } : {}),
      needs_coi: false,
      // M10: many titles wait for a click or a key; 'Click' is a trusted click on the stage (verify).
      verify: { target_fps: 30, inputs: ['Click', 'Enter', 'Space'], audio_on_title: false, budget_ready_s: 30 },
    };
  },
};
