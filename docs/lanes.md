# Lanes

A **lane** is one way of getting a game running in the browser. `pag survey` ranks the lanes that fit a game, `pag new` picks one, `pag build` runs its build step, and `pack` bundles its adapter and runtime into the shell. This page describes the lane module contract, the ranking, the four lanes built in M1, the M2 lanes, the planned stubs, and how to add a lane.

Related: [survey-and-catalog.md](survey-and-catalog.md) (how detection feeds the lanes), [runtime.md](runtime.md) (shell, `shell.json`, pack), [safety-and-policy.md](safety-and-policy.md) (acks and data modes), [verify.md](verify.md). The agent-facing, per-lane runbooks are in [references/lanes/](../skills/port-any-game/references/lanes/): [web-extract.md](../skills/port-any-game/references/lanes/web-extract.md), [known-ports.md](../skills/port-any-game/references/lanes/known-ports.md), [runtimes.md](../skills/port-any-game/references/lanes/runtimes.md) (Ruffle), [dos.md](../skills/port-any-game/references/lanes/dos.md), [easyrpg.md](../skills/port-any-game/references/lanes/easyrpg.md), [love.md](../skills/port-any-game/references/lanes/love.md), [renpy.md](../skills/port-any-game/references/lanes/renpy.md). Do not copy those into this repo doc; they are what the agent reads at run time.

## Where lanes live

| Path | What |
|---|---|
| [scripts/lanes/index.mjs](../skills/port-any-game/scripts/lanes/index.mjs) | Registry (`LANES`, keyed by `id`) and `rankLanes(survey)` |
| [scripts/lanes/web-extract.mjs](../skills/port-any-game/scripts/lanes/web-extract.mjs), [known-port.mjs](../skills/port-any-game/scripts/lanes/known-port.mjs), [rt-ruffle.mjs](../skills/port-any-game/scripts/lanes/rt-ruffle.mjs), [dos-jsdos.mjs](../skills/port-any-game/scripts/lanes/dos-jsdos.mjs) | The four M1 lanes |
| [scripts/lanes/rt-easyrpg.mjs](../skills/port-any-game/scripts/lanes/rt-easyrpg.mjs), [rebuild-love.mjs](../skills/port-any-game/scripts/lanes/rebuild-love.mjs), [rebuild-renpy.mjs](../skills/port-any-game/scripts/lanes/rebuild-renpy.mjs) | The M2 lanes |
| [scripts/lanes/stubs.mjs](../skills/port-any-game/scripts/lanes/stubs.mjs) | Descriptor-only lanes for later milestones |
| `assets/lanes/<id>/adapter.js` | The browser adapter, copied into `dist/runtime/` ([assets/lanes/](../skills/port-any-game/assets/lanes/)) |
| [scripts/toolchain.lock.json](../skills/port-any-game/scripts/toolchain.lock.json) | Pinned third-party runtimes (Ruffle, js-dos, EasyRPG, love.js, the Ren'Py SDK) that lanes name in `runtime.tool` |

## The lane module contract

A lane is a default-exported object. The registry reads it in three places: survey (`detect`, ranking), `pag new` / `pag build` (`available`, `checklist`, `build`), and `pack` (`dataModes`, `runtime`, `shell`, adapter path).

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Lane id. Also the port's `lane` in `port.json` and the folder `assets/lanes/<id>/` |
| `rung` | number | Position on the ladder (0 best). Used only for ranking |
| `available` | boolean | `false` for stubs. `pag new` refuses an unavailable lane (`not available until <milestone>`); `verdict.primary_lane` skips them |
| `milestone` | string | `M1`..`M5`; shown in the "available in Mx" reason |
| `dataModes` | string[] | `byo`, `bundled`, `none`. `pack` rejects any other mode except `bundled-public`, which is lane-independent and gated by policy. `pag new` writes `dataModes[0]` into `port.json` `data.mode` |
| `acks` | string[] | Acknowledgement ids the survey asks for when this lane is primary (see below) |
| `checklist` | string[] | Items rendered as `- [ ]` lines in the port's `PORTING_LOG.md` |
| `odds` | string | Free text shown in the survey line (`odds 85-95%`) |
| `detect(survey)` | fn | Returns `{verdict: 'GO'\|'HARD'\|'NO', why}`. Pure; reads the survey object only |
| `build(portDir, opts)` | async fn | Optional. Run by `pag build`; prints its return value as JSON. A lane without `build` exits 1 with "has no build step yet" |
| `shell(port, {portDir})` | fn | Optional. Contributes to `shell.json` (see below) |
| `runtime` | `{tool, files?}` | Optional. The pinned tool whose files `pack` copies next to the adapter. A getter is fine (Ruffle computes its file list lazily) |
| `adapter` | path | Optional override; default is `assets/lanes/<id>/adapter.js` (rebuild-renpy uses web-extract's) |
| `external` | boolean | Known-port only: the lane routes to a web port that already exists, so `pack` refuses ("nothing to pack") |
| `requiresBuild` | boolean | `pack` must find `build/game` (web-extract, rebuild-renpy); it will not pack the raw install |

Other optional fields exist for tests and tools (`dosboxConf` on dos-jsdos).

### `shell()` contribution

`pack` merges what `lane.shell(port, {portDir})` returns into `shell.json` ([pack.mjs](../skills/port-any-game/scripts/pack.mjs), `shellJson`). Recognised keys:

| Key | Effect |
|---|---|
| `serve` | copied to `shell.json.serve` (web-extract sets `{caseFallback: true}`) |
| `lane_config` | copied verbatim; typically the content of `build/lane.json` (the SWF or DOS exe) |
| `needs_coi` | cross-origin isolation headers (COOP/COEP). Default is `requires.threads === true` |
| `csp` | CSP relaxation: `{directive: ["'keyword'", ...]}`. See below |
| `verify` | merged over the defaults: `target_fps`, `inputs`, `audio_on_title`, `budget_ready_s` |
| `requires`, `memory`, `input`, `video` | merged over the defaults in `pack.mjs` |

**`csp`.** The base policy is fixed in `pack.mjs`. A lane may only add quoted CSP keywords to a directive the base policy already has (`cspFor`). An unknown directive, or a value that is not a `'keyword'` (a host or scheme), throws at pack time. `verify` reports any relaxation as an info check.

**`verify.inputs`.** The list of `KeyboardEvent.code` values the verifier presses during its run. The special value `Click` is a trusted click on the middle of the stage. Many titles wait for a click or key before drawing anything.

### Runtime `{tool, files}` and the adapter

`pack` hashes the adapter plus the runtime files into `dist/runtime/<lane>-<hash8>/` (served immutable). `runtime.tool` must be a key of `toolchain.lock.json` and installed (`pag setup <tool> --yes`, which leaves a `.ok` marker); `runtime.files` lists paths relative to the tool folder. Licence text of the tool is written to the dist by `pack`.

The adapter is an ES module whose default export is `{id, start(ctx), ...}`. The shell passes a `ctx` (host element, audio context, `reportFrame`, `reportError`, `reportPageError`, the OPFS-mounted game files). Optional adapter methods: `saveNow()`, which `verify` calls once to exercise the lane's own save path. It reports `lane saveNow ran` if it succeeds, `lane save path not exercised` if the adapter has none, and fails the `save` check if it throws. Adapters must not touch the DOM at module top level, because Node tests and `build` import their helper exports (`dosPath`, `swfFromProjector`, `gencacheIndex`).

## Ranking

[rankLanes](../skills/port-any-game/scripts/lanes/index.mjs) calls every lane's `detect`, drops `NO`, and sorts:

1. verdict: `GO` before `HARD`;
2. then lower `rung` first;
3. then `known-port` before the rest.

Under a STOP protection verdict every lane except `remote-play` is reported as `NO` ("blocked by <id>") and sorted last. `verdict.mjs` then picks `primary_lane` as the first ranked lane that is `available`, so unavailable stubs never become primary but are named in the reasons ("Best fit X is available in M2"). The overall verdict is `GO` when the primary lane's verdict is `GO`, else `HARD`; with no available lane it is `HARD` and `primary_lane` is null. See [survey-and-catalog.md](survey-and-catalog.md#overall-verdict-and-lane-ranking).

### Rungs

| Rung | Idea | Lanes |
|---|---|---|
| 0 | Already web content, or an existing public web port | web-extract, known-port |
| 1 | Self-hosted emulator or runtime on the user's files | rt-ruffle, dos-jsdos, rt-easyrpg, rt-scummvm, rt-idtech |
| 2 | Engine reimplementations that need more care | rt-mkxpz, rt-ags, rt-dirplayer, rt-butterscotch |
| 3 | Rebuild or VM-style runtimes | rebuild-renpy, rebuild-love, rt-cheerpj, rebuild-godot |
| 4 | Windows compatibility layers | win-bottleship, win-boxedwine, win-dosboxx, win-v86 |
| 5 | Source ports, engine exports | src-port, src-engine-export |
| 6 | Rewrite / decompile | rewrite-html5, decomp-rebuild |
| 7 | Static recompilation | recomp-x86 |
| 8 | Remote play (always applies, last resort) | remote-play |

## M1 lanes

| Lane | Rung | Data mode | Acks | Detects |
|---|---|---|---|---|
| `web-extract` | 0 | `bundled` | `ACK_PRIVATE_USE_ONLY` | any engine id in `nwjs, electron, rpgmaker-mv, rpgmaker-mz, construct, gdevelop, twine` -> GO |
| `known-port` | 0 | `byo` | `ACK_PRIVATE_USE_ONLY` | catalog match: store/signature -> GO; engine/title or `needs_confirm` -> HARD |
| `rt-ruffle` | 1 | `byo` | `ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE` | engine `flash-swf` or `flash-projector` -> GO |
| `dos-jsdos` | 1 | `byo` | `ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE` | main exe is MZ/LE/LX, or engine `dos`/`dosbox-wrapper` -> GO |

### web-extract

For games that already are a web app in a native wrapper or an HTML5 engine export. Agent runbook: [web-extract.md](../skills/port-any-game/references/lanes/web-extract.md).

`build` writes `<port>/build/game/` (always deleted and recreated; extraction goes to a temp folder first so a failure leaves no half-built game):

1. **Extraction order** (first hit wins): `package.nw` (folder or zip), a zip appended to an exe (from the survey's `overlay.magic === 'zip'`, main exe first), `resources/app.asar`, `resources/app/`, `www/`. None found is an error.
2. **Entry:** `package.json` `main` wins when it is an HTML file inside the folder; otherwise `index.html`. When `main` is another file, `index.html` becomes a meta-refresh to it (an existing one is kept as `__pag_index_orig.html`).
3. **Frame hook:** [frame-hook.js](../skills/port-any-game/assets/lanes/web-extract/frame-hook.js) is copied in as `__pag_hook.js` and a `<script>` for it is injected first in the entry's `<head>` (`injectHook`). A Buffer is spliced byte-wise, so Latin-1 or Shift-JIS pages are never re-encoded. The normalise, inject and swap steps live in `finishWebBuild(tmp, out)`, which other web lanes reuse. The hook counts one frame per distinct `requestAnimationFrame` timestamp. While no rAF frame has been counted, it instead counts one frame per browser task that issues a WebGL draw call (`drawArrays`, `drawElements` and their instanced and range variants), for timer-driven pages that never call rAF; the first rAF frame switches that fallback off. It also forwards the game's uncaught errors to the adapter.
4. **Node-API scan:** every `.js` outside `node_modules` is scanned line by line for `require(`, `process.`, `nw.`, `greenworks`. A use is skipped when `Utils.isNwjs()` appears within 3 lines above it (heuristic, no scope analysis). Any remaining use makes the build verdict `HARD`, otherwise `GO`. Shims are not part of M1.
5. **Case check:** references in html/js/css whose case differs from the file on disk are counted, not fixed; the shell serves with `caseFallback`.
6. A section is appended to `PORTING_LOG.md`. Returns `{entryHtml, nodeApiUses, caseFixes, verdict}`.

`shell()` returns `serve.caseFallback`, `csp: {'script-src': ["'unsafe-eval'", "'unsafe-inline'"]}` (RPG Maker damage formulas and PixiJS shaders, Twine's inline story engine and many plugins need them; the build is the user's own code and verify reports the relaxation), and arrow-key `verify.inputs`. `requiresBuild` is set, so pack refuses without `build/game`. The adapter loads `game/index.html` in a same-origin iframe and mirrors the iframe's key events up to the shell.

### known-port

Rung 0 and `external: true`: it builds nothing. The catalog ([survey-and-catalog.md](survey-and-catalog.md#the-catalog)) knows an open engine or port for the game; `build` tells the user where to go. Agent runbook: [known-ports.md](../skills/port-any-game/references/lanes/known-ports.md).

- **Routing / tiers.** `detect` treats a match as sure only if it is not a guess (`needs_confirm` true, or tier `engine` or `title`, is a guess). A `store` or `signature` match gives `GO`. Any guess-only match gives `HARD` with "confirm with the user". This stops an engine match (any Build-engine `.grp` is not Duke3D) from outranking a lane that works.
- **`build(portDir, {includeHighRisk, catalog})`** reads `catalog_matches` from the port's `survey.json`, collects each matched game's ports, hides `legal_risk: "high"` ports unless `--include-high-risk`, and prints for each port its name, URL, licence, the user's own files to pick, and risk. It asks the user to confirm unsure matches, notes unknown catalog ids, appends a section to `PORTING_LOG.md` (catalog text is sanitised so it cannot forge checklist or heading lines), and returns `{kind: 'external', ports, data_files, message}`.
- `pack` on this lane throws: there is nothing to pack.

### rt-ruffle

Flash content runs on Ruffle (self-hosted WebAssembly, tool `ruffle-selfhosted`), bring-your-own data. Agent runbook: [runtimes.md](../skills/port-any-game/references/lanes/runtimes.md).

- `build` requires the tool installed (`pag setup ruffle --yes`). It picks the main SWF in `game/` (shallowest, then largest) and writes `build/lane.json` `{swf, projector: false}`. With no SWF it falls back to the survey's Flash projector (an exe whose overlay is `swf`) and sets `projector: true`; the adapter unwraps the SWF from the projector trailer in the browser (`swfFromProjector`).
- `runtime` is `{tool, files}`; `files` is read lazily from the installed tool folder and filtered to `ruffle.js`, `core.ruffle.*.js` and `*.wasm` (no source maps).
- `shell()` returns `lane_config` from `build/lane.json` and `verify` with `inputs: ['Click','Enter','Space']`, `target_fps: 30`.
- The user's SWF is imported into OPFS in the browser and is never in `dist`.

### dos-jsdos

DOS programs run on js-dos 8.5.4 (DOSBox compiled to wasm, **GPL-2.0**), bring-your-own data. Agent runbook: [dos.md](../skills/port-any-game/references/lanes/dos.md).

- **Runtime:** the raw `emulators` API with the `dosbox` backend, running in a Web Worker. `runtime.files` is the minimal set (`emulators.js`, `wdosbox.js/.wasm`, `wlibzip.js/.wasm`, `package.json`). It is taken from the user's tool cache and never vendored in this repo.
- **GPL handling:** the lock's `licenseFile` is js-dos's `package.json`, and because the lock says `GPL-2.0`, `pack` appends the GPL-2.0 text (`assets/licenses/GPL-2.0.txt`) to the licence notice it writes into the dist. js-dos stays a separate, unmodified work in its own folder.
- **Build:** the survey's largest non-installer MZ/LE/LX executable, else the largest `.COM` in `game/` (the survey cannot see header-less `.COM`). It writes `build/lane.json` `{exe}` in DOSBox 8.3 form (`dosPath`, which assumes the `~1` suffix).
- **Adapter:** builds a `.jsdos` zip (a `dosbox.conf` from `dosboxConf` plus the user's files from OPFS) in the browser using the shell's own `zip.js`. It draws on its **own canvas**, appended to the host from the first frame, and forwards keyboard only (`KeyboardEvent.code` mapped to js-dos key codes).
- **Saves:** DOSBox writes into the worker's in-memory disk. `saveNow()` calls `ci.persist()` (the files changed since start, as a zip) and stores it in OPFS under `shell.json` `data.saves`; the next start mounts it as a second bundle. It also runs every 30 s, on `pause()` (tab hidden) and on `pagehide`. `verify` calls `saveNow()` to exercise this.
- `shell()` returns `needs_coi: false`, `lane_config`, and the Click/Enter/Space verify inputs.

## M2 lanes

| Lane | Rung | Data mode | Acks | Detects |
|---|---|---|---|---|
| `rt-easyrpg` | 1 | `byo` | `ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE` | engine `rpgmaker-2k` -> GO |
| `rebuild-love` | 3 | `byo` | `ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE` | engine `love` -> GO (verdict from `build`) |
| `rebuild-renpy` | 3 | `bundled` | `ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE` | engine `renpy`: 8.x up to the pinned SDK -> GO; newer, 7.x, older or unknown -> HARD |

### rt-easyrpg

RPG Maker 2000/2003 games run on EasyRPG Player 0.8.1.1 (the upstream web build, **GPL-3.0-or-later**, tool `easyrpg-player-js`), bring-your-own data. Agent runbook: [easyrpg.md](../skills/port-any-game/references/lanes/easyrpg.md).

- **Runtime:** `runtime.files` is `index.js` and `index.wasm`, from the user's tool cache, never vendored. The upstream tarball has no licence file, so the lock names none: because the lock says `GPL-3.0-or-later`, `pack` appends the GPL-3.0 text (`assets/licenses/GPL-3.0.txt`, byte-identical to EasyRPG's own `COPYING` at 0.8.1.1) after the source offer in `LICENSES/easyrpg-player-js.txt`. Setup downloads nothing else, so it works on networks that cannot reach raw.githubusercontent.com.
- **Build:** requires the tool installed (`pag setup easyrpg --yes`). It writes `build/lane.json`:
  - `root`: the folder holding the shallowest `RPG_RT.ldb` (any case), relative to `game/`, `''` at the top;
  - `game`: a slug of the port folder's name (`[a-z0-9-]`, at most 40 characters, else `game`). It is the player's id: its `games/<id>/` URLs and its IndexedDB save store;
  - `encoding`: `RPG_RT.ini` `[EasyRPG] Encoding`, only when set (passed as `--encoding`);
  - `rtp`: `full-package` when `[RPG_RT] FullPackageFlag=1`, else `needs-rtp`. `needs-rtp` makes the verdict HARD, not NO (the game runs; missing RTP assets show as a checkerboard), and appends the four-step fix (copy, merge the user's RTP, set the flag, `pag new` the copy) to `PORTING_LOG.md`.
  - No `--engine` from `RPG_RT.exe` yet: the player guesses the engine from the database.
- **Adapter:** creates `<canvas id="canvas">`, placed absolutely in the host (the player sizes its drawing buffer to the canvas box, which in the host's grid would grow past the host). Before loading `index.js` it replaces `window.XMLHttpRequest` with a shim: the player fetches every game file as `games/<game>/<path>` (`emscripten_async_wget2`). The shim answers `index.json` with a generated gencache v2 index (`gencacheIndex`: real names under lower-case keys, so `TITLE/TITLE.PNG` is found for `Title/Title`), every other path from `ctx.files` under `root` (case-insensitive), 404 for a missing file, and refuses any other URL (the wasm comes through `fetch`). `onRuntimeInitialized` replaces the player's arguments (`--save-path Save --game <id>`, plus `--encoding`), so the page's query string never reaches it, and silences `setStatus`. Upstream's pre-js overrides a `setStatus` passed to the factory and writes its start-up messages into the shell's `#status`; the shell resets its line when `start()` returns.
- **Frames:** `postMainLoop` reports frames and `preMainLoop` returns false while paused. The player's own start-up (black, the EasyRPG logo, black again; about 1.5 s) is not counted, as for Ruffle's splash (R46): a 16x12 copy of the canvas, taken after each drawn frame, tells the phases apart (`startupPhase`). A game that opens on black is counted from 10 s after the first frame, so it stays inside the ready budget on slow machines.
- **Saves:** IDBFS at `/easyrpg/<game>/Save`, synced by the player after each save. `saveNow()` forces `FS.syncfs(false)` and throws when the player has no `FS`, so verify's "lane saveNow ran" means a real sync.
- `shell()` returns `lane_config`, `csp: {'script-src': ["'unsafe-eval'"]}` (embind builds its glue with `new Function`), `needs_coi: false`, and `verify` with `inputs: ['Enter']`, `target_fps: 30`.

### rebuild-love

LÖVE games run on love.js 11.4.1 (LÖVE 11.4 compiled to wasm, **MIT**, tool `love.js`, from npm), bring-your-own data. Agent runbook: [love.md](../skills/port-any-game/references/lanes/love.md).

- **Runtime:** `runtime.files` is `src/compat/love.js` and `src/compat/love.wasm`. Only the compat build: the threaded one needs `SharedArrayBuffer`, so COOP/COEP. No love.js CLI, no `game.data`. `pack` writes the tool's `LICENSE` into `LICENSES/love.js.txt`.
- **Detect:** engine `love` (`love.dll` or a `*.love` file) gives GO; the real verdict comes from `build`.
- **Build:** requires the tool installed (`pag setup love --yes`). It finds the game file, in order: the shallowest `*.love` outside a `.app`; else a `survey.json` exe whose overlay is `zip` (the main exe first); else `*.app/Contents/Resources/*.love`. `loveContainer(buf)` returns the zip start: `min(entry.offset)` from `listZip`, when the bytes from there re-parse as the same zip (a `copy /b` fused exe), else 0, the whole file (Info-ZIP `-A` absolute offsets; love.js's PhysFS finds the zip from the end). It throws when there is no zip or no root `main.lua`. `loveVerdict({conf, lua, names})` reads `<p>.version` from `conf.lua`, where `<p>` is the parameter of `love.conf` (`t` when there is none; Lua comments stripped, so a game's own `game.version` does not count): 11.0–11.4 GO, 11.5 GO (the runtime is 11.4), `0.*`/`10.*` HARD, `12.*` NO, unknown or missing HARD; any `.dll`/`.so`/`.dylib` entry, `require("ffi")` or `package.loadlib` is NO. It writes `build/lane.json` `{file, offset, version}` and appends the verdict to `PORTING_LOG.md`; no game bytes go to `build/`.
- **Adapter:** reads `lane_config.file` from `ctx.files`, slices it at `offset`, and writes it into love.js's MEMFS as `/game.love` in `preRun` (`Module.FS_createDataFile`), with `arguments: ['./game.love']`, `INITIAL_MEMORY` 16 MiB and `locateFile` into the runtime folder. The canvas has `id="canvas"` (SDL registers its mouse handlers on `#canvas`) and its CSS box is the picture itself (centred, shrunk to fit, never enlarged), because SDL scales mouse positions by the CSS box. `window.alert` is replaced for the page's lifetime (LÖVE's version-mismatch message box is a blocking `alert`) and forwards to `console.warn`. `window.eval` is replaced too: love.js reports some start-up failures with `emscripten_run_script("alert(...)")`, which the CSP blocks; the adapter reports love's last output line instead.
- **Frames:** `postMainLoop` reports frames and `preMainLoop` returns false while paused.
- **Errors:** a `print`/`printErr` line matching `/^Error|stack traceback/` (love's error screen still paints frames) calls `ctx.reportError` once.
- **Saves:** LÖVE's IDBFS at `/home/web_user/love/<identity>`. love.js writes it to IndexedDB only from a `beforeunload` listener it adds while `Love()` runs, and does not export `FS`. A synthetic `beforeunload` cannot be used: SDL answers it with `SDL_APP_TERMINATING` and LÖVE quits. So the adapter keeps that listener (it wraps `window.addEventListener` only during the synchronous `Love()` call) and `saveNow()` calls it directly; it throws before love.js has started. It runs every 30 s, on `pause()` and on `pagehide`.
- `shell()` returns `lane_config`, `needs_coi: false` (no CSP relaxation), and `verify` with `inputs: ['Click', 'Enter', 'Space']`, `target_fps: 30`.

### rebuild-renpy

Ren'Py 8 games are rebuilt by the pinned Ren'Py 8.6.1 SDK's own headless web build (tool `renpy`: the SDK zip plus its web support zip, **MIT AND LGPL-2.1-or-later**) and served like web-extract. Bundled data: `game.zip` in the build holds the user's game. Agent runbook: [renpy.md](../skills/port-any-game/references/lanes/renpy.md).

- **Runtime:** `runtime` is `{tool: 'renpy', files: []}`. The web runtime (`renpy.js`, `renpy.wasm`, `renpy.data`) comes inside the build output, so no SDK file is copied into `dist/runtime/`; naming the tool makes `pack` write the SDK's `LICENSE.txt` into `LICENSES/renpy.txt`. `requiresBuild` is set and `adapter` is web-extract's adapter (same-origin iframe on `game/index.html`).
- **Detect:** engine `renpy` with the survey's version (from `renpy/vc_version.py`), judged by `renpyVerdict(version, sdk)` against the lock's `renpy.version` (read once at module load, so `detect` stays pure). Segments compare numerically, over the SDK's segment count: 8.x at or below the SDK is GO; newer is HARD ("needs Ren'Py <v> or newer; pinned SDK is <sdk>"); 7.x is HARD ("needs the Ren'Py 7 SDK, not pinned yet"); 6.x or older is HARD; unknown is HARD ("version unknown; pag build checks game/script_version.txt").
- **Build:** requires the tool installed (`pag setup renpy --yes`), the SDK's Python for this computer, and a `game/` folder at the top of the install. The 8.6.1 SDK ships Python only for Windows x64, macOS (universal) and Linux x64; elsewhere (Linux arm64) the build throws "the Ren'Py 8.6.1 SDK has no Python for <platform>-<arch> ..." before running anything.
  1. Version: the survey's, else `game/script_version.txt` (`scriptVersion`: `(8, 1, 3)` -> `8.1.3`), then `renpyVerdict`. The build runs for every verdict.
  2. Copies only the install's `game/` (symbolic links skipped) into `build/renpy-project/game/`; the SDK writes its log, cache and `.rpyc` files into the project it builds.
  3. Runs `renpyCommand(sdk, project, tmp)`: `<sdk>/lib/py3-windows-x86_64/python.exe`, `py3-mac-universal/python` or `py3-linux-<x86_64|aarch64>/python` with `<sdk>/renpy.py <sdk>/launcher web_build <project> --destination build/.tmp-<pid>`. No shell; `SDL_VIDEODRIVER=dummy` and `SDL_AUDIODRIVER=dummy`; a 10 minute timeout; output captured (its progress lines end in `\r`). The SDK runs the game's init Python once to read its settings (see [safety-and-policy.md](safety-and-policy.md#1-the-legal-stance)).
  4. A non-zero exit throws `Ren'Py web build failed (exit <code>): <last 20 lines>`; "Web support is not available" (the SDK's `web/` does not match its launcher) throws its own message naming `pag setup renpy --yes`. A failure removes the temp folder and leaves no `build/game`; `build/renpy-project/` stays for its `log.txt` and `traceback.txt`.
  5. `cleanWebBuild(tmp)` deletes `*.symbols` and the PWA layer (`service-worker.js`, `manifest.json`, `pwa_catalog.json`, `icons/`) and removes the `navigator.serviceWorker.register(...)` call from `index.html`'s inline script, every other byte unchanged. Then `finishWebBuild(tmp, build/game)` injects the frame hook and swaps the folder in; the SDK's sibling `build/.tmp-<pid>.zip` and the project copy are deleted.
  6. Writes `build/lane.json` `{game_version, sdk_version}` and appends the verdict to `PORTING_LOG.md`, with a warning when no `game/**/*.rpy` sets `config.save_directory` (a `define` or plain assignment at the start of a line; commented-out lines do not count) (saves would stay in memory) or when the game ships only compiled scripts (unknown). Returns `{lane_config, verdict, why}`, plus `warning` when there is one.
- **Frames:** Ren'Py never calls `requestAnimationFrame`; the frame hook's WebGL draw-call fallback counts its frames (about 10 per second when idle).
- **Saves:** Ren'Py's own IDBFS (`/home/web_user/.renpy/<config.save_directory>`), synced after each save; no adapter `saveNow`.
- `shell()` returns `csp: {'script-src': ["'unsafe-eval'", "'unsafe-inline'"]}` (the page's inline script sets the `game.zip` URL, and Ren'Py calls `emscripten.run_script`), `needs_coi: false`, and `verify` with `inputs: ['ArrowDown', 'Enter', 'Click', 'Enter']`, `target_fps: 5`, `budget_ready_s: 30`.

## Stub lanes

[stubs.mjs](../skills/port-any-game/scripts/lanes/stubs.mjs) lists every lane the design plans that is not built yet, as descriptors with `available: false`, `milestone` and a placeholder checklist. They still run `detect`, so the survey can say "best fit rt-scummvm, available in M2". Triggers come from survey engine ids (`engines`), a 32-bit PE main exe (`pe32`, always HARD), or `always`. A `hard` trigger yields HARD instead of GO.

| Milestone | Lanes |
|---|---|
| M2 | rt-scummvm, rt-idtech, remote-play |
| M3 | win-bottleship, win-boxedwine, win-dosboxx, win-v86 |
| M4 | rt-mkxpz, rt-ags, rt-dirplayer, rt-butterscotch, rt-cheerpj, rebuild-godot, src-port, src-engine-export, rewrite-html5, decomp-rebuild |
| M5 | recomp-x86 |

Stub acks include `ACK_OS_LICENSE`, `ACK_GREY_DECOMPILE`, `ACK_GREY_ASSET_EXTRACT`, `ACK_CHEERPJ_TERMS`, `ACK_OWN_DEVICES_ONLY`. These are not yet in the `pag ack` id list, so a lane must add them there when it ships (see below). `remote-play` is the only lane that keeps its verdict under a STOP; its reason line is always kept in the survey summary. See [roadmap.md](roadmap.md).

## Adding a lane

1. **Decide the rung and data mode.** Pick the rung from the table above, and `byo` (user's files imported into OPFS in the browser, nothing in dist) unless the game data is legitimately bundled.
2. **Detection input.** If the lane keys off a new engine, add a rule to `scripts/rules/engines.json` first ([survey-and-catalog.md](survey-and-catalog.md#adding-a-rule-safely)) and a case in [test/survey/rules.test.mjs](../test/survey/rules.test.mjs).
3. **Write the module** `scripts/lanes/<id>.mjs` with the fields above. Keep `detect` pure. Put build facts in `build/lane.json` and expose them through `shell()` as `lane_config`. Declare `verify.inputs` so verify can get past a title screen.
4. **Write the adapter** `assets/lanes/<id>/adapter.js` (default export `{id, start(ctx), saveNow?}`, no DOM at module top level). Load files from OPFS, call `ctx.reportFrame()` on each painted frame, and report fatal errors with `ctx.reportError`.
5. **Pin the runtime**, if any: add an entry to `scripts/toolchain.lock.json` (version, hash, `licenseFile`, `license`), make `pag setup <name>` know it, and list `runtime.files`. Keep it out of the repo.
6. **Register it:** import it in `scripts/lanes/index.mjs`, and if it replaces a stub delete that entry from `stubs.mjs`.
7. **Acks.** Every id in `acks` must exist in `ACK_IDS` in [ack.mjs](../skills/port-any-game/scripts/ack.mjs). Add new ones there (and see [safety-and-policy.md](safety-and-policy.md)).
8. **Tests.** Add `test/lanes/<id>.test.mjs` (see the existing ones for `detect`, `build` and adapter helpers) and adjust the lane-descriptor checks in [test/survey/survey.test.mjs](../test/survey/survey.test.mjs). The pack and verify end-to-end paths use the `lane-test` fixture in `test/fixtures/lane-test`; use it as a model, or pass `laneModule` to `pack()`/`build` in unit tests.
9. **Agent runbook.** Add `skills/port-any-game/references/lanes/<name>.md` (when to use, inputs, steps, known failures) and link it from `SKILL.md`.
10. **Verify for real.** `pag new`, `build`, `pack`, `verify --soak 5` on a legally owned or free sample, and record the outcome in the roadmap/decisions docs ([decisions.md](decisions.md)).
