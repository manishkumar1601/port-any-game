# Lane: web-extract (already-web games)

## When to use
The survey picked `web-extract`: the game is already a web app inside a desktop wrapper, or an HTML5 engine export.
Typical signs: NW.js (`package.nw`, or a zip appended to the exe), Electron (`resources/app.asar` or
`resources/app/`), RPG Maker MV/MZ (`www/`), Construct, GDevelop, Twine.
Odds 85–95%; usually 30 minutes to a few hours.

## Inputs
- `<game>`: the installed game. It is read-only; nothing in it is changed.
- `<port>` from `pag new`, with `ACK_PRIVATE_USE_ONLY` recorded.
- No runtime download. Chrome or Edge (or Playwright) for verify.
- Data mode `bundled`: `<port>/dist` and any package contain a copy of the game files. Private: never share them
  publicly. The port's git hooks keep them out of commits.

## Steps
1. `node <skill-dir>/scripts/pag.mjs build "<port>"`
   - Copies the web content into `<port>/build/game/`. Sources, in order: `package.nw`, a zip appended to the exe,
     `resources/app.asar`, `resources/app/`, `www/`.
   - Finds the entry page and adds a tiny frame counter (`__pag_hook.js`) to it.
   - Scans the game's scripts for desktop-only calls (`require(`, `process.`, `nw.`, `greenworks`) and counts file
     references whose upper/lower case differs from the file on disk.
   - Prints JSON with `verdict` (GO or HARD), `nodeApiUses` and `caseFixes`, and appends the same to `PORTING_LOG.md`.
2. `node <skill-dir>/scripts/pag.mjs pack "<port>"`
3. `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 5`, then read the summary and the screenshots in
   `<port>/verify/`.
4. Fix (table below) and repeat. Gate with `--soak 120` (SKILL.md step 7), then hand over (step 8).

Every `pag build` deletes and recreates `<port>/build/game/`, so never hand-edit files there.

## Known failures and fixes

| What you see | Cause | Fix |
|---|---|---|
| build: "no web content found" | none of the five layouts above | Check `<game>` is the installed game, not its installer. If the game is another engine, re-run the survey; this lane does not fit. |
| build: "no entry HTML found" | `package.json` `main` is not an html file inside the game, and there is no `index.html` | Report it. M1 cannot choose a different entry page. |
| build `verdict: "HARD"`, `nodeApiUses` lists files and lines | the game calls desktop-only features (local files, Steam) that browsers lack | M1 has no stand-ins ("shims") for these. Run verify anyway: many games only call them behind a desktop check. If verify shows errors or a blank screen at those calls, tell the user the game needs shims that come in a later version. |
| `package.json` `main` is another page, such as `start.html` | normal for NW.js games | Nothing to do. Build turns `index.html` into a redirect to it and keeps the original as `__pag_index_orig.html`. |
| `caseFixes` above 0, or 404s for files that exist with different upper/lower case | Windows ignores case in file names; web servers don't | `pag serve`, `pag verify` and the package launchers find these files anyway (case fallback, files unchanged). Always serve with them, never with another web server. |
| verify `errors`: "Refused to execute inline script", "unsafe-eval" or "Content Security Policy" | the game uses something the build's security policy still blocks (inline `<script>` blocks, `eval` and `new Function` are allowed for this lane) | pag relaxes the Content-Security-Policy for this lane (verify lists it as `info: csp`); never edit `_headers` by hand. Report the exact error to the user. |
| verify `fps` warns | a busy machine, or software rendering | See [verify](../verify.md). |

## Verify notes
- Target is 30 frames per second. Verify presses the arrow keys and expects the picture to change; a title screen
  that waits for Enter shows "static until input" as a warning, not a failure.
- Bundled builds have no privacy check (the game files are on this computer); BYO lanes do.
- The 2-minute manual check matters here: desktop builds often save to files, which a browser cannot write, so test
  one in-game save and load.
