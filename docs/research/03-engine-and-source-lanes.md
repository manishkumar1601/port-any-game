# 03 — Engine-specific and source-based lanes (browser targets)

Research note for the planned **port-any-game** skill/plugin.
Snapshot date: **2026-11-17**. Scope: games that already are web tech, engines whose browser runtime can load the original game data, open-source reimplementations with working browser builds, and porting from source.
Out of scope (covered by other notes): generic binary lanes (DOS emulation, Boxedwine, v86, CheerpX, static recompilation as in `Dhaiwat10/retro-port`, cloud streaming).

**Confidence tags used below**

- **[V]** verified this session against a primary source (project repo, release feed, official docs) fetched on 2026-11-17.
- **[R]** reported by secondary sources (news, forums, third-party docs). Probably right, not checked at the source.
- **[U]** unverified: my own inference or prior knowledge. The agent should test before relying on it.

Version and date figures come from GitHub release/tag feeds read on 2026-11-17 unless noted. The GitHub REST API was rate-limited during this session, so a few licenses are from repo pages or prior knowledge and are tagged.

---

## TL;DR

1. **Cheapest wins come first, and they are common.** NW.js/Electron games (RPG Maker MV/MZ, Construct, GDevelop, Phaser/Pixi, Twine) are already HTML5. The agent only extracts (`package.nw`, `app.asar`, `www/`), stubs Node/Steam APIs, fixes path case, and serves. Expect >85% success in minutes to hours.
2. **"Engine runtime plus original data" is the next tier, and it is mature for a known set of engines.** EasyRPG Player (RM2000/2003), ScummVM (Emscripten target in-tree; 2026.4.0 added more than 140 Wintermute games), Ruffle (Flash; AVM1 99%/82%, AVM2 90%/82% language/API), the mkxp-z libretro core (RGSS XP/VX/VX Ace), AGS web engine, dirplayer-rs (Shockwave), Butterscotch Web (GameMaker 1.4 bytecode-16 games only), and the Doom/Quake/Half-Life WASM source ports.
3. **"Rebuild with the engine's own toolchain without decompiling code" is a third tier.** Ren'Py (put the shipped `game/` folder into a matching Ren'Py SDK and use "Web (Beta)"; `.rpyc`/`.rpa` run without `.rpy`), LÖVE (`.love` extracted from the fused exe into love.js; no LuaJIT FFI), Java (CheerpJ 5.0 runs unmodified jars, including LWJGL2 via gl4es), and Godot (try feeding the shipped `.pck` to a same-version web template; fall back to GDRE Tools project recovery).
4. **Decompile-and-rebuild lanes are expensive and legally sensitive.** XNA/FNA (ILSpy, then FNA-WASM-Build; Celeste and Terraria precedent at about 600 MB RAM), Unity Mono (AssetRipper 2.0 project, then a Unity Web build; rarely realistic), Unity IL2CPP and Unreal (effectively **no** engine lane, so route to streaming or binary lanes), Clickteam, Visionaire and PICO-8 binaries (need the original project; otherwise hand to binary lanes).
5. **Reimplementations: a surprising number now ship or have working web builds.** OpenTTD, fheroes2, Julius/Augustus, OpenLara, Jazz² Resurrection, isle-portable (LEGO Island), fallout2-ce (roginvs fork), Xash3D-FWGS (Half-Life/CS), ioquake3, Chocolate-Doom wasm, Quake/Quake 2 WASM, diabloweb (Diablo), and third-party OpenXcom/OpenRCT2 sites. The 2026 norm is **"bring your own data"**: the engine is hosted and the user drops their own files, which are cached in IndexedDB or OPFS.
6. **The source-port toolchain moved in 2026.** Emscripten **7.0.0** (2026-11-06) is current. **JSPI is no longer experimental** (Emscripten 6.0.8). Chrome has shipped it since 137 and Firefox planned it for 153; Safari is unclear, so keep an ASYNCIFY fallback. The SDL3 port is no longer experimental. `SOCKET_WEBRTC` was removed. libc++ 23 dropped transitive includes, which breaks old code. WebGPU goes through the `emdawnwebgpu` port.
7. **AI-agent source ports are now routine (precedent).** Rosebud ported GZDoom with agents (April 2026; music still broken). levels.io ported RTCW with multiplayer in about an hour using iortcw, Emscripten and gl4es (November 2026). Expect the same failure points: threading model, input under `PROXY_TO_PTHREAD`, GL translation, audio middleware, and stack size.
8. **Legal posture should be fixed per lane.** Never redistribute game data. Host locally or privately by default. Prefer lanes that need no decompilation. Treat decompile lanes (Unity, .NET, Godot scripts, Fusion, GameMaker) as "user's own copy, personal interoperability use, warn first". EULAs that ban reverse engineering have been enforced in the US (Bowers v. Baystate, Blizzard v. bnetd). The EU Software Directive Art. 6 interoperability right cannot be contracted away, but it is narrow.

---

## 1. Master lane table

Effort is the expected agent wall-clock time with a capable build host. Odds are my estimates for reaching a playable result (boot, input, audio, save) for a typical title in that lane. Both are **[U]** judgments based on the evidence below.

| ID | Engine / format | Detect by (fingerprint) | Browser runtime (current) | Needs source? | Runtime license | Maturity (2026-11) | Effort | Success odds |
|---|---|---|---|---|---|---|---|---|
| W1 | NW.js-wrapped HTML5 (RPG Maker MV/MZ, Construct 2/3 ≤r449, generic) | `nw.dll`, `nw_elf.dll`, `package.nw` (folder or zip), zip appended to exe, `package.json` with `window`/`chromium-args`; MV: `www/js/rpg_core.js`; MZ: `js/rmmz_core.js`; Construct: `c2runtime.js` / `c3runtime.js` | The browser itself | No | n/a (game JS); NW.js MIT | Production | 0.5–4 h | 85–95% |
| W2 | Electron-wrapped HTML5 (GDevelop, Phaser/Pixi, Construct) | `resources/app.asar` or `resources/app/`, `v8_context_snapshot.bin`, `LICENSES.chromium.html`; GDevelop: `gdjs`/`runtimegame` files | Browser + shims | No | Electron MIT; `@electron/asar` MIT | Production | 1–8 h | 75–90% (lower with native `.node` modules) |
| W3 | Other web wrappers (WebView2, CEF, Tauri) and loose HTML (Twine) | `WebView2Loader.dll` + html folder; `libcef.dll`; Twine `tw-storydata` in a single html file | Browser | No | n/a | Production | <1–4 h | 85–95% |
| E1 | RPG Maker 2000/2003 | `RPG_RT.exe`, `RPG_RT.ldb`, `RPG_RT.lmt`, `Map*.lmu`, `Harmony.dll` | EasyRPG Player web (Emscripten) | No | GPL-3.0 [V] | Mature; 0.8.1.1 (2025-06-01) [V] | 1–3 h | 85–95% |
| E2 | RPG Maker XP / VX / VX Ace (RGSS1/2/3) | `Game.exe` + `Game.ini` (`Library=RGSS1xx/2xx/3xx.dll`), `Game.rgssad`/`.rgss2a`/`.rgss3a`, `Data/Scripts.rxdata`/`.rvdata`/`.rvdata2` | mkxp-z libretro core built with Emscripten (RetroArch web player / Nostalgist.js); older mkxp-web (mruby, XP only) | No | GPL-2.0 [V] | Beta: proposed as mkxp-z PR #255; core documented by libretro [V] | 2–8 h | 55–75% (Win32API and DLL-plugin games fail) |
| E3 | Ren'Py | `renpy/`, `lib/py*-*`, `game/*.rpa`, `game/*.rpyc`, `<name>.py` launcher | Ren'Py's own Emscripten web build (launcher "Web (Beta)") | Project folder; `.rpy` not required [U] | MIT (engine) | Web is officially "Beta"; Ren'Py 8.6.0 (2026-11-15) [V] | 1–6 h | 65–85% (no threads, no networking) |
| E4 | Adventure Game Studio | `acsetup.cfg`, `ac2game.dat` or `*.ags`, `audio.vox`, `speech.vox`, exe with AGS version resource | AGS Emscripten engine (`ags.wasm`, single-threaded by default) **or** ScummVM's AGS engine (AGS 2.5+) | No | Artistic-2.0 [U]; ScummVM GPL-3.0 | Working; 3.6 line, 4.0 alpha 37 (2026-11-05) [V] | 2–6 h | 60–80% (plugins and MIDI are the gaps) |
| E5 | ScummVM-supported (SCUMM, SCI, Wintermute, Director CD-ROMs, AGS, Grim, etc.) | `scummvm --detect --path=<dir>` (MD5 tables) | ScummVM Emscripten target (`dists/emscripten`, ASYNCIFY, plugins, IDBFS) | No | GPL-3.0 [V] | Working, not an official release platform; 2026.4.0 (2026-10-11) [V] | 2–6 h (first build); minutes after | 80–95% for supported games |
| E6 | Flash `.swf` / Flash projector `.exe` | `.swf` (`FWS`/`CWS`/`ZWS`); projector exe trailer `56 34 12 FA` + uint32 SWF length | Ruffle (Rust to WASM) | No | MIT OR Apache-2.0 [U] | Stable 0.7.1 plus daily nightlies (2026-11-17) [V]; AVM1 99/82%, AVM2 90/82% [V] | <1–2 h | AVM1 85–95%; AVM2 55–80% |
| E7 | Adobe AIR | `META-INF/AIR/application.xml`, `Adobe AIR/` captive runtime, main SWF in `<initialWindow><content>` | Ruffle (partial AIR API) | No | as E6 | Partial [U] | 2–8 h | 25–50% (`flash.filesystem`, ANEs, NativeWindow) |
| E8 | Shockwave / Director | `.dcr`/`.dir`/`.dxr`/`.cct`/`.cxt`, projector with `RIFX`/`XFIR` data, `Xtras/` | dirplayer-rs (web Shockwave); ScummVM Director engine (CD-ROM titles) | No | dirplayer-rs GPL-3.0 [V] | dirplayer v0.8.1 (2026-08-18) [V]; young | 2–8 h | 30–60% |
| E9 | Java (`.jar`, Launch4j exe, jpackage) | `.jar`, zip appended to exe, `launch4j` strings, `lwjgl*.dll`, `app/*.jar` | CheerpJ 5.0 (Java 21; unmodified bytecode; LWJGL2 via gl4es) or TeaVM 0.16 (WasmGC; needs web backends) | CheerpJ: no. TeaVM: in practice yes | CheerpJ proprietary (free Community tier from CDN) [V]; TeaVM Apache-2.0 [U] | CheerpJ production [V]; TeaVM 0.16.0 (2026-10-02) [V] | 1–6 h (CheerpJ) | Swing/AWT 70–85%; LWJGL2 40–60%; LWJGL3 low [U] |
| E10 | LÖVE (`.love`, fused exe) | `love.dll`, `lua51.dll`, zip appended to exe containing `main.lua`/`conf.lua` | love.js (Emscripten LÖVE 11.x; Lua 5.1, no LuaJIT) | No (the `.love` is the source) | MIT [V] | Community-maintained; Davidobot fork last push 2024-05 [R]; LÖVE 11.5 is current [V] | 1–4 h | 60–80% (FFI/`jit`, threads, shaders) |
| E11 | Python / pygame | PyInstaller cookie `MEI\x0c\x0b\x0a\x0b\x0e`, `_internal/python3*.dll`, cx_Freeze `library.zip`; Nuitka = compiled (no recovery) | pygbag 0.9.3 (CPython wasm + pygame-ce) | Effectively yes (`.pyc` decompile is unreliable after Py3.9) | MIT [V] | pygbag 0.9.3 (2026-02-12) [R] | 2 h–2 days | With source 60–80%; from binary 10–30% |
| E12 | .NET XNA / FNA / MonoGame | CLR PE header; `Microsoft.Xna.Framework*.dll`, `FNA.dll`, `MonoGame.Framework.dll`, `Content/*.xnb` | .NET browser-wasm + FNA-WASM-Build (SDL3/FNA3D/FAudio via Emscripten); KNI (MonoGame-compatible, Blazor) when source exists | Decompile (ILSpy) or source | FNA Ms-PL [U]; KNI Ms-PL [V] | FNA 26.11 (2026-11-01) [V]; KNI v4.3.9001 (2026-09-13) [V]; Celeste/Terraria ports exist [R] | 2–10 days | 20–50% |
| E13 | GameMaker (`data.win`) | `data.win`, `options.ini`, `audiogroup*.dat`; VM vs YYC (YYC has no bytecode) | Butterscotch Web (WASM; GameMaker Studio 1.4.1804 / bytecode 16 only); official GX.games or HTML5 export needs the project | Narrow: no. Otherwise yes | Butterscotch license unchecked [U] | Experimental [R] | 2 h (if in scope) | Undertale-class GMS1.4 VM: 40–70%; anything else: ~0% |
| E14 | Godot 3/4 | `.pck` (`GDPC`) beside or embedded in exe; Godot version strings; .NET: `data_*_x86_64/GodotSharp.dll` | (a) same-version official web template + shipped `.pck`; (b) GDRE Tools recover, then editor web export | (a) No. (b) Recovery | Godot MIT; GDRE MIT [V] | Godot 4.7.x stable, 4.8 beta (Q4 2026) [R]; GDRE v2.8.0-beta.2 (2026-10-14) [V] | 2 h–3 days | GDScript, no GDExtension: 50–80%; C# on Godot 4: ~0% (no web export) |
| E15 | Unity | `UnityPlayer.dll`, `<Game>_Data/`, Mono: `Managed/Assembly-CSharp.dll`; IL2CPP: `GameAssembly.dll` + `global-metadata.dat` | Rebuild with Unity Web (IL2CPP to wasm; WebGL2, WebGPU supported in 6.6) from an AssetRipper-recovered project | Recovery plus large manual repair | AssetRipper GPL-3.0 [V]; Unity proprietary | AssetRipper 2.0.0 (2026-08-24) [V]; Unity 6.6 WebGPU (2026-09) [R] | 1–6 weeks | Mono and small: 5–25%; IL2CPP: <5% |
| E16 | Unreal (UE3/4/5) | `*.pak` in `Content/Paks`, `*-Win64-Shipping.exe`; UE3 `*.upk` | None from shipped builds. Epic: Pixel Streaming only. Third-party WebGPU forks need the project | Yes (`.uproject`) | proprietary | n/a | n/a | ~0% (route to streaming or binary lanes) |
| E17 | Clickteam Fusion / MMF2 | exe with `PAME`/`PAMU` game data, `mmfs2.dll`, `Modules/*.mfx` | Fusion's own HTML5 exporter (needs `.mfa` and the exporter); no open web runtime for exes | Yes | proprietary; Anaconda decompiler (old, 2021) | n/a | n/a (or 1–3 days with `.mfa`) | Without `.mfa`: ~0% in this lane |
| E18 | PICO-8 | `.p8` / `.p8.png`; binary export with `data.pod` | PICO-8's own `EXPORT x.html` (needs a PICO-8 license and the cart) | Cart | proprietary | Mature | <1 h with cart | With cart: 95%. Exports are "one-way" [R] |
| E19 | Visionaire Studio | `*.vis` data, Visionaire config tool | Visionaire's own HTML5 export (needs `.ved` project and license) [R] | Yes | proprietary | n/a | n/a | Without project: ~0% |
| E20 | Data-only id Tech / Doom / Build / GoldSrc | IWAD/PWAD, `PAK0.PAK` (`PACK`), `baseq3/pak0.pk3`, `DUKE3D.GRP`, `valve/` | WASM source ports: Chocolate-Doom wasm, GZDoom (Rosebud), Quake-WASM, Quake2-WASM, ioquake3 Emscripten, iortcw (+Wwasm), Xash3D-FWGS (webxash3d), d3wasm, EDuke32 (unofficial) | No (engine is open; data is the user's) | GPL-2.0/3.0 mostly | Mixed: ioq3 in-tree [R]; others community | 1–6 h | 70–90% classic ids; 40–60% Build/GZDoom |
| R | Open-source reimplementation with a web build | game-specific data files (see §4) | the reimplementation's Emscripten build | No (engine source is public) | per project (GPL / AGPL / MIT / Sustainable-Use) | varies, see §4 | 1–8 h | 60–90% when a web build exists |
| S1 | C/C++ source (own project or open game, or reimplementation without a web build) | build system plus deps scan | Emscripten 7.0.0 + SDL2/SDL3 + WebGL2/WebGPU | Yes | MIT/NCSA (emscripten) | Production | days–weeks | 30–80% (depends on deps) |
| S2 | Rust / Go / C# / Java / Haxe source | `Cargo.toml`, `go.mod`, `.csproj`, `pom.xml`/`build.gradle`, `project.xml` (OpenFL) | wasm-bindgen + wgpu/winit/bevy/macroquad; Ebitengine; .NET browser-wasm/Uno/KNI; TeaVM/gdx-teavm; Haxe html5 | Yes | various | Production (varies) | days–weeks | 40–80% |
| S3 | Engine project source (Godot, Unity, GameMaker, Defold, Construct, GDevelop, Fusion, AGS, Ren'Py) | project files (`project.godot`, `ProjectSettings/`, `*.yyp`, `game.project`, `*.c3p`, `*.mfa`, `Game.agf`) | the engine's own web export | Yes (it is the project) | engine licenses | Production | hours–days | 60–95% (minus plugins and native extensions) |

---

## 2. Per-lane details

### W1–W3: Games that already are web tech

**What the agent sees.** Many commercial and indie PC games are HTML5 inside a Chromium shell:

- RPG Maker MV uses unmodified NW.js; game files live in `www/`. MZ games put `index.html`, `js/`, `data/`, `img/`, `audio/`, `effects/`, `fonts/`, `css/` at the root [R].
- Construct 2/3 used NW.js. Construct 3 **removed the NW.js exporter in r450** and replaced it with a WebView2 wrapper (empty project about 530 KB vs about 116 MB for NW.js) [R]. Newer Construct desktop games are WebView2 apps with the HTML next to the exe.
- GDevelop desktop builds and most Phaser/PixiJS commercial games use Electron.
- Twine stories are a single HTML file.

**Fingerprints.**

- NW.js: `nw.dll`, `nw_elf.dll`, `nw_100_percent.pak`, `package.nw` (folder, zip, or zip concatenated onto the exe; NW.js documents `copy /b nw.exe+app.nw app.exe` packaging [U]), `package.json` with `main: index.html` and a `window` block.
- Electron: `resources/app.asar` (or unpacked `resources/app/`), `resources/electron.asar` in dev builds.
- Engine inside the HTML: MV `rpg_core.js` and `rpg_managers.js`; MZ `rmmz_core.js`; Construct `c2runtime.js`, `c3runtime.js`, `scripts/main.js`; GDevelop `gdjs`; Phaser `phaser*.js`; Pixi `pixi*.js`; Defold HTML5 `dmloader.js` (desktop Defold is native, so it is not this lane).

**Extraction.**

- NW.js: copy the folder, or unzip `package.nw`. For an exe with an appended zip, any zip reader that scans from the end of the file works (7-Zip, Python `zipfile` on the exe).
- Electron: `npx @electron/asar extract resources/app.asar out/` (`@electron/asar` v4.3.2, 2026-11-12 [V]). Check `package.json:main`. That is the **Node main process**. Find the `BrowserWindow.loadFile/loadURL` target, which is the renderer entry to host.

**Shims the agent must inject** (a `port-shim.js` loaded before game scripts):

- `require` and `process` checks: most HTML5 engines branch on `Utils.isNwjs()` / `typeof require`. MV `StorageManager.isLocalMode()` returns false outside NW.js and then uses **localStorage** (LZString-compressed JSON). MZ uses **localforage** (IndexedDB) on the web [U, from engine source knowledge]. For plugins that call `require('fs')` / `require('path')` unconditionally (a known breakage when deploying MV to web [R]), provide a tiny in-memory/IndexedDB `fs` shim covering `existsSync`, `readFileSync`, `writeFileSync` and `mkdirSync`, or patch the plugin to use `fetch`/XHR.
- Steam: `greenworks` (NW.js/Electron Steamworks binding; v0.22.0 for NW.js 0.103.1, 2025-09-20 [V]) and `steamworks.js` (Electron, MIT [V]). Stub with `init()` returning false, achievements as no-ops (optionally mirrored to localStorage), overlay disabled. These are native `.node` modules, so they can never load in a browser.
- `nw.gui` / `nw.Window` / Electron `ipcRenderer` / `remote`: stub fullscreen to the Fullscreen API, quit to a no-op or overlay, window resize to no-op.
- Native `.node` modules beyond Steam (custom DRM, Discord RPC, native audio) need per-module stubs. If game logic depends on them, the agent falls back to binary lanes.

**Assets and encryption.** MV/MZ "encrypted" assets (`.rpgmvp`/`.rpgmvo`/`.rpgmvm`, MZ `.png_`/`.ogg_`) are decrypted **client-side** by the engine (key in `data/System.json`). They work unchanged over HTTP, so **the agent should not decrypt them**. That avoids a circumvention question and saves work.

**Audio.** MV desktop builds may lack `.m4a` (Safari cannot decode Ogg in MV). If missing, transcode with ffmpeg to sit beside the `.ogg` files. MZ bundles a Vorbis decoder, so Ogg plays everywhere [U].

**Path case.** Windows is case-insensitive; static web hosts are not. The agent must index every referenced path (JSON data, plugin parameters, `img/` lookups) against the real filenames, then fix by renaming, duplicating, or a service-worker rewrite. This is the most common silent failure (404s, black sprites) in all web lanes.

**Saves.**

- NW.js MV saves are `www/save/file*.rpgsave` (base64 LZString JSON) and map 1:1 to localStorage keys. MZ saves (`save/*.rmmzsave`, zlib) map to localforage entries [U].
- Generic NW.js/Electron games that used `localStorage` keep it in the Chromium profile (for example `%LOCALAPPDATA%/<app>/User Data/Default/Local Storage/leveldb`). Migration is possible but optional, so offer it as an "import saves" feature.

**Verification hints.** No `require is not defined` / `process is not defined` errors, no 404s, title screen reached, first-input audio unlock.

**Legal.** Lowest-risk lane: no decompilation and no circumvention. It still holds that **the user's game files must not be published**; host locally or privately.

### E1: RPG Maker 2000/2003 → EasyRPG Player (web)

- Runtime: EasyRPG Player, GPL-3.0, 0.8.1.1 "Stun – Patch 1" (2025-06-01) [V]. Official web player builds with Emscripten via CMake/`emcmake` [R].
- Inputs: the game folder (`RPG_RT.*`, `*.lmu`, `CharSet/` …). Many games also need the **RTP** (the stock asset pack). The agent should check for missing RTP-referenced assets and ask the user to supply the official RTP; it is a free download, but its license is not open.
- Agent steps [V, from the web player guide]:
  1. Copy the game to `games/<id>/`.
  2. Run `gencache` in the game folder to build `index.json`. RPG Maker refers to files without extensions, so the web player needs this index.
  3. Serve the player with `?game=<id>`.
  4. Force engine or encoding via query string (`?engine=rpg2k3e&encoding=932`) or `RPG_RT.ini`; detection on the web is "limited".
  5. Optionally add `easyrpg.soundfont` (keep it small) for MIDI.
- Gaps: Maniacs Patch and DynRPG/Harmony-DLL plugin games, which EasyRPG supports only partly. Japanese encoding detection. Large MIDI soundfonts.
- Odds: high. This is the most mature engine lane.

### E2: RPG Maker XP / VX / VX Ace → mkxp-z (libretro, Emscripten)

- Runtime: mkxp-z (GPL-2.0 [V]); last tagged release v2.4.2 (2023-05) but active development [V/R]. libretro documents an `mkxp-z` core [V].
- A **libretro + Emscripten build proposed in mkxp-z PR #255** is demonstrated at `white-axe.github.io/mkxp-z-libretro-emscripten`. It uses the reference Ruby VM (not mruby), so VX/VX Ace and Ruby-fiber games run "unmodified if mkxp-z can play the game on at least one non-Windows platform" [V]. It runs in the RetroArch web player or Nostalgist.js.
- The older `pulsejet/mkxp-web` uses mruby: XP only, and it needs porting steps [R].
- Inputs: game folder or `.mkxpz`/`.zip` (store `.rgss*a` uncompressed), plus the RTP in `mkxp-z/RTP/{Standard|RPGVX|RPGVXAce}` (extract the official installers with `innoextract`), plus fonts [V].
- Agent steps: package the game as an uncompressed zip, add the RTP, launch via Nostalgist.js with the mkxp-z core, and persist SRAM/saves via RetroArch's IndexedDB.
- Gaps: games calling Win32API or DLLs (`Win32API.new`) for input, window or fullscreen tricks. mkxp-z has shims for common ones; the demo shows a Win32API-using VX game working [V]. Custom native DLL plugins fail.
- Status risk: if PR #255 is unmerged, the agent must build mkxp-z from that branch. Pin a commit.

### E3: Ren'Py → Ren'Py SDK web build

- Runtime: Ren'Py 8.6.0 (2026-11-15) [V]; web docs (8.6.1) [V].
- Facts [V, Ren'Py web docs]:
  - The web build compiles Ren'Py to WebAssembly.
  - **No threads** (`renpy.invoke_in_thread` and Python `threading` are unsupported).
  - **No networking** (sockets and `requests` fail).
  - Video only via the browser and `renpy.movie_cutscene()`.
  - Audio starts after the first click.
  - Files over 50 MB are not cached by browsers.
  - Progressive download (`progressive_download.txt`) for images, music and voice.
  - Built from the launcher "Web (Beta)", which writes a `*-web` folder and `web.zip`.
  - Hamburger menu supports save import/export.
- Inputs and version matching [U]:
  - Ren'Py executes compiled `.rpyc` and archived `.rpa` without `.rpy`, so the shipped `game/` folder is usually enough to act as a project.
  - Use the **same major line** (7.x for Python-2 games, 8.x for Python-3 games). Ren'Py 6.x games have no web path without upgrading.
  - `renpy/vc_version.py` or `renpy/__init__.py` in the shipped build gives the exact version.
- Agent steps:
  1. Read the shipped Ren'Py version.
  2. Install that SDK (or the nearest newer one in the same line) plus its web support package (headless launcher CLI exists).
  3. Create `projects/<name>/` holding the shipped `game/`.
  4. Optionally unpack `.rpa` with `unrpa` (last release 2019) so progressive download can work. `.rpa` inside the web `game.zip` should still load [U].
  5. Build web and serve with the `application/wasm` MIME type.
- Decompiling scripts (`unrpyc` v2.0.4, 2026-02 [V]) is only needed if the game must be patched (for example to remove threading or networking). That is a legal step up; see §5.
- Gaps: games using Python threads, sockets, `ctypes`, native `.pyd` modules, or Steam (`_renpysteam`), and very large games (download size).

### E4: Adventure Game Studio → AGS web engine or ScummVM-AGS

- AGS web port: in-tree `Emscripten/` [V].
  - Single-threaded by default (`AGS_DISABLE_THREADS`) because common hosts (itch.io, Gamejolt, GitHub Pages) lack COOP/COEP.
  - Copy the game's compiled data files next to `ags.wasm`/`ags.js` and list them in `my_game_files.js`, with a flat directory only.
  - MIDI needs a large soundfont, so the docs call it "not appropriate for the web" [V].
  - First shipped as "initial port" in 3.6.0 alpha [R]. Current tags: 4.0 Alpha 37 (2026-11-05) [V].
- Shipped Windows games usually append data to the exe. The AGS engine can read data from the exe (the Linux engine runs Windows `game.exe` directly) [U]. Otherwise split the data with AGS tooling.
- Alternative: ScummVM's AGS engine (supports AGS **2.5+** games) inside the ScummVM web build (E5) [R]. This is preferable when the game uses plugins ScummVM reimplements.
- Gaps: engine plugins (native DLLs) unless ScummVM has a reimplementation, MIDI, speed (the web build is single-threaded), and very large games.

### E5: ScummVM-supported games → ScummVM Emscripten

- In-tree `dists/emscripten/build.sh` [V]:
  - Downloads the pinned emsdk and builds third-party libs.
  - Builds engines as **plugins** (dynamic loading keeps the first load small), including 3D engines via WebGL.
  - Uses **ASYNCIFY**; the README lists `ASYNCIFY_ONLY` tuning and stack switching/JSPI as future work.
  - IDBFS persistence for saves and settings.
  - Assets over HTTP; cloud storage as a read-only folder.
  - Known aspect-ratio glitch until the first resize [V].
- ScummVM 2026.4.0 "Never-slop" (2026-10-11) [V] added about 200 games across 12 engines, **including more than 140 Wintermute titles** [R]. 2026.1.0 added Wintermute TTS [R].
- Third-party hosted builds exist (`scummvm.kuendig.io`, by the port's author; plus "ScummVM Packer" single-file HTML) [R].
- Agent steps:
  1. Run native `scummvm --detect --path=<dir>` on the build host to identify the engine and game ID.
  2. Build (or reuse a cached) ScummVM web bundle with only the needed engine plugin.
  3. Mount the game directory (HTTP-served for local use, or "bring your own" via OPFS/IndexedDB).
  4. Write `scummvm.ini` with that game pre-added and auto-launch it.
- Odds: excellent for anything ScummVM marks "good/excellent". This lane also absorbs Director CD-ROM titles, Wintermute, AGS (2.5+), SCI, Grim/EMI, Myst III, The Longest Journey and others.

### E6–E7: Flash `.swf`, projectors and Adobe AIR → Ruffle

- Ruffle: stable **0.7.1** plus nightlies (latest 2026-11-17) [V]. First "official release" reported May 2026 [R].
- Compatibility page [V]: AVM1 (AS1/2) **language 99%, API 82%**; AVM2 (AS3) **language 90%, API 82%** ("most games will work well enough to be played").
- Projector exes: SWF appended to the Flash Player projector. The trailer is magic `0xFA123456` (bytes `56 34 12 FA`) followed by a uint32 SWF length [U], so the agent carves `[size-8-len, size-8)`. JPEXS FFDec can also extract [U].
- Multi-file games load sibling SWFs and XML through relative URLs, so keep the directory structure. Some use `fscommand`/ExternalInterface; shim in JS.
- AIR: the main SWF is in `META-INF/AIR/application.xml`. Ruffle covers the Flash API but AIR-only APIs (`flash.filesystem.File`, `NativeWindow`, ANE native extensions such as Steam ANEs) are partial or absent [U]. Plan for patching or failure.
- Gaps: heavy AS3 (Stage3D/Starling performance, `flash.net` sockets, AIR APIs), and performance well below native Flash Player for AS3 [R].

### E8: Shockwave / Director

- dirplayer-rs: Rust/WASM Shockwave Player emulator, GPL-3.0, v0.8.1 (2026-08-18) [V]. It has a Chrome-extension polyfill and a standalone debugger app [R].
- For **Director-made CD-ROM games** (projectors with `.dxr`/`.cxt`), ScummVM's Director engine is the more mature route if the title is in its list (E5). For **web Shockwave** (`.dcr`), use dirplayer-rs.
- Extraction from projectors and unprotecting `.dxr` can be done with ProjectorRays [U]. Xtras (native plugins) are the main gap.

### E9: Java → CheerpJ (unmodified) or TeaVM (rebuild)

- CheerpJ **5.0**: Java 21, Java 25 preview [V].
  - Licensing [V]: a free **Community** tier for personal/study/hobby use, *loaded from the CheerpJ CDN*. Self-hosting or bundling the runtime counts as redistribution (commercial self-host listed at £5,000/yr). Open-source projects are free with a "Built with CheerpJ" credit from the CDN.
  - Browsercraft runs **unmodified Minecraft 1.2.5** with LWJGL compiled to WASM plus **gl4es** to GLES to WebGL plus X11 emulation [R].
  - So Swing/AWT and LWJGL2 games are realistic. LWJGL3/GLFW games are unknown [U].
- Agent steps: find the main class and classpath (`MANIFEST.MF`, Launch4j XML, jpackage `app/*.cfg`), put jars on the server, write a loader page with `cheerpjInit()` and `cheerpjRunMain()`, and map save directories to CheerpJ's `/files/` (IndexedDB-backed) [U].
- TeaVM 0.16.0 (2026-10-02) [V] compiles bytecode to JS/WasmGC. It needs the game's platform layer reimplemented (for libGDX: `xpenatan/gdx-teavm` v1.6.2, 2026-08 [V]), so treat it as a source lane (S2).
- Legal note: the free tier is personal-use and CDN-served. The plugin must not silently self-host CheerpJ for a public deployment.

### E10: LÖVE → love.js

- A fused exe is `love.exe` plus a zip. Extract the zip (it contains `main.lua`, `conf.lua`), then check `t.version` in `conf.lua`.
- LÖVE current stable is 11.5 [V]; 12.0 has been in development a long time [U].
- love.js (Davidobot fork, MIT [V]): an Emscripten LÖVE 11.x. The CLI produces a web folder from a `.love` (compatibility mode without pthreads, or a threaded mode needing COOP/COEP) [U]. The fork is described as updated to LÖVE 11.5, last push 2024-05 [R]. 2dengine/love.js provides a drop-in player [R].
- Gaps [U]:
  - **No LuaJIT**, so `ffi` and `jit` code breaks.
  - `love.thread` only in threaded builds.
  - Some GLSL features under WebGL.
  - Filesystem: `love.filesystem` saves go to IDBFS.
- Odds are good for small 2D games.

### E11: Python / pygame → pygbag

- pygbag 0.9.3 (2026-02-12) [R], MIT [V]: CPython WASM plus **pygame-ce only** [R].
- The game must use an `asyncio` main loop (`await asyncio.sleep(0)` per frame), and assets should be web-friendly (`.ogg`).
- From a binary: PyInstaller extraction (`pyinstxtractor` 2026.07 [V]), then `.pyc` decompilation (pycdc/decompyle-class tools), which is unreliable for Python ≥3.9 [U]. Nuitka builds are not recoverable.
- Recommendation: treat this as a source lane. Without source, hand off to binary lanes.

### E12: .NET XNA / FNA / MonoGame

- Precedent [R]: MercuryWorkshop's **Webleste (celeste-wasm)** and a Terraria port. The process was:
  1. `ilspycmd` decompile.
  2. Retarget to `Microsoft.NET.Sdk.WebAssembly`.
  3. Link FNA's native parts (SDL3, FNA3D, FAudio) compiled by Emscripten (automated by FNA-WASM-Build).
  4. Drive the game loop from JS.
  5. Ask the user to pick their game folder and copy it into **OPFS**.
  6. Enable .NET `WasmEnableThreads` for games that create threads.
- Reported cost: about 600 MB RAM, an 8-minute compile, FMOD via pthread builds.
- FNA 26.11 (2026-11-01) [V]. The FNA web path is "experimental / not officially supported" [R]. XNA 4.0 games can usually be retargeted to FNA (API-compatible) [U].
- MonoGame has no official web target. KNI (Ms-PL, v4.3.9001, 2026-09 [V]) is the MonoGame-compatible fork with a Blazor WebAssembly target, best when the user has source [R].
- Gaps: obfuscated assemblies, native P/Invoke (Steamworks.NET, FMOD, custom DLLs), `System.Threading` assumptions, file I/O on the UI thread, and content pipelines (`.xnb` is fine).
- Legal: decompiling and recompiling a commercial game is the most legally exposed lane here (§5). Run only for the user's own copy, never redistribute, warn first.

### E13: GameMaker

- No general lane for shipped games. Official web output (GX.games WASM or legacy HTML5 JS) requires the **project** [R]; the HTML5 runner compiles GML to JS, so a `data.win` cannot be dropped in.
- **Butterscotch** reimplements the GameMaker Studio runner targeting Undertale v1.08 (GMS 1.4.1804, bytecode 16). It has a **web (WASM) build** and has run Deltarune chapters 2–3 [R]. It is in scope only for **VM** (not YYC) games of that era that use supported functions.
- `UndertaleModTool` (nightly 2026-11-12 [V]) identifies bytecode version and VM vs YYC.
- OpenGMK (GPL-2.0 [V], last release 2022) targets GM8-era exes, with no web build known [U].
- Agent action: classify (GMS version, bytecode, VM/YYC). If it is in Butterscotch's window, try it; otherwise route to binary lanes.

### E14: Godot

- Facts [V, Godot stable docs]:
  - Web export runs the Compatibility (WebGL2) renderer.
  - Single-threaded export is the default since 4.3. Threaded export needs `SharedArrayBuffer`, hence COOP/COEP, or the PWA service-worker workaround.
  - Samples-based audio by default since 4.3.
  - Networking limited to HTTP, WebSocket client and WebRTC.
  - Output is `.html` + `.js` + `.wasm` + **`.pck`**.
  - **Godot 4 C# projects still cannot export to web** [R: 4.6/4.7 forum and press]. 4.7 (June 2026) added wasm64 export [R]. 4.8 is in beta, estimated Q4 2026 [R].
- **Route (a), no decompilation [U, test first]:** a Godot `.pck` is largely platform-neutral, and the web template loads `<basename>.pck`.
  1. Extract the pck from the exe if embedded (GDRE can, or carve from the `GDPC` magic).
  2. Fetch the **exact same version's** official web export template.
  3. Rename the pck to match and serve.
  - Risks: VRAM-compressed textures imported for desktop (S3TC/BPTC work on most desktop browsers, not mobile); Forward+/Mobile-only rendering features degrade or fail under Compatibility; GDExtension `.dll`s cannot load (they need a wasm rebuild from source); encrypted pcks need a custom template compiled with the key.
- **Route (b):** GDRE Tools (gdsdecomp, MIT, v2.8.0-beta.2 2026-10-14 [V]).
  1. `gdre_tools --headless --recover=<exe|pck>` (with `--key=<hex>` for encrypted packs) [R].
  2. Open in the **same Godot version** (recovery logs it).
  3. Set the web renderer, re-import textures for web, and export Web.
  - Recovers GDScript (decompiled from bytecode), scenes and resources. C# needs ILSpy on the assemblies, and Godot 4 C# still has no web.
- Odds: good for small and medium GDScript games without GDExtension.

### E15: Unity

- Unity's web player uses **IL2CPP only** (there is no Mono on web) [U]. WebGL2 is the default; **WebGPU supported (opt-in) in Unity 6.6** (2026-09-01) [R]; wasm64 / 16 GB heap is reported [R].
- Shipped builds are platform-specific (serialized assets plus compiled code), so there is **no runtime swap**. A browser build requires recovering a buildable project:
  - AssetRipper 2.0.0 (2026-08-24, GPL-3.0) [V] exports a Unity project. Scripts are decompiled from Mono assemblies.
  - For **IL2CPP** only stubs are possible. Cpp2IL rebuilds dummy assemblies, and AssetRipper's IL2CPP analysis is experimental and premium. Shader decompilation is experimental and premium; DirectX shaders decompile only on Windows [V].
- Real-world repair work: compile errors in decompiled C#, missing packages and assets from the Asset Store, native plugins (Steamworks.NET, FMOD/Wwise, Rewired), shaders, render pipeline versions, and the exact Unity version.
- Verdict: only plausible for small Mono-backend games with user-accepted legal risk. Default routing is streaming or binary lanes. **Do not promise it.**

### E16: Unreal

- No Epic web target for UE5; Epic's browser route is Pixel Streaming [R].
- Third-party WebGPU/WASM forks (Wonder Interactive, SimplyStream; UE 5.6–5.8 claims) need the **project**, and self-hosting is unclear [R].
- Shipped `.pak` games have no engine lane, so route them to streaming. Pixel Streaming itself needs the project too; for shipped games, use generic cloud streaming.

### E17–E19: Clickteam Fusion, PICO-8, Visionaire

- **Clickteam:** HTML5 export is a Clickteam exporter that needs the `.mfa` [R].
  - Anaconda (decompiler/older runtime; release 4.1 2021 [V]) can sometimes recover `.mfa` from exes [R].
  - Chowdren is a commercial C++ transpiler; NuclearRT is an open C++ runtime, WIP and "not ready for production" [R].
  - Without `.mfa`, use binary lanes.
- **PICO-8:** with the cart, `EXPORT game.html` is trivial (license needed). Exports are one-way [R]. Many PICO-8 games already have official web versions on the BBS or itch.
- **Visionaire:** HTML5 export from the editor exists per the community [R] (not verified at source). Shipped games need the project; otherwise use binary lanes.

### E20: Data-only id Tech / Doom / Build / GoldSrc games (WASM source ports)

| Data | Web engine | Status / notes |
|---|---|---|
| Doom IWAD/PWAD (vanilla, Boom-lite) | Chocolate/Crispy-based **wasm-doom**, `cloudflare/doom-wasm` (GPL-2.0, WebSockets netplay) [V/R]; WAD Commander launcher [R] | Mature; no ZDoom maps or mods |
| ZDoom/GZDoom mods | Rosebud's agent-made **GZDoom** browser port (2026-04) [V] | SFX, renderer and saves work; **music intermittent** [V] |
| Quake 1 (+ mission packs) | `GMH-Code/Quake-WASM` (software + GL via WebGL) [R] | Works |
| Quake 2 | `GMH-Code/Quake2-WASM` (GLES3 to WebGL2; gl4es) [R] | Last push 2024-12 [R] |
| Quake 3 (`baseq3/*.pk3`) | ioquake3 Emscripten (`emcmake`, user pk3 in `baseq3/`) [R]; Q3JS (Emscripten 4.0.19) [R] | Works |
| RTCW | iortcw + Wwasm SP patches, regrafted to MP, gl4es [V, levels.io 2026-11] | Agent-made in about an hour; the author hosts paks publicly (do not copy that) |
| Half-Life / CS 1.6 (`valve/`, `cstrike/`) | **Xash3D-FWGS** via `yohimik/webxash3d-fwgs` npm packages (`xash3d-fwgs`, `hlsdk-portable`, `cs16-client`) [R] | Works; server Docker images exist; upstream FWGS repo reportedly archived 2026-02 and moved [R] |
| Doom 3 | `d3wasm` (dhewm3, 2018) [V] | Old; likely needs a refresh on current Emscripten |
| Duke3D / Build | EDuke32 unofficial web (gawen.me/webduke, multiplayer) [R]; midzer shareware [R] | Community; NBlood/Raze have no web build known |

Agent steps (shared):

1. Identify the data by hash (IWAD tables, pk3 CRCs).
2. Choose an engine.
3. Build or fetch a pinned wasm build.
4. Provide a "drop your data" page that stores files in OPFS/IndexedDB.
5. Launch with arguments.

---

## 3. Bring-your-own-data pattern (applies to E1–E10, E20, R)

This is the 2026 consensus pattern (diabloweb, isle.pizza, Halo CE web port, playxcom.online, OpenRCT2-online, Webleste):

- Host **only the engine** (open source) plus a loader page. The user selects or drops their own files (`showDirectoryPicker()` in Chromium; `<input webkitdirectory>` or drag-and-drop elsewhere). Files are copied into **OPFS** (or IndexedDB) once, then mounted into the Emscripten FS (WasmFS OPFS backend or IDBFS) on each boot.
- Validate data by hash before launch, which gives a clear error instead of a crash.
- Call `navigator.storage.persist()` and show the quota.
- For a local-only skill, the agent can also serve the user's install directory from `localhost`. Saves still go to IndexedDB/OPFS, with export/import buttons.

---

## 4. Open-source reimplementations with browser builds

"Web build" = a known build that runs in a browser today. "In-tree" = supported in the project's own repo.

| Game(s) | Reimplementation | Web build? | License | Latest (feed) | Data files needed |
|---|---|---|---|---|---|
| Transport Tycoon Deluxe | **OpenTTD** | Yes, in-tree `os/emscripten` since 2020; Docker-pinned emsdk [R] | GPL-2.0 [U] | 16.0-RC1 (2026-10-31) [V] | None (OpenGFX/OpenSFX free) or TTD `TRG*.GRF` |
| RollerCoaster Tycoon 2 (+RCT1) | **OpenRCT2** | Third-party "OpenRCT2 Online" (upload own files) [R]; Emscripten issues exist in tracker (#24841) [R]; in-tree status unconfirmed | GPL-3.0 [U] | v0.5.7 (2026-11-01) [V] | RCT2 `Data/`, `ObjData/` (+ RCT1 for RCT1 mode) |
| Heroes of Might & Magic II | **fheroes2** | Yes, official `README_emscripten` (threads, COOP/COEP; `fheroes2.data/.js/.wasm`) [R]; demo data script | GPL-2.0 [V] | 1.1.18 (2026-11-08) [V] | `HEROES2.AGG`, maps (or free demo) |
| Caesar III | **Julius** / **Augustus** | Yes, in-tree Emscripten ("any compatible browser"; wiki build guide) [R] | AGPL-3.0 [V] | Julius 1.8.0 (2025-07-31); Augustus 4.0.0 (2023-12) [V] | Original C3 install (`c3.eng`, `*.sg2`, `*.555`) |
| Diablo (1) | **diabloweb** (devilution-based) | Yes, live with shareware, drop your `DIABDAT.MPQ` [R]; last push 2022 [R] | unclear (devilution lineage) [U] | n/a | `DIABDAT.MPQ` |
| Diablo + Hellfire | **DevilutionX** | No official web build found [U] | Sustainable Use License (non-commercial) [R] | 1.5.5 (2026-08-15) [V] | `DIABDAT.MPQ` (+ `hellfire.mpq`) |
| Tomb Raider 1–3 | **OpenLara** | Yes, author-hosted web build [U] | BSD-2-Clause [V] | 2024-01 build [V] | TR level files (`*.PHD` etc.) |
| Jazz Jackrabbit 2 | **Jazz² Resurrection** (jazz2-native) | Yes, needs WebAssembly + WebGL2 [R] | GPL-3.0 [U] | 3.9.0 (2026-10-17) [V] | JJ2 directory (shareware works) |
| LEGO Island | **isle-portable** → isle.pizza | Yes (needs Wasm threads) [R] | LGPL-3.0 [V] | continuous (2026-11-17) [V] | Original LEGO Island files (verified by checksums) |
| Fallout 1/2 (+Nevada/Sonora) | **fallout2-ce** (roginvs fork) | Yes, browser site for Fallout 2, Nevada, Sonora [R] | Sustainable Use License [V] | continuous (2026-11-11) [V] | `master.dat`, `critter.dat`, `patch000.dat`, `data/` |
| Half-Life, CS 1.6 | **Xash3D-FWGS** (webxash3d) | Yes (npm packages; local folder) [R] | GPL-3.0 [U] | n/a | `valve/` (+ `cstrike/`) |
| Quake 3 / RTCW | **ioquake3** / **iortcw** | ioq3 in-tree Emscripten [R]; iortcw via Wwasm patches [V] | GPL-2.0 [V] | continuous | `baseq3/pak*.pk3`; RTCW `main/*.pk3` |
| X-COM: UFO Defense / TFTD | **OpenXcom** | Third-party "playxcom.online" (upload data, cached) [R]; 2013 caiiiycuk port [R] | GPL-3.0 [V] | v1.0 (2014) + nightlies [V] | `GEODATA/`, `MAPS/`, `UFOGRAPH/` … |
| 3D Pinball Space Cadet | **SpaceCadetPinball** decomp | Yes, alula web port [U] | unclear [U] | 2021 [V] | `PINBALL.DAT` + wav/mid |
| Celeste / Terraria (FNA) | not reimpl.: decompiled originals (**Webleste**) | Yes [R] | GPL/other [U] | continuous (2026-08-26) [V] | User's game folder into OPFS |
| Halo: CE (Xbox) | decomp-based browser port (M. Hynes) | Yes (2026-09; user XISO) [R] | n/a | n/a | XISO of own disc |
| Infinity Engine (BG1/2, IWD, PST) | **GemRB** | No known web build [U] | GPL-2.0 [V] | v0.9.5 (2026-03-23) [V] | `chitin.key` + install |
| Ultima VII | **Exult** | No (only a JS-port discussion) [R] | GPL-2.0 [U] | snapshot 2026-11-05 [V] | `STATIC/` etc. |
| Morrowind | **OpenMW** | No [U] | GPL-3.0 [U] | 0.52.0 RC1 (2026-11-03) [V] | `Data Files/` |
| Theme Hospital | **CorsixTH** | No known web build [U] | MIT [V] | v0.70.3 (2026-11-16) [V] | `HOSP/` data |
| Heroes III | **VCMI** | No known web build [U] | GPL-2.0 [U] | 1.7.5 (2026-08-15) [V] | H3 `Data/`, `Maps/`, `Mp3/` |
| Locomotion | **OpenLoco** | No known web build [U] | MIT [U] | v26.09 (2026-09-18) [V] | Locomotion data |
| Cave Story | **doukutsu-rs** / NXEngine-evo | Unknown [U] | MIT / GPL-3.0 [U] | 1.0.0 (2026-06-04) [V] | Freeware data |
| Prince of Persia | **SDLPoP** | Unknown [U] | GPL-3.0 [U] | v1.24-RC (2025-04) [V] | PoP 1.0 data |
| C&C / Red Alert | **Vanilla Conquer** | No [U] | GPL-3.0 [U] | dev build 2026-11-13 [V] | Original MIX files |

Notes:

- The "no web build" rows are **source-port candidates** (S1): SDL-based C/C++ with clean data loading. GemRB, CorsixTH (C++ and Lua) and SDLPoP look most tractable [U]. OpenMW is the least (large, threaded, OSG/OpenGL 3).
- Licenses matter for redistribution: GPL and AGPL engines can be hosted with source offers. **Sustainable Use License** (DevilutionX, fallout2-ce) forbids commercial use; flag it for any paid deployment.

---

## 5. Source-port playbook (own project, open game, or reimplementation without a web build)

### 5.1 Toolchain state (2026-11)

- **Emscripten 7.0.0** (2026-11-06; emsdk "Release 7.0.0") [V]. Recent breaking or important changes [V, ChangeLog]:
  - 7.0.0: libc++/compiler-rt to **LLVM 23.1.3**; libc++ 23 removes transitive includes (temporary `-D_LIBCPP_KEEP_TRANSITIVE_INCLUDES_LLVM23`). Minimum browsers raised (Chrome 93, Firefox 92, Safari 15.4). WasmFS **OPFS backend** uses `readwrite-unsafe` handles under pthreads.
  - 6.0.8 (2026-08-20): **`JSPI` no longer experimental**; `SOCKET_WEBRTC` **removed**; epoll on the JS FS.
  - 6.0.0 (2026-06-04): Windows ships `.exe` launchers (scripts calling `emcc.bat` break). `FAKE_DYLIBS` off by default (`-shared` makes real side modules). IDBFS auto-persist callbacks.
  - 5.0.0 (2026-01-24): `pthread_create` in non-thread builds returns `ENOTSUP`. `__async: 'auto'` for JS library functions under ASYNCIFY/JSPI.
  - The **SDL3 port is no longer experimental** (ports: SDL3 3.4.x, SDL2 2.32.10). `-sUSE_WEBGPU` was removed in favor of `--use-port=emdawnwebgpu` [V].
- **JSPI browser support:** Chrome/Edge 137+ (2025-05) [R]. Firefox intent-to-ship for **153** (June 2026) [R]. Safari is unconfirmed (reports of Safari 27 beta) [R]. Ship **ASYNCIFY as fallback** or require Chromium/Firefox.
- **Threads** (`-pthread`) require cross-origin isolation (COOP `same-origin` + COEP `require-corp`/`credentialless`). Hosts without header control can use a service-worker shim (Godot's PWA option does this) [V]. itch.io has a SharedArrayBuffer toggle [U].
- Native SDKs: SDL 3.4.x (latest tag 3.4.20, 2026-11-03) [V]; raylib 6.2 (2026-10-15) [V]; Defold 1.14.x [V]; wgpu v30.0.2 [V]; Bevy 0.20.1 [V]; macroquad 0.4.14 (2025-03) [V]; Uno.Wasm.Bootstrap 11.0.11 [V]; TeaVM 0.16.0 [V]; gdx-teavm 1.6.2 [V].

### 5.2 Emscripten best practices for game ports (C/C++)

1. **Main loop.** Prefer refactoring to `emscripten_set_main_loop[_arg]` (one frame per callback). If the code has deep blocking loops (`while(!quit){...}`, modal menus, `Sleep()`), use **JSPI** (`-sJSPI`) where supported, else **ASYNCIFY** with `ASYNCIFY_ONLY`/`ASYNCIFY_IMPORTS` lists to limit code-size and speed cost. ScummVM documents this tuning [V]. Alternatively, `-sPROXY_TO_PTHREAD` runs `main()` on a worker so blocking is legal. That needs threads, OffscreenCanvas or GL proxying, and an input bridge: GZDoom needed a shared-memory ring buffer because `SDL_PollEvent` does not see events on the worker [V].
2. **Graphics.**
   - Target WebGL2 (`-sMAX_WEBGL_VERSION=2 -sMIN_WEBGL_VERSION=2`, `-sFULL_ES3` for client-side arrays).
   - Legacy fixed-function OpenGL 1.x: `-sLEGACY_GL_EMULATION` covers only a subset. **gl4es** (MIT, v1.1.6 2024-05 [V]) is the proven path, used by Quake2-WASM, RTCW, and CheerpJ's LWJGL [R/V].
   - Direct3D titles need an abstraction swap: SDL_gpu/bgfx/sokol, or a D3D-to-GL layer (out of scope; see binary-lane notes).
   - WebGPU via `emdawnwebgpu` when the engine has a Vulkan/WebGPU-ish backend.
   - Query canvas size with `emscripten_get_canvas_element_size`, not SDL's cached size (high-DPI mismatch) [V].
3. **Filesystem.**
   - Small games: `--preload-file` into a `.data` package.
   - Large games: lazy loading (`FS.createLazyFile` or fetch-on-demand) or **BYO data into OPFS** (WasmFS `-sWASMFS` with the OPFS backend) or IDBFS for saves.
   - Call `FS.syncfs` after saves (or IDBFS auto-persist).
   - Normalize path case.
   - Keep single files under 50 MB to stay browser-cacheable (Ren'Py's guidance) [V].
4. **Memory.** `-sALLOW_MEMORY_GROWTH`; wasm32 heap ≤4 GB (practically 2–4 GB). Use `-sMEMORY64`/wasm64 only if needed (Godot 4.7 and Unity 6.x adopted it) [R]. Mobile Safari tabs are much tighter [U].
5. **Stacks.** Raise `-sSTACK_SIZE` and `-sDEFAULT_PTHREAD_STACK_SIZE` (GZDoom needed 8 MB) [V].
6. **CMake.** Use `emcmake`/`emmake`. `find_package(Threads)` mis-detects under Emscripten, so pre-seed thread variables [V]. Disable native-only deps (`-DUSE_STEAM=OFF`) and use Emscripten ports (`--use-port=sdl3`, `sdl2_mixer`, `libpng`, `zlib`, `freetype`, `vorbis`, `ogg`, `mpg123`).
7. **Audio.**
   - Unlock on the first user gesture (all browsers block autoplay) [V].
   - SDL audio maps to Web Audio. Use `-sAUDIO_WORKLET` with threads for low latency.
   - Middleware (FMOD/Wwise) has its own HTML5 builds or needs replacing.
   - MIDI needs a soundfont (large) or OPL emulation. Music pipelines are a top failure point (GZDoom ZMusic still broken) [V].
8. **Input.** Pointer Lock and Fullscreen need a user gesture. Gamepads appear only after a button press [V, Godot docs]. Remap browser-reserved keys (Ctrl+W, F5, F11).
9. **Networking.**
   - Browsers have no raw TCP/UDP.
   - TCP-style protocols: Emscripten sockets over WebSockets plus a websockify-style proxy, or `-sPROXY_POSIX_SOCKETS` with the websocket-to-posix proxy.
   - UDP games: WebRTC data channels via custom JS (Emscripten's `SOCKET_WEBRTC` was removed in 6.0.8) [V], or a WebSocket relay (cloudflare/doom-wasm, webxash3d servers) [R].
10. **Exceptions, longjmp, dynamic loading.** `-fwasm-exceptions`, `-sSUPPORT_LONGJMP=wasm`. Use `MAIN_MODULE`/`SIDE_MODULE` only for plugin-style engines (ScummVM) [V].
11. **x86-isms.** Inline asm, SSE intrinsics (`-msimd128` plus Emscripten's SSE headers), `__int64`/`long` sizes (wasm32 is ILP32, so struct layout differs from x64 and binary save/network formats may break), unaligned access (fine), and Win32 APIs (replace with SDL).
12. **Serving.** `application/wasm` MIME type, Brotli/gzip precompression [V], HTTPS or localhost (secure context), and COOP/COEP only when threads are used.

### 5.3 Other languages and frameworks with first-class web targets

| Stack | Web path | Notes |
|---|---|---|
| raylib 6.2 | `PLATFORM_WEB` via Emscripten | Simplest C path; zlib [U] |
| sokol | WebGL2 / WebGPU backends | Header-only, zlib [U] |
| bgfx | WebGL backend via Emscripten | BSD-2 [U] |
| Godot (source project) | Web export (GDScript); **no C# on Godot 4** | See E14 |
| Defold 1.14.x | First-class HTML5 bundle | Desktop builds are native; you need the project [U] |
| Rust | `wasm32-unknown-unknown` + wasm-bindgen; winit (web backend), **wgpu v30** (WebGPU with WebGL2 fallback), **Bevy 0.20**, macroquad 0.4 (own JS loader); SDL-based Rust uses `wasm32-unknown-emscripten` | Threads on Rust web need nightly + atomics `build-std` [U] |
| Go | `GOOS=js GOARCH=wasm`; **Ebitengine** has first-class browser support [U] | GC pauses; binary size |
| C# / .NET | .NET browser-wasm (`Microsoft.NET.Sdk.WebAssembly`, `wasm-tools`), AOT (`RunAOTCompilation`), threads (`WasmEnableThreads`) [R]; Uno.Wasm.Bootstrap 11; KNI (MonoGame API); FNA-WASM-Build | Large downloads; long AOT compiles |
| Java / Kotlin | TeaVM 0.16 (WasmGC), libGDX via gdx-teavm; CheerpJ for unmodified jars | TeaVM needs web-compatible libs |
| Haxe (OpenFL / HaxeFlixel / Heaps) | `lime build html5` / Heaps JS-WebGL [U] | Many indie desktop games are Haxe/hxcpp; with source this is often a one-line target switch |
| Python | pygbag (pygame-ce), PyScript (pygame-ce experimental) [R] | asyncio loop required |
| Lua (LÖVE) | love.js | No LuaJIT |

### 5.4 How the agent should run a source port, step by step

1. **Inventory.** Language(s), build system, entry point, third-party deps (graphics API, audio libs, physics, networking, scripting VMs, middleware, Steam/Discord), threading usage (`std::thread`, `pthread`, `CreateThread`), file I/O patterns, and platform `#ifdef`s. Produce a **dependency risk table**: each dep marked ported, available as an Emscripten port, needing a replacement, or a blocker.
2. **Pick the threading model first.** It dictates hosting headers, input plumbing and GL proxying [V, Rosebud]. The default is a single thread plus main-loop refactor or JSPI/ASYNCIFY. Use pthreads plus `PROXY_TO_PTHREAD` only if the engine truly needs it.
3. **Get a native Linux/SDL build green** (if it is Windows-only, port to SDL natively first; that is where most fixes are cheapest to debug).
4. **First Emscripten build with a minimal feature set:** no audio, no network, `-sASSERTIONS=2`, `-sSAFE_HEAP=1` for debugging, source maps (`-gsource-map`).
5. **Graphics bring-up:** WebGL2 context, then GL translation (gl4es or LEGACY_GL_EMULATION), then shaders (GLSL ES 3.00 conversion).
6. **Main loop and blocking calls:** refactor or apply JSPI/ASYNCIFY (with lists).
7. **Filesystem:** data packaging (preload / lazy / BYO data into OPFS), saves to IDBFS/OPFS, case normalization.
8. **Audio:** SDL audio or Web Audio, unlock on gesture, music formats or soundfont.
9. **Input:** keyboard focus, pointer lock, gamepad.
10. **Networking** (if any): WebSocket relay or WebRTC.
11. **Optimize:** `-O3`/`-Oz`, `-flto`, `wasm-opt`, Brotli, asset compression, lazy plugins.
12. **Verify** (section 6.3) on Chromium, Firefox and WebKit.

Common pitfalls (ranked by frequency in 2025–26 write-ups):

- Blocking main loops.
- Threading and cross-origin isolation.
- Legacy GL.
- Audio middleware and MIDI.
- Stack overflow (silent crashes).
- Case-sensitive paths.
- 4 GB memory.
- libc++ include breakage on new emsdk.
- `.bat` launcher assumptions on Windows hosts.
- Huge initial download (no lazy loading).
- Safari gaps (JSPI, WebGPU, memory).

---

## 6. Recommendation

### 6.1 Decision ladder for engine and source lanes (try in order; stop at the first green verification)

| Rung | Condition (from fingerprinting) | Lane(s) | Expected effort | Success odds |
|---|---|---|---|---|
| 0 | HTML5 inside NW.js / Electron / WebView2 / CEF, or loose HTML | W1–W3: extract, shim, case-fix, serve | minutes–hours | 85–95% |
| 1 | Data runs on a mature web runtime **unchanged** | E1 EasyRPG, E5 ScummVM (incl. Wintermute, Director, AGS 2.5+), E6 Ruffle (AVM1), E20 Doom/Quake/HL ports, R (reimplementation with web build) | 1–6 h | 75–95% |
| 2 | Data runs on a younger web runtime unchanged | E2 mkxp-z libretro, E4 AGS web, E6 Ruffle (AVM2), E8 dirplayer-rs, E13 Butterscotch (GMS1.4 VM only) | 2–8 h | 40–75% |
| 3 | The engine's own toolchain rebuilds from shipped artifacts with **no code decompilation** | E3 Ren'Py SDK web build, E10 love.js, E9 CheerpJ, E14(a) Godot pck plus same-version template | 2 h–1 day | 50–80% |
| 4 | Engine source is available (open reimplementation, open game, user's own C/C++/Rust/… project) but no web build exists | S1/S2 source port (playbook §5) | days–weeks | 30–80% |
| 5 | User has the **engine project** (Godot, Unity, GameMaker, Fusion `.mfa`, Visionaire, AGS, Ren'Py, PICO-8 cart, Defold, Construct) | S3 engine web export | hours–days | 60–95% |
| 6 | Only shipped binaries; decompile-and-rebuild is technically possible (user consents to legal caveats) | E14(b) GDRE, E12 .NET/FNA, E15 Unity Mono (rare), E11 PyInstaller | days–weeks | 10–50% |
| 7 | None of the above (Unreal, Unity IL2CPP, Fusion/Visionaire/PICO-8 without project, YYC GameMaker, Python Nuitka, native C++ without source) | **Hand off to generic binary lanes** (emulation, Boxedwine, recompilation, streaming) | per other notes | per other notes |

Rungs 5 and 6 are ordered by **cost and risk**, not availability. If the user has a project (rung 5), prefer it over everything except rung 0.

### 6.2 What the fingerprinting step must output (inputs to the ladder)

- Engine family and **exact version** (RGSS level, Ren'Py version, Godot version, Unity version and scripting backend, AGS version, GMS bytecode version and VM/YYC, Flash AVM1/AVM2 and SWF version, LÖVE version, .NET framework and XNA/FNA/MonoGame).
- Native-dependency list (Steam, Discord, FMOD/Wwise, ANEs, Xtras, GDExtension, P/Invoke DLLs, NW/Electron `.node` modules) with a stubbable or blocking flag.
- Threading, networking and video usage hints.
- Data size, file count, and case-collision report.
- Legal flags: needs decompilation, needs decryption, data redistribution would be required (must stay false).

### 6.3 Automated verification step (should gate every lane)

Run headless (Playwright: Chromium + Firefox + WebKit; GPU via SwiftShader/ANGLE if no GPU) against a local server that mirrors production headers.

1. **Serve-correctness:** `application/wasm` MIME, compression, COOP/COEP present if and only if the build uses threads, secure context.
2. **Boot:** page loads; no uncaught exceptions; no `RuntimeError` (`unreachable`, `memory access out of bounds`), Emscripten `abort()`, `require/process is not defined`, or OOM. **Zero 404s** (list them; most are case mismatches).
3. **Liveness:** canvas present and sized. Screenshots at about 5 s, 15 s and 30 s. Fail if frames are uniform (black/white) or identical across all checkpoints when animation is expected. Optional SSIM against a reference frame captured from a native run.
4. **Input smoke test:** engine-specific scripted inputs (Enter/Z/click to pass the title screen; ScummVM/AGS click scripts), then assert the frame changes.
5. **Audio:** after a synthetic click, `AudioContext.state === "running"` and non-silent output (AnalyserNode RMS > threshold).
6. **Persistence:** trigger a save (engine hook or scripted), reload, and assert the save exists (IndexedDB/OPFS/localStorage key present) and loads.
7. **Performance budget:** median FPS over 10 s (rAF hook), wasm memory size, time-to-first-frame, total transfer size. Warn above about 300 MB initial download or 2 GB memory.
8. **Browser matrix report:** which browsers pass. Note JSPI, threads and WebGPU requirements explicitly.
9. **Compliance check:** the output bundle contains **no copyrighted game data** when in "BYO data" or public mode. Third-party runtime licenses are recorded (GPL source offer, CheerpJ CDN-only, Sustainable-Use non-commercial).

---

## 7. Legal notes per lane (not legal advice; for product-policy design)

- **General:**
  - Running a legitimately owned game in a different runtime is the user's personal use. **Publishing the game's data is not** and must never be automated. The default output is a local or private page plus BYO data.
  - The precedents (diabloweb, isle.pizza, Halo CE web, playxcom.online, Webleste) all host only engine code and ask for the user's files [R]. A counter-example is the RTCW port serving the original paks publicly [V], which this plugin must not emulate.
- **W1–W3 (already web):** no decompilation or circumvention needed. MV/MZ "encryption" is handled by the game's own runtime, so do not decrypt. Steam API stubs disable DRM-adjacent calls. Some games tie launch to Steam (for example `restartAppIfNecessary`); stubbing that is arguably DRM circumvention, so surface it to the user.
- **Runtime lanes (E1, E2, E4–E8, E20, R):** the engines are open source (GPL/AGPL/MIT/BSD). Hosting them is fine with license compliance (GPL source offer; AGPL network clause for Julius/Augustus). **Sustainable Use License** projects (DevilutionX, fallout2-ce) prohibit commercial use. RTPs (RPG Maker) are free but proprietary, so the user supplies them. Soundfonts and shareware data each have their own terms.
- **E3 Ren'Py:** the engine is MIT. Rebuilding from shipped `.rpyc` without decompiling is the low-risk path. **Decompiling scripts** (`unrpyc`) to patch is reverse engineering; many VN EULAs forbid it, so gate it behind explicit user consent.
- **E9 CheerpJ:** proprietary runtime. The free Community tier covers personal/hobby use **from the CheerpJ CDN**; self-hosting counts as redistribution [V].
- **Decompile lanes (E12 .NET, E14(b) Godot GDRE, E15 Unity AssetRipper/Cpp2IL, E13 UndertaleModTool, E17 Anaconda):**
  - EU: Software Directive 2009/24/EC **Art. 6** permits decompilation only when *indispensable to obtain interoperability* of an independently created program, limited to the necessary parts, and the results may not be used for a substantially similar program. Art. 8 makes contract terms contrary to Art. 6 void [U, from the statute text]. Recompiling a decompiled game for a new platform is **not** clearly within Art. 6.
  - US: reverse engineering can be fair use (Sega v. Accolade, Sony v. Connectix) [U]. **EULA anti-RE clauses have been enforced** (Bowers v. Baystate 2003 [R]; Davidson & Assocs. v. Jung / bnetd 2005, where the court rejected the §1201(f) interoperability defense [R]). §1201 anti-circumvention applies if encryption is bypassed (Godot encrypted pck key extraction, DRM removal).
  - Policy: these lanes run only on the user's own copy, locally, never publish outputs, require an explicit acknowledgement, and are skipped when a lower rung works.
- **Unity/Unreal/GameMaker engine EULAs** bind the developer, not the player. The *game's* EULA is what matters for the player, and most forbid reverse engineering [U].
- **Encrypted content:** Godot encrypted packs (key extraction via GDRE/keydot [R]), Unity obfuscation, and Steam DRM wrappers are circumvention territory. The plugin should refuse or require explicit consent and a jurisdiction warning.

---

## 8. Open risks and unknowns

1. **Unconfirmed items worth a spike before implementation:**
   - The Godot "pck into same-version web template" shortcut (E14a).
   - Whether mkxp-z PR #255 is merged and has a stable web artifact.
   - AGS web engine reading data directly from a Windows exe.
   - Ren'Py web build from `.rpyc`/`.rpa` only, and cross-version `.rpyc` compatibility.
   - CheerpJ with LWJGL3 games.
   - The Butterscotch license and coverage.
   - OpenRCT2 in-tree Emscripten status.
2. **Safari:** JSPI support unconfirmed, threads/memory limits on iOS, and Ogg playback quirks. The verification matrix must report Safari separately; Chromium-first may be acceptable for v1.
3. **Cross-origin isolation vs embedding:** threaded builds break third-party iframes and CDNs without CORP headers. Prefer single-threaded builds where the engine allows it (Godot, AGS, love.js compat, Ren'Py).
4. **Toolchain churn:** Emscripten made three major versions in 2026 (5.0, 6.0, 7.0). Pin emsdk per lane and cache builds. Expect libc++ 23 breakage on older engines.
5. **Community-runtime bus factor:** love.js, diabloweb, Quake2-WASM, d3wasm, mkxp-web and the webxash3d stack have single maintainers or stale repos. Vendor pinned builds and keep native fallbacks.
6. **Agent-made ports look done before they are:** Rosebud's GZDoom shipped with music broken [V]. Verification must test audio and saves, not just "it boots".
7. **Licensing traps:** Sustainable-Use projects (non-commercial), the CheerpJ CDN-only free tier, AGPL network obligations, and RTP/soundfont/shareware redistribution terms.
8. **Legal variance by jurisdiction** for decompile lanes (EU Art. 6 vs US contract enforcement). Product policy should default to the conservative path.
9. **Secondary-source dependence:** some 2026 claims (Unity 6.6 WebGPU and wasm64, Godot 4.7 wasm64, Firefox 153 JSPI, Ruffle "first official release", Halo CE web) come from press or forums. Re-check before quoting in user-facing docs.

---

## 9. Sources (accessed 2026-11-17 unless noted; publication date in parentheses where known)

**Release and version data:** GitHub release/tag Atom feeds (`https://github.com/<owner>/<repo>/releases.atom`), fetched 2026-11-17, for: nwjs/nw.js, electron/electron, greenheartgames/greenworks, EasyRPG/Player, mkxp-z/mkxp-z, renpy/renpy, adventuregamestudio/ags, scummvm/scummvm, ruffle-rs/ruffle, igorlira/dirplayer-rs, konsoletyper/teavm, Davidobot/love.js, love2d/love, pygame-web/pygbag, FNA-XNA/FNA, kniEngine/kni, GDRETools/gdsdecomp, godotengine/godot, AssetRipper/AssetRipper, UnderminersTeam/UndertaleModTool, OpenGMK/OpenGMK, OpenTTD/OpenTTD, OpenRCT2/OpenRCT2, diasurgical/devilutionX, gemrb/gemrb, exult/exult, OpenMW/openmw, bvschaik/julius, Keriew/augustus, ihhub/fheroes2, OpenXcom/OpenXcom, CorsixTH/CorsixTH, XProger/OpenLara, emscripten-core/emscripten, emscripten-core/emsdk, raysan5/raylib, libsdl-org/SDL, ptitSeb/gl4es, defold/defold, MercuryWorkshop/celeste-wasm, roginvs/fallout2-ce, isledecomp/isle-portable, deathkiller/jazz2-native, alula/SpaceCadetPinball, xpenatan/gdx-teavm, SamboyCoding/Cpp2IL, CensoredUsername/unrpyc, Lattyware/unrpa, extremecoders-re/pyinstxtractor, electron/asar, unoplatform/Uno.Wasm.Bootstrap, gfx-rs/wgpu, bevyengine/bevy, not-fl3/macroquad, fnmwolf/Anaconda, vanilla-conquer/vanilla-conquer, doukutsu-rs/doukutsu-rs, vcmi/vcmi, OpenLoco/OpenLoco, NagyD/SDLPoP, gabrielcuvillier/d3wasm.
**Licenses:** GitHub repo pages (license badge), and LICENSE files via jsDelivr for CorsixTH, fallout2-ce, isle-portable.

Primary documentation:
- Emscripten ChangeLog (7.0.0, 2026-11-06; 6.0.8, 2026-08-20; 6.0.0, 2026-06-04; 5.0.0, 2026-01-24): https://github.com/emscripten-core/emscripten/blob/main/ChangeLog.md (via https://cdn.jsdelivr.net/gh/emscripten-core/emscripten@main/ChangeLog.md)
- Ren'Py Web/HTML5 docs (8.6.1): https://www.renpy.org/doc/html/web.html
- Ruffle compatibility: https://ruffle.rs/compatibility ; downloads (0.7.1 / nightlies): https://ruffle.rs/downloads
- ScummVM Emscripten README: https://github.com/scummvm/scummvm/blob/master/dists/emscripten/README.md
- EasyRPG web player guide: https://easyrpg.org/player/guide/webplayer/
- mkxp-z libretro Emscripten demo (PR #255): https://white-axe.github.io/mkxp-z-libretro-emscripten/ ; libretro mkxp-z core docs: https://docs.libretro.com/library/mkxp-z/
- AGS Emscripten README: https://github.com/adventuregamestudio/ags/blob/master/Emscripten/README.md
- Godot "Exporting for the Web" (stable): https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html
- CheerpJ licensing (5.0): https://cheerpj.com/licensing/
- AssetRipper premium features: https://assetripper.github.io/AssetRipper/articles/PremiumFeatures.html
- Wavedash engine docs (GameMaker GX.games, Ren'Py 8.6, RPG Maker MZ): https://docs.wavedash.com/engines/gamemaker.md , https://docs.wavedash.com/engines/renpy.md , https://docs.wavedash.com/engines/rpgmaker.md

Write-ups and precedent:
- Rosebud, "GZDoom in the browser" (2026-04-13): https://lab.rosebud.ai/engineering/gzdoom-in-the-browser
- levels.io, RTCW web port with AI (2026-11): https://levels.io/ported-return-to-castle-wolfenstein-to-web-with-ai
- velzie, "Porting Terraria and Celeste to WebAssembly": https://velzie.rip/blog/celeste-wasm ; https://github.com/MercuryWorkshop/celeste-wasm
- Warzone 2100 web port: https://wz2100.net/news/journey-to-the-web-porting-warzone-2100-to-webassembly/
- CheerpJ 3.1 / 4.0 / 4.1 / Browsercraft: https://labs.leaningtech.com/blog/cheerpj-3.1 , https://labs.leaningtech.com/blog/cheerpj-4.0 , https://labs.leaningtech.com/showcase/browsercraft
- fheroes2 Emscripten README: https://ihhub.github.io/fheroes2/README_emscripten.html
- Julius Emscripten build wiki: https://github.com/bvschaik/julius/wiki/Building-for-Emscripten
- OpenTTD emscripten (mirror of `os/emscripten/README.md`): https://git.blob42.xyz/Archives/OpenTTD-patches/src/branch/master/os/emscripten/README.md
- diabloweb coverage (2024-08): https://mezha.ua/en/2024/08/16/diablo-can-be-fully-played-in-a-browser/ ; https://github.com/d07RiV/devilution
- isle.pizza / isle-portable: https://github.com/isledecomp/isle ; https://git.mattkc.com/isledecomp/isle.pizza
- Halo CE browser port (2026-09-30): https://www.techpowerup.com/353285/halo-combat-evolved-gets-a-free-browser-port-with-split-screen-co-op
- OpenXcom browser edition: https://playxcom.online ; OpenRCT2 Online: https://openrct2-online.pages.dev/
- Xash3D web: https://github.com/yohimik/webxash3d-fwgs/wiki ; https://cdn.jsdelivr.net/npm/xash3d-fwgs@1.2.2/README.md
- Quake/Quake2 WASM: https://github.com/GMH-Code/Quake-WASM , https://github.com/GMH-Code/Quake2-WASM ; Q3JS: https://q3js.com/quake-3-webassembly
- Doom wasm: https://github.com/cloudflare/doom-wasm ; https://doom.fandom.com/wiki/Wasm-doom ; d3wasm: https://github.com/gabrielcuvillier/d3wasm
- EDuke32 in the browser: https://forums.duke4.net/topic/13014-eduke32-in-the-browser-and-multiplayer-finally-works/
- Butterscotch: https://github.com/ButterscotchRunner/Butterscotch
- dirplayer-rs: https://github.com/igorlira/dirplayer-rs
- Clickteam reimplementations: https://github.com/fnmwolf/Anaconda , https://encyclofusion.github.io/chowdren , https://nuclearrt.pages.dev/
- Construct 3 r450 (NW.js exporter removed): https://www.construct.net/make-games/releases/beta/r450 ; WebView2 vs NW.js: https://construct.net/en/tutorials/comparison-nw-js-windows-2686
- RPG Maker MV `fs` breakage on web: https://jengamon.itch.io/jms-earthbound-backgrounds-for-rpg-maker-mv/devlog/172225/switch-from-fs-to-xmlhttprequest
- GDRE Tools: https://github.com/GDRETools/gdsdecomp ; keydot: https://awesome.ecosyste.ms/projects/github.com%2Ftitoot%2Fkeydot
- Godot C# web status (forum, 2025–26): https://forum.godotengine.org/t/is-there-an-update-on-exporting-c-projects-to-web/128821 ; Godot 4.8 schedule: https://docs.godotengine.org/en/latest/about/release_policy.html
- Unity 6.6 WebGPU (2026-09-01, secondary): https://alternativeto.net/news/2026/9/unity-6-6-adds-webgpu-build-analysis-and-coreclr-prep/
- Unreal web (secondary): https://forums.unrealengine.com/t/webgpu-for-unreal-engine-5-5-6-and-5-7-support/2693960 ; https://www.summerengine.com/de/make-great-games/unreal-engine-html5-export.md
- MonoGame/KNI web (secondary): https://docs.wavedash.com/engines/monogame.md , https://docs.wavedash.com/engines/kni.md
- JSPI support: https://web-platform-dx.github.io/web-features-explorer/features/wasm-jspi ; Mozilla intent to ship (2026-06-10): https://groups.google.com/a/mozilla.org/g/dev-platform/c/8cOxM-dWaNs ; https://caniuse.com/mdn-webassembly_jspi
- ScummVM 2026.4.0 coverage (2026-10): https://www.gamingonlinux.com/2026/10/scummvm-2026-4-brings-nearly-200-newly-supported-retro-games/ ; Wintermute dev post (2026-09-09): https://www.scummvm.org/news/20260909/
- Ruffle "first official release" (2026-05-17, secondary): https://www.generationamiga.com/2026/05/17/ruffle-flash-emulator-officially-released-bringing-classic-flash-games-back/
- pygbag 0.9.3 (piwheels listing): https://www.piwheels.org/project/pygbag/
- PICO-8 exports one-way: https://lexaloffle.com/bbs/?tid=53474 ; manual: https://www.lexaloffle.com/dl/docs/pico-8_manual.html

Legal:
- Directive 2009/24/EC (Art. 6, Art. 8): https://eur-lex.europa.eu/eli/dir/2009/24/oj
- 17 U.S.C. §1201 (incl. (f)): https://www.law.cornell.edu/uscode/text/17/1201
- Bowers v. Baystate (Fed. Cir. 2003): https://en.wikipedia.org/wiki/Bowers_v._Baystate_Technologies,_Inc.
- Blizzard v. bnetd (Davidson & Assocs. v. Jung) filings: https://kittens.eff.org/files/filenode/Blizzard_v_bnetd/appellees_brief.pdf
