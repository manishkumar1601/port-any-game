# Working conventions

These rules come from the project owner and from lessons learned while building M1. Follow them in every session, with every agent.

## Git

- Work on `master` only. Feature branches only if the owner asks.
- Commit and push after each completed task. Never force-push or rewrite pushed history.
- Author: `Manish` with the GitHub noreply address, already set in the repo-local git config. Do not change it.
- Never add `Co-Authored-By` trailers or any AI-tool attribution to commits or PRs.
- Use conventional commit messages (`feat:`, `fix:`, `docs:`, `ci:`, `test:`, `chore:`).

## Code

- **No unnecessary comments.** If one is needed, use a single short line.
- **Prefer the smallest correct change.** Use the stdlib first and reuse helpers that already exist in the repo.
- **Zero runtime dependencies**, ESM `.mjs`, cross-OS paths (`node:path`).
  - Compare real paths when symlinks or junctions may be involved, e.g. macOS `/var` → `/private/var` or Windows 8.3 short names.
  - Scripts that run as main must check `realpathSync(process.argv[1])`.
- **Exit codes:** 0 ok, 1 fail, 2 usage, 3 unsupported (verify), 4 policy refusal. `verify` alone uses 2 = warn and 1 = bad args. See `docs/cli.md`.
- **Tests:** a behaviour change needs a test that fails first (TDD). Fixtures are our own MIT code, never game data.

## Checks before pushing

```bash
PAG_E2E=0 npm test                # unit + integration, serial (~6 min)
npm run e2e                       # lane e2e with real runtimes (needs Chrome/Edge)
npm run validate                  # manifests + skill contract
node scripts/gen-wrappers.mjs --check   # generated host wrappers in sync
```

After you push, check that GitHub CI is green on all three operating systems.

## Docs and memory

- Docs in `docs/` describe how the system works. Update the affected doc in the same commit as the code change.
- `memory/` holds project memory. At the end of every session, add a session log (see [README](README.md#how-to-log-a-session)).
- Never write private data into the repo: no personal emails, no local machine paths, no tokens.

## Process

- New features go through: brainstorm, then a spec (`docs/superpowers/specs/`), then a plan (`docs/superpowers/plans/`), then implementation with review. Small fixes can go straight to implementation.
- Ask the owner when a decision is genuinely theirs. Otherwise make the call and record it in `docs/decisions.md`.
- Outward-facing actions need the owner's confirmation first: deleting branches, publishing, or changing GitHub settings.

## Known gotchas

- **Windows PowerShell 5.1 drops `"` from native arguments.** Pass user notes with `pag ack … --note-env PAG_NOTE` instead of `--note "…"`.
- **GitHub API without a token** allows 60 requests per hour. Job logs need auth, but check-run annotations are public, and the test reporters emit `::error` annotations for each failed test.
- **CI job-level `env` cannot use the `runner` context.** Use `matrix.os` there.
- **GPU-less CI runners render slowly.** macOS lane e2e uses `PAG_E2E_TARGET_FPS=10`; product fps thresholds are unchanged.
- **GitHub Windows runners run as admin.** Tests that lock files must probe that the read is really blocked, and skip otherwise.
