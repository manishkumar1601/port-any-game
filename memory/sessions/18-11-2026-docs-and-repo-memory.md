# 18-11-2026-docs-and-repo-memory

**Goal:** make the repo self-explaining on any machine, with full system docs in `docs/` and a project memory in `memory/`, so a fresh clone carries all the context.

## What happened

- **Deleted `feat/m1-core`** locally and on GitHub. `master` is the only branch.
- **Wrote the system docs** in `docs/`, from the code (the code wins over older docs). Each doc area was drafted in parallel by a doc-writer agent, then checked for accuracy against the code.
  - [README](../../docs/README.md) is the index.
  - The docs: architecture, cli, lanes, survey-and-catalog, runtime, verify, safety-and-policy, agent-integration, development, decisions, roadmap.
- **`docs/decisions.md`** makes rulings S1–S4 and R3–R69 permanent, and **`docs/roadmap.md`** does the same for the M2 backlog. Both were taken from the git-ignored build ledger before it was deleted.
- **Created `memory/`:**
  - `README.md` with the session index and how to log a session;
  - `project.md`;
  - `conventions.md`;
  - `sessions/` with a log per session, named `dd-mm-yyyy-topic-name`.
- **Added root pointers:** `CLAUDE.md` imports the memory files for Claude Code, and `AGENTS.md` points Codex, OpenCode and other agents at them.

## Owner rules recorded

- Work on `master` only.
- No unnecessary code comments; at most a one-line comment when one is needed.
- A session log goes in `memory/sessions/` with a row in `memory/README.md`, named `dd-mm-yyyy-topic-name`.

## Outcome

- **Commits:**
  - `16bf0bc`: system docs, decision log, roadmap;
  - `ae701ed`: `memory/`, `CLAUDE.md`, `AGENTS.md`;
  - `beb4853`: the rights hint now uses single quotes, and skill references and comments match the code.
- **Docs pass:** every link and anchor resolves (451 checked). The M2 backlog gained the code/doc gaps the writers found.
- **Tests:** unit suite 375 pass, 0 fail, 11 skip. The first run had one timing flake under load, and the rerun was clean.
- **CI:** green on Windows, macOS and Ubuntu, plus the Playwright tier, at `beb4853`.

## Open / next

- Tier-1 manual agent eval (release gate): `docs/evals/tier1.md`.
- Plan M2 from `docs/roadmap.md`.
