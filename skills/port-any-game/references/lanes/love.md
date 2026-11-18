# Lane: rebuild-love (LÖVE games)

## When to use
The survey picked `rebuild-love`: the folder has a `.love` file or `love.dll`, so it is a LÖVE (Love2D) game. It runs
in love.js, LÖVE 11.4 built for the browser. Odds 60–80%; usually minutes. The real verdict comes from `pag build`,
which reads the game's LÖVE version.

## Inputs
- `<port>` from `pag new`, with `ACK_PRIVATE_USE_ONLY` and `ACK_RUNTIME_LICENSE` recorded.
- love.js 11.4.1 (MIT, about 6.5 MB from npm), installed once per computer. Only its two runtime files (about 5 MB) go
  into the build.
- Data mode `byo`: the build holds no game files. On first start the page asks the user to choose the game folder and
  copies it into the browser's storage. Nothing is uploaded.

## Steps
1. `node <skill-dir>/scripts/pag.mjs setup love` prints the download and its size. After the user agrees:
   `node <skill-dir>/scripts/pag.mjs setup love --yes`.
2. `node <skill-dir>/scripts/pag.mjs build "<port>"` finds the game (Containers below), reads `conf.lua` and writes
   `<port>/build/lane.json`: `file` (the game file inside `game/`), `offset` (where its zip starts) and `version`
   (from `conf.lua`, or `null`). It prints the verdict and why, and adds both to `PORTING_LOG.md`.
3. `node <skill-dir>/scripts/pag.mjs pack "<port>"`, then
   `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 5`. Verify imports the files from `<port>/game`
   itself.
4. Fix (table below) and repeat. Gate with `--soak 120`, then hand over (SKILL.md steps 7–8).

## Containers
A LÖVE game is a zip with `main.lua` at its root. Build looks, in this order, for:
1. **A `.love` file** (the shallowest one outside any `.app`): offset 0.
2. **A fused exe:** `game.exe` is LÖVE with the game zip appended (`copy /b love.exe+game.love`). Build takes the
   exe the survey found with a zip overlay (`survey.json`, the main exe first) and records where the zip starts, so
   only the game zip reaches love.js. An exe whose zip offsets were rewritten to absolute ones (`zip -A`) is passed
   whole (offset 0); love.js still finds the zip.
3. **A macOS app:** `<Name>.app/Contents/Resources/*.love`.

Build fails with "main.lua is not at the root of the game zip" when the zip has an extra folder around the game (the
classic zipped-folder mistake): the game is broken as shipped, so tell the user. "not a LÖVE game: no zip found"
means the file is not a LÖVE game.

## Version rule
`conf.lua` sets `t.version = "x.y"`, the LÖVE version the game was made for. love.js runs 11.4.

| `t.version` | Verdict | What happens |
|---|---|---|
| 11.0 to 11.4 | GO | runs as made |
| 11.5 | GO | runs; a few 11.5-only functions may be missing |
| 0.x or 10.x | HARD | runs on 11.4 with a compatibility warning; old games often draw wrong (they use 0–255 colours) or call removed functions |
| 12.x | NO | love.js has no LÖVE 12 |
| missing or unknown | HARD | LÖVE assumes the current version and warns |

Any version is NO when the game zip carries native code (`.dll`, `.so`, `.dylib`) or the Lua calls `require("ffi")`
or `package.loadlib`: the browser cannot load native code, and love.js has no LuaJIT.

## Known failures and fixes

| What you see | Cause | Fix |
|---|---|---|
| build: "the love.js runtime is not installed; run: pag setup love --yes" | runtime missing | Do step 1: show the size and ask first. Never run the `--yes` line from the message directly. |
| build: "no LÖVE game found in game/ ..." | no `.love`, no exe with a zip appended (the survey found none) and no `.app` | Ask where the game's `.love` is; if it is somewhere else, `pag new` on that folder. |
| build: "main.lua is not at the root of the game zip" | the zip wraps the game in a folder | The game cannot run as shipped; tell the user. |
| build verdict HARD (0.x/10.x) | an older LÖVE game | Try it: verify shows whether it draws. Wrong colours or "attempt to call a nil value" errors mean it needs an older LÖVE, which this lane does not have. |
| build verdict NO | LÖVE 12, or native code | Tell the user; this lane cannot fix it. |
| verify `shell` error "the game stopped with a Lua error: ..." | the game hit a Lua error (love's blue error screen) | Read the message and `verify/console.log` (`[love]` lines). A missing function usually means a version mismatch. |
| verify `shell` error "the game failed to start: ..." | love.js stopped before the game window opened | The message is love's last line, often a missing file. |

## Known gaps
- LÖVE 11.4 only: no 11.5 additions, no 12.0. The upgrade path is 2dengine's love.js (LÖVE 11.5), which needs
  cross-origin isolation and was not tested.
- No LuaJIT: no `ffi`, slower Lua. No native Lua modules.
- The compat build runs `love.thread` without real threads, and its audio is rough (untested here).
- Shaders must follow strict GLSL ES typing; desktop-only shader code fails to compile.
- The game is shown at its own window size, shrunk to fit the page but never enlarged.
- Tested in Chromium browsers (Chrome, Edge); Firefox and Safari not yet.

## Licence
love.js is MIT (LÖVE itself is zlib). The build carries `dist/LICENSES/love.js.txt`. For private play this needs
nothing. If the user ever gives the build (without game files) to someone, the `LICENSES/` folder must go with it
(`ACK_RUNTIME_LICENSE`). Never copy love.js code into this repository or into `<port>/lane/`.

## Verify notes
Target 30 frames per second; ready budget 30 s; verify clicks the game and presses Enter and Space. LÖVE's
version-mismatch message box would block the game, so the page shows it as a console warning instead. BYO privacy
rules apply: no request with a body, no cross-origin request.

## Saves
LÖVE saves (`love.filesystem`) live in the browser's storage for the build's address, in the game's `t.identity`
folder. love.js writes them to storage only when the page closes; the build also writes them every 30 seconds, when
the tab is hidden and when verify asks (`save` says "lane saveNow ran"). A browser that is killed rather than closed
can lose the last 30 seconds of saves. Clearing the site's data deletes the saves.
"lane saveNow ran" means the write to storage has started: saveNow returns without waiting, and write errors are
not reported.
