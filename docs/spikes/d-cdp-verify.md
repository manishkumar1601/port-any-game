# Spike d: CDP over Node's global WebSocket (verify driver)

Date 2026-11-17. Machine: Windows 11, Node 22.22.3 (global `WebSocket` + `fetch`), zero npm dependencies.
Browsers tested: Edge 157.0.4341.60 and Chrome 157.0.8103.79, both launched with `--headless=new`.
Throwaway scripts (git-ignored): `docs/spikes/scratch/cdp.mjs`, `server.mjs`, `www/cdp.html`.

## Verdict

**CDP tier viable as default: YES on Windows (Edge and Chrome, both observed). macOS and Linux: unverified, to be covered by Task 23 CI** (ruling R12; no GitHub CI was available).

## Launch flags that worked (Windows, Edge and Chrome)

```
--headless=new --remote-debugging-port=0 --user-data-dir=<fresh tmp dir>
--no-first-run --no-default-browser-check
--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows
about:blank
```

Spawn with `spawn(exe, flags, { stdio: 'ignore', windowsHide: true })`, no `shell`. No `--no-sandbox`, `--disable-gpu`, or `--enable-unsafe-swiftshader` was needed on this machine.

## Finding the DevTools port

- `--remote-debugging-port=0` makes the browser pick a free port and write `<user-data-dir>/DevToolsActivePort`: line 1 = port, line 2 = browser WebSocket path (`/devtools/browser/<guid>`).
- Polling for that file every 50 ms worked. The file only counts once line 2 exists. Time to appear: 0.65 to 1.3 s warm, 3.8 to 5.4 s on the first cold launch of each browser. Use a 15 to 30 s timeout.
- `GET http://127.0.0.1:<port>/json/version` also works, and its `webSocketDebuggerUrl` equalled `ws://127.0.0.1:<port><line 2>` in every run. Because port 0 means we cannot know the port without the file, the file is the primary method and `/json/version` is only a cross-check.
- Connect with `new WebSocket('ws://127.0.0.1:<port><path>')` to the **browser** endpoint (no page-level URL needed).

## Session sequence (all observed working)

1. `Target.createTarget {url:'about:blank'}` returns `targetId`.
2. `Target.attachToTarget {targetId, flatten:true}` returns `sessionId`. Flattened mode works: every later command is sent on the same socket with `sessionId` in the envelope and events arrive with `sessionId`.
3. On the session: `Page.enable`, `Runtime.enable`, `Log.enable`, `Page.addScriptToEvaluateOnNewDocument`, then `Page.navigate`.
4. `Page.captureScreenshot {format:'png'}` (x3), `Runtime.evaluate` for state.
5. `Browser.close`, then kill the process tree (see gotchas).

## Console capture

`Runtime.enable` then listen for `Runtime.consoleAPICalled` events (`params.type`, `params.args[].value`). Observed: `log` and `error` types from the main page, and a `console.log` from a same-origin iframe, all arrived on the one session. `Log.enable` + `Log.entryAdded` additionally surfaced browser-level entries (a 404 for favicon). `Runtime.exceptionThrown` is the channel for uncaught errors.

## Screenshots of 2D and WebGL canvases in `--headless=new`

Test page: an animated 2D canvas (hsl colour per rAF frame) and a WebGL canvas (`clearColor` changing per frame), plus a same-origin iframe. Three screenshots, 500 ms apart, PNG decoded in Node (inflate + unfilter), luma stats per canvas region:

| Browser | Shot | 2D region mean/std (dark ratio) | WebGL region mean/std (dark ratio) | Mean abs diff vs previous shot |
|---|---|---|---|---|
| Edge | 0 | 54 / 41 (0.0) | 121.5 / 33.6 (0.0) | n/a |
| Edge | 1 | 71.3 / 37.5 (0.0) | 130.4 / 31.3 (0.0) | 3.99 |
| Edge | 2 | 49.5 / 41.9 (0.0) | 134.3 / 30.3 (0.0) | 3.00 |
| Chrome | 0 | 197.1 / 11.8 (0.0) | 142.7 / 28.1 (0.0) | n/a |
| Chrome | 1 | 120.6 / 27.4 (0.0) | 140.5 / 28.7 (0.0) | 11.32 |
| Chrome | 2 | 45.2 / 42.8 (0.0) | 140.5 / 28.7 (0.0) (identical to shot 1: WebGL animation not demonstrated in Chrome) | 9.18 |

Both canvases are non-black in both browsers, and the 2D canvas changes between shots. The WebGL region varied across shots in Edge and was identical for shots 1 and 2 in Chrome, which is plausible at that sampling interval (the clear colour cycles over 60 frames) but means "WebGL animates" is only strongly shown for Edge. A page `window.__frames` counter advanced roughly 80 to 130 frames between shots (about 0.6 s apart including capture time) with the throttling flags set, so rAF was not throttled. Screenshot size was 756x488 (Edge) / 764x485 (Chrome) because the default headless window is about 800x600. Pass `--window-size=W,H` or `Emulation.setDeviceMetricsOverride` when the verify needs a fixed viewport.

The js-dos spike (note e) is a second data point: with the same launch flags the js-dos page (WebGL-or-2D canvas inside a UI) captured as pure black, so a non-black result for the simple canvases above does not prove every WebGL page paints in headless. That is a js-dos-specific problem, described in `e-jsdos-bundle.md`.

## `Page.addScriptToEvaluateOnNewDocument` and iframes

Registered `window.__inj = 42` before navigation. Both the main frame and a same-origin `<iframe src="frame.html">` read `42` (the iframe logged it from its own script at load, so it ran before page scripts; also read back via `contentWindow.__inj`). Verified in Edge and Chrome. Cross-origin iframes were not tested. Warning for Task 14: cross-origin / out-of-process (OOPIF) iframes may need `Target.setAutoAttach {autoAttach:true, flatten:true, waitForDebuggerOnStart}` handling to reach their sessions (untested). Note the script also applies to all later navigations in the session; no `runImmediately` flag was needed.

## Gotchas

- **Process cleanup on Windows (important).** `Browser.close` is accepted but exit is not guaranteed in time: in the three CDP-test runs (Edge x2, Chrome x1) the spawned process was still alive 8 s after it; in some later js-dos runs it exited after 1.4 to 2.1 s. So always do: send `Browser.close`, close the socket, wait up to ~2 s for exit, then `taskkill /PID <pid> /T /F` (`/T` kills the renderer/GPU children). After that, a scan for processes whose command line contains our user-data-dir found none left.
- **Deleting the user-data-dir right after kill fails with `EBUSY`** (files still locked by dying children). Retry `fs.rmSync` in a loop (20 x 250 ms) after the kill; it succeeded each time. Never delete before the process is dead.
- A freshly created user-data-dir is required each run (otherwise a running instance can hijack the launch and `DevToolsActivePort` is stale).
- The first cold launch of each browser took 4 to 5 s to publish the port file; warm launches about 1 s. Budget for it in the ready-time thresholds.
- A page `<script>` that declares top-level `const q` collides with globals in some third-party scripts (hit while building the js-dos test page); unrelated to CDP but wrap test scripts in an IIFE.

## Minimal working sketch

```js
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'pag-cdp-'));
const child = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'],
  { stdio: 'ignore', windowsHide: true });
let port, wsPath;
for (const t0 = Date.now(); Date.now() - t0 < 30000 && !wsPath; await sleep(50)) {
  try { const l = fs.readFileSync(path.join(udd, 'DevToolsActivePort'), 'utf8').split('\n'); if (l[1]) { port = l[0]; wsPath = l[1]; } } catch {}
}
const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const consoleMsgs = [];
ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled') consoleMsgs.push(m.params); };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { pending.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
await S('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__pag = {};' });
await S('Page.navigate', { url });
// ... wait for ready, Page.captureScreenshot { format: 'png' } -> base64 PNG, Runtime.evaluate ...
try { await send('Browser.close'); } catch {} ws.close(); await sleep(2000);
spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);       // win32; use process.kill(-pid)/child.kill() elsewhere
for (let i = 0; i < 20; i++) { try { fs.rmSync(udd, { recursive: true, force: true }); break; } catch { await sleep(250); } }
```

## Not observed / for Task 23 CI to confirm

macOS and Linux are **unverified**. CI (`macos-latest`, `ubuntu-latest`, plus `windows-latest` again) must confirm each of:

1. The launch flag set above starts a headless browser and writes `DevToolsActivePort` with a non-empty line 2 (Linux runners may need `--no-sandbox`; record whether it was required and whether Chrome or Chromium is the installed binary).
2. `Target.createTarget` + `attachToTarget {flatten:true}` works.
3. `Page.captureScreenshot` of an animated 2D canvas and a WebGL canvas is non-black on each OS (Linux headless without a GPU relies on SwiftShader; the WebGL case is the one most likely to differ).
4. `Page.addScriptToEvaluateOnNewDocument` reaches a same-origin iframe.
5. Process cleanup: `Browser.close` behaviour and the POSIX kill path (kill the process group, since `taskkill /T` does not exist there); user-data-dir removal succeeds.
6. Port-file latency on cold runners.

Also not tested here: pre-installed browsers other than Edge/Chrome, `--headless=old`, headful mode, cross-origin iframes, and the Playwright fallback (not needed since the verdict is yes). Fallback if CI says no on any OS: per the task, Task 14 makes the Playwright runner the default and the CDP driver experimental.
