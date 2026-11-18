# Verify: checking a build

## What `pag verify` does
It serves `dist/` on 127.0.0.1 and opens the user's own Chrome or Edge with a throwaway profile (nothing is
installed; it is driven over the Chrome DevTools Protocol). Without Chrome or Edge it uses Playwright's Chromium,
once the user agreed to install it (`pag setup playwright`, see below). Then it:
1. checks the build's files, hashes, headers and licences, and refuses public game data without rights;
2. loads the page; for BYO lanes it imports the game files from `<port>/game` the way a user would;
3. clicks Play, waits up to 10 s for the game's first frame, then samples the picture for 10 s;
4. presses the lane's keys (web-extract: arrow keys) and checks the picture changes;
5. checks sound, a save that survives a reload, and the layout at 1280×800 and 390×844;
6. keeps the game running for `--soak` seconds, watching that it never stalls and that memory does not keep growing;
7. for BYO lanes, checks privacy: no request carries data out, nothing goes to another site.

## Commands
- Quick check while building: `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 5`
- The gate: `node <skill-dir>/scripts/pag.mjs verify "<port>/dist" --soak 120`
- Options: `--headed` (show the browser window), `--runner cdp|playwright` (force one), `--fixture <folder>` (BYO:
  import from another folder), `--json` (the full report on stdout). Without `--soak` it soaks 60 s.

The gate runs through the `port-verifier` subagent when your agent has it: it runs verify, reads the screenshots and
reports, and never fixes anything. Without subagents, run it yourself and report just as plainly.

## Results
Exit 0 pass, 1 fail, 2 warnings only, 3 unsupported environment (this machine cannot run the check; that is not a
port failure). Exit 1 also covers bad arguments and "not a packed build" (run `pag pack` first).
Output: one summary line, then each check that did not pass as `status: name: detail`, then the report path.
`<port>/verify/` holds `report.json`, the screenshots `step-*.png` and `console.log`; each run replaces them.
Always look at the screenshots before you tell the user it works.

| Check | Passes when |
|---|---|
| `ready` | the page gets ready in time: a first load within 120 s, a reload within 30 s; a reload or first frame slower than the lane's budget (30 s for M1 lanes) warns |
| `shell` | the page reaches "running", not an error |
| `blank` | the picture is not near-black or flat (up to 3 of 10 blank samples, such as a fade, only warn) |
| `frozen` | the picture changes; "static until input" only warns |
| `fps` | at least 0.9 × the target frame rate (30); at least 0.5 × warns |
| `input` | key presses change the picture within 3 s |
| `audio` | sound plays when the lane expects it; a silent title screen is allowed |
| `save` | a test value survives a page reload |
| `viewports` | the page does not overflow at desktop or phone size |
| `loop` | the game's frames never stop for more than 2 s |
| `memory` | heap growth under 5 %/min (5–10 warns, over 10 fails); judged only on soaks of 30 s or more |
| `errors` | no page errors; console errors warn |
| `requests` | every request succeeds (no 404s) |
| `privacy` (BYO only) | no request with a body, no cross-origin request, no popup |

## Known failures and fixes

| What you see | Cause | Fix |
|---|---|---|
| exit 3, "no Chrome or Edge found; Playwright is not installed (pag setup playwright --yes)" | no Chromium-family browser on this machine (common on macOS) | Install Chrome or Edge if the user prefers, or run `node <skill-dir>/scripts/pag.mjs setup playwright` (shows the size: several hundred MB), and after the user agrees, run the same with `--yes`. Then verify again. |
| exit 3 with "the CDP runner needs Node 22+" | Node 20 has no built-in WebSocket | Use Playwright as above, or upgrade Node to 22. |
| `ready` notes "no game frame within 10 s of Play" | the game is slow to start or stuck on a loading screen | Look at the screenshots. The blank, frozen and fps checks then decide; fix what they show. |
| `memory: skip`, "soak too short to judge memory" | soaks under 30 s only see start-up growth | Expected for quick checks. The gate's `--soak 120` judges memory. |
| `fps` warns (or "software rendering") | the machine is busy, or has no graphics acceleration here | Close other heavy apps (games, video calls, big builds, browser tabs with video) and run verify again. A warning that stays on software rendering is the machine's limit, not the port's. |
| `privacy` fails: "request with a body" (for example a POST) or "cross-origin" | the game or runtime tried to send data or reach another site | The page blocks it; report which feature needs it (ads, scores, online parts). Never loosen the rule. |
| `frozen` fails on a still title screen | the game waits for a click or a key the lane does not press | Look at the screenshot. If the title is drawn correctly, tell the user and rely on their 2-minute check. |
| `fixture` fails (BYO) | `<port>/game` is missing or not a folder | Re-link it with `node <skill-dir>/scripts/pag.mjs new "<game>" "<port>" --resume --lane <the port's lane>` (without `--lane` it fails when the survey finds no lane), or pass `--fixture "<game>"`. |
| `requests` fails with 404s | a file is missing, or its name's case differs (web-extract) | See the lane reference. Always verify and serve through pag. |

## The user's 2-minute check
Before calling it "works on your computer", ask the user to: play with their real keyboard or controller, check the
mouse feels right, listen to the sound quality, then save in the game, reload the page and load that save.
