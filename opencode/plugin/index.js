// port-any-game guard for OpenCode: one default export for v2 (`id` + `setup`) and v1 >= 1.18.29 (`server`). Zero deps.
// The policy stays in the skill. The installer copies the skill two levels up, so the relative path resolves in the
// repo and in the installed layout (.opencode/{plugins/port-any-game,skills/port-any-game}); `opencode plugin add
// github:…::path:opencode/plugin` may install this folder alone, so the known skill dirs are tried next (R57).
// Fails open (R22): if the policy cannot load or throws, the tool call is allowed; pag's own scripts re-check policy.
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const log = (msg) => console.error(`port-any-game guard: ${msg}`);

function skillScriptDirs() {
  const home = (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) || homedir();
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const known = [[xdg, 'opencode', 'skills'], [home, '.agents', 'skills'], [home, '.claude', 'skills']];
  return [
    fileURLToPath(new URL('../../skills/port-any-game/scripts', import.meta.url)),
    ...known.map((d) => path.join(...d, 'port-any-game', 'scripts')),
  ];
}

// -> (rawEvent, cwd) => deny reason or ''. Loaded once, before any hook is registered, so the v2 hook can stay synchronous.
async function loadCheck() {
  let dirs = [];
  let last;
  try {
    dirs = skillScriptDirs();
  } catch (e) { last = e; }
  for (const dir of dirs) {
    let mods;
    try {
      const load = (f) => import(pathToFileURL(path.join(dir, f)).href);
      mods = await Promise.all([load('policy.mjs'), load('guard.mjs')]);
    } catch (e) { last = e; continue; }
    const [{ checkToolUse }, { normalizeEvent }] = mods;
    return (raw, cwd) => {
      try {
        const ev = normalizeEvent({ ...raw, cwd: raw.cwd ?? cwd });
        for (const p of ev.paths ?? [ev.path]) {
          const r = checkToolUse({ ...ev, path: p });
          if (r.deny) return r.reason;
        }
      } catch (e) { log(`internal error, allowing: ${e?.message ?? e}`); }
      return '';
    };
  }
  log(`port-any-game skill not found (tried ${dirs.join(', ')}), guard disabled: ${last?.message ?? last}`);
  return () => '';
}

export default {
  id: 'port-any-game',
  async setup(ctx) { // OpenCode v2: a deny sets effect + message (the message is the reason the model sees)
    try {
      const check = await loadCheck();
      await ctx.permission.hook('evaluate', (e) => {
        const why = check(e, ctx.directory);
        if (why) { e.effect = 'deny'; e.message = why; }
      });
    } catch (e) { log(`setup failed, guard disabled: ${e?.message ?? e}`); }
  },
  async server(ctx) { // OpenCode v1: throwing in tool.execute.before blocks the call
    const check = await loadCheck();
    return {
      'tool.execute.before': async (input, output) => {
        const why = check({ input, output }, ctx?.directory);
        if (why) throw new Error(why);
      },
    };
  },
};
