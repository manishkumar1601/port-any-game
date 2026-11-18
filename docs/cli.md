# `pag` command reference

`pag` is the single CLI of port-any-game. It is **not on PATH**. Run it through Node from the skill folder:

```
node <skill dir>/scripts/pag.mjs <command> [args]
```

`<skill dir>` is `skills/port-any-game` in this repo, or wherever the installer copied the skill (see [agent-integration.md](agent-integration.md)). Node 20.12 or newer is required; the CDP verify runner needs Node 22+ (global `WebSocket`).

The dispatcher is [pag.mjs](../skills/port-any-game/scripts/pag.mjs). Each command is a module that exports `run(argv) -> exit code`; adding a command is one line in its `COMMANDS` table. `pag help`, `--help` and `-h` print the command list and exit 0. An unknown or missing command prints usage to stderr and exits 2.

Commands: `survey`, `new`, `build`, `pack`, `package`, `serve`, `verify`, `doctor`, `setup`, `ack`, `status`, `guard`.

Typical order for one game: `survey` -> `new` -> (`ack` as needed) -> `build` -> `pack` -> `verify` -> `package`. Design background: [architecture.md](architecture.md).

## Exit codes

| Code | Meaning | Used by |
|---|---|---|
| 0 | ok | all commands |
| 1 | failure (I/O, missing prerequisite, failed checks) | all except `survey`, `status`, `doctor`, `guard` |
| 2 | usage error. For `verify` only: warn-only result | all |
| 3 | unsupported environment (no usable browser) | `verify` only |
| 4 | policy refusal (survey STOP verdict, rights gate, LAN gate) | `survey`, `new`, `build`, `pack`, `serve` |

The table in the task brief lists 0/1/2/3. The code differs in two places, so keep these in mind:

- **Exit 4 exists.** `survey` returns 4 on a STOP verdict; `new`, `build`, `pack` and `serve` return 4 when a `PolicyError` is thrown (see [safety-and-policy.md](safety-and-policy.md)).
- **Exit 2 means different things.** Everywhere except `verify` it is a usage error. `verify` uses `{pass: 0, fail: 1, warn: 2, unsupported: 3}` and reports bad arguments as exit 1 (see [verify.md](verify.md)).
- `status` and `guard` always fail open: they exit 0 on any internal error (`guard` exits 2 only to deny, see below).

## survey

Static, bounded, read-only scan of a game folder. Never executes anything from it. Output holds relative paths and a salted `root_id` only.
Module: [survey/survey.mjs](../skills/port-any-game/scripts/survey/survey.mjs). Internals: [survey-and-catalog.md](survey-and-catalog.md).

```
pag survey <dir> [--json] [--out <file>]
```

| Flag | Default | Meaning |
|---|---|---|
| `--json` | off | print the full `survey.json` instead of the short human summary (at most 8 lines) |
| `--out <file>` | none | also write the JSON to this file |

- **Reads:** the game folder (up to 200000 files; at most 200 executables/modules parsed, 4 MiB read cap each), the rules in `scripts/rules/`, the catalog, and `<cache>/salt`.
- **Writes:** only `--out`, plus `<cache>/salt` on first run (random salt for `root_id`).
- **Exit:** 0 GO or HARD verdict, 4 STOP verdict, 2 usage error or unreadable folder or `--out`.
- **Errors:** `pag survey: not a directory`; `pag survey: cannot write --out file (...)`; `usage: pag survey <dir> [--json] [--out <file>]`.

```
node <skill dir>/scripts/pag.mjs survey "/games/MyGame" --out /tmp/survey.json
```

## new

Creates the port folder for a game. Never commits, never records an acknowledgement.
Module: [new.mjs](../skills/port-any-game/scripts/new.mjs).

```
pag new <gameDir> <outDir> [--lane <id>] [--resume]
```

| Flag | Default | Meaning |
|---|---|---|
| `--lane <id>` | verdict's `primary_lane` | force a lane |
| `--resume` | off | continue an existing port: reuse `port.json`, write only files that are missing |

- **Reads:** the game folder (runs a survey), the lane registry, templates in `assets/project/`.
- **Writes** (only when missing): `port.json`, `survey.json`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `PORTING_LOG.md` (with the lane checklist), `.githooks/{pre-commit,pre-push,check-staged.mjs}`, `lane/.gitkeep`, and a `game/` symlink (a junction on Windows) to the install. Runs `git init` and sets `core.hooksPath` to `.githooks`; if git is missing it warns and carries on. Folder layout: [architecture.md](architecture.md).
- **Exit:** 0 ok; 1 other failure; 2 usage error; 4 policy refusal (STOP verdict).
- **Errors:**
  - `<outDir>/port.json already exists; pass --resume to continue that port`
  - `the port folder ... is inside (or the same folder as) the game folder`, the reverse, or `inside the port-any-game skill folder`
  - `no lane applies to this game; pass --lane <id>`
  - `unknown lane '<id>'`
  - `lane '<id>' is not available until <milestone>; it cannot be ported yet`
  - `survey verdict is STOP: lane '<id>' is refused. Only remote-play ...` (exit 4)

```
node <skill dir>/scripts/pag.mjs new "/games/MyGame" "/ports/mygame"
```

## build

Runs the port's lane build step (extract, convert, or for `known-port` report where to go).
Module: [build.mjs](../skills/port-any-game/scripts/build.mjs). Lanes: [lanes.md](lanes.md).

```
pag build [portDir] [--include-high-risk]
```

| Flag / arg | Default | Meaning |
|---|---|---|
| `portDir` | `.` | port folder |
| `--include-high-risk` | off | `known-port` lane only: also list high-risk ports |

- **Reads:** `port.json`, the port's `game/`. **Writes:** whatever the lane writes, mainly `build/` (for example `build/game`, `build/lane.json`) and sections appended to `PORTING_LOG.md`. Prints the lane's result as JSON.
- **Exit:** 0 ok; 1 failure or the lane has no build step; 2 usage error, not a port folder, or unknown lane; 4 policy refusal.
- **Errors:** `pag build: <dir> is not a port folder (no readable port.json: ...)`; `unknown lane '<id>' in port.json`; `lane <id> has no build step yet`.

```
node <skill dir>/scripts/pag.mjs build "/ports/mygame"
```

## pack

Assembles `<port>/dist`: the shared shell, `runtime/<lane>-<hash8>/` (adapter and pinned runtime files), `shell.json`, `pag-manifest.json`, `_headers`, `robots.txt`, `LICENSES/`, and the game files in `game/` unless the mode is `byo`. Headers, CSP and manifest details: [runtime.md](runtime.md).
Module: [pack.mjs](../skills/port-any-game/scripts/pack.mjs).

```
pag pack [portDir] [--mode byo|bundled|bundled-public]
```

| Flag / arg | Default | Meaning |
|---|---|---|
| `portDir` | `.` | port folder |
| `--mode` | `port.json` `data.mode`, else `byo` | data mode |

- **Reads:** `port.json`, `build/game` if present (else `game/`), the lane's pinned tool in `<cache>/tools/` (must be installed with `pag setup`).
- **Writes:** `dist/` (built in `work/pack-tmp-*` then swapped in, so a failure leaves the previous `dist`). On a successful `bundled-public` pack it also sets `data.mode` to `bundled-public` in `port.json`.
- **Exit:** 0 ok; 1 failure; 2 usage error, not a port, unknown lane, unknown or unsupported mode; 4 policy refusal.
- **Errors:**
  - `a bundled-public pack puts game files in a build meant for sharing. ...` (exit 4; needs `ACK_RIGHTS_HOLDER` or catalog `redistributable`)
  - `lane <id> needs its build output: run `pag build` first (no build/lane.json)` (a `byo` lane with a build step, before it was built)
  - `lane <id> supports data modes ...; not '<mode>'`
  - `<name> <version> is not installed; run pag setup <tool> --yes first`
  - `lane <id> packs what its build extracted, and there is no build/game yet: run pag build first`
  - `no game files: the game/ folder is missing`
  - `game file <rel> links outside the game folder; refusing to pack it`
  - `game files A and B differ only by case`
  - `<lane> routes to an existing web port; there is nothing to pack` (lane `known-port`)

```
node <skill dir>/scripts/pag.mjs pack "/ports/mygame" --mode byo
```

## verify

Serves `dist/`, drives a browser, and judges the build (frames, audio, input, console, network, saves, soak). Tiers, checks and thresholds: [verify.md](verify.md).
Module: [verify/verify.mjs](../skills/port-any-game/scripts/verify/verify.mjs).

```
pag verify [dist] [--runner auto|cdp|playwright] [--soak SECONDS] [--headed]
           [--browser chromium|firefox|webkit|all] [--fixture DIR] [--query K=V&...] [--json]
```

| Flag | Default | Meaning |
|---|---|---|
| `dist` | `dist` | packed build folder |
| `--runner` | `auto` | `auto`: the user's Chrome/Edge over CDP, else Playwright from the tool cache, else unsupported. `cdp` / `playwright` force one |
| `--soak` | `60` | soak seconds, 0 to 3600 (memory is judged only for 30 s or more) |
| `--headed` | off | show the browser window |
| `--browser` | `chromium` | CDP drives Chrome/Edge only; `firefox`, `webkit` and `all` need Playwright |
| `--fixture DIR` | `<port>/<manifest source>` | BYO builds import game files from here; nothing is written into it |
| `--query` | empty | extra query string appended to the page URL |
| `--json` | off | print the full report instead of the summary |

- **Reads:** `dist/shell.json`, `dist/pag-manifest.json`, the nearest `port.json` above `dist`, the fixture folder.
- **Writes:** `<port>/verify/report.json`, `console.log`, `step-*.png`. Old copies of those three are deleted first; other files in `verify/` are left alone.
- **Exit:** 0 pass; 1 fail, or bad arguments, or not a packed build; 2 warn only; 3 unsupported environment (no browser or runner). A fail beats unsupported when both occur.
- **Errors:** `<dist> is not a packed build (...); run pag pack first`; `unknown runner`, `unknown browser`, `--soak takes 0 to 3600 seconds`; unsupported reasons such as `no Chrome or Edge found (PAG_BROWSER=...)`, `the CDP runner needs Node 22+`, `Playwright is not installed (pag setup playwright --yes)`.

```
node <skill dir>/scripts/pag.mjs verify "/ports/mygame/dist" --soak 5
```

## serve

Static server for a built `dist/`. Loopback by default. Every response carries `X-Robots-Tag: noindex, nofollow`; other headers come only from `<root>/_headers`. `verify` reuses the same server. Details: [runtime.md](runtime.md).
Module: [serve.mjs](../skills/port-any-game/scripts/serve.mjs).

```
pag serve [dist] [--port N] [--lan --password-env VAR] [--open]
```

| Flag | Default | Meaning |
|---|---|---|
| `dist` | `dist` | folder to serve |
| `--port N` | stable per-game port 20000-29999 (hash of the port id, or of the path outside a port) | 0 picks any free port |
| `--lan` | off | listen on `0.0.0.0` instead of `127.0.0.1` |
| `--password-env VAR` | none | env var holding the HTTP Basic password (any user name). Used only with `--lan` |
| `--open` | off | open the URL in the default browser |

- **Reads:** `dist/`, `_headers`, `shell.json` (`serve.caseFallback`), the nearest `port.json`.
- **Writes:** nothing. Prints the URL on stdout and runs until SIGINT or SIGTERM, then exits 0.
- **Exit:** 0 stopped cleanly; 1 port in use or listen failure; 2 usage error, bad `--port`, not a directory; 4 policy refusal.
- **Errors:** `pag serve: port N is in use (another copy of this game may already be running); pass --port`; `serving beyond 127.0.0.1 needs a password (--password-env VAR)` (LAN_NO_PASSWORD); `serving this port beyond 127.0.0.1 needs the user's OK first ...` (LAN_NO_ACK, see `ACK_WARN_BEYOND_LOOPBACK`).

```
node <skill dir>/scripts/pag.mjs serve "/ports/mygame/dist" --open
```

## package

Turns a finished `dist/` into a folder and zip a player can open with no tools. Launchers serve `dist/` on 127.0.0.1 and open the browser. Format: [runtime.md](runtime.md).
Module: [package.mjs](../skills/port-any-game/scripts/package.mjs).

```
pag package [portDir]
```

No flags; `portDir` defaults to `.`.

- **Reads:** `port.json`, `dist/` (including `shell.json`, `_headers`), `assets/launchers/`.
- **Writes:** `<port>/package/<id>-portable/` (launchers, `launch.json`, `headers.json`, `README.txt`, `dist/`) and `<port>/package/<id>.zip`. A stale zip is removed first. If the package passes the 32-bit zip limits, the folder is still written, no zip is made, and a warning says so.
- **Exit:** 0 ok; 1 failure; 2 usage error.
- **Errors:** `no dist/: run pag pack first`; `dist/shell.json is missing or unreadable: run pag pack again`; `<lane> routes to an existing web port; there is nothing to package`; warning `package too large for a .zip; share the folder instead`. A non-`byo`, non-`bundled-public` package also prints `Private copy: contains your game files. Do not share publicly.`

```
node <skill dir>/scripts/pag.mjs package "/ports/mygame"
```

## status

One-line port status, run by the session-start hooks. Cheap (no git or browser probing) and fails open.
Module: [status.mjs](../skills/port-any-game/scripts/status.mjs).

```
pag status [--host=<x>] [--json]
```

`--json` prints `{port, nextItem, lastVerify, warnings}`. `--host` is accepted and ignored (output is plain text for every host).

- **Reads:** nearest `port.json` at or above the current directory, `PORTING_LOG.md` (first `- [ ]` line is the next item), `verify/report.json`.
- **Writes:** nothing. Prints nothing outside a port.
- **Exit:** always 0.

```
node <skill dir>/scripts/pag.mjs status
```

## doctor

Reports what the machine has: OS, Node, git, free disk in the cache dir, browsers, cached Playwright, sandbox type, cache dir, warnings.
Module: [doctor.mjs](../skills/port-any-game/scripts/doctor.mjs).

```
pag doctor [--json]
```

- **Reads:** environment, the cache dir, standard browser install locations. **Writes:** creates the cache dir if missing.
- **Browser order:** `PAG_BROWSER`, `CHROME_PATH`, then per-OS locations (Edge, Chrome, Chromium).
- **Warnings:** Node below 20.12 (too old) or below 22 (recommended), no git, no browser and no Playwright, under 2 GiB free.
- **Exit:** always 0, even with warnings.

```
node <skill dir>/scripts/pag.mjs doctor --json
```

## setup

Installs a pinned lane runtime into `<cache>/tools/<name>-<version>/`. Never downloads without `--yes`. Pins and hashes live in [toolchain.lock.json](../skills/port-any-game/scripts/toolchain.lock.json).
Module: [setup.mjs](../skills/port-any-game/scripts/setup.mjs).

```
pag setup <core|ruffle|jsdos|easyrpg|love|renpy|playwright> [--yes]
```

| Target | Installs |
|---|---|
| `core` | nothing; creates the cache dir |
| `ruffle` | Ruffle self-hosted build (lane `rt-ruffle`) |
| `jsdos` | js-dos (lane `dos-jsdos`) |
| `easyrpg` | EasyRPG Player web build (lane `rt-easyrpg`) |
| `love` | love.js packager |
| `renpy` | Ren'Py SDK plus web support files, about 416 MB on disk |
| `playwright` | npm package plus Chromium into `<cache>/ms-playwright` (several hundred MB) |

Without `--yes` it prints what it would download and exits 0. A lock entry may list `extras` (`{url, sha256, size, archive: zip|tgz|file, strip?, into}`) that are downloaded, hash-checked and extracted into the same tool dir; `unpackedSize` is shown as the disk size. Downloads resume from `<file>.part` (HTTP Range), abort after 60 s without data, check SHA-256 before extracting, extract to a temp dir, rename into place, and write `.ok` last. An already installed tool is a no-op.

- **Reads:** `toolchain.lock.json`. **Writes:** `<cache>/downloads/`, `<cache>/tools/`.
- **Exit:** 0 ok or dry run; 1 download, hash or install failure; 2 unknown target.
- **Errors:** `usage: pag setup <core|ruffle|jsdos|easyrpg|love|renpy|playwright> [--yes]`; `sha256 mismatch for <name>: expected ..., got ...`; `download stalled: no data for 60 s ...` (run the same command again to resume); `download failed: HTTP <n> ...`.

```
node <skill dir>/scripts/pag.mjs setup ruffle --yes
```

## ack

Records one acknowledgement the user gave, as `{id, at, note?}` in the nearest `port.json`. The agent asks the user a plain question and runs this only after a yes. Only `pag` writes `port.json`; the guard blocks agent edits to it.
Module: [ack.mjs](../skills/port-any-game/scripts/ack.mjs).

```
pag ack <ID> [portDir] [--note=<the user's own words> | --note-env VAR]
```

| Flag / arg | Default | Meaning |
|---|---|---|
| `ID` | required | one of the IDs below |
| `portDir` | `.` | folder at or below the port; the nearest `port.json` upward wins |
| `--note` | none | the user's words, stored verbatim |
| `--note-env VAR` | none | read the note from env var `VAR`, which must match `PAG_[A-Z0-9_]+` (so a token can never be copied into the git-tracked `port.json`). Use it where the shell mangles quotes, for example Windows PowerShell 5.1 |

`--note` and `--note-env` are mutually exclusive. `ACK_RIGHTS_HOLDER` requires a non-empty note. Writing is atomic (temp file then rename). Re-recording an ID is a no-op that exits 0.

Known IDs (meaning and when each is asked: [safety-and-policy.md](safety-and-policy.md)):
`ACK_PRIVATE_USE_ONLY`, `ACK_RUNTIME_LICENSE`, `ACK_GREY_ASSET_EXTRACT`, `ACK_GREY_DECOMPILE`, `ACK_RIGHTS_HOLDER`, `ACK_UPX_PACKED`, `ACK_PROTECTION_WARN`, `ACK_WARN_STORE_LICENSED`, `ACK_WARN_LIGHTLY_ENCRYPTED`, `ACK_WARN_NETWORKING_DISABLED`, `ACK_WARN_PROPRIETARY_MIDDLEWARE`, `ACK_WARN_BEYOND_LOOPBACK`.

- **Exit:** 0 recorded or already there; 1 failure (including `acks` not being a list); 2 usage error, unknown ID, no `port.json` found, missing note, or unset env var.
- **Errors:** `unknown acknowledgement '<id>'. Known: ...`; `ACK_RIGHTS_HOLDER needs --note (or --note-env) with the user's own words`; `--note-env takes a PAG_* variable name`; `environment variable <VAR> is not set`; `no port.json at or above <dir>; run pag new first or pass the port folder`.

```
PAG_NOTE="I own this game" node <skill dir>/scripts/pag.mjs ack ACK_RIGHTS_HOLDER "/ports/mygame" --note-env PAG_NOTE
```

## guard

Hook adapter. Reads an agent hook payload on stdin, asks [policy.mjs](../skills/port-any-game/scripts/policy.mjs) (`checkToolUse`), and denies in the host's format. Policy rules and the host table: [safety-and-policy.md](safety-and-policy.md), [agent-integration.md](agent-integration.md).
Module: [guard.mjs](../skills/port-any-game/scripts/guard.mjs).

```
pag guard [--host=<x>]        (payload on stdin)
```

`--host` defaults to `claude`. It accepts `--host=x` or `--host x`.

| Host | Deny format |
|---|---|
| `copilot` | JSON `{permissionDecision:"deny", permissionDecisionReason}` on stdout, exit 0 |
| `antigravity`, `agentplugins` | JSON `{decision:"deny", reason}` on stdout, exit 0 |
| `codex` | JSON `{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", ...}}`, exit 0 |
| anything else (`claude`, ...) | reason on stderr, exit 2 |

- **Reads:** stdin only (a TTY or empty stdin is allowed: exit 0).
- **Writes:** nothing but the deny output.
- **Exit:** 0 allow (and for every internal error: fail open, message on stderr); 2 deny for non-JSON hosts.
- Both the dispatcher and the module fail open: a module load failure prints `pag guard: load error, allowing` and exits 0.

## Environment variables

### Product variables (read by the scripts at runtime)

| Variable | Read by | Meaning |
|---|---|---|
| `PAG_CACHE` | [lib/fsx.mjs](../skills/port-any-game/scripts/lib/fsx.mjs) | Cache dir for tools, downloads, the survey salt. Default `~/.port-any-game` |
| `PAG_BROWSER` | doctor, verify | Absolute path of the browser to use. If set but the file is missing, verify finds no browser (no fallback); tests use this to force "no browser" |
| `CHROME_PATH` | doctor | Second choice for the browser path |
| `PAG_CHROME_FLAGS` | [verify/browser.mjs](../skills/port-any-game/scripts/verify/browser.mjs) | Extra Chromium flags, split on spaces, added for both runners |
| `PLAYWRIGHT_BROWSERS_PATH` | setup, verify Playwright driver | Where Playwright browsers live. Default `<cache>/ms-playwright` |
| `PAG_NO_OPEN` | packaged launchers | `1` skips opening the browser. Read by the scripts in [assets/launchers/](../skills/port-any-game/assets/launchers/), not by `pag` |
| `PAG_*` named by `--note-env` | ack | Any `PAG_` name; holds the acknowledgement note. `PAG_NOTE` is the documented convention |
| the name given to `--password-env` | serve | Any name; holds the LAN password |
| `ProgramFiles`, `ProgramFiles(x86)`, `LOCALAPPDATA`, `PATH` | doctor | Browser discovery |
| `CLAUDE_CODE_REMOTE`, `CLAUDE_CODE_WEB`, `CLAUDE_CODE_ENTRYPOINT`, `CODEX_SANDBOX`, `CODEX_CLOUD`, `CODEX_SANDBOX_NETWORK_DISABLED` | doctor | Detect a hosted agent sandbox (`claude-web`, `codex-cloud`) |
| `XDG_CONFIG_HOME` | [scripts/install.mjs](../scripts/install.mjs) | Global OpenCode config dir for the installer (not a `pag` command) |

### Test and CI only (never needed by users)

| Variable | Read by | Meaning |
|---|---|---|
| `PAG_E2E=0` | [test/e2e/run.mjs](../test/e2e/run.mjs) | Skip all browser e2e cases |
| `PAG_E2E_REQUIRE_BROWSER=1` | e2e runner | A missing browser fails the run instead of skipping |
| `PAG_E2E_KEEP=<dir>` | e2e runner | Copy each case's port and `verify/` report there |
| `PAG_E2E_TARGET_FPS=<n>` | e2e runner | Lower `verify.target_fps` in the packed fixture (never raises it) (CI sets 10 on GPU-less macOS) |
| `PAG_E2E_TOOLS`, `PAG_KEEP_DIR` | [ci.yml](../.github/workflows/ci.yml) | Workflow-level temp paths; the workflow maps them onto `PAG_CACHE` and `PAG_E2E_KEEP` |
| `PAG_HOME` | e2e runner, tests | Set to a temp dir by tests; **no script reads it** |
| `PAG_TEST_NOTE`, `PAG_TEST_NOTE_UNSET`, `PAG_TEST_PW` | unit tests | Test fixtures for `--note-env` and `--password-env` |

Tests also set `PAG_CACHE` to a temp dir so nothing touches the real home. See [development.md](development.md).

## Files

### `port.json`

Created by `pag new`. Only `pag` writes it; the guard denies agent edits (`PORT_JSON_WRITE`). Schema id `port-any-game/port@1`. The reader accepts a UTF-8 BOM.

| Field | Meaning | Written by |
|---|---|---|
| `schema` | `port-any-game/port@1` | `new` |
| `id` | slug of the title guess or folder name; `game-<sha8>` when no ASCII letters or digits. Names `dist/`, the zip, saves and the stable serve port | `new` |
| `name` | display name (store title guess or folder name) | `new` |
| `lane` | lane id (from `--lane` or the verdict) | `new` |
| `data.mode` | `byo`, `bundled` or `bundled-public`. Starts as the lane's first allowed mode | `new`; `pack` sets `bundled-public` after the rights gate passes |
| `data.redistributable` | `true` only when every confident catalog match is redistributable (free-to-share data). Absent otherwise | `new` |
| `tools.node` | Node version used to create the port | `new` |
| `acks` | list of `{id, at, note?}` acknowledgements | `ack` |
| `created_at` | ISO timestamp | `new` |

### `survey.json`

Written by `pag new` (copy of the survey at creation) and by `pag survey --out`. Schema id `port-any-game/survey@1`. Top-level keys:

| Key | Content |
|---|---|
| `schema`, `tool`, `scanned_at` | schema id, `{name, version, rulesets}`, ISO time |
| `target` | `root_id` (salted hash), `label`, `total_bytes`, `file_count`, `largest[5]`, `builds_present` |
| `executables` | up to 100 entries: path, role (`main`, `installer`, `other`), format, machine, subsystem, bytes, sha256, linker, version info, overlay, section entropy, API hits |
| `engines` | detected engines |
| `store` | `steam_appid`, `gog_id`, `title_guess`, `steam_api`, `epic` |
| `protection` | findings with `severity` (`WARN` or `STOP`) |
| `encryption` | always `[]` in M1 |
| `features` | `bitness`, `apis`, `size_class` (`ok` under 300 MiB, `streaming` under 2 GiB, else `hard`) |
| `era` | timestamp and linker of the main exe, `trust: "low"` |
| `catalog_matches` | matches from the catalog (tier, `redistributable`, `needs_confirm`, ports) |
| `skipped`, `truncated` | entries that could not be read; whether the file cap stopped the walk |
| `legal_flags`, `lanes`, `verdict` | from the verdict step: ranked lanes, flags, and `{overall: GO\|HARD\|STOP, primary_lane, reasons, required_acknowledgements}` |

Paths in `survey.json` are relative to the game folder; no absolute paths are stored.
