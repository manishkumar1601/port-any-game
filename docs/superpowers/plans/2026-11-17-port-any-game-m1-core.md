# port-any-game M1 (core + Tier 1 packaging + first lanes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, cross-agent `port-any-game` skill/plugin. It surveys any PC game folder and matches it against a catalog of known ports. It builds three lanes (`web-extract`, `rt-ruffle`, `dos-jsdos`) into the shared web shell, verifies them in the user's own Chrome/Edge, and hands them over with double-click launchers. It installs in Claude Code, Codex, OpenCode, Copilot and any skills-only agent, on Windows, macOS and Linux.

**Architecture:**
- One Agent-Skills-spec skill (`skills/port-any-game/`) carries the workflow, a zero-dependency Node CLI (`scripts/pag.mjs`), the browser shell assets, the detection rules and the catalog.
- Thin per-agent wrappers (manifests, hooks, subagents, commands, the OpenCode plugin) call the same CLI.
- `policy.mjs` is the single, authoritative guardrail used by every command and every hook.

**Tech Stack:**
- Node ≥ 20 (CI on 22), ESM `.mjs`, `node:test`, `node:http`, `node:zlib`, global `WebSocket` and `fetch`.
- Plain browser ES modules for the shell.
- Chrome DevTools Protocol to the installed Chrome/Edge, with Playwright 1.65.x as an optional fallback.
- Ruffle self-hosted web build and js-dos 8.x as lane runtimes.

**Spec:** `docs/superpowers/specs/2026-11-17-port-any-game-design.md` (approved rev 2). Research notes: `docs/research/01`–`08`.

**Scope of this plan:**
- In scope: spec §16 M1, plus the M0 spikes (a)–(e) that M1 depends on.
- Not in scope: spikes (f)–(j) and milestones M2–M6. Each gets its own plan after M1.

**Deliberate narrowing vs the spec**, each kept for its later plan:

| What | M1 scope | Later |
|---|---|---|
| `web-extract` | `bundled` data only | BYO through a service worker comes with the shims (M2 plan) |
| `known-port` | A *route* lane: it reports the existing BYO web port and its data files, and builds nothing | Self-hosting those engines needs the prebuilt-runtime CI (M2 plan) |
| Detection rules | A hand-curated subset in JSON, attributed to SteamDB / Detect It Easy / BinaryObjectScanner | The full rule compiler (M2 plan) |
| Catalog | The 32 hand-verified BYO ports from note 07 §4 | Seed importers for OSGameClones / Wikidata / PortMaster / libretro (M2 plan) |
| Session-start status hook | Claude Code and Codex only | Copilot and OpenCode, once spike (b)/(c) confirm their output formats |

## Global Constraints

- **Runtime:**
  - Node ≥ 20; CI runs Node 22.
  - Every script is ESM `.mjs`, run as `node <abs path>/pag.mjs …`. Never rely on a shebang, the execute bit or a `.cmd` shim.
- **Dependencies:**
  - zero npm runtime dependencies;
  - `package.json` has no `dependencies`;
  - Playwright is only `import()`ed from the tool cache when the fallback runner is chosen.
- **Tests:** `node --test test/` with `node:test` + `node:assert/strict`, no test framework. Browser end-to-end tests need a Chromium-family browser and skip with a clear message if none is found.
- **OS:**
  - Every path is built with `node:path`.
  - Child processes are spawned without `shell: true`.
  - All code and tests run on `windows-latest`, `macos-latest` and `ubuntu-latest`.
- **Survey:**
  - never executes anything from the game folder;
  - reads at most the first and last 65,536 bytes per file, plus ≤ 4 MiB of header/import ranges per executable;
  - hashes executables fully and files over 256 MiB partially (first + last 1 MiB, marked `partial`);
  - stores only relative paths; the absolute root goes in as `root_id` = SHA-256 of (salt + absolute path), salt in `<cacheDir>/salt`;
  - makes no network calls.
- **Skill frontmatter:**
  - only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`;
  - `name` equals its folder name;
  - `description` ≤ 1,024 characters;
  - `SKILL.md` ≤ 500 lines.
- **`agents/openai.yaml`:**
  - `short_description` 25–64 characters;
  - `default_prompt` contains `$port-any-game`;
  - every string value quoted.
- **Headers** (`_headers` and `serve`): exactly the block in spec §8 / note 05 §9a. COOP `same-origin` + COEP `require-corp` only when `shell.json.needs_coi` is true; never `credentialless`.
- **Verify thresholds** (note 05 §7c):

  | Check | Value |
  |---|---|
  | Blank frame | near-black ratio ≥ 0.98 (luma < 8/255) or luma std < 2 |
  | Frozen | mean abs diff < 0.5/255 across the window and none within 3 s after input |
  | FPS | pass ≥ 0.9 × target, warn ≥ 0.5 × target |
  | Audio | pass when RMS ≥ 0.001 |
  | Memory growth | pass < 5 %/min, warn 5–10 %/min, fail > 10 %/min |
  | Ready time | pass ≤ 15 s cached; timeout 120 s first run / 30 s cached |

- **Privacy:**
  - no telemetry anywhere;
  - `serve` binds `127.0.0.1` unless `--lan` with `--password` is given;
  - every response carries `X-Robots-Tag: noindex`;
  - verify fails BYO lanes on any request with a body or any cross-origin request.
- **Legal:** policy refusals from spec §11 apply in code, not only in prose. Never vendor GPL code. Never put game data or game-data URLs in the repo, fixtures or catalog.
- **Git:**
  - commit locally at the end of each task with conventional messages;
  - **no `Co-Authored-By: Claude` (or any Claude/Anthropic) trailer, author or mention**;
  - **never push** until the maintainer says so.
- **Licence:** MIT for the plugin. Vendored MIT rule data keeps its notice in `skills/port-any-game/scripts/rules/NOTICE.md`.

## Review Focus

Each line names an input class the spec implies but no feature test covers. The pinning test is added to the owning task.

1. **Game paths with spaces, Unicode and Windows long paths**, e.g. `C:\Program Files (x86)\Steam\steamapps\common\Gamé Ñame`. `survey`, `new`, `serve` and `verify` work unchanged. Tests: Task 8 `survey handles unicode/space paths`, Task 11 `new links unicode game dir`, Task 12 `serves percent-encoded unicode names`.
2. **Huge or partly unreadable installs** (100k files, permission-denied files, broken symlinks, locked files on Windows). The survey finishes, lists them under `skipped[]`, never throws, and stops walking at `maxFiles` with `truncated: true`. Test: Task 8 `survey skips unreadable and broken entries and caps file count`.
3. **Case mismatches** in games authored on Windows (`Img/Title.PNG` requested, `img/title.png` on disk). `serve` falls back case-insensitively for bundled builds and logs each fallback; verify lists 404s. Tests: Task 12 `case-insensitive fallback for bundled`, Task 16 `web-extract fixture with mixed-case refs passes`.
4. **No usable Chromium-family browser** (macOS with only Safari, minimal Linux, a locked-down Edge). `doctor` reports it; `verify --runner auto` falls back to Playwright if it is cached, else exits with code 3 "unsupported environment", never "fail". Test: Task 14 `verify exits 3 when no browser and no playwright`.
5. **Re-running and interrupted runs:**
   - `setup` after a partial download resumes from `.part` and re-verifies SHA-256;
   - `new` on an existing port folder refuses unless `--resume`, which keeps `port.json` and `PORTING_LOG.md`;
   - an interrupted shell import resumes from per-file completion markers.

   Tests: Task 10 `setup resumes partial download and rejects bad hash`, Task 11 `new refuses existing port without --resume`, Task 17 e2e `rt-ruffle import resumes after interrupted import` (web-extract is bundled-only in M1, so import runs only on BYO lanes).

---

## File structure

```
package.json                     private, "type":"module", engines.node ">=20", scripts: test, validate, build, e2e. No dependencies
LICENSE  README.md  SCOPE.md  docs/adr/0001-flat-plugin-layout.md
.claude-plugin/plugin.json       Claude plugin manifest (skills: ["./skills/port-any-game"])
.claude-plugin/marketplace.json  self-hosted marketplace, plugin source "./"
plugin.json                      Agent Plugins 1.0.0 manifest (Codex/Copilot/Cursor/Kiro), only if spike (a) passes
.github/workflows/ci.yml         3-OS matrix: unit, validate, e2e
agents/game-surveyor.md  agents/port-verifier.md          canonical subagents (Claude format)
commands/port-survey.md  commands/port-verify.md  commands/port-status.md
hooks/hooks.json                 Claude hooks → pag.mjs guard|status --host=claude
hooks/codex.json                 Codex hooks (referenced from plugin.json extensions."com.openai".hooks)
com.github.copilot/hooks/hooks.json   Copilot hooks (bash + powershell → node … guard --host=copilot)
com.github.copilot/agents/*.agent.md  GENERATED by scripts/gen-wrappers.mjs
opencode/agents/*.md  opencode/commands/port-game.md  opencode/plugin/{package.json,index.js}  opencode/opencode.jsonc.example
                                 agents/commands GENERATED; plugin hand-written
scripts/validate.mjs             repo contract checks
scripts/gen-wrappers.mjs         generate per-agent variants; --check fails on drift
scripts/install.mjs              per-agent installer (--host=opencode|skills [--global] [--project <dir>])
scripts/pin.mjs                  maintenance: download URL, print sha256 + size for toolchain.lock.json
skills/port-any-game/
  SKILL.md  agents/openai.yaml
  references/{lanes/web-extract.md, lanes/known-ports.md, lanes/runtimes.md, lanes/dos.md, shell.md, verify.md, legal.md}
  catalog/games.json  catalog/SOURCES.md
  assets/shell/{index.html, shell.css, shell.js, import.js, storage.js, input.js, audio.js, zip.js}
  assets/lanes/{web-extract,rt-ruffle,dos-jsdos}/adapter.js
  assets/project/{AGENTS.md, CLAUDE.md, gitignore, PORTING_LOG.md, githooks/pre-commit, githooks/pre-push, githooks/check-staged.mjs}
  assets/launchers/{Play-Windows.bat, Play-macOS.command, Play-Linux.sh, serve-standalone.mjs}
  scripts/
    pag.mjs                      CLI dispatcher (node:util parseArgs)
    lib/fsx.mjs                  walk, bounded reads, hashing, root id, cache dir
    lib/archive.mjs              zip read (store+deflate), tar.gz read, asar read
    survey/pe.mjs                MZ / NE / LE / PE32 / PE32+ / CLR / overlay / rsrc ProductName
    survey/engines.mjs           engine fingerprints from rules/engines.json
    survey/protection.mjs        DRM / protector / packer / anti-cheat / pirated from rules/protection.json
    survey/identity.mjs          steam_appid, appmanifest, goggame-*.info, title guess
    survey/verdict.mjs           lane scoring + STOP rules
    survey/survey.mjs            orchestration → survey.json (schema port-any-game/survey@1)
    rules/{engines.json, protection.json, apis.json, NOTICE.md}
    catalog.mjs                  load + 4-tier matching
    lanes/index.mjs  lanes/web-extract.mjs  lanes/known-port.mjs  lanes/rt-ruffle.mjs  lanes/dos-jsdos.mjs  lanes/stubs.mjs
    policy.mjs  guard.mjs  status.mjs  doctor.mjs  setup.mjs  toolchain.lock.json
    new.mjs  build.mjs  pack.mjs  serve.mjs  package.mjs
    verify/browser.mjs  verify/cdp.mjs  verify/driver-cdp.mjs  verify/driver-playwright.mjs  verify/checks.mjs  verify/instrument.js  verify/verify.mjs
test/                            mirrors scripts/ (*.test.mjs)
test/fixtures/make-pe.mjs  make-dos-com.mjs  make-swf.mjs  make-web-game.mjs  make-asar.mjs  web-game/  lane-test/adapter.js
test/e2e/run.mjs                 builds fixtures → new → build → pack → verify, per lane
docs/spikes/                     spike notes (Tasks 2–3)
docs/evals/tier1.md              manual fresh-machine agent eval procedure
```

---

### Task 1: Repository skeleton and contract validator

**Files:**
- Create: `package.json`, `LICENSE` (MIT, holder "port-any-game contributors"), `README.md` (title, one paragraph, a `<!-- install-block -->` … `<!-- /install-block -->` region left empty for Task 22), `SCOPE.md` (contribution bar: a report must describe a real porting failure: game type, lane, phase, observed vs expected), `docs/adr/0001-flat-plugin-layout.md` (spec §13 + note 08 rationale), `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/port-any-game/SKILL.md` (frontmatter + one-line placeholder body), `skills/port-any-game/agents/openai.yaml`, `scripts/validate.mjs`
- Test: `test/validate.test.mjs`

**Interfaces:**
- Produces: `validateRepo(rootDir: string) → string[]` (error messages; empty = valid), exported from `scripts/validate.mjs`. CLI: `node scripts/validate.mjs` exits 1 and prints the errors when any exist.

Manifest values:
- `.claude-plugin/plugin.json` = `{"name":"port-any-game","version":"0.1.0","description":…,"license":"MIT","repository":"https://github.com/<org>/port-any-game","skills":["./skills/port-any-game"]}`.
- `marketplace.json` = `{"name":"port-any-game","owner":{"name":"port-any-game contributors"},"plugins":[{"name":"port-any-game","source":"./","description":…}]}`.
- `openai.yaml`: exactly the file in note 06 §6, without the icon lines until icons exist.

- [ ] **Step 1: Write failing tests** in `test/validate.test.mjs`, each building a temp repo from a fixture copy:
  - `accepts the real repo` (`validateRepo(repoRoot)` deep-equals `[]`);
  - `rejects extra frontmatter key` (adding `version:` to SKILL.md yields an error containing `unsupported frontmatter key "version"`);
  - `rejects name/folder mismatch`;
  - `rejects description over 1024 chars`;
  - `rejects SKILL.md over 500 lines`;
  - `rejects short_description outside 25-64`;
  - `rejects default_prompt without $port-any-game`;
  - `rejects version drift` (`package.json` version ≠ `plugin.json` version);
  - `rejects broken relative link in references`.
- [ ] **Step 2:** Run `node --test test/validate.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `validateRepo`. Frontmatter is parsed as simple `key: value` YAML lines between `---` fences; no YAML library.
- [ ] **Step 4:** Run `node --test test/validate.test.mjs && node scripts/validate.mjs`. Expected: all PASS, exit 0.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "chore: repo skeleton, manifests and contract validator"`

---

### Task 2: Spikes for runtime pieces: CDP over Node WebSocket, js-dos bundle

Spike tasks produce a written verdict, not product code. Throwaway scripts live in `docs/spikes/scratch/`, which is git-ignored.

**Files:**
- Create: `docs/spikes/d-cdp-verify.md`, `docs/spikes/e-jsdos-bundle.md`, `.gitignore` entry `docs/spikes/scratch/`

**Interfaces:**
- Produces, for Task 14:
  - the confirmed launch flags;
  - how to find the DevTools port (`DevToolsActivePort` file in `--user-data-dir`);
  - whether `Page.captureScreenshot` of WebGL/2D canvases works headless on each OS;
  - whether `Page.addScriptToEvaluateOnNewDocument` reaches same-origin iframes.
- Produces, for Task 18: the exact js-dos 8.x embedding API (`Dos(element, { url | bundle bytes })`), its CSS/JS file list, and whether it needs COOP/COEP.

- [ ] **Step 1:** On each available OS (at least the dev machine, plus GitHub CI for the other two via a temporary workflow), launch the installed Edge or Chrome with:
  - `--headless=new --remote-debugging-port=0 --user-data-dir=<tmp> --no-first-run --no-default-browser-check`;
  - throttling off: `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`.

  Connect with the global `WebSocket`; navigate to a page with an animated 2D canvas and a WebGL canvas; capture 3 screenshots; read console messages. Record the results per OS in `d-cdp-verify.md`, with a **yes/no** answer to "CDP tier viable as default".
- [ ] **Step 2:** Build a `.jsdos` zip by hand (`.jsdos/dosbox.conf` with `[autoexec]` `mount c .` / `c:` / `ANIM.COM`) for the Task 18 fixture program. Load it in a page from the npm `js-dos@8.5.4` dist files, served locally with and without COOP/COEP. Record the API calls, required files, header needs and a **yes/no** answer to "js-dos lane viable without its MCP".
- [ ] **Step 3:** Commit: `git add docs/spikes .gitignore && git commit -m "docs: spikes d (CDP verify) and e (js-dos bundle)"`

**If spike (d) says no:** Task 14 makes Playwright the default runner and the CDP driver experimental. No other task changes.

---

### Task 3: Spikes for agent packaging: flat layout, hooks on Windows, OpenCode guard

Needs a maintainer machine with the agent CLIs installed: Claude Code, Codex, Copilot CLI, OpenCode 2.3.x and 1.19.x. It can run in parallel with Tasks 4–13.

**Files:**
- Create: `docs/spikes/a-layout-coexistence.md`, `docs/spikes/b-hooks-windows.md`, `docs/spikes/c-opencode-guard.md`

**Interfaces:**
- Produces, for Task 22:
  - whether a root `plugin.json` (Agent Plugins 1.0.0) can sit next to `.claude-plugin/` without breaking Claude, Codex, Copilot or Cursor installs;
  - the exact working hook config and stdin payload samples for Codex and Copilot on Windows, saved as JSON files under `test/fixtures/hook-payloads/<host>-<event>.json`;
  - OpenCode v2/v1 guard behaviour and its payload samples.

- [ ] **Step 1:** In a scratch copy of the Task 1 repo with a no-op `guard` that logs stdin to a file:
  - install via `claude plugin marketplace add <path>` and the Codex, Copilot and Cursor equivalents (note 01 §7.1);
  - record which manifests each agent reads, any warnings, and a **yes/no** answer to "root plugin.json safe".
- [ ] **Step 2:** On Windows, trigger one Bash/shell tool call in Codex and in Copilot with the logging hook. Save the payloads. Record:
  - the shell used;
  - how `PLUGIN_ROOT` resolves (`${…}`, `%…%`, `$env:…`);
  - whether exit 2 / JSON deny blocks.
- [ ] **Step 3:** Install a minimal `opencode/plugin/index.js` (the dual v1/v2 shape from note 06 §5.3) in OpenCode 2.3.x and 1.19.x. Confirm that a sample command (`steamless.exe x`) is denied, and save the payloads.
- [ ] **Step 4:** Commit: `git add docs/spikes test/fixtures/hook-payloads && git commit -m "docs: spikes a, b, c for agent packaging"`

---

### Task 4: File-system and archive primitives

**Files:**
- Create: `skills/port-any-game/scripts/lib/fsx.mjs`, `skills/port-any-game/scripts/lib/archive.mjs`, `skills/port-any-game/assets/shell/zip.js`
- Test: `test/lib/fsx.test.mjs`, `test/lib/archive.test.mjs`, `test/shell/zip.test.mjs`

**Interfaces:**
- Produces from `fsx.mjs`:
  - `cacheDir() → string`: `PAG_CACHE` env, else `~/.port-any-game`; created if missing.
  - `walk(root, {maxFiles = 200000}) → AsyncGenerator<{rel: string (forward slashes), abs: string, size: number, isSymlink: boolean, error?: string}>`. Yields entries with `error` instead of throwing. After `maxFiles` it yields one `{rel: "", truncated: true}` and stops.
  - `readHeadTail(abs, size, n = 65536) → Promise<{head: Buffer, tail: Buffer}>`.
  - `readRange(abs, offset, length) → Promise<Buffer>`.
  - `sha256File(abs, size) → Promise<{sha256: string, partial: boolean}>`: partial when size > 256 MiB.
  - `rootId(absRoot) → string`.
- Produces from `archive.mjs`:
  - `listZip(buf: Buffer) → Array<{name, size, method, offset}>`;
  - `extractZip(zipPath, destDir) → Promise<string[]>`, which rejects entries that escape `destDir` (zip-slip);
  - `extractTarGz(path, destDir, {strip = 0}) → Promise<string[]>`;
  - `readAsar(path) → {files: Array<{path, size, offset}>, read(path) → Buffer}`;
  - `extractAsar(path, destDir) → Promise<string[]>`.
- Produces from `zip.js` (isomorphic, browser + Node): `createZip(entries: Array<{name: string, data: Uint8Array, mode?: number}>) → Uint8Array`. Store method, CRC-32; `mode` sets `external_attr = (0o100000 | mode) << 16`.

- [ ] **Step 1: Write failing tests:**
  - `walk yields relative forward-slash paths`;
  - `walk reports unreadable entry with error` (POSIX `chmod 000`; Windows: open the file with an exclusive lock from a child process);
  - `walk truncates at maxFiles`;
  - `sha256File partial over 256MiB` (sparse file via `ftruncate`);
  - `createZip round-trips through extractZip`;
  - `createZip sets 0755 external attr`;
  - `extractZip rejects ../ entries`;
  - `extractTarGz strips leading component`;
  - `readAsar reads a file from asar built by test/fixtures/make-asar.mjs`.
- [ ] **Step 2:** Run `node --test test/lib test/shell`. Expected: FAIL.
- [ ] **Step 3:** Implement. Notes:
  - zip deflate entries use `zlib.inflateRawSync`;
  - asar layout: 16-byte pickle prefix, then a UInt32LE JSON header length at offset 12, JSON header, files at `8 + headerPickleSize`. Confirm against `@electron/asar` docs and record the source in a comment.
- [ ] **Step 4:** Run `node --test test/lib test/shell`. Expected: PASS on all 3 OSes in CI.
- [ ] **Step 5:** Commit: `git commit -m "feat: fs, hashing and archive primitives"`

---

### Task 5: Executable parser (MZ / NE / LE / PE32 / PE32+ / CLR / overlay)

**Files:**
- Create: `skills/port-any-game/scripts/survey/pe.mjs`, `test/fixtures/make-pe.mjs`
- Test: `test/survey/pe.test.mjs`

**Interfaces:**
- Consumes: `readRange`, `readHeadTail` (Task 4).
- Produces: `parseExecutable(abs: string, size: number) → Promise<ExeInfo | null>` (null = not an executable). `ExeInfo` fields:
  - `format: 'MZ'|'NE'|'LE'|'LX'|'PE32'|'PE32+'|'ELF'|'MachO'`;
  - `machine: 'i386'|'amd64'|'arm64'|'other'|null`;
  - `subsystem: 'gui'|'console'|'other'|null`;
  - `clr: boolean`;
  - `sections: Array<{name, rawSize, entropy}>`;
  - `imports: string[]` and `delayImports: string[]` (lower-case DLL names);
  - `dllStrings: string[]` (lower-case `*.dll` names found in `.rdata`/`.data`, minus imported ones);
  - `overlay: {offset, bytes, magic: 'swf'|'zip'|'ags-clib'|'pyinstaller'|'godot-pck'|'clickteam'|null} | null`;
  - `linker: string|null` (`"6.0"`);
  - `timestamp: string|null` (ISO date, "low trust");
  - `productName: string|null` (from `.rsrc` VS_VERSIONINFO, UTF-16LE scan).
- Produces `test/fixtures/make-pe.mjs`:
  - `makePE({machine, subsystem, imports: Record<dll, string[]>, delayImports?, sections?: Array<{name, size, fill?: 'zero'|'random'}>, clr?, overlay?: Buffer, productName?}) → Buffer`;
  - `makeMZ(code: Buffer) → Buffer`;
  - `makeNE() → Buffer`.

- [ ] **Step 1: Write failing tests:**
  - `detects DOS MZ without PE`;
  - `detects NE`;
  - `parses PE32 imports d3d8.dll dsound.dll`;
  - `parses PE32+ imports with 8-byte thunks`;
  - `reads delay imports`;
  - `flags CLR header` (`clr === true`, `imports` contains `mscoree.dll`);
  - `finds dllStrings not in imports` (fixture section containing `"d3d9.dll\0"` → `dllStrings` includes `d3d9.dll`);
  - `detects SWF projector overlay` (overlay = `FWS…` + trailer `56 34 12 FA` + uint32 length → `magic === 'swf'`);
  - `computes high entropy for random section > 7.5`;
  - `reads productName`;
  - `returns null for non-executable`;
  - `never reads more than 4 MiB` (instrumented `readRange` sums ≤ 4,194,304 for a 50 MB fixture).
- [ ] **Step 2:** Run `node --test test/survey/pe.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `parseExecutable`: bounded random-access reads via `readRange`, and Shannon entropy over at most 1 MiB per section.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(survey): executable parser"`

---

### Task 6: Engine, API, protection and identity rules

**Files:**
- Create: `skills/port-any-game/scripts/survey/engines.mjs`, `skills/port-any-game/scripts/survey/protection.mjs`, `skills/port-any-game/scripts/survey/identity.mjs`, `skills/port-any-game/scripts/rules/{engines.json,protection.json,apis.json,NOTICE.md}`
- Test: `test/survey/rules.test.mjs`

**Interfaces:**
- Consumes: `ExeInfo` (Task 5), `walk` entries, `readHeadTail`.
- Produces:
  - `detectApis(exes: ExeInfo[]) → {graphics: Array<{id, via:'import'|'delay'|'dynamic'}>, audio, input, video, network}`, using `apis.json` (DLL → category + id, from note 04 §A.2);
  - `detectEngines(files, exes, readHeadTail) → Array<{id, family, version: string|null, confidence: number, evidence: string[]}>`, sorted by confidence;
  - `detectProtection(files, exes) → Array<{id, class: 'DRM'|'PROTECTOR'|'PACKER'|'ANTI_CHEAT'|'LAUNCHER'|'PIRATED', severity: 'STOP'|'WARN', evidence: string[]}>`;
  - `detectIdentity(files, readHeadTail) → {steam_appid: string|null, gog_id: string|null, title_guess: string|null}`.
- Rule JSON shape (both files): `{"id", "family"?, "class"?, "severity"?, "files"?: [regexSource], "magic"?: [{"file": regexSource, "offset": number|"tail", "hex": string}], "sections"?: [name], "imports"?: [dll], "overlay"?: magic, "version"?: {"file", "regex"}, "source": "steamdb|die|bos|local"}`.
- `engines.json` covers at least these ids:
  - `nwjs`, `electron`, `rpgmaker-mv`, `rpgmaker-mz`, `construct`, `gdevelop`, `twine`;
  - `flash-swf`, `flash-projector`;
  - `dos`, `dosbox-wrapper`;
  - `unity-mono`, `unity-il2cpp`, `unreal`, `godot`, `gamemaker`, `renpy`;
  - `rpgmaker-2k`, `rpgmaker-xp-vx`, `ags`, `love`, `java`, `xna-fna-monogame`;
  - `idtech-doom`, `idtech-quake`, `build`, `goldsrc`;
  - `scummvm-candidate`, `popcap-sexyapp`, `native-win32`.
- `protection.json` covers at least these ids:
  - STOP: `steamstub` (`.bind` section), `securom`, `safedisc`, `starforce`, `themida`, `vmprotect`, `enigma`, `asprotect`, `easyanticheat`, `battleye`, `pirated-steam-emu` (`steam_emu.ini`, `SmartSteamEmu*`, `steam_settings/`);
  - WARN: `upx`, `steam-api` (`steam_api*.dll` alone).

- [ ] **Step 1: Write failing tests**, each on a temp folder built in-test:
  - `NW.js folder → nwjs + rpgmaker-mv` (`nw.dll` + `www/js/rpg_core.js`);
  - `Electron app.asar → electron`;
  - `projector overlay → flash-projector`;
  - `MZ-only exe → dos`;
  - `UnityPlayer.dll + GameAssembly.dll → unity-il2cpp`;
  - `.pck with GDPC magic → godot`;
  - `RPG_RT.ldb → rpgmaker-2k`;
  - `DOOM.WAD IWAD magic → idtech-doom`;
  - `.bind section → steamstub STOP`;
  - `steam_api.dll alone → steam-api WARN, not STOP`;
  - `UPX0/UPX1 → upx WARN`;
  - `.NET exe with 1 import is not packed` (no PACKER entry for a CLR image);
  - `steam_emu.ini → pirated-steam-emu STOP`;
  - `steam_appid.txt → steam_appid`;
  - `goggame-1207658924.info → gog_id "1207658924"`;
  - `ProductName → title_guess`;
  - `d3d9 via dllStrings → graphics d3d9 dynamic`.
- [ ] **Step 2:** Run `node --test test/survey/rules.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Write the rules and detectors. Regexes are JS-compatible (no possessive or atomic groups). `NOTICE.md` credits SteamDB FileDetectionRuleSets, Detect It Easy and SabreTools BinaryObjectScanner (MIT), each with its pinned commit hash.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(survey): engine, api, protection and identity rules"`

---

### Task 7: Catalog and matching

**Files:**
- Create: `skills/port-any-game/catalog/games.json`, `skills/port-any-game/catalog/SOURCES.md`, `skills/port-any-game/scripts/catalog.mjs`
- Test: `test/catalog.test.mjs`

**Interfaces:**
- Produces:
  - `loadCatalog() → Catalog` (`{schema: 'port-any-game/catalog@1', games: Game[]}`);
  - `matchCatalog(catalog, {identity, files, engines}) → Array<{game_id, tier: 'store'|'signature'|'engine'|'title', needs_confirm: boolean, ports: Port[]}>`, ordered store > signature > engine > title.
- `Game` = `{id, title, ids: {steam?: string[], gog?: string[]}, signatures: Array<{path: regexSource, size?: number, sha256?: string}>, engines?: string[], redistributable_data?: boolean (true only for freeware/open data whose licence allows redistribution; read by pack for bundled-public), ports: Port[]}`.
- `Port` = `{name, kind: 'byo-web'|'reimpl-web', url, license, data_files: string[], legal_risk: 'low'|'medium'|'high', verified_at: 'YYYY-MM-DD', notes?}`.
- Matching rules:
  - `title` matches always have `needs_confirm: true`;
  - `legal_risk: 'high'` ports are kept but flagged;
  - **no field may contain a game-data download URL**: a test rejects `url` values whose path ends in `.wad|.pak|.pk3|.mpq|.grp|.dat|.iso|.zip`.
- Seed `games.json` with the community BYO ports from note 07 §4 that are marked live and licensed. `SOURCES.md` states that entries are hand-curated facts with links, plus their verification dates.

- [ ] **Step 1: Write failing tests:**
  - `catalog has schema and >= 25 games`;
  - `matches by steam appid`;
  - `matches by signature files`;
  - `engine-only match is tier engine`;
  - `fuzzy title needs_confirm`;
  - `no port url points at game data`;
  - `every port has license, legal_risk, verified_at`;
  - `high legal_risk is flagged`.
- [ ] **Step 2:** Run `node --test test/catalog.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `catalog.mjs` and write `games.json`. Fuzzy title compares normalized strings (lower-case, alphanumerics only) and requires an exact token-set match; nothing fancier.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: offline known-port catalog and matcher"`

---

### Task 8: Lane registry, verdict and `pag survey`

**Files:**
- Create:
  - `skills/port-any-game/scripts/lanes/index.mjs`;
  - `skills/port-any-game/scripts/lanes/stubs.mjs` (descriptors for every spec §6 lane not built in M1: `available: false` + `milestone`);
  - `skills/port-any-game/scripts/survey/verdict.mjs`;
  - `skills/port-any-game/scripts/survey/survey.mjs`;
  - `skills/port-any-game/scripts/pag.mjs`.
- Test: `test/survey/survey.test.mjs`, `test/pag.test.mjs`

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces `LaneModule` = `{id, rung: number, available: boolean, milestone: string, dataModes: string[], acks: string[], checklist: string[] (PORTING_LOG.md items for this lane), detect(s: SurveyJson) → {verdict: 'GO'|'HARD'|'NO', why: string}, setup?(), build?(portDir) → Promise<BuildResult>, shell?(port) → Partial<ShellJson>}`. Exported as `LANES: Record<string, LaneModule>` and `rankLanes(survey) → Array<{lane, verdict, why, available, milestone}>`. The M1 lanes register themselves in Tasks 16–19.
- Produces `decide(partial) → {lanes, legal_flags: string[], verdict: {overall: 'GO'|'HARD'|'STOP', primary_lane: string|null, reasons: string[], required_acknowledgements: string[]}}`:
  - STOP rules from spec §7.2;
  - catalog matches put `known-port` first;
  - `primary_lane` is the best **available** lane with a non-NO verdict;
  - the best unavailable lane is mentioned in `reasons` as "available in <milestone>".
- Produces `survey(gameDir, {maxFiles}) → Promise<SurveyJson>` with the shape of note 04 §A.8 plus `catalog_matches`, `skipped`, `truncated` and `schema: 'port-any-game/survey@1'`.
- Produces the `pag.mjs` CLI:
  - `pag survey <dir> [--json] [--out <file>]`;
  - human output is ≤ 8 lines: verdict, lane, odds, matches, warnings;
  - exit codes: 0 GO/HARD, 4 STOP, 2 usage error.

- [ ] **Step 1: Write failing tests:**
  - `GO via web-extract for NW.js folder`;
  - `STOP for steamstub with remote-play still listed`;
  - `known-port first on catalog match`;
  - `UPX is WARN and adds ACK`;
  - `primary_lane skips unavailable lanes`;
  - `survey output has only relative paths and root_id`;
  - Review Focus 1: `survey handles unicode/space paths` (dir `Gamé Ñame (x86)`);
  - Review Focus 2: `survey skips unreadable and broken entries and caps file count` (unreadable file + dangling symlink + `maxFiles: 50` on 100 files → `skipped.length >= 1`, `truncated === true`, no throw);
  - `pag survey exit 4 on STOP`;
  - `pag survey --json is valid JSON`.
- [ ] **Step 2:** Run `node --test test/survey test/pag.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement the registry, `decide`, `survey` and the CLI dispatcher (`node:util` `parseArgs`; one module per command, loaded lazily).
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: lane registry, verdict and pag survey"`

---

### Task 9: Policy and hook guard

**Files:**
- Create: `skills/port-any-game/scripts/policy.mjs`, `skills/port-any-game/scripts/guard.mjs`
- Test: `test/policy.test.mjs`, `test/guard.test.mjs` (uses `test/fixtures/hook-payloads/*.json` from Task 3, plus hand-written Claude payloads)

**Interfaces:**
- Produces from `policy.mjs`:
  - `class PolicyError extends Error {code: 'STOP_VERDICT'|'PUBLIC_BUNDLED'|'CIRCUMVENTION'|'PIRACY_SOURCE'|'GAME_DIR_WRITE'|'LAN_NO_PASSWORD'}`;
  - `checkToolUse({tool: 'shell'|'write'|'fetch'|'other', command?: string, path?: string, url?: string, cwd: string}) → {deny: boolean, reason: string}`;
  - `assertLaneAllowed(survey, laneId)`;
  - `assertTarget(port, target: 'local'|'lan'|'public', {password?: string})`.
- Produces from `guard.mjs`:
  - `normalizeEvent(raw, host) → {tool, command?, path?, url?, cwd}`. It accepts `tool_name/toolName`, `tool_input/toolArgs/toolInput`, Cursor's `command`, and OpenCode's `resources`.
  - `formatDeny(host, reason) → {stdout: string, stderr: string, exitCode: number}`, with the host formats from spec §11 / note 01 §4.1:
    - `copilot`: JSON `permissionDecision` on stdout, exit 0;
    - `antigravity` and `agentplugins`: JSON `decision` on stdout, exit 0;
    - all others: reason on stderr, exit 2.
  - `pag guard --host=<x>`: reads stdin asynchronously to EOF, tolerates BOM/CRLF, prints nothing when allowed, and **exits 0 on its own internal errors** (fail-open is logged to stderr; script policy remains authoritative).
- Deny list (`checkToolUse`):
  - shell commands matching circumvention tools: `steamless`, `noceg`, `goldberg`, `steam_emu`, `smartsteamemu`, `unlicense`, `\bcrack\b` loaders list;
  - piracy domains from `policy-domains.json` (small, reviewed list);
  - `git add|commit` or `git push` touching `game/`, `work/`, `build/`, `analysis/`, `dist/` inside a folder with `port.json` whose `data.mode` ≠ `bundled-public`;
  - deploy commands (`wrangler (pages )?deploy`, `gh-pages`, `netlify deploy`, `vercel`, `surge`, `butler push`, `npm publish`) in such folders;
  - writes whose path is inside `<port>/game/`.

- [ ] **Step 1: Write failing tests:**
  - `denies steamless`;
  - `denies git add game/`;
  - `allows git add lane/`;
  - `allows git add game/ in bundled-public port`;
  - `denies wrangler deploy of bundled port`;
  - `denies write into game/`;
  - `allows unrelated commands`;
  - `assertLaneAllowed throws STOP_VERDICT`;
  - `assertTarget lan without password throws`;
  - `normalizes every recorded payload`;
  - `formatDeny copilot JSON exit 0`;
  - `formatDeny claude stderr exit 2`;
  - `guard exits 0 and prints nothing on malformed stdin`.
- [ ] **Step 2:** Run `node --test test/policy.test.mjs test/guard.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: policy module and cross-agent hook guard"`

---

### Task 10: `pag doctor` and `pag setup`

**Files:**
- Create: `skills/port-any-game/scripts/doctor.mjs`, `skills/port-any-game/scripts/setup.mjs`, `skills/port-any-game/scripts/toolchain.lock.json`, `scripts/pin.mjs`
- Test: `test/doctor.test.mjs`, `test/setup.test.mjs`

**Interfaces:**
- Produces:
  - `doctor() → Promise<DoctorReport>`, where `DoctorReport` = `{os, arch, node: {version, ok: boolean (>=20), recommended: boolean (>=22)}, git: boolean, diskFreeBytes: number (fs.statfs on cacheDir), browsers: Array<{kind: 'edge'|'chrome'|'chromium', path}>, playwrightCached: boolean, sandbox: 'claude-web'|'codex-cloud'|null, cacheDir, warnings: string[]}`;
  - `ensureTool(name) → Promise<string>`, which returns the extracted dir `<cacheDir>/tools/<name>-<version>/`;
  - `toolchain.lock.json` entries `{name, version, url, sha256, size, archive: 'zip'|'tgz', strip?: number, licenseFile: string}` for `ruffle-selfhosted`, `js-dos` (npm tarball) and `playwright` (special: installs into the cache with `npm i --prefix`, browsers into `<cacheDir>/ms-playwright`; only on explicit `pag setup playwright`);
  - `scripts/pin.mjs <url>`, which prints `{sha256, size}`.
- Download rules:
  - resume `<file>.part` with a `Range` header;
  - verify SHA-256 before extracting;
  - extract into a fresh temp dir, then rename into place;
  - write `.ok` last;
  - an existing `.ok` makes the call a no-op.
- CLI:
  - `pag doctor [--json]`;
  - `pag setup <core|ruffle|jsdos|playwright> [--yes]`. The aliases `ruffle` → `ruffle-selfhosted` and `jsdos` → `js-dos` are lock entry names; `core` = nothing to download in M1, so it just validates the cache dir. Without `--yes` it prints what it will download and its size, then exits 0. The skill asks the user before passing `--yes`.

- [ ] **Step 1: Write failing tests**, using a local `node:http` server that serves a test archive:
  - `doctor reports node ok and cacheDir`;
  - `doctor finds browser from PAG_BROWSER env`;
  - `setup downloads, verifies and extracts`;
  - `setup is a no-op when .ok exists`;
  - Review Focus 5: `setup resumes partial download and rejects bad hash` (a pre-seeded `.part` gets a `Range` request; a wrong sha256 leaves no tool dir);
  - `setup without --yes downloads nothing`.
- [ ] **Step 2:** Run `node --test test/doctor.test.mjs test/setup.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. Browser discovery paths per OS:
  - Windows: Edge under `%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe` and `%ProgramFiles%\…`; Chrome under `%ProgramFiles%`, `%ProgramFiles(x86)%` and `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`.
  - macOS: `/Applications/{Google Chrome,Microsoft Edge,Chromium}.app/Contents/MacOS/*`.
  - Linux: `PATH` lookup of `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge`.
  - Overrides: `PAG_BROWSER`, then `CHROME_PATH`.

  Fill in real pins with `scripts/pin.mjs`.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: doctor and pinned, resumable tool setup"`

---

### Task 11: `pag new`: port folder, project rules and git hooks

**Files:**
- Create: `skills/port-any-game/scripts/new.mjs`, `skills/port-any-game/assets/project/{AGENTS.md, CLAUDE.md, gitignore, PORTING_LOG.md, githooks/pre-commit, githooks/pre-push, githooks/check-staged.mjs}`
- Test: `test/new.test.mjs`, `test/githooks.test.mjs`

**Interfaces:**
- Consumes: `survey` (Task 8), `assertLaneAllowed` (Task 9).
- Produces:
  - `newPort({gameDir, outDir, lane?: string, resume = false}) → Promise<PortJson>`;
  - `PortJson` = `{schema: 'port-any-game/port@1', id, name, lane, data: {mode: 'byo'|'bundled'|'bundled-public'}, tools: Record<name, version>, acks: Array<{id, at: ISO}>, created_at}`.
- Port layout per spec §10:
  - `game/` is a directory symlink to `gameDir` (on Windows, `fs.symlink(target, path, 'junction')`, which needs no admin);
  - `survey.json` is written;
  - `PORTING_LOG.md` is created from the template with the chosen lane's checklist (each lane module exports `checklist: string[]`);
  - `git init` + `git config core.hooksPath .githooks` run; **no commit**.
- `AGENTS.md` (≤ 40 lines): the port's rules (never commit `game/`, `work/`, `build/`, `dist/`, `analysis/`; never deploy without asking; read `PORTING_LOG.md` first; use `pag status`). `CLAUDE.md` is exactly `@AGENTS.md`.
- `check-staged.mjs` is a standalone zero-dep script, copied into the port, that rejects a commit when any staged file:
  - starts with a game magic (note 04 §B.8 list: `MZ`, `GDPC`, `RGSSAD`, `XP3\r\n`, `UnityFS`, `RPA-`, `CLIB\x1a`, `IWAD`, `PWAD`, `PACK`, `KenSilverman`, `BIK`, `SMK`, `FWS`, `CWS`, `ZWS`, `XFIR`, `RIFX`);
  - matches a hash in `survey.json`;
  - is a binary over 5 MiB.

  It is skipped entirely when `port.json` `data.mode` = `bundled-public`.

- [ ] **Step 1: Write failing tests:**
  - `new creates layout, port.json and log checklist`;
  - `new refuses STOP verdict`;
  - Review Focus 5: `new refuses existing port without --resume` (and keeps files with `--resume`);
  - Review Focus 1: `new links unicode game dir`;
  - `new does not create commits` (`git rev-list --all` is empty);
  - `pre-commit rejects staged WAD`;
  - `pre-commit rejects >5MiB binary`;
  - `pre-commit allows lane source`.
- [ ] **Step 2:** Run `node --test test/new.test.mjs test/githooks.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. The hooks are POSIX `sh` files that run `node .githooks/check-staged.mjs` (Git for Windows runs `sh` hooks).
- [ ] **Step 4:** Run it again. Expected: PASS on all 3 OSes.
- [ ] **Step 5:** Commit: `git commit -m "feat: pag new with project rules and git guard hooks"`

---

### Task 12: `pag serve`

**Files:**
- Create: `skills/port-any-game/scripts/serve.mjs`
- Test: `test/serve.test.mjs`

**Interfaces:**
- Produces:
  - `startServer({root, host = '127.0.0.1', port = 0, password?: string, fixtureDir?: string, caseFallback = false}) → Promise<{url, close()}>`;
  - `parseHeadersFile(text) → Array<{pattern, headers: Record<string,string>}>` (Netlify `_headers` format).
- CLI: `pag serve [dist] [--port N] [--lan --password-env VAR] [--open]`. `caseFallback` comes from `dist/shell.json` `serve.caseFallback`.
  - `--lan` binds `0.0.0.0` and calls `assertTarget(port, 'lan', {password})`.
  - `--open` launches the system browser.
- Behaviour:
  - applies `<root>/_headers` rules to every response;
  - always sends `X-Robots-Tag: noindex, nofollow`;
  - fixed MIME map, at least `.html .js .mjs .css .json .wasm .png .jpg .gif .svg .webp .mp3 .ogg .wav .mp4 .webm .swf .zip .jsdos .data .bin`, with `application/octet-stream` as default;
  - `Range` gives 206/416;
  - no directory listing (404);
  - percent-decoding with path-traversal rejection;
  - basic auth compared with `crypto.timingSafeEqual`;
  - `fixtureDir` is mounted read-only at `/__fixture/` (verify only);
  - `caseFallback` resolves path segments case-insensitively and logs `case-fallback: <req> -> <file>` to stderr.

- [ ] **Step 1: Write failing tests:**
  - `binds 127.0.0.1 by default`;
  - `applies _headers incl COOP/COEP`;
  - `noindex on every response`;
  - `wasm MIME`;
  - `range 206 and 416`;
  - `no directory listing`;
  - `rejects ../ traversal`;
  - `basic auth 401 then 200`;
  - Review Focus 1: `serves percent-encoded unicode names`;
  - Review Focus 3: `case-insensitive fallback for bundled`;
  - `fixture mount`.
- [ ] **Step 2:** Run `node --test test/serve.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement with `node:http` and streams.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: pag serve with headers, range and loopback default"`

---

### Task 13: Web shell and `pag pack`

**Files:**
- Create:
  - `skills/port-any-game/assets/shell/{index.html, shell.css, shell.js, import.js, storage.js, input.js, audio.js}`;
  - `skills/port-any-game/scripts/pack.mjs`;
  - `skills/port-any-game/scripts/build.mjs` (dispatches `LANES[port.lane].build`);
  - `test/fixtures/lane-test/adapter.js` (a test lane with modes `ok|black|frozen|throw|silent` read from `?mode=`).
- Test: `test/pack.test.mjs`, `test/shell/pure.test.mjs`

**Interfaces:**
- Consumes: `serve` (Task 12), `zip.js` (Task 4), the lane `shell()` contribution.
- Produces `ShellJson` (`dist/shell.json`):

  ```
  {schema: 1, game_id, lane,
   entry: {adapter: 'runtime/<lane>/adapter.js'},
   requires: {webgl2, webgpu, threads, simd, jspi},
   needs_coi: boolean,
   memory: {initial_mb, maximum_mb},
   data: {mode, manifest: 'game/manifest.json', mount: '/game', saves: '/saves/<game_id>'},
   input: {keyboard, mouse: 'none'|'absolute'|'relative', gamepad: 'none'|'standard', touch},
   video: {aspect, scaling},
   serve?: {caseFallback: boolean},
   lane_config?: object,   // lane-specific, e.g. {swf: 'path'} or {exe: 'GAME.EXE'}
   verify: {target_fps, inputs: string[], audio_on_title: boolean, budget_ready_s, stages?: string[]}}
  ```

- Produces `pack(portDir, {mode}) → Promise<{distDir, shell: ShellJson}>`, which writes:
  - the shell files;
  - `runtime/<lane>/` (adapter + lane runtime files from the tool cache);
  - `game/manifest.json` = `{version, source, total_bytes, files: [{path, size, sha256}]}` (`version` = sha256 of the sorted entries);
  - the game files when `mode` ≠ `byo`;
  - `_headers` from `headersFor(shell)`;
  - `robots.txt` (`Disallow: /`) and `LICENSES/<runtime>.txt`.

  It refuses `bundled-public` unless the port has `ACK_RIGHTS_HOLDER` or the catalog marks the data redistributable.
- Produces `headersFor(shell) → string`.
- Produces the browser API `window.__shell`:
  - `state`, which changes only through `setState()`, dispatching `shell:state`;
  - `stats {rafFrames, gameFrames, inputEvents, wasmBytes, audioRms, lastError}`;
  - `storage {selfTest(), exportSaves() → Blob, importSaves(blob)}`;
  - `lane`;
  - `debug.captureFrame()`.
- Produces the lane adapter contract: `export default { id, async start(ctx), pause(), resume(), saveNow?(), frameCounter() }`, with `ctx` = `{host: HTMLElement, files: {list() → string[], read(path) → Promise<Uint8Array>, url(path) → string}, audio: {context: AudioContext}, reportFrame(), reportError(err), config: ShellJson}`.
- Import (`import.js`):
  - `showDirectoryPicker` when available, else `<input webkitdirectory>`, plus folder drag-drop;
  - identifies files against `manifest.files` by relative path + size, then sha256 per file in a Worker;
  - copies into OPFS `/game/` with a `.part` → rename step and a per-file `.done` marker;
  - **test hook:** `?verify_import=/__fixture/` imports the files listed in `/__fixture/index.json` through the same copy pipeline.
- No-black-screen rules (spec §8) apply inside `shell.js`:
  - the adapter `start` and every frame callback run inside try/catch → `reportError`;
  - `readyState`-safe bootstrap;
  - the canvas host shows a live placeholder under the Play overlay.
- Audio: one `AudioContext`, created on the Play click, then `resume()`.
- Input: `preventDefault` for arrow keys, Space, Tab, F1–F12 while running; gamepads polled each animation frame into `stats.inputEvents`.

- [ ] **Step 1: Write failing tests:**
  - `pack writes shell, manifest, _headers, robots, LICENSES`;
  - `byo pack contains no game bytes`;
  - `bundled-public refused without ACK_RIGHTS_HOLDER`;
  - `headersFor adds COOP/COEP only when needs_coi`;
  - `manifest version changes when a file changes`;
  - `shell pure helpers` (path normalization, manifest matching) in `test/shell/pure.test.mjs`.
- [ ] **Step 2:** Run `node --test test/pack.test.mjs test/shell`. Expected: FAIL.
- [ ] **Step 3:** Implement the shell and pack. Keep `shell.js` under ~400 lines. Add the test hook `&verify_interrupt_after=<n>`, which reloads the page after `n` files are copied. Browser behaviour is proven by the verify e2e in Tasks 14, 16 and 17.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: shared web shell and pag pack"`

---

### Task 14: `pag verify` (CDP tier default, Playwright fallback)

**Files:**
- Create: `skills/port-any-game/scripts/verify/{browser.mjs, cdp.mjs, driver-cdp.mjs, driver-playwright.mjs, checks.mjs, instrument.js, verify.mjs}`
- Test: `test/verify/checks.test.mjs`, `test/verify/verify.e2e.test.mjs` (uses `lane-test`)

**Interfaces:**
- Consumes: `startServer` (Task 12), `pack` (Task 13), `doctor().browsers` (Task 10), Task 2 spike results.
- Produces:
  - `findBrowser() → {kind, path} | null` (re-uses the doctor discovery);
  - `launchBrowser({path, headless: boolean, userDataDir}) → Promise<{wsEndpoint, close()}>` (extra flags appended from env `PAG_CHROME_FLAGS`, split on spaces);
  - `class Cdp { static connect(wsUrl) → Promise<Cdp>; send(method, params?, sessionId?) → Promise<object>; on(event, cb) → unsubscribe; close() }`.
- Produces the `Driver` interface, implemented by both `driver-cdp.mjs` and `driver-playwright.mjs`:

  ```
  {open(url), evaluate(fnSource: string, arg?) → Promise<any>, screenshot(file),
   click(x, y), key(code: string), setViewport(w, h), reload(),
   onConsole(cb({level, text})), onRequest(cb({url, method, hasBody, crossOrigin})),
   close()}
  ```

- Produces from `checks.mjs` (pure):
  - `frameStats(rgba: Uint8Array, w, h) → {meanLuma, stdLuma, nearBlackRatio, coloredRatio}`;
  - `meanAbsDiff(a, b) → number` (0–255 scale);
  - `judge(measures, thresholds) → {status: 'pass'|'warn'|'fail', checks: Array<{name, status, detail}>}`, with the thresholds from Global Constraints.
- Produces `verify(distDir, {runner: 'auto'|'cdp'|'playwright' = 'auto', soakSec = 60, headed = false, fixtureDir?, browsers = ['chromium']}) → Promise<Report>`, which writes `<port>/verify/report.json` + `step-*.png` + `console.log`.
  - Exit codes: 0 pass, 1 fail, 2 warn only, **3 unsupported environment**.
  - `instrument.js` is injected via `Page.addScriptToEvaluateOnNewDocument` (all frames). It patches `getContext` to force `preserveDrawingBuffer: true` for `webgl`/`webgl2`, taps `AudioNode.prototype.connect` into a per-context `AnalyserNode`, fakes a standard gamepad (`navigator.getGamepads`), and samples canvases to 64×48 RGBA arrays.
- Steps follow spec §9 1–14, including viewports 1280×800 and 390×844 (overflow check: `document.documentElement.scrollWidth <= innerWidth`). Stage hooks `?verify_stage=` are used when `shell.verify.stages` is set.

- [ ] **Step 1: Write failing tests:**
  - `frameStats black frame is blank`;
  - `frameStats gradient not blank`;
  - `meanAbsDiff identical is 0`;
  - `judge fails all-blank`;
  - `judge warns static-until-input`;
  - `judge fps pass/warn/fail at 0.9/0.5`;
  - e2e (skips if no browser): `lane-test ok passes`, `lane-test black fails blank`, `lane-test frozen fails frozen`, `lane-test throw fails page error`, `lane-test silent warns audio`;
  - `mobile viewport overflow fails`;
  - `byo privacy: POST fails`;
  - Review Focus 4: `verify exits 3 when no browser and no playwright` (`PAG_BROWSER=/nonexistent`, empty cache).
- [ ] **Step 2:** Run `node --test test/verify`. Expected: FAIL.
- [ ] **Step 3:** Implement. The CDP driver uses one browser-level connection with `Target.createTarget` + `Target.attachToTarget({flatten: true})`.
  - Clicks use `Input.dispatchMouseEvent` (trusted).
  - Keys use `Input.dispatchKeyEvent` with `code`.
  - `driver-playwright.mjs` `import()`s Playwright from `<cacheDir>/tools/playwright-<v>/node_modules/playwright/index.mjs`. When it is absent, `auto` resolves to exit 3.
- [ ] **Step 4:** Run `node --test test/verify`. Expected: PASS on all 3 OSes in CI (Linux uses `--use-angle=swiftshader --enable-unsafe-swiftshader`).
- [ ] **Step 5:** Commit: `git commit -m "feat: pag verify with CDP default and playwright fallback"`

---

### Task 15: `pag status` and the session-start hook payload

**Files:**
- Create: `skills/port-any-game/scripts/status.mjs`
- Test: `test/status.test.mjs`

**Interfaces:**
- Consumes: `port.json`, `PORTING_LOG.md`, `doctor()`.
- Produces `status(cwd) → {port: PortJson|null, nextItem: string|null, lastVerify: {status, at}|null, warnings: string[]}`.
- CLI `pag status [--host=<x>] [--json]`:
  - searches up from `cwd` for `port.json`;
  - prints ≤ 6 lines (`Port <name> · lane <lane> · next: <first unchecked item> · last verify <status> <date>`, plus any warnings);
  - prints nothing and exits 0 when no port is found.

- [ ] **Step 1: Write failing tests:**
  - `finds port.json in parent`;
  - `reports first unchecked checklist item`;
  - `silent outside a port`;
  - `includes node<20 warning`.
- [ ] **Step 2:** Run `node --test test/status.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: pag status for session-start context"`

---

### Task 16: Lane `web-extract` (bundled)

**Files:**
- Create: `skills/port-any-game/scripts/lanes/web-extract.mjs`, `skills/port-any-game/assets/lanes/web-extract/adapter.js`, `test/fixtures/make-web-game.mjs`, `test/fixtures/make-asar.mjs`, `test/fixtures/web-game/{index.html, game.js}`
- Test: `test/lanes/web-extract.test.mjs`, `test/e2e/run.mjs` (create; lane cases added here and in Tasks 17–18)

**Interfaces:**
- Consumes: `extractZip`, `extractAsar` (Task 4); `LaneModule` (Task 8); `pack`, `verify`.
- Produces `LANES['web-extract']` with:
  - `rung 0`, `available: true`, `milestone: 'M1'`, `dataModes: ['bundled']`, `acks: ['ACK_PRIVATE_USE_ONLY']`;
  - `checklist` (5 items: extract, find entry html, case map, node-API scan, verify);
  - `detect` (GO when engines include `nwjs`/`electron`/`rpgmaker-mv`/`rpgmaker-mz`/`construct`/`gdevelop`/`twine` and an entry HTML is found);
  - `build(portDir) → {entryHtml: 'game/index.html', nodeApiUses: Array<{file, line, api}>, caseFixes: number}`.
- Extraction order:
  1. `package.nw` (zip or folder);
  2. zip appended to the exe (via `ExeInfo.overlay.magic === 'zip'`);
  3. `resources/app.asar` / `resources/app/`;
  4. `www/`.

  The entry comes from `package.json` `main`, else `index.html`.
- Node-API scan: regex for `require\(`, `process\.`, `nw\.`, `greenworks` in `.js` files. M1 reports them in `PORTING_LOG.md` and the verdict becomes HARD when any are found outside RPG Maker's guarded `Utils.isNwjs()` paths. Shims arrive in a later plan.
- The adapter loads `game/index.html` into a same-origin iframe sized to the host. It counts frames by wrapping the iframe's `requestAnimationFrame`, and reports errors from the iframe `error` / `unhandledrejection` events.
- Fixture game (`test/fixtures/web-game/`, our own code, MIT):
  - 640×480 canvas with an animated gradient and a moving square;
  - Arrow keys move the square;
  - the first pointerdown starts a 440 Hz oscillator;
  - it saves `score` in `localStorage`;
  - it references `Img/Title.PNG` while the file on disk is `img/title.png` (Review Focus 3).
- `make-web-game.mjs` emits two variants:
  - NW.js: `package.nw` zip + empty `nw.dll` marker;
  - Electron: `resources/app.asar` + empty `v8_context_snapshot.bin` marker.

- [ ] **Step 1: Write failing tests:**
  - `detect GO for NW.js variant`;
  - `detect GO for Electron variant`;
  - `build extracts entry and reports node-api uses` (inject `require('fs')` into a copy → `nodeApiUses.length === 1` and verdict HARD);
  - e2e `web-extract NW.js fixture passes verify`;
  - e2e `web-extract Electron fixture passes verify`;
  - Review Focus 3 e2e: `web-extract fixture with mixed-case refs passes` (served with `caseFallback`, no 404 in the report).
- [ ] **Step 2:** Run `node --test test/lanes/web-extract.test.mjs && node test/e2e/run.mjs web-extract`. Expected: FAIL.
- [ ] **Step 3:** Implement the lane, the adapter and the fixtures. `build` and `pack` enable `caseFallback` in `shell.json` (`serve.caseFallback: true`) for this lane.
- [ ] **Step 4:** Run the same commands. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(lane): web-extract for NW.js/Electron HTML5 games"`

---

### Task 17: Lane `rt-ruffle` (BYO)

**Files:**
- Create: `skills/port-any-game/scripts/lanes/rt-ruffle.mjs`, `skills/port-any-game/assets/lanes/rt-ruffle/adapter.js`, `test/fixtures/make-swf.mjs`
- Test: `test/lanes/rt-ruffle.test.mjs`, a case in `test/e2e/run.mjs`

**Interfaces:**
- Consumes: `ensureTool('ruffle-selfhosted')` (Task 10); the shell `ctx.files`.
- Produces `LANES['rt-ruffle']`:
  - `rung 1`, `dataModes: ['byo']`, `acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE']`;
  - `detect` (GO for `flash-swf` / `flash-projector`);
  - `build` copies the Ruffle self-hosted files into `build/runtime/rt-ruffle/` and records the main SWF's relative path in `shell.json` as `lane_config.swf`.
- The adapter:
  - reads the SWF bytes from `ctx.files`;
  - when the file is a projector exe, extracts the SWF in the browser (last 8 bytes: `56 34 12 FA` + uint32 LE length; the SWF ends 8 bytes before EOF);
  - creates a Ruffle player with `{autoplay: 'on', preferredRenderer: 'webgl', letterbox: 'on', unmuteOverlay: 'hidden'}`;
  - loads `{data: arrayBuffer}`;
  - counts frames via `requestAnimationFrame` while the player is playing.
- `make-swf.mjs`: `makeAnimSwf() → Buffer`, an uncompressed SWF v6 at 640×480 / 30 fps:
  - `SetBackgroundColor #3366CC`;
  - one `DefineShape` (solid #FFCC00 rectangle 100×100 px);
  - 60 frames of `PlaceObject2` moving it +8 px in x, each followed by `ShowFrame`;
  - `End`.

  It also offers `makeProjector(swf) → Buffer` = `makePE()` + swf + trailer.

- [ ] **Step 1: Write failing tests:**
  - `makeAnimSwf has FWS header and declared length`;
  - `detect GO for swf and projector`;
  - `projector trailer extraction returns original swf` (pure helper exported from the adapter module and imported by the test);
  - e2e `rt-ruffle BYO fixture passes verify with zero game bytes in dist`;
  - Review Focus 5 e2e: `rt-ruffle import resumes after interrupted import`. The fixture dir holds the SWF plus two 1 MiB padding files; load with `?verify_import=/__fixture/&verify_interrupt_after=1`. After the reload, files already marked `.done` are not re-fetched (count GETs to `/__fixture/` per file ≤ 1) and the game reaches `running`.
- [ ] **Step 2:** Run `node --test test/lanes/rt-ruffle.test.mjs && node test/e2e/run.mjs rt-ruffle`. Expected: FAIL.
- [ ] **Step 3:** Implement. The e2e imports the fixture via `?verify_import=/__fixture/`.
- [ ] **Step 4:** Run the same commands. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(lane): rt-ruffle for Flash SWF and projectors"`

---

### Task 18: Lane `dos-jsdos` (BYO)

**Files:**
- Create: `skills/port-any-game/scripts/lanes/dos-jsdos.mjs`, `skills/port-any-game/assets/lanes/dos-jsdos/adapter.js`, `test/fixtures/make-dos-com.mjs`
- Test: `test/lanes/dos-jsdos.test.mjs`, a case in `test/e2e/run.mjs`

**Interfaces:**
- Consumes: `ensureTool('js-dos')`; `createZip` (Task 4, in the browser); spike (e) API notes.
- Produces `LANES['dos-jsdos']`:
  - `rung 1`, `dataModes: ['byo']`, `acks: ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE']`;
  - `detect` (GO for `dos`, or when the main exe is MZ-only/LE);
  - `dosboxConf({exe, cycles = 'auto'}) → string` with `[cpu] cycles=<cycles>` and `[autoexec]` `mount c .`, `c:`, `<EXE>`;
  - `build`, which copies the js-dos dist files and stores `lane_config.exe` (the survey's main DOS exe, relative path, upper-cased 8.3 name).
- The adapter builds the `.jsdos` bundle in the browser: `createZip` over the imported files + `.jsdos/dosbox.conf`. It starts js-dos with the bundle bytes (API from spike e) and counts frames from the js-dos canvas via `requestAnimationFrame`.
- Fixture `make-dos-com.mjs`: `makeAnimCom() → Buffer`, a hand-assembled 8086 `.COM`. The byte array carries the assembly as comments:

  ```
  org 100h
    mov ax,13h / int 10h            ; VGA mode 13h
    mov ax,0A000h / mov es,ax
    xor bl,bl
  frame:
    mov dx,3DAh
  w1: in al,dx / test al,8 / jnz w1 ; wait for vsync end
  w2: in al,dx / test al,8 / jz w2  ; wait for vsync start
    xor di,di / mov al,bl / mov cx,64000 / rep stosb
    inc bl
    mov ah,1 / int 16h / jz frame   ; loop until a key is pressed
    xor ah,ah / int 16h
    mov ax,3 / int 10h / ret        ; text mode, exit
  ```

  The verify config for this fixture sets `audio_on_title: false` and `inputs: []`. The frozen check is satisfied by the colour cycle.

- [ ] **Step 1: Write failing tests:**
  - `dosboxConf autoexec mounts and runs exe`;
  - `detect GO for MZ-only folder`;
  - `makeAnimCom starts with B8 13 00 CD 10`;
  - e2e `dos-jsdos BYO fixture passes verify with zero game bytes in dist`.
- [ ] **Step 2:** Run `node --test test/lanes/dos-jsdos.test.mjs && node test/e2e/run.mjs dos-jsdos`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same commands. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(lane): dos-jsdos with in-browser bundle build"`

---

### Task 19: Lane `known-port` (route)

**Files:**
- Create: `skills/port-any-game/scripts/lanes/known-port.mjs`
- Test: `test/lanes/known-port.test.mjs`

**Interfaces:**
- Consumes: `survey.catalog_matches` (Task 8).
- Produces `LANES['known-port']`:
  - `rung 0`, `dataModes: ['byo']`, `acks: ['ACK_PRIVATE_USE_ONLY']`;
  - `detect` (GO when there is any match with tier ≠ `title`; HARD when only a title match exists, so the user must confirm);
  - `build(portDir) → {kind: 'external', ports: Port[], data_files: string[], message: string}`.

  It writes no `dist/`. The skill reads `message` aloud: port name, link, licence, which of the user's files to pick, `legal_risk`, and that the data stays in their browser. `legal_risk: 'high'` ports are listed only when `--include-high-risk` is passed.

- [ ] **Step 1: Write failing tests:**
  - `GO on store match`;
  - `HARD on title-only match`;
  - `build lists data files and license`;
  - `high-risk ports hidden by default`.
- [ ] **Step 2:** Run `node --test test/lanes/known-port.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat(lane): known-port routes to existing BYO web ports"`

---

### Task 20: `pag package`: double-click launchers

**Files:**
- Create: `skills/port-any-game/scripts/package.mjs`, `skills/port-any-game/assets/launchers/{Play-Windows.bat, Play-macOS.command, Play-Linux.sh, serve-standalone.mjs}`
- Test: `test/package.test.mjs`

**Interfaces:**
- Consumes: `dist/` (Task 13), `createZip` (Task 4), `parseHeadersFile` (Task 12). `package.mjs` calls it on `dist/_headers` and writes the result as `headers.json` next to the launchers. `serve-standalone.mjs` and the PowerShell script read `headers.json`; neither imports plugin code.
- Produces `packagePortable(portDir) → Promise<{dir: '<port>/package/<id>-portable', zipPath: '<port>/package/<id>.zip'}>`.
- Launchers:
  - `Play-Windows.bat` runs `powershell -NoProfile -ExecutionPolicy Bypass` with an inline script that:
    - binds `System.Net.HttpListener` to `http://127.0.0.1:<free port>/`;
    - serves `dist` files with the MIME map;
    - applies the `_headers` rules (COOP/COEP when present) and `X-Robots-Tag`;
    - supports `Range`;
    - opens the default browser;
    - stops when the console closes.
  - `Play-macOS.command` and `Play-Linux.sh` `cd` to the script dir, then try `node serve-standalone.mjs`, then `python3 -m http.server` **only when `needs_coi` is false** (python lacks the headers). Otherwise they print a one-line message asking for Node.
  - The zip stores `.command` and `.sh` with mode `0o755`.
- Policy: `package` prints "Private copy: contains your game files. Do not share publicly." unless the mode is `bundled-public` or `byo`.

- [ ] **Step 1: Write failing tests:**
  - `package writes launchers and zip`;
  - `zip keeps 0755 on .command and .sh`;
  - `serve-standalone serves with COOP/COEP` (spawn it, fetch the headers);
  - `Windows launcher serves headers` (Windows CI only: spawn the `.bat` with `PAG_NO_OPEN=1`, fetch `/`, assert COOP + noindex, kill the process);
  - `prints private warning for bundled`.
- [ ] **Step 2:** Run `node --test test/package.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS on all 3 OSes.
- [ ] **Step 5:** Commit: `git commit -m "feat: pag package with double-click launchers"`

---

### Task 21: `SKILL.md`, references and Codex metadata

**Files:**
- Modify: `skills/port-any-game/SKILL.md`, `skills/port-any-game/agents/openai.yaml`
- Create: `skills/port-any-game/references/{lanes/web-extract.md, lanes/known-ports.md, lanes/runtimes.md, lanes/dos.md, shell.md, verify.md, legal.md}`
- Test: `node scripts/validate.mjs` (extended in Step 1)

**Interfaces:**
- Consumes: every `pag` command and its exit codes (Tasks 8–20).
- `SKILL.md` frontmatter:
  - `name: port-any-game`;
  - `license: MIT`;
  - `compatibility: "Requires Node.js 20+ (22 recommended), git; Chrome or Edge for verification (Playwright fallback)."`;
  - a `description` (≤ 1,024 chars) that front-loads trigger words: play an old PC game in the browser, port/convert a game you own to web/HTML5/WebAssembly, run DOS/Flash/RPG Maker/NW.js games in a browser, continue a port (folder with `port.json`).
- Body (target ~150 lines, max 500) follows spec §14 exactly:
  - step 0 node check with per-OS install commands;
  - intake rounds with a recommended answer per question;
  - survey + catalog;
  - acknowledgements (plain questions, stored via `pag ack <ID>`; add that subcommand here, writing to `port.json.acks`);
  - new/setup (always show size first, then `--yes` only after the user agrees);
  - build loop;
  - verify gate via `port-verifier`;
  - hand-over (`pag serve --open` or `pag package`);
  - end of session.
- Ground rules: spec §11 Refuse/Warn lists, with "never assert facts the user did not state" verbatim.
- Agent hygiene: write large files in pieces of ≤ ~1,000 lines.
- Lane references are loaded only for the chosen lane. Each reference has: when to use, inputs, steps with exact `pag` commands, known failure → fix table, verify notes.
- `legal.md` carries the jurisdiction note and the ack IDs from note 04 §B.9.

- [ ] **Step 1:** Extend `validateRepo` and add failing tests: `every lane id in LANES with available:true has references/lanes/<family>.md mentioned in SKILL.md`, and `SKILL.md mentions every pag subcommand it uses`. Run: FAIL.
- [ ] **Step 2:** Write `SKILL.md` and the references, plus `pag ack` in `pag.mjs` with its test `ack appends timestamped id`.
- [ ] **Step 3:** Run `node --test test && node scripts/validate.mjs`. Expected: PASS.
- [ ] **Step 4:** Commit: `git commit -m "docs(skill): workflow, lane references and codex metadata"`

---

### Task 22: Agent wrappers, generator and installer (Claude, Codex, Copilot, OpenCode, skills-only)

**Files:**
- Create:
  - `agents/game-surveyor.md`, `agents/port-verifier.md`;
  - `commands/{port-survey,port-verify,port-status}.md`;
  - `hooks/hooks.json`, `hooks/codex.json`, `com.github.copilot/hooks/hooks.json`;
  - `plugin.json` (only if spike a = yes);
  - `opencode/plugin/{package.json, index.js}`, `opencode/opencode.jsonc.example`;
  - `scripts/gen-wrappers.mjs`, `scripts/install.mjs`.
- Generated (committed): `com.github.copilot/agents/*.agent.md`, `opencode/agents/*.md`, `opencode/commands/port-game.md`.
- Modify: `README.md` install block, `package.json` scripts (`gen`, and `validate` adds `node scripts/gen-wrappers.mjs --check`).
- Test: `test/build.test.mjs`, `test/install.test.mjs`, `test/opencode-plugin.test.mjs`

**Interfaces:**
- Consumes: `pag guard` / `pag status` (Tasks 9, 15); spikes a–c payloads.
- Canonical subagents (Claude format: `name`, `description`, `tools`; body = instructions):
  - `game-surveyor`: tools `Read, Glob, Grep, Bash`. It runs only `pag survey`/`pag doctor`, may web-search compatibility notes, returns verdict + lane + matches in ≤ 15 lines, and never modifies files.
  - `port-verifier`: tools `Read, Bash`. It runs `pag verify` and reads screenshots and the report, returns pass/warn/fail with evidence, and never edits files.
- Hook configs:
  - **Claude** `hooks/hooks.json`:
    - PreToolUse, matcher `Bash|Write|Edit|MultiEdit|WebFetch` → `node ${CLAUDE_PLUGIN_ROOT}/skills/port-any-game/scripts/pag.mjs guard --host=claude` (exec form);
    - SessionStart → `… status --host=claude`.
  - **Codex** and **Copilot**: the exact shapes confirmed in spike (b).
- `scripts/gen-wrappers.mjs`:
  - `generate(rootDir) → Map<relPath, content>`;
  - `--check` exits 1 on any drift.
  - Mappings:
    - `agents/*.md` → `com.github.copilot/agents/<name>.agent.md` (`description`, `tools` mapped) and `opencode/agents/<name>.md` (`description`, `mode: subagent`, v2 `permissions` list per note 06 §5.3);
    - `commands/*` → `opencode/commands/port-game.md` (`@port-any-game Port the game in: $ARGUMENTS`).
- `opencode/plugin/index.js`:
  - default export `{id: 'port-any-game', setup(ctx), server()}`;
  - `setup` registers `ctx.permission.hook('evaluate', …)`; `server()` returns `{'tool.execute.before': …}`;
  - both call `checkToolUse` through a relative import of `../../skills/port-any-game/scripts/policy.mjs`. The installer copies the skill next to it, so the path resolves in both the repo and the installed layout.
- `scripts/install.mjs --host=<opencode|skills> [--global] [--project <dir>] [--dry-run]` → prints each copy. Targets:
  - `skills`: skill → `~/.agents/skills/port-any-game` and `~/.claude/skills/port-any-game` (global), or `<project>/.agents/skills/…` (project);
  - `opencode`: additionally `opencode/agents|commands` → `.opencode/agents|commands`, plugin → `.opencode/plugins/port-any-game/` (project) or the `~/.config/opencode/…` equivalents (global).

  It never overwrites an existing `opencode.json(c)`; it prints the lines to merge. Windows `~` resolves to `%USERPROFILE%`.
- README install block (Tier 1), from note 01 §7.1 and note 06 §5.2:
  - Claude: `claude plugin marketplace add <org>/port-any-game` → `claude plugin install port-any-game@port-any-game`;
  - Codex: `codex plugin marketplace add <org>/port-any-game`, then trust the hooks when prompted;
  - Copilot: `copilot plugin marketplace add …` → `copilot plugin install port-any-game@port-any-game`;
  - OpenCode: `node scripts/install.mjs --host=opencode --global` after `git clone`, or `opencode plugin add 'github:<org>/port-any-game#v0.1.0::path:opencode/plugin'` + the skills route;
  - any other agent: `DISABLE_TELEMETRY=1 npx skills add <org>/port-any-game -g -a <agent>`.

- [ ] **Step 1: Write failing tests:**
  - `build generates copilot and opencode agents`;
  - `build --check detects drift`;
  - `install --dry-run lists opencode targets for project and global`;
  - `install never overwrites opencode.json`;
  - `opencode v2 hook denies steamless` (mock `ctx.permission.hook` captures the handler; calling it with `{action: 'shell', resources: ['steamless.exe a']}` sets `effect: 'deny'`);
  - `opencode v1 hook throws on steamless`;
  - `claude hooks.json uses exec form with CLAUDE_PLUGIN_ROOT`.
- [ ] **Step 2:** Run `node --test test/build.test.mjs test/install.test.mjs test/opencode-plugin.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. Run `node scripts/gen-wrappers.mjs` to write the generated files.
- [ ] **Step 4:** Run `npm test && node scripts/validate.mjs && node scripts/gen-wrappers.mjs --check`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "feat: tier-1 agent wrappers, generator and installer"`

---

### Task 23: CI matrix, end-to-end runner and Tier 1 agent eval

**Files:**
- Create: `.github/workflows/ci.yml`, `docs/evals/tier1.md`
- Modify: `test/e2e/run.mjs` (an `all` target runs the four lane fixtures: web-extract NW.js, web-extract Electron, rt-ruffle, dos-jsdos), `package.json` (`e2e` script)

**Interfaces:**
- Consumes: everything above.
- CI (`ci.yml`): on push and pull_request, matrix `os: [windows-latest, macos-latest, ubuntu-latest]`, Node 22. Steps:
  1. `npm test`;
  2. `node scripts/validate.mjs`;
  3. `node scripts/gen-wrappers.mjs --check`;
  4. `node skills/port-any-game/scripts/pag.mjs setup ruffle --yes` and `… setup jsdos --yes`, with the tool cache in `actions/cache`, keyed on `toolchain.lock.json`;
  5. `npm run e2e` (Linux sets `PAG_CHROME_FLAGS="--use-angle=swiftshader --enable-unsafe-swiftshader"`);
  6. upload `**/verify/` as artifacts on failure.
- `docs/evals/tier1.md`: the manual fresh-machine procedure for Claude Code, Codex and OpenCode on each OS:
  - install per README;
  - ask "Port the game in `<fixture dir>` so I can play it in my browser";
  - count user touchpoints;
  - record pass when `verify` passes and touchpoints ≤ 5 (spec §16 M1 exit);
  - a results table to fill in.

- [ ] **Step 1:** Push nothing. Run the workflow locally where possible: `npm test && node scripts/validate.mjs && node scripts/gen-wrappers.mjs --check && npm run e2e`. Expected: all PASS on the dev OS.
- [ ] **Step 2:** Write `ci.yml` and `tier1.md`.
- [ ] **Step 3:** Commit: `git commit -m "ci: 3-OS matrix with lane e2e and tier-1 eval procedure"`
- [ ] **Step 4:** Stop and tell the maintainer that CI only runs after they push. Hand over `docs/evals/tier1.md` for the manual agent evals, which are the remaining M1 exit criterion.

---

## Follow-on plans (written after M1, informed by docs/spikes/)

- **M2:**
  - rule compiler (SteamDB/DiE/BOS);
  - catalog seed importers;
  - web-extract shims + BYO service worker;
  - prebuilt runtime CI;
  - `rt-easyrpg`, `rt-scummvm`, `rt-idtech`, `known-port` self-host;
  - `rebuild-renpy`, `rebuild-love`, `remote-play`;
  - Copilot/OpenCode status hooks;
  - shell `video.js` (cutscenes) and `sw.js` (offline cache / COI injection), which no M1 lane needs.
- **M3:** spikes (f)/(g) → `win-bottleship`, `win-boxedwine`, `win-dosboxx`, `win-v86`.
- **M4:**
  - spikes (h)/(j) → `src-port`, `src-engine-export`, `rebuild-godot`, `rt-mkxpz`, `rt-ags`, `rt-dirplayer`, `rt-butterscotch`, `rt-cheerpj`;
  - `rewrite-html5` (Ghidra 12.1.4 + JDK 21 headless driver);
  - `decomp-rebuild`.
- **M5:** `recomp-x86` (fork retro-port `template/`, cross-OS native build).
- **M6:** Tier 2 wrappers, `pag host worker|pages`, docs site, the v1.0 legal-read gate.
