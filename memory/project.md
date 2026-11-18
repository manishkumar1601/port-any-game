# Project context

## What this is

`port-any-game` is an MIT open-source skill and plugin. Any AI coding agent can use it to port a PC game the user owns to a browser-playable build, on Windows, macOS and Linux. The CLI is `pag` (`skills/port-any-game/scripts/pag.mjs`).

- **Tier 1 agents:** Claude Code, Codex and OpenCode. Copilot and other hosts install through the skills route (`npx skills add`).
- **Repo:** `github.com/manishkumar1601/port-any-game`. The only branch is `master`.

## Why

- **The owner wants every type of game supported.** The milestones still take the cheap lanes first, since those cover the most games soonest.
- **The motivation is open source:** a public release under the MIT licence.
- **The deliverable** is just the skill/plugin, usable from any agent.

## Hard constraints

- **Legal limits.**
  - Port only games the user owns.
  - No DRM circumvention, ever: a DRM'd executable means STOP.
  - No game data, game-data URLs or copyrighted material in the repo, fixtures or catalog.
- **Licences and prior art.**
  - The plugin is MIT, and GPL code is never vendored into it.
  - GPL runtimes (js-dos) run as separate tools, shipped with their licence text.
  - ATBGamePort (GPL-3.0) is prior art for ideas only. Never copy its code, branding or its "I am the copyright holder…" priming prompt.
  - retro-port (MIT) may be forked for the M5 recompilation lane, with attribution.
- **Runtime.** Zero runtime dependencies, Node ESM `.mjs`, stdlib only. The user floor is Node ≥ 20.12; development and CI use Node 22.
- **Safety model.** The scripts are the authority. Agent hooks are a safety net that fails open, and the port's git hooks are agent-independent.
- **Rights-holder publishing.** Public publishing of game data needs an explicit statement recorded in the user's own words (`pag ack ACK_RIGHTS_HOLDER --note`), or catalog-confirmed redistributable data.
- **No telemetry.**

## Where things are

| Need | Look in |
|---|---|
| How the system works | [docs/README.md](../docs/README.md) (index of all docs) |
| Approved design (binding) | [docs/superpowers/specs/2026-11-17-port-any-game-design.md](../docs/superpowers/specs/2026-11-17-port-any-game-design.md) |
| M1 implementation plan (done) | [docs/superpowers/plans/2026-11-17-port-any-game-m1-core.md](../docs/superpowers/plans/2026-11-17-port-any-game-m1-core.md) |
| Why a decision was made | [docs/decisions.md](../docs/decisions.md) (rulings S1–S4, R3–R69) |
| What's next | [docs/roadmap.md](../docs/roadmap.md) (milestones + M2 backlog) |
| Research behind the design | [docs/research/](../docs/research/) (01–08) |
| Manual agent evals | [docs/evals/tier1.md](../docs/evals/tier1.md) |

## Status (18-11-2026)

- **M1 (core plus Tier-1 packaging plus the first lanes) is complete:** 23 tasks, a whole-branch review and one fix wave.
  - M1 lanes: `web-extract`, `known-port`, `rt-ruffle`, `dos-jsdos`.
  - CI is green on Windows, macOS and Ubuntu, plus the Playwright verify tier.
- **Open release gate:** the tier-1 manual agent eval (`docs/evals/tier1.md`), a fresh-machine run in Claude Code, Codex and OpenCode.
- **M2 is split into four parts,** done in this order: M2a (upstream-runtime lanes), M2b (`remote-play`), M2c (runtimes built in our own CI: `rt-scummvm`, `rt-idtech`), M2d (catalog expansion).
- **M2a is in progress.**
  - **Done:** `rt-easyrpg` (RPG Maker 2000/2003) and `rebuild-love` (LÖVE) are shipped and green on all three CI operating systems.
  - **Built:** `rebuild-renpy` (Ren'Py 8.x), green on CI, with its first review fix round finishing.
  - **Left:** plan Task 7 (decisions, roadmap, docs) and the final whole-branch review.
  - Resume from [sessions/18-11-2026-m2a-runtime-lanes.md](sessions/18-11-2026-m2a-runtime-lanes.md), under "Open / next".
