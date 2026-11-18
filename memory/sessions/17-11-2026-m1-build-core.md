# 17-11-2026-m1-build-core

**Goal:** build the M1 core, plan Tasks 1–15. A fresh implementer subagent did each task, then a task review checked it, with fix rounds until clean. Each completed task was pushed.

## What was built

| Task | Result | Commits |
|---|---|---|
| 1 | Repo skeleton, manifests, `scripts/validate.mjs` | `563e585`, `777f7c7` |
| 2–3 | Spikes a–e (layout, Windows hooks, OpenCode guard, CDP verify, js-dos bundle) → `docs/spikes/` | `c32d81a`…`d15d362` |
| 4 | fs, hashing, zip/asar/tar archive primitives (`scripts/lib/`) | `7fb0f76` |
| 5 | PE executable parser (`survey/pe.mjs`) | `8475515` |
| 6 | Engine, API, protection and identity rules | `28ef65d`, `64c0d4d` |
| 7 | Offline known-port catalog and matcher | `aa4213d`…`dae17d7` |
| 8 | Lane registry, verdict, `pag survey` | `e4ff547`, `17fc418` |
| 9 | Policy module and cross-agent hook guard | `1084abb`, `789c55f` |
| 10 | `pag doctor`, pinned resumable `pag setup` | `9a1e4bd`, `ac70bfe` |
| 11 | `pag new` with project rules and git guard hooks | `674e034` |
| 12 | `pag serve` (headers, Range, loopback default) | `e51f64b`, `2516d8c` |
| 13 | Shared web shell and `pag pack` | `9400442`, `45d7a90` |
| 14 | `pag verify` (CDP default, Playwright fallback) | `25160a7`, `3b3b962` |
| 15 | `pag status` for session-start context | `c61bba0`, `727909d` |

## Key decisions

Full text is in [docs/decisions.md](../../docs/decisions.md).

- **R13–R14:** git identity is Manish (noreply). Push after each task; never force-push.
- **R15–R17:** spike results. No root `plugin.json`; deny formats follow each host; OpenCode gets a top-level shim.
- **R18–R21:** distinctive catalog signatures and protection rules, GO before HARD in lane ranking, and public use gated on rights.
- **R22:** the guard fails open.
- **R25–R31:** the lane module contract, a content-hashed runtime folder, a stable per-port serve port, and a BYO fixture index.

## Lessons

- **Review rounds caught real bugs:** symlink containment in pack, a rAF hook race, and refuse-word scope in the policy.
- **Windows PowerShell 5.1 quoting** loses `"` in native arguments, which led to the later `--note-env`.

## Next

Lanes, packaging and CI. See [18-11-2026-m1-build-lanes-packaging-ci](18-11-2026-m1-build-lanes-packaging-ci.md).
