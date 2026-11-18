// Rung 1: RPG Maker 2000/2003 games run on the EasyRPG Player web build (GPL-3.0-or-later, from the user's tool cache;
// never vendored). BYO: the adapter serves the user's files from OPFS to the player; dist never holds game bytes.
// build() checks the tool is installed, finds the game root and reads RPG_RT.ini into build/lane.json.
// M2a ruling: no --engine from RPG_RT.exe (no verified table yet); the player guesses from the database.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadLock, toolDir } from '../setup.mjs';

const TOOL = 'easyrpg-player-js';

// The value of `key` in `[section]`, both case-insensitive as in Windows INI files; undefined when absent.
function iniValue(text, section, key) {
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const s = /^\s*\[([^\]]*)\]/.exec(line);
    if (s) { inside = s[1].trim().toLowerCase() === section.toLowerCase(); continue; }
    const kv = inside && /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (kv && kv[1].toLowerCase() === key.toLowerCase()) return kv[2];
  }
  return undefined;
}

const depth = (rel) => (rel ? rel.split('/').length : 0);
// The player's game id: its IndexedDB save database and the games/<id>/ URLs the adapter answers.
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '') || 'game';

const rtpFix = () => [
  '', `## rt-easyrpg build (${new Date().toISOString().slice(0, 10)})`, '',
  '- Verdict HARD: RPG_RT.ini has no `FullPackageFlag=1`, so the game expects the RPG Maker RTP, which the web player',
  '  does not have. It still runs; missing RTP graphics show as a checkerboard and missing sounds stay silent.',
  "- Fix, as RPG Maker's own full-package export does it:",
  '  1. Copy the game folder.',
  "  2. Merge the user's own RTP files into the copy.",
  "  3. Set `FullPackageFlag=1` under `[RPG_RT]` in the copy's RPG_RT.ini.",
  '  4. Run `pag new` on the copy.', '',
].join('\n');

export default {
  id: 'rt-easyrpg', rung: 1, available: true, milestone: 'M2', dataModes: ['byo'],
  acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE'], odds: '85-95%',
  checklist: ['Find the game folder (RPG_RT.ldb) and read RPG_RT.ini', 'Check the RTP (full package or not)', 'Bundle EasyRPG Player in the shell', 'Verify the title screen and input'],
  detect(s) {
    const hit = (s.engines ?? []).some((e) => e.id === 'rpgmaker-2k');
    return hit ? { verdict: 'GO', why: 'RPG Maker 2000/2003 (rpgmaker-2k)' } : { verdict: 'NO', why: 'no RPG Maker 2000/2003 game found' };
  },
  runtime: { tool: TOOL, files: ['index.js', 'index.wasm'] },
  async build(portDir) {
    const dir = path.resolve(portDir);
    if (!existsSync(path.join(toolDir(loadLock()[TOOL]), '.ok'))) throw new Error('the EasyRPG runtime is not installed; run: pag setup easyrpg --yes');
    const game = path.join(dir, 'game');
    // ponytail: the shallowest RPG_RT.ldb is the game; a folder holding several games needs the user's pick.
    const root = readdirSync(game, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase() === 'rpg_rt.ldb')
      .map((e) => path.relative(game, e.parentPath ?? e.path).split(path.sep).join('/'))
      .sort((a, b) => depth(a) - depth(b))[0];
    if (root === undefined) throw new Error('no RPG_RT.ldb found in game/');
    const ini = readdirSync(path.join(game, root)).find((f) => f.toLowerCase() === 'rpg_rt.ini');
    const text = ini ? readFileSync(path.join(game, root, ini), 'latin1') : '';
    const encoding = iniValue(text, 'EasyRPG', 'Encoding');
    const rtp = iniValue(text, 'RPG_RT', 'FullPackageFlag') === '1' ? 'full-package' : 'needs-rtp';
    const lane_config = { root, game: slug(path.basename(dir)), ...(encoding ? { encoding } : {}), rtp };
    mkdirSync(path.join(dir, 'build'), { recursive: true });
    writeFileSync(path.join(dir, 'build', 'lane.json'), `${JSON.stringify(lane_config, null, 2)}\n`);
    // §6.1: no RTP is HARD, not NO; the game runs with checkerboards where RTP assets are missing.
    const verdict = rtp === 'needs-rtp' ? 'HARD' : 'GO';
    if (verdict === 'HARD') appendFileSync(path.join(dir, 'PORTING_LOG.md'), rtpFix());
    return { lane_config, verdict };
  },
  shell(_port, { portDir } = {}) {
    let lane_config;
    try { lane_config = JSON.parse(readFileSync(path.join(portDir, 'build', 'lane.json'), 'utf8')); } catch { /* not built yet: pack refuses */ }
    return {
      ...(lane_config ? { lane_config } : {}),
      // Embind builds its glue with new Function (spike f §3); the stock web build does not start without it.
      csp: { 'script-src': ["'unsafe-eval'"] },
      needs_coi: false,
      verify: { target_fps: 30, inputs: ['Enter'], audio_on_title: false, budget_ready_s: 30 },
    };
  },
};
