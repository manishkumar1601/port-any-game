# Spike A: does a root `plugin.json` coexist with `.claude-plugin/` on the flat layout?

Date: 2026-11-17. Machine: Windows 11 Pro 10.0.26200, Node 22.22.3. Repo HEAD 3769e61 (flat layout, ADR 0001).

Labels: **observed** = I ran it and saw it; **documented** = vendor docs or note 01, not run; **unverified** = neither.

## Verdict

**Is a root `plugin.json` (Agent Plugins 1.0.0) safe next to `.claude-plugin/`? No, not established. Omit it in M1.**

| Agent | Result | Basis |
|---|---|---|
| Claude Code 2.1.132 | Safe. Ignores a root `plugin.json`: validate, marketplace add, install and list all behave as without it. | observed |
| Codex CLI 0.166.0 | Installs fine, but **prefers the root `plugin.json` over `.claude-plugin/plugin.json`** (it took version 9.9.9 from the root file). Safe only while both manifests agree. | observed |
| Copilot CLI | Unverified. Documented: a root `plugin.json` carrying an Agent Plugins `$schema` wins over `.claude-plugin/plugin.json`, and an unsupported Agent Plugins version is rejected with no fallback. | not installed (see below); documented in note 01 §3 |
| Cursor | Unverified. Note 01 §3 says precedence between root `plugin.json` and `.cursor-plugin/plugin.json` is untested. | no CLI available |

Why omit: without a root `plugin.json`, Claude and Codex both install from `.claude-plugin/` alone (observed, below). The root file adds a second source of truth that Codex already prefers and that Copilot and Cursor may prefer, and I could not test either. Adding it later is cheap once someone can run those two agents.

If it is added later: keep `version` and `description` identical to `.claude-plugin/plugin.json`. `scripts/validate.mjs` already compares `version` across `package.json`, `.claude-plugin/plugin.json` and `plugin.json`. Also compare `description`.

## Isolation (R5)

Every CLI ran as a child process with `USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME` and `OPENCODE_CONFIG_DIR` pointing into `docs/spikes/scratch/t3/home/` (git-ignored).
- Observed: Claude wrote `home/.claude/plugins/...`; Codex wrote `home/.codex/plugins/cache/...`; `opencode debug paths` printed only scratch paths.
- Observed: after the run, the real `~/.claude/plugins/{installed_plugins,known_marketplaces}.json`, `~/.codex/config.toml` and `~/.config/opencode` contain no reference to `port-any-game`, and the real `~/.codex/plugins/cache/port-any-game` does not exist.
- No authenticated session, login, or model call was started. Marketplaces and plugins were removed from the scratch home after each test.

## What was run

Scratch repos, all made from `git archive HEAD`:
- `repoA`: tracked files + no-op logging `skills/port-any-game/scripts/guard.mjs` + Claude-format `hooks/hooks.json` (exec form).
- `repoB`: `repoA` + root `plugin.json` (Agent Plugins 1.0.0 `$schema`, `extensions."com.openai".hooks` = `./hooks/codex.json`) + `hooks/codex.json` (`command` + `commandWindows`).
- `repoC`: `repoB` with root `plugin.json` `version` changed to 9.9.9 to see which manifest wins.

Commands (identical for A, B, C unless noted):
- `claude plugin validate <repo>` and `claude plugin validate <repo>/.claude-plugin/plugin.json`
- `claude plugin marketplace add <abs path>` -> `claude plugin install port-any-game@port-any-game` -> `claude plugin list` -> uninstall and remove
- `codex plugin marketplace add <abs path>` -> `codex plugin list` -> `codex plugin add port-any-game@port-any-game` -> inspect cache -> remove

## Observed results

**Claude Code 2.1.132**
- `validate` on A and B: passes; the only warnings are "no marketplace description" and "no author". No mention of the root `plugin.json`, the extra `hooks/codex.json` or `$schema`. (Validate reads the marketplace and `.claude-plugin/plugin.json`; it does not read the root file.)
- marketplace add, install, list: identical output for A, B and C. `Version: 0.1.0` for C, so the root file's 9.9.9 is ignored. Cache dir `0.1.0`.
- Manifests read: `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`.

**Codex CLI 0.166.0**
- Reads the marketplace from `.claude-plugin/marketplace.json` (legacy-compatible path works): "Added marketplace `port-any-game`", plugin listed as `not installed` with source = repo root, then installs with no warnings.
- A (no root `plugin.json`): installed, version 0.1.0, taken from `.claude-plugin/plugin.json`. Cache `home/.codex/plugins/cache/port-any-game/port-any-game/0.1.0/` is a full copy of the repo.
- B (root `plugin.json` + `.claude-plugin/`): installs, no warnings.
- C: `codex plugin list` shows `installed, enabled 9.9.9`, and the cache dir is `.../9.9.9/`. So **the root `plugin.json` wins** when both exist.
- Not observable: whether Codex runs plugin hooks, and which of `hooks/hooks.json` or `extensions.com.openai.hooks` it uses. That needs a session and the `/hooks` trust review. See spike B.

**Copilot CLI**: the `copilot` on PATH is the VS Code shim (`.../Microsoft VS Code/bin/copilot-shim/copilot` plus a 792 KB `copilot.exe`). It is not the CLI. Running `copilot --version` prints "GitHub Copilot CLI was not found. Run copilot in a terminal to install it". I did not follow that (it would download and install into the real home). All Copilot install steps are unverified.

**Cursor**: no CLI installed. Unverified.

## Maintainer must verify (move to docs/evals/tier1.md)

1. Copilot CLI (real install, authenticated): `copilot plugin marketplace add <repo>` and `copilot plugin install port-any-game@port-any-game` on a repo that has a root `plugin.json`. Does it install, which manifest wins, any rejection?
2. Cursor: import the repo (team marketplace) or copy it into `~/.cursor/plugins/local/`, with and without a root `plugin.json`. Which manifest does it read?
3. Codex: with `.claude-plugin/` only, does the plugin's skill appear? Does `hooks/hooks.json` load from the cache copy? (Needs a session.)
4. Re-run Claude with the root `plugin.json` once a newer Claude Code is installed. Today's 2.1.132 ignores it.

## Notes for Task 22

- Flat layout works on Claude and Codex with no root `plugin.json` (observed).
- Codex copies the whole repo into its cache, including `docs/` and `test/`. Matches the ADR consequence ("keep them small").
- `claude plugin validate .` on the repo root only checks the marketplace; use the explicit `.claude-plugin/plugin.json` path to validate the plugin manifest too.
