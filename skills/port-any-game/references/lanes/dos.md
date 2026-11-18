# Lane: dos-jsdos (DOS games)

## When to use
The survey picked `dos-jsdos`: the main program is a DOS executable (MZ, or LE/LX with a DOS extender), or it found
DOS content such as a DOSBox wrapper. The game runs in js-dos (DOSBox compiled for the browser). Odds 85–95%;
usually minutes.

## Inputs
- `<port>` from `pag new`, with `ACK_PRIVATE_USE_ONLY` and `ACK_RUNTIME_LICENSE` recorded.
- The js-dos runtime (GPL-2.0, about 20 MB from npm), installed once per computer.
- Data mode `byo`: the build holds no game files. On first start the page asks the user to choose their game folder,
  copies it into the browser's storage and packs it for DOSBox there. Nothing is uploaded.
- Never an operating system image. Only FreeDOS or the MIT-licensed MS-DOS sources would be allowed, and this lane
  needs neither.

## Steps
1. `node <skill-dir>/scripts/pag.mjs setup jsdos` prints the download and its size. After the user agrees:
   `node <skill-dir>/scripts/pag.mjs setup jsdos --yes`.
2. `node <skill-dir>/scripts/pag.mjs build "<port>"` picks the program to start: the largest DOS executable the
   survey found that is not an installer, else the largest `.COM` file. It records it in `<port>/build/lane.json` as
   `{"exe": "<DOS path>"}`, already in DOSBox's 8.3 form (for example `GAME/LONGNA~1.EXE`).
3. `node <skill-dir>/scripts/pag.mjs pack "<port>"`, then
   `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 5`. Verify imports the files from `<port>/game`
   itself.
4. Fix (table below) and repeat. Gate with `--soak 120`, then hand over (SKILL.md steps 7–8).

## Known failures and fixes

| What you see | Cause | Fix |
|---|---|---|
| survey or `pag new`: no lane applies, but the folder is a DOS game | the folder has only `.COM` programs, which have no header for the survey to recognise (M1 limit) | If the user confirms it is a DOS game: `node <skill-dir>/scripts/pag.mjs new "<game>" "<port>" --lane dos-jsdos`. Build then starts the largest `.COM`. |
| build: "the js-dos runtime is not installed; run: pag setup jsdos --yes" | runtime missing | Do step 1: show the size and ask first. Never run the `--yes` line from the message directly. |
| build: "no DOS executable" | no MZ/LE/LX program and no `.COM` | Check `<game>` is the installed game, not a disc image. Ask the user to install or copy the disc's files first. |
| DOS prints "Illegal command" or "Bad command or file name" | DOSBox shows long names as 8.3 names. Build assumes `~1`; when two long names share their first six letters, the real one may be `~2` | Set `exe` in `<port>/build/lane.json` to the right 8.3 name (for example `LONGNA~2.EXE`), then pack again. |
| the wrong program starts (setup tool, small loader), or the game needs a `.BAT` to start | build picks the largest program | Set `exe` in `<port>/build/lane.json` to the right file (for example `GAME.BAT` or `PLAY.EXE`), then pack again. A new `pag build` resets it. |
| Ctrl or Alt "do strange things" in the browser | Ctrl and Alt reach the game (fire, strafe), but browser shortcuts still work too: Ctrl+W closes the tab, Ctrl+R reloads | Tell the user. If the game uses Ctrl or Alt with letter keys, suggest changing those keys in the game's own setup. |
| the mouse does nothing (or a gamepad does nothing) | the M1 DOS lane passes only keyboard input to DOSBox | Tell the user: DOS builds are keyboard only for now. Games that need a mouse cannot be played this way yet. |
| the game runs too fast or too slow | DOSBox speed is fixed to `cycles=auto` in M1 | Report it; M1 cannot tune the speed. |
| verify `frozen` fails on a still title screen | the game waits for a key; this lane declares no verify keys in M1 | Look at the screenshot. If the title is drawn correctly, say so and rely on the user's 2-minute check. |

## Licence
js-dos is GPL-2.0. The build carries `dist/LICENSES/js-dos.txt` with the full GPL-2.0 text and a link to the source.
For private play this needs nothing. If the user ever gives the build (without game files) to someone, the
`LICENSES/` folder must go with it (`ACK_RUNTIME_LICENSE`). Never copy js-dos code into this repository or into
`<port>/lane/`.

## Verify notes
Target 30 frames per second; ready budget 30 s. BYO privacy rules apply: no request with a body, no cross-origin
request.
