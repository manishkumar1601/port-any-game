# 07: Catalogs and datasets for "does a browser path for this game already exist?"

Status: research note for planning. Nothing has been built. Current as of 2026-11-17.
Scope: which datasets and catalogs the `survey` → lane-routing step of "port-any-game" can use to find an existing reimplementation, decompilation, runtime or community web port for a specific game, *before* any engineering. Covers licences (can we vendor it?), identity mapping (local install → canonical ID), a proposed catalog schema and a matching algorithm.
**This is not legal advice.** Tags, as in note 04:
- `[V]`: verified against a primary source (fetched file, API response, repo, live page) during this research.
- `[S]`: from secondary sources only (news, aggregators, search snippets).
- `[K]`: background knowledge, not re-checked this session. Re-verify before implementing.

Raw downloads used for counts are in the session scratchpad (`research-catalogs/`), not in this repo. No game data was downloaded.

---

## TL;DR

1. **No single licence-clean catalog answers "is there a BYO-data web port of game X?".** We have to build a small curated catalog of our own and seed it from three vendorable sources:
   - **OSGameClones** (CC BY 4.0 content, MIT code): 3,302 clone/remake entries for 2,004 original games, YAML, with a `Web` platform flag (352 entries) and a `content: commercial` flag meaning "needs the original game's data". Originals carry English Wikipedia titles (1,623 of 2,004), which join cleanly to Wikidata. `[V]`
   - **Wikidata** (CC0): the identity crosswalk. Steam app ID (P1733, ~131k items), GOG slug (P2725, ~6.3k), Epic slug (P6278, ~4.9k), engine (P408, ~22k), plus **ScummVM ID (P12255, 304 items, same `engine:gameid` format as ScummVM's compatibility list)** and DOSBox compatibility ID (P11572, ~2.4k). `[V]`
   - **PortMaster** (MIT metadata in `PortMaster-New`): 1,551 handheld ports; **811 are not "ready to run" and carry an `inst` text naming the exact data files the user must supply** (e.g. Fallout 2: `critter.dat, master.dat, patch000.dat, data`). Not web, but the best machine-readable "required data files" source that exists. `[V]`
2. **Hash signatures for offline matching exist under CC BY-SA 4.0:** libretro-database's `DOS.dat` has 24,968 DOS titles keyed by executable name + size + CRC32 (version 2026.10.25), and `DOOM.dat`/`Quake*.dat`/`Wolfenstein 3D.dat` carry MD5/SHA-1 for WADs and PAKs. Vendor as a separately licensed file. `[V]`
3. **Do not vendor:** ScummVM's compatibility YAML (it lives in the GPL-3.0 `scummvm-web` repo; call the user's ScummVM instead, see 04), PCGamingWiki (CC BY-NC-SA, and anonymous Cargo queries return `permissiondenied` again today), IGDB (non-commercial only without a partnership, needs Twitch OAuth), MobyGames (API key, Cloudflare-blocks scripts), and the new web-port directories **AllRecomps** (149 browser ports, explicitly grants no licence), **Ported2Browser** (~300 listings, blocks scripts) and the Gitea **"Ultimate Catalog of Web Game Ports"** (930 games, no licence, links to sites that host commercial games). Use them only as *discovery feeds for human curators*. `[V]`
4. **Decompilation indexes are gone or console-centric.** decomp.dev now serves only a "Sunsetting decomp.dev" page at `/` and `/projects` `[V]`; its code and data were never openly licensed `[S]`. No maintained machine-readable list of *PC* decomps with web builds exists. GitHub topic search (`decompilation` 1,210 repos, `recompilation` 799) is the only queryable index, and it is noisy. `[V]`
5. **Browser-runtime compatibility lists are mostly not machine-readable.** Ruffle publishes only percentages (AVM1 99%/82%, AVM2 90%/82% language/API) `[V]`; EasyRPG's list is a forum thread last updated 2024-10 `[V]`; Boxedwine lists 39 apps `[V]`; dos.zone has no public list and hosts commercial games `[S]`. Engine detection (04) beats title lookup for these lanes.
6. **New since note 02: BottleShip** (Apache-2.0, v0.8, last commit 2026-11-12) runs *real x86 Win32 games* in the browser by emulating the CPU and reimplementing Win32/COM/DirectDraw/Direct3D 3–9 on WebGPU, with a published compatibility list and a BYO-installer model. It is a candidate rung-4 runtime and should be evaluated against Boxedwine and v86. `[V]`
7. **We checked 32 community BYO-data web ports for PC games** (liveness, README/licence, last commit; table in §4), including Augustus (Caesar III), fheroes2 web, playxcom.online (OpenXcom), OpenRCT2 Online, WebXash (Half-Life/CS 1.6), DiabloWeb, Jazz² Resurrection, PvZ-Portable, GeneralsX Web (C&C Generals ZH), ROLLER (Whiplash), Atlantis Native, and GMH-Code's Quake/Quake II/Doom/RTCW builds. Several popular "web ports" are **not** BYO: isle.pizza serves its own ~550 MB of LEGO Island data `[S]`, and Halo CE web needs an Xbox disc image `[V]`.
8. **Identity: Wikidata's GOG property stores slugs (`game/fallout_2`), not the numeric product ID in `goggame-<id>.info`; the numeric property P12727 is used on 1 item.** Bridge with GOG's public `api.gog.com/products/<id>` (returns `slug`, opt-in) or match on the `name` field offline. `[V]`
9. **Recommended design:** ship an offline catalog (our own CC0/MIT `games.json` + `ports.json`, plus separately licensed vendor extracts), match in tiers (store ID → file signatures → engine detection → fuzzy title, ask user), and refresh it in *our* CI with human review, never on the user's machine by default. The catalog must never contain a URL that downloads game data.

---

## 1. Reimplementation and remake catalogs (Q1)

### 1.1 Source table

| Source | URL | Format | Licence | Coverage (2026-11-17) | Web-build info? | Data-file info? | Update cadence | Vendor? |
|---|---|---|---|---|---|---|---|---|
| **OSGameClones** | osgameclones.com, github.com/opengaming/osgameclones | YAML: `games/*.yaml` (27 files, 1.76 MB), `originals/*.yaml`, validated by `schema/games.yaml` | Code **MIT**; content **CC BY 4.0** (LICENSE, © 2011–2016 Solovyov et al.) `[V]` | 3,302 entries (remake 1,750, clone 956, official 410, similar 137, tool 49) for 2,004 originals `[V]` | `platforms` enum includes `Web`: 352 entries; 70 are `Web` + `content: commercial/swappable` `[V]`. **Misses known web builds**: fheroes2 (upstream experimental Emscripten + community host), OpenRCT2 (in-tree `emscripten/`), OpenXcom (playxcom.online), OpenTTD (2019 community fork) all lack `Web` `[V]` | Only `content`: `commercial` = "requires data from original game" (1,012), `swappable` (24), `free`, `open`; none (978) `[V]`. No file lists | Very active: last commit 2026-11-14, 1,202 entries touched in 2026, has an `ai: true` flag (61 entries) `[V]` | **Yes**, with CC BY 4.0 attribution. Best seed. |
| **OSGL (Trilarion "Open Source Games List")** | github.com/Trilarion/opensourcegames | One Markdown file per entry (`entries/*.md`, 3,314 files incl. frameworks/tools) with `- Key: value` lines (Home, Inspiration, State, Keyword, Code repository, Code language, Code license) `[V]` | **CC0-1.0** `[V]` | ~1,800 games + libraries `[S]` | No dedicated web-build field seen in sampled entries `[V]`; "Download"/"Home" links only | Only via the `Keyword` line, e.g. OpenTTD "content original possible + open (swappable)" `[V]` | Sporadic: last commit 2026-10-10 `[V]`; star counts in entries are old (OpenTTD "@stars 5702" vs 8,509 live) | **Yes** (CC0). Use for `Inspiration` → original-game links and code-licence cross-check. |
| **Awesome Game Remakes** (radek-sprta) | github.com/radek-sprta/awesome-game-remakes | Markdown list | **CC BY-SA 4.0** `[V]` | 467 entries `[V]` | Free text only ("Playable at https://…") | Free text; entries *not* needing paid assets are marked with an emoji `[V]` | Active: pushed 2026-11-16 `[V]` | Possible but share-alike; low structure. Discovery feed. |
| **LibreGameWiki** | libregamewiki.org | MediaWiki (API works) | Text dual **GFDL 1.2 / CC BY 3.0** `[V]` | 1,405 articles, 11 active users `[V]` | Rarely | No | Low | Not worth it: libre-games focus, little on commercial-data remakes. |
| **PortMaster** | github.com/PortsMaster/PortMaster-New (port sources), github.com/PortsMaster/PortMaster-Info (`ports.json`, 4.1 MB, regenerated by a CI workflow) | JSON: per port `attr.{title, porter, desc, inst, rtr, store, genres, runtime, reqs, arch, exp, min_glibc}` `[V]` | PortMaster-New **MIT** (© 2021 christianhaitian) `[V]`; PortMaster-Info has **no licence file** `[V]` (it is generated from New) | 1,551 ports; **`rtr: false` (user must supply data) = 811**; `store` set on 724 (Steam 262, itch ~270, GOG ~59) `[V]` | No (ARM Linux handhelds) | **Yes, best in class**: `inst` names the files, e.g. fheroes2 "Add your own data, maps, music, sound folders from HOMM2 GOG version… lower case"; Fallout 2 "copy critter.dat, master.dat, patch000.dat and data"; Half-Life "copy the steam valve directory" `[V]` | Daily-ish (repos pushed 2026-11-15/16) `[V]` | **Yes for metadata**: regenerate from PortMaster-New `ports/<name>/port.json` files (MIT; same `attr` fields, verified for `ports/fheroes2/port.json`) rather than copying the unlicensed `ports.json`. Port payloads have their own licences; don't vendor them. |
| **libretro-database** | github.com/libretro/libretro-database | clrmamepro `.dat` text, compiled `.rdb` | **CC BY-SA 4.0** `[V]` | `DOS.dat` 24,968 entries (exe/disk-image name + size + CRC32, from the Total DOS Collection), `DOOM.dat` 145 games / 216 files with MD5+SHA-1, `Quake.dat` 10, `Quake II.dat` 2, `Wolfenstein 3D.dat` 11, `Cave Story.dat` 3 `[V]` | No | **Hash signatures**, e.g. `HEROES2W.EXE size 1596508 crc DE70B474` `[V]` | Active: last commit 2026-11-15; DOS.dat version 2026.10.25 `[V]` | **Yes**, as a separate CC BY-SA file with attribution. Check Total DOS Collection's own terms for the DOS subset (provenance not verified). |
| **SteamDB FileDetectionRuleSets**, **DiE**, **BinaryObjectScanner** | see 04 §A.7 | | MIT | engines/DRM, not titles | | | | Yes (already planned in 04). |
| **Lutris** | lutris.net | Installer scripts + API | Unclear for data `[K]` | Large | Occasionally (installers for web-based runtimes) | Installer scripts name required files `[K]` | Active `[K]` | No (licence unclear). Wikidata P7597 links to it (~72k items). |

### 1.2 What OSGameClones actually gives us (fields)

From `schema/games.yaml` `[V]`: `name`, `originals[]` (names of the cloned games; join key to `originals/*.yaml`), `type` (`remake|clone|official|similar|tool`), `repo`, `url`, `feed`, `development` (`complete|very active|active|sporadic|halted`), `status` (`playable|semi-playable|unplayable|N/A`), `platforms[]` (88-value enum incl. `Web`, `DOS`, `Windows`), `multiplayer[]`, `content` (`commercial|free|open|swappable`), `langs[]`, `frameworks[]`, `licenses[]` (37-value enum, not SPDX: `GPL2`, `AGPL3`, `As-is`, `Custom`…), `ai` (bool: contains LLM output), `info`, `added`, `updated`, `images[]`, `video{}`.
Originals: `name`, `names[]` (aliases, 393), `external.wikipedia` (1,623), `external.website` (1,400, often a MobyGames URL), `platforms[]`, `meta.{genres, subgenres, themes}` `[V]`.

Gaps for our use: no store IDs, no data-file lists, no web URL distinct from `url`, `Web` flag missing on several major projects, licence enum needs mapping to SPDX.

---

## 2. Decompilation project indexes (Q2)

| Source | Status (2026-11-17) | Machine-readable? | Licence | Use |
|---|---|---|---|---|
| **decomp.dev** | `/` and `/projects` both serve "Sunsetting decomp.dev" (AI-generated submissions "broke the community aspect"; public index/leaderboard off, no new projects) `[V]` + news `[S]` | Was (project pages/progress API); now no | Code never open-licensed; author reserves rights; asks replacements not to reuse its code `[S]` | None. Do not scrape Wayback copies into a product. |
| **decomp.me** | Up `[S]`; repo MIT, pushed 2026-11-16 `[V]` | Scratch-level only, not a project index | MIT (code) | Not an index. |
| **ghidra.decomp.dev** | Up `[S]` | n/a | n/a | n/a |
| **AllRecomps "Progress"** | 211 tracked projects as of 2026-10-18 `[S]`, mostly console→PC recomps | HTML only | Terms grant **no licence** `[V]` | Discovery only. |
| **GitHub topics** | `decompilation` 1,210 repos; `recompilation` 799; `reimplementation` 331; `matching-decompilation` 117; `decomp` 90; `game-decompilation` 15; `emscripten`+`game` 110 `[V]` | Yes (search API; unauthenticated limit 10 req/min, core 60 req/h; we hit the core limit during this research) `[V]` | Repo metadata; each repo its own licence | Discovery feed in CI, never on user machines. |
| **Curated lists** | nforest/awesome-decompilation; Sebastrion/awesome-unofficial-pc-ports (console→PC); alexgaoth/awesome-reverse-engineered "Game Decompilations & Reimplementations"; a "human-made decomps/recomps" Google Doc by Funky90sLion `[S]`; "awesome-decomp-games" (1,462 projects, auto-refreshed) — repo not located `[S]` | Markdown/Sheets | Mixed/unknown | Discovery only. |

**Conclusion.** No maintained, licence-clean, machine-readable list of PC-game decompilations with web builds exists. The useful PC set is small enough to curate by hand (§4 already covers most of it): LEGO Island (`isle` → `isle-portable`, LGPL-3.0), Whiplash/Fatal Racing (`ROLLER`, GPL-3.0), 3D Pinball Space Cadet (MIT), Diablo (`devilution`; the decomp repo's licence cannot license Blizzard's code), Jedi Knight DF2 (`OpenJKDF2`), Duke Nukem II (`Duke2Reconstructed`/RigelEngine), Fallout 1/2 CE (Sustainable Use License), GTA III/VC (`re3`/`reVC`, DMCA'd and sued over in 2021 `[K]`), Halo CE (Xbox) `[V]`. Treat any decomp-derived lane as **legal-risk: medium/high** (see 04 Part B) and record that in the catalog.

---

## 3. Browser-play and runtime compatibility catalogs (Q3)

| Catalog | What it lists | Machine-readable? | Licence of the list | Verdict |
|---|---|---|---|---|
| **ScummVM compatibility** | `data/en/compatibility.yaml` in `scummvm/scummvm-web` ("generated file, please do not edit"; source is an upstream spreadsheet): 1,041 rows / 695 unique IDs in `engine:gameid` form (e.g. `scumm:monkey2`), `support` excellent 289 / good 601 / bugged 47 / broken 63 / untested 41, `since_version`, `stable_platforms` `[V]` | Yes (YAML) | Repo is **GPL-3.0** `[V]` | Don't vendor into a non-GPL plugin. Link to the page; detect with the user's `scummvm --detect` (04). Wikidata P12255 maps QIDs → the same IDs (CC0). |
| **EasyRPG** | Forum topic "Compatibility List" (65 posts, created 2016-09-02, last post 2024-10-13), "Completable/Playable" labels `[V]` | No | None stated | Link only. Rule of thumb: unpatched RPG Maker 2000/2003 games generally run `[S]`; detect `RPG_RT.exe` + `RPG_RT.ldb` instead. |
| **Ruffle** | No per-game list. AVM1 language 99% / API 82%; AVM2 language 90% / API 82% `[V]`; per-game GitHub issues | No | MIT/Apache-2.0 code | Use engine detection (SWF/projector) only. itch.io re-enabled Flash games via Ruffle in Nov 2026 `[S]`. |
| **js-dos / dos.zone** | 1,900+ bundles `[S]`; no public JSON list found `[S]` | No | Hosted games are commercial titles without visible licences | Never link users to download bundles. Use js-dos as a runtime (GPL-2.0, see 02) with the user's own files. |
| **Internet Archive software library** | `advancedsearch.php` / `services/search/v1/scrape` metadata APIs `[S]` | Yes | Metadata reuse terms not found `[S]`; items are mostly copyrighted software | Don't use for routing; at most a link for preservation context. |
| **Boxedwine "Apps and Games"** | 39 entries (Win 3.x 9, Win32 29; GDI 20, DirectDraw 16, Direct3D 2, OpenGL 2, 3dfx 1, WinG 1; 20 with online demo), WordPress page `[V]` | Via WP REST, unstructured | None stated | Hand-copy facts (title, API) into our runtime notes. |
| **BottleShip** (new) | Real x86 Windows exes in the browser, no OS image; Win32/COM/DirectDraw/Direct3D 3–9/DirectSound on WebGPU/WebAudio; "native Win32 games from ~1997–2004"; `docs/compatibility.md`; online library only for demos/freeware, otherwise "bring your own legally-owned copy" (drop the offline installer) `[V]` | Markdown list | Code **Apache-2.0** `[V]` | Strong rung-4 candidate; evaluate in a follow-up to 02/05. Track its compatibility list as a runtime catalog. |
| **v86** | OS images, not games | No | BSD-2-Clause `[V]` | Runtime only. |
| **AllRecomps "Browser Ports"** | 149 curated browser projects with an access class: *Your game files* 23, *Demo* 5, *Direct access* 38, *Check requirements* 83; source/target platform; links `[V]` | HTML (paged) | Terms (updated 2026-11-03): "AllRecomps grants no license over these materials" `[V]` | Discovery only; also lists dozens of unauthorized "browser builds" of commercial Unity games. |
| **Ported2Browser** | ~277–300 listings (link directory, launched 2026-09-29) `[S]` | No (HTTP 403 to scripts) `[V]` | None found | Discovery only; mixes official demos, open-source ports and rehosts `[S]`. |
| **"Ultimate Catalog of Web Game Ports"** (gitea.com/10224530) | README table: 930 games, 517 with playable link, 617 with source, updated 2026-10-29 `[V]` | Markdown table | "Catalog data is provided as-is", no licence file `[V]` | Discovery only; links include sites that host commercial game data (rgc.zone, gn-math.dev) `[V]`. |
| **Classic Reload, dos.zone portal, Poki-style portals** | Hosted games | n/a | n/a | **Exclude.** Never route users there. |

---

## 4. Community "bring your own data" web ports (Q5)

Verification method: live HTTP fetch of the play URL on 2026-11-17 (all returned 200 unless noted), plus the project's README/LICENSE via jsDelivr and the last-commit date from the repo's Atom feed. "Data needed" quotes or paraphrases the project. Ordered roughly by how cleanly they fit the BYO model.

| Original game (platform) | Project → web URL | Type / engine | Licence | Data the user supplies | Last activity | Notes |
|---|---|---|---|---|---|---|
| Caesar III (Win) | **Augustus** → augustus.josecadete.net/play/ | Reimpl. (Julius fork), Emscripten | AGPL-3.0 `[V]` | "a valid Caesar 3 installation folder" (folder picker / drag-drop) `[V]` | 2026-11-12 `[V]` | Julius itself (AGPL-3.0) has no hosted web build found. |
| Pharaoh (Win) | **Akhenaten** → dalerank.github.io/Akhenaten/play/ | Reimpl. | AGPL-3.0 `[V]` | Original Pharaoh/Cleopatra files `[S]` (README points to Steam/GOG) | 2026-11-17 `[V]` | Very active. |
| Heroes of M&M II (DOS/Win) | **fheroes2 web** (Carter54git) → buildenginegames.online/homm2webgit/index.html | fheroes2 1.1.17, Emscripten | GPL-2.0 `[V]` | `DATA/` (`HEROES2.AGG`), `MAPS/`, `MUSIC/`, optional `ANIM/` via folder pick or ZIP; saves in IndexedDB `[V]` | 2026-07-13 `[V]` | Upstream fheroes2 ships an *experimental* `Makefile.emscripten` (needs COOP/COEP for threads) but no hosted build `[V]`. |
| X-COM: UFO Defense (DOS/Win) | **playxcom.online** | OpenXcom (GPL-3.0) wasm, third party | Site doesn't link source `[V]` | UFO folder (`GEODATA`, `GEOGRAPH`, `MAPS`, `SOUND`…), stored in IndexedDB, "nothing is uploaded" (site claim) `[V]` | unknown | Closed build of a GPL engine: ask for source before recommending. |
| RollerCoaster Tycoon 2 (Win) | **OpenRCT2 Online** → openrct2-online.pages.dev | OpenRCT2 (GPL-3.0) wasm, third party | — | "upload your RCT2 files" `[V]` | unknown | Upstream OpenRCT2 has an in-tree `emscripten/` directory on `develop` `[V]` → self-host path exists. |
| Half-Life, CS 1.6 (Win) | **WebXash** → x8bitrain.github.io/webXash/ | Xash3D-FWGS wasm (`xash3d-fwgs` npm 1.2.2, MIT wrapper) `[V]` | Frontend: none detected `[V]` | "Open game folder": root containing `valve/` and/or `cstrike/`; read-only, copied into an in-memory FS `[V]` | 2026-01-28 `[V]` | Upstream repo `yohimik/webxash3d-fwgs` returns 404 today `[V]`. Half-Life SDK code has its own non-free licence `[K]`. |
| Diablo (Win) | **DiabloWeb** → d07riv.github.io/diabloweb/ | devilution → wasm | Frontend: no licence file; engine fork `d07RiV/devilution`: Unlicense (does not license Blizzard's code) `[V]` | Shareware `spawn.mpq` is hosted; full game needs your `DIABDAT.MPQ` `[V]` | 2022-05 `[V]` | Unmaintained but works. |
| Diablo (Win) | **Diablo Web** (JohnImril) → johnimril.github.io/diablo_web/ | DiabloWeb fork, modern UI | None detected `[V]` | "Load Your MPQ" / drop `DIABDAT.MPQ`; free demo `[V]` | 2026-11-14 `[V]` | Maintained successor. |
| Jazz Jackrabbit 2 (Win) | **Jazz² Resurrection** → de4th.dev/jazz2/wasm/ | Reimpl. (C++) | GPL-3.0 `[V]` | "Import episodes from original Jazz Jackrabbit 2 directory" to unlock content; shareware playable `[V]` | 2026-11-16 `[V]` | |
| Jazz Jackrabbit (DOS) | **OpenJazz web** → openjazz.github.io | Reimpl. | GPL-2.0+ `[V]` | "files from one of the original games" `[V]` | 2026-09-01 `[V]` | |
| Atlantis: The Lost Tales (Win) | **Atlantis Native** → ripleyxlr8.github.io/atlantis-native/ | Reimpl. | GPL-3.0+ `[V]` | "your own copy of the game needed" (folder / ISO picker) `[V]` | 2026-11-17 `[V]` | |
| Plants vs. Zombies GOTY (Win) | **PvZ-Portable** → wszqkzqk.github.io/PvZ-Portable/pvz-portable.html | Engine recreation | LGPL-3.0 `[V]` | `main.pak` + `properties/` from a legal GOTY copy `[V]` | 2026-11-14 `[V]` | |
| C&C Generals Zero Hour (Win) | **GeneralsX Web** → generals.wasm.ltd | EA's GPL source release → WebGPU/wasm | Engine GPL-3.0, page MIT `[V]` | "bring your own installed copy of the game" `[V]` | 2026-08-14 `[V]` | Assets streamed from the user's copy. |
| Whiplash / Fatal Racing (DOS) | **ROLLER** → play.fatal.racing | Decompilation | GPL-3.0 `[V]` | Freeware demo bundled; "import an image of a legally owned retail disc for the full game" `[V]` | 2026-11-05 `[V]` | Clean demo-plus-BYO model. |
| Quake (DOS/Win) | **Qwasm** → gmh-code.github.io/qwasm/ (redirects to qwasm.m-h.org.uk) | id Quake engine | GitHub detects none; id's Quake source is GPL-2.0 `[K]` | `pak0.pak` (shareware) / add `pak1.pak` (full); lowercase names `[V]` | 2024-12-11 `[V]` | |
| Quake II (Win) | **Qwasm2** → gmh-code.github.io/qwasm2/ | Yamagi Quake II | Multi-licence file (Yamagi notice) `[V]` | `pak0.pak` from shareware or full `[V]` | 2026-04-18 `[V]` | |
| Doom / Doom II (DOS) | **Dwasm** → gmh-code.github.io/dwasm/ | PrBoom+/PrBoomX | GPL-2.0 `[V]` | An IWAD; Freedoom works `[V]` | 2026-04-14 `[V]` | Cloudflare's `doom-wasm` (Chocolate Doom, 2024-09) is a shareware-only demo `[V]`. |
| Return to Castle Wolfenstein (Win) | **Wwasm** → gmh-code.github.io/wwasm/ | iortcw | GPL-3.0 `[V]` | "at least one .pk3": demo or full `[V]` | 2025-12-30 `[V]` | rtcw.pieter.com is MP-only on a demo map `[S]`. |
| Quake III Arena (Win) | **Q3JS** → q3js.com | ioquake3 + wasm client, WebSocket→UDP gateway | Mixed ("Multi-License Notice") `[V]` | "Q3JS does not include or download proprietary Quake III Arena game data. You must provide your own legally obtained PK3 files." `[V]` | 2026-10-12 `[V]` | ioquake3 itself has an Emscripten target `[K]`. |
| Duke Nukem 3D (DOS) | **eduke32-wasm** → digitalcybersoft.github.io/eduke32-wasm/ | EDuke32 (downstream fork) | GPL-2.0 + BUILD licence `[K]` | Shareware episode bundled; "import your own retail `DUKE3D.GRP` once through the settings panel"; persisted in IndexedDB `[V]` | 2026-08-20 `[V]` | midzer.de/wasm/duke3d (Chocolate Duke) also exists `[S]`. |
| Commander Keen 1–3 (DOS) | **Chocolate Keen** → jamesfmackenzie.com/chocolatekeen/ | Reimpl. | None detected `[V]` | Episode 1 bundled; episodes 2–3 need your level/data files (desktop: `GAMEDATA/`) `[V]` | 2026-03-28 `[V]` | |
| Tomb Raider (DOS/Win) | **OpenLara** → xproger.info/projects/OpenLara/ | Reimpl. | BSD-2-Clause `[V]` | Hosted demo levels; page has a file input for your own level files `[V]` | 2026-07-26 `[V]` | |
| Jedi Knight: Dark Forces II (Win) | **OpenJKDF2** | Decomp-derived reimpl. | Custom (LICENSE.md opens with a Lucasfilm notice; GitHub: NOASSERTION) `[V]` | "requires game data from a licensed copy" `[V]` | 2026-11-01 `[V]` | README documents an Emscripten/WebGL 2 target; no official hosted page found. |
| Lego Rock Raiders (Win) | **Rock Raiders Web** → scarabol.github.io/rock-raiders-web/ | TS reimpl. | None detected `[V]` | Original game files, read in the browser (CAB/WAD tooling credited) `[S]` | 2026-11-06 `[V]` | |
| Star Wars: KotOR I/II (Win) | **KotOR.js** → swkotor.net | TS engine reimpl. | GPL-3.0 `[V]` | "a valid copy of either KotOR I or KotOR II installed"; no game files distributed; `dist/` is self-hostable `[V]` | 2026-09-14 `[V]` (KobaltBlu/KotOR.js) | Semi-playable. |
| The Legend of Sword and Fairy (DOS) | **SDLPAL** → sdlpal.github.io/sdlpal/ | Reimpl. | GPL-3.0 `[V]` | Original data files `[V]` (page text) | 2026-11-14 `[V]` | |
| Celeste (Win) | **Webleste / celeste-wasm** → celeste.r58playz.dev | FNA → .NET wasm (decompiled + patched) | No licence file `[V]` | `Content/` from your install `[V]` (build docs) | 2026-08-26 `[V]` | ~600 MB RAM; decompile-based → grey. |
| Terraria (Win) | **terraria-wasm** → terraria.mercurywork.shop | FNA → .NET wasm | No licence file `[V]` | Game assets from your copy `[V]` | 2025-06 `[V]` | Same caveats. |
| Fallout 2 (Win) | **fallout2-ce web fork** (roginvs) | fallout2-ce + Emscripten/asyncify | Sustainable Use License (non-commercial) `[V]` | `master.dat`, `critter.dat`, `patch000.dat`, `data/` `[V]` | 2026-11-11 `[V]` | Hosted site (fallout-nevada.ru) runs the free Nevada/Sonora total conversions `[S]`; upstream `fallout2-ce/fallout2-ce` has no web target `[V]`. |
| Fallout (Win) | **fallout1-ce fork** (midzer, listed as the source of a web build) `[S]` | fallout1-ce | Sustainable Use License `[V]` | `master.dat`, `critter.dat`, `data/` `[V]` | 2023-11-22 `[V]` | Web target not confirmed in its README; hosted copies found only on rehost sites → don't link. |
| GTA: Vice City (Win) | **gta-vice-city-wasm** → joncodeofficial.github.io/gta-vice-city-wasm/ | reVC-derived | MIT (wrapper) `[V]` | "You need GTA: Vice City for PC installed"; files stay local `[V]` | 2026-11-12 `[V]` | **High legal risk**: re3/reVC were DMCA'd by Take-Two `[K]`. Catalog as `legal_risk: high`, opt-in only. |
| Generic Win32 (1997–2004) | **BottleShip** → bottleship.happydog.games | x86 emulation + Win32/D3D→WebGPU | Apache-2.0 `[V]` | Your offline installer `[V]` | 2026-11-12 `[V]` | A runtime, not a per-game port. |
| **Not BYO, stale or down (for contrast)** | | | | | | |
| LEGO Island (Win) | isle.pizza | isle-portable (LGPL-3.0) + MIT frontend `[V]` | — | Hosted site offers a ~550 MB offline install of game files `[S]` | 2026-11-08 `[V]` | BYO path = self-host isle-portable's Emscripten build + isle.pizza frontend; `npm run prepare:assets` points at *your* install or ISO `[V]`. |
| Halo: CE (Xbox) | mitchellhynes.com/halo ("Combat Lab") | Decomp → wasm | — | XISO of *your Xbox disc* `[V]` | 2026-09/10 `[S]` | Console data; out of scope for PC installs. |
| Transport Tycoon Deluxe | milek7.pl/openttd-wasm/ | OpenTTD fork | GPL-2.0 | Runs on free OpenGFX `[K]` | 2021-05 (last push) `[V]` | Stale; upstream has no web target. |
| Duke Nukem II | RigelEngine web | | GPL-2.0 | | — | README: web version "currently not working" `[V]`. |

Other live web builds seen in OSGameClones/AllRecomps but not verified for BYO here: three-quake / three-descent (mrdoob, 2026), Iron Wolf (Wolf3D; PowerShell 5.1 TLS failed to connect), Chrono Divide (RA2, closed source), LBA2 remake (self-host import script, MIT), Settlers.ts (Settlers IV, MIT, stale 2022), Space Cadet Pinball Emscripten (MIT code, 2021), daggerfalljs.dev (Daggerfall is freeware), Cricket 07 web.

**Patterns worth encoding in the catalog:** input method (`folder_picker` via File System Access / `webkitdirectory`, `zip_upload`, `drag_drop`, `disc_image`), persistence (`indexeddb`/`opfs`), required COOP/COEP headers for threaded builds (fheroes2, terraria-wasm), case-sensitivity of file names (Qwasm wants lowercase, PortMaster's fheroes2 note says the same), and whether a demo/shareware path exists.

---

## 5. Game identity: local install → canonical ID (Q4)

### 5.1 Offline markers (read-only, no network)

| Store | Marker | ID it yields | Notes |
|---|---|---|---|
| Steam | `steam_appid.txt` in the game dir; `steamapps/appmanifest_<appid>.acf` (KeyValues: `appid`, `name`, `installdir`, `buildid`); `steamapps/libraryfolders.vdf` | Steam app ID (numeric) | 04 §A covers `steam_api` vs SteamStub. The `.acf` `name` is a good offline title. `[K]` |
| GOG | `goggame-<productId>.info` (JSON: `gameId`, `rootGameId`, `name`, `playTasks`, …) | GOG numeric product ID | **Wikidata does not use numeric IDs**: P2725 values are slugs (`game/fallout_2`; Stardew Valley carries both `game/stardew_valley` and `stardew_valley`), and the numeric P12727 is on 1 item `[V]`. Bridge: `api.gog.com/products/<id>` returns `title` + `slug` without auth (checked with 1207658924 → `the_witcher`) `[V]` (opt-in). |
| Epic | `.egstore/*.mancpn` in the game dir; `C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests\*.item` (JSON: `AppName`, `InstallLocation`, catalog item/namespace IDs) `[S]` | Epic catalog item ID / AppName | `AppName` is often a codename (e.g. "Turaco") `[S]`. Wikidata P6278 stores the store slug, not these IDs `[V]`. |
| itch.io | `.itch/receipt.json.gz` (game ID + upload ID) `[S]` | itch numeric game ID | Wikidata P12813 "itch.io numeric ID" exists `[V]`. |
| Amazon, EA app, Ubisoft | `fuel.json`, `__Installer/installerdata.xml`, `uplay_install.state` `[K]` | store-specific | Low priority for retro titles. |
| Retail/CD/abandonware | none | — | Fall back to file signatures (§6) and the PE `VERSIONINFO` `ProductName`. |

Reference parsers to read (not vendor blindly): Playnite's library plugins (Playnite is MIT `[V]`), the Rust crates `game-detector` / `game-scanner` `[S]`.

### 5.2 Online resolvers (opt-in only)

| Resolver | What it maps | Terms / licence | Access today | Use? |
|---|---|---|---|---|
| **Wikidata** | QID ↔ Steam (P1733, ~131k items), GOG slug (P2725, ~6.3k), Epic (P6278, ~4.9k), itch (P12813), PCGW (P6337, ~46k), IGDB (P5794, ~155k), MobyGames (P11688, ~73k), Lutris (P7597, ~72k), engine (P408, ~22k; ~10.8k also have a Steam ID), source repo (P1324), **ScummVM ID (P12255, 304)**, **DOSBox Compatibility ID (P11572, ~2.4k)**; enwiki sitelink joins to OSGameClones originals. Counts are CirrusSearch `haswbstatement` hit totals `[V]` | **CC0** (structured data) `[K]` | Action API works; **WDQS SPARQL returned 429 "1 req/min during active wdqs outage"** today `[V]` | **Yes.** Pre-extract a crosswalk in CI; at runtime only `wbgetentities`/`haswbstatement:P1733=<id>` with the ID, never the path or username. |
| **Wikidata classes** | `source port` (Q7565159): 102 items (92 with P144 "based on"); `game engine recreation` (Q17083583): 34 (19 with P144) `[V]` | CC0 | — | Too sparse to drive port discovery; fine as a cross-check. |
| **GOG product API** | numeric ID → slug/title | GOG terms `[K]` | Public JSON `[V]` | Opt-in bridge for GOG installs. |
| **IGDB** | Steam/GOG/Epic IDs → IGDB game (`external_games`) | "Free for non-commercial usage under the terms of the Twitch Developer Service Agreement"; commercial use needs a partnership with user-facing attribution; local caching allowed `[V]` | Requires Twitch OAuth client ID + secret; documents an MCP server `[V]` | Optional "bring your own key" only. |
| **MobyGames** | Rich metadata | Free key for non-profit; for-profit by request `[S]`; claims it stopped being free in 2024 `[S]` | Cloudflare 403 to scripts `[V]` | No. Link via Wikidata P11688. |
| **PCGamingWiki** | Engine, store IDs, DRM | Content CC BY-NC-SA 3.0 `[S]` | Anonymous `cargoquery` → `permissiondenied` (re-checked today); `action=parse` wikitext still works; `/api/appid.php` 403 to scripts `[V]` | No vendoring (NC). Link the page by Wikidata P6337. |
| **Steam store/app list** | app ID → name | Steam Web API terms `[K]` | Unofficial endpoints `[K]` | Unneeded: `.acf` already has `name`. |

**Best legally safe approach:** resolve identity locally first (store marker → our vendored crosswalk), then file signatures. Network lookups are an explicit opt-in that send only a store ID to Wikidata (or GOG for slug bridging), never paths, hashes of personal files, or usernames.

---

## 6. Recommendation: catalog schema, sources, updates, matching

### 6.1 Files and licensing layout

```
catalog/
  games.json          # our curated originals + identity crosswalk         (CC0, ours)
  ports.json          # lanes per game: reimpl / decomp / runtime / BYO web  (CC0, ours)
  signatures.json     # file-set and hash rules we wrote                     (CC0, ours)
  sources.lock.json   # every upstream: URL, commit/date, licence, attribution text
vendor/
  osgameclones/       # pinned YAML subset                                    (CC BY 4.0)
  libretro/           # DOS.dat, DOOM.dat, Quake*.dat, Wolfenstein 3D.dat     (CC BY-SA 4.0)
  wikidata/           # crosswalk extract                                     (CC0)
  portmaster/         # title/inst/rtr/store extracted from port.json files   (MIT)
NOTICE                # attributions required by CC BY / CC BY-SA / MIT
```

Keep share-alike data in its own files so the plugin code and our own catalog are not pulled into CC BY-SA. Nothing GPL or NC is vendored (ScummVM compat, PCGamingWiki).

### 6.2 Schema (one game, abridged)

```yaml
id: heroes-of-might-and-magic-2          # our stable slug
title: "Heroes of Might and Magic II: The Succession Wars"
aka: ["HoMM2", "Heroes 2", "Heroes of Might and Magic II Gold"]
year: 1996
original_platforms: [DOS, Windows]
ids:                                      # values below verified 2026-11-17
  wikidata: Q532912                       # P2725 = game/heroes_of_might_and_magic_2_gold_edition
  steam: []
  gog_slug: ["game/heroes_of_might_and_magic_2_gold_edition"]
  gog_product: [1207658785]               # api.gog.com title "Heroes of Might and Magic® 2: Gold"; filled by our CI, not Wikidata
  epic: []
  scummvm: null                           # P12255, e.g. "mohawk:myst"
  dosbox_comp: 2032                       # P11572
  igdb: heroes-of-might-and-magic-ii-gold # P5794, link only
  mobygames: [1513, 9888]                 # P11688, link only
  osgc_original: "Heroes of Might and Magic II"   # = enwiki sitelink title
  pcgw: "Heroes_of_Might_and_Magic_II"    # P6337, link only
engine: {name: "proprietary", wikidata: null}
signatures:                               # how survey recognizes an install
  - kind: fileset                         # case-insensitive relative paths (illustrative; derive real sets from the lane docs)
    all: ["DATA/HEROES2.AGG"]
    any: ["HEROES2W.EXE", "HEROES2.EXE"]
    variant: gold-gog
  - kind: exe_crc                         # from vendor/libretro/DOS.dat
    name: HEROES2W.EXE
    size: 1596508
    crc32: DE70B474
    variant: price-of-loyalty             # DOS.dat lists this row under the expansion
    source: libretro-dos
lanes:
  - kind: reimpl                          # reimpl | decomp | runtime | byo_web_port | engine_export
    project: fheroes2
    repo: https://github.com/ihhub/fheroes2
    license: GPL-2.0                      # as GitHub reports it; record "-only"/"-or-later" after reading the headers
    license_flags: [copyleft]             # + noncommercial | sustainable-use | none-found | proprietary-sdk
    web:
      availability: community             # official | community | self-host-only | none
      url: https://buildenginegames.online/homm2webgit/index.html
      self_host: {recipe: "emmake make -f Makefile.emscripten", needs_coop_coep: true}
      data_mode: byo                      # byo | demo+byo | free-data | hosted (never recommended)
      input: [folder_picker, zip_upload]
      persistence: indexeddb
    required_data:
      - {path: "DATA/", must_include: ["HEROES2.AGG"]}
      - {path: "MAPS/"}
      - {path: "MUSIC/", optional: true}
      - {path: "ANIM/", optional: true}
      notes: "GOG, CD or Buka install; lower-case folder names on case-sensitive FS"
    status: {playable: playable, upstream_activity: very-active, url_checked: 2026-11-17, check: http200+title}
    legal: {risk: low, notes: "reimplementation; user supplies data"}
    provenance: [osgameclones, portmaster:fheroes2.zip, manual]
```

Hard rules, enforced by a CI lint: no field may contain a URL that serves game data; `data_mode: hosted` entries are stored only to *warn* and are never shown as a lane; every lane must have `license` and `legal.risk`; `url_checked` older than 90 days downgrades confidence.

### 6.3 Seeding plan (licence-compatible)

1. **OSGameClones** (CC BY 4.0): import originals + clones whose `content` is `commercial`/`swappable` and whose `status` is `playable`/`semi-playable` → candidate `reimpl` lanes. Map the licence enum to SPDX. Join originals to Wikidata through `external.wikipedia` (enwiki sitelink).
2. **Wikidata** (CC0): for those QIDs pull P1733, P2725, P6278, P12813, P408, P12255, P11572, P6337, P5794. Normalize GOG slugs (some lack the `game/` prefix).
3. **PortMaster-New** (MIT): copy `inst` text into `required_data.notes` for games we list; derive file names by hand (the text is prose).
4. **libretro-database** (CC BY-SA 4.0): import exe/size/CRC rows only for games in our catalog (keep the subset file separate).
5. **Hand curation**: the §4 table as the initial `byo_web_port` set; AllRecomps, Ported2Browser and the Gitea catalog are *read by curators*, not scraped.
6. **Our own runtime notes** for engine lanes (ScummVM, EasyRPG, Ruffle, js-dos, Boxedwine, BottleShip) keyed by engine fingerprint, not by title.

### 6.4 Keeping it updated

- A scheduled CI job in the plugin repo (weekly): pull pinned upstreams, diff, open a PR. A human approves additions.
- A monthly liveness job: GET each `web.url`, record status + `<title>`, flag 4xx/5xx, flag repos whose Atom feed is older than 12 months. (Several BYO sites change hands or go dark: webxash3d-fwgs repo 404, RigelEngine web down, Halo intermittently down `[V]`/`[S]`.)
- Ship the catalog inside the plugin; `pag catalog update` (opt-in) downloads a signed JSON release asset from our repo. No user machine ever queries GitHub search or scrapes third-party catalogs.

### 6.5 Matching algorithm (offline-first)

```
input: survey manifest (relative paths, sizes, exe hashes, engine fingerprints, store markers)

T1 store ID      steam_appid / appmanifest / goggame / .mancpn / receipt → crosswalk lookup
                 → match (confidence 0.95)
T2 file sets     for each catalog signature: all/any path sets (case-insensitive, normalized
                 separators) + optional size; exe name+size+CRC32 (libretro DOS);
                 WAD/PAK MD5 → match (0.9 with hash, 0.75 names+sizes)
T3 engine        04 fingerprints → runtime lanes regardless of title
                 (SWF→Ruffle, RPG_RT→EasyRPG, ScummVM --detect hit → ScummVM ID → P12255 → QID)
T4 title         candidates from .acf name, goggame name, VERSIONINFO ProductName, folder name;
                 normalize (strip ™®©, edition words, punctuation; roman↔arabic numerals;
                 "the" prefix) → token-set similarity vs title+aka → suggest only; user confirms
T5 opt-in net    Wikidata by store ID; GOG product → slug
then: for each lane of the matched game, check required_data against the manifest
      → ready | missing [files] | wrong-variant (e.g. Steam vs CD layout, missing music)
rank: data_mode byo/demo+byo > self-host-only; maintained > stale; legal.risk low > high;
      licence flags (noncommercial/sustainable-use) shown, not hidden
output: lane + link + exact instructions ("select the folder that contains DATA/ and MAPS/");
        the tool never downloads or uploads game data
```

Title search alone is never enough to claim a lane: a lane is "ready" only when T1/T2 matched and its `required_data` check passes. Example of why: the same game is "Heroes of Might and Magic® 2: Gold" at GOG, "Heroes of Might and Magic II" on enwiki/OSGameClones, and `heroes-of-might-and-magic-ii-gold` at IGDB `[V]`; a GOG install resolves exactly through `goggame-1207658785.info` → slug → Q532912, while fuzzy title matching needs ®-stripping, "2"↔"II" and edition-word removal.

---

## 7. Open risks

1. **Licence contamination.** CC BY-SA (libretro), GPL (ScummVM compat) and NC (PCGamingWiki) data must stay out of our own files. EU sui generis database right may apply to wholesale extraction even of "facts" from unlicensed catalogs (AllRecomps, Ported2Browser, Gitea list) `[K]`.
2. **Third-party BYO sites are unverifiable.** "Nothing is uploaded" is a site claim; closed builds of GPL engines (playxcom.online, OpenRCT2 Online) may not honour source obligations; sites can switch to hosting data. Prefer projects with source + self-host recipe; mark third-party hosts `trust: unverified`.
3. **Takedowns.** Decomp-derived ports (re3/reVC lineage, Halo, Celeste/Terraria .NET decompiles) can disappear or draw legal action; the catalog must carry `legal.risk` and the UI must not auto-select high-risk lanes.
4. **Staleness.** OSGameClones misses `Web` on major projects; web URLs rot; OSGL star counts are old. Liveness checks and human review are required.
5. **AI-generated port wave (2026).** decomp.dev closed over low-quality AI submissions; OSGameClones now flags `ai` (61 entries); many new "browser builds" are unauthorized rehosts of commercial games. Curators need a provenance checklist (source link, licence, data model).
6. **Identity gaps.** GOG numeric IDs are absent from Wikidata; Epic manifests use codenames; Wikidata slug formats are inconsistent; WDQS was rate-limited during an outage today. Vendoring the crosswalk avoids runtime dependence.
7. **Hash provenance.** libretro's DOS.dat comes from the Total DOS Collection; confirm upstream terms before shipping that subset. Hashes identify variants but some sites repack data (different hashes for the same game), so hash misses must fall back to file-set matching.
8. **Non-commercial licences** (Sustainable Use License on fallout1/2-ce, IGDB without partnership) constrain commercial distribution of the plugin or a hosted service; surface `license_flags` to the user.
9. **Privacy.** Any opt-in lookup must send only store IDs. Never send file lists or paths to third-party catalogs.

---

## Sources (all accessed 2026-11-17 unless noted)

Catalogs and datasets
- OSGameClones repo, LICENSE, `schema/games.yaml`, `games/*.yaml`, `originals/*.yaml` (via jsDelivr): https://github.com/opengaming/osgameclones ; https://osgameclones.com/
- OSGL (Trilarion): https://github.com/Trilarion/opensourcegames ; table https://trilarion.github.io/opensourcegames/table.html
- Awesome Game Remakes: https://github.com/radek-sprta/awesome-game-remakes
- LibreGameWiki copyrights + siteinfo API: https://libregamewiki.org/Libregamewiki:Copyrights
- PortMaster-New (MIT): https://github.com/PortsMaster/PortMaster-New ; PortMaster-Info `ports.json`: https://github.com/PortsMaster/PortMaster-Info
- libretro-database (CC BY-SA 4.0), `dat/DOS.dat`, `dat/DOOM.dat`, `dat/Quake.dat`: https://github.com/libretro/libretro-database
- ScummVM web data (`data/en/compatibility.yaml`, GPL-3.0 repo): https://github.com/scummvm/scummvm-web ; data-model thread https://lists.scummvm.org/pipermail/scummvm-devel/2020-September/012509.html
- EasyRPG compatibility topic (Discourse JSON): https://community.easyrpg.org/t/compatibility-list/283
- Ruffle compatibility: https://ruffle.rs/compatibility ; itch.io Flash via Ruffle: https://www.gamingonlinux.com/2026/11/itch-io-founder-announces-the-return-of-flash-games-thanks-to-open-source/
- Boxedwine apps: https://www.boxedwine.org/search-apps/
- BottleShip: https://github.com/jenissimo/bottleship ; https://bottleship.happydog.games
- js-dos / DOS.Zone docs: https://js-dos.com/v7/build/docs/doszone
- AllRecomps browser ports + terms: https://allrecomps.com/browser-ports/ ; https://allrecomps.com/terms/ ; coverage https://pasqualepillitteri.it/en/news/25219/decompiled-recompiled-pc-games-allrecomps
- Ported2Browser coverage: https://xenospectrum.com/en/ported2browser-browser-game-ports-copyright/ ; https://korben.info/en/ported2browser-200-games-in-your-browser.html
- Ultimate Catalog of Web Game Ports: https://gitea.com/10224530/Ultimate-Catalog-Of-Web-Game-Ports

Decompilation
- decomp.dev sunset page: https://decomp.dev/ ; news https://www.videogameschronicle.com/news/one-of-the-biggest-game-decompilation-sites-is-closing-because-ai-has-broken-the-community-aspect/ ; https://www.timeextension.com/news/2026/10/the-community-aspect-of-decompilation-has-been-broken-decomp-dev-closes-in-the-wake-of-ai-based-bad-actors (2026-10)
- decomp.me: https://github.com/decompme/decomp.me
- Human-made decomps list: https://retrododo.com/a-list-of-human-made-decomps-recomps-has-arrived-to-filter-out-ai-projects/
- GitHub topic counts: https://api.github.com/search/repositories?q=topic:decompilation
- awesome-decompilation: https://github.com/nforest/awesome-decompilation ; awesome-unofficial-pc-ports: https://github.com/Sebastrion/awesome-unofficial-pc-ports

Identity
- Wikidata API (`wbgetentities`, `haswbstatement`, property search): https://www.wikidata.org/w/api.php ; properties P1733, P2725, P12727, P6278, P12813, P408, P6337, P5794, P11688, P7597, P1324, P12255, P11572
- Sample entities: https://www.wikidata.org/wiki/Q910938 (Fallout 2), https://www.wikidata.org/wiki/Q532912 (HoMM II), https://www.wikidata.org/wiki/Q189784 (Doom)
- GOG product API: https://api.gog.com/products/1207658924 ; https://api.gog.com/products/1207658785 ; catalog search https://catalog.gog.com/v1/catalog
- Playnite (MIT, store library plugins): https://github.com/JosefNemec/Playnite
- IGDB API docs (terms, FAQ, MCP): https://api-docs.igdb.com/
- MobyGames API docs: https://www.mobygames.com/info/api/ (403 to scripts; content via search snippets)
- PCGamingWiki API: https://www.pcgamingwiki.com/w/api.php ; https://github.com/PCGamingWiki/api
- Epic manifests: https://jayd.ml/games/2020/05/16/epic-games-store-steam-libraries.html ; itch receipts: https://itch.io/t/937345/how-to-find-receiptjson-file-for-previously-downloaded-games

BYO-data web ports (project repo READMEs/LICENSE via jsDelivr; live pages via HTTP)
- Augustus: https://github.com/Keriew/augustus ; https://augustus.josecadete.net/play/
- Akhenaten: https://github.com/dalerank/Akhenaten ; https://dalerank.github.io/Akhenaten/play/
- fheroes2 web: https://github.com/Carter54git/fheroes-1.1.17-ported-to-web ; https://buildenginegames.online/homm2webgit/index.html ; upstream Emscripten notes https://ihhub.github.io/fheroes2/README_emscripten.html
- playxcom.online: https://playxcom.online/
- OpenRCT2 Online: https://openrct2-online.pages.dev/ ; in-tree target https://github.com/OpenRCT2/OpenRCT2/tree/develop/emscripten
- WebXash: https://github.com/x8BitRain/webXash ; https://x8bitrain.github.io/webXash/ ; npm https://registry.npmjs.org/xash3d-fwgs
- DiabloWeb: https://github.com/d07RiV/diabloweb ; Diablo Web: https://github.com/JohnImril/diablo_web
- Jazz² Resurrection: https://github.com/deathkiller/jazz2-native ; https://de4th.dev/jazz2/
- OpenJazz: https://github.com/AlisterT/openjazz
- Atlantis Native: https://github.com/ripleyxlr8/atlantis-native
- PvZ-Portable: https://github.com/wszqkzqk/PvZ-Portable
- GeneralsX Web: https://github.com/origami-ltd/wasm-generals ; https://generals.wasm.ltd
- ROLLER: https://github.com/FatalDecomp/ROLLER ; https://play.fatal.racing/
- GMH-Code Qwasm/Qwasm2/Dwasm/Wwasm: https://github.com/GMH-Code/Qwasm ; https://github.com/GMH-Code/Qwasm2 ; https://github.com/GMH-Code/Dwasm ; https://github.com/GMH-Code/Wwasm
- Q3JS: https://github.com/lklacar/q3js ; https://q3js.com/
- eduke32-wasm: https://github.com/digitalcybersoft/eduke32-wasm
- Chocolate Keen: https://github.com/jamesfmackenzie/chocolatekeen
- OpenLara: https://github.com/XProger/OpenLara
- OpenJKDF2: https://github.com/shinyquagsire23/OpenJKDF2
- Rock Raiders Web: https://github.com/Scarabol/rock-raiders-web
- KotOR.js: https://github.com/KobaltBlu/KotOR.js ; https://swkotor.net/
- SDLPAL: https://sdlpal.github.io/sdlpal/
- celeste-wasm: https://github.com/MercuryWorkshop/celeste-wasm ; terraria-wasm: https://github.com/MercuryWorkshop/terraria-wasm
- fallout2-ce: https://github.com/fallout2-ce/fallout2-ce ; web fork https://github.com/roginvs/fallout2-ce ; Nevada/Sonora thread https://nma-fallout.com/threads/fallout-nevada-and-sonora-in-the-browser.222617
- fallout1-ce web fork: https://github.com/midzer/fallout1-ce
- gta-vice-city-wasm: https://github.com/joncodeofficial/gta-vice-city-wasm
- isle.pizza: https://github.com/isledecomp/isle.pizza ; isle-portable https://github.com/isledecomp/isle-portable
- Halo CE web: https://mitchellhynes.com/halo ; coverage https://www.pcgamer.com/hardware/you-can-now-play-halo-combat-evolved-in-a-web-browser-and-it-even-has-multiplayer/ (2026-09/10)
- RTCW web (MP demo): https://rtcw.pieter.com/
- RigelEngine: https://github.com/lethal-guitar/RigelEngine
