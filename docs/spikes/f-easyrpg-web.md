# Spike f: EasyRPG Player web build for the `rt-easyrpg` lane (RPG Maker 2000/2003, BYO)

Date 2026-11-18. Windows 11, Edge headless (`--headless=new`, CDP), Node 22. Throwaway files in `docs/spikes/scratch/` (git-ignored): downloads in `easyrpg-dl/`, `easyrpg-src-dl/`, `liblcf-dl/`; harness page `erpg-www/` (`index.html`, `harness.js`, `rt/` = the two runtime files); server and CDP driver in `erpg/` (`server.mjs` sends the `pack.mjs` base CSP on every response, `run.mjs`).

## Verdict

**Viable for BYO.** The official 0.8.1.1 web build boots under our CSP (plus `'unsafe-eval'`), loads every game file through a 30-line `XMLHttpRequest` shim that answers from memory, renders a title screen from a 4-file fixture we generated ourselves, takes CDP key input, pauses, and keeps saves in IndexedDB across reloads (all **observed**). No game file touched the network: the server log shows only `/`, `harness.js`, `rt/index.js`, `rt/index.wasm`.

## 1. Pinnable artifact

| Field | Value |
|---|---|
| URL | `https://easyrpg.org/downloads/player/0.8.1.1/easyrpg-player-0.8.1.1-js.tar.gz` (listed in the h5ai index of that folder; not linked from the downloads page) |
| Version | 0.8.1.1 "Stun - Patch 1", tagged 2025-06-02; still the latest GitHub release (**observed** via the releases API) |
| Size / sha256 | 3,619,705 bytes, `99b6963c943bb355e1b1221125cb4536ca2f627c329d8a89cee5a928cdd6a14f` (**observed**, computed here) |
| Archive | `tgz`, one top folder `player-js/` (so `strip: 1`): `index.html` 9,394 B, `index.js` 241,066 B, `index.wasm` 8,862,380 B, empty `games/` |
| Licence | GPL-3.0-or-later (source headers: "version 3 ... or (at your option) any later version") |
| Licence file inside | **None.** The tarball has no COPYING or third-party notices (**observed**). |

The GitHub releases carry no assets. No official npm package exists (npm search: nothing from EasyRPG). Other options: `ci.easyrpg.org/job/player-js/` nightlies and `easyrpg.org/play/master/` (both track master and are not pinnable), or building with emscripten via EasyRPG's buildscripts (about 20 libraries; heavy, but it would allow `-sDYNAMIC_EXECUTION=0`, see 3). **Recommend the 0.8.1.1 `-js.tar.gz`.**

Licence text: `toolchain.lock.json` `licenseFile` cannot point inside this archive. COPYING for the same tag is at `https://raw.githubusercontent.com/EasyRPG/Player/0.8.1.1/COPYING`: 35,147 B, sha256 `8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903`, byte-identical to the source tarball's copy (**observed**). For GPL source, the dist should point at `https://easyrpg.org/downloads/player/0.8.1.1/easyrpg-player-0.8.1.1.tar.gz` (6,928,406 B, sha256 `1f095c75a0e3150dd7e056500d7740b01f2d4d1696170346721d6e864c014629`). `setup.mjs` therefore needs a second pinned download (url + sha256) for the licence file, or the lane ships the GPL-3.0 text as an asset. The wasm also statically links SDL2, ICU, liblcf, FreeType, HarfBuzz, expat, nlohmann-json and audio codecs, and the archive carries no notices for them. That gap is **unverified** beyond the strings found in the wasm.

## 2. Layout, minimal set, game lookup

- **Minimal runtime set (observed):** `index.js` and `index.wasm` only, about 9.1 MB. `index.html` is upstream's page and is not needed. The wasm must be served as `application/wasm`; it is fetched with `fetch` and `instantiateStreaming` from the script's own folder (`document.currentScript`), so a script tag in `runtime/<lane>-<hash>/` finds it.
- `index.js` is `MODULARIZE`d: `window.createEasyRpgPlayer(moduleArg) -> Promise<Module>`. Upstream's pre-js (`resources/emscripten/emscripten-pre.js`) runs first inside the factory. It reads `document.getElementById('canvas')` (this must exist before the call), writes `#status` `innerHTML`, sets `preRun` to its own mount of `Save` and `/home/web_user/.config`, and builds `Module.arguments` from `location.search`. The post-js chdirs to `/easyrpg/<game>`.
- **Lookup (documented in `src/scene_logo.cpp` and `src/async_handler.cpp`; observed):** every file goes through `AsyncHandler::RequestFile` → `emscripten_async_wget2(url, file)`. That issues an XHR GET for `games/<game>/<path>` (`EM_GAME_URL` is fixed at compile time and defaults to `games/`) and writes the bytes into MEMFS at `<path>` relative to the cwd. The first request is `games/<game>/./index.json` (note the `./`). Then come `RPG_RT.ldb`, `RPG_RT.lmt`, `RPG_RT.ini`, `EasyRPG.ini`, `Font/ExFont`, `Font/Font`, `Font/Font2`, `easyrpg.soundfont`, `autorun.script`, `Logo/Logo1..3`, then maps and assets lazily. A request for a file already in MEMFS is still fetched, so pre-filling the FS alone does not stop requests. A 404 fails at once; a status of 0 is retried up to 16 times.
- **`index.json` format v2** (EasyRPG/Tools `gencache/src/main.cpp`, ISC licence, read but not copied):
  `{"metadata":{"version":2,"date":"YYYY-MM-DD"},"cache":{...}}`. Under `cache`, root files are keyed by their **full** lower-cased, NFKC-normalised name (`"rpg_rt.ldb":"RPG_RT.ldb"`). `ExFont.*` at the root is keyed `exfont`. Each directory is a nested object under its lower-cased name, holding `"_dirname":"<real name>"`, and its files are keyed by lower-cased name **without extension** (`"chipset":{"_dirname":"ChipSet","world":"World.png"}`), except `.ini` and `.po`, which keep theirs. Default depth is 4. The player maps `lower(dirname)/key → dirname/value` and looks up `Normalize(path)`. Format v1 (a flat object, from `indexgen.php`) is legacy.
  `harness.js` `indexJson(paths)` generates this in 12 lines from a file list. The player logged `Parsing index.json version 2` and fetched the mapped real-case names (**observed**).

## 3. Loading BYO files under our CSP

**Recommended: replace `window.XMLHttpRequest` before loading `index.js`** with a minimal class (`open`, `send`, `abort`, `setRequestHeader`, `status`, `response`, `responseType`, `onload`/`onerror`/`onprogress`/`onabort`). It matches `^games/[^/]+/(.+)$`, URL-decodes the path, drops `.` segments, answers `index.json` from the generated cache and everything else from `ctx.files.read(path)` as an exact-length `ArrayBuffer` with status 200, and returns 404 when the file is missing. In the harness the files came from a `Map` standing in for `ctx.files.read`; the whole fixture loaded and rendered (**observed**). The player uses XHR only for `emscripten_async_wget2`; the wasm uses `fetch`. The shim can therefore refuse other URLs (ceiling: it is a page-global patch). The same shim serves bundled mode, because `ctx.files.read` fetches `game/` there. Files stay lazy: only requested assets are read from OPFS.

Rejected options:
- **Pre-filling the Emscripten FS:** the player still fetches everything (see 2).
- **`--project-path`:** pre-js filters it out, and the async loader ignores it.
- **blob URLs:** blocked by CSP. `connect-src 'self'` does not match `blob:`, and hosts or schemes may not be added.
- **A service worker:** more moving parts for no gain.
- **ZIP / `.easyrpg` games:** desktop Player opens them (`OpenViewToEasyRpgFile`), but the web loader would still request each path over HTTP; **unverified**, not pursued.

**CSP (observed):** under the base policy the player dies at start with `EvalError ... 'unsafe-eval' is not an allowed source` from embind's `newFunc` (the `Function` constructor). With `'unsafe-eval'` added it runs. The lane's `shell()` must return `csp: {'script-src': ["'unsafe-eval'"]}`, which is a keyword and so allowed by `cspFor`. Only a custom build with `-sDYNAMIC_EXECUTION=0` avoids this.

**Arguments and hooks (observed):**
- Pass `game: <id>` in `moduleArg` (upstream's own shell does the same). It adds `--game <id>` and sets the cwd to `/easyrpg/<id>`.
- Set the final argv in `onRuntimeInitialized() { this.arguments.splice(0, Infinity, 'easyrpg-player', '--save-path', 'Save', '--game', id, ...extra) }`. It runs as a method of the internal `Module` just before `callMain`, and `Module.arguments` is the same array `run()` passes. The log showed `CLI: easyrpg-player --save-path Save --game fixture --encoding 932`. Without the splice, the shell page's own query string would leak in as player flags.
- In the same hook, set `this.setStatus = () => {}`. `preMainLoop: () => running` pauses the loop (0 frames/s while paused, 61 when running), and `postMainLoop` runs once per rendered frame.

## 4. Saves

- **Storage (observed):** pre-js mounts IDBFS at `Save` under the cwd, so saves land at `/easyrpg/<game>/Save`. That is one IndexedDB database per game id, alongside `/home/web_user/.config` (player settings, shared by every game on the origin).
- **Sync:** the player calls `FS.syncfs()` itself after `Scene_Save` and the settings saves (`AsyncHandler::SaveFilesystem`, **documented**).
- **Persistence (observed):** in the harness, `FS.writeFile('Save/Save01.lsd')` plus `FS.syncfs(false)`, then a page reload, left `Save01.lsd` in `FS.readdir('Save')`. Both IndexedDB databases were listed on the `127.0.0.1` origin.
- **Startup race:** the populate step (`syncfs(true)` in `onPreRun`) has no run dependency. Upstream relies on `main_loop` waiting 5 frames.
- **Shell export/import:** for this, the adapter's `saveNow()` should call `FS.syncfs(false)` and mirror `Save/*.lsd` into OPFS `data.saves`, then copy them back on start if IDBFS is empty. **Unverified** (design only).
- **Game-flow saving:** the in-game save menu was not exercised (the fixture has no map).

## 5. Canvas, frames, input

- **Canvas (observed):** the player draws on the element with id `canvas` (needed by pre-js and by SDL's `SDL_HINT_EMSCRIPTEN_KEYBOARD_ELEMENT "#canvas"`). The adapter must create `<canvas id="canvas" tabindex="-1">` in `ctx.host` and focus it. The player sized it to 640x480 (320x240 at 2x) with a WebGL SDL2 renderer (`hw=true vsync=true`).
- **Frame reporting (observed):** `postMainLoop` gives one call per frame (about 60/s). Call `ctx.reportFrame()` there.
- **Readback (observed):** `toDataURL` and `drawImage` outside the frame return black (no `preserveDrawingBuffer`), so the shell's default `debug.captureFrame` is useless here. A copy taken **inside** `postMainLoop` returned the real pixel (`[0,255,0,255]`), so a lane `captureFrame` should grab on the next `postMainLoop`. CDP screenshots, which verify uses, showed the frame fine.
- **Input (observed):** CDP `Input.dispatchKeyEvent` reached the player through the focused canvas: F1 opened the settings window over the fixture title.
- **Keys (documented, `src/input_buttons_desktop.cpp`):** decision is Z, Space, Enter or Select; cancel is X, C, V, B, N, Escape or numpad 0. F12 resets the player. `verify.inputs: ['Enter']` passes a real title screen to New Game; **unverified** with a real game.
- **Collisions (observed):**
  - pre-js writes into **any** `#status` element. Our shell has `<p id="status">`, and it showed "Running..." after start ("Exception thrown, see JavaScript console…" during the CSP failure). The shell must re-set its status after `start()`, or the adapter can live with it.
  - pre-js also adds a window `error` listener that reads `event.error.message`. It will throw on errors with a null `error`; **unverified**.
  - Audio is SDL2 on its own `AudioContext` with a `ScriptProcessorNode` (deprecation warning seen); the audio tap was not checked.

## 6. Fixture

- **TestGame is out.** EasyRPG's `TestGame` repo is GPL-3.0, with assets under CC-BY 4.0 and other licences (its `AUTHORS.md`), so it cannot go into our MIT repo.
- **We wrote our own files instead (observed working).** The player started and drew the title from these 4 files, generated in JS (`harness.js` `fixtureFiles`):
  - `RPG_RT.ldb` (23 B): BER length 11, `LcfDataBase`, then the Database chunk `0x16` (System), length 9, `[0x11, 5, "Title", 0x00]`. That is `title_name = "Title"`, and every other field is a liblcf default.
  - `RPG_RT.lmt` (15 B): BER length 10, `LcfMapTree`, `00 00 00 00` (no maps, empty order, active node 0, empty Start struct).
  - `RPG_RT.ini` with `[RPG_RT] GameTitle=`.
  - `Title/Title.png`: 320x240, **8-bit palette** (16 colour bands). A 32-bit PNG was rejected ("bit depth of 32 that is not supported by RPG_RT") and drawn as a checkerboard.
- **What it shows:** the coloured title, a black command window (no System skin, empty terms), and the warning "The game has no start location set." Frames are nonblank, and pressing F1 changes them.
- **No RTP needed:** none of these files depend on it. The player logs `RTP support is disabled` because the web build has no RTP at all (`filefinder_rtp.cpp`). Missing assets are reported and drawn as a checkerboard.
- **Cheapest path:** a Node test helper of about 40 lines (BER chunks plus a paletted PNG via `zlib`). Optionally add a System skin PNG of our own and a one-map tree with a start position to reach the map.
- **Rejected:** `lcf2xml` or EasyRPG XML (`EASY_RT.edb`/`.emt`). Those are supported only when already in MEMFS, because the web startup list never requests them.

## 7. Encoding and known gaps

- **Encoding order** (`Player::GetEncoding`): `--encoding N`, then `RPG_RT.ini [EasyRPG] Encoding=`, then ICU detection, then locale. ICU data is in the wasm. The desktop step that checks detected encodings against asset file names is `#ifndef EMSCRIPTEN`, so on the web the first ICU guess wins. Our ASCII fixture detected `ibm-5348` (Windows-1252), and `--encoding 932` was accepted (**observed**). Built-in bitmap fonts include Shinonome, WenQuanYi, Baekmuk and ttyp0 (names in the wasm), and FreeType handles `Font/Font*`.
- **No RTP on the web:** RTP-dependent games need the user's own RTP files merged into the game folder (the lane build step can do this from the user's install), or the free EasyRPG RTP replacement (CC-BY 4.0, incomplete) supplied by the user. We never bundle either.
- **No `RPG_RT.exe` reading on the web** (`exe_reader.cpp` is compiled out): we saw "Could not get the size of RPG_RT.exe / Assuming older engine". Engine and patch detection falls back to database heuristics, so the build step should detect the engine from the exe on disk and pass `--engine rpg2k|rpg2kv150|rpg2ke|rpg2k3|rpg2k3v105|rpg2k3e` (from `--help`). Custom logos from the exe are lost too.
- **Maniac Patch:** partial support in 0.8.1 (strings present). **DynRPG:** no DLL plugins, only built-in emulation of a few. **MIDI:** a built-in FmMidi synth, with WildMidi and FluidSynth names present. A SoundFont can be `easyrpg.soundfont` in the game folder (requested at startup) or uploaded with `Module.api.uploadSoundfont()` into the shared config. Which MIDI backends are compiled in, and the SoundFont size needed for good MIDI (typically several MB, user-supplied), are **unverified**.

## Recommendation for the lane

- **Data mode:** `byo` (bundled works through the same shim).
- **Runtime pin:** `easyrpg-player-js` 0.8.1.1 `-js.tar.gz`, sha256 `99b6963c…a14f`, size 3,619,705, `tgz`, `strip: 1`, files `index.js` and `index.wasm`, licence `GPL-3.0-or-later`, source `https://github.com/EasyRPG/Player`. COPYING comes from the pinned raw URL above (needs a small `setup.mjs` extension, or the lane ships the GPL text); record the source tarball URL and sha256 for the GPL offer.
- **Loading:** the adapter, in order:
  1. creates `#canvas` and focuses it;
  2. installs the XHR shim (generated `index.json` v2 plus `ctx.files.read`);
  3. loads `index.js` by script tag;
  4. calls `createEasyRpgPlayer({game: <port id>, onRuntimeInitialized() { splice argv; silence setStatus }, preMainLoop, postMainLoop})`.

  `shell()` returns `csp: {'script-src': ["'unsafe-eval'"]}`.
- **Build step:** detect the engine from `RPG_RT.exe` (version or size, read-only; a DRM'd exe still means STOP) and the encoding (ini, or a survey language hint). Write `lane_config: {engine, encoding, rtp: 'missing'|'merged'}`, and warn when RTP assets that the database references are absent.
- **Verify:** `inputs: ['Enter']`, frames from `postMainLoop`, CDP screenshots for blank/frozen, and the lane `captureFrame` grabbed inside `postMainLoop`. Ready time was about 0.3 s to the factory resolving on localhost, with the title drawn within 1 s.
- **Saves:**
  - IDBFS at `/easyrpg/<id>/Save`; the player syncs after saving.
  - `saveNow()` = `FS.syncfs(false)`, mirroring `Save/*.lsd` to OPFS `data.saves` for export and import.
  - `pause()`/`resume()` toggle `preMainLoop`.
- **Known gaps:**
  - no RTP or exe reading on the web, so the engine flag comes from the build step;
  - `'unsafe-eval'` is required;
  - `#status` collides with the shell's;
  - Maniac support is partial, DynRPG is mostly unsupported, and MIDI quality depends on a user SoundFont;
  - no third-party notices ship in the artifact;
  - macOS/Linux and audio are unverified.
- **Fixture plan:** our own generated `RPG_RT.ldb`/`RPG_RT.lmt`/`RPG_RT.ini` plus an 8-bit `Title/Title.png` (all MIT, under 2 KB). Later, add our own System skin and a one-tile map with a start location to test New Game, saving and the save menu.
