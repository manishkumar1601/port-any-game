# 18-11-2026-m1-final-review-ci-green-master

**Goal:** review the whole M1 branch, fix what matters, get CI green on all three operating systems, and move to a `master` branch.

## Final review

A whole-branch review found 1 Critical, 8 Important and 21 Minor issues. One fix wave (`4813a4c`…`d03a463`, 14 commits) handled:

- **C1:** the strict CSP broke RPG Maker MV/MZ and Twine. The web-extract lane now declares an `'unsafe-eval' 'unsafe-inline'` relaxation (R61).
- **I1:** the Claude hook matcher now includes `PowerShell` and `NotebookEdit`.
- **I2:** the guard refuses a recursive delete of a port folder, because the `game` junction can lead into the real install (`GAME_LINK_DELETE`).
- **I3:** public use is gated on rights only, end to end, and catalog `redistributable_data` reaches `port.json` (R63).
- **I4:** DOS saves persist through `ci.persist()` into OPFS, and verify runs the lane's save path (R64).
- **I5:** the Playwright verify tier now runs in CI (Ubuntu, Xvfb).
- **I6:** the README gained usage, M1 lanes, "not legal advice" and a development section.
- **I8:** engine/title catalog matches are HARD and need user confirmation.
- **Also:** 17 minors and 4 extras: a setup stall timeout, Edge on Linux, `PAG_*`-only `--note-env`, and a byte-exact hook splice.

The re-review found nothing Critical or Important. Seven minor items are parked in [docs/roadmap.md](../../docs/roadmap.md).

## CI repair

Commits `aa9a221`…`c338589`.

- **Workflow rejected outright:** a job-level `env` used the `runner` context, which isn't allowed there.
- **A real bug:** `gen-wrappers`, `validate` and `install` silently did nothing when run through a symlinked path. They now compare `realpath` of `argv[1]`.
- **Windows runners run as admin,** so the locked-file tests now probe the lock and skip if it doesn't hold.
- **macOS runners have no GPU.** Lane e2e there targets 10 fps (`PAG_E2E_TARGET_FPS`, R68), and the lane-test fixture targets 10 fps on hosted runners (R67).
- **Failures are visible without a token:** failed tests and e2e cases now emit `::error` annotations.

**Result:** CI is green on Windows, macOS and Ubuntu, plus the Playwright tier, at `c338589`.

## Branching

- `master` was created at `c338589` and pushed. It is the GitHub default and the only branch.
- `feat/m1-core` was deleted locally and on GitHub.
- From now on, all work happens on `master`.

## Open

- The tier-1 manual agent eval, which is the release gate.
- The M2 backlog in `docs/roadmap.md`.
