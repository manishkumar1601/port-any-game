// port-any-game guard for OpenCode: one default export for v2 (`id` + `setup`) and v1 >= 1.18.29 (`server`). Zero deps.
// The policy stays in the skill: the installer copies the skill two levels up, so the relative imports below resolve in
// the repo and in the installed layout (.opencode/{plugins/port-any-game,skills/port-any-game}).
// Fails open (R22): if the policy cannot load or throws, the tool call is allowed; pag's own scripts re-check policy.
const log = (msg) => console.error(`port-any-game guard: ${msg}`);

// -> (rawEvent, cwd) => deny reason or ''. Loaded once, before any hook is registered, so the v2 hook can stay synchronous.
async function loadCheck() {
  try {
    const [{ checkToolUse }, { normalizeEvent }] = await Promise.all([
      import('../../skills/port-any-game/scripts/policy.mjs'),
      import('../../skills/port-any-game/scripts/guard.mjs'),
    ]);
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
  } catch (e) {
    log(`cannot load the port-any-game skill next to this plugin, guard disabled: ${e?.message ?? e}`);
    return () => '';
  }
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
