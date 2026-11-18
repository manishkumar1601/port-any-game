// Rung 1: Flash content runs on Ruffle (self-hosted, wasm). BYO: the user's SWF is imported into OPFS and never ships in dist.
// R40: build() only checks the tool is installed and records the main SWF in build/lane.json; pack copies the runtime.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadLock, toolDir } from '../setup.mjs';

const TOOL = 'ruffle-selfhosted';
const RUNTIME_FILE = /^(ruffle\.js|core\.ruffle\..+\.js|.+\.wasm)$/; // no source maps, READMEs or the other lane files; globbed here, not in the lock

const isFile = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() === true;

export default {
  id: 'rt-ruffle', rung: 1, available: true, milestone: 'M1', dataModes: ['byo'],
  acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], odds: 'AVM1 85-95%, AVM2 55-80%',
  checklist: ['Locate the main SWF (unwrap the projector if needed)', 'Bundle Ruffle in the shell', "Load the SWF from the user's files", 'Verify first frame and input'],
  detect(s) {
    const hit = (s.engines ?? []).find((e) => e.id === 'flash-swf' || e.id === 'flash-projector');
    return hit ? { verdict: 'GO', why: `Flash content (${hit.id})` } : { verdict: 'NO', why: 'no Flash content found' };
  },
  // Read by pack (R25) once per pack, after build; the file list needs the installed tool, so it is a getter.
  get runtime() {
    const dir = toolDir(loadLock()[TOOL]);
    return { tool: TOOL, ...(existsSync(dir) ? { files: readdirSync(dir).filter((f) => RUNTIME_FILE.test(f)) } : {}) };
  },
  async build(portDir) {
    const dir = path.resolve(portDir);
    if (!existsSync(path.join(toolDir(loadLock()[TOOL]), '.ok'))) throw new Error('the Ruffle runtime is not installed; run: pag setup ruffle --yes');
    const game = path.join(dir, 'game');
    const swfs = readdirSync(game, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && /\.swf$/i.test(e.name))
      .map((e) => { const rel = path.relative(game, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/'); return { rel, size: statSync(path.join(game, rel)).size }; })
      // ponytail: shallowest, then largest, is the "main" SWF; a game that loads its real content from a tiny loader SWF needs the user's pick.
      .sort((a, b) => a.rel.split('/').length - b.rel.split('/').length || b.size - a.size);
    let lane_config;
    if (swfs.length) lane_config = { swf: swfs[0].rel, projector: false };
    else {
      let survey = {};
      try { survey = JSON.parse(readFileSync(path.join(dir, 'survey.json'), 'utf8')); } catch { /* no survey */ }
      const exe = (survey.executables ?? []).filter((e) => e.overlay?.magic === 'swf' && isFile(path.join(game, e.path))).sort((a, b) => (b.role === 'main') - (a.role === 'main'))[0];
      if (!exe) throw new Error('no SWF found in game/ and no Flash projector executable in the survey');
      lane_config = { swf: exe.path.split('\\').join('/'), projector: true };
    }
    mkdirSync(path.join(dir, 'build'), { recursive: true });
    writeFileSync(path.join(dir, 'build', 'lane.json'), `${JSON.stringify(lane_config, null, 2)}\n`);
    return { lane_config, verdict: 'GO' };
  },
  shell(_port, { portDir } = {}) {
    let lane_config;
    try { lane_config = JSON.parse(readFileSync(path.join(portDir, 'build', 'lane.json'), 'utf8')); } catch { /* not built yet: pack's R27 check reports it */ }
    return {
      ...(lane_config ? { lane_config } : {}),
      // M10: many titles wait for a click or a key; 'Click' is a trusted click on the stage (verify).
      verify: { target_fps: 30, inputs: ['Click', 'Enter', 'Space'], audio_on_title: false, budget_ready_s: 30 },
    };
  },
};
