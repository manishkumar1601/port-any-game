# Lane: rt-easyrpg (RPG Maker 2000/2003 games)

## When to use
The survey picked `rt-easyrpg`: the folder has `RPG_RT.ldb` or `RPG_RT.lmt`, so it is an RPG Maker 2000 or 2003
game. It runs in EasyRPG Player, an open re-creation of the RPG Maker 2000/2003 runtime, built for the browser.
Odds 85–95%; usually minutes. RPG Maker XP/VX/Ace and MV/MZ games are other lanes.

## Inputs
- `<port>` from `pag new`, with `ACK_PRIVATE_USE_ONLY` and `ACK_RUNTIME_LICENSE` recorded.
- The EasyRPG Player web build (GPL-3.0-or-later, about 4 MB from easyrpg.org), installed once per computer.
- Data mode `byo`: the build holds no game files. On first start the page asks the user to choose the game folder and
  copies it into the browser's storage. Nothing is uploaded.
- Never the RPG Maker RTP or any RTP replacement in the build or the repository (see RTP below).

## Steps
1. `node <skill-dir>/scripts/pag.mjs setup easyrpg` prints the download and its size. After the user agrees:
   `node <skill-dir>/scripts/pag.mjs setup easyrpg --yes`.
2. `node <skill-dir>/scripts/pag.mjs build "<port>"` finds the folder that holds `RPG_RT.ldb` (the shallowest one),
   reads `RPG_RT.ini` and writes `<port>/build/lane.json`: `root` (that folder inside `game/`, `""` at the top),
   `game` (the player's id for this game, from the port folder's name), `encoding` (only when `RPG_RT.ini` sets one)
   and `rtp`. The verdict is GO, or HARD when the game needs the RTP.
3. `node <skill-dir>/scripts/pag.mjs pack "<port>"`, then
   `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 5`. Verify imports the files from `<port>/game`
   itself.
4. Fix (table below) and repeat. Gate with `--soak 120`, then hand over (SKILL.md steps 7–8).

## RTP
Many RPG Maker 2000/2003 games use the RTP, a shared set of graphics, music and sounds installed with RPG Maker or on
its own. The web player has no RTP. A game exported as a "full package" carries what it uses, and its `RPG_RT.ini`
says `FullPackageFlag=1` under `[RPG_RT]`. Without that line `rtp` is `needs-rtp`, the build verdict is HARD and the
fix goes into `PORTING_LOG.md`. The game still runs, but RTP pictures it lacks show as a checkerboard and RTP sounds
stay silent. The fix, as RPG Maker's own full-package export does it:
1. Copy the game folder (never change the original: `<port>/game/` is the user's install).
2. Merge the user's own RTP files into the copy (folders such as `CharSet`, `ChipSet`, `Music`, `Sound`); keep the
   game's own files where names clash.
3. Set `FullPackageFlag=1` under `[RPG_RT]` in the copy's `RPG_RT.ini`.
4. Run `pag new` on the copy (a new port), record the acknowledgements again, and continue from step 2.

Only the user's own RTP: from their RPG Maker or an RTP installer they have. Never download one for them.

## Text encoding
Older games, especially Japanese, Chinese or Korean ones, store text in a legacy code page. The player guesses it, and
a wrong guess shows garbled text. When the game's `RPG_RT.ini` has `Encoding=<code page>` under `[EasyRPG]`, build
copies it into `lane.json` and the player gets `--encoding <code page>`. Otherwise set `"encoding"` in
`<port>/build/lane.json` yourself (`932` Japanese, `936` Simplified Chinese, `949` Korean, `950` Traditional Chinese,
`1251` Cyrillic, `1252` Western), then pack again. A new `pag build` resets it from `RPG_RT.ini`.

## Known failures and fixes

| What you see | Cause | Fix |
|---|---|---|
| build: "the EasyRPG runtime is not installed; run: pag setup easyrpg --yes" | runtime missing | Do step 1: show the size and ask first. Never run the `--yes` line from the message directly. |
| build: "no RPG_RT.ldb found in game/" | not an RPG Maker 2000/2003 folder, or the game is still packed (an installer or an archive) | Ask the user to install or unpack the game first, then `pag new` on that folder. |
| build verdict HARD; checkerboard pictures or missing sounds in the game | the game needs the RTP | See RTP above. |
| garbled text | wrong code page | See Text encoding above. |
| the wrong game starts | the folder holds several games; build takes the shallowest `RPG_RT.ldb` | Set `root` in `<port>/build/lane.json` to the right folder, then pack again. |
| a game that uses DynRPG plugins or Maniac Patch features breaks or misbehaves | EasyRPG supports Maniac Patch only partly and DynRPG plugins hardly at all | Tell the user; this lane cannot fix it. |
| verify `csp` (info): `script-src += 'unsafe-eval'` | the player's own glue code needs it | Expected; mention it to the user. |

## Known gaps
- No RTP and no reading of `RPG_RT.exe` on the web: the player guesses the engine version and patches from the
  database, and logos built into the exe do not show.
- Maniac Patch is partly supported, DynRPG plugins mostly not.
- MIDI music plays through a built-in synthesiser and sounds basic. The player asks for a SoundFont named
  `easyrpg.soundfont` in the game folder (untested here).
- Keys: confirm is Enter, Space or Z; cancel is Escape or X; F1 opens the player's settings; F12 restarts the player.

## Licence
EasyRPG Player is GPL-3.0-or-later. The build carries `dist/LICENSES/easyrpg-player-js.txt` with the full GPL-3.0 text
and a link to the source. For private play this needs nothing. If the user ever gives the build (without game files)
to someone, the `LICENSES/` folder must go with it (`ACK_RUNTIME_LICENSE`). Never copy EasyRPG code into this
repository or into `<port>/lane/`.

## Verify notes
Target 30 frames per second; ready budget 30 s; verify presses Enter on the title. The player's own start-up (its
logo, about 1.5 s) is not counted as game frames. BYO privacy rules apply: no request with a body, no cross-origin
request.

## Saves
The game's saves live in the browser's storage for the build's address, one store per `game` id. The player writes
them as soon as the game saves; verify forces a write too (`save` says "lane saveNow ran"). The id comes from the port
folder's name: after renaming the folder and building again, earlier saves stay under the old id and do not show.
