# Spike h: Ren'Py SDK "Web (Beta)" rebuild (rebuild-renpy lane, M2a)

Date 2026-11-18. Windows 11, Edge 157 headless driven by the repo's own CDP driver (`scripts/verify/driver-cdp.mjs`), Node 22.22.3.
Throwaway files in `docs/spikes/scratch/` (git-ignored): `renpy-ls.mjs`, `renpy-attrs.mjs`, `renpy-extract.mjs` (uses the repo's `lib/archive.mjs`), `renpy-serve.mjs` (serves a build under `/game/` with `pack.mjs` `cspFor` headers and injects the web-extract `frame-hook.js`), `www-renpy/host.*` (the web-extract adapter's iframe logic), `renpy-run.mjs`, `renpy-probe.mjs`, `renpy-fps.mjs`, `renpy-sw.mjs`. Test game: `renpy-proj/pagtiny/game/script.rpy`, 30 lines I wrote (MIT): a `main_menu` screen, two `say` lines, a two-way `menu`. Screenshots: `renpy-shot/relaxed-menu.png` (main menu), `relaxed-ingame.png` (choice menu).

## Verdict

**GO for Ren'Py 8.x games.** The pinned 8.6.1 SDK plus its web package builds a shipped 8.1.3 game (compiled `.rpyc` only, packed in `scripts.rpa`) into a web build without any GUI and without decompiling. The build boots in a same-origin iframe under the web-extract CSP relaxation, plays, and keeps its saves after a reload (all **observed**). Two things must change from the plain web-extract path:
- **Frames:** Ren'Py web never calls `requestAnimationFrame`, so the web-extract frame hook counts 0 frames. Frames have to be counted from WebGL draw calls instead.
- **CSP:** the build needs both `'unsafe-eval'` and `'unsafe-inline'`.

macOS and Linux builds are **unverified**. Ren'Py 7.x is **unverified**: it has a web target, but it would need a second pin.

## 1. Pinnable artifacts (observed, sha256 computed here and equal to the PGP-signed `checksums.txt`; signature not checked)

| Artifact | URL | Bytes | sha256 |
|---|---|---|---|
| SDK 8.6.1 (released 2026-11-17, latest) | `https://www.renpy.org/dl/8.6.1/renpy-8.6.1-sdk.zip` | 163957166 | `596c31be88b351de64166276708278a70f24e833be7181e7c37b8c106a0f0fdb` |
| Web support 8.6.1 | `https://www.renpy.org/dl/8.6.1/renpy-8.6.1-web.zip` | 13288022 | `8e77b88df5ab00c8ad66e02222aed24de91888dca77410cd2fbdd161dc55fad0` |
| Web support 7.8.7 (latest 7.x, 2025-03-17) | `https://www.renpy.org/dl/7.8.7/renpy-7.8.7-web.zip` | 4930225 | `7bebc4c0ad669fd884d9a1ac287da15b42e2ff19ba4158616f9d9f5735ba0cbf` |
| SDK 7.8.7 (not downloaded) | `https://www.renpy.org/dl/7.8.7/renpy-7.8.7-sdk.zip` | ~157 MB | `51d5936c61d1d57626fa79f8b4839b0f4cc41c5e27f0632ae8e3fa6cbb0c5853` (upstream `checksums.txt` only) |

- **One SDK `.zip` serves all three OSes (observed).** It has a single top folder, `renpy-8.6.1-sdk/`, with 3294 entries, all store or deflate. There are no symlinks and no zip64. The archive carries Unix exec bits (`renpy.sh`, `lib/py3-{linux-x86_64,mac-universal}/{python,pythonw,renpy,zsync,zsyncmake}` and `renpy.app/Contents/MacOS/*`).
  - The repo's `extractZip` unpacked it in 7 s and keeps those bits on POSIX.
  - `lib/` holds `py3-windows-x86_64` (54.5 MB), `py3-mac-universal` (79.2 MB), `py3-linux-x86_64` (42.9 MB) and `python3.12` (14.0 MB). There is no Linux ARM build in it; that needs `sdkarm.tar.bz2`.
- **The other formats in `/dl/8.6.1/` do not fit `setup` (from the index listing).**
  - `sdk.tar.bz2` (148 MB) is bzip2, which `setup` cannot read.
  - `sdk.dmg` (151 MB) and `sdk.7z.exe` (118 MB, a 7-Zip self-extractor) are not archives `setup` can open.
  - **So use the `.zip`.** `setup` ignores `strip` for zip, so tool paths keep the `renpy-8.6.1-sdk/` prefix. Either add zip `strip` support or live with the prefix.
- **Web package placement:** the web zip holds 12 entries under `web/`. Unzip it into the SDK root to get `<sdk>/web/`.
  - The launcher accepts it only when `<sdk>/web/hash.txt` equals `launcher/game/web_hash.txt` (`6dcaf924…6f74` in both). That check is `check_hash_txt` in `launcher/game/mobilebuild.rpy`.
  - On a mismatch, `web_build` exits with "Web support is not available".
  - So the SDK and web versions must match exactly.
- **Licence:** `renpy-8.6.1-sdk/LICENSE.txt` (147 KB). It reads "Most of Ren'Py is covered by … (MIT)". Portions are LGPL (FFmpeg, Fribidi, parts of pygame_sdl2); others are PSF Python, zlib, libpng, FreeType, Apache-2.0 and MPL-2.0. The full LGPL text is included.
  - The web zip carries no licence file.
  - The built `game.zip` does include `renpy/LICENSE.txt`.
  - Suggested lock `license`: `MIT AND LGPL-2.1-or-later (see LICENSE.txt)`.
- **7.x:** 7.8.7 has a web package. It is the older "renpyweb" (`index.wasm` 13.9 MB, `pythonhome.data`, `pyapp.data`, IDBFS saves, no SharedArrayBuffer). Its launcher registers the same `web_build` command (documented: `launcher/game/web.rpy` at tag `7.8.7.25031702`). It was not run.

## 2. Headless build (observed)

```
<sdk>/lib/py3-windows-x86_64/python.exe <sdk>/renpy.py <sdk>/launcher web_build <project> --destination <out>
```

- **Where the command comes from:** `web_build` is registered with `renpy.arguments.register_command` in `launcher/game/web.rpy`, with the arguments `web_project`, `--destination` and `--launch`. `gui=False` makes it use a `TextReporter`, and no window opened.
- **POSIX:** use the same command with `lib/py3-linux-x86_64/python` or `lib/py3-mac-universal/python`. `renpy.sh` picks the folder by `uname` (**unverified**).
- **Timing:** 9.4 s for the tiny project, including the `.rpy` compile and a `--json-dump` subprocess run of the game. 11.7 s for the 8.1.3 shipped copy.
- **The build writes into the project folder,** so build a copy: `progressive_download.txt`, `log.txt`, `game/cache/*.rpyb`, `game/saves/persistent`, and `.rpyc` files next to any `.rpy`.
  - It also writes `<out>.zip` (47.8 MB) beside `<out>`.
  - Progress lines end in `\r` with no newline, so capture the output and do not stream it line by line.
- **Trust:** the dump step runs the game's init Python natively on the build machine. That is the same trust as launching the game.

## 3. Shipped games and version mismatch (observed for 8.1 → 8.6)

- **Shipped-game fixture.** I built `pagtiny` with SDK 8.1.3 (`renpy-8.1.3-sdk.zip`, sha256 `9e5a0763…68ec`, equal to upstream) using `launcher distribute <proj> --package win`, with `build.archive("scripts")` and `.rpy` classified out. The result is what a store copy looks like:
  - `game/scripts.rpa` (`RPA-3.0`)
  - `game/script_version.txt`
  - `game/cache/`
  - `renpy/` and `lib/py3-windows-x86_64` + `lib/python3.9`
  - `pagtiny.exe`
- **Rebuild.** I copied **only** that `game/` into an empty project folder and ran `web_build` with SDK 8.6.1. It worked: main menu after 5.2 s, then dialogue, the choice menu, a save, and a reload with the save still loadable.
- **Reading the version:**
  - `renpy/vc_version.py` gives the exact build: `version = '8.1.3.23091805'` (the 8.6.1 SDK says `'8.6.1.26111705'`).
  - `game/script_version.txt` gives `(8, 1, 3)`. It is written only when the game has no `script_version.rpy[c]` (`distribute.rpy`).
  - Fallback: the `lib/` folder name. `py3-*` means 8.x, and `00build.rpy` ignores `py2-*` as "the wrong Python", which marks 7.x. That `lib/<os>-<arch>` means 6.x or ≤7.3 is **unverified**.
- **Why a minor mismatch loads:** `renpy/script.py` rejects a compiled script only if `data["version"] != script_version`, and `script_version = 5003000` in 7.8.7, 8.1.3 and 8.6.1 (documented from the tagged sources).
- **Python version risk:** Python blocks are kept as source and recompiled. Python 3.9 code from 8.0–8.3 now runs on 3.12, so modules removed in 3.12 (`imp`, `distutils`, `asynchat`) would fail at run time (**unverified**). 7.x Python 2 code under the 8.x SDK would fail the same way (**unverified**).
- **Suggested verdict rule:**
  - **GO** when `vc_version` is 8.x and ≤ the pinned SDK.
  - **HARD** when:
    - the game is 8.x newer than the pin;
    - the game is 7.x (needs the 7.8.7 SDK and web pair, about 170 MB more);
    - the game is 6.x (7.8.7 SDK, untested);
    - `vc_version.official = False` or the shipped `renpy/` is patched, since the web build uses the SDK's engine and engine patches are lost;
    - `game/**` contains native modules (`.pyd`/`.so` under `python-packages`);
    - the game uses threads or networking, which the web docs list as unsupported;
    - the game uses movies other than `renpy.movie_cutscene`, or uses Live2D;
    - the game folder is very large (see §4).
  - **NO** when there is no `game/` with `.rpy`/`.rpyc`/`.rpa`.
  - **Steam** does not matter: achievements become no-ops on web (documented: no networking). Steam DRM on the exe is irrelevant because the exe is never used, but the survey's STOP rule still applies.

## 4. Output layout, CSP, iframe path (observed)

Tiny game, 46 MB in all (44 MB without `index.html.symbols`):

| File | Size | Notes |
|---|---|---|
| `index.html` | 6.3 KB | Inline `<script>` sets `window.gameZipURL='game.zip'` and registers `./service-worker.js`; inline `oncontextmenu`/`onchange` handlers; `javascript:` links in the hamburger menu |
| `renpy-pre.js` | 31 KB | Loader, IDBFS mount, `renpy_exec` bridge (Python from JS) |
| `renpy.js` | 381 KB | Emscripten loader |
| `renpy.wasm` | 23.6 MB | Engine |
| `renpy.data` | 14.0 MB | Python runtime |
| `game.zip` | 5.9 MB | 583 entries: engine Python `renpy/**` (incl. `renpy/LICENSE.txt`) + `game/**` + `game/cache/*.rpyb`. Fetched in full and streamed into MEMFS before start |
| PWA extras | — | `service-worker.js`, `manifest.json`, `pwa_catalog.json`, `icons/` (16 PNG), `web-presplash.jpg` (1.1 MB) |
| `index.html.symbols` | 2.1 MB | Debug map; not needed |

- **Progressive download** (images, music and voice fetched while playing) covers only loose files matched by `progressive_download.txt`. Anything inside an `.rpa` always lands in `game.zip`. Big games therefore download everything before the title screen, and the memory ceiling is **unverified**.
- **Network and threads:** there is no `Worker`, no `SharedArrayBuffer` and no `Atomics`, and only same-origin GETs were seen. `crossOriginIsolated` was false and the game ran, so **COOP/COEP is not needed**.
- **CSP:** each variant was served with `pack.mjs` `cspFor`:
  - **Base policy:** fails. The inline script is blocked, so the game fetches `game/undefined` (404) and reports "Could not load game.zip".
  - **Base + `'unsafe-inline'`:** fails. An `EvalError` is thrown in `_emscripten_run_script`. Ren'Py's Python calls `emscripten.run_script` (eval) at startup (`renpy/main.py`), and the `renpy_exec` bridge uses it too.
  - **Base + `'unsafe-eval'` + `'unsafe-inline'`:** this is exactly web-extract's relaxation, and it runs. `'wasm-unsafe-eval'` is already in the base policy. `blob:` is used only for the save-export download.
- **Iframe path:**
  - The build runs unchanged in the web-extract iframe (`game/index.html` beside the shell, hook injected first in `<head>`). Trusted CDP clicks and keys reach it through the focused iframe.
  - The page registers a service worker with scope `/game/` (observed in `getRegistrations()`). The shell has none.
  - **But the frame hook saw 0 frames** (see §6), so the unmodified web-extract adapter would never call `reportFrame`.

## 5. Saves (observed)

- **Where they live:** `renpy-pre.js` mounts IDBFS at `/home/web_user/.renpy`, which becomes the IndexedDB database `/home/web_user/.renpy` for the origin. `renpy/savelocation.py` calls `syncfs` after each save.
- **Test:** `renpy_exec('renpy.save("1-1")')` wrote `/home/web_user/.renpy/<config.save_directory>/1-1-LT1.save`, `persistent` and `sync/*`. After a page reload, `renpy.can_load("1-1")` was `true`, for both the tiny build and the 8.1.3 shipped build.
- **Gotcha:** when `config.save_directory` is unset (my first draft), saves go to MEMFS `game/saves` and are lost on reload. The standard project template sets it, so shipped games normally have it. The build should warn when it is missing.
- **Scope:** saves are per origin, so they follow `pag serve`'s stable per-port port.
- **Moving saves:** the hamburger menu has Import/Export saves as a zip, which also works with desktop saves (documented in `web.html`).

## 6. Frames and inputs (observed)

- **Frames:**
  - The canvas is `#canvas` (WebGL2) inside the iframe, 1280x720 at a 1280x720 viewport.
  - `requestAnimationFrame` was called **0 times**: the asyncify loop runs on timers, so the web-extract rAF counter stays at 0.
  - Counting one frame per task that issues `drawArrays`/`drawElements` (by wrapping `WebGL{,2}RenderingContext.prototype`) gave **9.4–9.6 frames/s** on an idle main menu and on idle dialogue. Ren'Py idles at about 10 fps, so `verify.target_fps` must be ≤ 5. The faster rate during transitions is **unverified**.
- **Ready time:** the main menu appeared after 3.1 s (tiny build) and 5.2 s (shipped build) on localhost.
- **Inputs:**
  - **Main menu:** `ArrowDown` then `Enter` started the game. Keyboard focus navigation is generic; the Start button's position differs per game.
  - **Dialogue:** `Click` and `Enter` each advanced one line. `Space` is in Ren'Py's `dismiss` keymap but not `button_select` (`renpy/common/00keymap.rpy`), so it did nothing at the choice menu.
  - Avoid `Escape`: it opens the game menu.

## 7. Download and disk size (observed)

One download for every OS: 177 MB (SDK zip 164 MB + web 13 MB), about 397 MB on disk unpacked (356 + 41 MB). `pag setup renpy` should warn "~180 MB download, ~400 MB disk". About 230 MB could be pruned after extraction (other-OS `lib/`, `renpy.app` 81 MB, `tutorial` 34 MB, `the_question` 12 MB, `doc` 12 MB), but it is not needed. Each build output is about 44 MB plus the game's own files.

## Not observed / unverified

- Builds on macOS and Linux (Gatekeeper/quarantine; a headless Linux CI box may need `SDL_VIDEODRIVER=dummy`); Ren'Py 7.x and 6.x games; big games (hundreds of MB of `.rpa`: download time, MEMFS memory).
- Audio, movies and Live2D on web; the frame rate during transitions; Chrome as well as Edge; `renpy.force_autosave()` as a save hook.
- BYO data mode: overriding `fetch('game.zip')` in the frame with a zip built from OPFS. `connect-src 'self'` blocks fetching a `blob:` URL, so it would have to be a `Response` returned by a patched `fetch`.

## Recommendation for the lane

- **Data mode:** `bundled` with `ACK_PRIVATE_USE_ONLY`, as the stub already says. `game.zip` contains the user's game. Whether to add `ACK_RUNTIME_LICENSE` for the LGPL parts statically linked into `renpy.wasm` is the owner's call. BYO is a later option (see unverified).
- **Runtime pin:**
  - Add two lock entries, or one tool with an extra part: the SDK zip and the web zip from §1, both `archive: "zip"`.
  - `setup` needs (a) to extract the web zip into the SDK root and (b) zip `strip`, or else paths prefixed with `renpy-8.6.1-sdk/`.
  - `licenseFile`: `renpy-8.6.1-sdk/LICENSE.txt`. `pack` writes that notice into the dist.
- **Build step (`pag build`):**
  1. Copy only the game's `game/` into `build/renpy-project/game/`.
  2. Run `python renpy.py launcher web_build build/renpy-project --destination build/game` with the platform's `lib/py3-*/python`.
  3. Delete `build/game.zip`, `index.html.symbols` and the PWA files, and drop the service-worker registration from `index.html`.
  4. Inject the frame hook.
  5. Write `build/lane.json` with `{game_renpy_version, sdk_version}`.
  6. Fail clearly on the "Web support is not available" message.
- **Loading:**
  - Reuse the web-extract adapter and iframe path with `requiresBuild`.
  - `shell()` returns `csp: {'script-src': ["'unsafe-eval'", "'unsafe-inline'"]}` and `needs_coi: false`.
  - Extend `frame-hook.js` (or use a lane variant) to count WebGL draw batches per task when the page never calls rAF.
- **Verify:** `inputs: ['ArrowDown', 'Enter', 'Click', 'Enter']`, `target_fps: 5`, `budget_ready_s: 15` (5.2 s observed).
- **Saves:** IDBFS, automatic, per origin. An adapter `saveNow()` could call `renpy_exec('renpy.force_autosave(block=True)')` in the frame; this is **unverified**, and only `renpy.save` was observed.
- **Detect:** apply the §3 rule from `renpy/vc_version.py`, else `game/script_version.txt`, else the `lib/` naming. The survey rule `renpy` already exists in `engines.json`.
- **Known gaps:** 7.x needs a second pin. Large `.rpa` games are slow and memory-heavy. Engine patches in a shipped `renpy/` are dropped. The build runs game init code natively.
- **Fixture plan:**
  - Commit the 30-line MIT `script.rpy` above as `test/fixtures/renpy-tiny/game/script.rpy`, keeping `config.save_directory` and the `main_menu` label.
  - Unit tests: version parsing (`vc_version.py` and `script_version.txt` text written by us), build-command construction, and `index.html` patching.
  - Lane e2e, gated like the other runtime e2e: `pag setup renpy`, then build, pack and verify. Cache the 177 MB download in CI.
  - A "shipped" variant: build the fixture with the pinned SDK's `distribute` into a temp folder at test time. No shipped game data is committed.
