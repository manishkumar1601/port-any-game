# Development guide

For contributors and maintainers. End-user install and usage are in the [README](../README.md); what issues and pull
requests fit is in [SCOPE.md](../SCOPE.md). Index of all docs: [README.md](README.md).

## Requirements

| Who | Needs |
|---|---|
| Users | Node.js 20.12 or newer (`engines` in [package.json](../package.json)), git, Chrome or Edge for `pag verify`. |
| Development and tests | Node.js 22. The CDP verify runner uses the global `WebSocket`, which Node 22 provides; on older Node the browser cases skip. CI uses Node 22. |
| Browser e2e | Chrome or Edge (or `PAG_BROWSER=<path>`), or Playwright installed with `pag setup playwright --yes`. |

There is nothing to `npm install`: the repo has no dependencies, runtime or dev.

## Repo layout

```
.claude-plugin/          Claude Code plugin manifest + marketplace.json
.codex-plugin/           Codex plugin manifest
agents/                  canonical subagents (Claude format): game-surveyor.md, port-verifier.md
commands/                Claude slash commands: port-status, port-survey, port-verify
hooks/                   hooks.json (Claude exec form), codex.json
com.github.copilot/      GENERATED Copilot agents + hooks (agents/*.agent.md)
opencode/                OpenCode plugin (plugin/), config example; agents/ and commands/ are GENERATED
skills/port-any-game/
  SKILL.md               the agent workflow (<= 500 lines, checked by validate)
  references/            agent-facing runtime docs: legal.md, shell.md, verify.md, lanes/<family>.md
  scripts/               pag.mjs dispatcher + every command (the authoritative behaviour)
    survey/ lanes/ verify/ lib/    survey engine, lane modules, verify tiers, fs/archive helpers
    rules/                 engines.json, protection.json, apis.json (+ NOTICE.md)
    policy.mjs, policy-domains.json, guard.mjs, ack.mjs        defence layers
    toolchain.lock.json    pinned runtime tools (Ruffle, js-dos, EasyRPG, love.js, Ren'Py, Playwright) with sha256 and optional `extras`
  assets/                shell/, launchers/, lanes/, project/, licenses/: files copied into ports
  catalog/               games.json (known ports) + SOURCES.md
  agents/openai.yaml     Codex/OpenAI skill metadata
scripts/                 repo tooling: validate.mjs, gen-wrappers.mjs, install.mjs, pin.mjs
test/                    node:test suites (mirrors scripts/), e2e/run.mjs, fixtures/, reporters/github.mjs
docs/                    this reference; research/, spikes/, adr/, evals/, superpowers/{specs,plans}/
.github/workflows/ci.yml the CI pipeline
```

Notes:

- Folders marked GENERATED are written by [gen-wrappers.mjs](../scripts/gen-wrappers.mjs) from `agents/*.md`. Edit the
  canonical agent (or the generator), run `npm run gen`, commit the output. Details: [agent-integration.md](agent-integration.md).
- `scripts/pin.mjs` refreshes entries in `toolchain.lock.json`; `scripts/install.mjs` is the host installer.
- `memory/` holds the project context, conventions and per-session logs for people and AI agents ([memory/README.md](../memory/README.md); `sessions/` has one file per working session, `dd-mm-yyyy-topic`). Root `CLAUDE.md` and `AGENTS.md` point to it.
- `.superpowers/` (the local build ledger) is excluded from git; do not depend on it.
- Layers and data flow: [architecture.md](architecture.md).

## Code conventions

- **Zero runtime dependencies.** Everything is ESM `.mjs` on the Node standard library. Do not add `node_modules`. When
  a tool is genuinely needed (Ruffle, js-dos, Playwright) it is downloaded by `pag setup` into the cache, pinned and
  sha256-checked in `toolchain.lock.json`, never installed globally.
- **Cross-OS.** Windows, macOS and Linux all run CI. Build paths with `node:path`, never concatenate with `/` or `\`.
  Compare real locations with `realpathSync` (junctions, symlinks, macOS `/var` -> `/private/var`). Use forward slashes
  only when writing manifests or URLs (`.gitattributes` forces LF; `.bat` stays CRLF). Spawn processes without a shell.
- **Comments.** Only when needed, at most one short line. No banner or narrative comments.
- **Deliberate simplifications** are marked `// ponytail: <what is not done and when to revisit>`. Find them with
  `grep -rn "ponytail:" skills scripts`. Current ones: [catalog.mjs](../skills/port-any-game/scripts/catalog.mjs)
  (sha256 not checked for signature tier), [doctor.mjs](../skills/port-any-game/scripts/doctor.mjs) (host detection
  by env markers), [package.mjs](../skills/port-any-game/scripts/package.mjs) (zip built in memory),
  [policy.mjs](../skills/port-any-game/scripts/policy.mjs) (git state only for tracked/staged protected files;
  bounded folder scan). Add one when you knowingly take a shortcut.
- **Exit codes.** `pag` commands export `run(argv) -> exit code`; the dispatcher sets `process.exitCode`.
  0 ok, 1 failed, 2 usage error, 4 refused by policy. `verify` has its own: 0 pass, 1 fail, 2 warnings only, 3 unsupported
  environment; bad arguments exit 1. `survey` exits 4 on a STOP verdict. An unknown command or no command exits 2; `--help` exits 0. See
  [cli.md](cli.md) and [verify.md](verify.md).
- **Fail open for hooks.** `pag guard` and `pag status` run inside host hooks. A load or runtime failure there must not
  break the user's session: the dispatcher catches import errors, prints one line to stderr and exits 0. Copilot hooks
  fail closed on a crash, so a guard crash must still exit 0 silently. Policy decisions themselves (exit 4 / deny) are not
  failures. See [safety-and-policy.md](safety-and-policy.md).
- **Scripts are authoritative.** `SKILL.md` and `references/` tell the agent which command to run; they never
  re-implement or override what a script decides. If a doc and the code disagree, fix the doc. `validate` enforces part of
  this (see below).
- **No game data in the repo.** Fixtures are generated by our own MIT code; never commit or embed game files.

## Tests

```
npm test            # node --test --test-concurrency=1 "test/**/*.test.mjs"
npm run e2e         # node test/e2e/run.mjs all
npm run validate    # node scripts/validate.mjs && node scripts/gen-wrappers.mjs --check
npm run gen         # node scripts/gen-wrappers.mjs
```

### Serial on purpose

`npm test` runs with `--test-concurrency=1`. Many suites launch Chrome, bind local ports, or point `PAG_CACHE` at a temp
dir and set `process.env` for the file; running files in parallel produced port clashes, profile-dir contention and
env leakage. Keep it serial and keep each suite self-cleaning (temp dirs, restored env).

### Skipping the lane e2e: `PAG_E2E=0`

`PAG_E2E=0` turns off every browser lane e2e case (they skip with the message `PAG_E2E=0; browser e2e skipped`). CI sets
it for the unit-test step and runs the lanes once afterwards via `npm run e2e`. The verify/browser unit tests are not
covered by it; they still launch Chrome and need no runtime tools.

### Lane e2e: `npm run e2e`

[test/e2e/run.mjs](../test/e2e/run.mjs) `<lane|all> [--runner cdp|playwright] [--headed]` runs fixture game -> survey ->
`newPort` -> build -> pack -> verify through the real pipeline. Lane ids are the keys of `CASES` (`web-extract`,
`known-port`, `rt-ruffle`, `dos-jsdos`, `rt-easyrpg`, `rebuild-love`, `rebuild-renpy`, `all`). Exit 0 pass or skipped, 1 failure, 2 usage. The lane tests
(`test/lanes/*.test.mjs`) import the same `CASES` and run them under `node:test`, so one case list serves both entry points.

- **Per-run isolation.** `PAG_CACHE` and `PAG_HOME` point at a fresh temp dir; your real cache is never touched. Each case
  gets its own port dir.
- **Shared tool cache.** Runtime tools (Ruffle, js-dos, EasyRPG, love.js, the Ren'Py SDK, Playwright) install once into
  `<os.tmpdir()>/pag-e2e-tools` and are reused by every e2e run on the machine. Pre-seed it by hand with
  `PAG_CACHE=<that dir> node skills/port-any-game/scripts/pag.mjs setup ruffle --yes` (also `jsdos`, `easyrpg`, `love`,
  `playwright`). `pag setup` honours `PAG_CACHE` and otherwise uses `~/.port-any-game`. Deleting the folder just forces
  a re-download.
- **Network failures skip, nothing else does.** A fetch/DNS/timeout error skips the case with a message; a sha256
  mismatch, bad lock entry or extract bug fails loudly.
- **Runners.** `cdp` (default) drives Chrome/Edge directly and needs Node 22. `playwright` needs Playwright in the tool
  cache (`pag setup playwright --yes`); CI runs it headed under Xvfb.

### Fixtures

[test/fixtures](../test/fixtures) holds small generators written for this repo (MIT): `make-web-game.mjs` (NW.js and
Electron style web games), `make-swf.mjs`, `make-dos-com.mjs`, `make-pe.mjs`, `make-asar.mjs`, plus the static `web-game/`,
`lane-test/` and `hook-payloads/`. They produce synthetic content. Never add real game data or assets. [docs/evals/tier1.md](evals/tier1.md)
shows how to generate them by hand.

### Test-only environment variables

| Variable | Effect |
|---|---|
| `PAG_E2E` | `0` skips all browser lane e2e cases. |
| `PAG_E2E_KEEP` | Directory; each e2e case copies its port (with `verify/`) there so CI can upload it on failure. |
| `PAG_E2E_REQUIRE_BROWSER` | `1` makes a skipped browser e2e (no Chrome, no Playwright) exit 1 instead of 0. Skips caused by `PAG_E2E=0` stay 0. |
| `PAG_E2E_TARGET_FPS` | Positive number lowers `verify.target_fps` in the packed `shell.json` of each e2e case (the lower of it and the lane's target; it never raises one). Unset, empty or non-positive means no override. Product thresholds are unchanged. |
| `GITHUB_ACTIONS=true` | e2e failures print a one-line `::error` annotation (whitespace collapsed, 1000 chars max); [verify.e2e.test.mjs](../test/verify/verify.e2e.test.mjs) uses `target_fps` 10 instead of 30. |
| `PAG_CACHE`, `PAG_HOME` | Tests set both to temp dirs. `PAG_CACHE` is also a product variable (tool cache). `PAG_HOME` is only set by tests; no script reads it. |
| `PAG_BROWSER` | Product variable: path to Chrome/Edge; used by doctor tests with a fake binary. |
| `PAG_CHROME_FLAGS` | Product variable: extra Chrome flags; CI sets SwiftShader flags on Linux. |
| `PLAYWRIGHT_BROWSERS_PATH` | Where Playwright keeps browsers; CI points it into the tool cache. |

Tests that touch `HOME`, `USERPROFILE`, `XDG_CONFIG_HOME` or other env save and restore them in `finally`.

### GitHub annotation reporter

[test/reporters/github.mjs](../test/reporters/github.mjs) is a `node:test` reporter that emits one
`::error file=..,line=..,title=<test>::<message>` per failed test (message on one line, 1000 chars max). CI runs it
beside the `spec` reporter. It exists because the job log is not readable without a token while annotations are
(see CI below). `test/e2e/run.mjs` reuses its `annotation()` for failed lane cases.

### Tests that need the OS to block a read

Tests such as the locked-file case in [test/lib/fsx.test.mjs](../test/lib/fsx.test.mjs) make a file unreadable
(Windows: an exclusive-open lock held by a helper PowerShell process; POSIX: `chmod 000`). They then probe by opening it;
if the open succeeds (running as root, or an OS/filesystem that ignores the block) the test calls `t.skip(...)` instead of
asserting. Follow this pattern: prove the precondition, otherwise skip, and always release the lock in `finally`.

## Validation

`npm run validate` = [validate.mjs](../scripts/validate.mjs) then `gen-wrappers.mjs --check`. `validateRepo(root)` is
also unit-tested ([validate.test.mjs](../test/validate.test.mjs)). It checks:

- manifest versions agree (`package.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
  `opencode/plugin/package.json`);
- each `skills/<name>/` has `SKILL.md` with frontmatter keys limited to `name, description, license, compatibility,
  metadata, allowed-tools`; `name` equals the folder; description present and <= 1024 chars; file <= 500 lines;
- `agents/openai.yaml` exists, string values quoted, `short_description` 25-64 chars, `default_prompt` mentions `$<name>`;
- relative markdown links in `SKILL.md` and `references/` resolve;
- every available lane has `references/lanes/<family>.md` and is mentioned in `SKILL.md`; every `pag` command appears in
  `SKILL.md`, and docs mention no `pag` command that does not exist.

`node scripts/gen-wrappers.mjs --check` exits 1 on any drift between `agents/*.md` and the generated Copilot/OpenCode files
(including stale generated files). Fix with `npm run gen` and commit.

## CI

[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every push and pull request with read-only permissions.

**Job `test`** on `windows-latest`, `macos-latest`, `ubuntu-latest` (`fail-fast: false`, 40 min, bash shell, Node 22):

1. Locate the tool cache and keep dir with `node` (`os.tmpdir()` differs per OS) and export `PAG_E2E_TOOLS`, `PAG_KEEP_DIR`.
2. Unit tests with `PAG_E2E=0`, reporters `spec` + `test/reporters/github.mjs`.
3. `node scripts/validate.mjs`, then `node scripts/gen-wrappers.mjs --check`.
4. Restore the tool cache (`actions/cache/restore`, key `e2e-tools-<os>-<hash of toolchain.lock.json>`).
5. `pag setup ruffle --yes` and `pag setup jsdos --yes` into that cache (`PAG_CACHE`).
6. `npm run e2e` with `PAG_E2E_KEEP`, `PAG_E2E_REQUIRE_BROWSER=1` (a runner without Chrome fails rather than skips), and on macOS
   `PAG_E2E_TARGET_FPS=10`.
7. Save the tool cache with `if: always()` when there was no cache hit, so a red first run still keeps downloads.
8. On failure, upload `verify-<os>` with each kept port's `verify/` folder.

`PAG_CHROME_FLAGS` carries SwiftShader flags on Ubuntu (verify adds them itself too).

**Job `playwright tier (ubuntu)`**: `pag setup playwright --yes` into the tool cache (`PLAYWRIGHT_BROWSERS_PATH` inside it),
then `xvfb-run -a node test/e2e/run.mjs web-extract --runner playwright --headed` with `PAG_E2E_REQUIRE_BROWSER=1`.

**fps on hosted runners.** No hosted runner has a GPU. Linux uses SwiftShader and Windows holds the default target of 30,
but the macOS VM renders the fixtures at about 14 fps, so CI sets `PAG_E2E_TARGET_FPS=10` there (R68, see
[decisions.md](decisions.md)). [verify.e2e.test.mjs](../test/verify/verify.e2e.test.mjs) uses 10 when `GITHUB_ACTIONS` is set.
The override changes the fixture's `shell.json` only; the product default is untouched.

**Reading a failure without a token.** The raw job log needs auth, check-run annotations do not. The failed tests'
`::error` lines become annotations on the check run:

```
gh api repos/<owner>/<repo>/commits/<sha>/check-runs --jq '.check_runs[] | {name, conclusion, id}'
gh api repos/<owner>/<repo>/check-runs/<id>/annotations --jq '.[] | {title, message}'
```

Or `curl https://api.github.com/repos/<owner>/<repo>/check-runs/<id>/annotations` for a public repo. Annotations carry the
full one-line message (verify failures embed the failing check JSON). The `verify-<os>` artifact has the reports.

## Release gates

1. A green CI run on the release commit: all three `test` jobs and the `playwright` job.
2. The manual tier-1 agent eval in [docs/evals/tier1.md](evals/tier1.md): each Tier 1 agent (Claude Code, Codex, OpenCode) on
   each OS takes a fixture game to a passing `pag verify` in 5 user touchpoints or fewer. Record the results table there.

Milestone status: [roadmap.md](roadmap.md). Versions in the manifests must match (`validate` enforces it).

## Git workflow

- Work on `master`. Commit and push after each completed task so another machine or agent can pick up from `origin`.
- Conventional commit messages (`feat:`, `fix:`, `ci:`, `docs:`, `test:`, `refactor:`), subject in the imperative, one change
  per commit.
- Never force-push or rewrite pushed history.
- No AI co-author trailers or "generated by" lines in commits.
- Run `npm test` (with `PAG_E2E=0` for speed) and `npm run validate` before pushing; confirm CI is green afterwards.

## How to extend

### A new `pag` command

1. Create `skills/port-any-game/scripts/<name>.mjs` exporting `run(argv)` that returns an exit code (use `parseArgs` from
   `node:util`; usage errors return 2; policy refusals 4).
2. Add one line to `COMMANDS` in [pag.mjs](../skills/port-any-game/scripts/pag.mjs): `name: () => import('./<name>.mjs'),`.
   If it runs in a hook, add the fail-open `.catch` like `status` and `guard`.
3. Mention `pag <name>` in `SKILL.md` (validate fails otherwise) and add a `test/<name>.test.mjs`.
4. Document it in [cli.md](cli.md).

### A new lane

Add a module under `skills/port-any-game/scripts/lanes/`, register it in `lanes/index.mjs`, add `references/lanes/<family>.md`
and mention it in `SKILL.md` (validate checks all three for available lanes), add e2e cases to `LANE_CASES` in `test/e2e/run.mjs`
and a `test/lanes/<lane>.test.mjs`. The lane contract, ladder and rung ordering are in [lanes.md](lanes.md).

### A new host

Add the host's manifest or wrapper format to [gen-wrappers.mjs](../scripts/gen-wrappers.mjs) (output is generated, never hand
written), teach [install.mjs](../scripts/install.mjs) its location, add a hook file if the host has hooks, then extend the
generator and install tests. Verified versus unverified routes and the hook payload formats are in
[agent-integration.md](agent-integration.md).

### A catalog entry or survey rule

Known-port entries go in `skills/port-any-game/catalog/games.json` with a source noted in `catalog/SOURCES.md`; engine,
protection and API signatures go in `scripts/rules/*.json`. Add a test beside `test/catalog.test.mjs` or `test/survey/`.
Rule shape, verdicts and catalog tiers: [survey-and-catalog.md](survey-and-catalog.md).

## Troubleshooting

- **Windows PowerShell 5.1 strips `"` from native-command arguments.** `pag ack ID --note="he said "no""` loses the quotes.
  Put the words in an environment variable and pass `--note-env VAR` (never both `--note` and `--note-env`); the shell then
  never parses them. See [ack.mjs](../skills/port-any-game/scripts/ack.mjs).
- **Junctions and symlinks.** A script run through a linked path must still detect that it is the main module: compare
  `realpathSync(process.argv[1])` with `fileURLToPath(import.meta.url)` (as [validate.mjs](../scripts/validate.mjs) and
  `gen-wrappers.mjs` do), not the raw strings. The same applies to any path comparison: realpath both sides.
- **GPU-less runners and fps.** A low-fps `verify` failure on a VM or CI box is usually the missing GPU, not the port. Locally
  use `PAG_E2E_TARGET_FPS` for e2e cases, or on Linux `PAG_CHROME_FLAGS="--use-angle=swiftshader --enable-unsafe-swiftshader"`.
  Never lower the product threshold to make a runner pass.
- **Stale `pag-verify-*` profile dirs.** `verify` starts Chrome with a temp profile `<os.tmpdir()>/pag-verify-XXXX` and deletes
  it on exit. A hard kill leaves it behind (on Windows, a lingering `chrome.exe` can also hold it). Kill leftover browsers
  and delete those folders by hand.
- **Locked-file test skipped.** Expected when running as root or on a filesystem that ignores the block; see above.
- **Browser e2e skipped locally.** Read the skip message: no Chrome (`PAG_BROWSER`), Node below 22, Playwright missing from
  the tool cache, or a failed download (offline).
