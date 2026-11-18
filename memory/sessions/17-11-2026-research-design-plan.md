# 17-11-2026-research-design-plan

**Goal:** turn "a skill or plugin that converts any PC game to a browser-playable game" into a researched, approved design and an implementation plan, before writing any code.

## What happened

- **The ask.** The owner wanted one skill/plugin usable from any AI agent (Claude Code, Codex, OpenCode, Copilot, others) on Windows, macOS and Linux. The package had to be self-contained: skills, hooks, rules and subagents.
- **References studied:**
  - retro-port: MIT, Claude/macOS-only, with a D3D8 static-recompilation lane;
  - ATBGamePort: GPL-3.0, an HTML5 rewrite approach. Ideas only.
- **Owner's answers:**
  - all game types;
  - motivated by open source;
  - public MIT release;
  - no commits or pushes during planning.
- **Research notes** written to `docs/research/`:
  - 01 agent distribution;
  - 02 native-binary lanes;
  - 03 engine and source lanes;
  - 04 detection and legal limits;
  - 05 web runtime, build and test;
  - 06 agent ecosystem;
  - 07 port catalogs;
  - 08 prior art.
- **Design spec**, rev 2: `docs/superpowers/specs/2026-11-17-port-any-game-design.md`.
  - **Strategy C:** router + catalog + lanes + shared shell + verify.
  - **The lane ladder:** reuse a port, run the data in a web runtime, rebuild, emulate, recompile or rewrite; Remote Play is the honest catch-all.
  - **Data modes:** bring-your-own (BYO) by default, bundled builds kept private.
  - **Defence in depth:** skill text, scripts, agent hooks, git hooks.
  - **Milestones M0 to M6.**
- **The owner approved** every "call I made" in §18 of the spec.
- **M1 plan:** `docs/superpowers/plans/2026-11-17-port-any-game-m1-core.md`, 23 tasks with Global Constraints and Review Focus. The owner chose subagent-driven execution (a fresh implementer per task, then a task review, then a final whole-branch review).

## Decisions

- Tier 1 agents are Claude Code, Codex and OpenCode. Copilot and the others use the skills route.
- The repo uses a flat plugin layout (ADR 0001).
- Verify needs no install by default: it drives the user's own Chrome or Edge over CDP, with Playwright as the fallback.
- A DRM'd executable means STOP for in-browser lanes.

## Outcome

The spec and plan are approved, and the repo skeleton is committed as `563e585`. The owner later lifted the no-push rule: commit and push as Manish after each task.

## Next

Execute the M1 plan task by task. See [17-11-2026-m1-build-core](17-11-2026-m1-build-core.md).
