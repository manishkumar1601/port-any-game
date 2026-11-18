# Spike g: love.js for the `rebuild-love` lane (LÖVE games)

Date 2026-11-18. Windows 11, Edge 157 headless (`--headless=new`, CDP over WebSocket), Node 22.22.3. Throwaway files in `docs/spikes/scratch/lovejs/` (harness, fixture, servers) and `scratch/lovejs-dl/` (npm tarball, untrusted, never executed). Labels: **observed** (I ran it), **documented** (upstream source/docs, URL given), **unverified**.

## Verdict

**YES, viable, and the BYO adapter route works: skip love.js's CLI and its `game.data`/`game.js` entirely.** The `.love` bytes are written into the Emscripten FS in `Module.preRun` and run via `Module.arguments`. **observed** with the compat build (no COOP/COEP) under the repo's base CSP. Three things the lane must handle: a blocking `alert()` on LÖVE version mismatch, saves that only sync on `beforeunload`, and 11.4-only runtime (no 12.0).

## Q1. Pinnable artifact

- **observed/documented**: npm `love.js` 11.4.1 (dist-tag `latest`, published 2022-08-25; upstream `github.com/Davidobot/love.js`). Carries **LÖVE 11.4** (`love.getVersion()` returned `11.4.0 Mysterious Mysteries`).
  - URL `https://registry.npmjs.org/love.js/-/love.js-11.4.1.tgz`, size **6560275**, sha256 `9eb2db1f789254faed8e5cf7eeeded46a7e56ecbc931c88be809526c448d25fb` (computed from the downloaded bytes). npm integrity `sha512-NLMD2GpIHOCsflgulr18p4+Crizfixgo5ZMbJmDrqVuR7jdketbUDL7X+LCR2o2uMkVU8ZwXnRwT86S7A75yhA==`.
  - Licence **MIT** (`package/LICENSE`, "Copyright (c) 2016 Tanner Rogalsky"). Archive layout: `package/...` so `archive: tgz`, `strip: 1`, `licenseFile: LICENSE`, `license: MIT`, `source: https://github.com/Davidobot/love.js`.
  - Runtime files inside: `src/compat/{love.js 325454, love.wasm 4720726}`, `src/release/{love.js 386198, love.wasm 4746105, love.worker.js 3423}`, `src/{compat,release}/index.html`, `src/game.js` (template), `src/*/theme/`. The `sample/` entries are text-symlinks and must be ignored.
- **CLI dependencies** (`package.json`): `commander ^2.9.0`, `fs-extra ^3.0.1`, `klaw-sync ^2.1.0`, `mustache ^2.3.0`, `uuid ^3.0.1`. **We do not need the CLI**: it only mustache-renders `index.html`/`game.js`, writes `game.data` (the concatenated files + offsets, not a packer format) and copies the runtime files (read `index.js`; not run).
- GitHub `master` of Davidobot has an 11.5 build (`src/release/love.wasm` is a different size, description says 11.5) but **no tag, no release and package.json still says 11.4.1**: not pinnable by version. npm 11.4.1 is the only immutable artifact. **documented** (GitHub API, 2026-11-18).
- Alternative **2dengine/love.js** (MIT, active: pushed 2026-10-25; LÖVE 11.5 in `11.5/{love.js,love.wasm}`, `player.js`): no tags/releases (pin by commit, tip was `87c5645cfb7b70a0b58e9ab0d656e0fb4c0960d7`), **threaded only**, so it needs COOP/COEP and its readme asks for `'unsafe-eval'` (not tested here). Its `player.js` also does `Module.FS.createDataFile('/', game.love, bytes, ...)` in a prerun hook, i.e. the same mechanism. **documented**, not run. Keep as the M2b upgrade path to 11.5; a Task could re-run this spike's harness against it.
- Third-party licences (LÖVE itself is zlib; Lua, FreeType, SDL2, libs inside the wasm) are **not shipped in the npm tarball**. The lane must ship an attribution file (LÖVE zlib notice at least). **unverified** which exact libraries are linked; `OpenAL Soft` does not appear in the wasm strings.

## Q2. How the runtime loads the game (decides BYO adapter)

**documented** (`src/compat/index.html`, `src/game.js`): the CLI page sets `Module = { arguments: ['./game.love'], INITIAL_MEMORY: 16777216, canvas, printErr, setStatus, ... }`, loads `game.js` (which pushes a `preRun` that fetches `game.data`, caches it in IndexedDB `EM_PRELOAD_CACHE`, and calls `Module.FS_createDataFile` per file) and then `love.js`, whose `onload` calls `Love(Module)`. `game.data` is **not** an Emscripten file_packager blob; it is raw concatenated bytes plus offsets in `game.js`. For a `.love` input the only file is `/game.love`.

**observed**: BYO equivalent, no `game.js`/`game.data`/index.html from upstream:

```js
const bytes = await ctx.files.read('game.love');          // Uint8Array from OPFS
window.Module = {
  arguments: ['./game.love'],
  INITIAL_MEMORY: 16777216,                                // 60 MB .love also ran with this value
  canvas,                                                  // the <canvas> element, id is not required
  locateFile: (p) => baseUrl + p,                          // love.worker.js (threaded build only), love.wasm
  print: (t) => ..., printErr: (t) => ...,
  preRun: [() => Module.FS_createDataFile('/', 'game.love', bytes, true, true, true)],
};
// <script src="love.js">, then: Love(Module).then(() => started)
```

- `Module.FS` is **not exported** in 11.4.1 (`Module["FS"]` absent); `Module.FS_createDataFile`, `FS_createPath`, `FS_createPreloadedFile`, `canvas` are. `FS_createDataFile(..., canOwn=true)` takes the Uint8Array without copying; a 60 MB `.love` (random padding file) loaded with the default 16 MB initial memory and ran (**observed**; memory growth beyond that not probed).
- `.love` that is a directory (loose `main.lua`) is also possible via `FS_createPath`/`FS_createDataFile` per file with `arguments: ['./']` (**documented** from `index.js`, not run); a zip is simpler and what players have.
- Trigger: `ctx.files.read()` bytes must exist before `Love(Module)`; no run-dependency needed (preRun runs before main).

## Q3. Compat vs threaded

- **observed**, same fixture, same harness:

| Build | No COOP/COEP | With COOP/COEP |
|---|---|---|
| compat | runs, `SharedArrayBuffer` undefined, 270 frames in 5 s | runs identically |
| release (threaded) | **throws** `ReferenceError: SharedArrayBuffer is not defined` in `love.js` | runs, `crossOriginIsolated=true`, `pthread_sigmask() ... no-op` warnings only |

- Files that differ: release adds `love.worker.js` (pthread worker, `new Worker(pthreadMainJs)`, loaded same-origin via `locateFile`), uses SAB; compat has none of that. **The lane must pin compat**: the shell page cannot send COOP/COEP headers on static hosts.
- Audio: **documented** (readme Note 1) compat "results in dodgy audio". Both builds use SDL2 `createScriptProcessor` on the main thread (**observed** by grep). Audio quality and the autoplay unlock (needs a user gesture before `AudioContext` starts) were **not tested**. Compat also has no `love.thread` parallelism (documented: threads/coroutines/shaders notes in upstream readme).

## Q4. Fused games and containers

- **observed** (`scratch/lovejs/fused.mjs`, uses repo `listZip`): a 4096-byte stand-in "exe" prefix + my `.love` (`copy /b` style, central-directory offsets relative to zip start): EOCD formula `start = eocdOffset - cdSize - cdOffset` gave 4096 = prefix length, slice equals the original `.love` byte for byte, and `listZip` already returns correct names for the fused buffer.
- A second variant with offsets rewritten absolute (Info-ZIP `-A` style): `listZip` detects it (base 0) and `min(entry.offset)` = 4096 is the zip start, but the slice keeps absolute offsets and is not a valid standalone zip; a build step would have to rewrite offsets or just pass the whole file (rare, **unverified** in LÖVE).
- **observed, simpler**: passing the **whole fused file (prefix + zip) as `/game.love` runs under love.js** (PhysFS finds the zip from the end, 242 frames, no errors). So slicing is optional for the `copy /b` case. Do it anyway to drop the exe's megabytes: `start = Math.min(...listZip(buf).map(e => e.offset))`, slice to the end. Reuse `skills/port-any-game/scripts/lib/archive.mjs` `listZip` (needs no change).
- macOS `Contents/Resources/*.love` inside the `.app` and plain `.love` files: **documented** (LÖVE wiki "Game Distribution": a `.love` is a zip with `main.lua` at its root, macOS bundles carry it in `Contents/Resources`, Windows/Linux fuse by appending). The wiki was behind a Cloudflare challenge when fetched, so not re-read here; **unverified** by me. Detection rule: zip (or zip tail) whose entries include a root `main.lua`; a fused game has `main.lua` in the zip after slicing. A game without `main.lua` at root (extra wrapper folder) is the classic zipped-folder mistake: report it.
- Game written for the executable-only fused engine (custom LÖVE fork, bundled C modules/DLLs like `love.dll` mods, `require("ffi")` native libs): cannot run, see Q5 verdict.

## Q5. LÖVE version mismatch

- **observed/documented** (LÖVE 11.5 `src/common/version.h`, `boot.lua`): the compatibility list of a running LÖVE is `{self, "11.0".."11.4"}` for 11.5; on `main` (12.0 dev) it is `{"12.0"}` only. `conf.lua`'s `t.version` is checked in `boot.lua`; mismatch prints and calls `love.window.showMessageBox`.
- **observed**: with `t.version = "0.10.2"` love.js 11.4 prints the warning and shows a **blocking `alert()`** ("Compatibility Warning ... made for version '0.10.2'"), then runs. A CDP session has to accept it, and in a page it halts the game loop until dismissed. **Fix in the adapter**: set `window.alert = () => {}` (in the iframe/page that hosts love) before `Love(Module)` and surface the message to the shell as a warning.
- Version source: parse `conf.lua` in the zip for `t.version = "x.y[.z]"` (regex; the file is Lua, so also possible `t.version = something_dynamic`). No `conf.lua` or no `t.version` means unknown (LÖVE then assumes a default and warns).
- What breaks on 11.x for older games (**documented** from LÖVE's own 11.0 breaking changes; wiki not re-fetched): 0.x games use 0-255 colours (`setColor(255,...)`, `clear(255,...)`) and removed APIs (`love.graphics.setColorMode`, `Source:setLooping` semantics, `love.filesystem.exists/isFile`, joystick/audio changes), so they run but render wrong or crash. 12.0 games use APIs absent in 11 (and 12 changed the compat list again).
- **Recommended verdict rule**: from `t.version`: `11.x` (0..4) **GO**; `11.5` **GO** with a warning (compat list on the wasm is 11.4, a few 11.5-only calls may be missing: **unverified**); `0.x`/`10.x` **HARD** (needs a 0.10/0.9 build or code migration; warn, still try 11.4); `12.x` **NO** (until a 12.0 love.js exists); unknown **HARD**. Always **NO** for fused games that ship native `.dll/.so` Lua modules or `ffi` calls (the wasm has no ffi), detectable by non-`.lua`/asset binaries in the zip plus `require("ffi")`/`package.loadlib` greps (**unverified** detector).

## Q6. Saves

- **observed**: `love.filesystem.getSaveDirectory()` is `/home/web_user/love/<identity>`; the build mounts **IDBFS** at `/home/web_user/love` (`FS.mkdir` + `FS.mount(IDBFS, {}, "/home/web_user/love")` + `FS.syncfs(true)` at start, read from `love.js` source). IndexedDB database name `/home/web_user/love` (origin-scoped, so all games on one origin share it; the identity directory separates them).
- **observed**: persistence across page navigations works (fixture counter went 1, 2, 3 on reloads). The only write-back is `window.addEventListener("beforeunload", () => FS.syncfs(false, ...))`. A browser that is closed/killed without `beforeunload` **lost the last session's write** (run 3 read back as 3 instead of 4). Headless `Browser.close` is not the same as a user closing a tab, so the real-world loss rate is **unverified**.
- **Force a sync**: `window.dispatchEvent(new Event('beforeunload'))` on the window hosting love. **observed**: after dispatching it and then closing, the next launch saw the new value (3 then 4). `Module.FS` is not exported, so there is no direct `syncfs` call. Recommend the adapter dispatches it on `visibilitychange` (hidden), `pagehide`, and every N seconds.
- Version-stamped `game.love` is never written to IDBFS (we create it in MEMFS each launch).

## Q7. CSP

- **observed** under the exact base policy from `pack.mjs` (`script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; ...`): compat and release both started and ran (fixture printed, frames drawn). **No `'unsafe-eval'` needed**: `love.js` contains one `eval` in `_emscripten_run_script` that the engine does not call in normal play (**unverified** if a game's `love.system`/JS interop can hit it). No extra host needed; the worker is same-origin (`worker-src 'self'`). WebAssembly compile needs `'wasm-unsafe-eval'`, already in the base.
- The only CSP violation seen was my harness's inline `oncontextmenu` attribute (not love.js). The adapter must not use inline handlers.
- 2dengine's readme asks for `'unsafe-eval'`; do not add it without testing that build.

## Q8. Fixture and frame detection

- `scratch/lovejs/src/main.lua` + `conf.lua` (own MIT code, 40 lines): `love.graphics.clear` with a colour from `frame % 60`, prints save dir/version, increments `runs.txt` in `love.filesystem`, counts `love.keypressed`. Zipped with a 30-line stored-zip writer (`mkzip.mjs`, `zlib.crc32`) into a 1216-byte `.love`.
- **observed**: 61 distinct pixel colours sampled over 5 s, 270 frames in 5 s (compat, SwiftShader/headless), key `a` via `Input.dispatchKeyEvent` produced `KEY a 1` in love's stdout. Frame count is safe to drive `ctx.reportFrame()`.
- **Detection recipe** (`scratch/lovejs/www/hook.js`): love renders through `requestAnimationFrame` (Emscripten main loop). Wrap `window.requestAnimationFrame`, call the original callback, then count one frame per distinct timestamp (same trick as `web-extract/frame-hook.js`). The canvas is a WebGL canvas: hook `HTMLCanvasElement.prototype.getContext` for `webgl*` to capture the context, and `gl.readPixels(x, y, 1, 1, ...)` **inside the same rAF task right after the callback** (no `preserveDrawingBuffer` needed). Distinct sampled colours across frames then prove the picture changes, which is what verify needs for "not a frozen/black screen". Hook before `love.js` runs; in an iframe it also catches the game's own rAF.

## Recommendation for the lane (`rebuild-love`)

1. **Data mode: BYO.** Shell imports the `.love` (or fused exe/.app) into OPFS; adapter reads it via `ctx.files.read()` and writes it into the Emscripten FS in `preRun`. No bundled `build/game` is needed, so the web-extract path is not reused.
2. **Runtime pin:** npm `love.js@11.4.1` (sha256 above, `archive: tgz`, `strip: 1`, `licenseFile: LICENSE`, MIT). Copy only `src/compat/love.js` + `src/compat/love.wasm` (about 5.0 MB) into `dist/runtime/rebuild-love-<hash>/`. No npm install, no CLI, no COOP/COEP. Drop the release/threaded files.
3. **Loading mechanism:** adapter creates a canvas in `ctx.host` (iframe recommended: isolates the `Love`/`Module` globals, `beforeunload` and `alert`), installs the rAF/readPixels frame hook, sets `window.alert` to a no-op that forwards to a shell warning, then loads `love.js` and calls `Love(Module)` with the Module fields in Q2. Needs keyboard focus (`canvas.tabIndex`, focus on click) and `preventDefault` for arrows/space (upstream index.html does this).
4. **Build step (`pag build`):** detect container (plain zip with root `main.lua`, fused exe via `listZip` + `min(offset)` slice, macOS `.app/Contents/Resources/*.love`), write the clean `game.love` to `build/` for the shell to import, read `conf.lua` `t.version` for `lane_config` and the verdict (Q5).
5. **Verify inputs:** frames from the rAF hook plus sampled colour variance; `lane_config` carries `{ version, identity, fused }`. A `love.errhand` blue screen is a painted frame, so also scrape love's `print`/`printErr` for `Error`/`stack traceback` and fail verify on it.
6. **Saves:** works via built-in IDBFS; adapter forces sync with a synthetic `beforeunload` on `pagehide`/`visibilitychange`/timer. Warn that clearing site data drops saves.
7. **CSP:** base policy is enough (no new keywords). Do not set COOP/COEP.
8. **Known gaps:** LÖVE 11.4 only (no 11.5 features, no 12.0), no LuaJIT speed or `ffi`, compat audio is rough and gesture-gated (untested), real-tab-close save loss, 0.x/10.x games HARD, shaders need strict GLSL typing (documented upstream), games with native modules NO, macOS/Linux and Chrome/Firefox/Safari not run (Edge on Windows only), `Module.FS` not exported (no direct file access for debugging), third-party licence text still to compile.
9. **Fixture plan:** commit `main.lua` + `conf.lua` under the lane's fixtures (MIT, ours), build the `.love` in the test with a zip writer (our own stored-zip helper or the `mkzip.mjs` logic), plus a fused variant (4 KB prefix + zip) and an `old` variant (`t.version = "0.10.2"`) to test the alert override. Lane e2e: Edge/Chrome via the existing verify driver, assert frames > N and colour variance > 1, key press logged, reload keeps `runs.txt`.
