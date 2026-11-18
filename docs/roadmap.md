# Roadmap

Source of truth for scope is the [design spec §16](superpowers/specs/2026-11-17-port-any-game-design.md). This page summarises it, records where M1 ended, and holds the backlog carried into M2. Decisions behind M1 are in [decisions.md](decisions.md).

## Milestones

| Milestone | Scope | Exit criteria (spec) |
|---|---|---|
| **M1 Core, Tier 1 packaging, first lanes** | `pag` CLI (doctor, setup core, survey, new, pack, serve, verify with both tiers, package, status, guard); web shell; policy; project template and git hooks; catalog v0; packaging for Claude, Codex, OpenCode, Copilot and skills-only; `validate.mjs`; lanes `web-extract`, `known-port` (OpenTTD), `rt-ruffle`, `dos-jsdos` | 4 fixtures pass verify on 3 OSes in CI; guard tests green for every Tier 1 agent; a fresh-machine run in Claude Code, Codex and OpenCode on each OS reaches "playable" in at most 5 user touchpoints |
| **M2 Runtimes and Remote Play** | `rt-easyrpg`, `rt-scummvm` (prebuilt runtime CI), `rt-idtech`, catalog expansion (PortMaster, libretro subset), `rebuild-renpy`, `rebuild-love`, `remote-play` | Fixtures pass; Tier 1 agent evals pass |
| **M3 Windows runtimes** | `win-bottleship` (if the M0 spike says yes), `win-boxedwine`, `win-dosboxx` (user's OS licence), `win-v86` | Own Win32 fixtures playable; per-lane perf probe recorded |
| **M4 Rebuild, source, rewrite** | `src-port`, `src-engine-export`, `rebuild-godot`, `rt-mkxpz`, `rt-ags`, `rt-dirplayer`, `rt-butterscotch`, `rt-cheerpj`, `rewrite-html5` (Ghidra headless driver and playbook), `decomp-rebuild` (opt-in) | Fixtures pass where legal fixtures exist; rewrite fixture passes verify including stage hooks |
| **M5 Recompilation** | Fork retro-port `template/` (MIT, pinned, attributed) into `recomp-x86`; cross-OS native build (SDL2 + wgpu-native); Ghidra/JDK setup per OS; later D3D9/DDraw backends and a WebGL2 fallback | Own D3D8 fixture runs in a browser from all 3 host OSes |
| **M6 Reach and hosting** | Tier 2 wrappers via `build.mjs` and `install.mjs`; `pag host worker` (private); `pag host pages` (BYO or rights-holder only); docs site | Tier 2 smoke tests; hosted fixture passes `verify --remote` |

Milestone order is "cheap lanes and Tier 1 agents first, rewrite in M4, recompilation in M5".

## M1 status: complete

- All 23 plan tasks done, then a whole-branch review and a re-review; every Critical and Important finding was fixed.
- CI is green on `windows-latest`, `macos-latest` and `ubuntu-latest`, plus the Playwright-driver tier. The merge gate (R60) is met and `master` carries the result.
- **Release gate still open:** the tier-1 manual agent eval, [evals/tier1.md](evals/tier1.md). It covers the fresh-machine procedure in Claude Code, Codex and OpenCode, every unverified host-hook behaviour (R5, R56, R57), real-Mac fps (R68), and the CI flake-watch notes. Nothing in M1 should be tagged for release before it is run.

## M2 backlog

Items carried out of M1. Legend: **[M3-GATE]** must land before the M3 Windows lanes. **[1.0]** recommended before 1.0 or the first release tag. Source tags: `FR` final review triage, `RR` re-review parked item, `OS` out-of-scope minor (R59), `L` ledger deferred minor.

### Policy and guard

- RR: the guard denies `git config core.hooksPath .githooks`, which `pag new` prescribes when git is missing. Allow the value `.githooks`, or point the warning at `pag new … --resume`.
- RR: git-bundle parsing denies `git commit -uno` (read as `-n`) and misses `--no-veri` (git accepts unambiguous long-option abbreviations).
- RR: the I2 delete check sees only command-line targets; piped (`Get-ChildItem <port> | Remove-Item -Recurse`), `$var` and comma-list targets pass. Add the pipeline form to the tier-1 eval; `AGENTS.md` is the backstop.
- RR: I2 glob widening is conservative (`rm -r *.log` in a port root, `/tmp/foo-*` near ports are denied). Narrow it or document it.
- RR: `freeToShare` reads only catalog matches, so a free signature file plus unmatched commercial files marks the port redistributable. Require every data file matched, and reframe the test that pins this.
- OS (M20): `GAME_DIR_WRITE` and the DRM-emulator check cover only `<port>/game/…`. Have `pag new` record realpaths of linked installs and let `writeCheck` consult them.
- FR: static-fallback guard gaps (absolute-path `git add` from outside the port, `bash -ec`, `node -e`, `~user`). Git hooks still catch commits.
- FR: broad allow-glob also matches `node X pag.mjs … survey`; parent-directory links are not detected by the installer.
- FR **[M3-GATE]**: GFWL removal-patch matching, no Denuvo or SecuROM heuristics, tail `includes()` matching. Affected titles are Windows PE games with no M1 lane, so a missed STOP cannot unlock a build today; it can once Windows lanes exist.
- `assertTarget(..., 'public')` is enforced only in `pack`; `serve` calls it with `'lan'`. Decide whether other public paths need it.
- Tier-1 eval: every fixture under `test/fixtures/hook-payloads/` is `documented:`, none is `observed:`. Capture payloads from a live session on each host.

### Verify

- FR: verify reports a normal exit as an error; stuck-browser teardown can take about 100 s.
- FR: stall check starts at the first post-Play sample, so a late first frame (over 2 s) can fail the loop; `shot()` swallows screenshot errors; `bringToFront` is only needed on Windows; double exit handler on signal (harmless).
- FR: web-extract node-API scan gives false HARD on stock RPG Maker MV/MZ and misses some uses; iframe audio is not paused during the audio check.
- FR: no negative test that GPL runtime text is required in packs.
- FR: per-case network-download skips in e2e stay silent under `PAG_E2E_REQUIRE_BROWSER` (deliberate flake handling; CI's `setup` step fails first).
- FR: verify e2e takes about 116 s locally.
- Optional: exercise the Playwright fallback driver on more than the CI Playwright tier.
- `pag verify` exits 1 for bad arguments while every other command exits 2 for usage errors (verify's 2 means warn). Align or keep and document.

### Lanes

- L: `pag pack` on dos-jsdos or rt-ruffle before `build` succeeds writes a dist that fails at Play (no `lane_config`). Make pack refuse, or print "run pag build first" (a pack-time check like the one web-extract got).
- FR: web-extract `<head>` regex can match inside a comment; rAF replacement; SWF pick heuristic; per-sample DOM walk; rAF not cancelled; getter re-reads the lock.
- FR: dos-jsdos `short83` ignores invalid characters; `dosbox.conf` name collision; Node 20.0–20.11 gaps (engines now `>=20.12`).
- FR: known-port: Doom family shares one URL; `SOURCES.md` non-OSI caveat; no jkdf2 store/title test; catalog signatures were written from memory, so run a maintainer eval against real installs.
- FR: lane descriptor details: lane mentions, STOP ack, stub triggers, abs path in an error, label.
- FR: survey: tar parsing gaps (only SHA-pinned npm tarballs are read, `safeJoin` still applies); asar unpacked/link entries skipped, exec bit, `maxFiles` and error count, `readRange` cap, salt race; PE parser gaps. Add zip-slip variant tests the next time `archive.mjs` is touched.
- OS (M16): a bundled game is held about five times over (install, `build/game`, `dist/game`, portable folder, zip) with no free-space check. Hardlink `dist/game` from `build/game` and pre-check free space against the manifest total.
- Stub-lane ack IDs (`ACK_CHEERPJ_TERMS`, `ACK_OS_LICENSE`, `ACK_OWN_DEVICES_ONLY`) are not in `ACK_IDS` in `ack.mjs`; add them when those lanes ship.
- `survey.json` `tool.rulesets` and `tool.encryption` are always empty (`survey.mjs`); fill or drop them.
- The port `.gitignore` template (`assets/project/gitignore`) lacks `extracted/` and `recomp/`, which `policy.mjs` protects. Add them when the M4/M5 lanes ship.

### Shell and serve

- RR: the Host-header check has no port-less form, so `pag serve --port 80` answers 421 to browsers.
- RR **[docs or code]**: DOS saves persisted on `pagehide` are an async worker round trip and may not finish before a reload. Either change the text to "wait 30 seconds, or switch tab and back, before reloading or closing" (`dos.md`, `shell.md`, `SKILL.md`) or shorten the persist interval.
- FR: `/` has no `Cache-Control` (the server sends no validators, so it is not heuristically cached); BOM literals; orphaned `.done` files; `move()` fallback; build imports from pack.
- FR: server read-error path untested; error response keeps the earlier `Content-Type`.
- FR: launchers: `.ps1` has no realpath check; symlinked dir gives EISDIR; zip guard runs after copy; renames not atomic as a set; zip buffered in memory; `.sh`/`.command` and python fallback never executed in CI.
- shell.js declares a `downloading` state that is never set.
- `shell.json` fields `memory`, `input`, `video` and `data.mount` are written but never read.
- No M1 lane sets `needs_coi`, so the COOP/COEP path is untested end to end.
- `__shell.storage.exportSaves` / `importSaves` exist but have no UI.

### Setup and toolchain

- FR **[1.0]**: `setup` download needs a stall timeout and `microsoft-edge-stable` among Linux browser candidates. Both landed in the final fix wave (R59); keep them in the 1.0 checklist so they are not regressed.
- FR: `setup` download: 206/416 handling, no lock between concurrent runs, inherited keys, bare `npm`, `PAG_BROWSER` handling, `pin.mjs`.
- OS (M15): Playwright is pinned by version only; spec §12 wants SHA-256 for every download. Pin the npm `dist.integrity` or use a lockfile.
- FR: `pag new` writes `port.json` first; `--resume` does not validate the lane; silent `hooksPath` failure; no real-commit test; PACK/BIK text; forward references.
- FR: `pag ack` hard-codes the `ACK_WARN` mapping.
- FR: `pag status` prints `lane ` for an empty lane; mixed unknown/zero-port log line; raw catalog text on stdout; duplicate log sections and a log without a header.
- FR: unreadable nearer `port.json` aborts the upward walk (matches R22's fail-open stance; revisit if confusing).
- `pag setup playwright` installs only Chromium, so `verify --browser firefox|webkit` is always unsupported (`setup.mjs`).
- `pag status` usage lists `--host`, but the code ignores it (only `--json`). Implement or drop it.

### Docs

- OS (M14): `scripts/rules/NOTICE.md` quotes the MIT text but omits each upstream copyright line. Add verified lines.
- FR: spike doc is wrong about `noCloud` (the adapter does not use the js-dos UI).
- FR **[1.0]**: `validate.mjs` does not check `marketplace.json` or that its skill paths exist; cheap, do before the first tag. Also: line count is off by one, no `openai.yaml` quoting test, `readJson` throws on a malformed manifest, block-scalar frontmatter is not handled.
- FR: stale fixture `_notes` duplicate in the survey fixtures; stale review artifacts (process only).
- FR: `pag --help` and exit-code wording were fixed (M18, M19); re-check `SKILL.md` if exit codes change again.
- `pag setup core` exists (`setup.mjs`) but `SKILL.md` does not mention it. Document it or drop it.

### CI

- GitHub Actions is deprecating Node 20 for JavaScript actions. The `@v4` actions (`checkout`, `setup-node`, `cache`, `upload-artifact`) need bumping to Node 24 releases; keep pinning by major (R58).
- The `playwright` job installs Chromium without `--with-deps`; it works because ubuntu-latest has Chrome's libraries preinstalled. Add `--with-deps` if that changes.
- Keep the flake-watch notes in [evals/tier1.md](evals/tier1.md) current; the macOS runner fps override (R68) hides regressions between 10 and 30 fps.

### Tests

- L: the Windows locked-file tests (survey and `fsx`) now skip when the OS does not block the read. This is probably a race in the lock-holding helper on slow runners. Wait for the helper's "locked" signal before probing. Until then the unreadable-entry path is untested on Windows CI.
- FR: the "silent outside a port" status test assumes no `port.json` above the OS temp dir.
- FR: dangling-symlink survey test and the pack file-symlink case never ran on the Windows dev machine (no symlink permission); they run on all three CI OSes.
- FR: test debt for `.sh`/`.command` launchers and for the python fallback (see Shell and serve).
