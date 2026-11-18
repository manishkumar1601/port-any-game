# port-any-game

A cross-agent skill and plugin that ports PC games you own to a private browser build. It surveys the game folder, recommends a porting lane, builds the port, and verifies it runs. You bring your own game files; nothing about the game is bundled or uploaded.

<!-- install-block -->
## Install

You need git and Node.js 20 or newer (`node --version`). The commands work in any shell on Windows, macOS and Linux,
except the `DISABLE_TELEMETRY=1` prefix, whose PowerShell form is shown where it appears.

**Claude Code**

```
claude plugin marketplace add manishkumar1601/port-any-game
claude plugin install port-any-game@port-any-game
```

**Codex**

```
codex plugin marketplace add manishkumar1601/port-any-game
codex plugin add port-any-game@port-any-game
```

Codex asks you to review the plugin's hooks before they run: trust them when prompted (or open `/hooks`).

**GitHub Copilot** (CLI and VS Code)

```
DISABLE_TELEMETRY=1 npx skills add manishkumar1601/port-any-game -g -a github-copilot
```

`npx skills` needs Node.js 22.20 or newer. In PowerShell, run `$env:DISABLE_TELEMETRY=1` first, then the `npx` command.
On Node 20, or without npx, after `git clone`: `node port-any-game/scripts/install.mjs --host=skills --global`.
The Copilot plugin route, with hooks, comes after it has been verified.

**OpenCode** (installs the skill, subagents, the `/port-game` command and the guard plugin into `~/.config/opencode`)

```
git clone https://github.com/manishkumar1601/port-any-game
node port-any-game/scripts/install.mjs --host=opencode --global
```

Use `--project <folder>` instead of `--global` for one project, and `--dry-run` to see the copies first. The installer
never edits an existing `opencode.json(c)`; it prints the optional lines to merge. On OpenCode 2.x only, the guard
plugin can also come straight from GitHub, with the skill from the route below:

```
opencode plugin add "github:manishkumar1601/port-any-game#v0.1.0::path:opencode/plugin"
```

The `v0.1.0` tag is created at release. This GitHub route is unverified until it is checked with a real OpenCode 2.x
session, so prefer the clone route above.

**Any other agent** (Amp, Cline, Goose, Junie, Zed, Warp and others get the skill only)

```
DISABLE_TELEMETRY=1 npx skills add manishkumar1601/port-any-game -g -a <agent>
```

`npx skills` needs Node.js 22.20 or newer. In PowerShell, run `$env:DISABLE_TELEMETRY=1` first, then the `npx` command.
On Node 20, or without npx, after `git clone`: `node port-any-game/scripts/install.mjs --host=skills --global` copies
the skill to `~/.agents/skills` and `~/.claude/skills`.
<!-- /install-block -->
