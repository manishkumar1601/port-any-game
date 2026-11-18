# 18-11-2026-m2a-runtime-lanes

**Goal:** start M2. Split it into four parts, then design, plan and build part 1 (M2a): three lanes whose web runtime is published upstream, namely `rt-easyrpg`, `rebuild-love` and `rebuild-renpy`.

**State at stop: M2a is in progress, not finished.** Tasks 1–5 are done and reviewed. Task 6 is built, and its first fix round was being finished when work stopped. Task 7 and the final whole-branch review are still to do. The work stopped by the owner's choice, to continue on another PC.

## What happened

1. **M2 split and order** (the owner delegated the call: "go as per your decisions"):
   - M2a: upstream-runtime lanes (this session);
   - M2b: `remote-play`;
   - M2c: runtimes we build in our own CI (`rt-scummvm`, `rt-idtech`); publishing GPL binaries needs the owner's OK;
   - M2d: catalog expansion (PortMaster, libretro subset).
2. **Spikes**, each run in a real headless Edge on Windows:
   - [f-easyrpg-web](../../docs/spikes/f-easyrpg-web.md): the EasyRPG 0.8.1.1 web player loads BYO files through an `XMLHttpRequest` shim; it needs `'unsafe-eval'`.
   - [g-lovejs](../../docs/spikes/g-lovejs.md): love.js 11.4.1 compat, BYO, with `.love` bytes written into the Emscripten FS.
   - [h-renpy-web](../../docs/spikes/h-renpy-web.md): the Ren'Py 8.6.1 SDK `web_build` runs headless; the output is bundled and runs in the web-extract iframe.
3. **Design:** [2026-11-18-m2a-runtime-lanes-design.md](../../docs/superpowers/specs/2026-11-18-m2a-runtime-lanes-design.md). A builder check was done, and §9 records four calls for the owner to check.
4. **Plan:** [2026-11-18-port-any-game-m2a-runtime-lanes.md](../../docs/superpowers/plans/2026-11-18-port-any-game-m2a-runtime-lanes.md), 7 tasks, executed subagent-driven with a review per task.

## Task status

| Task | What | Commits | Status |
|---|---|---|---|
| 1 | setup lock `extras`, zip `strip`, pins for EasyRPG, love.js and Ren'Py | `6833a14` | done, review clean |
| 2 | pack refuses a BYO lane before its build; e2e fps override only lowers | `f309f29`, `f461555` | done, review clean |
| 3 | WebGL draw-task frame fallback in the frame hook; shared `finishWebBuild` | `dfd03e7` | done, review clean |
| 4 | `rt-easyrpg` lane | `9dadc2a`, `2d4c100` | done, review clean after 1 fix round; CI green |
| 5 | `rebuild-love` lane | `65de002`, `32fe6f2` | done, review clean after 1 fix round; CI green |
| 6 | `rebuild-renpy` lane | `b2c23ad`, `bea3009` | built. CI green at `b2c23ad` on all three OSes, so the Ren'Py SDK builds headless on Windows, macOS and Ubuntu. Review asked for 2 Important fixes (below); fix round 1 is done in `bea3009` (unit suite 438 tests, 0 fail; real-SDK e2e passes). **Its scoped re-review is not done yet**, and CI at `bea3009` was not checked |
| 7 | CI check, decisions, roadmap, docs and memory | none | **not started** |
| Final | whole-branch review of `70c9f9e..HEAD`, one fix wave | none | **not started** |

### Task 6 review findings (fix round 1)

- **I1:** the 8.6.1 SDK has no `py3-linux-aarch64`, so a Linux ARM build failed with an unclear `exit ENOENT`. The fix: check the SDK Python exists before spawning, and give a clear "no SDK Python for <platform>-<arch>" error, plus a runbook row.
- **I2:** the CI tool cache key hashed only the lock file, so after Task 1 it never re-saved, and every run re-downloaded the new runtimes (about 180 MB of Ren'Py per OS). The fix (a ruling): key restore and save on `hashFiles(toolchain.lock.json, ci.yml)`.
- **Minors in the same round:**
  - a symlink-skip test;
  - the `config.save_directory` check ignores commented lines;
  - the runbook mentions the deleted `pwa_catalog.json` and `icons/`;
  - `docs/development.md` lists `renpy`.

## Key decisions (to be written into docs/decisions.md as R70+ in Task 7)

**Shared**
- **Lock `extras`:** extra downloads, each sha256-checked before any extraction, then extracted into the tool dir. Ren'Py's web zip uses this.
- **Licence text instead of a COPYING download:** EasyRPG's COPYING was a pinned download from `raw.githubusercontent.com`, which timed out from the dev network, so it would block real users on such networks. The GPL-3.0 text is now vendored as `assets/licenses/GPL-3.0.txt` (the licence allows verbatim copies), and `pack` appends it for GPL-3.0 like GPL-2.0.
- **Pack refusal:** `pack` refuses a BYO lane that has a build step until `build/lane.json` exists. This closes M1 backlog item L.
- **e2e fps override:** `PAG_E2E_TARGET_FPS` only lowers a lane's `target_fps`, never raises it (Ren'Py's is 5).
- **Frame hook:** it counts one frame per task with WebGL draw calls, but only while no `requestAnimationFrame` frame has been seen. This is for Ren'Py's timer loop.
- **Spec §9 calls:**
  - per-library notices for runtime wasm become a [1.0] backlog item (with M14);
  - the Ren'Py build runs the game's init code (no ack; documented in safety-and-policy and the runbook);
  - Ren'Py builds on all three OSes, so no OS fallback was needed;
  - RTP stays HARD until the user's copy is a full package.

**rt-easyrpg**
- The XHR shim generates the gencache v2 `index.json` and serves files from `ctx.files.read`.
- No `--engine` mapping in M2a; it is a backlog item.
- The adapter ignores EasyRPG's own black and logo start-up frames, capped at 10 s by time.
- The fixture adds our own System skin, so the cursor flashes and verify's frozen check is stable.
- `setStatus` is silenced from `onRuntimeInitialized`, and the shell re-sets its own `#status`.
- The canvas is absolutely positioned.
- `saveNow()` calls `FS.syncfs(false)` and rejects without `FS`.

**rebuild-love**
- The data mode is BYO, not the parent spec's bundled.
- Saves call love.js's own IDBFS `beforeunload` listener, captured while `Love()` runs. A synthetic `beforeunload` makes SDL quit the game (observed), so spec §6.2 step 6 is superseded.
- The canvas needs `id="canvas"`, which corrects spike g.
- `window.eval` and `alert` are replaced with reporters, still with no CSP relaxation.
- The canvas box equals the picture, for correct mouse coordinates.
- `lane.json` is `{file, offset, version}`; `identity` was dropped.
- The version comes only from `<p>.version`, where `<p>` is the parameter of `love.conf(<p>)`.
- The fused fixture's stand-in exe is a minimal PE.

**rebuild-renpy**
- `detect` reads the lock's SDK version once at module load.
- The build runs for every verdict.
- `cleanWebBuild` drops the service-worker registration, `*.symbols`, `pwa_catalog.json` and `icons/`.
- `build/renpy-project/` is deleted after success and kept after a failure.
- Symlinks in `game/` are skipped when copying.
- `lane.json` is not exposed through `shell()`.
- `budget_ready_s` is 30.
- `validate.mjs` maps `rebuild-renpy` to the `renpy` runbook.

## Minor review findings parked for the final review

- **T1:**
  - the sha mismatch message does not name the extra;
  - the strip sentinel is clunky, and the stripped dir-entry skip is untested;
  - MiB versus 1e6 units in the setup message;
  - duplicated server-swap code in tests;
  - hand-rolled stdout capture.
- **T3:**
  - a long comment above `finishWebBuild`;
  - no unit test for the hook fallback;
  - a game driven by a `MessageChannel` loop could inflate the fallback fps.
- **T4:**
  - the `_dirname` guard compares raw names;
  - repeated RTP sections in `PORTING_LOG.md`;
  - the `root` filter is case-sensitive;
  - the survey test relies on the `rt-scummvm` stub (use an M4 stub);
  - no `onAbort` wiring;
  - the shell's `exportSaves` before start now errors.
- **T5:**
  - the ffi NO reason does not name the file;
  - the `addEventListener` wrapper deletes the property instead of restoring it;
  - the container-order test is weak;
  - `saveNow` cannot see IDB write errors (documented).
- **Docs:** the lock rows in `docs/architecture.md` and `docs/development.md` (list only Ruffle, js-dos, Playwright) still need the new runtimes.

## Outcome

- **Commits on `master`:** `0e8b83f` (spikes and design), `70c9f9e` (plan), then the task commits above.
- **CI:** green on Windows, macOS, Ubuntu and the Playwright tier, through `b2c23ad`.
- **Unit suite:** about 436 tests, 0 fail at `b2c23ad`.

## Open / next (pick up here on the other PC)

1. `git pull`, then:
   - check CI for the latest commit;
   - run a scoped re-review of `b2c23ad..bea3009` against I1, I2 and the four minors above. Task 6 is complete when it is clean.
2. **Task 7** of the plan:
   - watch CI;
   - add R70+ to `docs/decisions.md` from the list above;
   - roadmap: mark M2a done and add the backlog lines in plan Task 7 Step 3;
   - fix the two stale lock rows;
   - update `docs/README.md` (spike rows f, g and h; M2a design and plan links);
   - add a session log.
3. **Final whole-branch review** of `70c9f9e..HEAD` on the most capable model, with the parked minors above as its triage list, then one fix wave.
4. **Then M2b (`remote-play`):** brainstorm, spec, plan.
- The SDD workspace (`.superpowers/sdd/…`, the per-task briefs, reports and reviews) is git-ignored and does not travel. This log carries everything needed to resume.
- Housekeeping on the old PC only: `docs/spikes/scratch/` (git-ignored) holds about 1.2 GB of spike downloads and builds, safe to delete.
