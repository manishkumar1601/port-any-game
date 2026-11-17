# port-any-game: design and plan

Status: **approved (rev 2)** · 2026-11-17 · working name `port-any-game`, CLI `pag` · public open-source project

Rev 2 adds:
- ATBGamePort as prior art, and a `rewrite-html5` lane;
- a known-port catalog lookup;
- the BottleShip Windows runtime;
- OpenCode as a Tier 1 agent;
- the flat plugin layout;
- zero-install verify through the user's own Chrome or Edge;
- double-click player launchers;
- an explicit rights-holder mode.

Research behind every claim (sources and dates inside each note):

| Note | Topic |
|---|---|
| [01](../../research/01-agent-distribution.md) | Agent distribution |
| [02](../../research/02-native-binary-lanes.md) | Native-binary lanes |
| [03](../../research/03-engine-and-source-lanes.md) | Engine and source lanes |
| [04](../../research/04-detection-and-legal.md) | Detection and legal |
| [05](../../research/05-web-runtime-build-test.md) | Web runtime, build, verify, hosting |
| [06](../../research/06-agent-ecosystem-and-companions.md) | Agent ecosystem, OpenCode, companions |
| [07](../../research/07-port-catalogs.md) | Existing-port catalogs |
| [08](../../research/08-prior-art-retro-port-and-atbgameport.md) | Prior art: retro-port and ATBGamePort |

---

## 0. Summary

`port-any-game` is **one agent skill plus thin per-agent wrappers**. The user points any coding agent at a PC game they own. The agent turns it into something playable in a browser tab and proves it works before saying so. Target agents: Claude Code, Codex, OpenCode, Copilot, Cursor, Gemini/Antigravity and anything that loads `SKILL.md`. Host OSes: Windows, macOS and Linux.

No single technique ports every PC game, so the plugin routes:

1. **Survey.** A static scan, never running the game, finds the binary type, engine, graphics API, store, copy protection and the game's identity. It answers within seconds.
2. **Catalog lookup.** Does an open reimplementation or a "bring your own data" web port already exist for this exact game? If yes, use it. That is the cheapest port there is.
3. **Route.** Otherwise, pick the cheapest lane that can work:
   - already-HTML5 extract;
   - mature runtimes that read the original data (ScummVM, EasyRPG, Ruffle, js-dos, Doom/Quake ports);
   - engine rebuilds (Ren'Py, LÖVE, Godot);
   - Windows runtimes (BottleShip, Boxedwine, DOSBox-X, v86);
   - Emscripten source ports;
   - an AI **rewrite** in HTML5 for small 2D games (ATBGamePort's method);
   - **static recompilation** (retro-port's method, made cross-OS);
   - **Remote Play** streaming, honestly labeled, for games no browser can run.
4. **Build into one shared web shell.** One page layout for every lane: "bring your own files" import into browser storage, saves, input, audio, no-black-screen guards and correct headers.
5. **Verify.** It drives the user's installed Chrome or Edge directly (no extra download), with Playwright as fallback. It checks boot, frames, input, audio, saves, memory, a mobile viewport and that no data leaks. Passing gates "done".
6. **Hand over.** Either `pag serve`, or double-click launchers (`Play-Windows.bat` and others) so the player needs nothing installed.

---

## 1. Intent

**What was asked (your words, paraphrased):**
- A skill or plugin that converts any PC game into a browser-playable game.
- It is **just a skill/plugin**, usable with **any AI agent**; Claude, Codex and OpenCode are named.
- Windows, macOS and Linux.
- Self-contained, so the user needs no other solution.
- Includes the extra skills, hooks and rules it needs.
- References: retro-port and ATBGamePort.
- Plan first; no commits or pushes.

**Why (confirmed):**
- It is an **open-source project for all types of games.** The maintainer builds it because they like open source.
- It will be released publicly.
- For players: play games you own on any device with a browser, without Windows or per-game guides. The agent does the engineering; the person points at a folder and plays.

**Prior art** (full comparison in note 08):
- **retro-port** (MIT) proves an agent can do a real port end to end by statically recompiling the game's own x86 code. It ships an honest go/no-go survey and a verification loop. It is limited to one lane (32-bit Direct3D 8), a macOS host and Claude Code.
- **ATBGamePort** (GPL-3.0) proves a different method. The agent reverse-engineers the exe for evidence, then **rewrites** the game in zero-dependency HTML5 Canvas around the original assets. Its strengths are phase discipline, guards against black screens, zero-install verification with the installed Chrome, double-click launchers and multi-agent packaging. Its weak points:
  - a "priming prompt" that tells the agent to claim copyright in order to skip model safety checks;
  - hard dependencies on macOS-only and companion tools;
  - public deploys of original assets.

  We borrow ideas only, because it is GPL. We do not copy those weak points.
- `port-any-game` keeps both methods as **lanes** and adds the many cheaper lanes the research found. It also fixes the gaps: OS, agents, survey false positives and the legal posture.

---

## 2. Goals, non-goals, anti-goals

**Goals**

| # | Goal | Measured by |
|---|---|---|
| G1 | Every game folder gets an honest verdict, a lane and any known existing port | `pag survey` finishes in under 60 s on a 20 GB install, needs only Node, and returns verdict, lane, reasons and catalog matches |
| G2 | The agent builds through the cheapest working lane with minimal user effort | User touchpoints limited to: pick the folder, approve installs, acknowledgements, play-test, approve any hosting |
| G3 | "Done" means verified, not claimed | `pag verify` passes (§9), then a 2-minute manual check by the user |
| G4 | Works in any agent | Tier 1 (Claude Code, Codex, **OpenCode**, Copilot, skills-only) tested each release; Tier 2 smoke-tested (§13) |
| G5 | Works on every host OS | Windows 10/11 x64, macOS 13+ (Intel + Apple silicon), Linux x64 (Ubuntu 22.04+, Fedora 40+); arm64 Linux best effort |
| G6 | Self-contained | `pag doctor` / `pag setup` install every pinned tool. Verify uses the browser the user already has. Players get double-click launchers. Companions are optional, never required |
| G7 | Legal by construction | No DRM circumvention, no game downloads, no publishing game-derived bytes except in an explicit rights-holder/redistributable mode (§11) |
| G8 | Long ports survive many sessions | `port.json` + `PORTING_LOG.md` (checklist + log) + a session-start status hook |

**Non-goals (v1)**
- In-browser execution of modern 64-bit DX10/11/12 or Vulkan games. No path exists in 2026 (02); they get Remote Play.
- A store, launcher, or public game hosting service.
- Online play against live official services or server emulation.
- Phone-first tuning. Ports work where browsers allow; touch overlays are optional.
- Auto-translating games, or adding content the original didn't have.
- An MCP server (01 §6, 06 §7d).

**Anti-goals** (failure even if it "works")
- Claiming it works without a verify pass.
- Any lane that quietly crosses a legal line: DRM patching, decrypting keyed content, downloading OS images or game data.
- Prompts that tell the model to assert facts the user didn't state (ATB's "I am the copyright holder…" pattern).
- Branding or ads injected into users' ports.
- Copyrighted game bytes in the plugin repo, its CI fixtures, or any public URL outside rights-holder mode.
- A framework of abstractions. Lanes are small scripts plus a playbook; the shell is plain JS.

---

## 3. What "any PC game" honestly means

| Game class (from survey) | Path | Expected result |
|---|---|---|
| A known open reimplementation or BYO web port exists (fheroes2, Augustus/Julius, OpenTTD, OpenXcom, WebXash, DiabloWeb, PvZ-Portable...) | catalog → that engine's web build + your files | 70–95%, minutes to hours |
| HTML5 inside NW.js/Electron (RPG Maker MV/MZ, Construct, GDevelop, Twine...) | extract and serve | 85–95% |
| RPG Maker 2000/2003, ScummVM adventures, Flash, Doom/Quake/Half-Life data | mature runtime + original data | 75–95% |
| DOS games | js-dos | 85–95% |
| Ren'Py, LÖVE, Java, Godot (GDScript) | engine's own web build | 50–85% |
| RPG Maker XP/VX/Ace, AGS, Shockwave, GameMaker 1.4 | younger runtimes | 40–75% |
| Win32 1997–2004 using DirectDraw / D3D 3–9 | BottleShip (new, needs a spike) → Boxedwine / DOSBox-X+Win9x / v86 | 30–70%, performance-bound |
| Small 2D casual Win32 games (PopCap-style) | AI rewrite in HTML5 | 30–60% faithful; days |
| 32-bit unprotected Direct3D 8 | static recompilation | 40–60%; hours to days |
| 32-bit D3D9 / OpenGL 1.x | recompile (hard) or BottleShip | 10–40%; days |
| Source available (open game or your own project) | Emscripten port or engine web export | 30–95% |
| Unity IL2CPP, Unreal, 64-bit, DX10+, Vulkan, anything DRM-protected | **Remote Play** (streamed from your PC, labeled so) | about 90%, not a port |

Odds are planning estimates from the research, not measurements. The promise: **every game gets the best available path and an honest label.**

---

## 4. Approaches considered

| | Approach | Pros | Cons | Verdict |
|---|---|---|---|---|
| A | One universal emulator (DOSBox-X or v86 + Windows guest) | One runtime | Needs a Windows licence; weak or no 3D; slow; nothing modern; worse than native runtimes for engine games | Rejected as strategy; kept as lanes |
| B | Generalize retro-port (recompile everything) | Near-native speed and exact behaviour | Hours to days per game; 32-bit D3D8 only; pointless for engine games; derivative code | Rejected as strategy; kept as a lane |
| C | **Router + catalog + lanes + shared shell + one verifier** | Cheapest path per game; reuses mature open runtimes and existing ports; one output contract and one QA gate; lanes are independent | More surface; survey and catalog quality matter | **Picked** |
| D | Stream everything | ~100% of games that run on the PC | Not a port: host must stay on, adds latency, no offline | Rejected as strategy; last rung |
| E | AI rewrite everything (ATB method) | Small, mobile-friendly, no emulator | Fidelity drift; days per game; only practical for small 2D games | Rejected as strategy; kept as a lane |

---

## 5. Architecture

```
          ┌──────── any agent: Claude Code · Codex · OpenCode · Copilot · Cursor · Gemini/Antigravity · ... ───────┐
          │ SKILL.md workflow · subagents (surveyor, verifier) · hooks (guard, status) · AGENTS.md rules          │
          └───────────────┬───────────────────────────────────────────────────────────────────────┬────────────┘
                          │  node <skill>/scripts/pag.mjs <command>                               │
 user's game folder       ▼                                                                       ▼
 (read-only) ─► pag survey ─► survey.json ─► catalog match? ──yes──► known-port lane (engine web build + your files)
               (static, bounded)  (identity,       │no
                                   verdict, acks)  ▼
                                             lane ladder ─► pag new ─► port folder (port.json, PORTING_LOG.md,
                                                                        AGENTS.md, git hooks)
                         pag setup <lane> (pinned tools / prebuilt runtimes, consent first)
                                                   ▼
                         pag build   (lane adapter: extract | runtime bundle | emcc | rewrite | recomp | ...)
                                                   ▼
                         pag pack    (shared web shell + manifest + _headers + LICENSES)  ─► dist/
                                                   ▼
                         pag verify  (installed Chrome/Edge via CDP; Playwright fallback)
                                                   ▼
                         hand-over:  pag serve  |  pag package → Play-Windows.bat / Play-macOS.command / Play-Linux.sh
                                     (optional, approved each time: pag host → private Worker+R2, or Pages for BYO/rights-holder)
```

**Parts**

| Part | What | Where |
|---|---|---|
| Skill | Workflow spine, guardrails, lane selection rules (≤ 500 lines; aim ~150) | `skills/port-any-game/SKILL.md` |
| References | One playbook per lane family, loaded on demand | `skills/port-any-game/references/*.md` |
| CLI | `pag.mjs` + modules; Node ≥ 20 (22 recommended); zero dependencies (Playwright only as verify fallback) | `skills/port-any-game/scripts/` |
| Lane adapters | Per lane: `detect()`, `setup()`, `build()`, shell contract | `scripts/lanes/*.mjs` |
| Web shell | Page, loader, BYO import, storage, input, audio, video, service worker | `skills/port-any-game/assets/shell/` |
| Detection rules | Compiled from MIT rule sets (SteamDB, Detect It Easy subset, BinaryObjectScanner) | `scripts/rules/*.json` (generated, pinned, attributed) |
| Catalog | Known ports, reimplementations and identities (§7.3) | `skills/port-any-game/catalog/*.json` + per-source licence files |
| Policy | One module used by every command and every hook | `scripts/policy.mjs` |
| Ghidra driver | Node driver + Java export scripts (functions, strings, imports, xrefs, RTTI, decompile) for rewrite and recomp lanes | `scripts/ghidra/` |
| Subagents | `game-surveyor` (read-only), `port-verifier` (reports, never edits) | `agents/*.md` + generated per-agent variants |
| Commands | `/port-survey`, `/port-verify`, `/port-status` (the skill itself is the main entry) | `commands/*.md` + per-agent variants |
| Hooks | `guard` (before tool use), `status` (session start) | thin per-agent configs calling `pag.mjs guard\|status --host=<x>` |
| Project rules | `AGENTS.md` (+ `CLAUDE.md` = `@AGENTS.md`) written into each port | `assets/project/` |
| Git hooks | pre-commit / pre-push that block game bytes | `assets/project/githooks/` |

---

## 6. Lane catalog

Lanes are tried in ladder order; the first lane whose verify passes wins. **Data** says what the shipped page carries:
- `byo`: the player's own files are imported in-browser; the page can live on any static host;
- `bundled`: the page carries game bytes; private, or public only in rights-holder mode.

| Rung | Lane id | Trigger (survey) | Method | Data | Effort | Odds | Acks | Milestone |
|---|---|---|---|---|---|---|---|---|
| 0 | `web-extract` | `package.nw`, `app.asar`, `www/js/rpg_core.js`, `rmmz_core.js`, `c2/c3runtime.js`, WebView2/CEF + html, Twine | Extract, shim Node/greenworks, case-fix paths, serve | byo/bundled | 0.5–4 h | 85–95% | private use | M1 |
| 0 | `known-port` | Catalog match by store ID, file signatures or engine (§7.3) | Use the existing open engine's web build with the user's files, self-hosted locally in our shell; or point to the public BYO site (data stays in their browser). `legal_risk: high` entries are opt-in only | byo | min–4 h | 70–95% | private use, runtime licence | M1 (seed) / M2 |
| 1 | `rt-ruffle` | SWF magic, projector trailer, AIR descriptor | Ruffle (MIT/Apache) | byo | < 2 h | AVM1 85–95%, AVM2 55–80% | private use | M1 |
| 1 | `dos-jsdos` | MZ without PE/NE, DOS extenders | js-dos 8.x bundle (zip + `dosbox.conf`); js-dos MCP optional | byo | minutes | 85–95% | private use, runtime licence | M1 |
| 1 | `rt-easyrpg` | `RPG_RT.exe/.ldb/.lmt` | EasyRPG Player web | byo | 1–3 h | 85–95% | same | M2 |
| 1 | `rt-scummvm` | `scummvm --detect` hit (user's binary) or engine markers | ScummVM Emscripten (prebuilt by our CI, GPL source offer) | byo | 2–6 h first, then minutes | 80–95% | same | M2 |
| 1 | `rt-idtech` | IWAD/PWAD, `PAK0.PAK`, `baseq3/*.pk3`, `valve/`, `.grp` | Chocolate-Doom / Quake / ioq3 / Xash3D wasm | byo | 1–6 h | 70–90% | same | M2 |
| 2 | `rt-mkxpz` | `Game.ini` RGSS1/2/3, `.rgssad/.rgss2a/.rgss3a` | mkxp-z web (beta) | byo | 2–8 h | 55–75% | same | M4 |
| 2 | `rt-ags` | `acsetup.cfg`, `ac2game.dat`/`*.ags` | AGS web engine or ScummVM AGS | byo | 2–6 h | 60–80% | same | M4 |
| 2 | `rt-dirplayer` | `.dcr/.dxr/.cxt`, RIFX/XFIR | dirplayer-rs | byo | 2–8 h | 30–60% | same | M4 |
| 2 | `rt-butterscotch` | `data.win` GMS 1.4 bytecode 16, VM | Butterscotch Web | byo | ~2 h | 40–70% (narrow) | same | M4 |
| 3 | `rebuild-renpy` | `renpy/`, `.rpa`, `.rpyc` | Matching Ren'Py SDK "Web (Beta)", no decompiling | bundled | 1–6 h | 65–85% | private use | M2 |
| 3 | `rebuild-love` | `love.dll` + appended zip with `main.lua` | love.js | bundled | 1–4 h | 60–80% | private use | M2 |
| 3 | `rt-cheerpj` | `.jar`, Launch4j | CheerpJ (free tier = personal, from their CDN) | byo | 1–6 h | 40–85% | private use, CheerpJ terms | M4 |
| 3 | `rebuild-godot` | `.pck` (GDPC), not encrypted | (a) `.pck` on a same-version web template; (b) GDRE recovery, then export | bundled | 2 h–3 d | 50–80% | (b) asset-extract ack | M4 |
| 4 | `win-bottleship` | PE i386, 1997–2004, DirectDraw / D3D 3–9, in BottleShip's compatibility list | BottleShip (Apache-2.0, v0.8): x86 emulation + Win32/COM/DDraw/D3D→WebGPU, BYO installer | byo | 1–4 h | **unknown: spike in M0** | runtime licence | M3 |
| 4 | `win-boxedwine` | PE i386 2D (GDI/DirectDraw/WinG), Win16 | Boxedwine web (no Microsoft code; slow, no JIT) | byo | 1–3 h | 30–50% | runtime licence | M3 |
| 4 | `win-dosboxx` | NE Win16; Win9x-era 2D, Glide, DX≤7 | js-dos DOSBox-X + **user-supplied** Win 3.x/9x install (never downloaded) | bundled | 30 min–4 h | 40–85% | OS licence ack | M3 |
| 4 | `win-v86` | PE i386 2D, CPU-bound | v86 + user-supplied OS image | bundled | 2–4 h | 40–60% | OS licence ack | M3 |
| 5 | `src-port` | Source tree present | Emscripten 7 / wasm toolchains, playbook 03 §5 | byo/bundled | days–weeks | 30–80% | — | M4 |
| 5 | `src-engine-export` | Engine project present (`project.godot`, Unity `ProjectSettings/`, `.yyp`, `.mfa`, `Game.agf`...) | Engine's own web export | bundled | hours–days | 60–95% | — | M4 |
| 6 | `rewrite-html5` | Small 2D Win32 (ddraw/GDI/BASS; SexyAppFramework markers; exe < ~5 MB; data < ~500 MB) where rungs 0–4 fail or are too slow | Evidence-first RE with Ghidra headless → re-author in zero-dependency Canvas + Web Audio around original assets (ATB method, re-authored) | bundled | days | 30–60% faithful | **grey: decompile + asset extract** | M4 |
| 6 | `decomp-rebuild` | .NET XNA/FNA, Unity Mono, PyInstaller | ILSpy → FNA-WASM; AssetRipper → Unity Web | bundled | days–weeks | 5–50% | **grey: decompile** | M4 (opt-in) |
| 7 | `recomp-x86` | PE i386 unprotected; D3D8 (GO), D3D9/DDraw/GL (HARD) | retro-port toolchain forked and made cross-OS | bundled | hours–days | GO 40–60%, HARD 10–25% | **grey: decompile** | M5 |
| 8 | `remote-play` | Everything else: 64-bit, DX10+, Vulkan, IL2CPP, Unreal, any DRM | Sunshine + moonlight-web-stream (Vibepollo on Windows, Selkies on Linux) | none | 30–60 min | ~90% | own devices only | M2 |

**Ladder rules**
- Rungs 0 (`web-extract`, `known-port`) beat everything.
- If the user owns the engine project or source (rung 5), prefer it over every rung except 0.
- Grey lanes (rungs 6–7) run only after lower rungs fail or don't apply, and only after an explicit acknowledgement.
- Remote Play is always offered as the honest fallback, including for DRM'd games, because it runs the original unmodified game on the user's PC.

**Choosing between rewrite and recompile for a small 2D game:**
- prefer recompile when the game is D3D8 and the exact original behaviour matters;
- prefer rewrite when the game is DirectDraw/GDI with simple logic and the user wants mobile-friendly output.

The surveyor states both options with odds and lets the user pick.

---

## 7. Survey, identity and catalog

### 7.1 Survey (`pag survey`)

**Contract**
- Static only: never executes anything from the game folder.
- Bounded reads: headers plus the first and last 64 KB per file. Executables are hashed fully; files over 256 MB partially.
- No network calls unless the user opts in.
- Relative paths only; the absolute root is stored as a salted hash.
- Node ≥ 20, zero dependencies.

**What it detects**
- **Formats:** MZ/LE/LX (DOS extenders), NE, PE32, PE32+, CLR header, ELF, Mach-O.
- **APIs:** imports, delay imports, and DLL-name strings marked `dynamic`.
- **Engines:** about 40 engine fingerprints (04 §A.3), including overlay magic: SWF, AGS `CLIB`, LÖVE zip, PyInstaller `MEI`, Godot `GDPC`, Clickteam `PAME`.
- **The PopCap SexyAppFramework family:** RTTI and strings, plus a `properties/resources.xml` layout (signature to be confirmed in M0).
- **Store and identity markers:** `steam_appid.txt`/appmanifest, `goggame-<id>.info`.
- **Protection:** DRM, protectors, packers, anti-cheat.
- **Era:** linker version, imports, timestamps.
- **Features:** bitness, threads, multiplayer hints, video codecs, size.

**Rule sources** (vendored at a pinned commit, MIT notices kept)
- SteamDB `FileDetectionRuleSets`, with possessive and atomic regex rewritten for JS at rule-compile time.
- A translated subset of Detect It Easy's database.
- SabreTools BinaryObjectScanner name lists.

ScummVM's tables are GPL-3.0: **call the user's `scummvm --detect`** instead of copying them. `diec` is an optional deep-mode oracle.

**Fixes over retro-port's survey (04 §A.0)**
- `steam_api.dll` alone means WARN; only SteamStub `.bind` means STOP.
- .NET images aren't "packed".
- Parse PE32+ imports and delay imports.
- Classify files by magic, not by extension.
- **UPX** (a documented, reversible compressor) means WARN and allows `upx -d`. **Protectors** (Themida, VMProtect, Enigma, ASProtect, Armadillo) mean STOP.

**Output:** `survey.json`, schema `port-any-game/survey@1` (04 §A.8), plus a `catalog_matches[]` field.

### 7.2 Verdict rules

1. **STOP for every in-browser lane** if any of these is found on the main exe or a module it loads:
   - DRM, a protector, anti-tamper or anti-cheat;
   - online activation or launcher DRM;
   - a pirated signature;
   - a keyed encrypted pack needed outside the original runtime.

   `remote-play` stays allowed. The message names the protection, says the tool won't remove it, and suggests an official DRM-free edition (e.g. GOG).
2. Otherwise:
   - catalog matches go first (rung 0);
   - then lanes are scored by their preconditions and ranked by the ladder (§6);
   - acknowledgements are attached.
3. If the top two engines score within 0.15 of each other, report "ambiguous" and recommend the deep-mode oracles.

### 7.3 Catalog (from 07)

- **Ships offline with the plugin.** One curated JSON per game: identity (store IDs, file signatures), engine, known reimplementations or BYO web ports (URL, licence, required data files, last-verified date), `legal_risk`, and lane hints. **It never contains a game-data download URL.**
- **Seeds** (licence-compatible). Each source's data lives in its own file with its licence:
  - OSGameClones (CC BY 4.0; fix its `Web` flag gaps);
  - Wikidata (CC0; store IDs, engine, ScummVM/DOSBox IDs);
  - PortMaster port metadata (MIT; required data files);
  - a libretro-database subset (CC BY-SA 4.0, kept in a separate file because of share-alike; DOS exe name + size + CRC32, Doom/Quake data checksums);
  - hand curation of the 32 verified community BYO ports.
- **Not used:** ScummVM compatibility (GPL), PCGamingWiki (NC, API closed), IGDB, MobyGames, and unlicensed directories (AllRecomps, Ported2Browser). Curators may *read* those; nothing scrapes them.
- **Matching tiers:**
  1. store ID;
  2. file signatures (name + size + hash);
  3. engine fingerprint;
  4. fuzzy title, which always asks the user to confirm.

  Opt-in online resolvers: GOG product API for slug ↔ numeric ID; Wikidata SPARQL with the app ID only.
- **Updates:** our CI refreshes the seeds; a human reviews every change; each entry has a `verified_at` date.

---

## 8. Shared web shell (every lane's output)

```
dist/
  index.html                 canvas, Play button, progress, error explainer (no inline script; CSP)
  shell.json                 lane contract (requires, needs_coi, memory, data mode, input, verify budget, stages)
  shell/shell.js             lifecycle + capability checks + window.__shell API
  shell/loader.js            manifest, resumable Range downloads, chunked SHA-256, OPFS writer (worker)
  shell/import.js            BYO: directory picker | webkitdirectory | drag-drop folder/zip; identify by hash; copy to OPFS
  shell/storage.js           OPFS/IndexedDB, persist(), estimate(), save export/import, selfTest()
  shell/input.js             KeyboardEvent.code map, gamepad (standard mapping, rumble), pointer lock, keyboard lock, touch overlay
  shell/audio.js             single AudioContext, unlock on first gesture, visibility handling, mute
  shell/video.js             <video> overlay for converted cutscenes (Bink 1/Smacker → H.264 via ffmpeg; Bink 2 = skip card)
  shell/sw.js                cache by content hash; optional COI header injection for header-less hosts
  runtime/<lane>/...         lane payload
  game/manifest.json         {version, source: byo|bundled, files:[{path,size,sha256}]}
  game/...                   bundled builds only
  _headers  robots.txt  LICENSES/
```

**Runtime API.** `window.__shell` exposes:
- `.state`: `boot → checking → needs-files → importing/downloading → ready → running → paused | error`;
- `.stats`: frames, game frames, input events, wasm bytes, audio RMS, last error;
- a lane adapter: `{ id, start(ctx), pause(), resume(), saveNow?(), frameCounter() }`.

**Verify stage hooks** (ATB idea): `?verify_stage=initial|gameplay|stage2` puts the lane into known states where it can. Lanes we author (rewrite, recomp) also expose `window.render_game_to_text()` and `window.advanceTime(ms)` for deterministic checks.

**No-black-screen rules** (enforced in the shell, required in authored lanes):
1. Guard every image or texture draw, and wrap each frame in try/catch reported to `__shell`.
2. Assets resolve over both HTTP and `file://`.
3. `readyState`-safe bootstrap.
4. A live first frame under the start overlay.
5. Fixed layer order.

**Headers.**
- COOP `same-origin` + COEP `require-corp` only when threads are needed. Never `credentialless`, because Safari lacks it.
- Always: CORP same-origin, a strict CSP, `nosniff`, `no-referrer`.
- `X-Robots-Tag: noindex` on private builds.

**Platform targets.**
- wasm32 within 2–4 GB.
- WebGL2 everywhere; WebGPU optional per lane (thin on Linux and Firefox).
- JSPI in all engines, with ASYNCIFY fallback for Safari < 27.
- Offer "Add to Dock / Home Screen" plus save export, because Safari evicts site data after 7 days.

**Data modes** (§11 has the rules): `byo` (default) · `bundled` (private) · `bundled-public` (rights-holder or redistributable only).

---

## 9. Verify (`pag verify`)

**Runner, two tiers.** Zero install comes first:
1. **CDP tier (default).** Launch the user's installed **Chrome or Edge** (Edge ships with Windows) with a temporary profile and a remote-debugging port. Drive it over the Chrome DevTools Protocol using **Node 22's built-in `WebSocket`**: navigate, evaluate, capture screenshots, dispatch input, collect console, network and errors. No downloads.
2. **Playwright tier (fallback).** `playwright@1.65.x` + Chromium installed on first use into the tool cache, for:
   - machines with no Chromium-family browser (common on macOS);
   - the Firefox/WebKit matrix;
   - soak runs in CI.

WebGPU lanes run **headed** on Windows and Linux, because headless WebGPU screenshots come out black. Linux uses Xvfb. GPU-less sandboxes use SwiftShader, and their frame rates become warnings.

**Steps** (05 §7b):
1. Static checks:
   - schema;
   - manifest sizes and hashes;
   - host limits;
   - `_headers`;
   - licences;
   - public target + bundled (outside rights-holder mode) = fail.
2. Serve probe: COOP/COEP, Range 206, auth 401.
3. Environment check. A failure here means "unsupported environment", not "lane failed".
4. Instrumentation:
   - console and page errors;
   - failed requests;
   - an audio tap;
   - a fake gamepad;
   - readable canvas.
5. Load. BYO lanes inject fixture files through the hidden directory input.
6. Click Play (a real user gesture).
7. 10 s of samples (+ stage hooks):
   - black-frame test (≥ 98% near-black = blank; ATB's "≥ 90% coloured" as a secondary metric);
   - frozen-frame test;
   - frame rate;
   - `gameFrames` increasing.
8. Input script: the picture or state changes within 3 s.
9. Audio: running, and RMS ≥ -60 dBFS.
10. Save round-trip across a reload.
11. **Viewports:** desktop 1280×800 and mobile 390×844; layout must not overflow.
12. Soak 60–120 s: memory growth under 5%/min.
13. Privacy (BYO): zero request bodies and zero cross-origin requests.
14. Report: `verify/report.json`, screenshots, console log, a summary line.

**Independence.** The `port-verifier` subagent runs verify and reads the screenshots. It reports problems but never fixes them.

**Manual 2-minute check** by the user before "works on your machine": real controller, pointer feel, audio quality, one in-game save and load.

---

## 10. A port folder

```
~/ports/<game-id>/                 (location chosen by user; never inside the plugin)
  port.json                        lane, game id, pinned tool versions, data mode, controls, acks (timestamped)
  PORTING_LOG.md                   checklist state machine (resume at first unchecked item) + dated log + repro commands
  AGENTS.md  CLAUDE.md             project rules for any agent (CLAUDE.md = "@AGENTS.md"; OpenCode reads AGENTS.md only)
  .gitignore  .githooks/           keep game bytes out; pre-commit/pre-push block game magic, manifest hashes, >5 MB binaries
  survey.json                      relative paths only (still private: hashes identify the title)
  game/                            read-only reference to the user's install (link or copy-on-write clone)   [ignored]
  work/ build/ dist/ verify/       lane working files, outputs, reports                                       [ignored]
  analysis/                        RE reports (rewrite/recomp lanes; derived from the game → private)         [ignored]
  lane/                            the agent's own code: shims, configs, rewrite source, recomp host code     [tracked]
```

Each port is its own git repository. `pag new` creates it but **never commits**. Only the agent's own code is tracked. In rewrite lanes, the re-authored source is the agent's work, but it embeds facts and constants taken from the game, so it stays private unless the user is in rights-holder mode.

---

## 11. Guardrails and enforcement

**Refuse, with no override** (04 §B.8):
1. Removing, bypassing, patching or emulating DRM, activation, launcher ownership checks, protectors, anti-tamper or anti-cheat. This includes Steamless, NoCEG, Goldberg/steam_emu, crack loaders and no-CD exes.
2. Decrypting keyed content to disk.
3. Getting game data, disc images, BIOS, keys or OS images from anywhere but the user's own install or media.
4. Publishing game-derived bytes publicly, **except** in rights-holder/redistributable mode (below).
5. Modified clients or private servers against live services.
6. Continuing when the survey finds a pirated signature.
7. **Prompting the model to assert anything the user didn't say.** There is no "authorization priming". Acknowledgements are the user's own answers, recorded.

**Warn, and require a logged acknowledgement in `port.json`:**
- store-licensed copies;
- decompile, rewrite or recompile lanes (with a jurisdiction note);
- asset extraction;
- lightly encrypted archives (runtime lanes only);
- UPX decompression;
- networking disabled;
- proprietary middleware;
- binding beyond 127.0.0.1;
- runtime licence duties when sharing a BYO shell.

**Rights-holder / redistributable mode** (`bundled-public`). Public hosting of a build with game data is allowed only when one of these holds:
- (a) the catalog or licence file shows the data is redistributable (Freedoom, OpenGFX, freeware with redistribution permission);
- (b) the user explicitly states they hold the rights. They are asked a plain question, and `ACK_RIGHTS_HOLDER` is stored with a timestamp.

DRM refusal still applies: a rights holder can supply a DRM-free build. This mode unlocks `pag host pages`, which is ATB's GitHub Pages flow re-authored: dereference symlinks, audit sub-paths, add `.nojekyll`, generate an Actions workflow. It runs only with approval each time.

**Keep out of git and public hosting (default):**
- `game/`, `work/`, `build/`, `analysis/`;
- `dist/` with bundled data;
- recomp-generated C/wasm;
- saves and captures;
- survey reports with absolute paths.

**Enforcement layers** (hooks fail open on several agents, so they are not the control):

| Layer | Mechanism | Works on |
|---|---|---|
| 1. Skill text | Ground rules in `SKILL.md`, loaded on activation | every agent |
| 2. **Scripts (authoritative)** | `policy.mjs` inside every `pag` command: refuses STOP verdicts; refuses public targets for bundled builds without mode (a)/(b); refuses a denylist of circumvention tools and piracy domains; binds 127.0.0.1 by default | every agent, skills-only installs too |
| 3. Agent hooks | `pag guard --host=<x>` before tool use: denies `git add/commit/push` of protected paths, deploys of bundled builds, circumvention tools, piracy-domain fetches, writes into `game/` | Claude, Codex (after trust), Copilot, Cursor, Gemini, Antigravity, Kiro, Devin; **OpenCode via its plugin** (`permission.hook("evaluate")` in v2, `tool.execute.before` in v1) |
| 4. Git hooks | pre-commit/pre-push: game magic bytes, manifest hashes, binaries over 5 MB | any git client, any agent, humans |
| 5. Serve and launcher defaults | loopback only, noindex, password for anything beyond loopback | everywhere |

The strictest common rule applies everywhere (jurisdiction can't be known). Not legal advice; the README says so.

---

## 12. Toolchain and cross-OS

**One tool runtime: Node 22 LTS** (minimum 20), zero dependencies.
- **Why Node:**
  - hooks run as `node <script>` on every agent;
  - Python is unreliable on Windows (Store stub, no `python3`);
  - the web tooling is native to Node;
  - Node 22's built-in WebSocket makes the CDP verify tier dependency-free.
- **Python appears only inside lane toolchains** that already need it:
  - emsdk (bundled on Windows/macOS);
  - the Ren'Py SDK (self-contained);
  - `recomp-x86`, which keeps retro-port's Python translator, run with a uv-managed Python that its setup installs.
- **If `node` is missing,** `SKILL.md` step 0 proposes the install for the OS and waits for approval: `winget install OpenJS.NodeJS.LTS`, `brew install node@22`, or NodeSource / `fnm`.

**`pag doctor` → `pag setup <core|lane>`**
- Check-then-act, idempotent.
- Pinned in `toolchain.lock.json` with SHA-256 for every download.
- Shared cache in `~/.port-any-game/tools/<name>-<version>/`. Each port pins its versions. PATH is never edited.
- Admin steps are proposed, never run silently.

| Tool | When | Pin / note |
|---|---|---|
| Node 22 | always | user installs once (with help) |
| Installed Chrome/Edge | verify (CDP tier) | detected, not installed |
| Playwright + Chromium | verify fallback | `playwright@1.65.x`, first use only |
| js-dos, Ruffle, EasyRPG, BottleShip runtimes | their lanes | upstream releases by hash |
| Prebuilt ScummVM / mkxp-z / idTech web runtimes | their lanes | built and published by our CI with GPL source offers, so no compiler needed |
| emsdk 7.0.x | `src-port`, `recomp-x86`, runtime rebuilds | portable; no `--permanent` |
| Temurin JDK 21 + Ghidra 12.1.4 | `rewrite-html5`, `recomp-x86` only, with consent (~550 MB+) | Ghidra 12.2 needs JDK 25; opt-in later |
| ffmpeg (+ libopenmpt) | cutscenes, tracker music | static builds by hash, or the OS package manager |
| Ren'Py SDK / love.js / Godot templates | their lanes | by version |
| Sunshine + moonlight-web-stream | `remote-play` | installers, with consent |

**Optional companions** (documented, never required or auto-installed, 06 §7c):
- js-dos MCP;
- `@playwright/cli`;
- chrome-devtools CLI/MCP (always `--no-usage-statistics --no-performance-crux`);
- agent-browser;
- pyghidra-mcp / GhidraMCP / r2mcp;
- REA;
- `grill-me`.

**Player hand-over without any runtime** (`pag package`, an ATB idea re-authored):
- `Play-Windows.bat` runs a PowerShell `HttpListener` loopback server with COOP/COEP, which is built into Windows.
- `Play-macOS.command` and `Play-Linux.sh` use `node` or `python3` if present, else explain. The zip keeps the 0755 bit.
- An optional **single-file HTML** with an in-page file system for small builds that don't need threads, so it runs from `file://`.
- Same privacy rules: bundled packages are private unless in rights-holder mode.

**Known gaps:**
- Windows ARM64 has no official emsdk.
- iOS can only be checked by hand.
- `recomp-x86` native debug builds need porting from macOS-only SDL2 + Metal + AudioToolbox to SDL2 + wgpu-native. Until then, the cross-OS loop is the Node headless build plus the browser.

---

## 13. Packaging for any agent

**Principle.** `SKILL.md` + scripts are the portable core and carry every safety layer except hooks (layers 1, 2, 4, 5 of §11). Everything else is a thin per-agent wrapper that degrades gracefully.

**Components**

| Component | Count | Notes |
|---|---|---|
| Skill | **1** (`port-any-game`) | Agents' skill-listing budgets favour one sharp description. Lane knowledge lives in `references/`. Frontmatter: the six spec fields only. `agents/openai.yaml` for Codex UI (display name, 25–64 char description, `default_prompt` mentioning `$port-any-game`) |
| References | ~12 | `lanes/web-extract.md`, `lanes/known-ports.md`, `lanes/runtimes.md`, `lanes/dos.md`, `lanes/windows-runtimes.md`, `lanes/rebuild.md`, `lanes/source-port.md`, `lanes/rewrite-html5.md`, `lanes/recomp.md`, `lanes/remote-play.md`, `shell.md`, `verify.md`, `legal.md`, `hosting.md` |
| Subagents | 2 | `game-surveyor` (read-only), `port-verifier` (reports only) |
| Commands | 3 | `/port-survey`, `/port-verify`, `/port-status`; agents without commands invoke the skill |
| Hooks | 2 | `guard` (pre-tool), `status` (session start) |
| Project rules | 1 template | `AGENTS.md` (+ `CLAUDE.md` = `@AGENTS.md`) per port |
| Git hooks | 2 | pre-commit, pre-push |
| Intake | in `SKILL.md` | A short interview in rounds with a recommended answer for each question (method from `grilling`, re-authored). It covers: folder, goal (play locally / on phone / share), acceptable effort, acknowledgements |
| MCP | 0 | none in v1 |

**Repository layout: flat** (the repo root *is* the plugin; ATB's ADR 0002 reports clean installs on Claude, Codex and Copilot this way):

```
port-any-game/
  .claude-plugin/plugin.json         {"name":"port-any-game","version":…,"skills":["./skills/port-any-game"]}
  .claude-plugin/marketplace.json    {"plugins":[{"name":"port-any-game","source":"./"}]}   (Claude, Codex, Copilot, Droid, Qwen, npx skills)
  plugin.json                        Agent Plugins 1.0.0 (Codex, Copilot, Cursor, Kiro) — coexistence verified in M0 spike
  skills/port-any-game/
    SKILL.md  agents/openai.yaml  references/  assets/{shell,project,icons}/  catalog/
    scripts/{pag.mjs, policy.mjs, lanes/, rules/, ghidra/}
  agents/{game-surveyor,port-verifier}.md        commands/{port-survey,port-verify,port-status}.md
  hooks/hooks.json (Claude)   hooks/codex.json   com.github.copilot/hooks/hooks.json (+ generated *.agent.md)
  opencode/                                    (06 §5)
    agents/game-surveyor.md  agents/port-verifier.md   (mode: subagent, v2 permissions)
    commands/port-game.md                       ("@port-any-game Port the game in: $ARGUMENTS")
    plugin/{package.json,index.js,guard.mjs}    dual v1/v2 guard, zero deps
    opencode.jsonc.example
  hosts/ (M6)  cursor/  antigravity/  gemini/ (generated branch)  kiro/
  scripts/install.mjs                 per-agent installer: --host=opencode|cursor|kiro|… [--global] (copies wrappers; never edits user config silently)
  scripts/build.mjs                   generates per-agent variants from agents/ + commands/; CI fails on drift
  scripts/validate.mjs                frontmatter (six fields, name = folder), openai.yaml, relative links, version sync across manifests
  docs/adr/  SCOPE.md  README.md (one canonical install block)  LICENSE
  test/fixtures/                      only legally redistributable content
```

**Support tiers**
- **Tier 1** (CI-tested every release on Windows, macOS and Linux):
  - **Claude Code** (plugin);
  - **Codex** (plugin; hooks need one-time trust);
  - **OpenCode 2.x** (skills via `.agents/skills` or `~/.config/opencode/skills`, plus `opencode/` wrappers via `node scripts/install.mjs --host=opencode`, or `opencode plugin add 'github:<org>/port-any-game#vX.Y.Z::path:opencode/plugin'`; v1.19 checked too);
  - **Copilot** CLI and VS Code (plugin);
  - **skills-only** (`npx skills add <org>/port-any-game` with `DISABLE_TELEMETRY=1`, or copy to `~/.agents/skills/` + `~/.claude/skills/`), which covers Amp, Cline, Goose, Junie, Zed, Warp and others.
- **Tier 2** (generated, smoke-tested; M6): Cursor, Antigravity, Gemini CLI, Kiro, Devin, Factory Droid, Qwen Code.

**Graceful degradation**

| Missing | Fallback |
|---|---|
| Hooks | script policy + git hooks |
| Subagents | the skill runs those phases inline |
| Commands | invoke the skill (`/port-any-game`, `$port-any-game`, `@port-any-game`) |
| Plugin system | skills-only install keeps all scripts |

---

## 14. The workflow the skill teaches

1. **Prerequisites.** Check that `node` runs (if not, propose the OS-specific install). Run `pag doctor --json`. Set expectations in one short paragraph: time, odds, private use.
2. **Intake** (a short round of questions, each with a recommended answer): the game folder, the goal (play here / on another device / share), and how much effort is acceptable. Never download games. Disc images get installed or extracted first.
3. **Survey and catalog.** Done by `game-surveyor` where supported. Report the verdict in 1–2 sentences: lane, odds, true port or Remote Play, and any existing port found. STOP means explain why and offer DRM-free editions or Remote Play.
4. **Acknowledgements**, if the lane needs any: one plain question each, recorded in `port.json`.
5. **Create the port.** `pag new` builds the folder, rules and git hooks. `pag setup <lane>` installs tools after saying what and how big; long downloads run in the background.
6. **Build loop.** Follow `references/lanes/<lane>.md`: build → `pag serve` → quick verify → fix → repeat. Tick `PORTING_LOG.md` items as they complete. Use scripted input and screenshots rather than asking the user to test each change. Write large files in pieces (no more than ~1,000 lines per write).
7. **Gate.** Full `pag verify --soak 120` via `port-verifier`. Fix until pass, or report honestly what fails. If a lane is stuck past its budget, fall to the next rung and say so.
8. **Hand over:**
   - `pag serve` + URL, or the `pag package` launchers;
   - supported browsers, controls, save export;
   - the 2-minute manual checklist.
9. **Optional** (approved each time):
   - private hosting with `pag host worker` (user's Cloudflare Worker + R2 + password);
   - `pag host pages`, for BYO shells or rights-holder builds only;
   - recomp online 1v1 (retro-port's lockstep, later).
10. **End of session.** Update `PORTING_LOG.md`; tell the user where things stand and how to play what works.

---

## 15. Testing the plugin itself

**Fixtures** (freely redistributable only; no commercial bytes anywhere):

| Lane | Fixture |
|---|---|
| `web-extract` | our own Phaser game wrapped in NW.js and in Electron |
| `rt-ruffle` | self-made AVM1 + AVM2 SWFs |
| `dos-jsdos` | a freeware DOS game or our own DOS program |
| `rt-easyrpg` | EasyRPG test game |
| `rt-scummvm` | Beneath a Steel Sky, Flight of the Amazon Queen |
| `rt-idtech` | Freedoom |
| `known-port` | OpenTTD + OpenGFX |
| `rebuild-renpy` | Ren'Py sample |
| `rebuild-love` | an MIT LÖVE game |
| `rebuild-godot` | our own tiny export |
| `win-*` | our own MinGW GDI/DirectDraw/D3D test exes |
| `rewrite-html5` | our own tiny DirectDraw game, with source kept out of the fixture to simulate "binary only" |
| `recomp-x86` | retro-port difftests + our own D3D8 test exe |
| `src-port` | an open SDL2 game |

**Test layers**
1. **Unit:**
   - survey parsers on synthetic header bytes;
   - policy decisions;
   - catalog matching (store ID, signature, engine, fuzzy);
   - manifest/pack.
2. **Lane e2e** on `windows-latest`, `macos-latest` and `ubuntu-latest`, covering both verify tiers. CDP tier with the runner's Chrome; Playwright tier with SwiftShader + Xvfb on Linux.
3. **Guard tests:** recorded hook payloads per agent produce the expected deny format. OpenCode v1 and v2 included.
4. **Repo contract:** `scripts/validate.mjs` (frontmatter, links, `openai.yaml`, manifest version sync).
5. **Agent evals per release:** Claude Code, Codex and OpenCode against 3 fixtures, scored on verify pass and touchpoint count.
6. **Survey accuracy:** a private, never-committed local corpus of the maintainers' own games, reporting precision and recall per engine and DRM rule.

---

## 16. Roadmap

Sizes are relative: S about a day, M a few days, L a week or more of agent-assisted work.

| Milestone | Scope | Exit criteria | Size |
|---|---|---|---|
| **M0 Spikes** | (a) flat layout + root `plugin.json` coexistence on Claude, Codex, Copilot, Cursor; (b) Codex/Copilot hooks on Windows; (c) **OpenCode v2 + v1 guard plugin**; (d) **CDP verify via Node WebSocket** with Edge (Win), Chrome (mac/Linux), headed WebGPU capture; (e) js-dos bundle without MCP; (f) **BottleShip** packaging + perf on 3 test exes; (g) Boxedwine perf probe; (h) Godot `.pck` on same-version template; (i) survey speed on 20 GB; (j) PopCap/SexyAppFramework fingerprint | Each spike has a written yes/no in `docs/spikes/` | M |
| **M1 Core + Tier 1 packaging + first lanes** | `pag` CLI (doctor, setup core, survey, new, pack, serve, verify (both tiers), package, status, guard), web shell, policy, project template + git hooks, catalog v0 (hand-curated BYO ports + OSGameClones/Wikidata seeds), packaging for **Claude, Codex, OpenCode, Copilot, skills-only**, `validate.mjs`; lanes `web-extract`, `known-port` (OpenTTD), `rt-ruffle`, `dos-jsdos` | 4 fixtures pass verify on 3 OSes in CI; guard tests green for every Tier 1 agent; a fresh-machine run in **Claude Code, Codex and OpenCode** on each OS reaches "playable" in ≤ 5 user touchpoints | L |
| **M2 Runtimes + Remote Play** | `rt-easyrpg`, `rt-scummvm` (prebuilt runtime CI), `rt-idtech`, catalog expansion (PortMaster + libretro subset), `rebuild-renpy`, `rebuild-love`, `remote-play` | Fixtures pass; Tier 1 agent evals pass | L |
| **M3 Windows runtimes** | `win-bottleship` (if the M0 spike says yes), `win-boxedwine`, `win-dosboxx` (BYO OS licence), `win-v86` | Own Win32 fixtures playable; per-lane perf probe recorded | M |
| **M4 Rebuild, source, rewrite** | `src-port`, `src-engine-export`, `rebuild-godot`, `rt-mkxpz`, `rt-ags`, `rt-dirplayer`, `rt-butterscotch`, `rt-cheerpj`, **`rewrite-html5`** (Ghidra headless driver + playbook), `decomp-rebuild` (opt-in) | Fixtures pass where legal fixtures exist; rewrite fixture passes verify, including stage hooks | L |
| **M5 Recompilation** | Fork retro-port `template/` (MIT, pinned, attributed) into `recomp-x86`; cross-OS native build (SDL2 + wgpu-native); Ghidra/JDK setup per OS; offer fixes upstream; later D3D9/DDraw backends + WebGL2 fallback | Own D3D8 fixture runs in a browser from all 3 host OSes | L+ |
| **M6 Reach + hosting** | Tier 2 wrappers via `build.mjs` + `install.mjs`, `pag host worker` (private), `pag host pages` (BYO / rights-holder only), docs site | Tier 2 smoke tests; hosted fixture passes `verify --remote` | M |

Order rationale: cheap lanes and Tier 1 agents first, because they cover the most games and users per unit of work. Grey and expensive lanes come later. **If your main targets are a specific class of game, e.g. D3D8-era (recomp) or PopCap-style (rewrite), that lane moves up.**

---

## 17. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Survey misses DRM (CEG, Denuvo heuristics) | Legal | DiE oracle when present; recomp/rewrite abort on integrity-check traps; protection list reviewed per release |
| Hooks fail open or need trust on some agents | Guardrail gaps | Scripts are authoritative; git hooks are agent-independent |
| Young dependencies: BottleShip v0.8, js-dos MCP (days old), Agent Plugins 1.0, mkxp-z web, OpenCode v2 API | Breakage | Pin everything; each lane has a path without the young piece; M0 spikes |
| Catalog rot (dead links, moved ports) and legal-risk entries (e.g. reVC-derived ports) | Bad routing | `verified_at` per entry; CI link checks; `legal_risk: high` = opt-in only |
| Rewrite fidelity drift | "Feels wrong" ports | Evidence-first RE report; stage hooks; user play-test; label it "rewrite", never "original" |
| WebGPU gaps + black headless capture | Fewer browsers; flaky verify | WebGL2 where possible; headed verify for WebGPU; "unsupported environment" ≠ fail |
| Emulation performance | Unplayable on low-end devices | Perf probe in verify; honest frame-rate verdict; fall to next rung |
| OS images for `win-dosboxx`/`win-v86` | Legal | Never downloaded; user-supplied only; BottleShip/Boxedwine preferred |
| Agent landscape churn (Gemini → Antigravity, OpenCode v1→v2, Codex prompts deprecated) | Packaging rot | Skill-first; generated wrappers; Tier 2 best effort |
| Licence contamination (GPL from ATB, js-dos, ScummVM tables; CC BY-SA catalog data) | Forced relicensing | Ideas only from GPL repos; GPL runtimes run as separate tools; share-alike data in separate files |
| Scope creep from "any game" | Never ships | Milestones with exit criteria; fixed ladder; Remote Play as the honest catch-all |

---

## 18. Calls I made (please check)

1. **Strategy C:** router + catalog + lanes + shell + verify.
2. **Node 22** as the only tool runtime; Python only inside lane toolchains.
3. **One skill** + references + 2 subagents + 3 commands + 2 hooks + project `AGENTS.md` + git hooks; **no MCP**; optional companions only.
4. **BYO-files** as the default data mode; bundled builds private.
5. **Remote Play** included and labeled, so every game gets an answer.
6. **A DRM'd exe means STOP** for in-browser lanes, even data-only ones (conservative; 04 §B.6 calls it unsettled).
7. **Milestone order:** cheap lanes + Tier 1 agents first; rewrite in M4; recomp in M5.
8. **Shared tool cache** `~/.port-any-game/` instead of a copy per port.
9. **Tier 1 = Claude Code, Codex, OpenCode, Copilot, skills-only.**
10. **Prebuilt GPL runtimes** from our CI, with source offers.
11. **Fork retro-port's template** for recomp; keep Python in that lane; offer fixes upstream.
12. **CI assumes a public GitHub repo** (free runners on 3 OSes); otherwise local gates and narrower claims.
13. **Flat repo layout** (repo root = plugin) instead of `plugins/<name>/`.
14. **ATBGamePort: ideas only (GPL)**, plus a new `rewrite-html5` lane. **No priming prompt, no branding, no hard companion skills.**
15. **Zero-install verify first:** the user's Chrome or Edge over CDP; Playwright only as fallback.
16. **Rights-holder / redistributable mode** unlocks public hosting with game data after an explicit, recorded user statement. Otherwise it's private only.
17. **Offline catalog** seeded from CC0 / CC BY / MIT / CC BY-SA (separate file) sources, with human-reviewed updates and no game-data URLs.
18. **BottleShip** added as the first Windows-runtime candidate, pending an M0 spike.
19. **Double-click player launchers** (`Play-Windows.bat` via the built-in PowerShell `HttpListener`) so players need nothing installed.

20. **Licence: MIT** for the plugin. Compatible with forking retro-port (MIT) and with the catalog seeds. GPL runtimes stay separate tools; CC BY-SA catalog data stays in its own file.
21. **Grey lanes** (`rewrite-html5`, `decomp-rebuild`, `recomp-x86`) ship marked *experimental* and acknowledgement-gated. An independent legal read of them is a **gate for v1.0**, not for earlier releases.
22. **GitHub org/repo name:** `<org>/port-any-game` stays a placeholder until the maintainer creates the repo. Nothing in the build depends on the name except the manifests and the README install block, which `scripts/validate.mjs` keeps in sync.

## 19. Answers (2026-11-17)

1. **Game scope:** all types of games. Motivation: open source. The milestone order stays "cheap lanes first", since that covers the most game types soonest.
2. **Release:** public open-source release, licensed MIT (call 20).
3. **Git:** no commits or pushes during planning. The maintainer commits and pushes later; CI on 3 OSes assumes the public repo then.
4. **§18 calls:** all approved.

## 20. Left to the implementation plan

- Exact `SKILL.md` wording.
- CLI flags beyond those shown.
- Rule compiler.
- Catalog JSON schema details (07 §6.2 is the starting point).
- Shell UI look.
- Per-lane build scripts.
- CI specifics.
- Release versioning (changesets or a simple bump script).
