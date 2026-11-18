# Spike e: js-dos 8.5.4 bundle embedding (DOS lane, Task 18)

Date 2026-11-17. Windows 11, Edge 157 headless (`--headless=new`, same launch flags as spike d), Node 22.22.3.
js-dos obtained with `npm pack js-dos@8.5.4` into `docs/spikes/scratch/jsdos/` (git-ignored). Throwaway files in `docs/spikes/scratch/`: `mkbundle.mjs`, `server.mjs`, `www/jd.html`, `www/raw.html`, `jd-run*.mjs`. Server: `node:http` on 127.0.0.1, path prefix `/coi/` adds COOP `same-origin` + COEP `require-corp`.

## Verdict

**js-dos lane viable without its MCP: YES for verify via `ci` frames; player UI painting under CDP is NOT demonstrated.** Caveat that changes the verify design: in this environment the js-dos UI canvas never painted (see "Frame sampling"), so verify must read frames from the emulator's command interface (`ci`), not from screenshots or the canvas. macOS and Linux: **unverified, to be covered by Task 23 CI** (ruling R12).

## Test program and bundle

- `ANIM.COM`, 59 bytes of hand-assembled 8086 (no third-party code): `mov ax,13h; int 10h` (VGA mode 13h); `es=A000h`; loop: wait vsync via port 3DAh bit 3 (leave then enter), `rep stosw` 32000 words of colour `bl`, `inc bl`, `int 16h` AH=1 keypress check, loop; on key: consume key, `mov ax,3; int 10h`, `int 21h` AH=4Ch. The byte listing is in `scratch/mkbundle.mjs`.
- `.jsdos` is a plain ZIP (stored, no compression, built by a 30-line Node writer using `zlib.crc32`) containing `.jsdos/dosbox.conf` and `ANIM.COM`. 322 to 407 bytes.
- It ran correctly: frame data was 320x200 RGB (192000 bytes) with a colour that changes every frame (hundreds of frames in 5 s); after a simulated key press (`ci.simulateKeyPress(32)`) the frame size switched to 640x400 (text mode, black), i.e. the program exited and restored mode 3. DOSBox itself stays alive at the prompt, so `onExit` does not fire on program exit.

### dosbox.conf that worked (minimal; this is enough)

```
[autoexec]
mount c .
c:
ANIM.COM
```

A longer variant (`[sdl] autolock=false`, `[cpu] core=auto cycles=max`, `[mixer] rate=44100`, `@echo off` before the mount) also worked; the extra sections are not required. Line endings CRLF or LF both fine. If the conf is missing from the zip, js-dos reports "Missing .jsdos/dosbox.conf" (seen in its editor code), so the bundle must carry it.

## Embedding API (observed, 8.5.4)

Two layers exist; both work.

### A. Player UI: `Dos(element, options)` (global from `js-dos.js`)

```html
<link rel="stylesheet" href="jsdos/js-dos.css">
<div id="dos" style="width:640px;height:400px"></div>
<script src="jsdos/js-dos.js"></script>
<script>
  const props = Dos(document.getElementById('dos'), {
    pathPrefix: 'jsdos/emulators/',   // where emulators.js / wdosbox*.{js,wasm} / wlibzip.* live; must end with '/'
    url: 'anim.jsdos',                // bundle by URL (http(s) or blob:)
    autoStart: true,                  // else a Play button must be clicked
    backend: 'dosbox',                // or 'dosboxX'. Task 18 must pass `backend` explicitly: the default when omitted was NOT checked
    onEvent: (ev, arg) => { if (ev === 'ci-ready') window.ci = arg; }   // arg is the command interface
  });
</script>
```

- Returns an object with `stop`, `save`, `setPaused`, `setVolume`, `setBackend`, `setWorkerThread`, `setOffscreenCanvas`, `setRenderBackend`, `setAutoStart`, `setKiosk`, `setFullScreen`, `getVersion`, `editor` (which has `open(Uint8Array)`, `state()`, etc.), and more.
- Events seen in order: `emu-ready`, `bnd-play`, `ci-ready`. `ci-ready` passes the **command interface** `ci` as the second argument. This is how to reach the running emulator without the UI.
- Option names tried that were accepted without error: `pathPrefix`, `url`, `autoStart`, `backend`, `onEvent`, `dosboxConf`, `initFs`. `noSideBar`, `noFullscreen` and `noCloud` do not appear anywhere in the js-dos 8.5.4 `dist/*.d.ts` or `js-dos.js` (grepped), so they are not valid 8.5.4 options and the sidebar cannot be hidden with them. Without `autoStart` the player shows a Play button and nothing runs until clicked.

### B. Bytes instead of a URL (all three verified: emulator ran and animated)

1. `url: URL.createObjectURL(new Blob([bytes]))` (a `blob:` URL). Works.
2. `dosboxConf: '<conf text>'` plus `initFs: <Uint8Array of a .jsdos zip>`. Works (frames animating). `initFs` as an `Entry[]` array (`[{path, contents}]`) was only tried with wrong contents (my test passed the whole zip as the file body), so it is **unverified**.
3. Raw emulator API, no UI at all (`emulators.js` only):
   ```js
   emulators.pathPrefix = 'jsdos/emulators/';
   const ci = await emulators.dosboxDirect(bundleBytes);   // main thread; or emulators.dosboxWorker(bundleBytes)
   ci.events().onFrameSize((w, h) => { /* 320x200 then 640x400 */ });
   ci.events().onFrame((rgb, rgba) => { /* one is null; rgb = w*h*3 bytes, rgba = w*h*4 (dosboxX) */ });
   ci.events().onStdout(s => {});
   ci.simulateKeyPress(32);                // also ci.sendKeyEvent, ci.width(), ci.height()
   ```
   `bundleBytes` is a `Uint8Array` of the zip. Both `dosboxDirect` and `dosboxWorker` produced frames. `ci.width()/height()` are 0 for `dosboxWorker` until the first frame (check after `onFrameSize`). This was the first thing that showed frames, and is the simplest path for a verify harness; it needs only `emulators.js` plus the wasm files below.

So: **bytes work** (blob URL, `initFs`+`dosboxConf`, or raw `dosbox*(Uint8Array)`), and a URL also works. For BYO (user-owned game data) the shell can fetch the bundle from its own origin or hand it in as bytes; nothing needs to leave the machine.

## dist files needed (from `js-dos@8.5.4/dist/`)

Observed in the server request log (everything else in `dist/` was never requested):

| Purpose | Files |
|---|---|
| UI | `js-dos.js` (325 KB), `js-dos.css` |
| Always (loader + zip) | `emulators/emulators.js` (91 KB), `emulators/wlibzip.js`, `emulators/wlibzip.wasm` (112 KB) |
| Backend `dosbox` (default in my tests) | `emulators/wdosbox.js` (115 KB), `emulators/wdosbox.wasm` (1.46 MB) |
| Backend `dosboxX` (adds; requested only when `backend:'dosboxX'` was passed) | `emulators/wdosbox-x.js` (286 KB), `emulators/wdosbox-x.wasm` (8.0 MB) |

Request log, run with `backend` `dosbox` (and via the raw `dosboxDirect`/`dosboxWorker` API): only `wdosbox.*` was fetched, no `wdosbox-x.*`, so the `dosbox` backend alone avoids the dosboxX files (observed; the omitted-`backend` default is unchecked). Not requested in any test: `file-explorer.*`, `fileexplorer_*`, `webrtcnet.*` (IPX networking), `wdosbox-x-jspi.*`, `wdosbox-x-dbg.*`, `*.map`, `*.symbols`, `types/`. `wasm` must be served as `application/wasm`. `pathPrefix` (UI) / `emulators.pathPrefix` (raw) must point at the folder that contains `emulators.js`'s siblings. A minimal self-hosted set for the `dosbox` backend is about 1.7 MB; with `dosboxX` about 9.9 MB. The `dosboxX` backend needs 10 to 15 s to become ready in this environment (versus a few seconds for `dosbox`), which matters for the ready-time budget.

## COOP/COEP

**Not required.** With plain headers (`crossOriginIsolated=false`, `SharedArrayBuffer` undefined) both backends and all three embedding styles ran and animated. With COOP `same-origin` + COEP `require-corp` (`crossOriginIsolated=true`) they also ran. So `needs_coi` can be false for the DOS lane at 8.5.4 on the tested paths. Not tested: the `jspi` backend, IPX networking, and whether SharedArrayBuffer-based input/audio paths in the worker backend change behaviour in other browsers.

## Frame sampling and the canvas

- The js-dos UI creates a `<canvas>` inside `#dos` (selector `#dos canvas`), so the element is reachable. **But in this environment it never painted**: `Page.captureScreenshot` showed a black 592x400 area for every run (Edge headless; Chrome headless; Edge headful), the canvas stayed at its default 300x150, its inline style was never set, and an instrumented `getContext` was never called. That means js-dos's render effect did not run under CDP here. Same result with `autoStart:true`, with the Play button clicked (CDP mouse click), with `backend: dosbox`/`dosboxX`, `renderBackend:'canvas'|'webgl'`, `offscreenCanvas:false`, with and without COOP/COEP, and with `Page.bringToFront` + focus emulation. Root cause **not found**; it is not a headless-only issue since the headful (off-screen window) run was also black. It could be a driving artefact of CDP or a js-dos 8.5.4 behaviour. Do not rely on UI pixels.
- **Frames from `ci` are reliable in every run**, including while the UI canvas stayed black: `ci.events().onFrame` fired hundreds of times in 5 s with changing colours (observed samples like `[0,0,65]`, `[255,125,0]`; frame length 192000 for `dosbox`, 768000 for `dosboxX`). So Task 18/14 should have the DOS shell capture `ci` from `onEvent('ci-ready')` (or use the raw API) and expose, for verify, something like `window.__pag.dos = { frameCount, lastFrame(), simulateKeyPress }`, with blank/frozen thresholds computed on those buffers. `drawImage(canvas)` on the UI canvas returned alpha 0 (no `preserveDrawingBuffer`), so canvas readback is not an option anyway.
- Audio was not checked (`audio: "uninitialized"` in editor state before a user gesture).

## Gotchas

- Do not declare top-level `const q`/`const bundle` in an inline script that follows `js-dos.js`; it threw a redeclaration error and silently killed my page script (js-dos defines globals). Use an IIFE.
- Passing every option name I could guess is harmless but several are ignored; check behaviour, not absence of errors.
- `Dos()` logs a lot of preact internals to the console (`Object div... Object`); filter them when capturing console for verify.
- First `ci-ready` arrives after `bnd-play`; `ready:true` in `props.editor.state()` was true while no frames had been drawn to the UI canvas, so "ready" is not "painted".
- Unrelated to js-dos: the default headless viewport is about 756x488, smaller than a 640x400 player plus sidebar margin; set the window size.

## Not observed / for Task 23 CI to confirm

The 3-OS CI matrix (.github/workflows/ci.yml) now runs this; what is left to confirm from its runs is in [docs/evals/tier1.md](../evals/tier1.md) (spike e).

macOS and Linux are **unverified**. CI must confirm on each OS: (1) the same bundle runs with `dosboxDirect` and `Dos({url})` and `onFrame` yields changing frames; (2) COOP/COEP is not needed; (3) the `dosbox` and `dosboxX` backends both reach ready within the budget; (4) whether the UI canvas paints in headless Chrome/Chromium there (if it paints there, the Windows black canvas is a local artefact; if not, keep `ci` sampling); (5) the `initFs` `Entry[]` form if Task 18 wants it. Also not tested: audio RMS capture, keyboard input through CDP `Input.dispatchKeyEvent` into the UI canvas (only `ci.simulateKeyPress` was verified), the `jspi` backend, `Dos()` default backend when `backend` is omitted, saving/persisting (`save`, `.changes`), and bundles larger than a few hundred bytes.
