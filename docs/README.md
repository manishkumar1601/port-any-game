# Documentation index

This folder is the reference for how port-any-game works and why. It is written for new maintainers, contributors, and AI coding agents working on this repo after a fresh clone. For installing and using the tool, see the root [README.md](../README.md). For what is in and out of scope, see [SCOPE.md](../SCOPE.md). Runtime instructions for the agent that drives a port live in [skills/port-any-game/references/](../skills/port-any-game/references/), not here.

## Start here

Suggested reading order for a new maintainer:

1. [README.md](../README.md) and [SCOPE.md](../SCOPE.md): what the product does and does not do.
2. [architecture.md](architecture.md): the map. Components, pipeline, port folder, defence layers.
3. [safety-and-policy.md](safety-and-policy.md): the legal stance and the rules that cannot be relaxed. Read before touching anything in policy, guard or the git hooks.
4. [cli.md](cli.md): every `pag` command, flag and exit code.
5. [lanes.md](lanes.md) and [runtime.md](runtime.md): how a game becomes a web build.
6. [development.md](development.md): set up, test, extend, release.
7. [decisions.md](decisions.md) and [roadmap.md](roadmap.md): why it is this way, and what comes next.
8. [memory/README.md](../memory/README.md): current project state and recent session history.

When code and a doc disagree, the code wins. Fix the doc.

## System docs

| Doc | Covers |
|---|---|
| [architecture.md](architecture.md) | System overview, components, end-to-end data flow, port folder layout, data modes, defence layers, design principles. |
| [cli.md](cli.md) | `pag` command reference: arguments, flags, outputs, exit codes. |
| [lanes.md](lanes.md) | The lane model and ladder, each M1 lane, how to add a lane. |
| [survey-and-catalog.md](survey-and-catalog.md) | Survey internals, detection rules, verdicts, catalog tiers. |
| [runtime.md](runtime.md) | The web shell, `shell.json`, pack, headers and CSP, OPFS import and saves, serve, package and launchers. |
| [verify.md](verify.md) | Verify tiers, checks, thresholds, reports, exit codes. |
| [safety-and-policy.md](safety-and-policy.md) | Legal stance, data modes, acknowledgements, policy rules, guard, git hooks. |
| [agent-integration.md](agent-integration.md) | Host wrappers, hook formats, the generator, the installer, verified versus unverified routes. |
| [development.md](development.md) | Repo layout, conventions, tests, e2e, environment variables, CI, release gates, how to extend. |
| [decisions.md](decisions.md) | Decision log: rulings S1-S4 and R3-R69, condensed. |
| [roadmap.md](roadmap.md) | Milestones M1 to M6, M1 status, M2 backlog. |

## Design record

| Doc | Covers |
|---|---|
| [superpowers/specs/2026-11-17-port-any-game-design.md](superpowers/specs/2026-11-17-port-any-game-design.md) | The approved design and plan (rev 2): intent, lane ladder, shell contract, legal rules, milestones. The source of intent; the code is the source of fact. |
| [superpowers/plans/2026-11-17-port-any-game-m1-core.md](superpowers/plans/2026-11-17-port-any-game-m1-core.md) | The M1 implementation plan: core, Tier 1 packaging and the four M1 lanes, task by task. |
| [adr/0001-flat-plugin-layout.md](adr/0001-flat-plugin-layout.md) | Why the repo root is the plugin (flat layout) instead of `plugins/<name>/`. |
| [evals/tier1.md](evals/tier1.md) | The manual Tier 1 agent eval: Claude Code, Codex and OpenCode take a fixture game to playable in 5 touchpoints or fewer, on each OS. The remaining M1 exit criterion. |

## Research notes

Planning-stage notes dated 2026-11-17. They record what was checked and the options considered. Versions and facts were current that day; re-verify before relying on them.

| Note | Subject |
|---|---|
| [01-agent-distribution.md](research/01-agent-distribution.md) | Shipping one skill or plugin to many coding agents on Windows, macOS and Linux: packaging and installation. |
| [02-native-binary-lanes.md](research/02-native-binary-lanes.md) | Running an existing compiled PC game in a browser with no source: emulation and related lanes. |
| [03-engine-and-source-lanes.md](research/03-engine-and-source-lanes.md) | Engine-specific and source-based lanes: games that already are web tech, engine runtimes, open-source reimplementations. |
| [04-detection-and-legal.md](research/04-detection-and-legal.md) | Fingerprinting a game install folder for the survey, and the legal limits a porting tool must enforce. Not legal advice. |
| [05-web-runtime-build-test.md](research/05-web-runtime-build-test.md) | The shared web runtime, build host, automated verification and hosting; section 9 proposes the shared lane contract. |
| [06-agent-ecosystem-and-companions.md](research/06-agent-ecosystem-and-companions.md) | Tools and skills to bundle, mention or avoid; OpenCode v2 in detail; Codex `agents/openai.yaml`. |
| [07-port-catalogs.md](research/07-port-catalogs.md) | Catalogs and datasets for "does a browser path for this game already exist?". |
| [08-prior-art-retro-port-and-atbgameport.md](research/08-prior-art-retro-port-and-atbgameport.md) | What retro-port (MIT) and ATBGamePort (GPL-3.0) do, what to borrow, what not to copy. |

## Spikes

Short experiments run before building. Each labels findings as observed, documented or unverified. Throwaway scripts sit in `docs/spikes/scratch/`, which is git-ignored.

| Spike | Question |
|---|---|
| [a-layout-coexistence.md](spikes/a-layout-coexistence.md) | Does a root `plugin.json` coexist with `.claude-plugin/` on the flat layout? |
| [b-hooks-windows.md](spikes/b-hooks-windows.md) | Hook configs and stdin payloads on Windows for Codex, Copilot, Claude and others. The real hook round trip was not run; payloads are documented, not captured. |
| [c-opencode-guard.md](spikes/c-opencode-guard.md) | The dual v1/v2 OpenCode guard plugin. |
| [d-cdp-verify.md](spikes/d-cdp-verify.md) | Driving Chrome and Edge over CDP with Node's global WebSocket and no npm dependencies (the verify driver). |
| [e-jsdos-bundle.md](spikes/e-jsdos-bundle.md) | Embedding a js-dos 8.5.4 bundle for the DOS lane. |

## Project memory

The repo's [memory/](../memory/README.md) folder holds project context, conventions and session logs, so any person or agent can resume work on any machine. It is maintained separately from `docs/`: current status and recent history live there, while `docs/` describes how the system works. Start at [memory/README.md](../memory/README.md).

## Conventions for these docs

- Cite code as relative links, for example [pack.mjs](../skills/port-any-game/scripts/pack.mjs).
- Do not copy agent-facing instructions from `references/*.md`; link to them.
- No local machine paths, personal data or session IDs.
