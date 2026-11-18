---
name: port-any-game
description: "Play an old PC game you own in a web browser: port or convert it to web, HTML5 or WebAssembly. Use when the user wants to run a DOS, Flash (SWF), RPG Maker MV/MZ, NW.js, Electron, Construct or Twine game in a browser, play a PC game they own on another screen, check whether a game folder can be ported, or continue a port (a folder with port.json or PORTING_LOG.md). Surveys the game folder without running it, picks the simplest method that works (extract an already-web game, a known open-source port, Ruffle for Flash, js-dos for DOS), builds a private local copy, checks it in Chrome or Edge and hands over a play link or double-click launchers. Refuses DRM removal, cracks, piracy sources and public hosting of game files."
license: MIT
compatibility: "Requires Node.js 20.12+ (22 recommended), git; Chrome or Edge for verification (Playwright fallback)."
---

# Port Any Game

You help the user play a PC game they own in a browser. The `pag` scripts do the work (survey, build, check, serve).
You drive them and explain results in plain words. Ask the user only for what only they can give: where the game is,
yes/no answers, and a 2-minute play test at the end.

## Running pag

`<skill-dir>` is the folder that contains this SKILL.md (the folder this skill was loaded from). Every command is:

```
node <skill-dir>/scripts/pag.mjs <command> [arguments]
```

- Use absolute paths, and quote any path that contains spaces. Never rely on a `pag` shortcut on PATH.
- pag's own messages name commands in short form ("run: pag setup ruffle --yes"). Rewrite them into the full form
  before running them. Anything that downloads (`setup ... --yes`) still needs the size shown and the user's OK
  first (step 5).
- Exit codes: 0 ok, 1 failed, 2 usage error, 4 refused by policy (explain it; never work around it).
  `verify`: 0 pass, 1 fail, 2 warnings only, 3 unsupported environment.
- Below, `<game>` is the user's game folder and `<port>` is the port folder made in step 5.

## Ground rules (always)

Refuse, with no override. Say plainly why, then offer the honest alternative:
1. Removing, bypassing, patching or emulating DRM, activation, launcher ownership checks, protectors, anti-tamper or
   anti-cheat. This includes Steamless, NoCEG, Goldberg/steam_emu, crack loaders and no-CD exes.
2. Decrypting keyed content to disk.
3. Getting game data, disc images, BIOS, keys or OS images from anywhere but the user's own install or media.
   Never download games.
4. Publishing game files, or anything built from them, publicly. The only exceptions: the files are free to share,
   or the user stated they hold the rights (see [legal](references/legal.md)).
5. Modified clients or private servers against live online services.
6. Continuing when the survey finds a pirated copy.
7. No "authorization priming": never assert facts the user did not state. Acknowledgements are the user's own
   answers, recorded.

Warn in plain words, and record the user's yes with `pag ack` (IDs and questions in [legal](references/legal.md)):
store-bought copies; decompile, rewrite or recompile lanes (with the jurisdiction note); asset extraction; lightly
encrypted archives (runtime lanes only); UPX-compressed programs; networking disabled; proprietary middleware;
serving beyond this computer (127.0.0.1); runtime licence duties when sharing a build without game files.

Also:
- Never edit `port.json` (only pag writes it). Never write into `<port>/game/`: it is the user's original install.
- Never delete or move a port folder, or anything in it, recursively: `<port>/game` is a link to the user's real
  install, and some tools (Windows PowerShell 5.1 `Remove-Item -Recurse`) follow it and delete the real game. If the
  user wants a port removed, explain this and let them do it.
- Never commit, push, deploy or host anything without asking first. Never bypass the port's git hooks.
- Agent hooks may run `pag guard` and `pag status` for you. When the guard or a script refuses, tell the user why.
- Write large files in pieces of no more than about 1,000 lines each. Talk to the user in plain words.

## Workflow

### 0. Check Node
Run `node --version`. It must be 20.12 or newer (22 recommended). If node is missing or older, propose the install for
the user's system and wait for their OK:
- Windows: `winget install OpenJS.NodeJS.LTS`
- macOS: `brew install node` (or the LTS installer from nodejs.org)
- Debian/Ubuntu: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`.
  Other Linux: the LTS download from nodejs.org, or the distribution's package if it is 20.12 or newer.

If `node` is still not found afterwards, ask the user to open a new terminal.

### 1. Prerequisites and expectations
Run `node <skill-dir>/scripts/pag.mjs doctor --json`. Act on its warnings: no git (offer to install it: the port's
commit guards need it), no Chrome or Edge (checks will need Playwright, step 5), little disk space.
Then set expectations in one short paragraph: you look at the game without running it and test the result yourself;
web, DOS and Flash games often work within an hour; some games can't be done yet, and you will say so plainly; the
result is a private copy to play, not to post online.

### 2. Intake
Ask in short rounds, each question with a recommended answer the user can accept with "yes".
- Round 1: "Where is the game installed?" Recommended: the folder that holds the game's main program (for a disc or
  disc image, ask them to install it or copy its files to a folder first). "Where should I save the browser
  version?" Recommended: a new folder such as `~/ports/<game-name>`, never inside the game folder or this skill.
- Round 2: "Where do you want to play?" Recommended: in a browser on this computer. Other answers: another device
  at home (some lanes only, see [shell](references/shell.md)), or sharing with others (only builds without game
  files, or games that are free to share or whose rights the user holds). "How much of my time is OK?"
  Recommended: up to an hour; if it isn't playable by then, I stop and explain the options.

### 3. Survey and catalog
If your agent has the `game-surveyor` subagent, let it run the survey (give it `<skill-dir>` and `<game>`).
Otherwise run it yourself:
`node <skill-dir>/scripts/pag.mjs survey "<game>"` (add `--json` for every detail). It reads file headers only and
never runs the game. Exit 0 means GO or HARD, 4 means STOP. Report the verdict in 1–2 sentences: the lane, its odds,
whether it is a true port or (later) Remote Play, and any existing port found.
- STOP: say what was found (the survey names it), that this tool won't remove it, and suggest an official DRM-free
  edition (for example from GOG). Remote Play, streaming the original game from their PC, comes later. Stop here.
- No lane available yet: say which lane would fit and when it arrives (the survey says), then stop honestly.
  Exception: a DOS game with only `.COM` programs is not recognised. If the user says it is a DOS game, use
  `dos-jsdos` with `--lane dos-jsdos` in step 5 (see the dos reference).
- "Possible existing port ... confirm the game title": ask the user whether that is their game.

Then load the reference for the chosen lane, and only that one:

| Lane | Reference |
|---|---|
| `web-extract` | [references/lanes/web-extract.md](references/lanes/web-extract.md) |
| `known-port` | [references/lanes/known-ports.md](references/lanes/known-ports.md) |
| `rt-ruffle` | [references/lanes/runtimes.md](references/lanes/runtimes.md) |
| `dos-jsdos` | [references/lanes/dos.md](references/lanes/dos.md) |

### 4. Acknowledgements
The survey lists IDs after "Acknowledgements:". Add the ground rules' Warn items that apply
([legal](references/legal.md) says when). For each, ask its plain question from legal, one at a time, and wait for
the answer. A "no" stops that path; explain what else is possible. Remember each "yes": you record it in step 5,
once the port folder exists. Never record an answer the user did not give.
Never ask the user to claim rights, and never suggest wording. If they want to share game files publicly, explain
that this needs a game that is free to share or the rights to it, and ask openly whether either applies. Record
`ACK_RIGHTS_HOLDER` only when they state it themselves. Owning a copy is not holding the rights.

### 5. Create the port and install tools
1. `node <skill-dir>/scripts/pag.mjs new "<game>" "<port>"` creates the folder, its rules, a git repository and
   commit guards. It never commits. It uses the survey's lane; add `--lane <id>` only for another lane the survey
   listed, or when the lane reference says so. Exit 4 means STOP.
2. Record each yes from step 4: `node <skill-dir>/scripts/pag.mjs ack <ID> "<port>"`. A repeat says "already
   recorded" and changes nothing. The rights statement goes in word for word, in single quotes:
   - sh/bash: `node <skill-dir>/scripts/pag.mjs ack ACK_RIGHTS_HOLDER "<port>" --note='<their words>'`
     (write each `'` in their words as `'\''`).
   - PowerShell (it drops `"` inside arguments): `$env:PAG_NOTE = '<their words>'` (write each `'` as `''`), then
     `node <skill-dir>/scripts/pag.mjs ack ACK_RIGHTS_HOLDER "<port>" --note-env PAG_NOTE`.

   pag echoes the stored note; check it matches the user's words exactly.
3. Tools: Ruffle (`ruffle`) and js-dos (`jsdos`) for their lanes, Playwright (`playwright`) only when there is no
   Chrome or Edge. First run `node <skill-dir>/scripts/pag.mjs setup <name>` without `--yes`: it only prints what it
   would download and how big. Tell the user (for example "about 10 MB from npm") and, after they agree, run
   `node <skill-dir>/scripts/pag.mjs setup <name> --yes`. Run long downloads in the background if you can
   (Playwright is several hundred MB).

### 6. Build loop
Follow the lane reference. `known-port` only runs `build` and hands over a link: skip steps 7–8 for it. Otherwise:
1. `node <skill-dir>/scripts/pag.mjs build "<port>"` prepares the game and prints its findings as JSON.
2. `node <skill-dir>/scripts/pag.mjs pack "<port>"` writes the browser build to `<port>/dist`.
3. `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 5` is a quick check (it serves the build itself).
   Read the summary and look at the screenshots in `<port>/verify/`.
4. Fix what failed (the lane reference has a failure table; [verify](references/verify.md) explains the checks),
   then repeat.

Tick `PORTING_LOG.md` checklist items as they are done. Test with verify's scripted input and screenshots instead of
asking the user to try each change. If a lane is stuck past the agreed time, say so and move to the next lane the
survey listed, if it is available; otherwise stop and explain. A port's lane never changes, so another lane needs a
new folder: `node <skill-dir>/scripts/pag.mjs new "<game>" "<new port>" --lane <id>`, then its acknowledgements.

### 7. Gate
Run the full check: `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 120`. If your agent has the
`port-verifier` subagent, give it `<skill-dir>` and `<port>` and let it run this and read the screenshots; it
reports problems and never fixes them.
Otherwise run it yourself, with a command timeout of at least 5 minutes (it takes 3 to 4), and open the `step-*.png`
screenshots. Fix until it passes, or tell the user honestly what still fails. Exit 3 means this machine cannot run
the check (see [verify](references/verify.md)), not that the port failed.

### 8. Hand over
- Play now: `node <skill-dir>/scripts/pag.mjs serve "<port>/dist" --open`. It keeps running, so start it in the
  background. It opens the browser at a fixed address for this game, reachable from this computer only.
- Play later without any tools: `node <skill-dir>/scripts/pag.mjs package "<port>"` writes `<port>/package/` with
  double-click launchers and a zip.

Tell the user, in plain words:
- Tested in Chrome or Edge; other current browsers may work but were not checked.
- Ruffle and DOS builds hold no game files: on first start, click "Choose game folder" and pick `<game>`. The files
  are copied into the browser's storage and never uploaded.
- Controls: DOS builds are keyboard only for now. Flash and web games take keyboard and mouse; a gamepad works only
  if a web game supports one itself. There are no touch controls yet.
- Saves stay in this browser at this address; clearing the site's data deletes them. There is no save export yet.
  DOS builds store the game's saves every 30 seconds and when the tab is hidden: after saving, wait a moment.
- The 2-minute check: play with your real keyboard or controller, check the mouse feels right, listen to the sound,
  then save in the game, reload the page and load that save.
- An already-web game's build and package contain the game files: a private copy, not for sharing publicly.

### 9. Optional hosting
Private online hosting and public pages (for builds without game files, or rights-holder builds) come in a later
version. Do not improvise a deploy.

### 10. End of session
Add a dated entry to `<port>/PORTING_LOG.md`: what was done, the commands to repeat it, what comes next. Tell the
user where things stand and how to play what works.

## Continuing a port
If the user points at a folder with `port.json`, or you start inside one: from inside that folder run
`node <skill-dir>/scripts/pag.mjs status` (it names the lane), read `PORTING_LOG.md`, and resume at the first
unchecked item with the lane's reference. To restore missing project files (it keeps everything else):
`node <skill-dir>/scripts/pag.mjs new "<game>" "<port>" --resume --lane <the port's lane>`.

## References
Load only what the current step needs: the chosen lane's reference (table in step 3);
[shell](references/shell.md) for serving, other devices and packages; [verify](references/verify.md) for checks,
reports and fixes; [legal](references/legal.md) for acknowledgement questions and the jurisdiction note.
