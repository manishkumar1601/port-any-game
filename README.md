# port-any-game

A cross-agent skill and plugin that ports PC games you own to a private browser build. It surveys the game folder,
recommends a porting lane, builds the port, and verifies it runs. You bring your own game files, and nothing is
uploaded. Flash and DOS builds hold no game files at all: on first start the page copies them from your folder into
the browser. An already-web game's build (and its package) does contain a copy of the game files, so it stays private
and is never for sharing publicly.

**Not legal advice.** The skill refuses to get around copy protection or to share game files, but laws differ by
country. See [legal guardrails](skills/port-any-game/references/legal.md), and ask a lawyer where you live when you
are unsure about your own case.

## What it does

Ask your coding agent, in your own words, for example:

> Port the game in "D:\Games\My Game" to the browser. Put the port in "D:\Ports\my-game".

The agent surveys the folder (read-only), tells you which lane fits and asks the few questions that need your answer.
Then it builds the port, checks it in Chrome or Edge, and hands you a local address and a two-minute check to do
yourself. In this first version (M1) it can port:

| Game | Lane | What you get |
|---|---|---|
| Already-web games: NW.js or Electron wrappers, RPG Maker MV/MZ, Construct, GDevelop, Twine | `web-extract` | the game's own web build, served from this computer |
| Flash (`.swf`) games | `rt-ruffle` | the game in Ruffle; your `.swf` is imported into the browser |
| DOS games | `dos-jsdos` | the game in DOSBox (js-dos); your files are imported into the browser, saves are kept |
| RPG Maker 2000/2003 games | `rt-easyrpg` | the game in EasyRPG Player; your files are imported into the browser, saves are kept |
| Games with an open-source re-creation (for example fheroes2, Augustus) | `known-port` | where to get the port and which of your files it needs |

Everything else (Windows-only 3D games, consoles, online games) gets an honest "not yet" or "no" from the survey.
Games with DRM or anti-cheat that would have to be bypassed are refused. The tools target Windows, macOS and Linux;
the build plays in current Chrome and Edge (other browsers may work but are not tested yet).

<!-- install-block -->
## Install

You need git and Node.js 20.12 or newer (`node --version`). The commands work in any shell on Windows, macOS and Linux,
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
On older Node, or without npx, after `git clone`: `node port-any-game/scripts/install.mjs --host=skills --global`.
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
On older Node, or without npx, after `git clone`: `node port-any-game/scripts/install.mjs --host=skills --global` copies
the skill to `~/.agents/skills` and `~/.claude/skills`.
<!-- /install-block -->

## Development

The plugin has no runtime dependencies. The tests need Node.js 22 (the browser tests drive Chrome or Edge over the
built-in WebSocket) and Chrome or Edge for the browser end-to-end cases, which skip with a message when none is found.

```
npm test           # unit and browser tests (PAG_E2E=0 skips the lane end-to-end cases)
npm run e2e        # lane end-to-end cases: fixture game -> survey -> build -> pack -> verify in a browser
npm run validate   # skill and manifest checks, and generated wrappers up to date
```

After editing `agents/`, run `npm run gen` and commit the generated wrappers. See [SCOPE.md](SCOPE.md) for what
issues and pull requests fit.
