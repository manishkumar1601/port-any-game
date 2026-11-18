# 18-11-2026-m1-build-lanes-packaging-ci

**Goal:** finish M1 plan Tasks 16–23: the four lanes, packaging, the skill text, the agent wrappers and CI.

## What was built

| Task | Result | Commits |
|---|---|---|
| 16 | Lane `web-extract` (NW.js/Electron HTML5); build-time frame hook | `d347faa`…`268b1f1` |
| 17 | Lane `rt-ruffle` (Flash via Ruffle 0.7.1, BYO) | `fd357ed`, `2b30d34` |
| 18 | Lane `dos-jsdos` (js-dos 8.5.4 raw emulators API, in-browser bundle) | `68fd16e`, `901280a` |
| — | Verify samples only after the first painted frame (R46) | `cef72b7` |
| 19 | Lane `known-port` (routes to existing BYO web ports) | `81f7947`…`bd29dcf` |
| 20 | `pag package` with double-click launchers | `a1ee4a8`, `acb8209` |
| 21 | SKILL.md workflow, lane references, Codex metadata | `d2fe48d`, `29391e8` |
| 22 | Tier-1 agent wrappers, generator (`gen-wrappers.mjs`), installer | `cbffab6`…`bb9879a` |
| 23 | 3-OS CI with lane e2e; tier-1 eval procedure (`docs/evals/tier1.md`) | `3b566ab`, `6d45286` |

## Key decisions

Full text is in [docs/decisions.md](../../docs/decisions.md).

- **R36–R37:** web-extract targets 30 fps, and memory is judged only on soaks of 30 s or more.
- **R39:** a build-time injected `__pag_hook.js` counts frames.
- **R42 and R44:** dos-jsdos draws to its own canvas from the emulator's frames, using `dosboxWorker` with a seeded js-dos module cache.
- **R46–R47:** verify waits for the first frame, and test files run serially, to stop browser-timing flakes.
- **R50–R54:** the `pag ack` contract. A rights claim needs the user's own words, and `--note-env` works around PowerShell quoting.
- **R56–R57:** Copilot uses the skills route only in M1, and OpenCode falls back to the known skill folders.
- **R58:** the CI layout.

## Lessons

- **Browser e2e is timing-sensitive.** Wait for the first painted frame, and run tests serially.
- **Each host's hook config differs** (exec form, JSON deny, fail-open). Everything that can't be checked without a live session is listed in `docs/evals/tier1.md`.

## Next

Final whole-branch review. See [18-11-2026-m1-final-review-ci-green-master](18-11-2026-m1-final-review-ci-green-master.md).
