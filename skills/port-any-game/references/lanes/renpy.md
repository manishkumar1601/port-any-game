# Lane: rebuild-renpy (Ren'Py games)

## When to use
The survey picked `rebuild-renpy`: the folder has `game/` with `.rpy`, `.rpyc` or `.rpa` files (and usually
`renpy/`), so it is a Ren'Py visual novel. The pinned Ren'Py 8.6.1 SDK rebuilds the game for the browser with its own
"Web" build, without decompiling anything. Odds 65–85%; usually minutes.

## Inputs
- `<port>` from `pag new`, with `ACK_PRIVATE_USE_ONLY` and `ACK_RUNTIME_LICENSE` recorded.
- The Ren'Py 8.6.1 SDK plus its web support files, installed once per computer: about 180 MB download, about 400 MB on
  disk. The build output carries Ren'Py's own web runtime (about 40 MB); nothing from the SDK folder goes in otherwise.
- Data mode `bundled`: `<port>/dist` holds the rebuilt game (`game/game.zip` contains the game's files). Private:
  never share it publicly. The port's git hooks keep it out of commits.

## Steps
1. `node <skill-dir>/scripts/pag.mjs setup renpy` prints the download and its size. After the user agrees:
   `node <skill-dir>/scripts/pag.mjs setup renpy --yes`. Run it in the background if you can.
2. `node <skill-dir>/scripts/pag.mjs build "<port>"`
   - Copies only the game's `game/` folder into `<port>/build/renpy-project/` (the SDK writes into the project it
     builds, so the install is never touched).
   - Runs the SDK's `web_build` on it, with no window (about 10 s for a small game; it stops after 10 minutes).
   - Removes the offline-app extras (service worker, manifest, icons, debug map), adds the frame counter
     (`__pag_hook.js`) and moves the result to `<port>/build/game/`.
   - Writes `<port>/build/lane.json` (`game_version`, `sdk_version`) and prints the verdict and why. A save warning,
     if any, is printed as `warning` and added to `PORTING_LOG.md` with the verdict.
3. `node <skill-dir>/scripts/pag.mjs pack "<port>"`, then
   `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 5`.
4. Fix (table below) and repeat. Gate with `--soak 120`, then hand over (SKILL.md steps 7–8).

Every `pag build` deletes and recreates `<port>/build/game/`, so never hand-edit files there.

**The build runs the game's startup code once, as launching the game would.** Ren'Py's web build starts the game
headless on this computer to read its settings (the init Python blocks run). That is the same trust as playing the
game the user owns, and the survey's STOP rules still apply before any build. Tell the user before the first build.

## Version rule
The survey reads the game's Ren'Py version from `renpy/vc_version.py`. When that is missing, `pag build` reads
`game/script_version.txt` (`(8, 1, 3)`). The pinned SDK is 8.6.1.

| Ren'Py version | Verdict | What happens |
|---|---|---|
| 8.0 to 8.6.1 | GO | rebuilt with the 8.6.1 engine; compiled scripts load across these versions |
| newer than 8.6.1 | HARD | "needs Ren'Py x or newer": the game may use features the pinned SDK lacks |
| 7.x | HARD | "needs the Ren'Py 7 SDK, not pinned yet": its Python 2 code is unlikely to run on the 8.x SDK |
| 6.x or older | HARD | no SDK for it is pinned |
| unknown | HARD | neither file names a version; the build still tries |

The build runs for every verdict; HARD means "try it, verify decides". The web build always uses the SDK's own engine,
so a game that ships a patched `renpy/` folder loses those patches.

## Known failures and fixes

| What you see | Cause | Fix |
|---|---|---|
| build: "the Ren'Py SDK is not installed; run: pag setup renpy --yes" | SDK missing | Do step 1: show the size and ask first. Never run the `--yes` line from the message directly. |
| build: "Ren'Py web support is not available in the installed SDK; delete ... and run: pag setup renpy --yes" | the SDK folder's `web/` files are missing or do not match the SDK | Ask the user, then delete that folder and do step 1 again. |
| build: "no Ren'Py game/ folder in the install" | `pag new` was pointed at a parent folder | `pag new` again on the folder that holds `game/` and `renpy/`. |
| build: "Ren'Py web build failed (exit N): ..." | the SDK stopped; the message ends with its last 20 output lines | Read them. `<port>/build/renpy-project/` stays after a failure: its `log.txt` and `traceback.txt` show the game's own errors (often Python modules that Python 3.12 removed, or Python 2 code from a Ren'Py 7 game). Report it; this lane cannot patch game code. |
| build `warning`: "no config.save_directory ..." or "only compiled scripts ..." | the game may not name a save folder | Run verify, then check one in-game save survives a reload (Saves below). Without `config.save_directory` saves stay in memory. |
| verify `ready` warns, or the title takes long | a big game: everything inside `.rpa` archives downloads before the title screen | Normal for large games. Raise `verify.budget_ready_s` for this port only if the user accepts the wait. |
| verify `errors` names threads, sockets or movies | the web build has no threads, no networking, and only basic movie support | Report it; those features do not exist in browsers. |
| verify `fps` warns | Ren'Py draws about 10 frames per second when nothing moves; the target is 5 | Only a real problem below 5. See [verify](../verify.md). |

## Known gaps
- Ren'Py 7.x and older need another SDK, which is not pinned yet.
- No threads, networking, native Python modules (`.pyd`/`.so` in `game/`), Live2D, or Steam features on the web.
- Large games download everything inside their `.rpa` archives before the title screen, and need memory to match.
- Built and tested on Windows so far; macOS and Linux builds are checked in CI.
- Tested in Chromium browsers (Chrome, Edge); Firefox and Safari not yet.

## Licence
Ren'Py is mostly MIT; parts linked into the web runtime are LGPL-2.1 (FFmpeg, Fribidi, parts of pygame_sdl2), with
others under PSF, zlib, libpng, FreeType, Apache-2.0 and MPL-2.0. The build carries `dist/LICENSES/renpy.txt` (the
SDK's full `LICENSE.txt`). For private play this needs nothing. If the user ever gives the build to someone (never with
game files), the `LICENSES/` folder must go with it (`ACK_RUNTIME_LICENSE`). Never copy Ren'Py code into this
repository or into `<port>/lane/`.

## Verify notes
Target 5 frames per second; ready budget 30 s. Verify presses ArrowDown and Enter (most main menus focus Start, then
start), then clicks and presses Enter to advance dialogue. A main menu that never moves shows "static until input" as
a warning. Ren'Py's page needs inline scripts and `eval`, so the build's security policy allows both for this lane
(verify lists it as `info: csp`). Avoid Escape in manual checks: it opens the game menu.

## Saves
Ren'Py saves to the browser's storage (IndexedDB) for the build's address, in the game's `config.save_directory`
folder, after each save. Without `config.save_directory` saves stay in memory and are lost on reload (the build warns).
The menu button in the top-left corner of the game page imports and exports saves as a zip, which also works with
desktop saves. Clearing the site's data deletes the saves.
