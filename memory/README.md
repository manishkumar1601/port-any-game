# Project memory

This folder is the project's memory. It holds the context, rules and history that a person or an AI agent needs to pick up work on any machine after a fresh `git clone`. Root [CLAUDE.md](../CLAUDE.md) and [AGENTS.md](../AGENTS.md) point agents here automatically.

## Read first

1. [project.md](project.md): what this is, why, the hard constraints, and current status.
2. [conventions.md](conventions.md): git, code, test and docs rules, plus known gotchas.
3. The latest entries under **Sessions** below.
4. [../docs/README.md](../docs/README.md) when you need to know how a part of the system works.

## Sessions

Each session has a one-line summary here and a full log in `sessions/`, named `dd-mm-yyyy-topic-name`. The newest is at the bottom.

| Session | Summary |
|---|---|
| [17-11-2026-research-design-plan](sessions/17-11-2026-research-design-plan.md) | Research notes 01–08, approved design spec (rev 2), M1 plan with 23 tasks. |
| [17-11-2026-m1-build-core](sessions/17-11-2026-m1-build-core.md) | M1 Tasks 1–15: skeleton, spikes, survey, catalog, policy/guard, setup, new, serve, shell/pack, verify, status. |
| [18-11-2026-m1-build-lanes-packaging-ci](sessions/18-11-2026-m1-build-lanes-packaging-ci.md) | M1 Tasks 16–23: four lanes, package, SKILL.md, agent wrappers/installer, 3-OS CI. |
| [18-11-2026-m1-final-review-ci-green-master](sessions/18-11-2026-m1-final-review-ci-green-master.md) | Whole-branch review and fix wave (C1, I1–I8), CI repaired and green on all OSes, moved to `master`. |
| [18-11-2026-docs-and-repo-memory](sessions/18-11-2026-docs-and-repo-memory.md) | Full system docs in `docs/`, this `memory/` folder, root `CLAUDE.md`/`AGENTS.md`. |
| [18-11-2026-m2a-runtime-lanes](sessions/18-11-2026-m2a-runtime-lanes.md) | M2 split into M2a–d. M2a spikes, design and plan; Tasks 1–5 done; `rt-easyrpg` and `rebuild-love` shipped, `rebuild-renpy` built. **In progress: resume here.** |

## How to log a session

At the end of every working session:

1. **Create `sessions/dd-mm-yyyy-topic-name.md`.** Use the date the work happened and a short kebab-case topic.
2. **Use this shape:**

   ```markdown
   # dd-mm-yyyy-topic-name

   **Goal:** one line.

   ## What happened
   ## Key decisions   (link docs/decisions.md entries; add new ones there)
   ## Outcome          (commits, CI state)
   ## Open / next
   ```

3. **Add a row to the Sessions table above.**
4. **Update `project.md` → Status** if the project state changed.
5. **Update `conventions.md`** if you learned a rule or gotcha worth keeping.

Keep entries factual and short. Never write personal emails, tokens or local machine paths.
