# Agent integration

How one skill and one policy reach each coding agent: install routes, where each host finds skills, subagents, commands
and hooks, the files that carry the hook configuration, the generator that keeps per-host wrappers in step, and the
installer. For what the hooks enforce, see [safety-and-policy.md](safety-and-policy.md). For end-user install commands,
see the install block in [README.md](../README.md). The layout decision is
[ADR 0001](adr/0001-flat-plugin-layout.md): the repository root is the plugin.

## 1. Host support matrix

Tier 1 hosts (Claude Code, Codex, OpenCode) are the ones the M1 exit criterion targets
([evals/tier1.md](evals/tier1.md)). **No host has been verified end to end in a real agent session yet.** The
tier-1 eval table is still blank and its host-behaviour checklist is unticked; the open work is tracked in
[roadmap.md](roadmap.md). "Observed" below means a maintainer ran it in a spike ([spikes](spikes/)); "documented" means
built from vendor docs; "unverified" means neither.

| Host | Tier | Install route | Skill | Subagents | Commands | Hooks (guard + status) |
|---|---|---|---|---|---|---|
| Claude Code | 1 | `claude plugin marketplace add` + `claude plugin install` | `skills/port-any-game` via `.claude-plugin/plugin.json` | `agents/*.md` (auto-discovered at root) | `commands/*.md` (auto-discovered) | [hooks/hooks.json](../hooks/hooks.json), auto-loaded |
| Codex | 1 | `codex plugin marketplace add` + `codex plugin add` | `skills` in `.codex-plugin/plugin.json` | none (no Codex wrapper) | none | [hooks/codex.json](../hooks/codex.json), named by `.codex-plugin/plugin.json` |
| OpenCode | 1 | clone, then `node scripts/install.mjs --host=opencode --global` (or `--project <dir>`) | copied to `<base>/skills/port-any-game` | `opencode/agents/*.md` (generated) | `opencode/commands/port-game.md` (generated) | `opencode/plugin` (guard only), a shim in `<base>/plugins/` |
| GitHub Copilot (CLI, VS Code) | not Tier 1 | `npx skills add ... -a github-copilot`, or `install.mjs --host=skills` | `~/.agents/skills` or `~/.claude/skills`, or Copilot's own folder | `com.github.copilot/agents/*.agent.md` (generated; plugin route only) | none | [com.github.copilot/hooks/hooks.json](../com.github.copilot/hooks/hooks.json) (plugin route only) |
| Amp, Cline, Goose, Junie, Zed, Warp and others | skill only | `npx skills add ... -a <agent>`, or `install.mjs --host=skills` | `~/.agents/skills` (and `~/.claude/skills` on `--global`) | none | none | none: no guard, no status line |

`<base>` is `~/.config/opencode` (global; `XDG_CONFIG_HOME` is honoured) or `<project>/.opencode`.

### Verified versus unverified, per host

| Host | Observed (spikes) | Documented, not run | Unverified |
|---|---|---|---|
| Claude Code | Installs from `.claude-plugin/` (Claude Code 2.1.132, spike [a](spikes/a-layout-coexistence.md)); ignores a root `plugin.json`. The exec-form hook avoids the PowerShell exit-code trap (spike [b](spikes/b-hooks-windows.md)) | Payload shapes (fixtures in `test/fixtures/hook-payloads/`) | `/hooks` listing, DRM block through the real hook, `/agents` and slash commands, Windows `PowerShell` tool name in the matcher |
| Codex | CLI 0.166.0 installs from `.claude-plugin/` alone; it preferred a root `plugin.json` over `.claude-plugin/plugin.json` when one existed (spike [a](spikes/a-layout-coexistence.md)). A PowerShell hook command loses exit code 2 unless it ends with `exit $LASTEXITCODE` (spike [b](spikes/b-hooks-windows.md)) | Hook payload and the JSON deny at exit 0 | Which manifest wins now that `.codex-plugin/plugin.json` exists; that Codex loads `hooks/codex.json` (not `hooks/hooks.json`); which shell runs `commandWindows`; whether `PLUGIN_ROOT` is set; whether CLI installs run plugin hooks at all |
| OpenCode 1.x | 1.19.3 loads the dual-export plugin through the top-level shim and calls `server()`; a plugin directory is not auto-discovered; user-initiated shell commands never reach the hook (spike [c](spikes/c-opencode-guard.md)) | v1 hook shape (types read from `d.ts`) | Block through a real model tool call; whether 1.x accepts the v2 `permissions` key in the generated subagents |
| OpenCode 2.x | The v2 logic works under a mocked `ctx` only | `ctx.permission.hook('evaluate')` shape | Everything against a real 2.x session; the `github:` plugin route (R57; the README marks it unverified); subagent allow-rule matching on compound commands |
| Copilot | Nothing: the CLI was not installed in the spike | Payload shapes, tool aliases (`read`, `search`, `execute`, `edit`, `web`) | The whole plugin route (R56: do not advertise `copilot plugin install` until it passes), `PLUGIN_ROOT`, whether `npx skills add -g -a github-copilot` lists the skill |
| Skills-only hosts | n/a | The `npx skills` agent ids | Per-host listing |

The README therefore says the Copilot plugin route, with hooks, comes after verification; Copilot users get the skill
only. The full unticked checklist, with how to run each check in an isolated home, is
[evals/tier1.md](evals/tier1.md) section 3.

## 2. Canonical sources

Hand-edit only these; everything per-host is generated from them.

| Source | Role |
|---|---|
| [agents/game-surveyor.md](../agents/game-surveyor.md) | Read-only survey subagent (`Read, Glob, Grep, Bash`): runs `pag survey` and, when asked, `pag doctor` |
| [agents/port-verifier.md](../agents/port-verifier.md) | Verification subagent; runs `pag verify` |
| [commands/port-survey.md](../commands/port-survey.md), [port-verify.md](../commands/port-verify.md), [port-status.md](../commands/port-status.md) | Claude Code slash commands (`/port-any-game:port-survey`, ...) |
| [skills/port-any-game/SKILL.md](../skills/port-any-game/SKILL.md) | The workflow every host loads; `scripts/validate.mjs` checks its frontmatter, links and `pag` command coverage |
| [skills/port-any-game/agents/openai.yaml](../skills/port-any-game/agents/openai.yaml) | Codex-style display name, short description, default prompt and `allow_implicit_invocation`; validate requires quoted values and `$port-any-game` in the prompt |

An agent file uses Claude format: frontmatter with `name`, `description` (a JSON string) and `tools` (comma-separated),
then the body.

## 3. `scripts/gen-wrappers.mjs`

[gen-wrappers.mjs](../scripts/gen-wrappers.mjs) turns `agents/*.md` into the Copilot and OpenCode forms. `npm run gen`
writes the files (the output is committed); `npm run validate` also runs `gen-wrappers.mjs --check`.

| Generated file | From | Transform |
|---|---|---|
| `com.github.copilot/agents/<name>.agent.md` | each `agents/*.md` | Claude tools mapped to Copilot aliases (`Read` -> `read`; `Glob`/`Grep` -> `search`; `Bash`/`PowerShell` -> `execute`; `Write`/`Edit`/`MultiEdit`/`NotebookEdit` -> `edit`; `WebFetch`/`WebSearch` -> `web`), de-duplicated |
| `opencode/agents/<name>.md` | each `agents/*.md` | `mode: subagent` plus a v2 `permissions` list (below) |
| `opencode/commands/port-game.md` | the `PORT_GAME` constant in the generator | `@port-any-game Port the game in: $ARGUMENTS` with `agent: build` |

Every generated agent file starts with a comment `# generated by scripts/gen-wrappers.mjs from agents/<file>; edit
that file, then run: npm run gen`.

**OpenCode permissions.** OpenCode v2 uses last-match-wins rules, so the generator emits deny-all first, then allows:

1. `* * deny`
2. one allow per mapped tool (`read`, `glob`, `grep`, `edit`, `webfetch`, `websearch`)
3. `external_directory * ask` when the agent has `Read` (game and port folders sit outside the project)
4. if the agent has `Bash` or `PowerShell`: `shell node *pag.mjs* <cmd>* allow` for each `pag.mjs <cmd>` found in the
   agent body. The `*` after `pag.mjs` also matches a quoted path with spaces.

Adding a command to an agent body therefore also widens its OpenCode allow rule on the next `npm run gen`.

**Drift detection.** `drift(root)` regenerates in memory and reports three kinds of path: missing, different (line
endings normalised) and **stale** (a file in `com.github.copilot/agents`, `opencode/agents` or `opencode/commands`
that the generator no longer produces). `--check` prints them and exits 1 (`gen-wrappers: out of date (run: npm run
gen)`), else prints `gen-wrappers: ok`. A plain `npm run gen` deletes stale files before writing. CI runs both validate
and `--check` ([ci.yml](../.github/workflows/ci.yml)); see [development.md](development.md).

Not generated: the hook files (`hooks/hooks.json`, `hooks/codex.json`, `com.github.copilot/hooks/hooks.json`), the
OpenCode plugin and the manifests. Edit those by hand.

## 4. Hook configuration, per host

All hook commands call `pag guard --host=<x>` before a tool runs (`PreToolUse`-style) and `pag status --host=<x>` at
session start. `status` prints one plain-text line and fails open on any error. The guard's input and deny formats are
in [safety-and-policy.md](safety-and-policy.md) section 5.

### Claude Code: `hooks/hooks.json`

Auto-loaded from the plugin root; `.claude-plugin/plugin.json` lists only `skills`. The hook uses the **exec form**
(`"command": "node"`, `"args": [...]`), which needs no shell and no quoting, and expands `${CLAUDE_PLUGIN_ROOT}`:

- `PreToolUse`, matcher `Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch` -> `pag.mjs guard --host=claude`.
  A deny is the reason on stderr with exit 2.
- `SessionStart` -> `pag.mjs status --host=claude`.

### Codex: `hooks/codex.json` and `.codex-plugin/plugin.json`

[.codex-plugin/plugin.json](../.codex-plugin/plugin.json) carries `skills: ["./skills/port-any-game"]` and
`hooks: "./hooks/codex.json"`. Codex has no `args` field, so each handler is a shell string, with a PowerShell variant:

- `command` (POSIX): `node "${PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/.../pag.mjs" guard --host=codex`.
- `commandWindows` (PowerShell): the same with `$env:PLUGIN_ROOT` falling back to `$env:CLAUDE_PLUGIN_ROOT`, ending in
  `; exit $LASTEXITCODE` (spike [b](spikes/b-hooks-windows.md): without it PowerShell turns exit 2 into 1).
- `PreToolUse` matcher `Bash|apply_patch`, `timeout` 30. A deny is JSON at exit 0, independent of the Windows shell.
  The guard reads `apply_patch` file paths from the patch text.
- `SessionStart` -> `status --host=codex`.

Codex asks the user to review hooks before they run (README: trust them, or open `/hooks`). Whether Codex honours this
manifest over `.claude-plugin/plugin.json`, and loads `codex.json` rather than `hooks.json`, is unverified
([evals/tier1.md](evals/tier1.md)). Keep `version` equal in all manifests (validate enforces it).

### Copilot: `com.github.copilot/hooks/hooks.json`

Format `version: 1` with `preToolUse` and `sessionStart`. Each entry has a `bash` and a `powershell` command using
`$PLUGIN_ROOT` / `$env:PLUGIN_ROOT`, and ends in `|| true` / `; exit 0`. Copilot `preToolUse` is **fail-closed** on a
crash, so these forms force a fail-open. The deny is JSON `permissionDecision: deny` at exit 0. The generated agents in
`com.github.copilot/agents/` use Copilot tool aliases. Whether a root variable is set for plugin hooks is unverified,
which is why this route is not advertised.

### OpenCode: `opencode/plugin`

[opencode/plugin/index.js](../opencode/plugin/index.js) (zero dependencies) has one default export that serves both
major versions:

| Version | Entry | Behaviour |
|---|---|---|
| v2 | `id` + `setup(ctx)` | registers `ctx.permission.hook('evaluate', ...)` synchronously; a deny sets `effect = 'deny'` and `message` (what the model sees) |
| v1 (>= 1.18.29) | `server(ctx)` | returns `tool.execute.before`; throwing blocks the call |

Both import `policy.mjs` and `guard.mjs` directly (no `pag guard` subprocess) and use `normalizeEvent` on the raw
event. The skill is found at `../../skills/port-any-game/scripts` relative to the plugin (true in the repo and in the
installed layout), then `<xdg>/opencode/skills`, `~/.agents/skills`, `~/.claude/skills` (for the `github:` route that
may copy only the plugin folder, R57). If it is not found, or policy throws, it logs and allows (fail open, R22).

OpenCode 1.x discovers only top-level files in `plugins/`, not directories (spike [c](spikes/c-opencode-guard.md)), so
the installer writes a **top-level shim** `<base>/plugins/port-any-game.js`:
`export { default } from "./port-any-game/index.js";`, beside the plugin directory.

[opencode.jsonc.example](../opencode/opencode.jsonc.example) holds optional declarative v2 `permissions` rules: deny
`*steamless*`, `*noceg*`, `*steamemu*`, `*steam_emu*`; ask on `wrangler deploy`. They need no plugin code and are never
written for the user. OpenCode 1.x uses a different key (`permission`) and does not read them. OpenCode has no
session-start status hook here.

## 5. `scripts/install.mjs`

[install.mjs](../scripts/install.mjs) is for hosts without a marketplace. It copies the repo's own folders, prints each
step and never starts an agent.

```
node scripts/install.mjs --host=<opencode|skills> (--global | --project <dir>) [--dry-run]
```

| Flag | Meaning |
|---|---|
| `--host=opencode` | skill, subagents, command and guard plugin for OpenCode |
| `--host=skills` | the skill only, for any other agent |
| `--global` / `--project <dir>` | exactly one is required; the project folder must exist |
| `--dry-run` | print `would copy/replace/write` lines; change nothing |

Exit 0 done, 1 an error while copying, 2 usage.

**Targets**

| Host and scope | Writes |
|---|---|
| `skills --global` | `~/.agents/skills/port-any-game` and `~/.claude/skills/port-any-game` |
| `skills --project <dir>` | `<dir>/.agents/skills/port-any-game` |
| `opencode --global` | under `<xdg>/opencode` (default `~/.config/opencode`): `skills/port-any-game`, `agents/*.md`, `commands/port-game.md`, `plugins/port-any-game/` and the shim `plugins/port-any-game.js` |
| `opencode --project <dir>` | the same under `<dir>/.opencode` |

`~` is `%USERPROFILE%` on Windows and `$HOME` elsewhere (Node's `homedir()`).

**Safety**

- **Never writes `opencode.json(c)`.** It checks `opencode.json` and `opencode.jsonc` in the config dirs. If one exists
  it prints "Left unchanged: ..." and the optional rules to merge; otherwise it prints where to create one and the
  example. The user merges it.
- **Link-safety.** Each target is `lstat`ed first. A target that is a symlink or junction (for example left by `npx
  skills add -g`) is **skipped** with `skip <path>: it is a link ...`, never written through. An existing real target
  is deleted and re-copied, so a reinstall is an exact copy. All steps are decided before any is applied. Only the
  target itself is checked; a link in a parent directory is not detected ([roadmap.md](roadmap.md)).
- `--dry-run` writes nothing and prints `dry run: nothing written`.
- Plugin and skill must sit in the same OpenCode dir: the plugin imports `../../skills/port-any-game/scripts/policy.mjs`.

**`PAG_HOME`.** [decisions.md](decisions.md) (R7) says `install.mjs` honours `PAG_HOME`; the code does not read it. Tests
isolate the installer by setting `HOME`/`USERPROFILE` and `XDG_CONFIG_HOME` instead
([install.test.mjs](../test/install.test.mjs)).

## 6. Plugin manifests and the marketplace

| File | Role |
|---|---|
| [.claude-plugin/plugin.json](../.claude-plugin/plugin.json) | Claude Code manifest: `name`, `version`, `description`, `license`, `repository`, `skills`. Codex can also install from it |
| [.claude-plugin/marketplace.json](../.claude-plugin/marketplace.json) | Marketplace listing for `claude plugin marketplace add` and `codex plugin marketplace add`: one plugin, `"source": "./"` (the repo root is the plugin) |
| [.codex-plugin/plugin.json](../.codex-plugin/plugin.json) | Codex manifest: `skills` plus `hooks: ./hooks/codex.json` |
| [opencode/plugin/package.json](../opencode/plugin/package.json) | Makes `opencode/plugin` a loadable package (`exports: ./index.js`) |
| `package.json` | Repo scripts (`test`, `gen`, `e2e`, `validate`); `private`, `engines.node >= 20.12` |

`scripts/validate.mjs` enforces equal `version` across `package.json`, `.claude-plugin/plugin.json`, `plugin.json`
(if present), `.codex-plugin/plugin.json` and `opencode/plugin/package.json`. No root `plugin.json` exists on purpose:
Codex preferred one over `.claude-plugin/` and Copilot and Cursor may too, so it would be a second source of truth
(spike [a](spikes/a-layout-coexistence.md)). If one is added, keep `version` and `description` identical. The README
install block pins nothing; the `github:` route uses the `v0.1.0` tag, which is created at release.

## 7. How to add a new host

1. **Find out the facts first.** Where does it load skills from, does it have subagents or commands, how is a hook
   configured, what is the stdin payload, how is a deny expressed, and which shell runs the hook on Windows? Record
   observed versus documented, as the spikes do.
2. **Skills only.** If the host is supported by `npx skills add`, nothing is needed: add the install line to the README
   "other agent" block. Otherwise add a target to `plan()` in [install.mjs](../scripts/install.mjs) and a test in
   [install.test.mjs](../test/install.test.mjs).
3. **Guard.** Save a real payload as a fixture in `test/fixtures/hook-payloads/` with a `_provenance` line
   (`documented: <url>` or `observed: <how>`). Teach `normalizeEvent` the payload shape and, if the deny format
   differs, add a `case` to `formatDeny` in [guard.mjs](../skills/port-any-game/scripts/guard.mjs); extend
   [guard.test.mjs](../test/guard.test.mjs). Add tool names to the `SHELL`, `WRITE`, `FETCH` sets if needed.
4. **Hook file.** Add the host's config file by hand, calling `pag.mjs guard --host=<x>` and `status`. Make it fail
   open, and mind the Windows exit-code trap (end PowerShell forms with `exit $LASTEXITCODE`, or choose JSON deny at
   exit 0).
5. **Subagents and commands.** If the host has its own format, add a transform in
   [gen-wrappers.mjs](../scripts/gen-wrappers.mjs): extend `generate()` and the `GENERATED` list so stale files are
   caught, then run `npm run gen` and commit; extend [gen-wrappers.test.mjs](../test/gen-wrappers.test.mjs).
6. **Manifest.** If the host reads its own manifest, add it and include it in the version-sync list in
   [validate.mjs](../scripts/validate.mjs). Check precedence against `.claude-plugin/plugin.json` before shipping.
7. **Verify in a real session**, add the host's checks to [evals/tier1.md](evals/tier1.md), and only then add it to the
   README install block. Until verified, say so in the README, as for Copilot and the OpenCode `github:` route.
