# Decision log

Rulings made while building M1 (`feat/m1-core`, now merged to `master`) when the implementation plan was silent, ambiguous or in conflict with the spec or with what the code could actually do. The binding authority is the [design spec](superpowers/specs/2026-11-17-port-any-game-design.md); where a ruling below disagrees with it, the spec wins and the ruling is a bug in this log. The plan is [M1 core](superpowers/plans/2026-11-17-port-any-game-m1-core.md).

How to read an entry: **Decision** is what the code does. **Why** is the reason at the time. **If wrong** is the cost the controller accepted. **Status** is `active`, `superseded by Rn` or `amended by Rn`.

- Numbering follows the order rulings were made. R1 and R2 were never issued; the four early setup rulings are listed as S1–S4. One Task-14 ruling was never numbered and is listed as T14.
- Superseded rulings stay in the log so the history is readable. Do not follow a superseded entry.
- Ruling IDs also appear in code comments, tests and `docs/`; grep for `R<n>` to find the implementation.

## Index of non-active rulings

| ID | Status |
|---|---|
| S2 | superseded by R13 |
| S4 | superseded by R14 |
| R9 | amended by R47 |
| R31 | superseded (path) by R34 |
| R33 | amended by R64 |
| R44 | amended by R61 (CSP stance), kept by R62 |
| R50 | amended by R51, R52, R54 |
| R4 | amended by R29 |
| R69 | fulfilled: the backlog now lives in [roadmap.md](roadmap.md) |

---

## Setup rulings

### S1. Work in place on a branch, not a worktree
**Decision:** build M1 on `feat/m1-core` in the main checkout. **Why:** the repo had zero commits, so `git worktree add` was impossible and `master` had nothing to protect. **If wrong:** trivial; the branch can be moved. **Status:** active (history only; all work is now on `master`).

### S2. First git identity
**Decision:** the first repo-local identity was a placeholder name with `core.autocrlf=false`. **Why:** git had no identity and the plan needs commits. **If wrong:** rewrite authors before the first push. **Status:** **superseded by R13.** `core.autocrlf=false` stays (see R10).

### S3. No Claude/Anthropic attribution in commits
**Decision:** no `Co-Authored-By`, author or mention of Claude or Anthropic on any commit. **Why:** the maintainer's standing rule overrides any harness default. **If wrong:** history rewrite. **Status:** active, binding (repeated in the global constraints).

### S4. Never push
**Decision:** commits stay local until the maintainer says otherwise. **Why:** the maintainer wanted to push later. **If wrong:** none. **Status:** **superseded by R14.**

---

## Rulings R3–R69

### R3. `.superpowers/` excluded locally
**Decision:** the agent scratch folder is listed in `.git/info/exclude`, not committed. **Why:** keeps working notes out of `git add -A`. **If wrong:** none. **Status:** active.

### R4. Lane descriptors first, lane behaviour later
**Decision:** Task 8 created `web-extract`, `known-port`, `rt-ruffle` and `dos-jsdos` as descriptors (id, rung, available, milestone, dataModes, acks, checklist, `detect()`); the lane tasks added build, shell and adapter. **Why:** keeps the Task 8 tests runnable early. **If wrong:** small moves between files. **Status:** active; the `bundled-public` carve-out is amended by R29.

### R5. Tests never touch real agent configs
**Decision:** spikes and installer tests run only against isolated config dirs (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_CONFIG_HOME`, temp HOME) and never start authenticated sessions. Anything needing a live session is a "maintainer to verify" item in [evals/tier1.md](evals/tier1.md). **Why:** a test must not modify the contributor's own setup. **If wrong:** hook formats may need fixing after the manual eval. **Status:** active.

### R6. Windows launcher test uses `cmd.exe` explicitly
**Decision:** spawn `cmd.exe` with args `['/d','/c','Play-Windows.bat']`. **Why:** satisfies "no `shell: true`". **If wrong:** none. **Status:** active.

### R7. `PAG_HOME` overrides the home dir
**Decision:** `install.mjs` honours `PAG_HOME`; tests always set it and `PAG_CACHE`. **Why:** no test may write to the real home. **If wrong:** none. **Status:** amended. Actual behaviour: `install.mjs` reads `os.homedir()` (`%USERPROFILE%` on Windows, `$HOME` elsewhere) plus `XDG_CONFIG_HOME`; no script reads `PAG_HOME`. The installer tests isolate the home by setting `HOME`/`USERPROFILE`/`XDG_CONFIG_HOME` to a sandbox; `PAG_HOME` is set by other tests but has no effect.

### R8. Checklist lines are GitHub task-list items
**Decision:** `PORTING_LOG.md` checklist items are `- [ ] <text>`; `status` returns the first unchecked line. **Why:** the plan did not define the format. **If wrong:** parser tweak. **Status:** active.

### R9. How to run tests
**Decision:** `npm test`; focused runs pass explicit files or quoted globs. A bare directory (`node --test test/lib`) fails on Node 22, so plan commands of that form are read as globs. **Why:** Node 22 behaviour. **If wrong:** none. **Status:** amended by R47 (serial execution).

### R10. `.gitattributes` for line endings
**Decision:** `* text=auto eol=lf`, `*.bat text eol=crlf`, plus CRLF-tolerant regexes. **Why:** deterministic endings for shell hooks and `.bat` launchers. **If wrong:** none. **Status:** active.

### R11. Node floor 20, development on 22
**Decision:** `engines` stays `>=20` for users; development and CI need Node 22 because of the `npm test` glob. **Why:** keeps the runtime floor low. **If wrong:** Node 20 contributors cannot run tests. **Status:** active; the floor was later tightened for `readdirSync({recursive})` (final-review M17, fixed).

### R12. Spikes ran on Windows only
**Decision:** Task 2 spikes ran on the Windows dev machine; macOS/Linux were "unverified, covered by CI". **Why:** CI did not exist yet. **If wrong:** a CDP quirk shows up in CI. **Status:** active (CI is now green on all three).

### R13. Git identity is the maintainer's public noreply
**Decision:** repo-local identity is the maintainer's name with a public GitHub noreply address; two early commits had their author rewritten before the first push. **Why:** fixes S2. **If wrong:** none. **Status:** active; supersedes S2.

### R14. Pushing is authorized
**Decision:** the controller pushes the branch after each completed task; never force-push. `main` was created at finish. **Why:** the remote was reachable and empty. **If wrong:** none. **Status:** active; supersedes S4.

### R15. No root `plugin.json` in M1
**Decision:** Task 22 ships no root `plugin.json` (spike a). **Why:** Codex/Copilot read `.claude-plugin` as a documented fallback. **If wrong:** revisit after the manual eval. **Status:** active.

### R16. Spike notes beat the plan's hook table
**Decision:** where a spike note's deny format differs from the plan, the spike wins. Codex denies via JSON at exit 0; PowerShell-wrapped hook commands end with `; exit $LASTEXITCODE`; `guard.mjs` locates itself via `import.meta.url`. **Why:** the spikes tested real behaviour. **If wrong:** per-host format fix. **Status:** active.

### R17. OpenCode needs a top-level shim
**Decision:** install writes the plugin dir and `.opencode/plugins/port-any-game.js` (a re-export), because subdirectories are not auto-discovered in v1. `opencode plugin add github:` is documented as v2-only. **Why:** spike c. **If wrong:** none. **Status:** active.

### R18. Split `ms-store`; downgrade generic DRM triggers
**Decision:** `ms-store-gdk` (`MicrosoftGame.config`) is STOP (launcher DRM); `msix-package` (`appxmanifest.xml`) is WARN. Generic names (SafeDisc `00000001.tmp`, StarForce `protect.*`, EA `installerdata.xml`) are WARN; distinctive signals stay STOP. **Why:** a false STOP blocks legitimate games, a missed one only loses one layer (hooks and policy still cover it). **If wrong:** a protected title surveys as WARN, still flagged. **Status:** active.

### R19. Catalog signatures must be distinctive
**Decision:** generic file names (Fallout `master.dat`, PopCap `main.pak`, shared Doom-family names) were replaced, size-gated or dropped. **Why:** a wrong confident ID routes the user to the wrong port. **If wrong:** fewer signature matches; store and title tiers still work. **Status:** active.

### R20. Lane ranking
**Decision:** rank GO before HARD, then by rung (known-port first in ties). A title-only catalog hit stays HARD and is never primary while an available GO lane exists; it appears as "possible existing port, confirm". **Why:** spec §6 says the first lane that verifies wins; an unconfirmed hit must not downgrade a confident verdict. **If wrong:** a real title-only match sits one step lower (still shown). **Status:** active.

### R21. Public use needs a recorded rights statement
**Decision:** `bundled-public` is allowed only with a `ACK_RIGHTS_HOLDER` ack (with `at`) or `data.redistributable === true` set by `pag` from the catalog. Deny messages say "ask the user, record with `pag ack`". The guard denies agent writes to `port.json`. **Why:** spec §11 needs an explicit recorded user statement; an agent-settable string defeats it. **If wrong:** agents must use `pag` commands to touch `port.json`. **Status:** active; gate shape restated in R63.

### R22. Guard fails open on startup errors
**Decision:** if the guard cannot import or initialise, it exits 0 with empty stdout. **Why:** Copilot hooks fail closed, so a crash would deny every tool call. Hooks are a safety net; scripts are authoritative. **If wrong:** a broken guard silently allows. **Status:** active.

### R23. Ruffle pinned as an npm tarball
**Decision:** `@ruffle-rs/ruffle@0.7.1` (MIT OR Apache-2.0), verified by SHA. **Why:** stable, reachable, same self-hosted build family. **If wrong:** none. **Status:** active.

### R24. Lock entries carry licence and source; pack writes `LICENSES/`
**Decision:** `toolchain.lock.json` entries have `license` and `source`; `pack` writes `dist/LICENSES/<runtime>.txt` (GPL-2.0 notice and source link for js-dos; MIT/Apache for Ruffle). **Why:** GPL source offer for a shared BYO build. **If wrong:** whether a URL satisfies GPL §3 is a legal question the maintainer has not ruled on. **Status:** active.

### R25. Lane module contract for shell and pack
**Decision:** a lane may export `shell(port) → Partial<ShellJson>`, `adapter` (absolute path; default `assets/lanes/<id>/adapter.js`), `runtime: {tool, files?}` and `build(portDir)`. `pack(portDir, {mode, laneModule?, lock?})` accepts `laneModule`, which overrides `LANES[port.lane]`. **Why:** the plan names these pieces but no injection point; keeps the `lane-test` fixture out of production `LANES`. **If wrong:** later tasks adapt to a renamed field. **Status:** active.

### R26. Game manifest hashing mirrors `fsx.sha256File`
**Decision:** files over 256 MiB hash as SHA-256 of first 1 MiB + last 1 MiB with `partial: true`; the browser import hashes identically. **Why:** otherwise large-file entries never match. **If wrong:** none. **Status:** active.

### R27. Pack source is `build/game/` else `game/`
**Decision:** pack takes the lane build output when present, otherwise the read-only original. **Why:** the plan left it open. **If wrong:** a task passes an explicit source. **Status:** active. The "pack before build" gap is closed: pack refuses a `byo` lane that has a build step until `build/lane.json` exists.

### R28. Stable default port per game
**Decision:** default port = 20000 + (first 4 bytes of SHA-256(`port.id`) as uint32 % 10000), range 20000–29999. `pag serve` uses it when `--port` is absent. EADDRINUSE is a clear error suggesting `--port`, never a silent other port. Launchers bake the port into `launch.json`; if it is in use they assume the game is already served, open the browser and exit. `pag verify` keeps port 0. **Why:** the origin must stay fixed or OPFS imports are lost; re-importing a BYO game each run is a real UX failure. (The first ledger wording said `% 20000`; the final range is the one above.) **If wrong:** a fixed port collides and the user passes `--port`. **Status:** active.

### R29. `bundled-public` is lane-independent
**Decision:** gated only by `isPublicAllowed(port)`, not by the lane's `dataModes`; `byo` and `bundled` must be in `dataModes`. **Why:** spec §11 gates public on rights, not lane; a rights holder may publish a Flash or DOS game. **If wrong:** a byo-only lane fails verify with bundled data (no leak, rights-gated). **Status:** active; amends R4.

### R30. Runtime in a content-hashed folder
**Decision:** lane runtime is emitted to `runtime/<lane>-<hash8>/` (hash over adapter and runtime file bytes); `shell.json.entry.adapter` points there; the shell fetches `shell.json` with `cache: 'no-store'`. **Why:** spec note 05 §9a says `/runtime/*` is immutable only with content-hashed names. **If wrong:** the path differs from the task brief; consumers read `entry.adapter` anyway. **Status:** active.

### R31. BYO verify never writes into the game folder
**Decision:** `startServer` gains `fixtureIndex`; verify builds it from `dist/game/manifest.json` and mounts `<port>/<manifest.source>` as the fixture dir, then drives `?verify_import=`. **Why:** the shell's import needs an index and the game folder is read-only. **If wrong:** one extra serve option. **Status:** active except the served path, which is **superseded by R34**.

### R32. Verify `query` option
**Decision:** `verify(distDir, {…, query})` appends `query` to the page URL (lane-test `mode=` and stage hooks). e2e cases pass `soakSec` ≤ 5. **Why:** per-run page query needed; a 60 s soak per case is too slow for CI. **If wrong:** none. **Status:** active.

### R33. Verify design choices accepted
**Decision:** viewport check before save/reload; save check is a localStorage token plus `selfTest`; `persisted() === false` is not a warning; memory is judged on JS heap growth (1 MiB floor, no wasm peak); the driver gains `onResponse` (for the 404 check). **Why:** all within spec §9 latitude. **If wrong:** small check tweaks. **Status:** amended by R64 (save check for lanes that expose `saveNow`).

### T14. Do not taskkill a reused PID
**Decision:** on Windows, `taskkill /T` runs only while the browser process is still alive. Memory that cannot be measured reports `skip` (neither warn nor fail). **Why:** killing a reused PID's tree is worse than an orphaned crashpad child. **If wrong:** a rare orphan child process on Windows. **Status:** active.

### R34. Verify fixture index lives outside the mount
**Decision:** for `?verify_import=<base>/` the shell fetches `<base without trailing slash>.index.json` (`/__fixture/` → `/__fixture.index.json`) and `startServer` serves `fixtureIndex` there. **Why:** the R31 path could shadow a real game file. **If wrong:** one shell/serve path change. **Status:** active; supersedes the path in R31.

### R35. Lane builds write only under `build/`
**Decision:** `build(portDir)` writes under `<port>/build/` (wiping `build/game/` first), never `<port>/game/`; it may append a dated section to `PORTING_LOG.md` but never rewrites checklist lines. Results carry `verdict: 'GO'|'HARD'` where the lane can downgrade. **Why:** `game/` is read-only (policy `GAME_DIR_WRITE`) and the checklist is user-owned. **If wrong:** none. **Status:** active.

### R36. web-extract verifies at 30 fps
**Decision:** web-extract `shell()` sets `verify.target_fps: 30` and `serve.caseFallback: true`. **Why:** Linux CI SwiftShader cannot hold 60; real 60 fps games still pass. **If wrong:** a 20–27 fps game passes instead of warning. **Status:** active.

### R37. Memory judged only on soaks of 30 s or more
**Decision:** shorter soaks report `memory: skip` ("soak too short to judge memory"). Default CLI soak stays 60 s; lane e2e uses ≤ 5 s. **Why:** extrapolating a 2–10 s heap delta to %/min measures warm-up, not leaks. **If wrong:** short soaks never catch leaks (the default still does). **Status:** active.

### R38. web-extract `detect` is GO on an engine hit
**Decision:** `detect` returns GO on an engine marker; `build` validates the entry and fails clearly. **Why:** `survey.json` carries no full file list. **If wrong:** a wrapper without HTML ranks GO until `build` fails. **Status:** active.

### R39. Frame hook injected at build time
**Decision:** `build` copies `__pag_hook.js` into `build/game/` and injects `<script src="__pag_hook.js">` as the first `<head>` child of the entry page. It wraps `requestAnimationFrame` and counts one frame per distinct timestamp; the adapter reads it. No polling. **Why:** the only deterministic pre-script hook that is CSP-safe. **If wrong:** the build copy of the entry page differs from the original (original untouched). **Status:** active.

### R40. Runtime lanes ship through pack's hashed copy
**Decision:** lane runtimes use the R25 `runtime` mechanism; `build` does not copy runtime files. It checks the tool is installed (`toolDir` + `.ok`) or fails with "run: pag setup <alias> --yes", and never downloads. Lane settings go in `build/lane.json`; pack calls `lane.shell(port, {portDir})` so `shell()` can put it into `shell.json.lane_config`. **Why:** the brief's build-time copy conflicts with R30. **If wrong:** one pack signature extension. **Status:** active.

### R41. Shared e2e tool cache
**Decision:** lane e2e uses `<os.tmpdir()>/pag-e2e-tools` (via `ensureTool`), downloads once per machine, verifies SHA, and skips with a clear message when offline. Never the real user cache; unit tests never download. **Why:** real Ruffle/js-dos are needed for a real e2e. **If wrong:** first e2e run downloads about 31 MB. **Status:** active.

### R42. dos-jsdos uses the raw emulators API
**Decision:** the adapter uses `emulators.js` (backend `dosbox`), renders each `ci` frame to its own visible 2D canvas with `putImageData`, counts one frame per `onFrame`, maps `KeyboardEvent.code` to `ci.sendKeyEvent` and plays `onSoundPush` samples best effort. Runtime is the minimal dosbox set (about 1.7 MB) plus the licence; `needs_coi: false`. **Why:** spike e found the js-dos UI canvas never paints under CDP while `ci` frames are reliable. **If wrong:** no js-dos UI chrome; acceptable. **Status:** active.

### R43. Accept the DOS fixture change
**Decision:** fixture colour is offset plus frame stripes; the first bytes `B8 13 00 CD 10` are kept. **Why:** flat-fill frames count as "blank" under the spec's luma-std < 2 rule; spec thresholds win. **If wrong:** none. **Status:** active.

### R44. js-dos internals seeding accepted
**Decision:** accept `dosboxWorker`, a self-compiled `wdosbox.wasm` and a seeded js-dos module cache (js-dos glue uses `eval`, blocked by CSP). Version pinned to 8.5.4; `start()` fails loudly if internals change. **Why:** no CSP relaxation was allowed for this lane. **If wrong:** breaks on a js-dos bump, caught by lane e2e. **Status:** amended by R61 (the "no CSP relaxation" stance was dropped for web-extract) and kept by R62.

### R45. Modifier keys forwarded in dos-jsdos
**Decision:** Ctrl/Alt/Meta combos and keys typed into shell controls are not `preventDefault`-ed (browser shortcuts work), but modifier keys are still forwarded to DOSBox. **Why:** DOS games use Ctrl/Alt for fire and strafe. **If wrong:** one line. **Status:** active.

### R46. Verify samples frames only after the first game frame
**Decision:** sampling starts after `stats.gameFrames > 0`, bounded by 10 s and counted inside the ready budget. Adapters report a frame only after something was painted (rt-ruffle after Ruffle's first rendered frame; web-extract has an about:blank early-resolve guard). **Why:** CI flaked two runs in three otherwise. **If wrong:** a game that never reports frames fails `ready` instead of `blank`; same outcome. **Status:** active.

### R47. Tests run serially
**Decision:** `npm test` is `node --test --test-concurrency=1 "test/**/*.test.mjs"`. **Why:** browser fps/frozen checks need an unloaded machine; parallel files made lane e2e flaky. **If wrong:** the local suite is about 2x slower. **Status:** active; amends R9.

### R48. Windows launcher may use a sibling `.ps1`
**Decision:** `Play-Windows.bat` may run `serve-windows.ps1` (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-windows.ps1"`); the port `.gitignore` template adds `package/` because packages contain game bytes. **Why:** an inline script is brittle in `.bat`. **If wrong:** none. **Status:** active.

### R49. Keep the python3 launcher fallback
**Decision:** the plan-mandated python fallback is used only when `needs_coi` is false and `serve.caseFallback` is false. It binds 127.0.0.1, so missing `X-Robots-Tag` and listing are moot. Launchers and `serve-standalone` honour `launch.json.case_fallback`. **Why:** plan requirement, loopback only. **If wrong:** the python path lacks Range, so large media seeks are slower. **Status:** active.

### R50. `pag ack` contract
**Decision:** `pag ack <ID> [--note "<the user's own words>"]` appends `{id, at, note?}` to `port.json` `acks`; duplicates are no-ops; unknown IDs exit 2; `ACK_RIGHTS_HOLDER` needs a non-empty `--note` holding the user's own statement. Writes go through node only. **Why:** spec §11 forbids asserting facts the user did not state; an agent-worded rights claim is the anti-pattern this prevents. **If wrong:** one extra flag. **Status:** amended by R51 (two more IDs), R52 (`ACK_WARN_*` IDs) and R54 (`--note-env`).

### R51. Two more valid ack IDs
**Decision:** `pag ack` also accepts `ACK_UPX_PACKED` and `ACK_PROTECTION_WARN`. **Why:** survey emits them as required acks; the skill step would otherwise fail. **If wrong:** two extra IDs. **Status:** active; amends R50.

### R52. Warn items get `ACK_WARN_*` acks
**Decision:** each spec §11 Warn item (store copy, networking, middleware, light encryption, and so on) has an `ACK_WARN_*` ID logged in `port.json`; `PORTING_LOG` notes are narrative only. **Why:** spec §11 requires a logged acknowledgement; R50's closed list was too narrow. **If wrong:** a few more IDs. **Status:** active; amends R50.

### R53. Build loop is build, pack, verify
**Decision:** verify starts its own server; `pag serve` is for the user hand-over, not the inner loop. **Why:** a foreground server blocks an agent's tool call. **If wrong:** none. **Status:** active.

### R54. `--note-env VAR` is the recommended verbatim path
**Decision:** `pag ack --note-env VAR` reads the note from an environment variable. **Why:** PowerShell 5.1 native-arg quoting loses `"`. **If wrong:** one extra flag. **Status:** active; later restricted to `PAG_*` names (R59) because `port.json` is tracked in git.

### R55. Task 22 hook and install rules
**Decision:** no root `plugin.json` (R15); README install commands use the real repo; hook configs follow spikes a–c exactly; the installer and its tests never touch real agent configs (R5) and honour `--dry-run`. **Why:** unverified hook formats must follow the spike evidence. **If wrong:** per-host fix after the eval. **Status:** active.

### R56. Unverified hook routes must never block the user
**Decision:** Copilot is routed through the skills install only in M1 (no `copilot plugin install` line); the Copilot plugin route is a "verify before advertising" eval item. Remaining Copilot-format hook commands fail open (`|| true` / `; exit 0`); the guard denies via JSON at exit 0, so no deny is lost. Codex gets `.codex-plugin/plugin.json` pointing at `hooks/codex.json`, marked unverified. **Why:** without a root `plugin.json` Copilot may run Claude's exec-form `hooks/hooks.json` without `args`, exit 1, and fail closed on every tool. **If wrong:** Copilot users lack hooks until verified; the skill still works. **Status:** active.

### R57. OpenCode plugin path resolution
**Decision:** the plugin loads `policy.mjs` by trying the relative `../../skills/port-any-game/…` path, then known skill dirs (`<XDG_CONFIG_HOME|~/.config>/opencode/skills/...`, `~/.agents/skills/...`, `~/.claude/skills/...`), and fails open if none load. The README marks the `opencode plugin add github:` guard route unverified. **Why:** the plugin dir may be installed apart from the skill. **If wrong:** a few extra fs probes at load. **Status:** active.

### R58. CI layout
**Decision:** lane test files skip e2e when `PAG_E2E=0`; CI runs `npm test` with `PAG_E2E=0`, then `npm run e2e` with the tool cache restored by `actions/cache` keyed on `toolchain.lock.json` and `PAG_E2E_KEEP=<dir>` so verify reports survive for the failure artifact upload. Actions are pinned to major versions (`@v4`), `permissions: contents: read`, no secrets. `docs/evals/tier1.md` collects every unverified item. **Why:** avoid running lane e2e twice. **If wrong:** a slower CI. **Status:** active (Node 20 deprecation of the `@v4` actions is in the roadmap).

### R59. Final fix-wave scope
**Decision:** fix C1, I1–I6, I8, minors M1–M13, M17–M19, M21, plus a download stall timeout, a `microsoft-edge-stable` Linux candidate, `--note-env` accepting only `PAG_*` names, and a UTF-8-safe entry-page splice. Defer M14 (NOTICE copyright lines need verified upstream text), M15 (Playwright integrity pin), M16 (hardlink/free-space), M20 (install realpath write check) and every other LATER triage line. **Why:** bounded final wave. **If wrong:** those gaps surface in a later milestone. **Status:** active; the deferred items are in [roadmap.md](roadmap.md).

### R60. Merge and release gates are for the maintainer
**Decision:** a green 3-OS CI run before merge to main; the tier-1 eval before release. Not code. **Why:** cannot be proven by the build agents. **If wrong:** merge waits on CI. **Status:** active. CI gate met; tier-1 eval still open.

### R61. web-extract declares a CSP relaxation
**Decision:** web-extract adds `'unsafe-eval' 'unsafe-inline'` to `script-src` through an optional lane `shell()` `csp` field merged by `pack.headersFor` and recorded in `shell.json`. Verify's static check reports it as an info line, not a warning. `web-extract.md` now says pag relaxes it for this lane and nobody edits `_headers` by hand. The fixture gained an eval and an inline script. **Why:** RPG Maker MV/MZ and Twine need both; without it the lane silently breaks (final review C1) and note 05 §9a already provides lane-declared relaxation. **If wrong:** a weaker CSP if a rights holder deploys a web-extract game publicly (the game's own code needs it anyway). **Status:** active; amends R44's stance.

### R62. Keep the js-dos seeding workaround
**Decision:** the R44 internals seeding stays, though the reviewer preferred a declared CSP relaxation. **Why:** it works and is e2e-tested. **If wrong:** breakage on a js-dos upgrade, caught by lane e2e. **Status:** active; revisit on any js-dos upgrade.

### R63. Public use is gated on rights only
**Decision:** `ACK_RIGHTS_HOLDER` ack or catalog-propagated `data.redistributable`, shared by `policy.isPublicAllowed`, pack, guard and `check-staged.mjs`. `pag pack --mode bundled-public` persists `data.mode` once the gate passes. **Why:** the gate was inconsistent across four places (review I3). **If wrong:** a user who falsely acks rights can deploy; that is their legal call, as the ack text says. **Status:** active; the `freeToShare` edge is in the roadmap.

### R64. dos-jsdos saves via `ci.persist()`
**Decision:** saves persist to OPFS and restore as a second bundle; verify's save check calls the lane's `saveNow` when present, else reports "lane save path not exercised". If js-dos 8.5.4 cannot do this reliably, the fallback is to document the limit in `dos.md` and `SKILL.md` and report "not exercised". **Why:** the old check passed while real DOS saves were lost (review I4). **If wrong:** DOS saves lost until M2. **Status:** active; amends R33.

### R65. Post-review CI repair needs no review seat
**Decision:** the one-line mechanical fix for the rejected workflow (job-level env used `runner.os`, not allowed there) went to a cheap implementer and was verified by the CI run itself. **Why:** the run is the objective check. **If wrong:** another red CI iteration. **Status:** active (process).

### R66. CI repair outside the review loop, root cause in product code
**Decision:** one debugging pass adds a `node:test` reporter that emits `::error` annotations (readable through the public API without a token) and tests whether aliased temp dirs (Windows 8.3 short paths, macOS `/var` → `/private/var`) break path comparisons; any root cause is fixed in product code because real users hit such paths. **Why:** job logs need auth. **If wrong:** more CI iterations. **Status:** active. Outcome: the alias hypothesis was not reproduced; the real bug was that scripts' main guard compared an unresolved `argv[1]`, a silent no-op through a symlink or junction (fixed by realpath-ing `argv[1]`).

### R67. CI-only fps target for the lane-test fixture
**Decision:** the `lane-test` fixture uses `target_fps` 10 when `GITHUB_ACTIONS=true`. Product thresholds are unchanged. **Why:** GPU-less hosted runners cannot hold the fixture's target. **If wrong:** an fps regression below 10 on hosted runners goes unseen. **Status:** active.

### R68. macOS lane e2e uses a lower fps target
**Decision:** a test-only env (`PAG_E2E_TARGET_FPS`, set on the macOS lane e2e step only) lowers the target to 10. Ubuntu and Windows CI targets and all product thresholds are unchanged. **Why:** rt-ruffle measured 13.8 and 15.3 fps against 30 on the GPU-less arm64 macOS VM. **If wrong:** an fps regression between 10 and 30 that shows only on macOS goes unseen in CI; the tier-1 eval covers real-Mac fps. **Status:** active.

### R69. Keep the working notes until the finish decision
**Decision:** the git-ignored build workspace was kept until the maintainer chose how to finish, because it held the only copy of the M2 backlog (35 deferred minors, 8 parked items, the final-review triage). **Why:** avoid losing the backlog. **If wrong:** a git-ignored folder lingers. **Status:** fulfilled. The backlog is now in [roadmap.md](roadmap.md) and the workspace can be deleted.
