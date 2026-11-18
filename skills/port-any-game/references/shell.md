# The browser build, serving and packages

## What `pag pack` makes
`<port>/dist/` is the whole browser build:
- `index.html` and `shell/`: the player page (Play button, progress, plain error messages). MIT.
- `shell.json`: the lane's settings. `runtime/<lane>-<hash>/`: the lane's player (Ruffle, js-dos, or the small
  web-extract adapter).
- `pag-manifest.json`: every game file with its size and hash. `game/...`: the game files, in bundled builds only.
- `_headers` (security headers), `robots.txt` (no search indexing), `LICENSES/` (every shipped part's licence).

Data modes:
- `byo` ("bring your own": Ruffle, DOS). No game files in the build. The page asks for the game folder ("Choose
  game folder", or drop the folder on the page), checks the files against the manifest and copies them into the
  browser's private storage. Later starts skip this step. Nothing is uploaded.
- `bundled` (web-extract). The game files are inside `dist/game/`. A private copy.
- `bundled-public`: only for games that are free to share, or with a recorded rights-holder statement
  ([legal](legal.md)). Public hosting is not in this version.

## Serving on this computer
`node <skill-dir>/scripts/pag.mjs serve "<port>/dist" --open`
- Reachable from this computer only (127.0.0.1). Prints the address and keeps running until stopped, so start it in
  the background. `--open` opens the default browser.
- Each game gets a fixed port between 20000 and 29999, worked out from its id. The launchers use the same one. The
  address matters: the browser keeps imported files and saves per address.
- "port N is in use (another copy of this game may already be running)": first open `http://127.0.0.1:N`; it is
  probably this game, already served. Otherwise stop the other program, or pass `--port <number>` (a different port
  is a different address, so imported files and saves start empty there).
- It sends the build's security headers and finds mixed-case file names when the lane asks for it. Never serve
  `dist/` with another web server, and never open `index.html` straight from disk: the page then stays on
  "Loading. If this stays, open the build through pag serve".

## Another device at home
- Ask first, with the `ACK_WARN_BEYOND_LOOPBACK` question ([legal](legal.md)), and record the yes with `pag ack`:
  this makes the game reachable from the home network. serve refuses `--lan` without it (exit 4).
- A password is required. Ask the user to choose a new one used for nothing else. pag reads it from the environment
  variable named by `--password-env`, set in the same shell that runs serve:
  - sh/bash: `PAG_PASSWORD='<password>' node <skill-dir>/scripts/pag.mjs serve "<port>/dist" --lan --password-env PAG_PASSWORD`
  - PowerShell: `$env:PAG_PASSWORD = '<password>'`, then
    `node <skill-dir>/scripts/pag.mjs serve "<port>/dist" --lan --password-env PAG_PASSWORD`

  The other device's browser asks for it; any user name works.
- serve still prints `http://127.0.0.1:<N>`, which only works on this computer. Give the user this computer's home
  network address instead: `http://<LAN IP>:<N>`. Find the LAN IP with `ipconfig` (Windows, "IPv4 Address"),
  `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux). Windows may ask once whether Node.js may use the
  network: allow it for private networks only.
- Works for bundled builds (web-extract). Ruffle and DOS builds do not work this way in M1: their file import needs
  the browser's private storage, which browsers only allow over https or on the same computer. The page says
  "Unsupported environment ... open the build over https or localhost". Private https hosting comes later.
- There are no touch controls yet: keyboard games need a keyboard on that device.
- Never expose a build to the internet (port forwarding, tunnels).

## Browsers
`pag verify` checks Chrome or Edge. Other current browsers usually work but are not checked. Safari may delete a
site's data (imported files and saves) after 7 days without a visit.

## Packages: `pag package`
`node <skill-dir>/scripts/pag.mjs package "<port>"` writes `<port>/package/<id>-portable/` (the build, launchers and
a README.txt) and `<port>/package/<id>.zip`.
- Windows: double-click `Play-Windows.bat` (needs nothing installed). macOS: `Play-macOS.command` (first time:
  right-click, Open). Linux: `Play-Linux.sh`. On macOS and Linux the launcher uses Node.js when it is installed.
  Without Node.js it falls back to python3, but only for builds that need neither cross-origin isolation nor
  case-insensitive file names (Ruffle and DOS builds); already-web games need Node.js there.
- Each launcher serves on 127.0.0.1 at the game's fixed port and opens the browser. If the port is busy, it assumes
  the game is already running and just opens the browser.
- Bundled packages contain the game files. pag prints "Private copy: contains your game files. Do not share
  publicly." Pass that on. BYO packages contain no game files: someone who owns the game imports their own copy.
  Keep `LICENSES/` with any copy that is given to someone (`ACK_RUNTIME_LICENSE`).
- "package too large for a .zip; share the folder instead": zips are limited to 4 GiB, so no zip is written. Use the
  `-portable` folder instead.
- `package/` is ignored by the port's git. The known-port lane has nothing to package.

## Saves
Saves live in the browser's storage for that address. Clearing the site's data deletes them, and a different port
means different storage. There is no save export button yet. DOS builds copy the game's own save files into that storage every 30 seconds and when
the tab is hidden or closed ([dos](lanes/dos.md)). RPG Maker 2000/2003 builds write them there as the game saves
([easyrpg](lanes/easyrpg.md)). LÖVE builds write them every 30 seconds and when the tab is hidden or closed
([love](lanes/love.md)). Ren'Py builds write them there as the game saves ([renpy](lanes/renpy.md)).
