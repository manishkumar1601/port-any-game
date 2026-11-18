# Tier 1 agent eval (manual)

This is the remaining M1 exit criterion (spec section 16): on a fresh machine, each Tier 1 agent (Claude Code, Codex,
OpenCode) takes a fixture game to "playable" in **5 user touchpoints or fewer**, on each OS (Windows, macOS, Linux).
CI covers the lane fixtures on 3 OSes; only a maintainer with real agent sessions can do this.

## 1. Procedure

Per agent and OS, on a machine (or clean VM) that has never had port-any-game installed:

1. **Install** exactly as the README says for that agent. Install nothing else except Node 20+, git and Chrome or Edge.
2. **Make the fixture folders** from a clone of this repo (`OUT` is any scratch dir you pick). Run from the repo root:

   ```
   node -e "import('./test/fixtures/make-web-game.mjs').then(m=>m.makeWebGame(process.argv[1],'nwjs'))" OUT/web-nwjs
   node -e "import('./test/fixtures/make-web-game.mjs').then(m=>m.makeWebGame(process.argv[1],'electron'))" OUT/web-electron
   node -e "import('./test/fixtures/make-swf.mjs').then(async m=>{const fs=await import('node:fs');fs.mkdirSync(process.argv[1],{recursive:true});fs.writeFileSync(process.argv[1]+'/anim.swf',m.makeAnimSwf())})" OUT/flash
   node -e "Promise.all([import('./test/fixtures/make-dos-com.mjs'),import('./test/fixtures/make-pe.mjs'),import('node:fs')]).then(([c,p,fs])=>{fs.mkdirSync(process.argv[1],{recursive:true});fs.writeFileSync(process.argv[1]+'/ANIM.COM',c.makeAnimCom());fs.writeFileSync(process.argv[1]+'/INSTALL.EXE',p.makeMZ())})" OUT/dos
   ```

   Run the eval at least on `OUT/web-nwjs`. Use the other three when time allows; they cover the other lanes.
3. In a fresh agent session, ask: **"Port the game in `<fixture dir>` so I can play it in my browser"**.
4. Count **user touchpoints**: every time you must do something the agent could not do itself (approve a permission
   prompt, answer a question, run a command, click a link, paste output, restart the session). The initial request is
   not a touchpoint, and neither is opening the final playable page.
5. **Pass** = `pag verify` reports `pass` (see `<port>/verify/report.json`) **and** touchpoints <= 5. Note what each
   touchpoint was; a pass at 5 with avoidable prompts is still worth a note.
6. Delete the fixture and port folders afterwards.

## 2. Results

One row per agent and OS (date and agent version in Notes).

| Agent | OS | Fixture | Touchpoints | verify | Pass | Notes |
|---|---|---|---|---|---|---|
| Claude Code | Windows | | | | | |
| Claude Code | macOS | | | | | |
| Claude Code | Linux | | | | | |
| Codex | Windows | | | | | |
| Codex | macOS | | | | | |
| Codex | Linux | | | | | |
| OpenCode | Windows | | | | | |
| OpenCode | macOS | | | | | |
| OpenCode | Linux | | | | | |

## 3. Unverified host behaviours

Each box is one check that needs a real agent session. Tick it and record the answer.

### From the Task 22 wrappers

- [ ] **Codex hook route.** Codex probably loads the Claude-format `hooks/hooks.json`, not `hooks/codex.json` (no root `plugin.json` points at it), and its documented handler fields have no `args`. Check: install on Codex, run `/hooks`, see which file is listed, then ask the agent to run `steamless.exe x game.exe`. Expect a block. If the guard silently does not run, add a Codex-only manifest `.codex-plugin/plugin.json` with `"hooks": "./hooks/codex.json"` and re-test, including its precedence over `.claude-plugin/plugin.json`.
- [ ] **Codex manifest.** Record whether a `.codex-plugin/plugin.json` is needed and which manifest Codex honours when both exist (same session as above).
- [ ] **Copilot plugin route (R56).** Do not advertise `copilot plugin install` until this passes. Without a root `plugin.json`, Copilot falls back to `.claude-plugin` and may run Claude's `hooks/hooks.json` without `args` (exit 1). Copilot `preToolUse` is fail-closed, so every Bash/Write/Edit/WebFetch call could be denied. Check: install via the plugin route on a real Copilot CLI; run one harmless Bash call (must be allowed) and `steamless.exe x game.exe` (must be denied with our message).
- [ ] **Copilot `PLUGIN_ROOT`.** If Copilot uses `com.github.copilot/hooks/hooks.json`, check that `PLUGIN_ROOT` (or any root variable) is set for plugin hooks, the hook cwd, and that a missing root variable fails open (the Copilot forms end in `|| true` / `; exit 0`).
- [ ] **Codex `commandWindows` shell.** The command assumes PowerShell; Codex may use cmd. On Windows, check which shell ran it and what `%PLUGIN_ROOT%` / `$env:PLUGIN_ROOT` held. If cmd, the command fails and Codex fails open.
- [ ] **OpenCode v2 `setup(ctx)`.** Confirm v2 calls `setup(ctx)` with `ctx.permission.hook`, runs a synchronous `evaluate` (`e.action === "shell"`, `e.resources` is the raw command), and that `effect: 'deny'` reaches the model. Capture the event object.
- [ ] **OpenCode plugin dir auto-discovery.** Does v2 auto-discover `<base>/plugins/port-any-game/` as well as the shim `<base>/plugins/port-any-game.js`? (The guard would register twice; harmless, both deny.)
- [ ] **OpenCode v1 and the `permissions` key.** On 1.x, do the generated subagents (`opencode/agents/*.md`, v2 `permissions` frontmatter) load, or does v1 reject the key?
- [ ] **OpenCode `github:` route (R57).** Run `opencode plugin add "github:manishkumar1601/port-any-game#<tag>::path:opencode/plugin"` then `opencode plugin check`. Does the repo stay around the subdir so `../../skills/...` resolves? If only the subdir is copied, the plugin logs "cannot load the port-any-game skill" and fails open. The README marks this route unverified.
- [ ] **OpenCode `*steamless*` glob.** Does the `opencode.jsonc.example` rule match mid-command (`cd x && steamless.exe y`)?
- [ ] **Copilot `.agent.md` tool aliases** (`read`, `search`, `execute`, `edit`, `web`) come from GitHub docs, not a capture. Check the agents load with the tools they claim. Also confirm Copilot ignores the plain-text `pag status` at `sessionStart` (harmless).

### Spike a (layout coexistence)

- [ ] Copilot CLI, real install, authenticated: `copilot plugin marketplace add <repo>` and `copilot plugin install port-any-game@port-any-game` on a repo that has a root `plugin.json`. Does it install, which manifest wins, any rejection?
- [ ] Cursor: import the repo (team marketplace) or copy it into `~/.cursor/plugins/local/`, with and without a root `plugin.json`. Which manifest does it read?
- [ ] Codex: with `.claude-plugin/` only, does the skill appear, and does `hooks/hooks.json` load from the cache copy? (Needs a session.)
- [ ] Re-run Claude with a root `plugin.json` on a Claude Code newer than 2.1.132 (which ignores it).

### Spike b (hooks on Windows)

- [ ] Codex on Windows: install, review and trust the hook, run one shell call. Record which shell ran `command` vs `commandWindows`; whether `PLUGIN_ROOT` was visible and in what form; the raw stdin payload (replace the Codex fixtures and flip `_provenance` to `observed:`); whether JSON deny at exit 0 blocks and whether exit 2 blocks; whether `; exit $LASTEXITCODE` is needed.
- [ ] Copilot CLI on Windows: same, with the `bash` and `powershell` fields. Also: is a root variable set, the hook cwd, is `toolArgs` a string or object, does `exec` + `args` work.
- [ ] Claude Code: one Bash and one Write call with the exec-form hook; confirm the payload and that exit 2 blocks.
- [ ] Does Codex run plugin hooks installed via `codex plugin add` from the CLI, or only on desktop?

### Spike c (OpenCode guard)

- [ ] On 1.19.x with the shim installed, ask the agent to run `steamless.exe x game.exe` through bash: expect a block with our message. Capture `(input, output)` to replace the v1 fixture (flip `_provenance` to `observed:`).
- [ ] On 2.3.x (install `@opencode/cli`): same via `ctx.permission.hook("evaluate")` (see the OpenCode v2 item above).
- [ ] On 2.3.x: `opencode plugin add "github:<org>/port-any-game#<tag>::path:opencode/plugin"` and `opencode plugin check`; is a plugin directory (not just a top-level file) auto-discovered in `.opencode/plugins/`?
- [ ] A configured declarative `deny` rule (`opencode.jsonc.example`) still blocks when the plugin is missing.

### Spike d (CDP verify)

Mostly covered by CI (section 4). Confirm from the first green CI run on each OS:

- [ ] Linux: record whether `--no-sandbox` was needed (verify adds it as root only) and whether Chrome or Chromium was used.
- [ ] A screenshot of an animated 2D canvas and a WebGL canvas is non-black on macOS and Linux (SwiftShader).
- [ ] Browser and user-data-dir cleanup leaves no process or folder behind (POSIX kill path).
- [ ] Cold-runner `DevToolsActivePort` latency stays within the verify budget.
- [ ] Not tested anywhere: headed mode, cross-origin iframes, other browsers.

### Spike e (js-dos bundle)

Covered by the `dos-jsdos` e2e case in CI, except:

- [ ] Does the js-dos UI canvas paint in headless Chrome on Linux and macOS? (On Windows it stays black; verify reads frames through `ci`.)
- [ ] `initFs` as an `Entry[]` array (only the zip form was observed).
- [ ] Audio RMS capture, keyboard through CDP `Input.dispatchKeyEvent` into the UI canvas, the `jspi` backend, and bundles over a few hundred bytes.

### M1 known limits to re-test

These should still hold (or be fixed):

- [ ] `verify` cannot click into a game: a title screen that needs a click to start is judged on the title frames only.
- [ ] Audio inside an iframe is not measured.
- [ ] DOS detection of `.COM`-only folders: the survey needs an MZ file (the fixture adds `INSTALL.EXE`); a bare `.COM` folder is not called DOS.
- [ ] BYO import over a LAN address (not `localhost`): OPFS and secure-context behaviour differ; check a phone or second machine on the same network.

## 4. CI flake watch

CI (`.github/workflows/ci.yml`) runs `npm test` with `PAG_E2E=0`, then `npm run e2e` once. On a red run, download the
`verify-<os>` artifact (`<case>/verify/report.json`, screenshots, `console.log`).

- Earlier fps and blank-frame flakes under load were fixed by R46 (verify sampling) and R47 (tests run serially,
  `--test-concurrency=1`). If they return, something is running in parallel with e2e.
- Watch the **Electron input check** (`web-extract Electron fixture passes verify`, the `input` check).
- Watch **dos-jsdos fps on Linux SwiftShader** (target 30). A software-GL runner may sit just under; change the soak or
  the threshold only after reading several runs.
- The tool cache is keyed on `toolchain.lock.json`. A cache miss re-downloads the runtimes (e2e skips on network
  errors only, so a green run with SKIP lines means the runner was offline).
