# Lanes: engine runtimes (Ruffle now, more coming)

A runtime lane plays the game's original files in a free, open-source player compiled for the browser. The player
ships in the build; the game files never do (data mode `byo`, "bring your own"): on first start the page asks the
user to choose their game folder and copies it into the browser's own storage. Nothing is uploaded.

## rt-ruffle (Flash games)

### When to use
The survey picked `rt-ruffle`: it found SWF files, or a Flash projector exe (a `.exe` with the SWF inside).
Odds: ActionScript 1/2 games (AVM1) 85–95%, ActionScript 3 games (AVM2) 55–80%. Usually under 2 hours.

### Inputs
- `<port>` from `pag new`, with `ACK_PRIVATE_USE_ONLY` and `ACK_RUNTIME_LICENSE` recorded.
- The Ruffle runtime (MIT or Apache-2.0, about 10 MB from npm), installed once per computer.

### Steps
1. `node <skill-dir>/scripts/pag.mjs setup ruffle` prints the download and its size. After the user agrees:
   `node <skill-dir>/scripts/pag.mjs setup ruffle --yes`.
2. `node <skill-dir>/scripts/pag.mjs build "<port>"` picks the main SWF (the least deeply nested, then the largest)
   or, when there is no `.swf`, the projector exe. It records the choice in `<port>/build/lane.json` as
   `{"swf": "<path in game/>", "projector": true|false}`.
3. `node <skill-dir>/scripts/pag.mjs pack "<port>"`, then
   `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 5`. Verify imports the files from `<port>/game`
   itself.
4. Fix (table below) and repeat. Gate with `--soak 120`, then hand over (SKILL.md steps 7–8).

### Known failures and fixes

| What you see | Cause | Fix |
|---|---|---|
| build: "the Ruffle runtime is not installed; run: pag setup ruffle --yes" | runtime missing | Do step 1: show the size and ask first. Never run the `--yes` line from the message directly. |
| build: "no SWF found in game/ and no Flash projector executable in the survey" | no Flash content | Check `<game>` is the right folder. Games that download their SWFs from the internet cannot be ported. |
| the game is one `.exe` with no `.swf` | a Flash projector: the SWF is stored at the end of the exe | Nothing to do: build sets `"projector": true` and the browser cuts the SWF out of the exe. If the page says "not a Flash projector: no SWF trailer", the exe is not a projector; look for the real `.swf`. |
| a loader, menu or wrong movie plays | build guessed the wrong main SWF | Set `swf` in `<port>/build/lane.json` to the right file (path inside `game/`, forward slashes), then pack again. A new `pag build` resets the choice. |
| missing features, errors or a blank stage in an ActionScript 3 game | Ruffle supports AVM2 less completely | Report it honestly; M1 has nothing to tune. Check whether another lane in the survey applies. |
| verify `privacy` fails (cross-origin request, or a request with a body) | the SWF tries to reach a server (ads, high scores, remote files) | The request is blocked, as it should be. Report which parts of the game need that server. |
| a gamepad does nothing | Ruffle maps no gamepad buttons in M1 | Tell the user Flash builds take keyboard and mouse only for now. |
| verify `frozen` fails on a still title screen | many Flash games wait for a click; M1 verify only presses keys, and this lane declares none | Look at the screenshot. If the title is drawn correctly, say so and rely on the user's 2-minute check. |

### Verify notes
Target 30 frames per second; ready budget 30 s. BYO privacy rules apply: no request with a body, no cross-origin
request. Ruffle's licence text and source link are in `dist/LICENSES/`.

## Coming in later versions
When the survey names one of these lanes, tell the user it is not available yet, give the version it arrives in,
and stop honestly (or use another lane the survey listed):

| Lane | Games | Arrives |
|---|---|---|
| `rt-easyrpg` | RPG Maker 2000/2003 | M2 |
| `rt-scummvm` | classic point-and-click adventures | M2 |
| `rt-idtech` | Doom, Quake, Half-Life engine games, Build engine games | M2 |
| `rt-mkxpz` | RPG Maker XP, VX, VX Ace | M4 |
| `rt-ags` | Adventure Game Studio games | M4 |
| `rt-dirplayer` | Macromedia Director / Shockwave | M4 |
| `rt-butterscotch` | older GameMaker games | M4 |
| `rt-cheerpj` | Java games | M4 |
