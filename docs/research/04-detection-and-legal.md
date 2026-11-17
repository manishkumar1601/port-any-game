# 04: Detecting what a game is, and the legal limits a porting tool must enforce

Status: research note for planning. Nothing has been built. Current as of 2026-11-17.
Scope: (A) automatic fingerprinting of a PC game install folder for the `survey` step of "port-any-game"; (B) the legal guardrails the tool must enforce.
**This is not legal advice.** Statutes are quoted or paraphrased from primary sources where they could be fetched. Each claim is tagged with how it was checked:
- `[V]`: verified against a primary source or the upstream code during this research.
- `[S]`: from secondary sources only.
- `[K]`: from background knowledge and not re-checked this session. Re-verify these before implementing.

---

## TL;DR

1. **Don't write most detection rules from scratch. Reuse three MIT-licensed rule sets.**
   - SteamDB `FileDetectionRuleSets`: filename regexes covering 126 engines, 16 anti-cheats, launchers, SDKs and the DOSBox/ScummVM emulators. `[V]`
   - Detect It Easy (DiE) database: byte-level rules for PE, MS-DOS, NE, LE and DOS extenders, including SecuROM, StarForce, Denuvo, SteamStub, Unity, Godot, AGS and others. `[V]`
   - SabreTools BinaryObjectScanner: 101 copy-protection, launcher and anti-cheat detectors plus 28 packer and installer detectors, with file-name lists. `[V]`

   Port all three into a pure-stdlib Python survey, credit them, and pin the commit used. Treat DiE (`diec` or `die-python`, Apache-2.0) and `scummvm --detect` as optional "deep mode" oracles when the user already has them installed. `[V]`
2. **ScummVM's detection tables are GPL-3.0-or-later.** Calling the binary (`scummvm --detect --recursive --path=…`) is fine. Copying the tables into a non-GPL plugin is not. `[V]`
3. **The survey must parse more than PE32.** It also needs PE32+ (delay imports and the .NET CLR header), MZ (DOS, plus LE/LX extenders), NE (Win16), ELF and Mach-O. It should check appended data (overlays) for embedded payloads: SWF, AGS `CLIB`, LÖVE zip, PyInstaller `MEI`, Godot `GDPC`, Clickteam. Most engine identification comes from file names plus magic bytes in the first and last few KB of a file. It should never read whole data files.
4. **Fix four false positives in the reference `retro-port/survey.py`.**
   - It labels `steam_api.dll` as DRM.
   - It flags .NET executables as packed because they have fewer than 15 imports.
   - It skips PE32+ imports.
   - It ignores delay-loaded and `LoadLibrary`-loaded graphics DLLs.

   Separate "Steam API present" (a warning) from "SteamStub `.bind` section" (a stop). `[V]`
5. **Legal rule for the tool: never circumvent and never distribute.**
   - The current US exemption for video games, 37 CFR 201.40(b)(19), covers only lawfully acquired games whose authentication servers have been shut down, for personal local play or for on-premises preservation by an eligible institution. `[V]`
   - A tool that removes DRM is a *trafficking* problem in the US (§1201(a)(2) and (b)), the EU (Software Directive Art. 7(1)(c)), the UK (CDPA s.296 and s.296ZD), Japan (Art. 120-2) and India (s.65A(2) record-keeping proviso). Exemptions cover only the person who circumvents, never a tool that circumvents for them.
6. **Rulemaking in progress (2026–27).** The Copyright Office's tenth triennial proceeding has published a notice of proposed rulemaking (91 FR 67788, 28 Oct 2026). It intends to renew the (b)(19) game exemption and is taking comments on two new proposals: Class 9 (DRM broken by operating-system incompatibility, e.g. SafeDisc) and Class 10 (online play through replacement servers). Initial comments are due 7 Dec 2026, oppositions 22 Feb 2027 and replies 22 Mar 2027. The new rule is expected around Oct 2027. Neither proposal is law, so the tool must not act on them. `[V]`
7. **What is safe to automate:** read-only surveying, running *unprotected* data that the user owns in an open-source runtime, and building privately to `localhost`. Everything the tool produces from game data stays out of git and off public hosting. Hooks enforce this (PreToolUse deny rules plus a git pre-commit hook driven by the survey manifest's hashes and magic bytes).

---

## Part A: Fingerprinting

### A.0 Lessons from `retro-port/scripts/survey.py` (read 2026-11-17)

This script is a GO/HARD/STOP verdict tool for a static-recompilation lane that only handles 32-bit Direct3D 8 games. It is a good base, but it has these gaps `[V]`:

| Issue | Effect | Fix in our survey |
|---|---|---|
| Only `*.exe` files are scanned. NE and LE files return `None`. | DLL-hosted engines (`GameAssembly.dll`, `UnityPlayer.dll`), `.ICD` (SafeDisc), DOS `.COM` and Win16 programs are missed. | Classify every file by magic number, not by extension. |
| Imports are parsed only for PE32 (`magic == 0x10B`). | 64-bit games get no API information. | Parse the PE32+ import directory using 8-byte thunks. |
| Delay-load imports (data directory 13) and dynamically loaded DLLs are ignored. | `d3d9`, `xinput` and `dsound` are often delay-loaded or loaded with `LoadLibrary`. | Read the delay-import table. Scan `.rdata` for DLL name strings and mark those hits `dynamic`. |
| `steam_api.dll`, `drm.dll` and `lgcore.dll` count as protection. | DRM-free Steam games get STOP. The `drm.dll` and `lgcore.dll` mappings could not be verified (BinaryObjectScanner's LaserLok detector does not list `lgcore.dll`). | Steam API means **WARN (launcher dependency)**. Only `.bind` or a SteamStub entry-point pattern means STOP. |
| "Fewer than 15 imports means packed." | Every .NET game (one import, `mscoree.dll!_CorExeMain`) and many launchers are flagged as packed. | Exempt images that have a CLR header. Require low import count *together with* high entropy or a packer section. |
| The whole executable is read into memory. | Fine for executables, but must not be extended to data files. | Bounded reads: first 64 KB, last 64 KB, and section and resource ranges. |
| No engine, store or overlay detection. | Not needed for its single lane. | Add sections A.3–A.6. |

### A.1 Executable formats: reading them with the Python standard library

All of this can be done with `struct` and about 400 lines of code. `pefile` (MIT) and `LIEF` (Apache-2.0) are optional accelerators, not dependencies. LIEF uses native wheels, so it breaks the zero-install goal. `[K]`

| Target | Signal | How to check | Confidence |
|---|---|---|---|
| MZ (DOS) | `4D 5A` at offset 0 | If `e_lfanew` (u32 at 0x3C) is out of range, or there is no `PE\0\0`, `NE`, `LE` or `LX` signature at `e_lfanew`, treat it as a plain DOS program. Compare `e_cblp`/`e_cp` (image size) with the file size; anything past the image is an overlay. | High `[K]` |
| `.COM` | No header, ≤ 64 KB, extension `.COM` | Extension plus size. Check that it is not an MZ file renamed `.COM`. | Medium `[K]` |
| DOS/4G(W) | String `DOS/4G` or `DOS4GW` in the first 1 KB, or `dos4gw` in the 1 KB before the LE header; `LE` header at `e_lfanew`; `DOS4GW.EXE` next to the program | DiE `MSDOS/extender_DOS4G` rule. | High `[V]` |
| Other extenders | `PMODE/W`, `CWSDPMI` / `go32` stub (DJGPP COFF), `CauseWay`, `DOS32`, `WDOSX`, Phar Lap (`.EXP`, `P3` header), `DOS/16M` | String search in the stub. DiE ships rules for all of these (`MSDOS/extender_*.0a.sg`). | High `[V]` (rules exist) |
| NE (Win16 / OS/2 1.x) | `NE` at `e_lfanew` | Target OS byte at NE+0x36: `0x02` = Windows, `0x01` = OS/2. Expected Windows version at NE+0x3E (e.g. `0x030A` = 3.10). The imported-names table lists `KERNEL`, `USER`, `GDI`, `MMSYSTEM`, `WING`. | High `[K]` |
| LE / LX | `LE` (VxD, DOS/4GW) or `LX` (OS/2 2.x+) at `e_lfanew` | DiE has `LE/` and `LX/` rule folders. | High `[V]` |
| PE32 vs PE32+ | `PE\0\0`. COFF `Machine` at +4: `0x014C` i386, `0x8664` x64, `0xAA64` ARM64. Optional-header magic: `0x10B` = PE32, `0x20B` = PE32+ | Subsystem (2 = GUI, 3 = console). Data directories: 1 = import, 2 = resource, 4 = certificate (Authenticode), 9 = TLS, 13 = delay import, 14 = CLR (.NET). Overlay = bytes after the largest `PointerToRawData + SizeOfRawData`, minus the certificate table. | High `[K]` |
| .NET / CLR | Data directory 14 non-zero; metadata root `BSJB`; runtime string `v2.0.50727` / `v4.0.30319` | Assembly references to `Microsoft.Xna.Framework`, `FNA`, `MonoGame.Framework`, `UnityEngine` appear in the `#Strings` heap. | High `[K]` |
| ELF | `7F 45 4C 46` | `EI_CLASS` (1 = 32-bit, 2 = 64-bit); `e_machine` 3 = x86, 0x3E = x86-64, 0xB7 = AArch64. A Linux build in the folder helps identify the engine (e.g. `libUnityPlayer.so`, `*.x86_64` from Godot). | High `[K]` |
| Mach-O | `FE ED FA CE`/`CE FA ED FE` (32-bit), `FE ED FA CF`/`CF FA ED FE` (64-bit), fat `CA FE BA BE` | **`CAFEBABE` is also the Java class-file magic.** For a fat binary, `nfat_arch` (u32 big-endian) is under 20; for a class file, bytes 4–7 are minor/major version ≥ 45. Also check `.app/Contents/Info.plist` → `CFBundleExecutable`. | High `[K]` |
| Version resource | `VS_VERSIONINFO` in `.rsrc`: `FileDescription`, `ProductName`, `ProductVersion`, `CompanyName`, `OriginalFilename`, `LegalCopyright` | Walk the resource directory for type 16 (RT_VERSION). Many DiE engine rules use this alone (Godot, AGS, LÖVE, Wintermute, Director). | High `[V]` |

### A.2 Graphics, audio, input and network APIs from imports

Import DLL names are case-insensitive. **COM-instantiated APIs do not appear in the import table.** DirectMusic, DirectShow and some DirectPlay and DirectSound usage only show up as `ole32!CoCreateInstance` plus CLSID GUID bytes or DLL name strings in `.rdata`. Report the source of each API as `import`, `delay` or `string` (dynamic). `[K]`

| API | Import DLL (key function) | Notes for routing |
|---|---|---|
| DirectDraw / D3D ≤ 7 | `ddraw.dll` (`DirectDrawCreate`, `DirectDrawCreateEx`); `d3dim.dll`, `d3drm.dll` | Era 1995–2002. Boxedwine or static recompilation needs a DirectDraw layer. |
| Direct3D 8 | `d3d8.dll` (`Direct3DCreate8`) | retro-port's lane today. |
| Direct3D 9 | `d3d9.dll` (`Direct3DCreate9`, `…Ex`), `d3dx9_NN.dll` | `d3dx9_24`…`d3dx9_43` tracks DirectX SDK releases from 2005 to June 2010 (43 = June 2010), which gives an era hint. |
| D3D10 / 11 / 12, DXGI | `d3d10.dll`, `d3d10_1.dll`, `d3d11.dll`, `d3d12.dll`, `dxgi.dll`, `d3dcompiler_NN.dll` | Effectively the streaming lane, unless an engine runtime or re-export lane applies. |
| OpenGL | `opengl32.dll`, `glu32.dll` | Could map to WebGL through an Emscripten GL layer when source or recompilation is available. |
| Vulkan | `vulkan-1.dll` | Streaming lane. |
| 3dfx Glide | `glide.dll` (v1), `glide2x.dll`, `glide3x.dll` | Era 1996–2000. DOSBox forks emulate Voodoo; in the Windows lane this is HARD. |
| WinG | `wing32.dll` / Win16 `WING` | Era 1994–95. |
| DirectSound | `dsound.dll` (`DirectSoundCreate`, `DirectSoundCreate8`) | |
| XAudio2 | `xaudio2_N.dll` | 2008 and later. |
| winmm | `winmm.dll` (`waveOut*`, `midiOut*`, `mciSendString*`, `timeGetTime`) | `timeGetTime` alone tells you nothing about audio. `mciSendString` often means CD audio, which needs CD-audio emulation. |
| DirectInput | `dinput.dll` (`DirectInputCreateA`, DX ≤ 7), `dinput8.dll` (`DirectInput8Create`) | |
| XInput | `xinput1_3.dll` (2007–10 SDK), `xinput1_4.dll` (Win8+), `xinput9_1_0.dll` | Gamepad support; maps well to the browser Gamepad API. |
| DirectPlay | `dplayx.dll`, `dpwsockx.dll` | Multiplayer hint. |
| Sockets | `wsock32.dll`, `ws2_32.dll` | Network hint. Check for IPX strings. |
| SDL | `SDL.dll` (1.2), `SDL2.dll`, `SDL3.dll` | Strong portability hint (Emscripten SDL ports). |
| OpenAL | `OpenAL32.dll`, `soft_oal.dll`, `wrap_oal.dll` | |
| FMOD | `fmod.dll`, `fmodex.dll`, `fmod64.dll`, `fmodstudio.dll` | Proprietary middleware. Personal use is fine; never redistribute. |
| Miles | `mss32.dll`, `mss16.dll`, `mss64.dll` (SteamDB rule) | Proprietary. |
| BASS | `bass.dll` | Proprietary. |
| Bink / Smacker | `binkw32.dll`, `bink2w64.dll` (SteamDB: `bink2?w(64|32)?\.dll`), `smackw32.dll` | Video. See the codec list in A.6. |
| DirectShow / VfW / WMV | `quartz.dll` (usually through COM), `msvfw32.dll`, `avifil32.dll`, `wmvcore.dll` | Video playback. |
| Wwise / CRI | `AkSoundEngine.dll`, `*.bnk`, `*.wem`; `*.cpk`, `*.usm`, `*.acb`, `*.awb` | SteamDB SDK rules. `[V]` |
| Steamworks | `steam_api.dll`, `steam_api64.dll` | Launcher dependency, not DRM by itself. |
| GOG Galaxy SDK | `Galaxy.dll`, `Galaxy64.dll` | Optional SDK; the game is DRM-free. |
| Epic Online Services | `EOSSDK-Win64-Shipping.dll` | SDK; check the anti-cheat folders. |
| Ubisoft | `uplay_r1_loader(64).dll`, `uplay_r2_loader64.dll`, `upc_r2_loader64.dll` | Launcher-based DRM. |
| GFWL | `xlive.dll` | DRM plus online service (largely defunct). Treat as protection. |

### A.3 Engine and runtime signatures

Confidence values: High = a single signal is decisive. Medium = needs two signals. Low = hint only. "Lane" names the routing target from the plan.

| Target | Signal | How to check | Confidence → Lane |
|---|---|---|---|
| **Unity (Mono)** | `UnityPlayer.dll` (2017.2+), `<Game>_Data/`, `globalgamemanagers` (5.x+) or `mainData` (≤ 4.x), `<Game>_Data/Managed/Assembly-CSharp.dll`, `MonoBleedingEdge/` | SteamDB `Unity` rule. DiE: imports `UnityPlayer.dll` or exports `UnityMain`. **Version:** regex `(\d{1,4}\.\d+\.\d+[abfpx]\d+)` over the first 0x100 bytes of `globalgamemanagers` / `mainData`. In a UnityFS bundle (`data.unity3d`) the header is `UnityFS\0`, u32 format, `5.x.x\0`, then the engine version string (e.g. `2021.3.16f1`; Unity 6 is `6000.x`). Fallback: `UnityPlayer.dll` `ProductVersion`. | High `[V]` (filenames, DiE) / version method `[K]` → streaming (re-export from a ripped project is impractical) |
| **Unity (IL2CPP)** | `GameAssembly.dll`, `<Game>_Data/il2cpp_data/Metadata/global-metadata.dat` (magic `AF 1B B1 FA`) | DiE: export `il2cpp_alloc`. If the metadata magic is wrong, the metadata is **encrypted or obfuscated → STOP for any extraction**. DiE notes that Denuvo can protect `GameAssembly.dll` rather than the exe. | High `[V]`/`[K]` → streaming |
| **Unreal 4/5** | `<Proj>/Binaries/Win64/<Proj>-Win64-Shipping.exe`, `Engine/Binaries/ThirdParty/`, `<Proj>/Content/Paks/*.pak` | `.pak`: search the last 1 KB for magic `E1 12 6F 5A` (0x5A6F12E1). IoStore (4.25+/UE5): `.utoc` begins with `-==--==--==--==-`, plus `.ucas`. DiE: exe > 32 MB, more than 32 exports, `OriginalFilename` matches `Win(32|64)-Shipping.exe`, or the string `Unreal` in `.rdata`/`.arch`. Version from `ProductVersion` (e.g. `++UE5+Release-5.3-CL-…`). | High `[V]` (rules) / version `[K]` → streaming |
| **Unreal 3** | `<Game>/CookedPC*/` with `*.upk`, `*.u`, `*.xxx`; `Binaries/Win32/` | Package tag `C1 83 2A 9E` (0x9E2A83C1) at offset 0. File version u16 at offset 4 (roughly 490–870 = UE3). | High `[K]` → streaming / Boxedwine |
| **Unreal 1/2** | `System/` with `*.u`, `*.int`, `Core.dll`, `Engine.dll`, `*.unr` maps | Same package tag. Version roughly 60–69 (UE1) or 100–130 (UE2). | Medium `[K]` → Boxedwine, or official community patches |
| **Godot 3/4** | `*.pck` (magic `GDPC` = 0x43504447), `project.godot` (rarely shipped), `GodotSharp.dll` (C#), exe `FileDescription` = "Godot Engine" | Header: u32 magic, u32 pack format, u32 major, u32 minor, u32 patch, u32 flags. Pack format 1 = Godot 3.x, 2 = 4.0–4.4, 3 = 4.5+ (per PCK Explorer), **4 = present on Godot master in Nov 2026** (adds sparse bundle, delta and removal flags). Embedded pack: PE section named `pck` (Godot 4 Windows), or the last 4 bytes are `GDPC` preceded by a u64 size. Flags bit0 = `PACK_DIR_ENCRYPTED`, per-file bit0 = encrypted → **STOP for re-export** (the key would have to be extracted). | High `[V]` → engine re-export (GDRE Tools, MIT) or streaming |
| **GameMaker** | `data.win` (Windows), `game.unx` (Linux), `game.ios` (macOS), `game.droid`; `options.ini`, `audiogroup*.dat`, `snd_*.ogg` | IFF: `FORM` + u32 size + `GEN8` chunk. GEN8 byte 1 = bytecode version (≤ 16 = GM:S 1.x/early 2.x, 17 = 2.3+). GMS2 always reports 2.0.0.0, so finer versions need UndertaleModTool-style chunk heuristics. **YYC builds** (native code; the `CODE` chunk is empty or missing) cannot be bytecode-interpreted. GM 8.x and earlier: data appended to the exe. SteamDB uses a two-pass "evidence" rule because single names are ambiguous. | High (`data.win`) / Medium (version) `[V]`/`[K]` → streaming or Boxedwine (no mature open runtime) |
| **RPG Maker 2000/2003** | `RPG_RT.exe`, `RPG_RT.ldb`, `RPG_RT.lmt`, `Map####.lmu`, `RPG_RT.ini`, `Harmony.dll` | Length-prefixed strings: `0B "LcfDataBase"`, `0A "LcfMapTree"`, `"LcfMapUnit"`, `"LcfSaveData"` (DiE rule). Tell 2000 from 2003 by parsing the database (liblcf, MIT, does this). | High `[V]` → **engine runtime: EasyRPG Player (GPL-3.0)** |
| **RPG Maker XP / VX / VX Ace** | `Game.exe` + `Game.ini` with `Library=RGSS1xx` (XP), `RGSS2xx` (VX), `RGSS3xx` (VXA); `Game.rgssad` / `.rgss2a` / `.rgss3a`; or plain `Data/*.rxdata` / `*.rvdata` / `*.rvdata2` | Archive magic `RGSSAD\0` + version byte (1 = XP/VX, 3 = VXA). The archive is XOR-obfuscated, so treat decryption-for-extraction as grey (see B). | High `[V]`/`[K]` → mkxp-z (native only) → Boxedwine / streaming |
| **RPG Maker MV** | `www/js/rpg_core.js`, `www/data/System.json`, `nw.exe`/`nw.dll` | Version: `Utils.RPGMAKER_VERSION = "1.x.y"` in `rpg_core.js`. Encrypted assets (`.rpgmvp`, `.rpgmvo`, `.rpgmvm`) are declared in `System.json` (`hasEncryptedImages`, `encryptionKey`). The original runtime decrypts them, so **do not decrypt them as a separate step**. | High `[V]` → **already-web** (serve `www/` locally) |
| **RPG Maker MZ** | `js/rmmz_core.js` (no `www/`), assets `.png_` / `.ogg_` | Same version constant. | High `[V]` → already-web |
| **Ren'Py** | `renpy/`, `lib/py*`, `game/*.rpa`, `*.rpyc`, `game/script_version.txt` | RPA header `RPA-3.0 ` (index offset and XOR key in hex) or `RPA-2.0 ` (Ren'Py `loader.py`). Version: `renpy/vc_version.py` (`version = '8.x.y.z'`) or `renpy/__init__.py`. | High `[V]`/`[K]` → engine runtime (Ren'Py web build; HARD if only `.rpyc` files are present) |
| **NW.js** | `nw.dll`, `nw_elf.dll`, `nw.pak` (SteamDB), `package.nw` (zip) or `package.json` + HTML at the root, or a zip appended to the exe | Zip end-of-central-directory (`PK 05 06`) in the last 64 KB. Read `package.json` → `main`. | High `[V]` → **already-web** (shim `nw.*`/Node APIs) |
| **Electron** | `resources/app.asar`, `resources/app/`, `LICENSE.electron.txt` (SteamDB), `version` file | asar = Chromium Pickle (u32 4, u32 size, u32, u32 JSON length, then `{"files":…`). Run detection again on the contents (Construct, Phaser, Pixi, Tyrano). | High `[V]` → already-web |
| **XNA / FNA / MonoGame** | `Microsoft.Xna.Framework*.dll`, `xnafx40_redist.msi`, `*.xnb` (`XNB` + platform `w`/`x`/`m` + version 4/5); `FNA.dll` + `FNA3D.dll`; `MonoGame.Framework.dll` | CLR header plus assembly references. | High `[V]` → HARD (FNA/KNI WebAssembly is experimental; needs a decompiled-IL rebuild) |
| **Other .NET** | CLR header; `*.runtimeconfig.json`, `*.deps.json` (.NET Core apphost) | | High `[K]` |
| **Java** | `*.jar` (zip with `META-INF/MANIFEST.MF` and `Main-Class`), `jre/` or `runtime/`, LWJGL (`lwjgl*.dll`), libGDX (`gdx*.dll`); Launch4j / exe4j / JSmooth wrappers (string `launch4j`, a jar as overlay) | Zip end-of-central-directory at the end of the exe. | High (jar) / Medium (wrappers) `[K]` → HARD (CheerpJ is commercial; TeaVM needs source) |
| **Flash** | `*.swf`: `FWS` (uncompressed), `CWS` (zlib), `ZWS` (LZMA); byte 3 = SWF version | **Projector exe:** the last 8 bytes are `56 34 12 FA` (0xFA123456) + u32 SWF length, with the SWF just before them. DiE `library_FlashPlayer` also looks for a `CWS`/`FWS` overlay. | High `[V]`/`[K]` → **engine runtime: Ruffle (MIT/Apache-2.0)** |
| **Adobe AIR** | `META-INF/AIR/application.xml`, `Adobe AIR/Versions/1.0/Adobe AIR.dll` (captive runtime), SteamDB `Adobe AIR` dir | The `<content>` element in `application.xml` names the main SWF. | High (detect) / Low (port: AIR APIs) `[V]` → Ruffle (partial) |
| **Director / Shockwave** | Projector + `Xtras/`, `*.x32`, `DIRAPI.dll`, `IML32.dll`; data `.dir .dxr .cst .cxt .dcr .cct` | `XFIR` (little-endian) / `RIFX` (big-endian) + form `MV93` / `MC95` / `APPL`; Afterburner `FGDM` / `FGDC`. DiE: exports `_FindEmbeddedMovie`, Macromedia version strings, `ProductName` "Director …". | Medium `[V]`/`[K]` → ScummVM Director engine (partial) or streaming |
| **AGS** | Exe overlay begins `CLIB\x1a` (`434C49421A`); `game.ags` / `ac2game.dat`; `acsetup.cfg`, `winsetup.exe`; version-resource strings "Adventure Game Studio …" | DiE `game_engine_AGS`. | High `[V]` → engine runtime: ScummVM AGS engine or the AGS 3.6 web target `[S]` |
| **Wintermute** | `data.dcp` / `*.dcp`, `wme_steam.dll`; exe `FileDescription` "Wintermute Engine Runtime" | `.dcp` magic: u32 0xDEC0ADDE then `JUNK` (as in ScummVM's Wintermute package reader). | High `[V]` (names, DiE) / magic `[K]` → ScummVM |
| **ScummVM-supported games in general** (SCUMM, SCI, AGI, …) | e.g. `*.LA0`/`*.000`, `RESOURCE.MAP` + `RESOURCE.000`, `LOGDIR` + `VOL.*`, `*.LFL`, plus game-specific names | Definitive check: `scummvm --detect --recursive --path=DIR`, which lists game IDs. ScummVM matches **file name + MD5 of the first N bytes (often 5000) + size**, with tail-MD5 and resource-fork variants (`ADGF_TAILMD5`, `ADGF_MACRESFORK`). It also flags known cracked versions (`ADGF_PIRATED`), which we can reuse as a STOP signal. | High (with the binary) `[V]` → **engine runtime: ScummVM (GPL-3.0+)** |
| **LÖVE** | `love.dll`, `lua51.dll`, `*.love`; fused exe = `love.exe` + appended zip containing `main.lua` | Zip end-of-central-directory + `main.lua` entry. DiE: `CompanyName` "LÖVE World Domination Inc." plus `FileVersion`. | High `[V]` → engine runtime (love.js) |
| **Python / PyInstaller / pygame** | Overlay cookie `MEI\x0C\x0B\x0A\x0B\x0E` (`4d45490c0b0a0b0e`), `.rdata` string "PyInstaller: FormatMessageW failed."; py2exe `PYTHONSCRIPT` resource / `library.zip`; cx_Freeze `lib/library.zip`; `pygame/`, `python3X.dll` (SteamDB `PyGame`, `Python`) | DiE `packer_PyInstaller` (also reads the Python version from `pythonXY.dll` in the overlay). | High `[V]` → HARD (pygbag needs source; recovering source from `.pyc` is grey) |
| **Clickteam Fusion** | Overlay begins `wwwwI\x87G` and the exe exports `zi32Support` (DiE, 2.x); `mmfs2.dll` (SteamDB); `PAME`/`PAMU` game header in the overlay | | Medium-High `[V]` → Boxedwine / streaming |
| **Construct 2/3** | `c2runtime.js`, `c3runtime.js`, `c3main.js` (SteamDB), `data.json` | Usually inside NW.js or Electron. | High `[V]` → already-web |
| **Source / Source 2 / GoldSrc** | `*.vpk` (magic `34 12 AA 55` = 0x55AA1234), `gameinfo.txt`, `bin/engine.dll`, `vphysics.dll` (SteamDB `Source`); `gameinfo.gi` (Source 2); `hl.exe`, `hw.dll`, `valve/*.wad` (WAD3), BSP v30 (GoldSrc) | | High `[V]`/`[K]` → streaming (GoldSrc: Xash3D-style ports, game-specific) |
| **idTech** | Doom `*.wad` (`IWAD` / `PWAD`), Quake `*.pak` (`PACK`), Q3 `*.pk3` (zip), D3 `*.pk4`, later `*.resources`, `*.streamdb`, `*.texdb` (SteamDB) | | High `[V]`/`[K]` → **source port** (needs the user's original data) |
| **Build engine** | `*.grp` (magic `KenSilverman`, then u32 file count), `*.art`, `*.map`, `GAME.CON`, `BUILD.EXE`, `COMMIT.DAT` (SteamDB) | | High `[V]`/`[K]` → source port (EDuke32 / Raze family) |
| **Visionaire Studio** | `*.vis` data, `VisionaireConfigurationTool.exe` (SteamDB) | | Medium `[V]` → streaming |
| **Wolf RPG Editor** | `Data.wolf` (SteamDB) or `Data/BasicData/*.dat` + `MapData/*.mps`, `Game.exe`, `Config.exe` | `.wolf` archives are encrypted → WARN. | Medium `[V]` → Boxedwine / streaming |
| **Kirikiri (KAG / Z)** | `data.xp3` (SteamDB), `krkr*.exe`, `plugin/*.dll`, `*.ks`, `*.tjs` | XP3 magic `58 50 33 0D 0A 20 0A 1A 8B 67 01`. Commercial VNs often encrypt XP3 contents → WARN. | High `[V]`/`[K]` → engine runtime (krkrsdl2-style ports; check web support) or Boxedwine |
| **NScripter / ONScripter** | `nscript.dat` (bytes XOR 0x84), `0.txt` / `00.txt`, `arc.nsa` / `arc*.nsa`, `*.sar` | SteamDB has an `NScripter` engine entry. | High `[V]`/`[K]` → engine runtime (ONScripter family) |
| **Other visual-novel engines** | TyranoScript (`tyrano/`, `data/scenario/*.ks`, HTML5 → already-web); Siglus (`SiglusEngine.exe`, `Scene.pck`, `Gameexe.dat`); RealLive (`RealLive.exe`, `SEEN.TXT`, `Gameexe.ini`); CatSystem2 (`cs2.exe`, `*.int`); BGI/Ethornell (`BURIKO ARC20` / `PackFile    `); YU-RIS (`*.ypf`, `YPF\0`); Artemis (`*.pfs`) | SteamDB covers CatSystem2, KiriKiri, NScripter, TyranoBuilder, Lightvn, Visual Novel Maker and others. | Medium `[V]`/`[K]` → mostly Boxedwine or streaming |
| **DOS game** | MZ / LE / COM executables + `SETUP.EXE`/`SETSOUND.EXE`, `*.CFG`; SteamDB `Emulator.DOSBOX` (`dosbox.exe`) means the store already wraps it | A GOG or Steam DOSBox wrapper is a strong GO signal. Use the wrapper's `.conf` to find the real executable and the mounted disc image (`.cue`/`.iso`/`.ins`). | High `[V]` → **DOS emulation (js-dos / DOSBox)** |
| **Win16** | NE executables | | High → Boxedwine / v86 (OS licensing, see B.8) |
| **Win32 native, D3D8 / ddraw era** | PE32 i386 with `d3d8` / `ddraw` / `opengl32` | Use retro-port's GO/HARD/STOP verdict plus the protection gate below. | → **static recompilation** or Boxedwine |

### A.4 Store, launcher and DRM-free markers

| Store | Markers | Meaning |
|---|---|---|
| GOG | `goggame-<id>.info` (JSON: `gameId`, `name`, `playTasks`), `goggame-<id>.ico`, `goggame-<id>.hashdb`, `Galaxy(64).dll`, `unins000.exe` | **DRM-free hint (positive).** `playTasks` often point straight at a DOSBox or ScummVM configuration. `[K]` |
| Steam | `steam_api(64).dll`, `steam_appid.txt`, path contains `steamapps/common`; `.bind` section | API only → WARN (the launcher may be required). `.bind` → SteamStub DRM → STOP. `[V]` |
| Epic | `.egstore/` (`*.manifest`, `*.mancpn`), `EOSSDK-*.dll` | Check the anti-cheat folders. `[K]` |
| EA / Origin | `__Installer/installerdata.xml`, `Core/Activation(64).dll` (BinaryObjectScanner lists these as Origin markers), `EAAntiCheat.Installer.exe`, `EAappInstaller.exe` | Activation wrapper → STOP. `[V]` |
| Ubisoft | `uplay_r1_loader(64).dll`, `uplay_r2_loader64.dll`, `UbisoftConnectInstaller.exe`, `UplayInstaller.exe` | Launcher DRM → STOP. `[V]` |
| Microsoft Store / Game Pass | `MicrosoftGame.config`, `appxmanifest.xml`, files under `WindowsApps` | Package encryption and ACLs → STOP (cannot read without circumvention). `[K]` |
| GFWL | `xlive.dll` | STOP; dead online service. `[V]` |

### A.5 DRM, packers and anti-cheat

Classes:
- **DRM / anti-tamper** → `STOP`.
- **Packer (compression only)** → `WARN`. UPX is compression, not an access control, but the tool still must not unpack *game* binaries automatically.
- **Anti-cheat / online-only** → `STOP` for every lane except streaming the user's own install.

| Protection | Cheap, reliable check | Confidence | Class |
|---|---|---|---|
| **SafeDisc** (1998–2009) | Files `00000001.TMP`, `CLCD16.DLL`, `CLCD32.DLL`, `CLOKSPL.EXE`, `DPLAYERX.DLL`, `DRVMGT.DLL`, `SECDRV.SYS`, `SPLSH16.BMP`/`SPLSH256.BMP`; a `<game>.ICD` next to a small exe; sections `stxt774` / `stxt371` (`.txt2` is a weaker hint); the `BoG_` marker string followed by version integers. Reuse the logic in BinaryObjectScanner's `Macrovision.SafeDisc` detector. | High `[V]` | DRM |
| **SecuROM** | Last section `.securom` (≤ 8.03.03), section `.dsstext` (8.03.03+), `.cms_t`/`.cms_d` (1.x–4.6), overlay starts `AddD\x03` followed by a version string; files `CMS16.DLL`, `CMS_95.DLL`, `CMS32_95.DLL`, `CMS_NT.DLL`, `SINTF32.DLL`, `SecuExp.exe`, `securom_v7_01.dat` | High `[V]` | DRM |
| **StarForce** | Files `protect.dll`, `protect.exe`, `protect.x86`/`.x64`, `sfdrvrem.exe`; sections `.sforce`, `.sforce3`, `.brick`, `.ps4`; DiE entry-point patterns; driver files `sfdrv01.sys`, `sfhlp02.sys` `[K]` | High `[V]` | DRM |
| **LaserLok** | Dir `LASERLOK/`, files `laserlok.in`, `laserlok.o10/.o11/.o12`, `laserlok.out`, `l16dll.dll`, `NOMOUSE.SP`/`NOMOUSE.COM`; `LaserLok` strings in the first section | High `[V]` | DRM |
| **TAGES** | `tages.dll`, `tagesclient.exe`, `TagesSetup(_x64).exe`, `Wave.aif/.alf/.apt/.axt`, drivers `atksgt.sys`, `lirsgt.sys`, `hwpsgt.sys`, `lemsgt.sys`, `GameModule.elb`, `ELBDrivers.exe`; DiE entry-point pattern | High `[V]` | DRM |
| **Solidshield** | `dvm.dll`, `tdvm.dll`, `tdvm.vds`, `activation.x86.dll`/`activation.x64.dll`, `vfs20.dll`, `solidshield-cd.dll`, `c11prot.dll`, `hc.dll`; section `.pseudo`; version-resource strings "Solidshield …" | High `[V]` | DRM |
| **SteamStub** | Section `.bind`; DiE entry-point patterns (x86 and x64) | High `[V]` | DRM |
| **Steam CEG** (about 2009–2014) | **No cheap static marker.** Per-user executables; the only known detector is a function-signature scanner (NoCEG, which we must not use). Heuristic: `steam_api` import + era 2009–14 → "possible CEG, unknown". | Low `[S]` | DRM (unknown) |
| **Denuvo** (2014–) | DiE heuristic: 64-bit, more than 10 sections, section names like `.arch`, `.srdata`, `.xtls`, `.xtext`/`.etext`, `.xdata`/`.udata`; `denuvo_atd` byte string; imports `steam_api64` / `eossdk` / `denuvo64.dll`; can sit in `GameAssembly.dll` (Unity). Denuvo Anti-Cheat files `denuvo-anti-cheat*.sys/.exe/.dll` | Medium (use DiE) `[V]` | Anti-tamper |
| **VMProtect** | Sections `.vmp0`, `.vmp1`, `.vmp2` (can be renamed; DiE checks name collisions) | High if named `[V]` | Anti-tamper |
| **Themida / WinLicense** | Sections `.themida`, `.winlice`; DiE: section 0 entropy ≥ 7.5, entry point at a section start, specific layout | Medium-High `[V]` | Anti-tamper |
| **Enigma** | Sections `.enigma1`, `.enigma2` | High if named `[V]`/`[K]` | Anti-tamper |
| **ASProtect / ASPack** | `.aspack`, `.adata` (shared by both), `.aspr` | Medium `[V]` | Protector / packer |
| **Arxan / Armadillo / CrypKey / ActiveMARK / CD-Cops / ProtectDISC / GFWL** | DiE (`protector_Arxan`, `protector_Armadillo`, …) and BinaryObjectScanner detectors | Medium `[V]` | DRM / anti-tamper |
| **UPX** | Sections `UPX0`, `UPX1` (+ `UPX2`), `UPX!` in the headers | High `[K]` | Packer |
| **PECompact, Petite, NsPack, MPRESS** | `pec1`/`PEC2`, `.petite`, `.nsp0`/`.nsp1`, `.MPRESS1`/`.MPRESS2` | High `[V]` | Packer |
| **Generic packed** | Executable-section entropy > 7.3 **and** (few imports **and** no CLR header) | Medium `[V]` | Unknown → WARN |
| **EasyAntiCheat** | `EasyAntiCheat/`, `EasyAntiCheat(_EOS)_Setup.exe`, `EasyAntiCheat(_x64).dll`, `start_protected_game.exe`, `eac_launcher.exe` | High `[V]` | Anti-cheat |
| **BattlEye** | `BattlEye/`, `BEService(_x64).exe`, `BEClient_x64.dll` | High `[V]` | Anti-cheat |
| **nProtect GameGuard** | `GameGuard/`, `gameguard.des`, `GameMon.des` | High `[V]`/`[K]` | Anti-cheat |
| **Others** (SteamDB list) | XIGNCODE3 `*.xem`; PunkBuster `pbsvc.exe`, `PnkBstrA.exe`, `Punkbuster/`; EA AntiCheat; ACE `AntiCheatExpert/`; HackShield `HShield/`; NetEase; Ricochet `Randgrid.sys`; TenProtect; EQU8; nProtect | High `[V]` | Anti-cheat |

Disc-era note: Windows 10, and security updates to Vista and 7 in 2015, disabled `secdrv.sys`. SafeDisc and older SecuROM games therefore fail on modern Windows. Proposed Class 9 in the 2026 notice targets exactly this case. It is **not** an exemption yet. `[V]` (notice text) / `[K]` (2015 date)

### A.6 Era and feature heuristics

| Feature | Signals | Caveats |
|---|---|---|
| **Release era** | (1) Authenticode countersignature time (most reliable when present). (2) Version-resource `LegalCopyright` year. (3) Linker major/minor: 5 = VC5 (1997), 6 = VC6 (1998), 7.0/7.10 = VS2002/2003, 8 = 2005, 9 = 2008, 10 = 2010, 11 = 2012, 12 = 2013, 14.x = 2015–2022+. (4) CRT DLL: `msvcr71` (2003), `msvcr80` (2005), `msvcr90` (2008), `msvcr100` (2010), `msvcr110`/`120` (2012/2013), `vcruntime140` + `api-ms-win-crt-*` (2015+), `vcruntime140_1` (x64, 2019+). (5) API generation (WinG → ddraw → d3d8 → d3d9 → d3d11 → d3d12/Vulkan). (6) Engine version (Unity `2017–2023.x`, `6000.x` = 2024+; UE4 = 2014–22, UE5 = 2022+; Godot 4 = 2023+). (7) `MajorSubsystemVersion` (4.0 = Win95/NT4, 5.x = 2000/XP, 6.x = Vista+). (8) COFF `TimeDateStamp`. | `TimeDateStamp` is a hash under MSVC `/Brepro` (reproducible builds) and a fixed 1992 value in Delphi. File mtimes are unreliable after copying. Give a range plus the evidence, never a single year. `[K]` |
| **32 vs 64 bit** | COFF `Machine`, PE32/PE32+, ELF class, Mach-O CPU type | A 32-bit exe may load a 64-bit helper (launchers). Judge the *main* exe: largest non-installer exe, or the target of `playTasks` / the Steam launch config / a `.lnk`. |
| **Multiplayer hints** | Imports `ws2_32`/`wsock32`, `dplayx`; strings `gamespy` (service shut 2014), `battle.net`, `IPX`; SDKs: Steam networking, EOS, Photon (`Photon3Unity3D.dll`), Mirror; anti-cheat folders; retro-port's local-multiplayer regex (`2 players`, `split screen`, `hot seat`) | Online-only plus anti-cheat → STOP. Dead-server multiplayer → WARN; do not emulate the server (see B). |
| **Threading** | Imports `CreateThread`, `_beginthreadex`, `CreateFiber`; engine (Unity and UE are always multi-threaded) | A multi-threaded WebAssembly port needs `SharedArrayBuffer`, which needs COOP/COEP headers (cross-origin isolation). That affects hosting configuration. `[K]` |
| **Video codecs** | Bink 1 `BIK` + revision letter; Bink 2 `KB2`; Smacker `SMK2`/`SMK4`; CRI `CRID` (`.usm`); ASF/WMV GUID `30 26 B2 75 8E 66 CF 11`; AVI `RIFF…AVI ` + FOURCC (`IV50`/`IV41` Indeo, `cvid`, `MJPG`, `DIVX`/`XVID`); MPEG-PS `00 00 01 BA`; Ogg Theora `OggS` + `\x80theora`; WebM `1A 45 DF A3`; MP4 `ftyp`; id RoQ; Westwood VQA (`FORM` + `WVQA`); Interplay MVE ("Interplay MVE File") | FFmpeg can decode Bink 1, Smacker, RoQ, VQA, MVE and Indeo; Bink 2 is not supported (verify at implementation). Middleware decoders are proprietary: never ship them. `[K]` |
| **Total data size** | Sum of all files, largest file, file count, size by extension | Suggested thresholds (heuristics to tune): < 300 MB OK in browser; 300 MB–2 GB needs streaming or chunked loading into OPFS or IndexedDB; > 2–4 GB, or a single asset > 2 GB → HARD, prefer the streaming lane. WebAssembly32 memory ceiling is 4 GB; memory64 support in browsers needs checking per target. `[K]` |
| **Online-only** | Launcher DRM, anti-cheat, Ubisoft or EA activation, login strings, no offline mode | → STOP except streaming. |

### A.7 Reusable datasets and tools

| Resource | What it gives | Format / runtime | License | Can we vendor it? |
|---|---|---|---|---|
| **SteamDB FileDetectionRuleSets** (`rules.ini`, `tests/FileDetector.php`, `descriptions/`) | Filename regexes in sections `Engine` (195 rules, 126 engines), `Evidence` (25), `SDK` (139), `AntiCheat` (22 / 16 names), `Launcher` (11), `Emulator` (DOSBOX, SCUMMVM), `Container` (Electron). Second-pass `TryDeduceEngine()` for GameMaker, Godot and others. Counts are from the 2026-11-17 fetch. | INI; PHP/PCRE regexes run against full forward-slash depot paths, case-insensitive. **Uses possessive quantifiers and atomic groups** (`\w++`, `{0,3}+`, `(?>…)`), which Python `re` supports only from 3.11; on older Pythons, rewrite them. Filenames only, never contents. | **MIT** (© 2021 SteamDB) `[V]` | **Yes.** Pin a commit, include the MIT notice, and port the second-pass logic. |
| **Detect It Easy (DiE)** + `db/` | About 5,000 rule files: `PE` (804), `MSDOS` (350), `Binary` (290), `NE` (14), `LE`, `LX`, `DOS4G`, `ELF`, `MACH`, `JAR`; `game_engine_*` (AGS, ClickteamFusion, Director, Godot, LOVE, RenderWare, Unity, Unreal, Wintermute, Xash, …); protectors (SecuROM, Safedisc, StarForce, Laserlok, Tages, Themida, VMProtect, Enigma, Denuvo, SteamStub, …). Repo version file reads 4.1.0. | DiE-JS (ES5) scripts executed by the DiE engine; GUI plus `diec` CLI (Windows, Linux, macOS); Docker image; Chocolatey package | **MIT** (© 2012–2026 hors) `[V]` | Rules: yes, with notice. They are scripts, so **translate** the simple ones (section names, version strings, overlay magic) to Python and keep DiE as an optional oracle. |
| **die-python** (elastic) | `die.scan_file(path, die.ScanFlags.RESULT_AS_JSON)` | `pip install die-python`; native wheels bundle the DiE engine | **Apache-2.0** `[V]` | Optional dependency only (not zero-install). |
| **BinaryObjectScanner** (SabreTools, formerly BurnOutSharp) | 101 protection / launcher / anti-cheat detectors plus 28 packer and installer detectors (SafeDisc, SecuROM, StarForce, LaserLok, TAGES, Solidshield, CD-Cops, ProtectDISC, GFWL, Origin, Uplay, Steam, EasyAntiCheat, Denuvo, …), packers and installers, with path lists and version extraction | C# (.NET) | **MIT** (© 2018–2026 Matt Nadareski) `[V]` | **Yes:** port the file-name lists and section and string checks with attribution. |
| **ScummVM** | `--detect`, `--recursive`, `--list-games-json`, `--list-engines-json`, `--md5 --md5-path=… --md5-engine=…`; per-engine `detection_tables.h` (name + MD5 + size) | C++ | **GPL-3.0-or-later** `[V]` | **Do not vendor the tables** into a non-GPL plugin. Call the user's ScummVM binary at runtime, or license the plugin GPL-3.0. (Individual hashes are facts, but the curated compilation is ScummVM's work, and EU database right may apply. `[K]`) |
| **PCGamingWiki** | Per-game engine, DRM and store data | MediaWiki + Cargo | Content **CC BY-NC-SA 3.0** `[S]` | No (NC clause). On 2026-11-17 an anonymous `cargoquery` returned `permissiondenied: You don't have permission to run arbitrary Cargo queries` `[V]`, so the API may now need approved access. Link users to the page instead. |
| **Wikidata** | `P408` software engine, `P1733` Steam app ID, `P2725` GOG app ID | SPARQL | **CC0** `[K]` | Yes, but only as an **opt-in** online lookup that sends the app ID only (privacy). |
| **Kaitai Struct format gallery** | Formal specs for DOS MZ, PE, NE, ELF, Mach-O, Doom WAD, Quake PAK and more | `.ksy` | Per-spec (many CC0/MIT) `[K]` | Reference only. |
| **pefile / LIEF / pyelftools / macholib** | Parsers | Python | MIT / Apache-2.0 / public domain / MIT `[K]` | Optional; the stdlib parser is the default. |
| **Engine-specific readers** | GDRE Tools / gdsdecomp (Godot, **MIT** `[V]`); UndertaleModTool (GameMaker, **GPL-3.0** `[V]`); UnityPy (MIT `[K]`); AssetRipper (GPL-3.0 `[K]`); liblcf (MIT `[K]`) | | | Use for version detection only. Using them to *extract* assets belongs to a grey-area re-export lane (B.7). |
| **TrID / PEiD / Exeinfo** | Signature databases | Proprietary or freeware | Restrictive or unclear | **No.** |

### A.8 Proposed survey output (JSON) and verdict logic

Design rules:
- Read-only.
- Bounded I/O: first and last 64 KB per file, plus executable headers and resources.
- Hash executables fully; hash data files over 256 MB partially (first and last 1 MB, marked `partial`).
- Paths in the output are *relative*. The absolute root is stored only as a salted hash.
- No network calls unless the user opts in.
- Pure Python 3 standard library. Optional DiE and ScummVM oracles.

```json
{
  "schema": "port-any-game/survey@1",
  "tool": {"name": "survey.py", "version": "0.1.0",
           "rulesets": [{"id": "steamdb-fdr", "commit": "<sha>", "license": "MIT"},
                        {"id": "die-db-subset", "commit": "<sha>", "license": "MIT"},
                        {"id": "bos-subset", "commit": "<sha>", "license": "MIT"}],
           "oracles": {"diec": null, "scummvm": "2.x.y"}},
  "scanned_at": "2026-11-17T12:00:00Z",
  "target": {"root_id": "sha256:<salted-hash-of-abs-path>", "label": "<folder basename>",
             "total_bytes": 734003200, "file_count": 1312,
             "largest": [{"path": "Data/sound.dat", "bytes": 210000000}],
             "builds_present": ["windows"]},
  "executables": [{
    "path": "GAME.EXE", "role": "main", "format": "PE32", "machine": "i386",
    "subsystem": "gui", "bytes": 1843200, "sha256": "…",
    "clr": false, "linker": "6.0", "subsystem_version": "4.0",
    "timestamp": {"value": "1999-08-10", "trust": "low"},
    "version_info": {"ProductName": "…", "FileVersion": "1.0.0.1"},
    "overlay": {"offset": 1800000, "bytes": 43200, "magic": null},
    "sections": [{"name": ".text", "entropy": 6.4}],
    "apis": {"graphics": [{"id": "d3d8", "via": "import"}],
             "audio": [{"id": "dsound", "via": "import"}, {"id": "miles", "via": "import"}],
             "input": [{"id": "dinput8", "via": "import"}],
             "video": [{"id": "bink1", "via": "import"}],
             "network": [{"id": "ws2_32", "via": "import"}]},
    "rule_hits": ["die:pe/compiler_msvc6", "local:api/d3d8"]
  }],
  "engine": {"id": "native-win32", "family": "custom", "version": null,
             "confidence": 0.7, "evidence": ["no engine rule hit", "imports d3d8"],
             "alternatives": []},
  "store": {"id": "gog", "app_id": "1207658…", "drm_free_hint": true,
            "evidence": ["goggame-1207658….info"]},
  "protection": [],
  "encryption": [],
  "features": {"bits": 32, "threads": "single",
               "multiplayer": {"local": false, "lan": true, "online": false, "services": []},
               "video_codecs": ["bink1"], "cd_audio": false},
  "era": {"range": [1999, 2001], "signals": ["linker 6.0", "d3d8", "msvcrt"]},
  "legal_flags": [],
  "lanes": [
    {"lane": "static-recomp-d3d8", "verdict": "GO",   "why": "PE32 i386, d3d8, no protection"},
    {"lane": "boxedwine",          "verdict": "HARD", "why": "d3d8 perf in wasm"},
    {"lane": "streaming",          "verdict": "GO",   "why": "always available for local use"}
  ],
  "verdict": {"overall": "GO", "primary_lane": "static-recomp-d3d8",
              "reasons": ["…"], "required_acknowledgements": ["ACK_PRIVATE_USE_ONLY"]}
}
```

Fixed vocabularies:

- `legal_flags`:
  - `DRM_PRESENT`
  - `ANTI_TAMPER_PRESENT`
  - `ANTI_CHEAT_PRESENT`
  - `ONLINE_ACTIVATION`
  - `LAUNCHER_REQUIRED`
  - `ENCRYPTED_ARCHIVE`
  - `ENCRYPTED_PACK_KEYED`
  - `PROPRIETARY_MIDDLEWARE`
  - `NONREDISTRIBUTABLE_RUNTIME` (RTP, Flash projector, OS images)
  - `PIRATED_SIGNATURE` (e.g. ScummVM `ADGF_PIRATED`, known crack loaders)
  - `STORE_LICENSE_NOT_OWNERSHIP`
- `required_acknowledgements`:
  - `ACK_PRIVATE_USE_ONLY`
  - `ACK_GREY_DECOMPILE`
  - `ACK_GREY_ASSET_EXTRACT`
  - `ACK_RUNTIME_LICENSE` (GPL source offer if the runtime is shared)

**Verdict logic.** Evaluate per lane, then take the best lane.

```
0. Hard fail-safes (overall = STOP, only "streaming-own-install" allowed):
   - any protection.class in {DRM, ANTI_TAMPER, ANTI_CHEAT} on the main exe OR on an
     engine module it loads (GameAssembly.dll, UnityPlayer.dll, *.ICD)
   - ONLINE_ACTIVATION, LAUNCHER_REQUIRED with launcher DRM (Ubisoft/EA/GFWL/Microsoft Store)
   - PIRATED_SIGNATURE (cracked exe, crack loader, steam_emu / Goldberg files, no-CD exe)
   - ENCRYPTED_PACK_KEYED (Godot encrypted PCK, IL2CPP metadata magic mismatch)
     for every lane that needs to read the plaintext outside the original engine
   Message: name the protection, explain why the tool will not remove it, and suggest
   an officially DRM-free edition (e.g. GOG) or an official publisher patch.
   (Exception, still STOP for the tool: a US user may personally invoke 201.40(b)(19)
   for a game whose authentication servers are dead. The tool will not do the
   circumvention for them.)
1. For each lane, preconditions → GO / HARD / NO:
   already-web       : www/index.html | rpg_core.js | rmmz_core.js | c3runtime.js | tyrano/ → GO
   engine-runtime    : scummvm --detect hit | EasyRPG (LcfDataBase) | Ruffle (SWF/projector)
                       | AGS | LÖVE | ONScripter | Ren'Py (HARD if .rpyc-only) → GO
   engine-re-export  : Godot pack v1–v4, not encrypted → GO (GDRE); GameMaker/Unity → HARD
   dos-emulation     : MZ/LE/COM main exe, DOS extender, DOSBox wrapper → GO
   boxedwine/v86     : PE32 i386 GDI/ddraw/d3d≤9 → HARD (perf); NE → HARD (OS licence)
   static-recomp     : PE32 i386 + d3d8 (+ ddraw later) + no protection → GO; d3d9 → HARD
   source-port       : idTech/Build/known title with an open engine → GO (needs the user's data)
   streaming         : always GO for the user's own install, localhost or own devices only
2. Lane ranking: already-web > engine-runtime > dos-emulation > source-port >
   engine-re-export > static-recomp > boxedwine/v86 > streaming.
   Demote a lane one step when ENCRYPTED_ARCHIVE is present and the lane would decrypt
   outside the original runtime.
3. Engine ambiguity: if the top-2 engine scores are within 0.15, set engine.id="ambiguous"
   and recommend the deep-mode oracles (diec, scummvm --detect).
4. Attach required_acknowledgements from the lane (B.9) and legal_flags.
```

---

## Part B: Legal guardrails (not legal advice)

### B.1 United States

- **17 U.S.C. §1201.**
  - (a)(1)(A) bans *circumventing* access controls.
  - (a)(2) and (b) ban *trafficking* in tools, services or components that circumvent.
  - §1201(f) is a narrow reverse-engineering exemption. It allows circumvention only to identify and analyze the elements needed for interoperability of an *independently created* program, and allows sharing the information or means only for that purpose. `[K]`
  - **Triennial exemptions excuse only the act of circumvention, never trafficking.** So a public tool that removes DRM can never rely on them. `[K]`
- **Current exemption, 37 CFR 201.40(b)(19)** (2024 rule, in force from 2024-10-28 to about Oct 2027) `[V]`:
  - (i)(A): "video games in the form of computer programs … lawfully acquired as complete games, when the copyright owner … has ceased to provide access to an external computer server necessary to facilitate an authentication process to enable gameplay, solely for the purpose of … copying and modification … to restore access to the game for personal, local gameplay on a personal computer or video game console."
  - (i)(B) and (ii): preservation by an eligible library, archive or museum, with no distribution outside its physical premises.
  - In 2024 the Register **refused** to allow off-premises (remote) access to preserved games and **refused** an operating-system-incompatibility class.
- **Tenth triennial (2027 cycle)** `[V]`:
  - Notice of inquiry 2026-06-09. Notice of proposed rulemaking published 2026-10-28 (91 FR 67788, Docket 2026-4).
  - The Register intends to renew the video-game-preservation exemption, which had no opposition.
  - New proposals: **Class 9**, "Video Games—Operating System Incompatibility" (DRM such as SafeDisc that no longer works on modern Windows; a substantially identical 2024 request was rejected for lack of record); **Class 10**, "Video Games—Network Play" (circumvention to interoperate with independently built replacement servers when the original servers are discontinued).
  - Comment deadlines: 2026-12-07, 2027-02-22 and 2027-03-22. Renewed exemptions would run Oct 2027 to Oct 2030.
  - **Action for us:** re-check in Oct 2027. Even if Class 9 or 10 is adopted, it will cover individual circumvention, not our tool doing it for users.
- **Fair use for interoperability and intermediate copying** `[K]`:
  - *Sega Enterprises v. Accolade*, 977 F.2d 1510 (9th Cir. 1992): disassembly to reach unprotected functional elements for a legitimate purpose is fair use.
  - *Sony Computer Entertainment v. Connectix*, 203 F.3d 596 (9th Cir. 2000): intermediate copying to build an emulator is fair use.
  - Both protect *creating an independent, interoperable program*. Neither protects distributing the game's own code or assets.
  - *Davidson & Assocs. v. Jung*, 422 F.3d 630 (8th Cir. 2005) (bnetd): click-wrap terms waiving reverse engineering were enforced, and the §1201(f) defense failed. This matters for private servers.
  - *MDY v. Blizzard*, 629 F.3d 928 (9th Cir. 2010): a §1201(a)(2) claim needs no infringement nexus. This conflicts with *Chamberlain v. Skylink*, 381 F.3d 1178 (Fed. Cir. 2004).
- **§117** `[K]`:
  - An *owner* of a copy may make adaptations or copies that are an essential step in using it, or archival copies.
  - *Vernor v. Autodesk*, 621 F.3d 1102 (9th Cir. 2010): licensees may not count as owners. Most store purchases are licenses.
  - So the survey records `STORE_LICENSE_NOT_OWNERSHIP` for store copies.
- **Enforcement climate** `[S]`: *Nintendo v. Tropic Haze* (yuzu) settled in March 2024 for $2.4M plus an injunction requiring deletion of circumvention tools and keys. The lesson: never ship, fetch or prompt for keys, BIOS files or circumvention code.

### B.2 European Union

- **Software Directive 2009/24/EC** `[K]` (EUR-Lex blocked automated fetches; text from knowledge):
  - **Art. 5(1):** a lawful acquirer may reproduce, translate, adapt and correct errors where necessary to use the program for its intended purpose.
  - **Art. 5(2):** a backup copy cannot be prohibited by contract.
  - **Art. 5(3):** observe, study and test the program while loading or running it.
  - **Art. 6:** decompilation is allowed only when indispensable to obtain interoperability information for an *independently created* program. The information must not be readily available, and the work is confined to the necessary parts. The information may not be used to make a substantially similar program.
  - **Art. 7(1)(c):** remedies against putting into circulation, or possessing for commercial purposes, means whose sole intended purpose is to remove technical protection of programs.
  - **Art. 8:** contract terms contrary to Art. 6 or Art. 5(2)–(3) are null and void.
- **CJEU case law:**
  - *Top System* (C-13/20, 2021): decompilation for error correction is allowed under Art. 5(1). `[K]`
  - *Sony v Datel* (C-159/23, 17 Oct 2024): changing **variable contents in RAM** without reproducing or altering code is outside the Directive's protection. The German Federal Court of Justice (BGH, I ZR 157/21, 31 Jul 2025) followed it. `[V]` press release / `[S]` BGH
  - *Nintendo v PC Box* (C-355/12, 2014): video games are **complex works**. Their non-software elements (graphics, sound) are protected under InfoSoc, and protection of their technological measures falls under **InfoSoc Art. 6**, subject to proportionality. `[K]`
  - *UsedSoft* (C-128/11, 2012): exhaustion applies to downloaded software licensed in perpetuity, but its reach for games as complex works is contested. `[K]`
- **Private copying (InfoSoc Art. 5(2)(b))** is optional and varies by Member State. It does not cover software, which is limited to the Software Directive's narrow acts.
- **Policy context** `[S]`: the "Stop Destroying Videogames" European Citizens' Initiative (1.29M verified signatures, submitted 2026-01-26). The Commission answered on 2026-06-16 that it "cannot propose a legal obligation" and will pursue an industry code of conduct on end-of-life. Campaigners are lobbying for inclusion in the Digital Fairness Act (proposal expected Q4 2026). Nothing has changed in the law.

### B.3 United Kingdom

- **CDPA 1988** `[K]` (legislation.gov.uk did not return content to automated fetches):
  - s.50A backup copy.
  - **s.50B** decompilation for interoperability (same conditions as EU Art. 6).
  - s.50BA observe, study and test.
  - s.50C copying or adapting necessary for lawful use, including error correction.
  - Terms excluding these are void (s.296A).
  - **s.296**: civil remedies against people who make or deal in means of circumventing technical devices applied to *computer programs*.
  - **ss.296ZA–296ZF**: technological measures on works *other than* computer programs. s.296ZA covers the act of circumvention (civil); s.296ZB covers criminal dealing in devices and services; s.296ZD covers civil dealing.
  - Games are hybrids, so both regimes can apply. *Nintendo v Playables* [2010] EWHC 1932 (Ch) held that game-card circumvention devices fall within s.296ZD and treated liability as strict `[S]`. See also *R v Higgs* [2008] EWCA Crim 1324 (on what counts as an "effective" technological measure) `[S]`.
- **No private-copying exception:** s.28B was quashed in 2015 in *BASCA* `[K]`. Format-shifting is lawful only through the narrow program-specific acts above.
- After Brexit, EU law retained in the UK is now "assimilated law", and CJEU decisions after 2020 (e.g. *Sony v Datel*) are not binding. `[K]`

### B.4 India

- **Copyright Act 1957, s.52(1)** `[V]`:
  - **(aa)** copies or adaptations by the lawful possessor, to use the program for its supplied purpose, or as back-ups.
  - **(ab)** "any act necessary to obtain information essential for operating inter-operability of an independently created computer programme with other programmes by a lawful possessor … provided that such information is not otherwise readily available."
  - **(ac)** observe, study and test.
  - **(ad)** "the making of copies or adaptation of the computer programme from a personally legally obtained copy for non-commercial personal use."
  - (ad) is unusually permissive for personal porting **of the program**. It does not cover the game's artistic, musical or film elements, which are separate works under the "complex work" view.
- **s.65A** `[V]`: circumventing an effective technological measure "with the intention of infringing such rights" is punishable by up to 2 years' imprisonment and a fine.
  - s.65A(2)(a) allows acts "for a purpose not expressly prohibited by this Act".
  - A proviso requires anyone *facilitating* circumvention for another person to keep records identifying that person and the purpose. A tool that circumvents for users therefore creates obligations even where the purpose is lawful.
- **Watch:** reports from September 2026 say the draft IP chapter of the India–EU FTA may require a stricter anti-circumvention regime and a three-step test for s.52 exceptions. No amendment had been enacted at the time of writing. `[S]`

### B.5 Japan

- **Copyright Act** (official English translation) `[V]`:
  - **Art. 30(1)(ii):** the private-use exception does **not** apply when reproduction became possible through circumventing technological protection measures.
  - **Art. 47-3(1):** the owner of a copy of a program may reproduce it "to the extent … necessary in order for the person to execute the work on that person's own computer."
  - **Art. 30-4:** exploitation without the purpose of enjoying the work, including computer data processing. Commonly read as covering reverse engineering and analysis. `[K]` on that interpretation.
  - **Art. 113(3):** circumventing *technological exploitation restriction measures*, which include restrictions on executing programs (access controls, added in 2018), is deemed infringement unless it is for research or technological development or otherwise does not harm the owner's interests.
  - **Art. 120-2:** up to 3 years' imprisonment and/or ¥3M for distributing circumvention devices or programs, or providing circumvention as a business.
- The **Unfair Competition Prevention Act** separately bans providing devices, programs and services that circumvent technological restriction measures (criminal since 2011). Article numbering changed in later amendments, so verify. `[K]`
- **Effect:** Japan is the strictest of the five on circumvention and device distribution. Porting an *unprotected* owned copy for private use fits Art. 30 (non-program elements) and Art. 47-3. Adapting the program relies on Art. 47-3 read with the adaptation provisions (Art. 47-6) `[K]`, so check with a lawyer before relying on it.

### B.6 What is clearly OK, clearly not OK, and grey

| Category | Activity | Notes |
|---|---|---|
| **Low risk (all five)** | Read-only survey of the user's install (headers, hashes, magic bytes) | No reproduction beyond transient use. |
| | Running an owned, **unprotected** game's original data in an open-source runtime (ScummVM, EasyRPG, DOSBox, Ruffle, LÖVE, AGS) on the user's own device | Industry precedent: GOG ships DOSBox and ScummVM with games. `[K]` |
| | Serving an already-HTML5 game (RPG Maker MV/MZ, Construct, NW.js/Electron) from `localhost` | Only reading and serving unmodified files to oneself. |
| | Streaming one's own install to one's own browser or devices | Not a public performance if it stays private. `[K]` |
| **Not OK** | Removing, bypassing or patching DRM, anti-tamper, activation or anti-cheat; emulating Steam/EOS ownership checks (Goldberg-style `steam_api` replacements); SteamStub stripping (Steamless); CEG removal (NoCEG); unofficial no-CD patches; decrypting keyed packs (Godot encrypted PCK, encrypted IL2CPP metadata) | Circumvention, and **trafficking** if the tool does it. |
| | Downloading game data, ISOs, BIOS, keys or OS images from third parties ("abandonware", ROM sites) | Infringement. Not cured by owning a physical copy. |
| | Publishing game-derived output (public git repo, Pages, Releases, itch.io, a public CDN) | Distribution and communication to the public. |
| | Private servers or modified clients against **live** official services | Terms of service, CFAA-type and §1201 risk (*Davidson v. Jung*). |
| **Grey** (private use only; acknowledgement required) | **Static recompilation or decompilation of the exe** to run on the web | US: arguable fair use (personal, transformative?) but not squarely *Sega*/*Connectix*. EU/UK: Art. 5(1) and s.50C "intended purpose" is debatable, and Art. 6 / s.50B do not cover it (the result is not "independently created"). India: s.52(1)(ad) is the strongest support. Japan: Art. 47-3, uncertain for adaptation. |
| | **Extracting assets** (Unity, Godot, GameMaker) to re-export in another engine | Reproduction and adaptation of artistic and musical works. Private use at most. Never redistribute. |
| | Loading **lightly encrypted archives** (`.rgssad`, MV `.rpgmvp`, `.wolf`, XP3) | Prefer runtimes that read them as the original engine does. Do not run a separate "decrypt to disk" step. Whether XOR-obfuscation is an "effective" measure is untested. |
| | Running unprotected *data files* of a game whose *executable* is DRM-protected (e.g. a SafeDisc retail CD of a ScummVM-supported title) | Arguably not "avoiding" a measure that only guards the exe, but US §1201(a)(3)(A) defines circumvention broadly ("avoid, bypass"). Default to STOP and suggest the DRM-free edition. |
| | Format-shifting an owned, DRM-free copy in general | US: fair use, case by case. EU: Member State law; software is limited to Art. 5. UK: narrow (no s.28B). India: s.52(1)(ad). Japan: Art. 30 + 47-3. |

### B.7 Open-source license obligations when a port bundles a runtime

| Runtime | License (checked) | Obligation if the port is **conveyed** to anyone (including serving its WebAssembly or JS from a public URL) |
|---|---|---|
| ScummVM | GPL-3.0-or-later `[V]` | Corresponding source for the exact runtime build, including our patches and build scripts. GPLv3 §6(d) allows offering source "from the same place" for network distribution. |
| EasyRPG Player | GPL-3.0 `[V]` | Same. liblcf is MIT `[K]`. |
| DOSBox Staging | GPL-2.0-or-later (some BSD-3 / GPL parts) `[V]` | Source plus license notices. |
| DOSBox (SVN) | GPL-2.0 `[K]` | Same. |
| js-dos | GPL-2.0 per a secondary listing (6.22 branch); current branch unverified `[S]` | Check before use. |
| Boxedwine | GPL-2.0 per its README and secondary catalogs; one SourceForge page says GPL-3.0 `[S]` | Check. It also contains Wine (LGPL-2.1+). |
| v86 | BSD-2-Clause `[V]` | Notice. Its BIOS images are separately licensed (SeaBIOS LGPL-3, VGA BIOS LGPL-2.1) `[K]`. **Guest OS images (Windows 9x/3.x, MS-DOS 6.x) are not redistributable.** MS-DOS 1.25/2.0/4.0 sources are MIT `[K]`. |
| Ruffle | MIT OR Apache-2.0 `[V]` | Notices. |
| Ren'Py | MIT (+ LGPL libraries) `[K]` | Notices plus LGPL relinking terms for the libraries. |
| Godot | MIT `[K]`; GDRE Tools MIT `[V]` | Notices. |
| UndertaleModTool | GPL-3.0 `[V]` | Only relevant if bundled. Do not bundle; call it if the user installed it. |

Key points:
- **The GPL does not reach the game data.** The FSF's position is that a GPL interpreter's input is data, so interpreted data need not be GPL-compatible (FAQ "IfInterpreterIsGPL"), and separate works on the same medium are "mere aggregation". `[S]` (quoted via mailing-list copies; the FAQ page was not fetched)
- **The GPL also gives no permission to distribute game data.** Copyright in the data is the binding constraint.
- **Nothing is triggered for private, unconveyed use.** GPL obligations attach on conveying, so a localhost-only build has no duties.
- The tool should still generate a `THIRD_PARTY_LICENSES/` folder and a source link for every bundled runtime, so that if the user ever shares the *runtime alone*, they comply.
- **Recompiled C or WebAssembly generated from a game binary is a derivative of the game.** It is not open source and must be treated like game data.
- **Non-redistributable pieces the tool must never bundle or download:**
  - Windows system DLLs and OS images.
  - DirectX redistributables outside their terms.
  - RPG Maker RTP (Enterbrain/Kadokawa terms). Use EasyRPG's free RTP replacement where needed `[K]`.
  - Adobe Flash/Director projector or Shockwave binaries.
  - Proprietary middleware (Bink, FMOD, Miles, Wwise) taken out of the game.

### B.8 Recommendation: guardrail list

**REFUSE (hard stop; no override flag in the tool):**
1. Any step that removes, bypasses, patches, emulates or "fixes" DRM, copy protection, activation, launcher ownership checks, anti-tamper or anti-cheat. This covers SafeDisc, SecuROM, StarForce, LaserLok, TAGES, Solidshield, SteamStub, CEG, Denuvo, VMProtect, Themida or Enigma used as DRM, Arxan, GFWL, Origin/EA, Ubisoft, Microsoft Store packages, EAC, BattlEye, GameGuard and similar. It includes running or suggesting Steamless, NoCEG, unlicense-type unpackers, Goldberg or `steam_emu`, `steam_api` replacement, crack loaders and no-CD exes.
2. Decrypting keyed content (Godot encrypted PCK, encrypted IL2CPP metadata, encrypted Unity bundles, encrypted VN archives) to disk.
3. Acquiring game data, disc images, BIOS, keys or OS images from anywhere other than the user's own install or media. That rules out abandonware or ROM sites and peer-to-peer.
4. Pushing, publishing or deploying anything that contains game-derived bytes to a public or third-party destination: public git remotes, GitHub Pages or Releases, itch.io, npm, public buckets or CDNs, paste sites.
5. Connecting modified clients or private servers to live official services.
6. Proceeding when the survey finds a `PIRATED_SIGNATURE`, such as a ScummVM `ADGF_PIRATED` match, crack loader DLLs (`steam_emu.ini`, `*.cdx`, `SmartSteamEmu`), or a cracked-exe hash.

**WARN (require an explicit, logged acknowledgement):**
1. Store-licensed copies (`STORE_LICENSE_NOT_OWNERSHIP`): terms of service may forbid reverse engineering; §117 may not apply.
2. Static recompilation or decompilation (`ACK_GREY_DECOMPILE`), with the jurisdiction matrix from B.6.
3. Asset extraction for re-export (`ACK_GREY_ASSET_EXTRACT`).
4. Lightly encrypted archives (use runtime lanes only).
5. Multiplayer: networking stays disabled; no server emulation.
6. Proprietary middleware present: personal use only.
7. Exposing anything beyond `127.0.0.1` (LAN or tunnel): requires `ACK_PRIVATE_USE_ONLY`, then authentication, `X-Robots-Tag: noindex` and no public link.
8. Runtime license duties (`ACK_RUNTIME_LICENSE`) if the user shares the runtime without game data.

**KEEP OUT OF GIT AND PUBLIC HOSTING (enforced by default):**
- `game/` (originals, read-only), `work/` (copies), `extracted/`, `recomp/generated/` (C or WebAssembly derived from the game binary), `build/` and `dist/` outputs that embed data (`*.data`, `*.pck`, `*.wasm` built from game code, packaged zips), saves, screenshots and video captures, crash dumps.
- Survey reports with absolute paths (the schema already redacts these).
- Allowed in the repo: tool code, configuration, `survey.schema.json`, and a `port.manifest.json` containing only relative paths, sizes and hashes. The manifest is itself private by default because hashes identify titles.

**How hooks can enforce this:**

| Layer | Mechanism | Enforces |
|---|---|---|
| Claude Code `PreToolUse` on `Bash` | The script parses the command. It **denies** (`permissionDecision: "deny"` or exit code 2 with a reason on stderr) when the command matches: `git add/commit` of protected paths; `git push` when the outgoing diff touches protected patterns; deploy or publish commands (`gh-pages`, `gh release upload`, `vercel`, `netlify deploy`, `wrangler pages deploy`, `firebase deploy`, `surge`, `butler push`, `npm publish`, `aws s3 cp/sync --acl public-read`); known circumvention tools (`steamless`, `noceg`, `goldberg`, `steam_emu`, `unlicense`); downloads from a denylist of abandonware, ROM and keys domains. | Refuse items 1, 3 and 4 |
| Claude Code `PreToolUse` on `Write`/`Edit` | Deny writes inside `game/` (originals are read-only); deny creating `steam_api*.dll`, `*.ini` emulator configs and similar files in work copies. | Refuse items 1 and 6 |
| Claude Code `PreToolUse` on `WebFetch`/MCP fetchers | Domain denylist, and deny URL paths ending in `.iso`, `.cue`, `.rom` or `.bin` unless they are the user's own local files. | Refuse item 3 |
| Plugin `SessionStart` / skill preamble | Load the survey's `verdict` and `legal_flags`. If `overall == STOP`, the skill only offers the streaming-own-install lane plus guidance. | Verdict gate |
| Git `pre-commit` and `pre-push` (works without Claude) | Reject staged files that (a) match hashes in `port.manifest.json`, (b) start with game magic (`MZ`/`PE`, `GDPC`, `RGSSAD`, `XP3\r\n`, `UnityFS`, `FORM…GEN8`, `RPA-`, `CLIB\x1a`, `IWAD`/`PWAD`, `PACK`, `KenSilverman`, `BIK`, `KB2`, `SMK`, `CWS`/`FWS`/`ZWS`, `XFIR`/`RIFX`), or (c) are binaries over 5 MB. Also generate `.gitignore` and `.gitattributes` (`export-ignore`). | Keep-out list |
| Local dev server | Bind to `127.0.0.1` by default; require a flag plus acknowledgement for `0.0.0.0`; always send `X-Robots-Tag: noindex`. | WARN item 7 |

Caveats on hooks:
- Hooks are a **safety net, not a security boundary**. Users can edit or disable them, and command-string parsing can be evaded. Treat them as defense in depth on top of the skill's own refusal logic.
- A hook "deny" cannot loosen the user's own deny or ask rules. `[S]`
- Exit code 1 does **not** block. Use exit 2 or the JSON deny. `[S]`
- Verify both against the current hooks reference before implementing.

### B.9 Lane-to-acknowledgement mapping

| Lane | Default verdict cap | Acknowledgements |
|---|---|---|
| already-web extract | GO | `ACK_PRIVATE_USE_ONLY` |
| engine runtime (ScummVM / EasyRPG / Ruffle / AGS / LÖVE / ONScripter / Ren'Py) | GO | `ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE` |
| DOS emulation (js-dos / DOSBox) | GO | Same as engine runtime. No OS images except FreeDOS or MIT MS-DOS. |
| source port | GO | Same as engine runtime. The user supplies the data. |
| engine re-export (Godot / GDRE) | GO/HARD | + `ACK_GREY_ASSET_EXTRACT` |
| static recompilation | GO/HARD | + `ACK_GREY_DECOMPILE`; generated code is treated as game data |
| Boxedwine / v86 | HARD | + `ACK_RUNTIME_LICENSE`; no Windows images |
| streaming fallback | GO | Own devices only; no public relay |

---

## Open risks and unknowns

1. **Python availability is not guaranteed.** Windows has a Store stub, and macOS needs the Command Line Tools for `python3`. SteamDB regexes need Python 3.11+ unless translated. Decide between Python with a fallback message or a compiled single-file binary.
2. **Steam CEG and Denuvo detection is heuristic.** False negatives mean a GO on a protected binary. Mitigation: run DiE automatically when available. Static recompilation must abort if code-integrity checks fire at runtime.
3. **The protected-exe-but-plain-data case** (B.6) is legally unsettled. The default STOP may block legitimate ScummVM use of retail CDs. Revisit with counsel, and consider "detect, then point the user to ScummVM's own documentation" rather than doing it ourselves.
4. **No case law on lightly encrypted archives.** Whether RGSSAD, RPG Maker MV encryption or XP3 counts as an "effective technological measure" has not been tested.
5. **Godot pack format 4** (on master in Nov 2026) and its engine-version mapping need re-checking at implementation. GameMaker 2022+ version detection depends on GPL-3.0 UndertaleModTool heuristics; reimplement them clean-room.
6. **Not verified this session:** the exact text of the EU Directive, UK CDPA and Japan's Unfair Competition Prevention Act (fetches blocked). Also js-dos and Boxedwine license files, `diec` flag spelling, Electron `version` file, Ren'Py `vc_version.py`, UE version-resource format, Wintermute magic, the Flash projector trailer, and the FFmpeg Bink 2 status.
7. **PCGamingWiki API access** appears restricted (observed `permissiondenied`). Do not design around it.
8. **Policy drift:** the 2027 triennial outcome (Classes 9 and 10), the EU Digital Fairness Act (Q4 2026 proposal) and the India–EU FTA IP chapter. Re-check before release and whenever 37 CFR 201.40 changes.
9. **Jurisdiction detection:** the tool cannot know where the user is. Show the matrix and apply the strictest common rule (no circumvention, no distribution) everywhere.
10. **Hooks are bypassable.** Communicate that compliance is the user's responsibility, and keep refusal logic in the skill text itself.

---

## Sources (all accessed 2026-11-17 unless noted)

**Code and rule sets (fetched)**
- retro-port `survey.py`: https://github.com/Dhaiwat10/retro-port/blob/main/plugins/retro-port/skills/port-pc-game-to-browser/scripts/survey.py (read via the cdn.jsdelivr.net mirror)
- SteamDB FileDetectionRuleSets (README, LICENSE MIT, `rules.ini`): https://github.com/SteamDatabase/FileDetectionRuleSets
- Detect It Easy (LICENSE MIT, README, `db/PE/*`, `db/MSDOS/extender_DOS4G.0a.sg`, `db/Binary/bin.RPGMaker2Kdata.1.sg`): https://github.com/horsicq/Detect-It-Easy
- die-python (Apache-2.0): https://github.com/elastic/die-python
- BinaryObjectScanner (MIT; `Protection/*.cs`): https://github.com/SabreTools/BinaryObjectScanner
- Godot `core/io/file_access_pack.h` and `.cpp`: https://github.com/godotengine/godot/tree/master/core/io
- PCK Explorer devlog (pack format 3 = Godot 4.5+): https://dmitriysalnikov.itch.io/godot-pck-explorer/devlog
- ScummVM `base/commandLine.cpp`, `engines/advancedDetector.h`, `COPYING` (GPL-3): https://github.com/scummvm/scummvm
- Ren'Py `renpy/loader.py`: https://github.com/renpy/renpy
- Licenses: Ruffle https://github.com/ruffle-rs/ruffle/blob/master/LICENSE.md · EasyRPG Player https://github.com/EasyRPG/Player · v86 https://github.com/copy/v86 · DOSBox Staging https://github.com/dosbox-staging/dosbox-staging · GDRE Tools https://github.com/GDRETools/gdsdecomp · UndertaleModTool https://github.com/UnderminersTeam/UndertaleModTool
- Boxedwine and js-dos license listings (secondary): https://awesome.ecosyste.ms/projects/github.com%2Fdanoon2%2Fboxedwine · https://github.com/danoon2/Boxedwine/wiki
- NoCEG (described only; do not use): https://github.com/iArtorias/noceg · Steamless wiki: https://github.com/atom0s/Steamless/wiki
- PCGamingWiki API (observed `permissiondenied`): https://www.pcgamingwiki.com/w/api.php

**United States**
- 2024 final rule, 89 FR 85437 (Oct 28, 2024), §201.40(b)(19) text: https://www.govinfo.gov/content/pkg/FR-2024-10-28/html/2024-24563.htm
- Tenth triennial page: https://www.copyright.gov/1201/2027/ · Landing page: https://www.copyright.gov/1201/
- Notice of inquiry (Jun 9, 2026): https://www.govinfo.gov/content/pkg/FR-2026-06-09/pdf/2026-11545.pdf
- Notice of proposed rulemaking, 91 FR 67788 (Oct 28, 2026), Classes 9 and 10: https://www.govinfo.gov/content/pkg/FR-2026-10-28/html/2026-21939.htm
- 2024 recommendation (Register's refusal of remote access): https://www.copyright.gov/1201/2024/2024_Section_1201_Registers_Recommendation.pdf · coverage: https://gamehistory.org/dmca-2024-statement/
- 17 U.S.C. §§117, 1201: https://www.law.cornell.edu/uscode/text/17/1201 (not re-fetched)
- Yuzu settlement coverage (Mar 2024): https://www.engadget.com/makers-of-switch-emulator-yuzu-quickly-settle-with-nintendo-for-24-million-203204698.html · https://torrentfreak.com/nintendos-yuzu-lawsuit-is-all-but-done-price-2-4m-cost-to-emulation-tbd-240305/
- Case citations (standard reporters; not re-fetched): Sega v. Accolade, 977 F.2d 1510; Sony v. Connectix, 203 F.3d 596; Davidson v. Jung, 422 F.3d 630; MDY v. Blizzard, 629 F.3d 928; Chamberlain v. Skylink, 381 F.3d 1178; Vernor v. Autodesk, 621 F.3d 1102.

**European Union**
- Directive 2009/24/EC: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32009L0024 (fetch blocked; text from knowledge)
- Directive 2001/29/EC: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32001L0029 (not fetched)
- CJEU C-159/23 *Sony v Datel* press release (Oct 17, 2024): https://curia.europa.eu/jcms/upload/docs/application/pdf/2024-10/cp240181en.pdf · commentary: https://www.cliffordchance.com/insights/resources/blogs/ip-insights/2025/05/video-games-v-cheating-game-over-for-copyright-holders-of-a-computer-program-when-the-code-is-not-altered.html
- Stop Destroying Videogames, Commission response (Jun 16, 2026): https://www.lewissilkin.com/insights/2026/06/24/european-commission-stops-short-of-imposing-mandatory-requirements-following-citi-102n4yy · https://merlin.obs.coe.int/article/10576

**United Kingdom**
- CDPA 1988: https://www.legislation.gov.uk/ukpga/1988/48 (fetch returned empty; from knowledge)
- *Nintendo v Playables* [2010] EWHC 1932 (Ch): https://caselaw.nationalarchives.gov.uk/ewhc/ch/2010/1932 · *R v Higgs* [2008] EWCA Crim 1324: https://caselaw.nationalarchives.gov.uk/ewca/crim/2008/1324

**India**
- Copyright Act 1957 s.52 and s.65A (mirror of the official text): https://lawgist.in/copyright-act/52 · https://lawgist.in/copyright-act/65A · official: https://www.indiacode.nic.in/bitstream/123456789/1367/1/a195714.pdf
- India–EU FTA copyright commentary (Sep 2026, secondary): https://www.drishtiias.com/daily-updates/daily-news-analysis/india-eu-fta-copyright-concerns

**Japan**
- Copyright Act (official translation; Arts. 30, 30-4, 47-3, 113, 120-2): https://www.japaneselawtranslation.go.jp/en/laws/view/3379/en

**Licensing and tooling**
- GNU GPL FAQ (IfInterpreterIsGPL, MereAggregation): https://www.gnu.org/licenses/gpl-faq.html (quoted via secondary copies)
- Claude Code hooks reference: https://code.claude.com/docs/en/hooks
