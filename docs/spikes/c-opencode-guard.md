# Spike C: OpenCode guard (dual v1/v2 plugin, note 06 §5.3)

Date: 2026-11-17. Windows 11, Node 22.22.3. Labels: **observed**, **documented**, **unverified**.

## Verdict

- **Plugin shape: the dual object works as designed on v1 1.19.3 (observed) and its logic is correct for v2 under a mocked ctx (observed with a mock only).** v1 loads the object, ignores `id`/`setup`, and calls `server()`. v2 behaviour on a real v2 binary is **unverified**.
- **The end-to-end "steamless.exe x is denied" check was not run on a real OpenCode.** It needs a model-driven tool call; R5 forbids model calls. Only the mocked hooks were exercised. Maintainer must run it on 2.3.x and 1.19.x.
- **Install route changes for v1 (observed):** a plugin directory `.opencode/plugins/port-any-game/index.js` is **not** auto-discovered by 1.19.3. A top-level file `.opencode/plugins/<name>.js` is. Task 22's project installer must copy a top-level shim (`export { default } from "./port-any-game/index.js";`) or register the file in the `plugin` config array.
- **Do not rely on the hook for user-initiated shell commands (observed):** a command run through the server's user-shell endpoint did not reach the guard. The guard covers model tool calls only, which is the intent.

## Versions (observed)

| Tool | Version |
|---|---|
| `opencode --version` (installed, `C:/nvm4w/nodejs`) | **1.19.3** (v1 line; there is no 2.3.x on this machine) |
| `codex --version` | codex-cli 0.166.0 |
| `claude --version` | 2.1.132 |
| OpenCode 2.3.0 | `npm i @opencode/cli@2.3.0` into a scratch dir succeeded (3 packages), but **running** the downloaded binary was refused by the auto-mode permission classifier, so nothing about v2 was observed. Not worked around. |

The repo brief asks for both 2.3.x and 1.19.x; only 1.19.3 was exercised.

## Isolation

`opencode debug paths` printed scratch paths for data, config, cache, state and log (observed). Env: `USERPROFILE`, `HOME`, `XDG_*`, `APPDATA`, `LOCALAPPDATA`, `OPENCODE_CONFIG_DIR` under `docs/spikes/scratch/t3/home`. The server was started with `opencode serve --port 4399` (127.0.0.1) as a child process and killed with `taskkill /t /f` after each probe. No login, no provider call.

## The plugin under test

Exactly note 06 §5.3 `opencode/plugin/index.js` (dual object, imports `check` from `./guard.mjs`, no dependency on `@opencode/plugin`), with two additions for the spike: `note()` calls that append "setup() called" / "server() called" to `$GUARD_LOG`, and a spike `guard.mjs` whose `check()` returns a reason for `/\bsteamless(\.exe)?\b/i` and logs each checked command. Lives in scratch only (`scratch/t3/ocproj/.opencode/plugins/port-any-game/`). `package.json` is `{"name":"opencode-port-any-game","type":"module","exports":{".":"./index.js"}}`.

## Observed on OpenCode 1.19.3

1. `opencode plugin --help`: usage is `opencode plugin <module>` (an npm module name; flags `-g`, `-f`). **No `add`, `list` or `check` subcommands in 1.19.x**, and no `github:` spec is advertised. Those subcommands (`opencode plugin add|list|check`, note 06 §4) are documented for v2 only. So `opencode plugin add "github:..."` as in note 01 §7.1 is a v2-only route.
2. `opencode debug config` showed `"plugin": []` and does not list auto-discovered or file plugins, so it cannot confirm plugin loading. Loading was confirmed through the log file instead.
3. Explicit registration: `opencode.json` with `"plugin": ["file:///<abs path>/port-any-game/index.js"]`, then `opencode serve` plus a session request. Result: `server() called` was logged (twice, once per instance init); `setup() called` was **never** logged. So v1 treats the default export as `{ id?, server }` and ignores `setup`. This matches the installed type `PluginModule = { id?: string; server: Plugin }` in `home/.config/opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts` (that package is v1.19.3, auto-installed into the isolated config dir).
4. Auto-discovery layouts (`.opencode/plugins/`):
   - `port-any-game/index.js` (subdirectory, no top-level file): **not loaded** (no log line).
   - `pag.js` containing `export { default } from "./port-any-game/index.js";`: **loaded** (`server() called`).
   - `legacy.js` with `export const Legacy = async () => ({})`: loaded.
5. User-shell path: `POST /session/<id>/shell {agent:"build", command:"echo hi steamless.exe x"}` returned 200 and ran the command, but `check()` was never called (no command line in `$GUARD_LOG`) while the plugin was loaded. So `tool.execute.before` does not fire for user shell commands. Sessions use the free built-in model entry (`big-pickle`) only as a label here; this endpoint makes no model call.
6. v1 hook types (observed by reading the installed d.ts; types only, not a live capture): `"tool.execute.before"?: (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => Promise<void>`. Saved as `test/fixtures/hook-payloads/opencode-v1-tool-execute-before.json`.

## Mocked check (observed in Node 22, mock ctx; not OpenCode itself)

`mock.mjs` called `plugin.setup({ permission: { hook } })` with a fake `hook` that records the callback, then `plugin.server()` and `tool.execute.before`:

```
v2 deny  : {"action":"shell","resources":["steamless.exe x game.exe"],"effect":"deny","message":"port-any-game: DRM removal tooling is refused (steamless)"}
v2 allow : {"action":"shell","resources":["node pag.mjs survey \"D:/Games/x\""],"effect":"allow"}
v2 skip  : {"action":"read","resources":["steamless.exe"],"effect":"allow"}      # non-shell action ignored
v1 bash "steamless.exe x game.exe" -> THROW: port-any-game: DRM removal tooling is refused (steamless)
v1 bash "node pag.mjs survey x"    -> allowed
v1 read "steamless.exe"            -> allowed                                  # non-bash tool ignored
setup() registers only the "evaluate" hook
```

So the guard logic is right for both entry points. What the mock cannot show is whether a real v2 calls `setup(ctx)` with that `ctx.permission.hook` signature, or whether a real v1/v2 tool call carries the `bash`/`shell` names we match.

## Documented (not run)

- v2 `ctx.permission.hook("evaluate", e => ...)`: runs for `allow` and `ask` outcomes; an explicit configured `deny` is final and skips it; setting `effect = "deny"` and `message` blocks, and `message` becomes the denial reason; interface `PermissionEvaluation { sessionID, agent?, action, resources[], metadata?, source?, effect, message? }` (https://opencode.ai/docs/build/plugins/server.md). Saved as `opencode-v2-permission-evaluate.json`.
- v2 equivalent of v1's throw: `ctx.tool.hook("execute.before", e => { throw ... })` (migrate-v1.md table: `tool.execute.before` -> `ctx.tool.hook("execute.before")`).
- One object with V2 `id` + `setup()` and a V1 `server()` is supported from V1 1.18.29, and V2 ignores `server()` (note 06 §4). On 1.19.3 the V1 half is now observed.
- v2 permission action for shell is `shell` (v1: `bash`); `shell` resources are raw command text, matching is case-insensitive on Windows (note 06 §4).

## Recommendations for Task 22

1. Ship the plugin as note 06 §5.3, unchanged, plus an installer step that also writes a top-level `.opencode/plugins/port-any-game.js` shim (or adds a `plugin` entry with a `file://` URL). Without it, 1.19.x silently loads nothing.
2. Keep the guard on both hooks and keep the policy text authoritative inside the skill scripts: the guard does not see user-shell commands (observed), and it does not run at all if the plugin is not loaded.
3. Write the install doc so `opencode plugin add github:...` is marked v2-only; on v1 use the file copy route.
4. Add a plugin-loaded self-check to `doctor.mjs` if cheap: v1 gives no CLI way to list loaded plugins (`opencode debug config` showed `plugin: []` even when loaded).

## Maintainer must verify

Moved to the checklist in [docs/evals/tier1.md](../evals/tier1.md) (section 3). The original list follows for context.

1. On **1.19.x** with the shim installed, ask the agent to run `steamless.exe x game.exe` through the bash tool: expect a block with our message, and `$GUARD_LOG`-style capture of `(input, output)` to replace the v1 fixture (flip `_provenance` to `observed:` with how it was captured).
2. On **2.3.x** (install `@opencode/cli`, which could not be run here): same, via `ctx.permission.hook("evaluate")`. Confirm `setup(ctx)` runs, `e.action === "shell"`, `e.resources` holds the raw command, and the message reaches the model. Capture the event object.
3. On 2.3.x: `opencode plugin add "github:<org>/port-any-game#<tag>::path:opencode/plugin"` and `opencode plugin check`, and whether a plugin directory (not just a top-level file) is auto-discovered in `.opencode/plugins/`.
4. Confirm a configured declarative `deny` rule (note 06 `opencode.jsonc.example`) still blocks if the plugin is missing.
