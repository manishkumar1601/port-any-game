# Verify: how a build is judged

`pag verify [dist]` serves a packed build, drives a real Chromium-family browser through it, measures what happens,
and writes a report. It is the quality gate between `pag pack` and "this works". The agent-facing short form (what to
run, how to read results, known failures) is
[references/verify.md](../skills/port-any-game/references/verify.md); this document describes the machinery and every
threshold. For the page being tested see [runtime.md](runtime.md).

```
pag verify [dist] [--runner auto|cdp|playwright] [--soak SECONDS] [--headed]
           [--browser chromium|firefox|webkit|all] [--fixture DIR] [--query K=V&...] [--json]
```

`--soak` defaults to 60 and accepts 0 to 3600. `--query` is appended to the page URL. `--fixture` replaces the folder a
BYO build imports from (default: the port's `manifest.source` folder, `game/` or `build/game/`).

## Architecture

All code is in [scripts/verify/](../skills/port-any-game/scripts/verify/).

| File | Role |
|---|---|
| [verify.mjs](../skills/port-any-game/scripts/verify/verify.mjs) | Entry point and orchestration. CLI parsing, runner choice, the run sequence, report writing, exit code. Page-side helper functions (`PAGE.*`) live here as source text sent through `Driver.evaluate`. |
| [static.mjs](../skills/port-any-game/scripts/verify/static.mjs) | No-browser checks on `dist/` (`staticChecks`) and the server probe (`probe`). |
| [checks.mjs](../skills/port-any-game/scripts/verify/checks.mjs) | `THRESHOLDS`, the pure maths (`frameStats`, `meanAbsDiff`, `longestStall`, `heapGrowth`, `isCrossOrigin`) and `judge()`, which turns measurements into checks. |
| [browser.mjs](../skills/port-any-game/scripts/verify/browser.mjs) | Finds the browser, builds Chromium flags, launches it with a throwaway profile, locates the cached Playwright. |
| [cdp.mjs](../skills/port-any-game/scripts/verify/cdp.mjs) | Minimal DevTools Protocol client over Node's global `WebSocket`. |
| [driver-cdp.mjs](../skills/port-any-game/scripts/verify/driver-cdp.mjs) | Default driver, built on `cdp.mjs`. |
| [driver-playwright.mjs](../skills/port-any-game/scripts/verify/driver-playwright.mjs) | Fallback driver with the same interface. |
| [instrument.js](../skills/port-any-game/scripts/verify/instrument.js) | Script injected into every frame before page scripts. Exposes `window.__pagVerify`. |

Both drivers implement one interface: `open(url)`, `evaluate(fnSource, arg?)`, `screenshot(file)`, `click(x, y)`,
`key(code)`, `setViewport(w, h)`, `reload()`, `onConsole`, `onRequest`, `onResponse`, `onPopup`, `close()`. Everything
in `verify.mjs` talks to that interface only, so the two tiers produce the same report.

`runBrowser()` does the work for one browser. `verify()` wraps it: static checks, server start, the browser run(s),
then merging and writing results.

### Tier 1: CDP over Node's WebSocket (default)

The driver launches the player's own Chrome or Edge and speaks the Chrome DevTools Protocol directly. Nothing is
installed. It needs Node 22+ (global `WebSocket`) and a Chromium-family browser.

- One browser-level connection with flattened sessions. Every command has a timeout (30 s; 10 s to connect; 10 s for a
  screenshot, which first calls `Page.bringToFront` because a page that had not painted for a while made headless Edge
  hang).
- The instrument is registered with `Page.addScriptToEvaluateOnNewDocument`, so it runs in every frame.
- Workers are auto-attached (`waitForDebuggerOnStart`), so requests made by the BYO import Worker are seen.
- Input is trusted: `Input.dispatchMouseEvent` (move, press, release) and `Input.dispatchKeyEvent`. A key is held
  100 ms so games that poll key state see it. `keyInfo()` maps a `KeyboardEvent.code` to `key`, legacy `keyCode` and
  text, because games read any of the three.
- Popups (`window.open`, `target=_blank`) are reported, not followed; their own requests are not recorded.
- Page load timeout is 30 s.

### Tier 2: Playwright fallback (`--runner`)

`--runner auto` (default) tries CDP first, then Playwright, then reports an unsupported environment.
`--runner cdp` or `--runner playwright` forces one. Playwright is the only route to `firefox` and `webkit`
(`--browser`); `--browser all` runs all three in turn and prefixes check names and screenshots with the browser name.

Playwright is never imported from `node_modules`. `pag setup playwright --yes`
([setup.mjs](../skills/port-any-game/scripts/setup.mjs)) runs `npm i playwright@<pinned version>` into
`<cacheDir>/tools/playwright-<version>/` (version pinned in
[toolchain.lock.json](../skills/port-any-game/scripts/toolchain.lock.json)) and then
`playwright install chromium` with `PLAYWRIGHT_BROWSERS_PATH` set to `<cacheDir>/ms-playwright` (unless already set).
`<cacheDir>` is `PAG_CACHE` or `~/.port-any-game`. `playwrightEntry()` accepts it only when the tool folder has its
`.ok` marker. Because setup installs only Chromium, a Firefox or WebKit run fails to launch and is reported as an
unsupported environment. The Playwright driver evaluates a string expression rather than a function, because the
shell's CSP has no `unsafe-eval`; it ignores requests the page cancelled itself.

## Browser discovery

`findBrowser()` takes the first entry of `findBrowsers()` ([doctor.mjs](../skills/port-any-game/scripts/doctor.mjs)),
which lists, in order, only paths that exist:

1. `PAG_BROWSER` (pin: if it is set and the file does not exist there is no browser at all, with no silent fallback;
   tests use this to force "no browser").
2. `CHROME_PATH`.
3. Per OS:

| OS | Candidates, in order |
|---|---|
| Windows | `msedge.exe` under `%ProgramFiles%` and `%ProgramFiles(x86)%` (`Microsoft\Edge\Application`), then `chrome.exe` under both (`Google\Chrome\Application`), then `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` |
| macOS | `/Applications/{Google Chrome,Microsoft Edge,Chromium}.app/Contents/MacOS/<name>` |
| Linux | on `PATH`: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge`, `microsoft-edge-stable` |

`pag doctor` shows the same list. The runner is CDP only when `--browser chromium`, `WebSocket` exists and a browser was
found.

### Launch and flags

`launchBrowser()` starts the browser with a fresh profile in the OS temp folder (`pag-verify-*`),
`--remote-debugging-port=0` (the port and path are read back from `DevToolsActivePort`), and:

- `--headless=new` unless `--headed`; `--no-first-run`; `--no-default-browser-check`;
- `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`,
  `--disable-backgrounding-occluded-windows` (an unfocused headless page must not be throttled);
- from `chromeFlags()`: `--enable-precise-memory-info` (exact heap numbers for the soak),
  `--use-mock-keychain`, `--password-store=basic` (no OS keychain prompt on a throwaway profile);
- Linux only: `--use-angle=swiftshader` and `--enable-unsafe-swiftshader` (CI has no GPU, so WebGL runs in software),
  plus `--no-sandbox` when running as root, since Chromium refuses to start sandboxed as root;
- anything in `PAG_CHROME_FLAGS`, split on spaces.

Playwright's Chromium gets `chromeFlags()` as well. Closing kills the whole process tree (Windows `taskkill /T /F`,
POSIX process group) and removes the profile, retrying while dying children hold files. The same cleanup runs on
process exit, SIGINT (exit 130) and SIGTERM (exit 143).

## The run sequence

Step numbers follow the spec's section 9. Static work first, then one browser session.

1. **Static checks**: [static.mjs](../skills/port-any-game/scripts/verify/static.mjs), see below.
2. **Server**: `startServer` on an ephemeral port, serving `dist/` with `caseFallback` from `shell.json`. For BYO
   builds it also serves the fixture folder at `/__fixture/` and its file list at `/__fixture.index.json`, so verify
   never writes into the game folder. The `probe` check runs against it.
3. **Open**: viewport 1280x800, URL `/?verify=1`, plus `&verify_import=/__fixture/` for BYO, plus `--query`.
4. **Wait for `ready`**: polls `__shell.state` until `ready`, a dead end (`error`, `needs-files`) or timeout (120 s).
   A BYO build imports the fixture through the real OPFS pipeline here. An error beginning `Unsupported environment`
   ends the run as *unsupported*, not failed. Screenshot `ready`. If `needs_coi`, the page must be cross-origin
   isolated or an `isolation` check fails.
5. **Play**: a trusted click on the Play button (the shell creates its `AudioContext` inside that click). Wait up to
   60 s for `running`.
6. **First frame**: wait up to 10 s for `stats.gameFrames > 0` (R46). Sampling starts at the lane's first game frame,
   because `start()` can resolve before anything is painted. Screenshot `play`.
7. **Sample window**: 21 samples 0.5 s apart (10 s). Each takes the shell state, game-frame count, input count, a
   64x48 RGBA copy of the largest visible canvas and the audio RMS. These feed `blank`, `frozen`, `fps`, `audio` and
   the first `loop` window.
8. **Input**: for each entry of `verify.inputs`, press that `KeyboardEvent.code`, or for `Click` a trusted click at
   the centre of the stage; then press and release the fake gamepad (button 0, left stick). Poll up to 3 s for input
   events to be counted and the picture to change by 0.5/255 or more. Screenshot `input`. Skipped when the lane
   declares no inputs.
9. **Viewports**: 1280x800 and 390x844; each must not overflow horizontally. Screenshots `desktop`, `mobile`.
10. **Save and reload**: run the storage self-test, call the adapter's `saveNow()` if it has one, write a random token
    to `localStorage`, reload, wait up to 30 s for `ready` (this is also the cached ready time), and read the token
    back.
11. **Soak** (only when `--soak` > 0): Play again, wait for the first frame, then sample the game-frame counter and JS
    heap about once a second for the soak duration. Screenshot `soak`.
12. **Stages**: for each name in `verify.stages` (optional), reopen with `&verify_stage=<name>`, Play, wait a second
    and require a running, non-blank picture. Screenshot `stage-<name>`.
13. **Close and judge**: collect own-origin responses, and for BYO the request bodies, cross-origin requests and
    popups, then `judge()`.

Any step that throws becomes a `run` check with status `fail`. If the shell never reaches `running`, later steps are
skipped and the `shell` check carries the reason.

## Checks

Statuses: `pass`, `warn`, `fail`, plus `info` and `skip` (never affect the result) and `unsupported`. The overall
status is `fail` if any check fails, else `warn` if any warns, else `pass`; if nothing failed but a browser run was
unsupported, it is `unsupported`. All thresholds are in `THRESHOLDS` in
[checks.mjs](../skills/port-any-game/scripts/verify/checks.mjs).

### Static and server checks (no browser)

| Check | Rule |
|---|---|
| `schema` | fail if `shell.json` lacks `schema: 1`, `game_id`, `lane`, `entry.adapter` (and that file must exist), `data.mode`, `data.manifest` or `verify.target_fps`. |
| `public` | only for `bundled-public`: fail unless `port.json` has an `ACK_RIGHTS_HOLDER` acknowledgement or catalog-redistributable data. |
| `manifest` | BYO: fail if `dist/game/` carries any file. Otherwise every manifest file must exist in `dist/game/` with the recorded size and SHA-256. |
| `host limits` | not for private `bundled` builds. Warn if any file is over 25 MiB (some static hosts refuse them). |
| `headers` | fail if `_headers` is missing, contains `credentialless`, or `needs_coi` is true without COOP `same-origin` and COEP `require-corp`. |
| `csp` | `info` only, when `shell.json` has a `csp` field: lists the directive additions. Never changes the exit code (R61). |
| `licenses` | fail if `LICENSES/` is empty. |
| `fixture` | BYO only: fail if the folder to import from is missing. |
| `serve` | fail if the live server does not send COOP/COEP when `needs_coi`, sends COEP `credentialless`, lacks `X-Robots-Tag`, does not answer `Range: bytes=0-15` with 206 and 16 bytes, or a second password-protected server does not return 401 without and 200 with credentials. |
| `environment` | `unsupported`: no usable browser or runner, the browser would not start, or the page reported `Unsupported environment`. The detail says why. |

### Browser checks

| Check | Measured | pass / warn / fail |
|---|---|---|
| `isolation` | `crossOriginIsolated` after load | fail only: `needs_coi` set but the page is not isolated |
| `ready` | first-load time, reload time, first game frame after Play | fail: not ready within 120 s (first) or 30 s (reload). warn: reload time or first-game-frame time exceeds `verify.budget_ready_s` (default 15; Ruffle, DOS and web-extract set 30). First-load time is reported, not compared to the budget. A "no game frame within 10 s of Play" note is left to the frame checks to judge. |
| `shell` | final `__shell.state` | fail: `error`, `needs-files`, no state, or stuck in a non-final state past the timeout. Otherwise pass. |
| `blank` | the 21 samples: a sample is blank when 98% or more of its pixels have luma below 8/255, or its luma standard deviation is below 2 | fail: more than 30% of samples blank. warn: some blank (a fade or loading screen), or no visible canvas to sample. pass: none. |
| `frozen` | largest mean absolute RGB difference between consecutive samples | pass: at least 0.5/255. warn: static until input (the input step moved it by 0.5 or more). fail: never changed. |
| `fps` | game-frame count over the sample window against `verify.target_fps` (default 30) | fail: no frames at all. pass: at least 0.9 x target. warn: at least 0.5 x target, **or any rate below that when the WebGL renderer string matches `swiftshader\|llvmpipe\|softpipe\|software\|basic render`**. fail: otherwise. |
| `input` | input events counted, picture change after the input step | fail: no input event reached the page. warn: events but no change of 0.5/255 within 3 s. pass otherwise. Only runs when `verify.inputs` is non-empty. |
| `audio` | AudioContext count and states, peak RMS across contexts | fail: no `AudioContext` after Play, or none reached `running`. pass: running with peak RMS at least 0.001 (-60 dBFS). Silent but running: warn if `verify.audio_on_title` is true, else pass (a silent title screen is allowed). |
| `save` | storage self-test, lane `saveNow`, token across a reload | fail: self-test failed, the lane's `saveNow` threw, or the token was lost. pass otherwise. The detail adds `lane saveNow ran` for lanes with a save path, or `lane save path not exercised` for lanes without one; both are pass. It also notes when the browser did not grant persistent storage. |
| `viewports` | `scrollWidth` against `innerWidth` at 1280x800 and 390x844 | fail if either overflows horizontally. |
| `loop` | longest time the game-frame counter did not increase, in the 10 s window and in the soak | fail: a stall over 2 s in either (a stall still running at the last sample counts). |
| `memory` | JS heap growth in %/min over the soak. Compares the minimum of the first third of heap samples with the minimum of the last third (post-GC floor); growth under 1 MiB counts as 0 | `skip` when the soak is under 30 s (R37) or the browser gives no heap numbers. pass: under 5%/min. warn: 5 to 10. fail: over 10. |
| `stages` | each `verify.stages` entry reaches `running` with a non-blank frame | fail if any does not. Only present when stages are declared. |
| `errors` | page exceptions and console errors | fail: any uncaught page error, or a console error matching `Aborted(`, `RuntimeError`, `unreachable`, `out of memory`, `device lost`, `CONTEXT_LOST_WEBGL`, `SharedArrayBuffer is not defined`. warn: other console errors. |
| `requests` | own-origin responses | fail: any with status 0 (failed) or 400 and above, so any 404. Cross-origin requests are not listed here. |
| `privacy` | BYO only: request bodies, cross-origin requests, popups | fail: any request with a body, any cross-origin request (including cross-origin `blob:`), any popup. |

Notes:

- `frozen` and `blank` sample only the largest visible canvas. A canvas inside a same-origin iframe or an open shadow
  root (Ruffle draws inside one) is found; a closed shadow root or a cross-origin frame is not.
- `fps` for web-extract games counts frames reported by the injected hook; for Ruffle, rendered frames only (R46).
- The instrument forces `preserveDrawingBuffer` on WebGL contexts so sampling and headless screenshots are not black.

## Reports and exit codes

Output goes to `<port>/verify/` (the nearest `port.json` at or above `dist`; otherwise `<dist>/../verify`). Each run
first deletes only its own previous files (`report.json`, `console.log`, `step-*.png`) and writes:

| File | Content |
|---|---|
| `report.json` | `schema: 1`, `status`, `at`, `summary`, `dist`, `port`, `reportDir`, `lane`, `mode`, `checks` (all, with `name`, `status`, `detail`), `runs` (per browser: `browser`, `runner`, `browserPath`, `measures`, `requests`, `popups`, `unsupported`), `serverLog` |
| `step-<n>-<name>.png` | Screenshots from the sequence above. Multi-browser runs insert the browser name after `step-`. |
| `console.log` | Every console line of the run as `[<level>] text`, with uncaught exceptions at level `pageerror`. |

stdout shows one summary line, then each check that did not pass as `  <status>: <name>: <detail>`, then the report path;
`--json` prints the full report instead.

| Exit | Meaning |
|---|---|
| 0 | `pass` |
| 1 | `fail`. Also bad arguments, "not a packed build" (no `shell.json` or manifest), and an unexpected exception. |
| 2 | `warn` only |
| 3 | `unsupported`: this machine cannot run the check (no usable browser, Node 20 without `WebSocket`, Playwright missing). Not a port failure. |

## Known limits

- **No element-level control inside iframes.** Input is sent at page level: key events go to the focused element and a
  `Click` goes to the centre of the stage. The web-extract adapter focuses its iframe, so keys reach the game, but
  verify cannot target a control inside a frame or move the mouse around, so a game that needs a click elsewhere is
  only partly exercised. Cross-origin frames cannot be sampled at all (the CSP forbids them anyway).
- **Audio in iframes.** Sound made by an iframe game is measured only through the instrument that runs inside that
  same-origin frame and is folded into the top frame's reading. A game that stays silent until a gesture the script
  does not make reads as silent; `audio_on_title: false` (the default) accepts that.
- **GPU-less runners.** Software rendering (SwiftShader, llvmpipe) is far below real frame rates. verify downgrades
  `fps` failures to warnings when it detects it, and a warning that persists on software rendering is the machine's
  limit. CI runs the lane e2e cases with the `lane-test` fixture, and on the GPU-less macOS runner lowers the fixture's
  `verify.target_fps` to 10 through the test-only `PAG_E2E_TARGET_FPS` (R68) so they still gate on everything else.
- **Memory** is judged only on soaks of 30 s or more, and only where the browser exposes the JS heap
  (`performance.memory`, Chromium). The gate uses `--soak 120`.
- **Popups are not followed**, so a game that opens another window hides its requests from `requests` and `privacy`
  (the popup itself fails `privacy` in BYO).
- **Firefox and WebKit** need Playwright and their browsers installed separately; `pag setup playwright` installs only
  Chromium.
- verify checks Chrome or Edge as the supported target. Other browsers usually work but are not checked.

## Related

- [runtime.md](runtime.md): the shell, `shell.json` (`verify` block, `needs_coi`, `csp`) and BYO import that verify
  exercises.
- [lanes.md](lanes.md): per-lane `verify.inputs` and budgets.
- [development.md](development.md): the verify unit tests and the lane e2e run.
