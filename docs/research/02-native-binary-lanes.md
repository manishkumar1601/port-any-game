# 02 - Native binary lanes: running an existing compiled PC game in a browser (no source)

- Status: research note for planning "port-any-game". Not a design.
- As of: 2026-11-17. Versions and dates were checked against GitHub release/commit feeds, the npm registry and project docs on that day unless marked otherwise.
- Scope: generic binary lanes only (DOS, Win16, Win32, Win64). Engine lanes (Unity, Godot, RPG Maker, Ren'Py, Flash, Java, ScummVM...) and source ports are covered in a sibling note. `Dhaiwat10/retro-port` was already analysed and is only referenced here.
- Markers: **[unverified]** means a single or secondary source, or a claim we could not check against the project itself. **[estimate]** means our planning guess, not a measurement.

---

## TL;DR

1. **DOS is solved.** js-dos 8.5.4 (GPL-2.0, released 2026-11-12) is the clear default. The bundle is a ZIP with `.jsdos/dosbox.conf`, and an agent can generate one with a few lines of script. js-dos also shipped an **MCP server (mcp-v0.1.0, 2026-11-12)** with an embedded Studio, DOSBox and DOSBox-X runtime. It ships as native binaries for Windows x64, Linux x64 and macOS Intel/arm64. Through it an agent can create a bundle, edit its config, run it, take screenshots, play keyboard and mouse scenarios, and export standalone HTML/Vite projects. It is 5 days old, so treat it as promising but unproven.
2. **Win 3.x/9x-era 32-bit games without recompiling: use js-dos with the DOSBox-X backend and a Windows 9x guest.** As of 8.4.0/8.5.0 (June and September 2026) it is the only in-browser path with **accelerated 3dfx Voodoo through WebGL**. It also handles DirectX games inside the guest. The catch is that it needs a Windows 95/98 install, and the user has to own that licence. js-dos offers prebuilt images, but Microsoft has not licensed them for redistribution. CPU emulation is an interpreter, so late-90s 3D titles are marginal.
3. **Boxedwine** (GPL-2.0, 26R1, April 2026; still committing in November 2026) runs real 32-bit Wine on an emulated Linux kernel and CPU. Its web build needs no Microsoft OS, and its official demos include 2D/DirectDraw games such as Age of Empires and Caesar III. Its own README says the web build "is still slow, need to implement a JIT", so treat it as a lane for 2D games only. **v86** (BSD-2, 0.5.473, October 2026) has an x86-to-wasm JIT and runs Win9x/2000 (XP conditionally). It has no 3D acceleration; a GL4ES/WebGL proof of concept exists only in a discussion thread. **CheerpX/WebVM** cannot run Windows games today: it is 32-bit Linux user mode only, Wine support is still only "planned", and it carries a proprietary licence.
4. **Static recompilation** is worth it only where emulation has no usable 3D path: D3D8/D3D9-era Win32. retro-port is the only PC-x86-to-wasm recompiler we found. Console recompilers (N64Recomp, XenonRecomp, ReXGlue, PSXRecomp) show the method works, and PSXRecomp shipped a wasm-first title in July 2026. Original-Xbox x86-to-C lifters (xboxrecomp, Anybox) are the closest analogues to PC games, but they are immature. AI-assisted *decompilation* went mainstream in 2026 (Snowboard Kids 2 reached 100% in May 2026; decomp.dev closed in October 2026 citing AI). It still takes weeks to months per game, so it is not an automated skill lane.
5. **Graphics translation:** Glide works (js-dos/DOSBox-X to WebGL). OpenGL 1.x has gl4es (MIT, Emscripten target). D3D9 has one MIT library (`LostMyCode/d3d9-webgl`, fixed-function only, needs code it can link against). D3D8 is covered by retro-port (WebGPU). **D3D10/11/12 and Vulkan have no browser translation of any kind.**
6. **Modern 64-bit DX11/DX12/Vulkan games have no in-browser execution path in 2026.** The honest fallback is **streaming the natively running game into a tab**. The best cross-platform choice is **Sunshine (Win/macOS/Linux/FreeBSD hosts, GPL-3.0) plus moonlight-web-stream (GPL-3.0, v3.0.2, 2026-11-15)**. Vibepollo is a Windows-only, one-install alternative; Selkies covers Linux and containers. Label this lane **"Remote Play (streamed from your PC)"**, never "port".
7. **Ladder** (details in the decision ladder section): engine lane, then DOS on js-dos, then Win16 on js-dos/DOSBox-X+Win3.11 (Boxedwine if there is no OS licence), then 2D Win32 on Boxedwine (else DOSBox-X+Win98, else v86), then Glide on DOSBox-X+Voodoo, then 32-bit unprotected D3D8 on retro-port, then D3D9/OpenGL as a HARD recompile, then 64-bit/DX10+/DRM goes to Remote Play only.

---

## Lane comparison table

Success odds are **[estimate]**, assuming a legitimately owned, DRM-free copy whose "binary class" matches the lane's input.

| # | Lane | Inputs (binary class) | Tech | License | Maturity (latest) | Perf in browser | Compat | Agent effort | Success odds |
|---|------|------|------|---------|----------|------|--------|--------|------|
| L1 | **js-dos, DOSBox backend** | MZ DOS exe/com, CD images | DOSBox to wasm (1.4 MB wasm), worker, OPFS saves | GPL-2.0 | 8.5.4, 2026-11-12; 1900+ games on dos.zone | Good up to ~486/early Pentium-class games [estimate] | Very high for DOS | Low: script a zip plus conf | 85-95% |
| L1b | EmulatorJS + `dosbox_pure` core | DOS zip | libretro DOSBox Pure to wasm (needs threads/COOP+COEP) | GPL-3.0 frontend, GPL-2.0 core | EmulatorJS 4.3.0-pre 2026-05-17 (npm stable 4.2.3, 2025-07) | Similar to L1 [unverified] | High for DOS | Low | 75-90% |
| L2 | **js-dos, DOSBox-X backend + Win 3.x / 9x guest** | NE Win16, PE i386 Win9x-era (GDI, DirectDraw, DirectX <=7, Glide) | DOSBox-X to wasm (7.9 MB), Voodoo emulation to WebGL, sockdrive streaming disks | GPL-2.0, **plus a Microsoft OS licence the user must own** | Win9x since 8.3.x; full 3dfx 8.4.0 (2026-06-19); DOSBox-X update 8.5.0 (2026-09-28) | Interpreter CPU; fine for 2D/early 3D, marginal for 1998+ 3D [estimate] | Highest of any Windows lane (real Windows) | Medium: install the game inside the guest (Studio/MCP), then build the bundle | Win16 70-85%; Win9x 2D 50-70%; Glide 40-60% |
| L3 | **Boxedwine web** | NE Win16, PE i386 (GDI, DirectDraw, WinG) | Unmodified 32-bit Wine on emulated Linux kernel and x86 CPU; root fs zip plus app zip | GPL-2.0 (Wine LGPL-2.1) | 26R1, 2026-04-22; commits 2026-11-16 | **Slow**: web build has no JIT (README) | Good for '90s 2D; "games after 2010 limited" | Low: zip the game, set URL params | 2D: 30-50% playable |
| L4 | **v86 + Win9x/2000(/XP) guest** | PE i386 2D, Win16 | x86 to wasm JIT, VGA/SVGA+VBE, SB16, no GPU | BSD-2-Clause, **plus a Microsoft OS licence** | 0.5.473, 2026-10-30 | Faster CPU than L2/L3 (JIT); **no 3D** | Win 1-ME/NT/2000 "reasonably well"; XP conditional | Medium-high: build/boot a disk image | 2D: 40-60% |
| L5 | RetroTick / retrowin32 | Tiny Win16/Win32 GUI/console exes | Win32/Win16 API reimplemented in TS/Rust + CPU interpreter | CC0-1.0 / Apache-2.0 | RetroTick Show HN ~2026; retrowin32 "still early" | Fast for tiny apps | Very low (missing APIs such as MSVBVM60) | Low | <10% for real games |
| L6 | CheerpX / WebVM (+ Wine) | (would be PE i386 via Wine) | x86 to wasm JIT, Linux syscall layer, 32-bit only | Proprietary Community License (free for individuals/FOSS via Leaning CDN); paid commercial | `@leaningtech/cheerpx` 1.4.0, 2026-10-07 | Fastest x86 JIT in a browser | **Wine not shipped**; no GPU (KMS framebuffer) | n/a | ~0% today |
| L7 | **Static recompilation (retro-port)** | PE i386, unprotected, D3D8 (GO) / D3D9, DDraw, GL (HARD) | Lift to C, then Emscripten wasm; Win32/DSound/DInput shims; D3D8 to WebGPU | MIT (retro-port); output is a derivative of the game | retro-port 2026 (macOS-only host) | Near-native | Per game; refuses packed/DRM/64-bit | High (hours to days of agent work per game) | GO 40-60%; HARD 10-25% [estimate] |
| L8 | Reuse an existing decomp/source port | Any title with a community decomp | e.g. isle.pizza (LEGO Island), Halo CE wasm | Varies | Per project | Native | Per project | Low (detect and redirect) | High when it exists (sibling note) |
| L9 | **Remote Play (stream)** | Anything that runs on the user's PC: 64-bit, DX11/12, Vulkan, DRM | Host capture + HW encode, WebRTC/WebSocket to browser | Sunshine GPL-3.0, moonlight-web-stream GPL-3.0, Selkies MPL-2.0... | Sunshine v2026.1117 (2026-11-17); moonlight-web-stream v3.0.2 (2026-11-15) | Native rendering; adds network + browser decode latency | ~100% of games that run on the host | Medium: install host, pair, HTTPS/TURN | 90%+ (not a port) |

Not recommended or dead: **em-dosbox** (last release 2022-12, last commit 2023-01). **PCjs** (MIT, active; a museum of exact historical machine configs, not a packaging target). **86Box** (GPL-2.0, 6.0 on 2026-05-31; **no web build** found). **Halfix** (last commit 2021). **QEMU-wasm** (x86_64 guests boot, but there is no GPU, it is "still slower", and the wasm TCG backend was not confirmed merged upstream [unverified]). **Sogen** (Windows x64 *user-mode* syscall emulator with a wasm target, aimed at malware analysis, no graphics). **Wine-Assembly** (hand-written WAT PE interpreter, toy). **box86/box64** (dynarecs for ARM/RISC-V/LoongArch hosts; no wasm target, so they matter only as a design reference: wrapping native libraries instead of emulating them).

---

## Per-lane details

### L1 - DOS: js-dos v8 (primary)

**Facts**
- Repo: https://github.com/caiiiycuk/js-dos (GPL-2.0 per npm). Player `js-dos@8.5.4` (2026-11-12); emulators package `emulators@8.5.3` (2026-11-10).
- Backends: `dosbox` (wdosbox.wasm 1.4 MB) and `dosboxX` (wdosbox-x.wasm 7.9 MB). A JSPI variant (`wdosbox-x-jspi.wasm`) and a debug variant also exist. They run in a Web Worker or on the render thread, and also run in Node.
- Bundle format (`.jsdos`): **a plain ZIP**. `.jsdos/dosbox.conf` is required (an ordinary dosbox.conf, with an `[autoexec]` that mounts and starts the game). `.jsdos/jsdos.json` is optional and holds extra config such as on-screen virtual-control layers for mobile. Game files sit at the root. "Bundles generated by game studio are not licensed, you can use them however you want." Bundles from Studio v7 work in v8.
- Large games: **Sockdrive v2** streams disk images up to ~2 GB without a backend (range requests; serve with Brotli/gzip from a CDN). Sockdrive bundles do not support save/load as-is; use the "Publish Sockdrive" flow.
- Saves: as of 8.4.0 (2026-06-19), bundles and filesystem changes live in **OPFS** (replacing IndexedDB). The cloud and auth code was removed, and there are `fsChanges` hooks for custom save storage.
- Input: improved pointer events and pointer lock with an unadjusted-movement fallback; special keys UI (Alt+Tab, Ctrl+Alt+Del); right mouse button on Bluetooth mice; virtual controls for touch. Physical gamepad mapping was not verified in the docs [unverified].
- Sound: emulated SB16/OPL/GUS (DOSBox). AudioWorklet mode arrived in 8.4.0, and 8.5.0 improved pacing and underrun recovery. Browser autoplay rules still need a user gesture.
- Networking: IPX over WebRTC ("WebRTC-NET", replacing HumbleNet in 8.4.0).
- Perf: no x86 JIT in the wasm builds, as far as we can tell (DOSBox dynamic cores emit native code; the wasm builds use interpreter cores) [unverified]. There is a turbo panel (cycles, fast-forward, frame skip) and a Dhrystone harness from v7. Nearly all DOS-era games are fine; heavy late-DOS 3D titles may need tuning [estimate].
- Hosting: static files only. It does **not** work from `file://`; it needs `http://localhost` or HTTPS.
- **js-dos MCP server `mcp-v0.1.0` (2026-11-12):** a local stdio MCP executable, about 15-17 MB (archive about 6 MB). It embeds Studio, DOSBox and DOSBox-X workers, libzip, and HTML/Vite/React/Vue/Angular templates, and needs no Node or Rust. It was tested on **Linux x86_64, Windows x86_64, macOS x86_64 and arm64**. Features (from the 8.5.4 changelog and release notes): the `DosProps.editor` API for bundle creation, config editing and file editing; start/restart; full snapshot export; diagnostics with bounded stdout; keyboard/mouse scenarios; screenshots; explicit timeouts; and standalone project generation that works offline after MCP shutdown. The notes add some caveats: only an OpenCode client was verified, the binaries are unsigned, and "CI readiness ... do[es] not prove that an arbitrary game works correctly." There is also a DOSBox-X debug worker with an MCP/debugger port (8.5.0).

**How an agent automates it (no MCP)**
1. Fingerprint: the file is MZ with no `PE\0\0`/`NE` header at `e_lfanew`, or has `.COM`/`.BAT` launchers. Check for CD images (`.iso/.cue/.bin/.mdf`) and DOS extenders (DOS4GW, PMODE/W, CWSDPMI) as hints.
2. Pick the entry point: rank EXEs by name (avoid SETUP/INSTALL/UNINST), by `.BAT` launchers, and by the presence of config files (`SETUP.CFG`, `SOUND.CFG`, etc.). If the game needs a one-time sound setup, either pre-seed known config (SB16 A220 I5 D1 H5 T6) or run SETUP inside the emulator through MCP scenarios.
3. Write `.jsdos/dosbox.conf`: `[cpu] core=auto cycles=auto`, `[sblaster] sbtype=sb16`, `[autoexec] mount c . / c: / GAME.EXE`. For CD games add `imgmount d game.iso -t iso`.
4. ZIP it as `game.jsdos`. Emit `index.html` with a **self-hosted** js-dos (copy `emulators/dist/*` locally; no CDN). Serve over localhost or HTTPS.
5. Over 100 MB, use the sockdrive flow.

**With MCP:** do the same through the MCP tools, then use its screenshot and scenario tools for verification and its project generator for the HTML output.

**Verification:** headless browser (Playwright/Chrome) or MCP. Check that the emulator starts without a wasm trap; that the frame changes after N seconds and is non-black; that a keypress scenario changes the frame; that AudioContext is running after a click; and that a save survives reload (OPFS).

### L1b - EmulatorJS + DOSBox Pure (alternative)
- https://github.com/EmulatorJS/EmulatorJS (GPL-3.0). Latest tag 4.3.0-pre (2026-05-17); npm `@emulatorjs/emulatorjs` 4.2.3 (2025-07-05). The `dosbox_pure` core was added in 4.2.2 and "requires threading" (SharedArrayBuffer, so the server must send COOP/COEP headers). DOSBox Pure itself: https://github.com/libretro/dosbox-pure (GPL-2.0, commits to 2026-11-05).
- Upside: a single frontend for many systems (RomM uses it for DOS), ZIP loading, and DOSBox Pure's auto-start menu. Downside: less tuned for the browser than js-dos (no sockdrive, no WebGL Voodoo); DOSBox Pure's native Win9x/3dfx support is not shown to work in the web core [unverified].
- Use it only if the plugin already standardises on EmulatorJS for other lanes.

### L2 - Win16 / Win9x-era Win32 inside js-dos DOSBox-X (best compatibility)
- DOSBox-X upstream: https://github.com/joncampbell123/dosbox-x (GPL-2.0, 2026.10.01). js-dos tracks a fork (`dosbox-x-v2026.08.31-92` in 8.5.0).
- js-dos docs: "capable of running operating systems up to Windows 98/ME ... may be a bit slower than traditional DOSBox". js-dos provides prebuilt Win95/98 base images, a Studio flow (download base image, upload game folder, `mount d .`/`imgmount`, `boot c:`, install, add `boot c:` to autoexec, export), and downloadable DirectX 7/8/9 and 3dfx drivers.
- **3dfx:** set `backend: "dosboxX"`, `renderBackend: "webgl"`, `offscreenCanvas: true`, `workerThread: true`, and `[voodoo] voodoo_card=opengl` with `glide=false`. Install the 3dfx driver inside the guest for Windows games. Verify with the stats panel ("Glide GL (3D): Yes") or the console line `glfx enabled`. CI covers Tomb Raider 3Dfx plus "D3DTunnel" checks (8.5.0); we could not find what D3DTunnel is [unverified].
- Known issues: MMX-related random crashes (use `cputype=pentium`); driver crashes (try another driver); a Civ II sockdrive hang fixed in 8.5.1; a PS/2 mouse regression fixed in 8.5.2. Pointer-lock mode requires the Intellipoint driver and `mouse_emulation=always`.
- Direct3D: D3D games run inside the Win98 guest on whatever the emulated hardware offers (S3 software path, or 3dfx D3D drivers for DX5-7-era titles). **There is no D3D8/9 hardware T&L path**, so in practice the DX8/9 era is out of reach in this lane.
- **Licensing blocker:** the guest is Microsoft Windows. The skill should ask the user to provide their own Win3.x/9x install media or licence, or prefer L3 (Wine, no Microsoft code). It should not silently pull js-dos's prebuilt images.
- Automation: as in L1, but the game install happens *inside* the guest. Use MCP scenarios (keyboard/mouse plus screenshots) to click through installers, or pre-install on a base image. Hand-holding is the realistic default for setup wizards [estimate].
- Verification: as in L1, plus: guest reaches the desktop; the game window appears (screenshot diff); "Glide GL (3D) = Yes" for 3dfx titles; FPS from the turbo stats is at or above the game's minimum.

### L3 - Boxedwine web (Wine, no Microsoft OS needed)
- https://github.com/danoon2/Boxedwine (GPL-2.0). Latest release 26R1 (2026-04-22); last commit 2026-11-16. It runs an unmodified 32-bit Wine (versions 3.1 to 11.0 selectable) on an emulated Linux kernel and x86 CPU. It runs 16- and 32-bit Windows programs and builds for Windows, macOS, Linux and the Web (Emscripten).
- README TODOs (current): "Emscripten/Web Boxedwine is still slow, need to implement a JIT. Multi-threaded build also studders with sound." "Games after the year 2010 have limitted success." "Joystick support" is listed as a TODO. 26R1 is "50% faster for all platforms except WASM" and has "improved audio for web builds, still not perfect".
- Official online demos (boxedwine.org/demo): Age of Empires (DirectDraw), Caesar III (DirectDraw), Full Tilt! Pinball, 3-D Ultra Pinball, Marble Drop (GDI), plus Win 3.x titles (Castle of the Winds, WinG Return of Arcade).
- 3D in the web build: Boxedwine forwards guest OpenGL to host OpenGL on desktop. In the browser that means WebGL, and legacy fixed-function GL is listed as a "hard" open item by a community porting effort (TribesNext thread). **Treat the web lane as 2D only** [unverified for D3D].
- Packaging (official "Web Build Configuration" page; parts reference Wine 1.7-era files, so some of it may be stale): `boxedwine.html?root=<rootfs>&app=<game>.zip&p=<EXE>&work=<dir>`. `app=` mounts a zip as `d:`; `overlay=a.zip;b.zip` adds files to the root fs; `ondemand` lazily range-requests zip entries; `app-payload=` takes a base64 zip. Storage defaults to memory (changes lost on tab close); `STORAGE_LOCAL_STORAGE` is an option. Drag-and-drop of a folder is supported when `AUTO_RUN=false`. A third-party host page uses argv style (`-root /root -zip boxedwine.zip -mount_drive /mnt/c c -p ...`) [unverified].
- Automation: copy the game folder, zip it, generate the page with `app`/`p`/`work` params, and serve over HTTP. Optionally pre-run the installer on desktop Boxedwine, which is the same emulator, then zip the resulting `drive_c`.
- Verification: the window appears; no `fixme:`/unimplemented storms in the console; input and audio work; FPS is acceptable. Expect many 2D titles to be too slow on low-end machines.

### L4 - v86 with a Windows guest
- https://github.com/copy/v86 (BSD-2-Clause). npm `v86@0.5.473` (2026-10-30); v86.wasm about 2 MB.
- It is an x86 PC emulator with an **x86-to-wasm JIT**. CPU is roughly Pentium 4 class with SSE3; there is no 64-bit and no multicore, and some FPU/SSE exceptions are missing. Devices: VGA/SVGA + Bochs VBE, SB16, IDE, NE2000, virtio fs/net/balloon. **No 3D device.**
- OS compatibility (README): "Windows 1, 3.x, 95, 98, ME, NT and 2000 work reasonably well" (2000+ need "Standard PC" not ACPI; there are known boot issues). "Windows XP, Vista and 8 work under certain conditions".
- 3D: discussion #1611 describes an experimental chain: guest `opengl32.dll` proxy, then a `v86gl.sys` driver, then a virtual PCI device, then gl4es (Emscripten), then WebGL. It reports Warcraft III in OpenGL mode at about 10-15 FPS. It is a proof of concept and not merged [unverified as to status].
- Effort: you must build a guest disk image (install Windows plus the game) and a profile. Saves come from the state-save API. It needs a Microsoft OS licence, like L2.
- The project policy rejects AI-written PRs and issues, which matters if our plugin wants to upstream fixes.
- When it beats L2: CPU-bound 2D Win9x/2000 titles (JIT vs interpreter) that need neither 3dfx nor DirectX hardware.

### L5 - Win32 API reimplementations (RetroTick, retrowin32)
- RetroTick (https://github.com/lqs/retrotick, CC0-1.0, Show HN ~2026) parses PE/NE/MZ, emulates x86, and reimplements part of Win32/Win16/DOS in TypeScript, with a virtual FS and registry in IndexedDB. It runs FreeCell, Minesweeper and QBasic; VB6 apps and Sim Theme Park fail.
- retrowin32 (https://github.com/evmar/retrowin32, Apache-2.0) is "still early".
- Use: only as a quick check for tiny Win16/Win32 toys. Not a game lane.

### L6 - CheerpX / WebVM (watch, do not use yet)
- CheerpX is a closed-source x86-to-wasm interpreter plus JIT running **32-bit x86 Linux user-mode binaries** with a Linux syscall layer. It is "working on a full system emulation mode, with DOS-era applications and games already supported". Graphics go through a KMS canvas or framebuffer, so there is no GPU acceleration. It needs SharedArrayBuffer, which means COOP/COEP and HTTPS.
- WebVM (https://github.com/leaningtech/webvm, Apache-2.0 wrapper; the CheerpX engine itself is proprietary). Leaning Technologies has repeatedly listed "Windows applications and games via WINE" as *planned*, noting mmap tuning is needed. We found **no 2025-2026 evidence it shipped**.
- CheerpX Games Runner (Apache-2.0 extension, 1.0 2024-08-20, last commit 2024-09) runs GOG **DOS** games from the user's library. It is dormant.
- Licence (cheerpx.io/docs/licensing, 2026): the free Community License covers individuals including one-person companies, FOSS projects and technical evaluations, with credit. It allows unlimited use **only from the `cxrtnc.leaningtech.com` CDN**. Self-hosting, business use, redistribution and OEM use need a Commercial License (a third-party mirror lists GBP 100/dev/month for small business [unverified]).
- Verdict: no lane today. Re-check if Wine-on-CheerpX ships, because its JIT would beat L3 by a lot.

### L7 - Static recompilation (beyond retro-port)
**What exists (as of 2026-11)**

| Project | Target | License | Status |
|---|---|---|---|
| retro-port (Dhaiwat10) | Win32 i386 D3D8 PC games to C to wasm/WebGPU | MIT | 2026; macOS-only host; analysed separately |
| N64Recomp | N64 MIPS to C | MIT | "Mod Tool" release 2025-11-19; commits 2026-11 |
| XenonRecomp (hedge-dev) | Xbox 360 PPC to C++ | MIT | last commit 2025-08-04 (Sonic Unleashed Recompiled) |
| ReXGlue SDK | Xbox 360 PPC to C++ (Xenia-based runtime) | custom/BSD-style w/ Xenia portions [unverified] | v0.1.x, 2026; GoldenEye XBLA, Blue Dragon |
| PSXRecomp (mstan) | PS1 MIPS to C to native/**wasm** | not found | Pepsiman Recompiled web build, July 2026 ("first wasm-first release") |
| xboxrecomp / blinx2-recomp | **original Xbox x86-32 to C** (Python+capstone) | [unverified] | only Burnout 3 completes, "very slowly" |
| Anybox (write-up) | original Xbox x86-32 to C (clang) + Rust kernel/XDK runtime, arm64 macOS | [unverified] | blog, Oct 2026, 3 games tested [unverified] |
| ARET | Windows PE x86-32 to native Linux | [unverified] | solo project [unverified] |
| remill | x86/ARM machine code to LLVM IR (lifter) | Apache-2.0 | v6.0.1 2026-04-21 |
| RetDec | generic decompiler (LLVM) | MIT | last release v5.0 2022-12; commits 2026-05 |

**Why PC x86 is harder than consoles:** there is no fixed hardware. Code uses x87 FPU and MMX/SSE, MSVC C++ exception handling, SEH, jump tables and indirect calls, imports from hundreds of Win32/DirectX DLLs, and sometimes packers or self-modifying code. Console recompilers lean on a single known CPU and SDK, which is why original-Xbox (x86 + a D3D8-like API) is the closest analogue and still immature.

**Decompilation pipelines (Ghidra/IDA plus AI)**
- Tooling: Ghidra with MCP bridges (LaurieWired/GhidraMCP; bethington GhidraMCP v5.14.2, 2026-06 [unverified]); `mrexodia/ida-pro-mcp` (MIT); `re-mcp` (Ghidra 12+/IDA 9). For matching MSVC decomps: **reccmp** (isledecomp, AGPL-3.0, v0.1.9 2026-11-08).
- Results: Snowboard Kids 2 (N64) reached **100% matching in May 2026 after 596 days**, with one-shot Claude taking it from ~25% to 58% before a "long tail". Original Snowboard Kids took 84 days. **decomp.dev closed in October 2026**, its admin saying AI "broke the community aspect". Browser outcomes: LEGO Island (1997 Win32) decomp, then `isle-portable` Emscripten, giving **isle.pizza** (June 2025, active 2026); Halo CE (Xbox) decomp to wasm (September 2026, intermittently taken down).
- Takeaway: full decompilation is a person-months project even with agents. The skill should **detect and reuse** existing decomps/source ports (sibling note) rather than start one.

**When recompilation beats emulation**

| Prefer emulation (L1-L4) | Prefer recompilation (L7) |
|---|---|
| DOS, Win16, 2D Win9x, Glide | D3D8/D3D9-era 3D with no browser GPU path in emulators |
| Packed/compressed exe (UPX/ASPack) - the emulator just runs the unpacker | CPU-heavy 3D where interpreter emulation is too slow |
| Self-modifying code, JITs, odd runtimes (VB, Delphi, .NET 1.x) | No Windows licence available and Wine 2D is too slow |
| Unknown or obscure APIs - real Windows/Wine covers the long tail | Output must run at native speed on low-end or mobile devices |
| Zero per-game engineering wanted | You accept hours to days of per-game agent work and a derivative work you cannot redistribute |

### L8 - Existing decomp/source port
Covered by the sibling note. Mentioned here so the ladder checks it *before* any binary lane: isle.pizza, Halo CE wasm, and the GunZ browser port, which used the leaked source plus `d3d9-webgl`, not the binary.

---

## Graphics API translation status (Q4)

| Guest API | In-browser path that exists today | Library / license | Status |
|---|---|---|---|
| VGA/VESA, GDI, WinG | All emulator lanes (software framebuffer to canvas) | - | Works |
| **Glide (3dfx)** | js-dos DOSBox-X Voodoo emulation, then WebGL (OffscreenCanvas, worker) | GPL-2.0 | **Works** (8.4.0+; "the only browser solution") |
| DirectDraw | Win98 guest (L2/L4), Wine ddraw (L3), retro-port (HARD) | - | Works under emulation (2D); recomp needs a shim |
| D3D 3-7 (immediate mode) | Win98 guest with 3dfx D3D driver (L2) | - | Possible for DX5-7-era titles [unverified per title]; d7vk (Vulkan) is native-only |
| **D3D8** | retro-port D3D8 to WebGPU | MIT | GO lane per retro-port; `crosire/d3d8to9` (BSD-2, v1.16.0 2026-09-23) can fold D3D8 into a D3D9 path |
| **D3D9** | `LostMyCode/d3d9-webgl` (D3D9 fixed-function to WebGL2 for Emscripten; about 3.4 kLOC, DXT passthrough) | MIT | Proven on GunZ (with source); usable as a recomp backend; **no shader-model support claimed** |
| OpenGL 1.x/2.x | **gl4es** (GL 1.5/2.1 to GLES2, Emscripten target) or Emscripten `LEGACY_GL_EMULATION` | MIT / MIT | gl4es v1.1.6 (2024-05), commits 2026-11; used by the v86 GL PoC |
| WineD3D (D3D to GL) via Emscripten | none packaged; Boxedwine runs wined3d in-guest but browser GL lacks fixed-function | LGPL | Not usable |
| DXVK / VKD3D / D3D9On12 | require Vulkan/D3D12 hosts; browsers expose neither | - | **Irrelevant** for browsers |
| D3D10/11/12, Vulkan | no translation to WebGPU exists (WGVK goes the other way: WebGPU on Vulkan) | - | **None** |
| Regal (GL compat) | repo `p3/regal` returns 404 | - | Dead |
| dgVoodoo2 | DDraw/D3D1-9/Glide to D3D11/12, Windows host only | proprietary freeware (2.87.2, 2026-06) | Not browser-usable; reference only |
| cnc-ddraw | DDraw to GDI/OpenGL/D3D9 on Windows | MIT (2026-09) | Native only; useful as a design reference for a recomp DDraw shim |

Browser GPU baseline (2026): WebGL2 is universal. WebGPU is in Chrome/Edge (desktop; Android 12+; Linux rollout from Chrome 144 on Intel Gen12+), Safari 26 (all Apple OSes) and Firefox 141+ on Windows (macOS ARM later), but **not Firefox Linux/Android** [secondary sources]. So recompiled outputs targeting WebGPU need a WebGL2 fallback, or must declare browser requirements.

---

## Modern 64-bit DX11/DX12/Vulkan games (Q5): no in-browser path

Reasons, checked 2026-11:
- **CPU:** no browser x86-64 emulator can run Windows games. v86 and CheerpX are 32-bit only. QEMU-wasm boots x86_64 Linux guests but is experimental, slow and has no GPU. Sogen emulates x64 Windows *user mode* for malware analysis and has no graphics.
- **Memory:** wasm32 caps at 4 GB. Memory64 shipped in Chrome 133 and Firefox 134 (January 2025) and is slower due to bounds checks; Safari is pending.
- **GPU:** browsers expose no Vulkan or D3D12, and nothing translates D3D11/12 or Vulkan to WebGPU.
- **Recomp:** retro-port and all console recompilers stop at 32-bit or console ISAs; no x86-64 PC recompiler exists.

**Fallback: stream the natively running game ("Remote Play").**

| Option | Host OS | Browser transport | Gamepad | Setup | License | Latest |
|---|---|---|---|---|---|---|
| **Sunshine + moonlight-web-stream** (recommended default) | Sunshine: Windows, Linux, macOS, FreeBSD; web bridge is a Rust binary or Docker | WebRTC (STUN/TURN), WebSocket + WebCodecs fallback | Gamepad API (needs HTTPS/secure context); keyboard lock | Medium: install Sunshine, run bridge, pair via PIN, HTTPS, TURN for internet | GPL-3.0 / GPL-3.0 | Sunshine v2026.1117.42813 (2026-11-17); bridge v3.0.2 (2026-11-15) |
| **Vibepollo** (Sunshine fork, built-in WebRTC page) | Windows | WebRTC (since 1.14.0, 2026-01-18) | Yes, incl. gyro; own virtual-gamepad driver | Low-medium: one install, no pairing needed for WebRTC | GPL-3.0 | 2.0.x (versions conflict across listings) [unverified] |
| linckosz/moonlight-web | any Sunshine host | WebRTC + WSS fallback | Yes | Medium | GPL-3.0 | v0.4.x [unverified date] |
| **Selkies** | **Linux only** (X11/Wayland; Windows games via Wine/Proton in container) | WebSocket by default, WebRTC opt-in; WebCodecs | Yes ("gaming mode") | Medium: Docker/LinuxServer images | MPL-2.0 | rolling 2026-11-17 |
| Wolf (Games on Whales) + moonlight-web | Linux (Docker) | via moonlight-web bridge | Yes | High | MIT | v2026.11 (2026-11-01) |
| Neko | Linux (Docker) | WebRTC | not documented | Medium | Apache-2.0 | v3.2.0 (2026-10-15) - built for shared browsing, "not suitable for real-time gaming" per third party |
| KasmVNC | Linux | WebSocket, WebCodecs H.264/H.265/AV1 | up to 4 (Kasm Workspaces, 2022 note) | Medium | GPL-2.0 | 1.5.2 (2026-10-24) - desktop-first |
| Parsec web client | Host Windows/macOS; web client Chromium only, cannot join macOS hosts | proprietary | Yes | Low | proprietary (free personal tier) | n/a |
| Steam Remote Play / Steam Link | - | **no browser client**; RPT invite links open the Steam Link app | - | - | proprietary | - |
| Apollo (Sunshine fork) | Windows | native Moonlight only | - | - | GPL-3.0 | v0.4.8 (2025-09-26) |

Latency: native Moonlight on LAN is low tens of ms; browser clients add decode and jitter-buffer time, and Vibepollo itself says browser streaming "is not intended to be as smooth as the native Moonlight client" [estimate; measure per setup].

**Labeling rule:** call it **"Remote Play (streamed from your PC)"**, never "port" or "web version". The UI must state that the game runs on the host, the host must stay on, it does not work offline, it cannot be shared or hosted as a page, and exposing it to the internet needs auth plus HTTPS (and TURN for strict NATs).

---

## Licensing and distribution (Q6)

| Lane | What gets shipped | Implications |
|---|---|---|
| js-dos (L1/L2) | GPL-2.0 runtime + user's game files in a zip | Emulator and game data are separate works ("aggregation"). If the HTML/wasm is redistributed, include GPL notices and a source pointer (the js-dos MCP release bundles notices and source revisions). **Game files: the user's own, for private use; never publish.** L2 adds a **Windows OS** image, which needs a Microsoft licence; do not use or redistribute js-dos prebuilt Win95/98 images unless the user owns a licence (legal review). |
| EmulatorJS + DOSBox Pure | GPL-3.0 + GPL-2.0 | Same as above. |
| Boxedwine (L3) | GPL-2.0 emulator + Wine (LGPL-2.1) + Debian-derived userland | Fully redistributable software stack with **no Microsoft code**. Only the game files are restricted. |
| v86 (L4) | BSD-2 | Permissive emulator, but the guest Windows image is Microsoft's. |
| CheerpX (L6) | proprietary | Free only for individuals, one-person companies, FOSS and evaluation; runtime must load from Leaning's CDN (no offline or self-host) unless commercially licensed; companies need a paid licence. |
| Recompilation (L7) | Generated C/wasm **derived from the copyrighted binary** | Personal-use interoperability at best, depending on jurisdiction (e.g. EU Software Directive Art. 6, US DMCA §1201(f) interoperability exemption). **Never redistribute the output.** Tool licences (MIT) are fine. |
| Streaming (L9) | nothing distributed | Lowest legal risk. Sunshine and bridges are GPL-3.0 (only matters if we redistribute modified binaries). Parsec/Steam ToS apply if used. |
| DRM | - | Any lane that *removes or bypasses* DRM is out of scope (anti-circumvention law). Emulating an unmodified, legitimately owned disc image with its own check is legally greyer; flag it for review. Streaming runs DRM'd games natively without circumvention. |

---

## Decision ladder (Q7)

Run the fingerprint first. It should be static only, never execute the binary.
- Header: `MZ`; `e_lfanew` points to `PE\0\0` (check Machine `0x14c` i386 vs `0x8664` AMD64), `NE` (Win16), or nothing (DOS).
- PE imports: `ddraw`, `d3d8`, `d3d9`, `d3d10/11/12`, `dxgi`, `vulkan-1`, `opengl32`, `glide*.dll`, `dsound`, `dinput*`, `winmm`, `steam_api`, `binkw32`, `mss32`.
- Engine markers go to the sibling engine lanes.
- Protection: SafeDisc (`secdrv.sys`, `.icd`), SecuROM (`.securom` section), StarForce, Denuvo, Steam stub (`.bind` section), packers (UPX/ASPack/Themida/VMProtect section names, high-entropy sections).

| Rung | Condition | Lane | Expected effort | Success odds [estimate] | Verification must check |
|---|---|---|---|---|---|
| 0 | Engine detected, or a known decomp/source port exists | sibling note (engine/source lanes, L8) | varies | varies | per that lane |
| 1 | DOS (MZ only) | **L1 js-dos** (DOSBox; switch to DOSBox-X for 3dfx or Win3.1 launchers) | minutes | 85-95% | boots, frame non-black and changing, keypress changes frame, audio running after gesture, OPFS save survives reload |
| 2 | Win16 (NE) | **L2 js-dos DOSBox-X + Win3.11** if the user has a Win3.x licence; else **L3 Boxedwine** | 30-90 min (mostly installer automation) | 70-85% / 40-60% | guest desktop reached, game window visible, input works |
| 3 | PE i386, 2D (GDI/DirectDraw/WinG), roughly pre-2001, no DRM | **L3 Boxedwine** first (no Microsoft OS); if too slow or failing, **L2 DOSBox-X + Win98**; if CPU-bound with no 3D needs, **L4 v86** | 1-3 h | 30-50% / 50-70% / 40-60% | as above, plus FPS at or above target on a reference low-end machine, no unimplemented-API spam, sound not stuttering |
| 4 | PE i386 with Glide, or DX5-7 era with 3dfx support | **L2 DOSBox-X + Win98 + Voodoo/WebGL** | 2-4 h | 40-60% | "Glide GL (3D): Yes" in stats, `glfx enabled`, FPS |
| 5 | PE i386, **D3D8**, unprotected, unpacked | **L7 retro-port** (GO) | hours to days | 40-60% | per retro-port: build passes, no wasm traps, canvas renders expected frames, input/audio, memory < 4 GB |
| 6 | PE i386, D3D9 / DirectDraw-3D / OpenGL 1.x | **L7 recompile (HARD)** using d3d9-webgl or gl4es backends; if it fails, go to L9 | days | 10-25% | as rung 5, plus a WebGL2 fallback if targeting WebGPU |
| 7 | PE i386 packed but otherwise rung 2-4 | emulation lanes (L2/L3/L4) still apply; recomp does not | as rung | slightly lower | as rung |
| 8 | PE AMD64, D3D10/11/12, Vulkan, .NET Core/modern runtime, or year >= ~2010 | **L9 Remote Play** (Sunshine + moonlight-web-stream; Vibepollo on Windows; Selkies on Linux) | 30-60 min setup | 90%+ (not a port) | host encoder detected (NVENC/AMF/QSV/VideoToolbox), browser connects (WebRTC or WS fallback), input + gamepad over HTTPS, audio, measured end-to-end latency, auth enabled |
| 9 | DRM-protected (any era) | **STOP for in-browser lanes**; suggest a DRM-free edition (e.g. GOG) and re-fingerprint; L9 allowed since the game runs unmodified on the host | - | - | confirm no patched/cracked binaries were produced |

---

## Open risks

1. **js-dos MCP is 5 days old (mcp-v0.1.0).** Only one MCP client (OpenCode) was verified, the binaries are unsigned, and the release notes disclaim per-game correctness. Plan an L1 path that works without it (plain zip + conf).
2. **Windows guest licensing (L2/L4).** The biggest-compatibility lanes need a Microsoft OS image. Defaulting to js-dos prebuilt images is a legal risk. Prefer Boxedwine where it is fast enough.
3. **Performance is unmeasured by us.** DOSBox-X and Boxedwine are interpreter-only in the browser. Build a per-lane perf probe (FPS and frame-time from a fixed scenario) before declaring success; low-end Chromebooks and phones will fail many Win9x titles.
4. **Boxedwine web docs are partly stale** (Wine 1.7-era file names), and 3D in the web build is unclear. Budget a spike before committing to it.
5. **retro-port is macOS-only.** port-any-game must build on Windows and Linux too, so its pipeline (Emscripten, shims) needs porting or containerising.
6. **Browser platform constraints:** COOP/COEP for SharedArrayBuffer (CheerpX, EmulatorJS threads, DOSBox-X workers); no `file://`; autoplay gestures; pointer lock; OPFS quotas; Safari lacks Memory64; WebGPU gaps on Firefox Linux/Android; JSPI only in Chrome 137+ (Firefox and Safari pending [unverified]).
7. **Streaming security:** exposing a desktop or game host to the internet needs auth, HTTPS and TURN. Gamepad needs a secure context. Selkies cannot host on Windows, and Steam has no browser client.
8. **DRM/legal:** the skill must never patch binaries to bypass protection; any "it works in an emulator with the original disc" claim needs legal review per jurisdiction.
9. **Source quality:** several data points come from secondary coverage (dgVoodoo licence, Vibepollo version, Anybox, ARET, ReXGlue licence, D3DTunnel, CheerpX pricing). These are marked [unverified].
10. **Fast-moving area:** AI-assisted decomp and recomp tooling changed a lot in 2026. Re-check L7 and L8 options each quarter.

---

## Sources (accessed 2026-11-17 unless stated; publication or release date in brackets)

DOS / Win9x emulation
- js-dos repo https://github.com/caiiiycuk/js-dos [8.5.4 2026-11-12; mcp-v0.1.0 2026-11-12]
- js-dos CHANGELOG https://unpkg.com/js-dos@8.5.4/CHANGELOG.md [2026-11-12]
- js-dos README https://unpkg.com/js-dos@8.5.4/README.md
- js-dos mcp-v0.1.0 release notes https://github.com/caiiiycuk/js-dos/releases/tag/mcp-v0.1.0 [2026-11-12]
- npm registry js-dos / emulators https://registry.npmjs.org/js-dos , https://registry.npmjs.org/emulators [2026-11-12 / 2026-11-10]
- js-dos docs: overview https://js-dos.com/overview.html ; getting started https://js-dos.com/dos-api.html [2025-04-21]; bundles https://js-dos.com/jsdos-bundle.html [2026-06-22]; 3dfx https://js-dos.com/3dfx.html [2026-06-22]; DOSBox-X https://js-dos.com/dosbox-x.html [2026-06-19]; Win9x sockdrive https://js-dos.com/win9x-sockdrive.html [2026-01-22]; sockdrive https://js-dos.com/sockdrive.html
- DOSBox-X https://github.com/joncampbell123/dosbox-x [2026.10.01]
- em-dosbox https://github.com/dreamlayers/em-dosbox [last release 2022-12-08]
- EmulatorJS https://github.com/EmulatorJS/EmulatorJS [4.3.0-pre 2026-05-17]; changelog https://cdn.emulatorjs.org/4.3.0-pre/CHANGES.md
- DOSBox Pure https://github.com/libretro/dosbox-pure [commit 2026-11-05]
- RomM docs (DOS via dosbox-pure) https://docs.romm.app/4.9.2/using/in-browser-play/ms-dos/
- PCjs https://github.com/jeffpar/pcjs (MIT) [commit 2026-11-16]
- 86Box https://github.com/86Box/86Box [6.0 2026-05-31]

Windows without recompiling
- Boxedwine https://github.com/danoon2/Boxedwine [26R1 2026-04-22; commit 2026-11-16]
- Boxedwine web build configuration http://www.boxedwine.org/documentation/web-build-configuration/ ; demos http://www.boxedwine.org/demo/
- XDA on Boxedwine in browsers https://www.xda-developers.com/boxedwine-emulate-windows-applications-web-browsers/ [2021]
- TribesNext Boxedwine thread https://tribesnext.com/forum/discussion/comment/29970 [undated]
- v86 https://github.com/copy/v86 and README https://cdn.jsdelivr.net/gh/copy/v86@master/Readme.md [0.5.473 2026-10-30]
- v86 GL4ES discussion #1611 https://github.com/copy/v86/discussions/1611 [undated]
- CheerpX docs/licensing https://cheerpx.io/docs/licensing , overview https://cheerpx.io/docs/overview , FAQ https://cheerpx.io/docs/faq ; npm @leaningtech/cheerpx [1.4.0 2026-10-07]
- WebVM https://github.com/leaningtech/webvm ; WebVM blog (Wine plans) https://labs.leaningtech.com/blog/webvm-server-less-x86-virtual-machines-in-the-browser
- CheerpX Games Runner https://github.com/leaningtech/cheerpx-games-runner [1.0 2024-08-20]
- RetroTick https://github.com/lqs/retrotick ; Show HN https://hn.nuxt.dev/item/47180083 [2026]
- retrowin32 https://github.com/evmar/retrowin32
- QEMU-wasm https://github.com/ktock/qemu-wasm ; FOSDEM 2025 talk https://archive.fosdem.org/2025/schedule/event/fosdem-2025-6290-running-qemu-inside-browser/ ; wasm TCG patch series https://patchew.org/QEMU/cover.1755623521.git.ktokunaga.mail@gmail.com [2025-08]
- Sogen docs https://www.mintlify.com/momo5502/sogen
- box64 https://github.com/ptitSeb/box64 [v0.4.5 2026-08-07]

Recompilation / decompilation
- N64Recomp https://github.com/N64Recomp/N64Recomp ; XenonRecomp https://github.com/hedge-dev/XenonRecomp ; ReXGlue https://github.com/rexglue/rexglue-sdk ; ReXGlue interview https://readonlymemo.com/rexglue-xbox-360-recompilation-interview/
- PSXRecomp https://github.com/mstan/psxrecomp ; Pepsiman web build https://www.notebookcheck.net/A-recompiled-version-of-Pepsiman-lets-you-play-the-PS1-cult-classic-natively-in-your-browser-at-60-FPS.1354060.0.html [2026-07]
- xboxrecomp coverage https://korben.info/en/xboxrecomp-turn-xbox-game-into-windows-exe.html ; BLiNX 2 recomp https://raw.githubusercontent.com/apexJCL/blinx2-recomp/HEAD/README.md
- Anybox write-up https://levelup.gitconnected.com/building-anybox-9be69b13e9e5 [2026, unverified date]
- ARET https://dev.to/aciiderixx_d3f21e795ce4eb/aret-translates-legacy-windows-x86-binaries-to-native-linux-executables-ej2
- remill https://github.com/lifting-bits/remill [v6.0.1 2026-04-21]; RetDec https://github.com/avast/retdec
- reccmp https://github.com/isledecomp/reccmp [v0.1.9 2026-11-08]; LEGO Island browser https://www.gamesradar.com/games/lego-island-is-now-fully-playable-in-your-browser-thanks-to-a-group-of-fans-who-spent-years-painstakingly-decompiling-the-games-original-code-by-hand
- Halo CE browser port https://www.pcgamer.com/hardware/you-can-now-play-halo-combat-evolved-in-a-web-browser-and-it-even-has-multiplayer/ [2026-09/10]
- Chris Lewis, LLM-assisted N64 decompilation https://blog.chrislewis.au/using-coding-agents-to-decompile-nintendo-64-games/ ; https://blog.chrislewis.au/snowboard-kids-2-is-100-decompiled/ [2026-05]
- decomp.dev closure https://www.videogameschronicle.com/news/one-of-the-biggest-game-decompilation-sites-is-closing-because-ai-has-broken-the-community-aspect/ ; https://www.timeextension.com/news/2026/10/the-community-aspect-of-decompilation-has-been-broken-decomp-dev-closes-in-the-wake-of-ai-based-bad-actors [2026-10]
- AI decomp list https://capitalandcompute.net/blog/which-games-has-ai-decompiled/ [2026-10, secondary]
- ida-pro-mcp https://github.com/mrexodia/ida-pro-mcp ; GhidraMCP https://github.com/LaurieWired/GhidraMCP

Graphics
- d3d9-webgl https://github.com/LostMyCode/d3d9-webgl ; write-up https://dev.to/whiplash/d3d9-webgl-run-legacy-d3d9-code-in-the-browser-without-rewriting-it-1108 [2026]
- gl4es https://github.com/ptitSeb/gl4es [v1.1.6 2024-05-04; commit 2026-11-11]; Emscripten OpenGL support https://emscripten.org/docs/porting/multimedia_and_graphics/OpenGL-support.html
- d3d8to9 https://github.com/crosire/d3d8to9 [v1.16.0 2026-09-23]; cnc-ddraw https://github.com/FunkyFr3sh/cnc-ddraw [2026-09-28]
- dgVoodoo2 https://sourceforge.net/app/dgvoodoo2/ ; d7vk news https://www.gamingonlinux.com/2026/02/vulkan-based-translation-layer-d7vk-officially-expands-to-include-direct3d-5-support/
- WebGPU status https://web.dev/blog/webgpu-supported-major-browsers ; https://github.com/gpuweb/gpuweb/wiki/implementation-status ; Chrome 146 compat mode https://developer.chrome.com/blog/new-in-webgpu-146 [2026-02-25]
- Memory64 https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html [2025-01-15]; caniuse https://caniuse.com/wf-wasm-memory64
- JSPI https://web-platform-dx.github.io/web-features-explorer/features/wasm-jspi [Chrome 137, 2025-05-27]

Streaming
- Sunshine https://github.com/LizardByte/Sunshine [v2026.1117.42813 2026-11-17]
- moonlight-web-stream https://github.com/MrCreativ3001/moonlight-web-stream [v3.0.2 2026-11-15]
- linckosz/moonlight-web https://github.com/linckosz/moonlight-web
- Vibepollo https://github.com/Nonary/Vibepollo ; 1.14.0 WebRTC release https://newreleases.io/project/github/Nonary/Vibepollo/release/1.14.0 [2026-01-18]
- Selkies https://github.com/selkies-project/selkies ; 2.0.0rc0 notes (Linux-only hosts) https://newreleases.io/project/github/selkies-project/selkies/release/2.0.0rc0
- Wolf https://github.com/games-on-whales/wolf [v2026.11 2026-11-01]; Helix on Wolf + moonlight-web https://blog.helix.ml/p/technical-deep-dive-on-streaming
- Neko https://github.com/m1k1o/neko [v3.2.0 2026-10-15]; KasmVNC https://github.com/kasmtech/KasmVNC [1.5.2 2026-10-24]; KasmVNC client docs https://kasm.com/kasmvnc/docs/latest/clientside.html
- Parsec web app https://support.parsec.app/hc/en-us/articles/32381650129300-Use-the-Web-App-browser ; hosting https://support.parsec.app/hc/en-us/articles/4422936497165-Hosting-and-Permissions
- Steam Remote Play Together invite https://www.engadget.com/steam-remote-play-together-account-invite-anyone-175017613.html [2021]
- Apollo https://github.com/ClassicOldSong/Apollo [v0.4.8 2025-09-26]
