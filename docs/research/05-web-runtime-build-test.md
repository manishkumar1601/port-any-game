# 05 - Shared web runtime, build host, automated verification and hosting

- Status: research note for planning "port-any-game". Not a design, but section 9 proposes the shared contract every lane should target.
- As of: 2026-11-17. Browser support comes from `@mdn/browser-compat-data` 8.1.9 and `web-features` 3.46.0, both downloaded that day and parsed locally. Tool versions come from the npm and PyPI registries, Docker Hub, Homebrew and jsDelivr on the same day, unless marked otherwise.
- Current stable browsers that day: **Chrome 157** (2026-11-03), **Edge 157** (2026-11-05), **Firefox 160** (2026-11-10) and **Safari 27.2** (macOS/iOS, 2026-10-26). In beta: Chrome 158, Firefox 161, Safari 27.3.
- Scope: the parts shared by every lane: the browser platform, build-host setup on Windows/macOS/Linux, the web shell, storage and BYO files, asset delivery, local serving and hosting, and automated verification. Lanes and game detection are covered in sibling notes 01-04.
- Markers: **[unverified]** means a single, secondary or old source, or a claim we could not check against an official one. **[estimate]** means our planning guess, not a measurement.

---

## TL;DR

1. **The platform is ready for this, with three gaps.** WebGL2, wasm threads + SharedArrayBuffer, SIMD, exceptions, tail calls, WasmGC, AudioWorklet, OPFS and Gamepad work in all three engines. **JSPI became Baseline on 2026-09-14** (Chrome 137, Firefox 153, Safari 27). The gaps:
   - **WebGPU on Linux**: Chrome supports only Intel Gen12+ GPUs (since 144) and NVIDIA on Wayland (since 147). Firefox on Linux has it in Nightly only.
   - **WebGPU in Firefox**: Windows (141) and Apple-silicon Macs (145/147) only. No Android, no Intel Mac.
   - **Memory64 and relaxed SIMD**: not in stable Safari. They are in the Safari 27.3 beta.
   Design rule: every lane targets **wasm32 with at most 2-4 GB**. WebGPU lanes ship a WebGL2 fallback, or say clearly that they need Chrome, Edge or Safari 26+.
2. **Cross-origin isolation:** send `COOP: same-origin` and `COEP: require-corp`, not `credentialless`. Safari still has no `credentialless`, and that is why itch.io's SharedArrayBuffer toggle fails there. On hosts that cannot set headers (GitHub Pages), use the vendored `coi-serviceworker`. Lanes that need no threads (for example a Godot single-threaded export) should declare `needs_coi: false`. That avoids the whole problem.
3. **Toolchain: Emscripten 7.0.0** (2026-11-06; LLVM 23 libc++). It needs **Python ≥ 3.10** (since 4.0.22). emsdk bundles Python and Node on Windows and macOS, but Linux needs a system Python. Windows uses native `.exe` launchers (6.0.0); the `.bat`/`.ps1` launchers were removed in 6.0.13. Install emsdk **project-local and pinned** (`emsdk install 7.0.0`), not with apt (Debian stable ships 3.1.69) and not globally. The `emscripten/emsdk:7.0.0` Docker image is now multi-arch (x64 ~826 MB, arm64 ~800 MB compressed). Use it as a fallback, not the default.
4. **Bring your own files is the default distribution model.** The page is static. The user picks their install folder:
   - `showDirectoryPicker` in Chromium only;
   - `<input webkitdirectory>` everywhere, including iOS 18.4+ and Firefox Android 142+;
   - folder drag-and-drop (`webkitGetAsEntry`) everywhere.
   Files are hashed against a manifest of expected hashes, copied into **OPFS**, and `navigator.storage.persist()` is requested. A strict CSP (`connect-src 'self'`) plus a network check in verify proves that no game bytes leave the machine.
5. **Large assets:** per-file manifest with sizes and per-chunk SHA-256. Content-addressed, immutable chunks. Resumable `Range` downloads into OPFS. Never Emscripten `--preload-file` for anything big. Mount OPFS through the **WasmFS OPFS backend** (pthreads build) or use WORKERFS for File/Blob objects. Do not use the Cache API for game data. **Cloudflare Workers static assets ignore `Range`** (they return 200 with the whole file) and cap files at 25 MiB. Use R2 behind a Worker instead.
6. **Hosting policy:** a build that contains game data is **private only**: localhost by default, otherwise a password-protected host (a Cloudflare Worker + R2 with basic auth or Access, or a self-hosted server with auth). A BYO-files shell contains no game data and can go on any static host. Do check the GPL obligations of the bundled runtimes (js-dos, DOSBox, ScummVM, Boxedwine).
7. **Verify** uses one deterministic script (Playwright for Python 1.65.x) and judges with numbers: no page errors; `crossOriginIsolated` and a GPU adapter where the lane needs them; a "ready" lifecycle event; non-black frames that change after scripted input; a frame-rate floor; an AudioContext that is `running` with RMS above a floor; a save that survives a page reload; memory under budget.
   - WebGPU screenshots need **headed** Chrome on Windows/Linux (headless captures black). On Linux, run it under Xvfb.
   - On a GPU-less Linux machine or CI, use SwiftShader Vulkan.
   - MCP servers (Playwright MCP 0.0.85, Chrome DevTools MCP 1.13.0) are for interactive debugging, not for the pass/fail gate.
8. **The tool's own runtime should be Python 3.10+ standard library only, bootstrapped with `uv` where Python is missing or too old.** emsdk already depends on Python. Python is present in both agent clouds (Claude Code web, Codex) and on Linux. Playwright for Python brings its own driver, so Node is optional. It is only needed for npx-based MCP servers and wrangler, and emsdk also ships a Node.

---

## 1. Browser support matrix (2026-11-17)

Versions are the first stable release with default-on support (BCD 8.1.9). "No" means not supported in the current stable release. "27.3β" means the feature is in Safari 27.3 beta and not yet stable.

### 1a. Graphics and WebAssembly

| Feature | Chrome / Edge desktop | Chrome Android | Firefox desktop | Firefox Android | Safari macOS | Safari iOS/iPadOS |
|---|---|---|---|---|---|---|
| **WebGPU** | 113 on Windows, macOS and ChromeOS. Linux: **144, Intel Gen12+ only**; **147, NVIDIA on Wayland with driver ≥ 535.183.01**; other GPUs behind `--enable-unsafe-webgpu`. Windows on ARM64: behind a flag | 121 on Android 12+ (ARM, Qualcomm, Intel GPUs); 139 for Imagination GPUs on Android 16+; Samsung Xclipse not yet | **141 Windows only**. macOS on Apple silicon: 145 (macOS 26), 147 (all versions). **No Linux** (Nightly only; Mozilla "expects to ship in 2026"). No Intel Macs | No (Nightly only) | **26** (needs macOS Tahoe 26) | **26** (iOS/iPadOS 26) |
| WebGL2 | 56 | 58 | 51 | 51 | 15 | 15 |
| Wasm threads + SharedArrayBuffer (needs cross-origin isolation) | 74 / 68 | 88-89 | 79 | 79 | 15.2 | 15.2 |
| Fixed-width SIMD128 | 91 | 91 | 89 | 89 | 16.4 | 16.4 |
| Relaxed SIMD | 114 | 114 | 146 | 146 | **No** (27.3β) | **No** (27.3β) |
| **Memory64** | 133 | 133 | 134 | 134 | **No** (27.3β) | **No** (27.3β) |
| **JSPI** (Baseline "newly available" since 2026-09-14) | 137 | 137 | 153 | 153 | 27 | 27 |
| Exception handling (legacy / exnref) | 95 / 137 | 95 / 137 | 100 / 131 | 100 / 131 | 15.2 / 18.4 | 15.2 / 18.4 |
| Tail calls | 112 | 112 | 121 | 121 | 18.2 | 18.2 |
| WasmGC | 119 | 119 | 120 | 120 | 18.2 | 18.2 |
| Multi-memory | 120 | 120 | 125 | 125 | No (27.3β) | No (27.3β) |
| OffscreenCanvas | 69 | 69 | 105 | 105 | 16.4 | 16.4 |

Sources: BCD `api.GPU` notes; the gpuweb "Implementation Status" wiki (last edited 2026-05-28); Chrome "New in WebGPU" 144, 147-148 and 155-156; WebKit's "News from WWDC26" post.

### 1b. Cross-origin isolation and transport

| Feature | Chrome/Edge | Chrome Android | Firefox | Firefox Android | Safari macOS | Safari iOS |
|---|---|---|---|---|---|---|
| COOP + COEP `require-corp` | 83 | 83 | 79 | 79 | 15.2 | 15.2 |
| COEP **`credentialless`** | 96 | 96 | 119 | **No** | **No** | **No** |
| `Document-Isolation-Policy` (isolation without COOP/COEP) | 137 | 146 | No | No | No | No |
| Brotli `Content-Encoding` | 50 | 51 | 44 | 44 | 11 | 11 |
| **zstd** `Content-Encoding` | 123 | 123 | 126 | 126 | **26.3** | 26.3 |
| `DecompressionStream('gzip' / 'deflate-raw')` | 80 / 103 | 80 / 103 | 113 | 113 | 16.4 | 16.4 |
| `DecompressionStream('zstd')` | No | No | flag (138) | No | No | No |
| CSP `'wasm-unsafe-eval'` | 97 | 97 | 102 | 102 | 16 | 16 |

What follows:
- **Use `require-corp`.** It is the only isolation mode that works in all engines. Every subresource must be same-origin, or must carry CORS/CORP headers.
- `credentialless` (Chromium and Firefox desktop only) is what itch.io's "SharedArrayBuffer support" toggle sends. Forum reports confirm it does not work in Safari [unverified: community posts].
- `coi-serviceworker` 0.1.7 (last release 2023-07) has `coepCredentialless()` and `coepDegrade()` options, so it can fall back to `require-corp`. It must be served from the same origin, as a separate file, over HTTPS or on localhost. It reloads the page once on the first visit.

### 1c. Game-facing APIs

| API | Chrome/Edge | Chrome Android | Firefox | Firefox Android | Safari macOS | Safari iOS/iPadOS |
|---|---|---|---|---|---|---|
| Gamepad API, `mapping: "standard"` | 35 | 35 | 29 | 32 | 10.1 | 10.3 |
| Rumble (`vibrationActuator.playEffect('dual-rumble')`) | 68 | 68 | **No** | No | 16.4 | **No** |
| Trigger rumble (`'trigger-rumble'`) | 126 | 126 | No | No | No | No |
| Pointer Lock (returns a promise) | 37 (92) | 144 | 50 | 50 | 10.1 (18.4) | **No** |
| Pointer Lock `unadjustedMovement` (raw mouse) | 88; **not on Linux** | 144 | 152 | No | 18.4 | No |
| **Keyboard Lock** (`navigator.keyboard.lock`, works only in fullscreen) | 68 | 68 | **No** | No | **No** | No |
| Fullscreen API | 71 | 71 | 64 | 64 | 16.4 | **iPad only** (16.4). An overlay button cannot be hidden and swiping down exits, so it is "unsuitable for games" (BCD). Not available on iPhone |
| AudioWorklet | 66 | 66 | 76 | 79 | 14.1 | 14.5 |
| `navigator.getAutoplayPolicy()` | No | No | 112 | 112 | No | No |
| `navigator.audioSession` (iOS ringer-switch behaviour) | No | No | No | No | 16.4 | 16.4 |
| WebCodecs `VideoDecoder` / `AudioDecoder` | 94 / 94 | 94 / 94 | 130 / 130 | No | 16.4 / 26 | 16.4 / 26 |
| Screen Wake Lock | 84 | 84 | 126 | 126 | 16.4 | 18.4 |
| `navigator.userActivation` | 72 | 72 | 120 | 120 | 16.4 | 16.4 |

Practical notes for the shell:
- **Gamepads** appear only after the user presses a button on one. Poll `navigator.getGamepads()` in every requestAnimationFrame (rAF). Read pads that are not `standard` in raw HID order, as retro-port does.
- **Raw mouse:** try `requestPointerLock({unadjustedMovement: true})`. If it rejects (for example on Linux Chrome), fall back to plain pointer lock. Pointer lock needs a user gesture, and pressing Esc always releases it.
- **Keyboard Lock** is the only way to capture Esc, Alt+Tab-style and browser-reserved keys, and it exists only in Chromium in fullscreen. Elsewhere, call `preventDefault` on the game keys while the canvas has focus, and document what cannot be captured (Ctrl+W, Ctrl+T and similar).
- **Audio:** create or resume one `AudioContext` inside the Play click handler. Handle `visibilitychange` (suspend and resume) and `statechange`. On iOS, set `navigator.audioSession.type = 'playback'` so the ringer switch does not mute Web Audio [unverified: behaviour per iOS version].

### 1d. Storage and files

| API | Chrome/Edge | Chrome Android | Firefox | Firefox Android | Safari macOS | Safari iOS |
|---|---|---|---|---|---|---|
| OPFS `storage.getDirectory()` | 86 | 109 | 111 | 111 | 15.2 | 15.2 |
| OPFS `createSyncAccessHandle` (in workers) | 102 | 109 | 111 | 111 | 15.2 | 15.2 |
| OPFS `createWritable` | 86 | 109 | 111 | 111 | **26** | **26** |
| `storage.persist()` | 55 | 55 | 57 (asks the user) | 57 | 15.2 | 15.2 |
| `storage.estimate()` | 61 | 61 | 57 | 57 | 17 | 17 |
| **`showDirectoryPicker`** (File System Access) | 86 | 132 | **No** | No | **No** | No |
| `<input type=file webkitdirectory>` | yes | 132 | 50 | **142** | 11.1 | **18.4** |
| Folder drag-and-drop (`DataTransferItem.webkitGetAsEntry`) | 13 | 18 | 50 | 141 | 11.1 | 11.3 |
| Drag-and-drop to a handle (`getAsFileSystemHandle`) | 86 | 132 | No | No | No | No |
| Background Fetch | 74 | 74 | No | No | No | No |

**Quotas and eviction** (MDN, page last modified 2026-01-05):

| Engine | Per-origin quota | Persistence and eviction |
|---|---|---|
| Chromium | Up to **60% of total disk**, in both best-effort and persistent mode | Under storage pressure, best-effort origins are evicted least-recently-used first. `persist()` is granted from site engagement, installation or bookmarks |
| Firefox | Best-effort: min(10% of disk, **10 GiB** group limit). Persistent: **50% of disk, capped at 8 TiB** | `persist()` shows a permission prompt |
| Safari (macOS 14+ / iOS 17+) | Browser apps: about **60% of disk** per origin, with an 80% cap across all origins. Other apps with web views: about 15% | Safari also **evicts proactively**: with tracking prevention on, script-writable storage is deleted after 7 days of Safari use without interaction with the site. **Home Screen and Dock web apps are exempt** (WebKit). Whether OPFS is covered by that rule is **[unverified]**; assume it is |

### 1e. Practical memory limits

- **wasm32:** the spec caps memory at 4 GiB (65,536 pages). V8 allows the full 4 GiB on 64-bit hosts. Emscripten's `MAXIMUM_MEMORY` default stays at 2 GB, and going above 2 GB triggers pointer-conversion wrappers (changelog 6.0.13).
- **Memory64:** the JS API caps a memory at **16 GiB**, which matches V8's `kSpecMaxMemory64Pages = 262,144`. SpiderMonkey measured memory64 code as **10% to over 100% slower** than wasm32, and memory64 is not in stable Safari. **Avoid it.**
- **iOS/iPadOS:** no per-tab limit is published. retro-port's authors had to trim memory for iPhone and iPad. Treat a heap above ~1 GB on iPhone as high risk **[unverified]**.
- **Firefox:** retro-port reports that Firefox's WebGPU rejects typed arrays over 2 GB in `setBindGroup` and patches around it.
- Emscripten's streaming fetch now hands data to wasm in chunks of at most 8 MB (6.0.0).

---

## 2. Build host toolchain per OS

### 2a. Current versions (2026-11-17)

| Tool | Version | Notes |
|---|---|---|
| Emscripten / emsdk | **7.0.0** (2026-11-06); 7.0.1 in development | libc++ 23 removes many transitive includes; the temporary workaround is `-D_LIBCPP_KEEP_TRANSITIVE_INCLUDES_LLVM23`. Default minimum browsers: Chrome 93, Firefox 92, Safari 15.4 |
| Python required by Emscripten | **≥ 3.10** (since 4.0.22, 2025-12-18) | emsdk README: "python 3.10 or above" on Linux. The downloads page still says 3.8 for Windows, which is **stale**. The bundled Python covers Windows and macOS |
| Docker image | `emscripten/emsdk:7.0.0`, `-x64` (~826 MB compressed), `-arm64` (~800 MB compressed) | Multi-arch tags pushed 2026-11-06 (Docker Hub API) |
| Homebrew | `emscripten` 7.0.0, `uv` 0.13.8, `node` 26.13.1, `ffmpeg` 9.0.2 | Homebrew keeps up with upstream |
| Debian/Ubuntu apt `emscripten` | trixie 3.1.69; forky/sid 6.0.5 | **Do not use** (stale) |
| Playwright | npm 1.65.1 (2026-11-13), PyPI **1.65.2** (needs Python ≥ 3.10) | Bundles Chromium 158, Firefox 159 and WebKit 27.2. The Node test runner needs Node 22, 24 or 26. Supported hosts: Windows 11+ / Server 2019+ / WSL; macOS 14+; Debian 12/13; Ubuntu 22.04, 24.04, 26.04 (x64 and arm64) |
| uv | 0.13.9 | One static binary that installs Python per user without admin rights |
| wasi-sdk / Zig | wasi-sdk 34; Zig 0.15.2 | **Not recommended for game lanes.** Neither provides a browser runtime (GL, WebGPU, audio, file system, pthread workers). Possible use: small pure-compute modules. Zig can target `wasm32-emscripten` with the emsdk sysroot |

Emscripten changes since 4.0 that the shell and lanes must follow:
- `-sUSE_WEBGPU` was removed in 4.0.18. Use `--use-port=emdawnwebgpu` (maintained with Dawn).
- `-pthread` and `-m64` replace `-sUSE_PTHREADS` and `-sMEMORY64`, which were deprecated in 6.0.1.
- `WASM=0` and `WASM=2` were deprecated in 6.0.10.
- The SDL3 port is stable since 6.0.10.
- `MEMORY64=2` was deprecated in 6.0.13.
- IDBFS `autoPersist` gained a sync-state callback in 6.0.0.
- In pthreads builds, the WasmFS OPFS backend now uses `readwrite-unsafe` sync access handles (7.0.0). Consequence: `unlink` and `rename` return `EIO` on files that are open.

### 2b. Per-OS matrix

| | Windows 10/11 x64 | Windows 11 ARM64 | macOS 11+ (Apple silicon and Intel) | Linux x64 / arm64 |
|---|---|---|---|---|
| **emsdk native** | Supported. emsdk bundles Python and Node. Tool launchers are `.exe` since 6.0.0. `emsdk.bat` / `emsdk_env.bat`. Git is optional (a zip download works) | **No official prebuilt Windows ARM64 toolchain found**. emsdk can compile from source (#1186), and its manifest has ARM64 Node/Python entries. Practical options: x64 binaries under Prism emulation, or the Linux arm64 build in WSL2 **[unverified]** | Supported, native arm64. emsdk bundles Python, but needs some `python3` to bootstrap: the Xcode Command Line Tools shim (3.9.x **[unverified]**) or a uv-managed Python. Git comes from the CLT. Closure Compiler is native arm64 since 6.0.0 (Intel Macs need a JDK for Closure) | Supported. Needs **system Python ≥ 3.10**: Ubuntu 22.04+ and Debian 12+ are fine; Debian 11 and RHEL 8 are too old, so use uv. Binaries are built against Debian stretch (x64) / bullseye (arm64) sysroots, so they work on most glibc distros |
| **Docker image** | Needs Docker Desktop (WSL2 backend). Mount with `-v "${PWD}:/src" -w /src` | arm64 tag exists (Linux arm64 inside WSL2) **[unverified on WoA]** | Docker Desktop, OrbStack or colima. Use the arm64 tag. Bind-mount I/O is slower than native | Native. Add `-u $(id -u):$(id -g)` so output files belong to the user |
| **WSL2** | Good for bash/autotools-heavy source ports. Keep sources on the WSL ext4 disk: `/mnt/c` is much slower **[unverified magnitude]**. A server in WSL is reachable from the Windows browser on `localhost`. Run browser tests from the **Windows** side to use the real GPU | Same | n/a | n/a |
| **Playwright browsers** | Chromium, Firefox, WebKit (the WebKit build is not Safari) | Chromium x64 under emulation **[unverified]** | All three. Only macOS can run **real Safari**, via `safaridriver` (WebDriver, not Playwright) | All three; `install-deps` needs sudo |
| **Headless WebGPU** | Renders on hardware D3D, but **screenshots are black in headless**. Use headed mode in a logged-in desktop session | Behind a flag | Works headless (Metal) | Hardware: Intel Gen12+, or NVIDIA on Wayland. Otherwise **SwiftShader Vulkan** (needs `libvulkan1 mesa-vulkan-drivers`). Screenshots need **headed + Xvfb** |
| Package manager shortcuts | `winget install astral-sh.uv`, `Git.Git`, `OpenJS.NodeJS.LTS`. No official winget emscripten package found **[unverified]** | Same | `brew install uv emscripten ffmpeg`. The brew emscripten is global and unpinned; prefer project-local emsdk | `apt install python3 git xz-utils`, plus `libvulkan1 mesa-vulkan-drivers xvfb` for verify |

**Agent sandboxes** (from their docs):

| Sandbox | Base system | Pre-installed |
|---|---|---|
| **Claude Code on the web** | Ubuntu 24.04 x86_64 VM; about 4 vCPU, 16 GB RAM, 30 GB disk; no GPU stated (assume SwiftShader). Network is "Limited" by default: package registries and GitHub allowed, Playwright's CDN possibly not **[unverified]** | Python 3.x with pip, uv and pytest; Node 20/21/**22** (default); bun (has proxy issues); **Chrome for Testing at `/usr/bin/google-chrome`** with `CHROME_PATH` set; Docker; cmake, ninja, clang |
| **Codex cloud** (`codex-universal`) | Ubuntu 24.04. Internet is available in the setup script | Python 3.10-3.14 (pyenv) with uv and poetry; Node 18/20/22/24 (nvm, default 22); bun 1.2.x. No browser listed, so install Playwright Chromium in the setup script |

### 2c. Disk budget [estimate unless sourced]

| Item | Size |
|---|---|
| emsdk, one SDK version (LLVM, binaryen, node, python) | ~1.5-2.5 GB installed **[estimate]**. The Docker image is ~0.8 GB compressed |
| Emscripten system-library cache (`cache/`, built on first use per flag set: pthreads, wasm64, LTO...) | 0.2-1 GB **[estimate]** |
| Playwright browsers (Playwright docs, macOS) | Chromium 281 MB, Firefox 187 MB, WebKit 180 MB. `--only-shell` skips full Chromium for headless-only runs |
| retro-port's complete toolchain (Emscripten, JDK, Ghidra, wgpu-native, Python packages) | "about 3 GB" (its README) |
| Game data | 2× the game size during import: source folder plus OPFS copy. Lanes that convert assets need 3× |

### 2d. Idempotent, agent-driven setup

Principles:
1. **Install everything project-local** under `.pag/tools/<name>-<version>/`. Never edit the user's PATH (do not use `emsdk activate --permanent`).
2. **Pin versions** in `toolchain.lock.json` (emsdk version, Playwright version, uv/Python version, ffmpeg hash).
3. **`doctor` before `setup`:** detect, report and propose. Only then install. Ask before any admin step (apt, winget machine scope, Docker).
4. **Every step is a check plus an action.** The check is the cheap truth test: `emcc --version` prints `7.0.0`; `python -c "import sys; print(sys.version_info >= (3,10))"`. If the check passes, skip the step. That makes reruns free.
5. **Downloads are verified.** Pinned URL plus SHA-256, extracted into a fresh directory, never executed from the download folder.

Per-OS bootstrap sequence. The `pag` commands are what the tool runs; the emsdk commands are upstream's.

| Step | Windows | macOS | Linux |
|---|---|---|---|
| 0. Python ≥ 3.10 | Probe `py -3`, then `python`. **The `python.exe`/`python3.exe` App Execution Alias in `WindowsApps` is a Store stub**, so check that `python -c` actually runs. If not: `winget install astral-sh.uv` (user scope), then `uv python install 3.12` | Probe `python3`. The CLT shim may be 3.9, so use `brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh \| sh`, then `uv python install 3.12` | System `python3` if ≥ 3.10, otherwise uv as on macOS |
| 1. emsdk | `git clone --depth 1 https://github.com/emscripten-core/emsdk .pag/tools/emsdk`, or the GitHub zip without git. Then `emsdk.bat install 7.0.0` and `emsdk.bat activate 7.0.0` (no `--permanent`) | `./emsdk install 7.0.0 && ./emsdk activate 7.0.0` | Same as macOS |
| 2. Environment per invocation | The wrapper sources `emsdk_env.bat` / `.ps1`, or builds the PATH itself, for each build command | `source ./emsdk_env.sh` inside the wrapper | Same |
| 3. Verify tooling | `uv venv .pag/venv`, `uv pip install playwright==1.65.2`, `python -m playwright install chromium`. Skip the download if `channel="chrome"`/`"msedge"` is installed or `CHROME_PATH` is set | Same | Same, plus `sudo python -m playwright install-deps chromium` and `apt install libvulkan1 mesa-vulkan-drivers xvfb` (ask first) |
| 4. Media tools (cutscenes) | ffmpeg static build (pinned zip + SHA-256) or `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `apt install ffmpeg` |
| Docker fallback | Only when the user already has Docker running | Same | Same |

---

## 3. Cutscenes and media (Bink, Smacker, MPEG)

- Convert at build time **on the user's machine**. Converted videos are derived game data, so the same privacy rules apply.
- **FFmpeg decodes Bink 1 (`.bik`) and Smacker (`.smk`).** It does **not** decode **Bink 2 (`.bk2`)**: trac #9954, VLC #26653; still missing from FFmpeg 9.0 coverage **[unverified for 9.0.2]**. For Bink 2, show a "cutscene skipped" card, or use the game's own skip flag. MPEG-1/2 and other old formats decode fine.
- **Target format: H.264 (yuv420p) + AAC-LC in MP4 with `+faststart`.** It plays in every engine. WebM VP9 + Opus is a smaller optional second rendition. AV1 hardware decode is uneven on Apple devices **[unverified]**. Example: `ffmpeg -i intro.bik -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart intro.mp4`. For low-resolution FMV, upscale with nearest-neighbour (`-vf scale=iw*2:ih*2:flags=neighbor`) so the browser scaler does not blur it.
- Playback: the shell overlays a `<video>` element when the lane's "play movie" hook fires. It needs a user gesture for sound; reuse the Play click. For video inside the game's frame, use `texImage2D(video)` or WebGPU `copyExternalImageToTexture`.
- **WebCodecs** (Chrome 94, Firefox 130, Safari 16.4 video / 26 audio) is only needed if a lane decodes frames itself. Not needed for the default path.

---

## 4. Storage and the bring-your-own-files design

### 4a. Two distribution modes

| Mode | What the bundle contains | Where game bytes come from | Hosting |
|---|---|---|---|
| **BYO** (default) | Shell, runtime (emulator or recompiled wasm), the **manifest of expected file names, sizes and hashes**, and converted *non-copyrighted* glue | The user's own install folder or disc image, imported in their own browser | Any static host |
| **Bundled** (private) | The above plus game files (or converted game data) | The server | Localhost, or a password-protected host only |

Recompiled code (retro-port's lane) is a derivative of the game. retro-port: "A port contains the game. Keep it private." So recompiled lanes are always Bundled/private. The BYO approach applies to emulator- and runtime-based lanes, and to recompiled lanes only if the recompiled code itself is kept private.

### 4b. Import flow (shell responsibility)

1. **Capability check.** If `showDirectoryPicker` exists (Chromium desktop, and Chrome Android 132+), offer "Choose game folder". Otherwise offer `<input type="file" webkitdirectory multiple>` (all engines; Safari iOS 18.4+, Firefox Android 142+). Always also accept a **dropped folder** (`webkitGetAsEntry`, all engines) and a **dropped zip or ISO** (the lane declares it can mount one).
2. **Identify** the game by matching relative paths and sizes against `manifest.files[]`, then SHA-256 of key files against known versions. WebCrypto `digest()` is not incremental, so hash large files **per chunk** (e.g. 8 MiB) in a worker, or use a small wasm streaming hash. Report unknown versions; do not guess.
3. **Quota.** Call `navigator.storage.estimate()`. Require free space ≥ 1.1 × the import size **[estimate]**. Call `navigator.storage.persist()` and record the result. Firefox will prompt.
4. **Copy into OPFS** from a worker using `createSyncAccessHandle` (or `createWritable`). Write to a `.part` path, then rename. Store a per-file completion marker so a refresh resumes.
5. **Mount** for the runtime. Emscripten lanes: WasmFS OPFS backend (pthreads) or `FS.mount(WORKERFS, {files})` for zero-copy read-only access. js-dos, Boxedwine and Ruffle take their own bundle or file APIs (lane-specific).
6. **Chromium extra:** keep the directory handle in IndexedDB. Later visits can re-read from the original folder without copying (`requestPermission` per session; Chrome can remember the grant). OPFS stays the portable default.

### 4c. Privacy guarantees (enforced, then verified)

- The page CSP `connect-src 'self'` stops scripts uploading to other origins. On the default local/static setup the server has no upload endpoint, so nothing can be sent to the origin either.
- **No analytics or CDN scripts.** All runtime files are self-hosted, which `require-corp` mostly forces anyway.
- `verify` (section 7) watches every network request during an import. It fails if any request carries a body, or if any non-GET goes anywhere (the private-host upload endpoint excepted).

### 4d. Saves

- Saves go to OPFS under `/saves/<game-id>/`. Emscripten lanes use WasmFS OPFS, or IDBFS with `autoPersist: true` for non-pthread builds.
- Provide **Export saves** (zip download) and **Import saves**. Browser storage is per origin and per browser, and Safari may evict it.
- On Safari, recommend **"Add to Dock"** (macOS) or **"Add to Home Screen"** (iOS), because installed web apps are exempt from the 7-day eviction.

---

## 5. Large asset delivery (multi-GB games)

### 5a. Recommended pattern

- **`game/manifest.json`**:
  ```
  {version, total_bytes, files: [{path, size, sha256,
    chunks: [{offset, size, sha256}] | null, url | null}]}
  ```
  `version` changes whenever any file changes. Only files whose hashes differ are fetched again (retro-port does the same with sizes).
- **Chunking by host limit:**
  - Cloudflare Pages / Workers static assets: 25 MiB per file, so use chunks of ≤ 24 MiB.
  - itch.io: 200 MB per file, 500 MB total, 1,000 files.
  - GitHub Pages: 100 MB per file, 1 GB per site.
  - R2: up to 5 TiB per object, and supports ranges.
  Name chunks by content (`c/ab/abcdef….bin`) and serve them with `Cache-Control: public, max-age=31536000, immutable`. Serve `index.html`, `shell.json` and `manifest.json` with `no-cache`.
- **Resumable downloads:**
  - Use `fetch` with a `Range` header into an OPFS `.part` file, verifying each chunk's hash.
  - **Do not set a `Content-Encoding` on anything fetched by range**: ranges apply to the encoded bytes.
  - For data that is already compressed (archives, audio, video) leave it as-is.
  - For compressible chunks, store them pre-compressed (gzip or deflate-raw) and decode with `DecompressionStream`, which every engine has. zstd has no `DecompressionStream` anywhere.
- **Text, JS and wasm:** serve with HTTP compression. Brotli is universal; zstd is supported everywhere only since Safari 26.3. Precompress at build time (`.br` with `-q 11`) for hosts that serve precompressed files. itch.io detects `.br` by extension and gzips `html, js, css, svg, wasm, wav, glb, pck` automatically.
- **Range support by host** (this decides the architecture):
  - Our local server and R2 support ranges.
  - **Cloudflare Workers static assets do not**: a `Range` request gets `200` with the whole file, unless a Worker (`run_worker_first`) slices `env.ASSETS.fetch()` itself (Cloudflare docs, updated 2026-11-12).
  - GitHub Pages, Netlify and Vercel are **[unverified]**. Test with a `Range` probe in `verify --remote`.

### 5b. Emscripten file-system options for game data

| Option | How | Fits | Avoid when |
|---|---|---|---|
| `--embed-file` | Data inside the wasm/JS | Tiny configs | More than a few MB |
| `--preload-file` (+ `-sLZ4`) | One `.data` package loaded into MEMFS at startup (optionally cached in IndexedDB with `--use-preload-cache`) | Under ~100-300 MB of data **[estimate]** | Large games: the whole package sits in wasm/JS memory, and a 4 GiB wasm32 address space runs out |
| `FS.createLazyFile` | Synchronous XHR per file | Workers only ("cannot work … in regular HTML pages") | Main-thread builds |
| **WasmFS fetch backend** `wasmfs_create_fetch_backend(base_url, chunk_size)` | Range-fetches chunks on demand. Needs ranges, and files must not be compressed at rest | Streaming-only play | Offline play. It cannot be created on the main thread (pthread builds) |
| **WasmFS OPFS backend** `wasmfs_create_opfs_backend()` | Persistent; sync access handles under pthreads | **Default for large games** after import or download | Non-pthread builds (handles are worker-only) |
| `WORKERFS` | Read-only `File`/`Blob` mount without copying into memory, in a worker | BYO play straight from a picked folder | Writes |
| IDBFS | MEMFS mirrored to IndexedDB with `FS.syncfs` / `autoPersist` | Saves in non-pthread builds | Big data, because it is MEMFS (in memory) |

### 5c. Service worker, PWA, offline

- The service worker caches **only the shell and runtime** (HTML, JS, wasm), versioned by content hash. Game data lives in OPFS, which is already offline-capable and has resumable writes.
- Do not put multi-GB data in the Cache API. `cache.put` cannot store `206` responses, and the data would be duplicated.
- A web app manifest gives installation: Chromium desktop and Android; Safari 17+ macOS "Add to Dock"; iOS "Add to Home Screen". Firefox desktop has no install per web-features. Installation also helps persistence: Safari exempts installed apps from eviction, and Chromium grants `persist()` more readily.
- If the shell injects COOP/COEP through `coi-serviceworker`, there must be **one** service worker. Merge the COI logic into the shell's `sw.js` rather than registering two.

---

## 6. Local serving and hosting

### 6a. Local serving

- `python -m http.server` sends **no COOP/COEP**. Python 3.12's `SimpleHTTPRequestHandler` has **no Range support** (checked in CPython 3.12 source). On Windows, `mimetypes` reads the registry, which can serve `.js` as `text/plain`. Python 3.14 added HTTPS (`--tls-cert`, `--tls-key`).
- `http-server` 14.1.1 (last release 2022) cannot set custom headers. `serve` 14.2.8 can, through `serve.json`. `vite` 8.3.8 can, through `server.headers`. `wrangler dev` emulates the Worker host.
- **Recommendation: ship a ~90-line standard-library `serve.py`.** Requirements:
  - bind `127.0.0.1` by default;
  - send COOP/COEP (switchable off for lanes that do not need it) plus `CORP: same-origin`;
  - answer `Range` with `206` and `416`;
  - use a fixed MIME map (`.wasm` → `application/wasm`, `.js` → `text/javascript`);
  - never list directories;
  - send `X-Robots-Tag: noindex`;
  - offer optional basic auth (password from an environment variable, compared with `hmac.compare_digest`).

  We built and tested a sketch on Python 3.12 (Windows) during this research: full GET 200, `bytes=100-199` → 206, open-ended and suffix ranges → 206, out of range → 416, `.wasm`/`.js` MIME correct, no-auth → 401, directory → 404. The core is a `SimpleHTTPRequestHandler` subclass that overrides `end_headers` (adds the headers), `send_head` (parses `bytes=a-b` and seeks), `copyfile` (copies only the range) and `list_directory` (404). It is served with `ThreadingHTTPServer`.
- **Secure context:** `localhost` counts as secure, but a LAN IP over plain `http://` does not. That means no SharedArrayBuffer, no WebGPU and no service worker on a phone that opens `http://192.168.x.x`. For other devices use HTTPS: a hosted copy, a `cloudflared tunnel --url` quick tunnel with the password on (retro-port does this), or a locally trusted certificate (mkcert, [unverified] for mobile trust setup).

### 6b. Hosting options

| Host | COOP/COEP headers | Per-file limit | Size / file-count limits | Range on static files | Access control | Bundled game data? | BYO shell? |
|---|---|---|---|---|---|---|---|
| **Localhost** (`serve.py`) | Yes | None | None | Yes | Loopback only (optional basic auth) | **Yes (default)** | Yes |
| **Cloudflare Worker + R2** (retro-port pattern) | Yes (the Worker sets them) | R2 object 5 TiB; single PUT 5 GiB; multipart 4.995 TiB | None in practice | Yes (R2; the Worker passes ranges through) | Worker **HTTP basic auth** (secret), or **Cloudflare Access**: free plan for teams under 50 users; covers `workers.dev`, preview and version URLs | **Yes, with a password** | Yes |
| Cloudflare Pages | Yes, `_headers` (≤ 100 rules, ≤ 2,000 characters per line) | **25 MiB** | 20,000 files (Free) / 100,000 (paid) | [unverified] | Cloudflare Access | Only behind Access | Yes |
| Cloudflare Workers static assets | Yes (`_headers` or Worker) | **25 MiB** | 20,000 / 100,000 files per version | **No** (returns 200 with the full file) | Access on `workers.dev` | Only behind Access | Yes |
| **GitHub Pages** | **No** (use coi-serviceworker) | 100 MB (git limit) | Site ≤ 1 GB; 100 GB/month soft bandwidth; deploy timeout 10 min; 10 builds/hour soft limit | [unverified] | None for public repos (private Pages is a paid-plan feature) | **No** | Yes |
| **itch.io** HTML5 | Only through the "SharedArrayBuffer support" toggle, which sends COOP `same-origin` + COEP **`credentialless`**: **broken in Safari** | **200 MB** | 500 MB extracted, **1,000 files**, paths ≤ 240 characters, ZIP only, case-sensitive paths | [unverified] | Draft (owners + secret link), **Restricted + "allow a password to view page"**, download keys | **No** (itch is a distribution platform: you must hold the rights) | Yes, if the uploaded shell is your own work. Needs `needs_coi: false` for Safari |
| Netlify | Yes, `_headers` / `netlify.toml` | Not documented [unverified] | 54,000 files per directory | [unverified] | Site password = **Pro** plan; basic auth via headers = Pro (sources conflict) | Behind a password only | Yes |
| Vercel | Yes, `vercel.json` headers | n/a | CLI upload: 100 MB of source (Hobby) / 1 GB (Pro); 15,000 files per CLI deployment | [unverified] | "Vercel Authentication" (team members) is free; **Password Protection is not available on Hobby** (paid add-on on Pro) | Behind authentication only | Yes |
| Self-host (Caddy/nginx) | Yes | None | None | Yes | Basic auth over HTTPS, mTLS, or a VPN (e.g. Tailscale) | Yes, with auth | Yes |

---

## 7. Automated verification

### 7a. Browser launch matrix

Default runner: **Playwright for Python 1.65.x** in sync mode.
- Prefer the user's installed **Chrome or Edge** (`channel="chrome"` / `"msedge"`) when present. It is the browser they will actually play in, and it saves a 281 MB download.
- In Claude Code web, use `executable_path=os.environ["CHROME_PATH"]`.
- Otherwise use Playwright's Chromium. Its default headless mode is `chromium-headless-shell`; `channel="chromium"` selects the newer headless mode, which is closer to real Chrome.
- Since Playwright 1.57 the Chromium builds are Chrome for Testing.

| Host | WebGL lanes | WebGPU lanes | Flags |
|---|---|---|---|
| Windows (desktop session) | Headless is fine (ANGLE D3D11) | Rendering works headless, **but screenshots come out black**. Run **headed** in an interactive session; from ssh or a service, schedule it on the desktop with `schtasks /IT` (agent-browser docs) | `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`; no WebGPU flag needed |
| macOS | Headless | **Headless works** (Metal) | Same |
| Linux with a supported GPU | Headless | Hardware: Intel Gen12+, or NVIDIA on Wayland. Other GPUs: `--enable-unsafe-webgpu --use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE` (from the gpuweb wiki) | Screenshots need headed mode (Xvfb on servers) |
| Linux CI / cloud sandbox, no GPU | `--use-angle=swiftshader --enable-unsafe-swiftshader` (automatic SwiftShader fallback is deprecated) | `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader --disable-vulkan-surface`. Needs `libvulkan1 mesa-vulkan-drivers`. Screenshots: run **headed** under `xvfb-run` | Expect 5-20 fps for 3D **[estimate]**; frame-rate thresholds become warnings |
| Firefox (Playwright build, Firefox 159) | All OSes | Windows and Apple-silicon macOS only. On Linux, test with the prefs `dom.webgpu.enabled` and `gfx.webgpu.ignore-blocklist` (expected to fail) | Mark as "unsupported" rather than "fail" when the capability check says so |
| WebKit (Playwright build, WebKit 27.2) | Smoke test only; **not Safari** | Unknown on Windows/Linux **[unverified]** | Real Safari: macOS `safaridriver` + WebDriver (optional, manual-assisted) |

### 7b. Verify steps

`pag verify <dist> [--browser chromium|firefox|webkit|all] [--remote URL]`

1. **Static checks (no browser):**
   - `shell.json` is valid against the schema;
   - every manifest file exists and its size and SHA-256 match;
   - no file exceeds the target host's limits (25 MiB, 200 MB, 1,000 files...);
   - `_headers` is present when `needs_coi`;
   - license notices for bundled runtimes;
   - when the target is **public**, fail if `source == "bundled"` or any game-data file is present.
2. **Serve and probe:**
   - start `serve.py` on a free loopback port (or use `--remote`);
   - `HEAD /` must return COOP/COEP when `needs_coi`;
   - `GET` with `Range: bytes=0-15` on a large asset must return `206` with the right length;
   - remote with a password: no credentials must give `401`.
3. **Launch and environment check** (`page.evaluate`):
   - `crossOriginIsolated === needs_coi`;
   - `WebAssembly.validate` probes for the features the lane needs (threads, SIMD, exceptions, JSPI);
   - `(await navigator.gpu?.requestAdapter())` is non-null if `requires.webgpu` (retry 3× for cold start, as agent-browser does); record `adapter.info` and `info.isFallbackAdapter`;
   - a `webgl2` context can be created if `requires.webgl2`.
   Any failure here is an **"unsupported environment"**, not a lane failure.
4. **Instrument** with init scripts added before any page script:
   - console capture plus `pageerror`, `requestfailed` and response status logging;
   - an **audio tap**: patch `AudioNode.prototype.connect` so anything connected to an `AudioDestinationNode` also feeds a per-context `AnalyserNode`;
   - an optional **fake standard gamepad**: override `navigator.getGamepads` and dispatch `gamepadconnected`;
   - in `?verify=1` mode, force `preserveDrawingBuffer: true` on WebGL contexts so in-page readback works.
5. **Load:**
   - open `index.html?verify=1`;
   - for BYO lanes, inject the test fixture files with `set_input_files` on the shell's hidden `webkitdirectory` input (Playwright supports directory upload);
   - wait for `__shell.state === "ready"`: timeout 120 s on first run (includes import/download), 30 s when cached.
6. **User gesture:** `click` the Play button (a trusted input, so it grants user activation). Then wait for `__shell.state === "running"`.
7. **Run and measure for 10 s:**
   - rAF frame times measured in the page (median fps, p95 frame time);
   - `__shell.stats.gameFrames` delta (the lane reports its own frame counter);
   - long tasks;
   - 10 frame samples at 0.5 s intervals, each downscaled in the page to 64×48 to compute mean luminance, standard deviation and the share of near-black pixels, plus one full Playwright screenshot of the canvas as an artifact.
8. **Input:**
   - press the lane's `verify.inputs` script (default: `Enter`, `Space`, the arrow keys, `Escape`) with `page.keyboard` using `KeyboardEvent.code`-correct keys;
   - set fake-gamepad button 0 and the left stick;
   - move the mouse.
   Assert that `__shell.stats.inputEvents` increased **and** the picture changed (mean absolute frame difference above the threshold) within 3 s.
9. **Audio:**
   - `AudioContext.state === "running"` within 1 s of the click;
   - analyser RMS sampled for 3 s.
10. **Save round-trip:**
    - `await __shell.storage.selfTest()` writes `/saves/.verify` with a random token and closes it;
    - reload the page;
    - read the token back;
    - also call the lane's `saveNow()` if it provides one;
    - record `navigator.storage.persisted()` and `estimate()`.
11. **Soak and memory:**
    - run 60 s (120 s for the release gate);
    - sample wasm memory (`__shell.stats.wasmBytes`) and the JS heap (CDP `Performance.getMetrics`, Chromium only) every 10 s;
    - `performance.measureUserAgentSpecificMemory()` once (Chromium, needs isolation).
12. **Privacy check** (BYO lanes): during steps 5-10, no request may carry a body or go to another origin.
13. **Report:** write `verify/report.json`, with a screenshot per step, `console.log`, a video (Playwright 1.64+ records VP9 at a chosen fps), the adapter info and a summary line the agent can relay.

### 7c. Pass/fail thresholds (initial values, to be tuned per lane in `shell.json`)

| Check | Pass | Warn | Fail |
|---|---|---|---|
| Page errors | 0 `pageerror`; 0 console errors matching fatal patterns (`Aborted(`, `RuntimeError`, `unreachable`, `out of memory`, `device lost`, `CONTEXT_LOST_WEBGL`, `SharedArrayBuffer is not defined`) | Other console errors | Any fatal error |
| Bundle requests | All own-origin requests return 2xx/206/304 | | Any 404/5xx on bundle files |
| Ready time | ≤ 15 s cached; first run reported in MB/s | 15-45 s cached | Timeout (120 s first run / 30 s cached) |
| Black frame | A frame counts as **blank** if ≥ 98% of pixels have luma < 8/255 or the luma standard deviation is < 2 | 1-3 of 10 samples blank (fades, loading) | All samples after "running" are blank |
| Frozen picture | Mean absolute difference between consecutive samples ≥ 0.5/255 somewhere in the window, **or** a change within 3 s after input | Static without input but changes after input (title screen) | No change across the window **and** none after input, while rAF keeps running |
| Main loop alive | `gameFrames` increases | | `gameFrames` stalls for > 2 s, or rAF stops |
| Frame rate (hardware GPU) | Game fps ≥ 0.9 × lane target (default 60; 30 or 35 for old games); rAF median ≥ 55 | Game fps ≥ 0.5 × target; p95 frame time > 50 ms | < 0.5 × target |
| Frame rate (SwiftShader / CI) | Recorded only | < 10 fps | Not judged |
| Input | `inputEvents` increased **and** the picture or state changed | Events counted but no visible change | No events reach the lane |
| Audio | Context `running` and peak RMS ≥ 0.001 (-60 dBFS) in 3 s | Running but silent (the lane may declare `audio_on_title: false`) | Context never runs after the click, or the AudioWorklet fails to load |
| Save | Token round-trips across a reload | `persisted()` is false | Token lost |
| Memory | Peak wasm < 0.8 × `MAXIMUM_MEMORY`; < 1 GB if the lane claims iOS support **[estimate]**; growth in the soak < 5%/min | Growth 5-10%/min | OOM, or growth > 10%/min |
| Privacy (BYO) | 0 requests with a body; 0 cross-origin requests | | Any |

Some things cannot be automated: real controller hardware and rumble feel, pointer-lock feel (headless pointer lock may reject, so record a warning), audio quality and latency, input latency, and Safari on iOS. The agent asks the user to do a **2-minute manual check** with a short checklist before it calls the port "working on device X".

### 7d. MCP and agent tooling (interactive debugging only)

| Tool | Version | Use | Notes |
|---|---|---|---|
| Playwright MCP (`npx @playwright/mcp@latest`) | 0.0.85 (2026-11-09) | Let the agent click around and inspect when `verify` fails | Options include `--headless`, `--browser chrome\|firefox\|webkit\|msedge`, `--caps vision,devtools`, `--isolated`, `--init-script`, `--console-level`, `--output-dir`. Microsoft now recommends **playwright-cli + skills** for coding agents because it uses fewer tokens (Homebrew `playwright-cli` 0.1.24) |
| Chrome DevTools MCP (`npx -y chrome-devtools-mcp@latest`) | 1.13.0 (2026-11-11) | Performance traces, console with source-mapped stacks, network inspection | Officially supports Chrome and Chrome for Testing only. **Sends usage statistics by default** (turn off with `--no-usage-statistics`, or set `CI`), and its performance tools may send trace URLs to CrUX (turn off with `--no-performance-crux`). Use both flags so nothing about a private port leaves the machine |
| agent-browser | n/a | Has a WebGPU preset and a `doctor --webgpu` probe | Useful reference for flags and pitfalls; not required |

---

## 8. The tool's own runtime for cross-OS scripts

| | Python 3.10+ standard library (+ uv bootstrap) | Node 22+ (npx) | Bun 1.4 | Deno 2.9 |
|---|---|---|---|---|
| Pre-installed: Windows | No (Store stub only) | No | No | No |
| Pre-installed: macOS | CLT `python3` (probably 3.9, too old **[unverified]**) | No | No | No |
| Pre-installed: Linux desktops | Yes (Ubuntu 22.04+ / Debian 12+ meet 3.10) | No | No | No |
| Claude Code web | Yes (with uv) | Yes (22) | Yes, with proxy issues | No |
| Codex cloud | Yes, 3.10-3.14 (with uv) | Yes (22) | 1.2.x | No |
| Already required by the toolchain? | **Yes**: Emscripten needs Python ≥ 3.10, and emsdk bundles Python on Windows/macOS | emsdk bundles a Node; Playwright Test, MCP servers and wrangler need Node | No | No |
| Playwright | Official Python package; ships its own driver, so **no separate Node install** | Official and most complete (test runner, MCP) | The test runner runs under `--bun` since 1.65 (with caveats) | Via npm compatibility **[unverified]** |
| One-command bootstrap without admin | `uv` (one binary; `uv python install`) | Portable zip possible, but no standard bootstrapper | Installer script | Installer script |
| Fit for writing to OPFS, hashing, zip, HTTP server | stdlib: `hashlib`, `zipfile`, `http.server`, `json`, `urllib` | Built in | Built in | Built in |

**Recommendation: Python.**
- All helper scripts (`doctor`, `setup`, `serve`, `pack`, `manifest`, `verify`) use the **Python 3.10+ standard library only**, run as `python -I <script>`, with **one third-party dependency, Playwright, installed in `.pag/venv`** and used only by `verify`.
- Bootstrap Python with **uv** when the host has none or an old one: Windows always, macOS usually.
- Node is optional. It is used only for npx MCP servers and `wrangler` deploys, and may come from emsdk's bundled `node/` directory to avoid a second install.
- Why: Python is the one runtime the Emscripten lanes need anyway. Both agent clouds have it. retro-port, the closest prior art, already uses Python `serve.py` and `make_dist.py`. And Playwright for Python removes the need for Node in the verify path.

---

## 9. RECOMMENDATION

### 9a. The shared "web shell" every lane outputs

```
dist/
  index.html              Shell page: canvas, Play button, progress, error panel. No inline scripts (CSP)
  shell.json              Lane contract (below)
  shell/shell.js          Lifecycle, capability checks, UI, error explainer, window.__shell
  shell/loader.js         Manifest, resumable Range downloads, per-chunk SHA-256, OPFS writer (worker)
  shell/import.js         BYO: directory picker / webkitdirectory / drag-and-drop, identification, copy to OPFS
  shell/storage.js        OPFS + IndexedDB helpers, persist(), estimate(), save export/import, selfTest()
  shell/input.js          KeyboardEvent.code mapping, game-key preventDefault, gamepad polling (standard mapping), rumble,
                          pointer lock (unadjustedMovement fallback), Keyboard Lock in Chromium fullscreen, optional touch overlay
  shell/audio.js          One AudioContext; resume on Play; visibility suspend/resume; master gain; ?mute; iOS audioSession
  shell/video.js          <video> overlay for converted cutscenes
  shell/sw.js             Caches shell + runtime by hash; optional COI header injection (merged coi-serviceworker logic)
  runtime/<lane>/...      Lane payload: game.js + game.wasm, js-dos bundle, Boxedwine files, Ruffle, ...
  game/manifest.json      {version, source: "byo"|"bundled", total_bytes, files:[{path,size,sha256,chunks?}]}
  game/...                Bundled (private) builds only
  _headers                Netlify / Cloudflare Pages format (also read by serve.py)
  robots.txt              "Disallow: /" for private builds
  LICENSES/               Runtime licences and source links (GPL runtimes)
```

`shell.json` (lane contract, illustrative):

```json
{
  "schema": 1, "game_id": "example", "lane": "emscripten-recomp",
  "entry": {"module": "runtime/game.js", "export": "createModule", "wasm": "runtime/game.wasm"},
  "requires": {"webgpu": true, "webgl2": false, "threads": true, "simd": true, "jspi": false, "memory64": false},
  "needs_coi": true,
  "memory": {"initial_mb": 256, "maximum_mb": 2048},
  "data": {"mode": "byo", "manifest": "game/manifest.json", "mount": "/game", "saves": "/saves/example"},
  "input": {"keyboard": true, "mouse": "relative", "gamepad": "standard", "touch": false},
  "video": {"aspect": "4:3", "scaling": "integer-or-fit"},
  "verify": {"target_fps": 30, "inputs": ["Enter", "Enter", "ArrowDown", "Space"], "audio_on_title": true,
             "budget_ready_s": 15}
}
```

**Runtime API** (what `verify` and lanes rely on):
- `window.__shell.state` is one of `boot | checking | needs-files | importing | downloading | ready | running | paused | error`. Every change fires a `shell:state` event.
- `__shell.stats` holds `{rafFrames, gameFrames, inputEvents, wasmBytes, audioRms?, lastError}`.
- `__shell.storage.selfTest()`, `__shell.debug.captureFrame()` (the lane may override it, e.g. WebGPU readback) and `__shell.lane` (the adapter).
- **Lane adapter interface:** `{ id, async start(ctx), pause(), resume(), saveNow?(), onInput?(ev), frameCounter() }`. `ctx` gives the canvas, the mount points, `audio.context`, `reportFrame()`, `reportError()` and `locateFile()`.
- An Emscripten lane is built with `-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker`. It uses `-pthread -sPROXY_TO_PTHREAD -sWASMFS` when `needs_coi`, `--use-port=emdawnwebgpu` or WebGL2, and `-sJSPI` (Baseline) or `-sASYNCIFY` (to support Safari < 27).

**Headers** (`_headers`, applied identically by `serve.py`, the Worker and static hosts):

```
/*
  Cross-Origin-Opener-Policy: same-origin          # only when needs_coi
  Cross-Origin-Embedder-Policy: require-corp       # only when needs_coi (never credentialless)
  Cross-Origin-Resource-Policy: same-origin
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow                  # private builds
/index.html
  Cache-Control: no-cache
/shell.json
  Cache-Control: no-cache
/game/manifest.json
  Cache-Control: no-cache
/runtime/*
  Cache-Control: public, max-age=31536000, immutable   # content-hashed file names
```

Some runtimes need `'unsafe-eval'` (for example Emscripten with dynamic execution, or emulators that generate JS). The lane must declare it, and `verify` then reports the relaxation.

### 9b. Cross-OS build-host strategy

1. `pag doctor` detects OS, CPU (x64/arm64), Python, uv, git, Docker, installed Chrome/Edge/Firefox, GPU adapter class (via a one-off headless probe), free disk space, and whether this is an agent sandbox (`CLAUDE_CODE_*`/`CODEX_*` environment variables, `CHROME_PATH`).
2. `pag setup` installs **project-local, pinned** tools with check-then-act steps (section 2d). Defaults:
   - emsdk 7.0.0 native on all three OSes;
   - WSL2 only for bash-heavy source ports on Windows;
   - Docker only as a fallback when native install fails or the user prefers it;
   - Windows ARM64: x64 emsdk under emulation, or WSL2 arm64 **[unverified]**.
3. Admin-level steps (apt packages, Vulkan/Xvfb, Playwright `install-deps`) are **proposed, never silently run**.
4. All lanes build into `build/<lane>/` and then `pag pack` produces `dist/` in the section 9a layout. The packer computes the manifest, chunking, content hashes, `_headers` and precompression.

### 9c. Verify recipe

Run `pag verify dist --browser chromium` on every build. Before telling the user it works, also run `--soak 120`. When the lane claims Firefox or WebKit support, add `--browser all`. When a hosted copy exists, add `--remote <url>` (checks headers, Range, auth and the privacy rule over the real network). Use the thresholds in 7c. Hand the report summary and screenshots to the user, plus the 2-minute manual checklist for the things that cannot be automated.

### 9d. Hosting policy

| Build | Allowed | Not allowed |
|---|---|---|
| **Bundled** (any game bytes, converted assets, or recompiled code) | Localhost (`serve.py`, the default); the user's own Cloudflare Worker + R2 with **basic auth or Cloudflare Access**, deployed with explicit approval; self-hosted HTTPS with auth; temporary `cloudflared` quick tunnel **with the password on**, shut down afterwards | Any public URL; itch.io, GitHub Pages, public Pages/Netlify/Vercel. An unguessable URL is not access control (retro-port's rule) |
| **BYO shell** (no game bytes; manifest holds only names, sizes and hashes) | Any static host. Pick by `needs_coi`: GitHub Pages + coi-serviceworker; Cloudflare Pages/Netlify with `_headers`; itch.io (best with `needs_coi: false`, because of Safari) | Shipping anything extracted from the user's files; analytics or third-party scripts |
| Always | `robots.txt` disallow plus `X-Robots-Tag: noindex` on private hosts; license files and source links for GPL runtimes when hosting publicly | Deploys, uploads or tunnels without asking the user each time |

---

## 10. Open risks

1. **WebGPU coverage gaps.**
   - Linux Chrome supports only Intel Gen12+ and NVIDIA on Wayland. AMD and X11 users need flags.
   - Linux and Android Firefox have no WebGPU.
   - Safari needs macOS/iOS 26.
   - A D3D→WebGPU lane (retro-port) is therefore effectively "Chrome/Edge on Windows/macOS/ChromeOS, plus Safari 26". A WebGL2 backend would widen this, but costs effort in the lane.
2. **Headless capture of WebGPU** is black on Windows and Linux. Verify depends on headed sessions or lane-provided readback. On Windows an interactive desktop session is required, which is awkward from remote agents.
3. **Safari eviction and quotas.** Whether OPFS is covered by the 7-day proactive eviction is unverified, so recommend installing the web app. iOS memory limits are unpublished.
4. **Cross-origin isolation friction.** `credentialless` is still missing in Safari (itch.io breaks there). coi-serviceworker has been unmaintained since 2023 and needs a reload on the first visit. Chrome's `Document-Isolation-Policy` (137+) is Chromium-only.
5. **Host Range behaviour** is unverified for GitHub Pages, Netlify, Vercel and Cloudflare Pages, and Workers static assets do not support it. The loader must fall back to whole-file downloads in small chunks.
6. **Bink 2 cutscenes** cannot be converted with FFmpeg. Smacker and Bink 1 can.
7. **Windows ARM64 build hosts** have no first-class emsdk. Prism emulation performance and WSL2 arm64 are untested.
8. **Emscripten churn.** Upgrades are ABI-breaking (7.0.0 brought libc++ 23 include changes and new minimum browser versions). Pin the version per port, and upgrade deliberately.
9. **Playwright WebKit is not Safari,** and iOS cannot be automated from Windows or Linux at all. Claims of "works on iPhone" must come from a manual check.
10. **Privacy of debugging tools.** Chrome DevTools MCP sends usage statistics and CrUX lookups by default. Hosted crash or telemetry services would leak paths and game names. Keep everything local by default.
11. **Licensing.** GPL runtimes (js-dos, DOSBox, ScummVM, Boxedwine) in a publicly hosted BYO shell trigger source-offer obligations. Converted or recompiled data is a derivative of the game: private only. Sibling note 04 covers the legal side.
12. **Agent sandboxes** have no GPU and restricted networks. Claude Code web's "Limited" network may block Playwright's browser CDN, so use the bundled Chrome for Testing (`CHROME_PATH`). Codex has internet only in the setup script, so install browsers there.

---

## Sources

All accessed 2026-11-17. Where a page shows its own date, it is given.

- MDN browser-compat-data 8.1.9 (npm; parsed locally): https://unpkg.com/@mdn/browser-compat-data@8.1.9/data.json
- web-features 3.46.0 (npm; Baseline dates, browser release dates): https://unpkg.com/web-features/data.json
- gpuweb Implementation Status wiki (edited 2026-05-28): https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
- Chrome "New in WebGPU 147-148" (2026-04-22) and "155-156": https://developer.chrome.com/blog/new-in-webgpu-147-148 ; https://developer.chrome.com/blog/new-in-webgpu-155-156 ; 144 (2026-01-07): https://developer.chrome.com/blog/new-in-webgpu-144
- web.dev "WebGPU is now supported in major browsers": https://web.dev/blog/webgpu-supported-major-browsers
- WebKit "News from WWDC26: WebKit in Safari 27 beta" (JSPI): https://webkit.org/blog/17967/
- WebKit blog feed (Safari 27.1/27.2 features, STP 253-256, Sept-Nov 2026): https://webkit.org/feed/
- SpiderMonkey "Is Memory64 actually worth using?" (2025-01-15): https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html
- V8 `wasm-limits.h` (main): https://chromium.googlesource.com/v8/v8/+/main/src/wasm/wasm-limits.h ; V8 "Up to 4GB of memory in WebAssembly": https://v8.dev/blog/4gb-wasm-memory
- MDN "Storage quotas and eviction criteria" (modified 2026-01-05): https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- WebKit ITP / 7-day storage cap and Home Screen exemption: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ ; https://bugs.webkit.org/show_bug.cgi?id=237350
- Emscripten ChangeLog (7.0.0, 2026-11-06, back to 4.0.x): https://github.com/emscripten-core/emscripten/blob/main/ChangeLog.md (fetched via jsDelivr)
- emsdk README and docker/README: https://github.com/emscripten-core/emsdk
- Emscripten docs, Download and install: https://emscripten.org/docs/getting_started/downloads.html
- Emscripten docs, File System API, Packaging Files, Pthreads, Asyncify/JSPI: https://emscripten.org/docs/api_reference/Filesystem-API.html ; https://emscripten.org/docs/porting/files/packaging_files.html ; https://emscripten.org/docs/porting/pthreads.html ; https://emscripten.org/docs/porting/asyncify.html
- Emscripten `wasmfs.h` (fetch and OPFS backends): https://github.com/emscripten-core/emscripten/blob/main/system/include/emscripten/wasmfs.h
- Docker Hub `emscripten/emsdk` tags API: https://hub.docker.com/r/emscripten/emsdk
- emsdk Windows ARM64 commit #1186: https://skia.googlesource.com/external/github.com/emscripten-core/emsdk/+/7bcf1449c06ea32784c5621f3c91e10859956eee%5E%21/
- Homebrew formula API (emscripten, uv, node, ffmpeg, playwright-cli): https://formulae.brew.sh/
- Debian sources, emscripten package: https://sources.debian.org/src/emscripten/
- Playwright release notes (1.65: Bun, Node 22/24/26, Chromium 158 / Firefox 159 / WebKit 27.2; 1.64: video fps, WebMCP): https://playwright.dev/docs/release-notes
- Playwright Browsers (headless shell, `--only-shell`, disk sizes) and Installation (system requirements): https://playwright.dev/docs/browsers ; https://playwright.dev/docs/intro
- Playwright "Changes in Chromium headless in v1.49": https://github.com/microsoft/playwright/issues/33566
- npm registry: playwright 1.65.1, @playwright/mcp 0.0.85, chrome-devtools-mcp 1.13.0, serve 14.2.8, http-server 14.1.1, vite 8.3.8, wrangler 4.163.0, coi-serviceworker 0.1.7: https://registry.npmjs.org/
- PyPI playwright 1.65.2: https://pypi.org/project/playwright/
- Playwright MCP README: https://github.com/microsoft/playwright-mcp
- Chrome DevTools MCP README: https://github.com/ChromeDevTools/chrome-devtools-mcp
- Chromium "Using Chromium with SwiftShader" (main): https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
- Chrome for Developers "Supercharge Web AI model testing: WebGPU, WebGL, and Headless Chrome": https://developer.chrome.com/blog/supercharge-web-ai-testing
- agent-browser WebGPU guide (headless capture limitation, Linux flags): https://agent-browser.dev/webgpu
- coi-serviceworker README: https://github.com/gzuidhof/coi-serviceworker
- Cloudflare Pages limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Workers limits and Static Assets billing/limitations (Range note; updated 2026-11-12): https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare R2 limits: https://developers.cloudflare.com/r2/platform/limits/
- Cloudflare Pages `_headers`: https://developers.cloudflare.com/pages/configuration/headers/
- Cloudflare workers.dev with Access: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- Cloudflare Access (free plan for teams under 50 users): https://www.cloudflare.com/products/zero-trust/access/
- itch.io HTML5 docs (500 MB, 200 MB, 1,000 files, compression): https://itch.io/docs/creators/html5 ; Access control (Restricted + password): https://itch.io/docs/creators/access-control
- itch.io "Experimental SharedArrayBuffer support" thread (COEP credentialless; Safari reports): https://itch.io/t/2025776/experimental-sharedarraybuffer-support
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Netlify custom headers, deploy overview (54,000 files per directory), password protection KB: https://docs.netlify.com/manage/routing/headers/ ; https://docs.netlify.com/deploy/deploy-overview/ ; https://www.netlify.com/knowledge-base/how-to-password-protect-a-netlify-site-or-deploy-previews/
- Vercel limits and Password Protection: https://vercel.com/docs/limits ; https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection
- Claude Code cloud environments (installed tools, resource limits, network levels): https://code.claude.com/docs/en/cloud-environments
- OpenAI codex-universal README and Dockerfile: https://github.com/openai/codex-universal ; Codex cloud environments: https://developers.openai.com/codex/cloud/environments
- retro-port README, references/web.md, references/hosting.md, template/play.sh: https://github.com/Dhaiwat10/retro-port
- FFmpeg Bink 2 ticket #9954 and VLC issue #26653: https://trac.ffmpeg.org/ticket/9954 ; https://code.videolan.org/videolan/vlc/-/issues/26653 ; FFmpeg 9.0 coverage: https://www.phoronix.com/news/FFmpeg-9.0-Released
- Python `http.server` docs (3.14 HTTPS options): https://docs.python.org/3/library/http.server.html ; CPython 3.12 `Lib/http/server.py` (no Range handling; checked locally)
