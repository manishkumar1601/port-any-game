# 06 - Agent ecosystem: tools and skills to bundle, mention as optional, or avoid

- Status: research note for planning "port-any-game". Not a design.
- As of: **2026-11-17**. Versions and dates come from the GitHub repo/release APIs (until rate-limited), GitHub release pages, the npm and PyPI registries, jsDelivr mirrors of repo files, the skills.sh search API and vendor docs, all read that day unless marked.
- Scope: binary-analysis tooling agents can drive, existing skills and plugins near our problem, browser-QA tooling, OpenCode v2 in detail (Tier 1), and Codex `agents/openai.yaml`. Note 01 already covers the Agent Skills spec, per-agent plugin formats, hooks, `npx skills` and rulesync; this note does not repeat them.
- Constraint used for every judgement: plugin scripts are **Node 22, zero-dependency**, the plugin must be self-contained on Windows, macOS and Linux, and companions are fine only if clearly optional.
- Markers: **[unverified]** means a single, secondary or third-party source, or a claim we could not check against the project itself. **[estimate]** means our planning guess.

---

## TL;DR

1. **Binary analysis default: Ghidra headless, driven by our own Node script and bundled Java GhidraScripts. No MCP is needed.**
   - It is the only free, cross-OS, headless decompiler that is mature enough (Apache-2.0, NSA, about 100k stars).
   - The same pattern is already used in public skills: `mitsuhiko/agent-stuff` `ghidra` and `trailofbits/skills-curated` `ghidra-headless`. Each runs `analyzeHeadless` with Java export scripts. Their wrappers are bash, so we rewrite the wrapper in Node.
   - **Pin Ghidra 12.1.4 + Temurin JDK 21 for now.** Ghidra 12.2 (2026-10-22) **requires JDK 25**, and the main MCP companions (GhidraMCP 2.0, bethington/ghidra-mcp 7.0.0, REA's Windows profile) are built or verified against 12.1.4. Ghidra GUI extensions are tied to one Ghidra version.
   - Install it **only for the recompilation and rewrite lanes, only after the user consents, project-local, pinned and checksummed**. The Ghidra 12.2 zip alone is 543 MB.
2. **MCP servers for binary analysis are optional companions, never requirements:**
   - pyghidra-mcp: headless, Apache-2.0, needs Python and uv.
   - GhidraMCP (LaurieWired): needs the Ghidra GUI running.
   - r2mcp: MIT, small, radare2 is LGPL.
   - ida-pro-mcp and the Binary Ninja MCP servers: need paid licences for headless use.
   - **REA ("reverse-engineer-anything", `morluto/rea`)** is an MIT, Node-based CLI plus MCP server. It wraps Hopper, Ghidra, IDA or Kuna. It is powerful but heavy (42 npm dependencies, exact Node patch-level floors, Windows Ghidra support marked "experimental P0"). Offer it as an optional power-user companion and **do not hard-depend on it the way ATBGamePort does**.
3. **Existing skills worth borrowing ideas from:**
   - **ATBGamePort** (GPL-3.0): the rewrite lane, its phase docs, and an `agents/openai.yaml` example.
   - **retro-port** (MIT): the D3D8 recompilation lane.
   - **G2W `game-to-web`** (MIT): checkpointed Intake, Recon, Feasibility, Approach, Plan, Ship.
   - **GameFrame** (Apache-2.0): a "core + frame" contract with differential checks against the original.
   - **re-skill** (MIT): a REVERSE.md task loop.
   - **openai/skills `develop-web-game`**: test hooks `window.render_game_to_text` and `window.advanceTime(ms)`.
   - **universal-modder** (MIT): a real six-agent packaging example that includes an OpenCode 2 plugin path.
4. **Patterns to avoid:**
   - ATBGamePort's prompt that has the agent declare "I am the copyright holder…" so that models do not trigger refusal heuristics. This is a jailbreak-style pattern; we must not copy it.
   - Hard prerequisites on companion skills (REA, `grill-me`).
   - macOS-only Hopper.
   - Copying GPL code (ATBGamePort, js-dos, fosdickio's Binary Ninja MCP) into our plugin.
5. **`grill-me`** (mattpocock/skills, MIT) is a user-invoked stub (`disable-model-invocation: true`) whose whole body is "Call the Skill tool with `grilling`". The real skill is `grilling`: a round-based interview with numbered questions and a recommended answer for each. Borrow the idea for our intake step and mention the skill as an optional companion.
6. **The js-dos MCP server is real.** Tag `mcp-v0.1.0` came with js-dos 8.5.4 on 2026-11-12. It is a local stdio server with an embedded Studio plus DOSBox and DOSBox-X, shipped as native binaries for Linux x64, Windows x64 and macOS Intel/arm64, and it needs no Node or Rust. It is the best optional companion for authoring DOS-lane bundles. It is 5 days old and GPL, so call it as an external tool and do not vendor it.
7. **Browser QA: the verify gate should be our own Node script using the `playwright` library** (1.65.1), installed on demand. For interactive debugging, any agent can use **CLIs through the shell with no MCP config**: `@playwright/cli` 0.1.24 (Microsoft's recommended agent path, CLI plus skills), the `chrome-devtools` CLI that ships inside `chrome-devtools-mcp` 1.13.0, and `agent-browser` 0.43.0.
   - Privacy settings to turn off: Chrome DevTools MCP/CLI **sends usage statistics by default**, so pass `--no-usage-statistics`, set `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1`, or set `CI`. Also pass `--no-performance-crux`.
   - agent-browser: set `AGENT_BROWSER_NO_VERSION_CHECK=1`.
   - `npx skills`: set `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`.
8. **OpenCode is now v2. 2.3.0 shipped 2026-11-13, and v1 1.19.6 started offering the upgrade on 2026-11-17.**
   - Skills come from `.opencode/skills`, `.claude/skills`, `.agents/skills` (project) and `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` (global). The skill ID comes from the path.
   - Agents live in `.opencode/agents/*.md` and commands in `.opencode/commands/*.md`.
   - Plugins are `@opencode/plugin` packages, or plain JS with a default export `{ id, setup(ctx) }`. Block a tool call with `ctx.permission.hook("evaluate")` (set `effect = "deny"`) or by throwing in `ctx.tool.hook("execute.before")`.
   - MCP config goes under `mcp.servers`. v2 reads **only `AGENTS.md`**, with no `CLAUDE.md` fallback.
   - It runs natively on Windows (x64/ARM64 binaries, npm `@opencode/cli`). WSL is optional.
   - **It does not read `.claude-plugin/marketplace.json`, Claude agents, commands or hooks.** Only the `.claude/skills` folders are shared. Packaging recipe in section 5.
9. **Codex `agents/openai.yaml`** has three blocks:
   - `interface`: `display_name`, `short_description`, `icon_small`, `icon_large`, `brand_color`, `default_prompt`.
   - `policy`: `allow_implicit_invocation`, default true.
   - `dependencies.tools[]`: `type: "mcp"` (the only type), with `value`, `description`, `transport`, `url`.
   OpenAI's skill-creator adds two rules: `short_description` is 25-64 characters, and `default_prompt` must mention `$skill-name`.

---

## 1. Binary-analysis tooling agents can drive (Q1)

### 1a. Comparison

"Headless" means it works with no GUI session open. "Install effort" assumes no admin rights.

| Tool | What it is | License | Win / mac / Linux | Install effort | Headless | Maturity, latest release |
|---|---|---|---|---|---|---|
| **Ghidra** (NSA) | Disassembler and decompiler; `analyzeHeadless` + Java or PyGhidra scripts | Apache-2.0 | Yes / Yes (10.13+) / Yes (Win10 1809+) | High: **12.2 needs JDK 25**; the zip is 543 MB, plus a JDK [estimate ~200 MB]. 12.1.x needs JDK 21 | **Yes** (`support/analyzeHeadless`) | Very mature (~100k stars). **12.2, 2026-10-22**. PyGhidra 3.2.0 (2026-10-22) has been the default script engine since 12.0 |
| **GhidraMCP** (LaurieWired) | Ghidra GUI extension (HTTP :8080) + Python MCP bridge (`uvx --from git+…GhidraMCP ghidra-mcp`) | Apache-2.0 | Yes / Yes / Yes | Medium: Ghidra **12.1.4**, extension zip, uv or Python 3.10+ | **No**: needs the Ghidra GUI running with the plugin enabled | 11.9k stars; **2.0, 2026-10-10** |
| **bethington/ghidra-mcp** (largest fork) | GUI plugin + headless server, 209 MCP tools, Docker | Apache-2.0 | Yes / Yes / Yes | Medium: Ghidra 12.1.4, Java 21, Python bridge wheel | **Yes** (190 headless endpoints) | 6.3k stars; **7.0.0, 2026-10-21** |
| **pyghidra-mcp** (clearbluejar) | Headless-first MCP over PyGhidra; optional `--gui`; separate `pyghidra-mcp-cli` HTTP client | Apache-2.0 | Yes / Yes / Yes | Medium: Ghidra + JDK + Python >= 3.10 + uv; `uvx pyghidra-mcp --transport streamable-http --project-path …` | **Yes** (designed for it; one long-running server avoids 10-60 s Ghidra start-up per call) | 467 stars; **0.3.0, 2026-11-02** (MCP SDK 1 and 2) |
| GhidrAssistMCP (now `symgraph/GhidrAssistMCP`) | Native Ghidra extension; can start from `analyzeHeadless` | MIT | Yes / Yes / Yes | Medium | Yes [unverified] | 813 stars; targets 12.1 |
| ReVa (`cyberkaida/reverse-engineering-assistant`) | Ghidra extension MCP | Apache-2.0 | Yes / Yes / Yes | Medium | Not checked | 964 stars; last release not checked (API rate limit) |
| **ida-pro-mcp** (mrexodia) | IDA plugin MCP; **`idalib-mcp`** is the recommended headless supervisor | MIT (the tool); IDA is proprietary | Yes / Yes / Yes | High: **IDA Pro 8.3+ (9 recommended); IDA Free is not supported**; idalib must be activated; uv | Yes, via idalib (needs an IDA Pro licence) | 13.5k stars; repo active 2026-11-12; last tagged release 1.4.0 (2025-10-06); README says install from `main` |
| **Binary Ninja MCP** (Vector35, official) | GUI server (HTTP) and headless `binaryninja_mcp` (stdio only) | Proprietary | GUI server: all three. Headless: **macOS/Linux only; native Windows packages do not include it yet** | High (paid) | **Commercial/Ultimate only**; Free and Personal get only the GUI server | Current docs, 2026 |
| fosdickio/binary_ninja_mcp | Community Binary Ninja plugin + MCP | **GPL-3.0** | Yes / Yes / Yes | High (needs Binary Ninja) | No (plugin) | 461 stars; v1.2.1, 2026-03-22 |
| **radare2** + **r2mcp** | CLI reverse-engineering framework + MCP stdio server; read-only mode, sandbox lock, tool restriction | radare2 LGPL-3.0; r2mcp MIT | Yes (13.3 MB zip) / Yes (pkg) / Yes (deb, tar) | Low-medium: `r2pm -Uci r2mcp`; r2mcp ships a Windows zip, a .deb and a **Codex plugin** tarball | **Yes** | radare2 **6.2.6, 2026-11-05**; r2mcp **1.9.0, 2026-10-15** (366 stars). radare2 also ships **WASI builds** (18-105 MB) |
| **Rizin** / Cutter | radare2 fork CLI (`rizin`, `rz-bin`, `rz-asm`) / Qt GUI | Rizin LGPL-3.0; Cutter GPL-3.0 | Yes (installers) / Yes (pkg) / Yes (static tar, AppImage) | Low-medium | Rizin yes, Cutter no | Rizin **0.9.1, 2026-06-29**; Cutter **2.5.0, 2026-06-30**. No official MCP found. Cutter bundles the rz-ghidra decompiler [unverified] |
| **REA** (`morluto/rea`, npm `rea-agents`) | One CLI + MCP server for agents. Native analysis goes through Hopper, Ghidra, IDA or Kuna. Built-in static readers for JS/Electron, .NET, Unity IL2CPP metadata, Godot PCK, PyInstaller, LNK, WASM (with caller-supplied WABT) and more | MIT; the backends keep their own licences | Native analysis: macOS/Linux mainly; **Windows Ghidra is an "experimental P0" profile, read-only**; Hopper is not on Windows | Medium-high: `npx rea-agents setup` registers the MCP server with many agents, OpenCode included. **Node ^22.23.4, ^24.22.1 or >=26.12.1**; 42 runtime deps (playwright-core, node-pty, isomorphic-git, …) | Yes (CLI + stdio MCP) | **6.9.0, 2026-11-12**; releases about every 1-3 weeks. Repo created 2026-04-14. GitHub reports 465k stars, which is implausible; treat popularity numbers as unreliable. Gen Agent Trust Hub rated the skill **MEDIUM risk** (2026-08-12) [third-party] |
| Kuna (`Noelo-Lab/kuna`) | Single-executable static decompiler, used by REA | Apache-2.0 | REA verified 1.990 on macOS arm64 only | Low (one binary) | Yes | [unverified] beyond REA's docs |
| **Capstone** | Disassembler library; `cstool` CLI | BSD-3-Clause | Yes / Yes / Yes | Low; but the PyPI package needs Python | Yes | Stable 5.0.x; **6.0.0-Alpha11, 2026-09-21** |
| **LIEF** | Executable-format library (Python/C++/Rust) | Apache-2.0 | Yes / Yes / Yes | Low with Python; **the only shipped CLI is `lief-patchelf` (ELF only)**, as we found by listing the 1.0.0 Windows tools zip | n/a | **1.0.0, 2026-07-12** |
| Hopper | Commercial disassembler; ATBGamePort's main tool | Proprietary | **No** / Yes / Yes | Paid (demo mode exists) | `hopper -e … -Y script.py` | n/a |

### 1b. Which one should a cross-OS, free, self-installable plugin use by default?

**Ghidra headless, with no MCP in between.** Reasons:

- **Free and cross-OS.** Ghidra is free and runs on all three OSes. Of the free tools, only Ghidra and rz-ghidra give pseudocode good enough for the rewrite lane, and the recompilation lane also needs function boundaries, xrefs, RTTI and vtables.
- **No MCP config to maintain.** An MCP server would need configuring separately in every agent. A Node script that runs `analyzeHeadless <proj> <name> -import <exe> -postScript ExportAll.java <outdir> -scriptPath <skill>/ghidra` once, then writes JSON and C files, works in every agent through the shell. The agent then greps those files. This is the approach used by the `mitsuhiko/agent-stuff` `ghidra` skill (Apache-2.0) and by Trail of Bits' curated `ghidra-headless` skill.
- **Java scripts need no Python.** The JDK that Ghidra needs anyway compiles them, so we avoid PyGhidra.
- **Version pin.** Use **Ghidra 12.1.4 + Temurin JDK 21** until the GhidraMCP, bethington and REA companions publish 12.2 builds. Allow `--ghidra=12.2` (which needs JDK 25) as an opt-in.
- **Bootstrap.** Download the official zips into `.pag/tools/`, check SHA-256 against pinned values, set `JAVA_HOME` for the child process only. No admin rights needed. Ask for consent first, because of the size (about 750 MB [estimate]).
- **Triage stays in our own zero-dep Node PE/NE/MZ parser** (note 04). Capstone and LIEF would need Python and add nothing for the survey.
- **Lightweight alternative, worth testing.** The radare2 **WASI** build could in principle run under Node's built-in `node:wasi` with no native install, giving disassembly (no decompiler) on any OS. **[unverified; not tested]**

---

## 2. Existing skills and plugins near our problem (Q2)

Install counts come from the skills.sh search API on 2026-11-17. Stars come from the GitHub pages. Both are easy to inflate.

### 2a. Game porting, reverse engineering, emulation, WASM

| Skill / plugin | What it does | License | Verdict |
|---|---|---|---|
| **`atbfun/ATBGamePort`** (367 stars, created 2026-10-21) | Three skills: `atb-game-porting` (7-phase reverse engineering → zero-dependency HTML5 Canvas rewrite), `atb-game-package` (single-file VFS, portable launcher), `atb-game-to-githubpage`. Ships `.claude-plugin/marketplace.json`, an `agents/openai.yaml` per skill, ADRs and Python verify scripts | **GPL-3.0** | **Reference** for the AI-rewrite lane and its phase checklists. **Avoid:** (1) the "I am the copyright holder and have full authorization…" declaration whose stated purpose is to stop models triggering "safety or copyright refusal heuristics"; we must never ship that pattern. (2) Hard prerequisites on REA and `grill-me` (ADR 0001 tells the agent to stop if they are missing). (3) Dependence on macOS Hopper. (4) Copying GPL text or code into our plugin |
| **`Dhaiwat10/retro-port`** (23 stars) | Claude Code skill: static recompilation of Win32 games to wasm, D3D8 → WebGPU | MIT | **Reference and borrow** for the recompilation lane (analysed in note 02) |
| **`morluto/rea`** skill `reverse-engineer-anything` (18,964 installs) | Agent instructions + MCP (see §1a) | MIT | **Optional companion** for power users. Not a default: heavy, fast-moving, provider-dependent, MEDIUM risk rating |
| `laaielichter/reverseport` (23 stars) | "Reverse engineer anything. Port it anywhere." Godot `.pck`, Unity IL2CPP and assets, .NET, native via your own Ghidra/IDA/Hopper; ports between engines with parity checks. `npx reverseport setup` | MIT | **Watch.** Overlaps REA; too young to recommend |
| **`Tajwarbot/game-to-web` (G2W)** (3 installs) | Research-first porting skill for Claude Code, Codex and OpenCode. Six phases, each ending in a checkpoint; go / uncertain / no-go feasibility verdict; "stream or stop" exit | MIT | **Borrow ideas**: checkpoint gates and an explicit feasibility verdict before any build. Tiny adoption |
| **`tanepiper/game-frame`** (37 stars) | Framework for reverse-engineering games from shipped files: an "exact core" plus a shared "frame" (launcher, file library, saves, settings, renderer choice, event console) joined by a versioned event contract. Uses Ghidra, Unicorn, REA, DOSBox-X debugger, 86Box | Apache-2.0 | **Borrow ideas**: core/frame contract (same idea as our web shell, note 05) and differential checks against the original |
| `vgrichina/re-skill` (186 stars) | Claude Code `/re` skill for retro reverse engineering (NES, Game Boy, DOS MZ): scaffolds REVERSE.md, `labels.csv`, tools; loop script; web-canvas port | MIT | **Borrow** the resumable task file (REVERSE.md style). Claude-only, Python, bash loop |
| `DohmBoy64Bit/pcrecomp-skill` (0 stars) | Cursor skill: playbook for `sp00nznet/pcrecomp` (PE analysis → disasm → lift → shim → native build) | MIT | **Reference** for the recompilation pipeline steps. Its output is native, not wasm |
| `rehan-remade/universal-modder` (9.7k stars) | Modding skills + `um` CLI + fal MCP for six agents | MIT | **Reference for packaging**: one install table for Claude/Codex/Gemini/Copilot/Cursor/OpenCode; OpenCode 2 via `opencode plugin add 'github:…#main::path:plugins/opencode'` |
| `trailofbits/skills-curated` → `ghidra-headless` (612 installs) | Curated Claude Code plugin marketplace; `analyzeHeadless` skill | Not checked | **Borrow** the headless pattern; check the licence before copying any script |
| `mitsuhiko/agent-stuff` → `ghidra` (674 installs) | Bash wrapper + Java export scripts (`ExportDecompiled.java`, `ExportFunctions.java`, …) | Apache-2.0 | **Borrow the structure** (Apache-2.0 allows reuse with attribution); rewrite the wrapper in Node |
| `bytelandtechnology/headless-ghidra` (128 installs) | Headless Ghidra batch-decompile skill family | Not checked | Skip |
| `mohitmishra786/low-level-dev-skills` → `wasm-emscripten` (585 installs) | Emscripten porting of C/C++ libraries | MIT | **Reference only.** Our Emscripten playbook is in note 03 |
| `basementstudio/mcp-dos` (4 stars) | MCP that launches bundled DOS games via js-dos | Not checked | **Avoid** (toy; not for authoring) |
| **js-dos MCP** (`caiiiycuk/js-dos`, tag `mcp-v0.1.0`, 2026-11-12) | Local stdio MCP with embedded Studio + DOSBox/DOSBox-X; edits bundles; keyboard/mouse scenarios; screenshots; exports standalone HTML/Vite/React/Vue/Angular projects; "build checks require permission; browser diagnostics are opt-in" | GPL-2.0 (js-dos) [assumed for the MCP too] | **Optional companion for the DOS lane.** Call the external binary; never vendor it |

### 2b. Planning and interview skills

| Skill | Facts | Verdict |
|---|---|---|
| **`mattpocock/skills` → `grill-me`** | MIT (©2026 Matt Pocock). Path `skills/productivity/grill-me/SKILL.md`. Frontmatter `disable-model-invocation: true`; the body is only "Call the Skill tool with "grilling"". `grilling` interviews the user in **rounds over a design tree**: it asks every question whose prerequisites are settled, numbers them, gives a recommended answer for each, and words each question so that "yes" accepts the recommendation. Also in the official Claude marketplace as `mattpocock-skills`; `grill-with-docs` adds glossary and ADR updates | **Borrow the method** for our intake (owned copy? which store? which OS? target hosting? accept GPL runtime?). Mention it as optional. **Do not require it.** Note that the stub's "Call the Skill tool" wording is Claude-specific |

### 2c. Browser QA and catalog entries

| Item | Where | License | Verdict |
|---|---|---|---|
| `microsoft/playwright-cli` skill (218,901 installs) | skills.sh; `playwright-cli install --skills` | Apache-2.0 | **Optional companion** for interactive debugging |
| `vercel-labs/agent-browser` (1,484,019 installs) | skills.sh; `agent-browser skills get core` | Apache-2.0 | Optional; useful WebGPU/SwiftShader switches |
| `anthropics/skills` → `webapp-testing` (207,197 installs) | skills.sh | Not checked | Reference only |
| openai/skills `.curated/develop-web-game` | Codex curated catalog; `scripts/web_game_playwright_client.js`; game exposes `window.render_game_to_text` and `window.advanceTime(ms)`; screenshots are the source of truth [details from mirrors] | Per-skill `LICENSE.txt` (not read) | **Borrow** the two test hooks for lanes we control (rewrite lane, source ports) |
| openai/skills `.curated/playwright` | Codex curated wrapper around `playwright-cli` | Not checked | Shows that OpenAI also routes agents to the CLI |
| Claude official marketplace (`anthropics/claude-plugins-official`, 317 plugins) | Relevant entries: `playwright` (Microsoft MCP), `chrome-devtools-mcp`, `browser-use`, `mattpocock-skills`, `unity` (Unity official), `unreal-engine-skills-for-claude-code` (Epic official) | Various | Reference. Unity and Unreal plugins only matter when the user has the project source |

---

## 3. Browser-QA tooling for agents (Q3)

| Tool | Version (date) | License, runtime | Needs MCP config? | How a plugin uses it cross-agent | Privacy settings |
|---|---|---|---|---|---|
| **`playwright` library** (our verify script) | **1.65.1** (1.66 alphas daily) | Apache-2.0; Node >= 20 | No | `node pag.mjs verify` installs `playwright@1.65.1` into `.pag/tools` on first use and keeps browsers local with `PLAYWRIGHT_BROWSERS_PATH`. This is the deterministic pass/fail gate from note 05 | No telemetry documented. Browser binaries download from Playwright's CDN |
| **Playwright CLI** `@playwright/cli` | **0.1.24** (2026-11-10) | Apache-2.0; Node >= 18 | **No** | `npx -y @playwright/cli@0.1.24 open <url>`. Skills: `playwright-cli install --skills` (`.claude/skills/playwright-cli`), `--skills=agents` (`.agents/skills/…`), `-g` (home). Also works without skills: tell the agent to read `playwright-cli --help`. Headless by default; named sessions; headless sessions close after 1 h idle | No telemetry documented |
| Playwright MCP `@playwright/mcp` | **0.0.85** (2026-11-09) | Apache-2.0; Node >= 18 | **Yes**, per agent | Only through each host's MCP config (Claude `.mcp.json`, OpenCode `mcp.servers`, Codex `config.toml`, …) | No telemetry documented. Use `--isolated` for a throwaway profile |
| **Chrome DevTools MCP** + **`chrome-devtools` CLI** | **1.13.0** (2026-11-11) | Apache-2.0; Node ^20.19, ^22.12 or >= 23; Chrome or Chrome for Testing only | MCP yes; **CLI no** | `npx -y chrome-devtools-mcp@1.13.0` (MCP) or the `chrome-devtools` bin (CLI) for performance traces and source-mapped console. Ships skills (`chrome-devtools-cli`, `memory-leak-debugging`, …) and a Claude/Copilot/Gemini plugin | **Usage statistics are ON by default.** Turn off with `--no-usage-statistics`, `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS=1`, or `CI`. Performance tools may send trace URLs to CrUX: `--no-performance-crux`. Set both, always |
| **agent-browser** | **0.43.0** (2026-11-12) | Apache-2.0; native Rust CLI from npm (Node >= 22); Windows x64, macOS, Linux | **No** | `npx agent-browser …`; `agent-browser install` downloads Chrome for Testing; `skills get core` keeps instructions matched to the installed version. Has a WebGPU switch and SwiftShader Vulkan for GPU-less Linux; `doctor` | No telemetry documented. **`AGENT_BROWSER_NO_VERSION_CHECK=1`** stops a per-session fetch of the Chrome Releases blog |
| `npx skills` (if we tell users to install companions with it) | **1.9.0** (2026-11-16) | MIT; Node >= 22.20 | n/a | n/a | Collects anonymous usage data. **`DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`** turns off telemetry and security-audit requests |

**What a plugin can rely on without MCP config:** the `playwright` library through our own script (the strongest guarantee), `@playwright/cli`, the `chrome-devtools` CLI and `agent-browser`. All are run through the agent's shell, so they work in Claude Code, Codex, OpenCode, Copilot, Cursor, Gemini/Antigravity and the rest. MCP servers only help agents whose config the user has edited (or that a plugin manifest configures), so keep them optional.

---

## 4. OpenCode, verified (Q4)

Sources: opencode.ai docs (the v2 docs are now the default at `/docs`; v1 docs are kept under `/v1/docs`), the changelog, and the npm registry. The repo is **`anomalyco/opencode`** (MIT); `sst/opencode` is the old name.

| Topic | OpenCode v2 (current) | v1 (1.19.x, still installed widely) |
|---|---|---|
| **Version** | **2.3.0** (2026-11-13; npm `@opencode/cli` latest 2.3.0). Daily `0.0.0-dev-*` tags | **1.19.6** (2026-11-17; npm `opencode-ai`), which **"now offers the upgrade to OpenCode 2.0"** |
| **Install** | `curl -fsSL https://opencode.ai/v2/install \| bash`, `brew install anomalyco/tap/opencode-v2`, `npm i -g @opencode/cli` (a postinstall step picks the native binary), bun/pnpm/yarn/Vite+, `mise use -g opencode` (mise >= 2026.10.9), AUR `opencode-beta`, or standalone zips. **"Windows package managers are not supported."** Docker `ghcr.io/anomalyco/opencode:<ver>` | `npm i -g opencode-ai`, install script, etc. |
| **Windows** | **Native**: CLI zips for Windows x64, x64-baseline and ARM64; Desktop `.exe` for x64 and ARM64. Recent changelog items: local Windows shell commands run through a process daemon (2.3.0); Microsoft Store PowerShell 7 support; multi-line PowerShell 7 commands fixed; Desktop has a WSL distribution picker. **WSL is optional.** The default shell on Windows is not documented [unverified] | Docs: "can run directly on Windows, we recommend using WSL" |
| **Config files** | `opencode.json(c)` in the project root and in `.opencode/` (every `.opencode` config overrides every direct one); global `~/.config/opencode/opencode.json(c)`; managed/system `%ProgramData%\opencode` (Windows), `/etc/opencode`, `/Library/Application Support/opencode`; macOS MDM domain `ai.opencode.managed`. On Windows, `~/.config/opencode` means `%USERPROFILE%\.config\opencode` [secondary sources] | Same paths; different keys (below) |
| **Skills: where** | Project: `.opencode/skills` (also legacy `.opencode/skill`), plus compatibility dirs **`.claude/skills` and `.agents/skills`**, searched from the cwd up to the project root. Global: `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills`. Extra sources: a `skills: [...]` array of local paths or **HTTP catalogs** (`index.json` with `name`, `version`, `files`) | Same three families; `skills: { paths, urls }` |
| **Skills: rules** | **The ID comes from the path** (`<src>/x/SKILL.md` → `x`); `name` is only a display label. Precedence, lowest to highest: built-in → `.claude/skills` → `.agents/skills` → `~/.config/opencode/skills` → `.opencode/skills` → config `skills`. The same ID in several sources resolves to one skill (later source wins). `metadata.opencode/autoinvoke: false` or `disable-model-invocation: true` hides a skill from the model. `license` and `compatibility` are accepted but ignored. A prompt can force a skill with `@skill-id`. Permission action `skill` | Similar |
| **Agents / subagents** | Markdown in `.opencode/agents/<id>.md` or `~/.config/opencode/agents/` (a nested path becomes `team/x`). Frontmatter = the `agents` config entry: `description`, `mode` (`primary`, `subagent`, `all`), `model` (`provider/model#variant`), `permissions` (ordered `{action, resource, effect}` list, last match wins), `steps`, `hidden`, `color`, `disabled`. The body is the system prompt. **Subagents always run in the background**; the parent's `subagent` permission controls which ones it may launch | `.opencode/agent/` or `agents/`; fields `tools`, `permission`, `prompt`, `temperature`, `maxSteps` (v2 still translates these, with a deprecation warning) |
| **Commands** | `.opencode/commands/<name>.md` or `~/.config/opencode/commands/` (legacy `command/` also read). The body is the template with `$ARGUMENTS`. Frontmatter: `description`, `agent`, `model`, `subagent`. Also a `commands` map in config (`template` required) | `command/`; `subtask` instead of `subagent`; separate `variant` |
| **Instructions** | **`AGENTS.md` only.** Global `~/.config/opencode/AGENTS.md`, then every `AGENTS.md` from the workspace up to home (or the project root), plus nested files loaded lazily as the agent reads those areas. **No `CLAUDE.md` fallback.** Extra files, globs or URLs via `instructions: [...]` | Had a `CLAUDE.md` fallback |
| **Plugins: install** | Config key **`plugins`** (array of npm names with versions, local dirs, `file://` URLs, or `{package, options}`); auto-discovery of `.ts`/`.js` files and package dirs in `.opencode/plugins/` and `~/.config/opencode/plugins/`. CLI: `opencode plugin add\|list\|check\|update\|remove`, which manages **global package plugins** and accepts git specs including **`github:owner/repo#tag::path:subdir`**. Exact versions and full commit hashes stay pinned. TUI-only plugins go in `cli.json` | Key `plugin`; npm plugins installed with Bun into `~/.cache/opencode/node_modules`; local `.opencode/plugins/` |
| **Plugins: write** | Package `@opencode/plugin` (2.3.0). `export default Plugin.define({ id, setup(ctx) { … } })`. Parts: server (`.`), `./tui`, `./gui-experimental`, `./rpc`. A local dir without `package.json` uses `server`/`index`, `tui`, `rpc` files. The context offers transforms for agents, commands (`editor.add({name, description, execute})`) and skills (`editor.add`, using branded types from `@opencode/plugin`); `storage`, `session`, `mcp`, `permission`, `shell` and `tool` hooks | `@opencode-ai/plugin` (latest 1.1.4 on that dist-tag line); `export const X: Plugin = async (ctx) => ({ "tool.execute.before": … })` |
| **Blocking a tool call** | Two documented ways: (1) **`ctx.permission.hook("evaluate", e => { e.effect = "deny"; e.message = "…" })`**. It runs for `allow` and `ask` decisions; an explicit configured `deny` is already final; the `message` becomes the denial reason the model sees. (2) **`ctx.tool.hook("execute.before", e => { throw new Error("…") })`** (the migration guide's equivalent of v1's throw). With no code: `permissions` rules in config (`shell` resources are raw command text; the scanner understands Bash, Zsh, POSIX sh and PowerShell; matching is case-insensitive on Windows) | Throw in `"tool.execute.before"`; `permission.ask` hook |
| **One package for both versions** | Default-export one object containing V2 `id` + `setup()` **and** a V1 `server()` that returns V1 hooks. V2 ignores `server()`. Supported from V1 **1.18.29** | Same |
| **MCP** | `mcp.servers.<name>`: `{type:"local", command:[…], cwd, environment, timeout, disabled}` or `{type:"remote", url, …}` (OAuth by default; `/mcps` to sign in). **`disabled`, not `enabled`.** `{env:NAME}` substitution. `opencode mcp add <name> [--global] --url …`. A higher-precedence config replaces the whole server object | `mcp.<name>` directly; `enabled` |
| **Permission action renames** | `shell` (was `bash`), `subagent` (was `task`), `edit` (covers write and patch), plus `read`, `glob`, `grep`, `webfetch`, `websearch`, `skill`, `external_directory` | Old names |
| **Claude compatibility** | Reads **`.claude/skills` and `~/.claude/skills` only.** **No support for `.claude-plugin/plugin.json` or `marketplace.json`, `.claude/agents`, `.claude/commands`, `CLAUDE.md` or Claude hooks** (none documented). 2.2.3 added a "Claude Agent" *provider* (uses your Claude Code login), which is unrelated to plugins. Community bridges exist (oh-my-opencode's Claude compatibility layer; `@koriit/opencode-claude-bridge`, which reads `marketplace.json` through `claude plugin marketplace list --json`) [unverified] | Similar, plus the `CLAUDE.md` fallback |
| Logs and data | `~/.local/share/opencode/log/opencode.log`, `opencode.db` | Similar |

---

## 5. OpenCode packaging recipe (exact)

Goal: one source tree that works in OpenCode v2 (primary) and degrades cleanly on v1, with nothing for the user to install beyond Node 22.

### 5.1 Files we ship

```text
skills/port-any-game/            # canonical skill (dir name == frontmatter name == ID)
  SKILL.md
  scripts/pag.mjs                # zero-dep Node 22 entry (survey, ghidra, verify, ...)
  ghidra/*.java                  # export GhidraScripts
  agents/openai.yaml             # Codex metadata (ignored by OpenCode)
opencode/                        # OpenCode-specific wrappers (copied by the installer)
  agents/pag-surveyor.md
  commands/port-game.md
  plugin/package.json            # {"name":"opencode-port-any-game","type":"module","exports":{".":"./index.js"}}
  plugin/index.js                # guard + /port-game command, zero deps, dual v1/v2
  plugin/guard.mjs               # same check() the other hosts' hooks call
  opencode.jsonc.example
AGENTS.md                        # short pointer block (OpenCode v2 reads nothing else)
```

### 5.2 Install routes (document all three; the installer automates 1 and 2)

1. **Skills only (any OpenCode version, no plugin):**
   - Copy `skills/port-any-game/` to `.agents/skills/port-any-game/` in the project (shared with Codex, Cursor, Copilot, Gemini, …), or to `.opencode/skills/` for OpenCode only. For all projects: `~/.config/opencode/skills/port-any-game/` (Windows: `%USERPROFILE%\.config\opencode\skills\port-any-game\`) or `~/.agents/skills/`.
   - A `.claude/skills` copy may exist next to it: OpenCode deduplicates by ID, unlike Codex, which shows both copies.
2. **Project wrappers:** copy `opencode/agents/*` → `.opencode/agents/`, `opencode/commands/*` → `.opencode/commands/`, `opencode/plugin/` → `.opencode/plugins/port-any-game/`. Write `opencode.jsonc` from the example only if the project has none; otherwise print the lines to merge. Our installer is `node scripts/install.mjs --host=opencode [--global]`; with `--global` it targets `~/.config/opencode/{skills,agents,commands,plugins}`.
3. **v2 plugin, no clone:** `opencode plugin add 'github:OWNER/port-any-game#vX.Y.Z::path:opencode/plugin'`. Always pin a tag. This installs globally and gives the guard and the `/port-game` command; the skill still comes from route 1 (the same split universal-modder uses).

### 5.3 File contents

`opencode/agents/pag-surveyor.md` (v2 format; v1 ignores `permissions` [unverified], so the guard plugin is the v1 safety net):

```md
---
description: Read-only game surveyor. Fingerprints an install folder you own and writes .pag/survey.json. Use before choosing a porting lane.
mode: subagent
permissions:
  - { action: "*", resource: "*", effect: deny }
  - { action: read, resource: "*", effect: allow }
  - { action: glob, resource: "*", effect: allow }
  - { action: grep, resource: "*", effect: allow }
  - { action: external_directory, resource: "*", effect: ask }
  - { action: shell, resource: "node *pag.mjs survey *", effect: allow }
---
Run `node <skill-dir>/scripts/pag.mjs survey "<game folder>" --json` and report the verdict. Never modify the game folder.
```

`opencode/commands/port-game.md` (`@skill-id` forces the skill to load in v2):

```md
---
description: Port a PC game you own to a private browser build (survey, lane, build, verify)
agent: build
---
@port-any-game Port the game in: $ARGUMENTS
```

`opencode/plugin/index.js` (no imports from `@opencode/plugin`, so it has zero dependencies):

```js
import { check } from "./guard.mjs"; // returns a reason string to block, or "" to allow

export default {
  id: "port-any-game",
  async setup(ctx) {                                    // OpenCode V2
    await ctx.permission.hook("evaluate", (e) => {
      if (e.action !== "shell") return;
      const why = check(e.resources.join("\n"));
      if (why) { e.effect = "deny"; e.message = why; }
    });
  },
  async server() {                                      // OpenCode V1 >= 1.18.29
    return {
      "tool.execute.before": async (input, output) => {
        if (input.tool !== "bash") return;
        const why = check(String(output?.args?.command ?? ""));
        if (why) throw new Error(why);
      },
    };
  },
};
```

`opencode.jsonc.example` (v2 keys; a declarative layer that needs no code):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "permissions": [
    { "action": "shell", "resource": "wrangler deploy *", "effect": "ask" },
    { "action": "shell", "resource": "npx wrangler deploy *", "effect": "ask" }
  ],
  "mcp": { "servers": {
    "jsdos": { "type": "local", "command": ["<path-to-js-dos-mcp-binary>"], "disabled": true }
  } }
}
```

`AGENTS.md` block (v2 reads only this file):

```md
## port-any-game
To port a PC game the user owns to the browser, load the `port-any-game` skill (`@port-any-game`).
Never publish builds that contain game data. Stop if the survey reports DRM.
```

### 5.4 Checks before release

- Validate on 2.3.x (Windows native, macOS, Linux) **and** on 1.19.x. Check that the skill appears, that the subagent is listed under `subagent` permissions, that `/port-game` loads the skill, and that the guard blocks a sample command in both versions.
- Keep `@opencode/plugin` out of `dependencies`. If we later need branded types (for example to register skills from the plugin), add it as a pinned peer dependency and drop the zero-dependency claim for that package only.

---

## 6. Codex `agents/openai.yaml` (Q5)

The official docs (learn.chatgpt.com "Build skills", mirrored at developers.openai.com/codex/skills) say the file "configure[s] UI metadata in the ChatGPT desktop app, … invocation policy, and … tool dependencies".

| Field | Meaning | Source |
|---|---|---|
| `interface.display_name` | User-facing name in skill lists and chips | Docs; skill-creator |
| `interface.short_description` | User-facing blurb; **25-64 characters** | Docs; length from skill-creator `references/openai_yaml.md` |
| `interface.icon_small`, `interface.icon_large` | Paths relative to the skill dir; convention `./assets/` (SVG or PNG) | Docs; skill-creator |
| `interface.brand_color` | Hex accent colour | Docs |
| `interface.default_prompt` | Prompt inserted when the skill is invoked; **must mention `$skill-name`** | Docs; rule from skill-creator |
| `policy.allow_implicit_invocation` | Default `true`; `false` means only explicit `$skill` invocation | Docs |
| `dependencies.tools[]` | `type` (**only `"mcp"`**), `value` (id), `description`, `transport` (e.g. `"streamable_http"`), `url` | Docs; "only mcp" from skill-creator |
| Style rules | Quote every string value; keys unquoted. Only include icons and brand colour when they are actually provided | skill-creator |

Proposed file (no dependencies, so the skill stays self-contained):

```yaml
interface:
  display_name: "Port Any Game"
  short_description: "Port a PC game you own to a private browser build"
  icon_small: "./assets/icon-small.svg"
  icon_large: "./assets/icon-large.png"
  brand_color: "#4F46E5"
  default_prompt: "Use $port-any-game to survey the game in this folder and recommend a porting lane."
policy:
  allow_implicit_invocation: true
```

ATBGamePort's version has only `display_name` and `short_description`. Their `short_description` is 71 characters, which is over the skill-creator limit. Ours is 49.

---

## 7. RECOMMENDATION (Q6)

### 7a. Bundle inside the plugin (zero-dep, all OSes)

- Skill(s) + `scripts/pag.mjs` (survey/PE parser from note 04, the Ghidra driver, the verify driver, the installer) + Java GhidraScripts (decompile all functions to C; export functions, strings, imports, xrefs, RTTI/vtables to JSON).
- Per-host wrappers: `agents/openai.yaml`, the `opencode/` folder from §5, Claude/Codex/Copilot manifests (note 01), and an `AGENTS.md` block.
- Our own intake interview, modelled on `grilling` (rounds, numbered questions, recommended answers), and checkpoint gates modelled on G2W.
- Test hooks for lanes we author: `window.render_game_to_text()` and `window.advanceTime(ms)`.

### 7b. Install on demand (consent, project-local `.pag/tools/`, pinned versions + SHA-256)

| Tool | When | Pin |
|---|---|---|
| Temurin JDK 21 + **Ghidra 12.1.4** | Recompilation and rewrite lanes only | Opt-in: Ghidra 12.2 + JDK 25 |
| `playwright@1.65.1` + Chromium (`PLAYWRIGHT_BROWSERS_PATH=.pag/tools/ms-playwright`) | Every lane's verify step | Exact version |
| emsdk | Source and recompilation lanes | See notes 03 and 05 |

### 7c. Optional companions (documented, never required, never auto-installed)

- **js-dos MCP** (DOS authoring, screenshots, scenarios).
- **`@playwright/cli` + skills** (interactive browser debugging).
- **`chrome-devtools` CLI/MCP**, always with `--no-usage-statistics --no-performance-crux`.
- **agent-browser** with `AGENT_BROWSER_NO_VERSION_CHECK=1`.
- **pyghidra-mcp** (interactive headless Ghidra; needs Python and uv).
- **GhidraMCP** or **bethington/ghidra-mcp** (users who prefer the Ghidra GUI; must match Ghidra 12.1.4).
- **r2mcp** (lightweight disassembly).
- **ida-pro-mcp** / **Binary Ninja MCP** (only if the user already owns IDA Pro, or Binary Ninja Commercial/Ultimate on macOS/Linux).
- **REA** (power users; set it up with `npx rea-agents setup`).
- **`grill-me`** from mattpocock/skills (deeper planning).
- When the docs tell users to run `npx skills add …`, prefix it with `DISABLE_TELEMETRY=1`.

### 7d. Avoid

- Hard dependencies on REA, `grill-me`, Hopper, IDA or Binary Ninja.
- GUI-only GhidraMCP as the default path.
- Any MCP server as a requirement, since each needs per-agent configuration.
- Chrome DevTools MCP with its default telemetry.
- `basementstudio/mcp-dos`.
- LIEF/Capstone (they need Python, and the Node parser already covers triage).
- **The "authorization priming" prompt pattern from ATBGamePort.**
- Vendoring GPL code (ATBGamePort, js-dos, fosdickio Binary Ninja MCP) into the plugin; run GPL runtimes as separate tools and handle their obligations as described in note 04.

---

## 8. Open risks

1. **The Ghidra/JDK split moves fast.** 12.2 moved to JDK 25 while the companions sit on 12.1.4 (JDK 21). Extension zips are tied to one version. Pinning 12.1.4 means we stay on an older Ghidra until the companions catch up.
2. **Ghidra footprint and install friction.** About 750 MB [estimate] plus a JVM. Locked-down corporate machines and antivirus may block the unpacked JDK. Headless analysis of a large MSVC C++ game can take many minutes [estimate].
3. **Decompiler quality limits the rewrite lane.** Packed or obfuscated binaries are blocked by the legal guardrails (note 04), but heavily optimised code still gives poor pseudocode.
4. **OpenCode v2 was offered to v1 users only today.**
   - The install base is mixed, the plugin API is days to weeks old, and `@opencode/plugin` publishes dev builds daily.
   - The dual-export plugin needs testing on both versions.
   - How v1 treats our v2-format agent `permissions` is [unverified].
   - The Windows global path rests on secondary sources.
5. **OpenCode does not read Claude plugin assets.** Every agent, command and guard must be generated in OpenCode's own format. Only skills are shared.
6. **REA's signals are anomalous.** 465k GitHub stars in seven months, a MEDIUM third-party risk rating and very frequent releases. Re-check before even recommending it as optional.
7. **Codex `openai.yaml` constraints come partly from skill-creator guidance**, not from the docs page (the 25-64 character limit and the `$skill-name` rule). The `dependencies` transports beyond `streamable_http` are not documented.
8. **Pre-1.0 tools.** `@playwright/cli` 0.1.x, Playwright MCP 0.0.x and the js-dos MCP 0.1.0 (5 days old) may change their flags. Telemetry defaults can change too (CDT already opts in by default).
9. **skills.sh install counts and GitHub stars are easy to game.** Do not use them as quality signals.
10. **Not verified here (GitHub API rate limit and jsDelivr cache gaps):** ReVa's latest release, the Trail of Bits skill's licence, the `develop-web-game` skill's licence and exact script flags, Rizin/rz-ghidra bundling, and Playwright's default Chromium privacy flags.

---

## Sources (all accessed 2026-11-17; release or publication date in brackets where known)

**Binary analysis**
- Ghidra repo and releases, https://github.com/NationalSecurityAgency/ghidra (API: 12.2 [2026-10-22], zip 543 MB)
- Ghidra 12.2 What's New (JDK 25), https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.2_build/Ghidra/Configurations/Public_Release/src/global/docs/WhatsNew.md (read via jsDelivr)
- Ghidra 12.2 Getting Started (OS minimums, Python ranges), https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.2_build/GhidraDocs/GettingStarted.md
- PyPI pyghidra, https://pypi.org/project/pyghidra/ (3.2.0 [2026-10-22])
- GhidraMCP, https://github.com/LaurieWired/GhidraMCP (README; release 2.0 [2026-10-10])
- bethington/ghidra-mcp release 7.0.0, https://github.com/bethington/ghidra-mcp/releases/latest [2026-10-21]
- pyghidra-mcp, https://github.com/clearbluejar/pyghidra-mcp and https://pypi.org/project/pyghidra-mcp/ (0.3.0 [2026-11-02])
- GhidrAssistMCP, https://github.com/jtang613/GhidrAssistMCP (now symgraph/GhidrAssistMCP)
- ReVa, https://github.com/cyberkaida/reverse-engineering-assistant
- ida-pro-mcp, https://github.com/mrexodia/ida-pro-mcp (README; repo API; PyPI 1.4.0 [2025-10-06])
- Binary Ninja MCP docs, https://dev-docs.binary.ninja/guide/mcp.html and https://docs.binary.ninja/guide/mcp.html
- fosdickio/binary_ninja_mcp, https://github.com/fosdickio/binary_ninja_mcp (v1.2.1 [2026-03-22])
- radare2 releases, https://github.com/radareorg/radare2/releases (6.2.6 [2026-11-05])
- radare2-mcp, https://github.com/radareorg/radare2-mcp (1.9.0 [2026-10-15])
- Rizin, https://github.com/rizinorg/rizin (v0.9.1 [2026-06-29]); Cutter, https://github.com/rizinorg/cutter (v2.5.0 [2026-06-30])
- Capstone, https://github.com/capstone-engine/capstone (6.0.0-Alpha11 [2026-09-21]); https://pypi.org/project/capstone/
- LIEF, https://github.com/lief-project/LIEF (1.0.0 [2026-07-12]; tools zip contents listed locally, not executed)
- REA, https://github.com/morluto/rea (README; docs/getting-started/installation.md; docs/providers/windows-ghidra-p0.md; docs/kuna-provider.md); npm https://www.npmjs.com/package/rea-agents (6.9.0 [2026-11-12])
- REA third-party listings: https://www.skills.sh/morluto/rea/reverse-engineer-anything/security/agent-trust-hub, https://www.developersdigest.tech/blog/reverse-engineer-anything-rea-mcp-agents-guide-2026

**Skills and plugins**
- ATBGamePort, https://github.com/atbfun/ATBGamePort (repo API; README; `.agents/adr/0001-…md`; `.agents/install-block.md`; `skills/atb-game-porting/REVERSE-ENGINEERING.md`; `agents/openai.yaml`; `.claude-plugin/marketplace.json`)
- retro-port, https://github.com/Dhaiwat10/retro-port
- mattpocock/skills, https://github.com/mattpocock/skills (README; `skills/productivity/grill-me/SKILL.md`; `skills/productivity/grilling/SKILL.md`; LICENSE)
- js-dos releases (8.5.4 and mcp-v0.1.0 [2026-11-12]), https://github.com/caiiiycuk/js-dos/releases; js-dos DOSBox-X help, https://js-dos.com/dosbox-x.html
- G2W, https://github.com/Tajwarbot/game-to-web
- GameFrame, https://github.com/tanepiper/game-frame
- re-skill, https://github.com/vgrichina/re-skill
- pcrecomp-skill, https://github.com/DohmBoy64Bit/pcrecomp-skill
- universal-modder, https://github.com/rehan-remade/universal-modder
- ReversePort, https://github.com/laaielichter/reverseport
- Trail of Bits skills-curated, https://github.com/trailofbits/skills-curated (`plugins/ghidra-headless/skills/ghidra-headless/SKILL.md`)
- mitsuhiko/agent-stuff, https://github.com/mitsuhiko/agent-stuff (`skills/ghidra/SKILL.md`)
- low-level-dev-skills, https://github.com/mohitmishra786/low-level-dev-skills
- mcp-dos, https://github.com/basementstudio/mcp-dos
- skills.sh search API, https://skills.sh/api/search?q=… (queries: emscripten, wasm, game port, decompile, retro game, reverse engineer, ghidra, playwright, browser testing, dosbox, emulator, scummvm)
- Claude official marketplace, https://github.com/anthropics/claude-plugins-official (`.claude-plugin/marketplace.json`, 317 plugins)
- openai/skills, https://github.com/openai/skills (`.curated/playwright/SKILL.md`; `.curated/develop-web-game` file list); develop-web-game description via https://mcpservers.org/agent-skills/firecrawl/openai-skills/develop-web-game and https://playbooks.com/skills/openai/skills/develop-web-game [third-party]

**Browser QA**
- Playwright CLI README, https://github.com/microsoft/playwright-cli (npm `@playwright/cli` 0.1.24 [2026-11-10])
- Playwright CLI skills, https://playwright.dev/agent-cli/skills
- Playwright MCP, https://github.com/microsoft/playwright-mcp (npm `@playwright/mcp` 0.0.85 [2026-11-09])
- npm `playwright`, https://www.npmjs.com/package/playwright (1.65.1)
- Chrome DevTools MCP README, https://github.com/ChromeDevTools/chrome-devtools-mcp (npm 1.13.0 [2026-11-11])
- agent-browser README, https://github.com/vercel-labs/agent-browser (npm 0.43.0 [2026-11-12]); configuration, https://agent-browser.dev/configuration; installation, https://agent-browser.dev/installation
- skills CLI README (telemetry), https://www.npmjs.com/package/skills (1.9.0 [2026-11-16])

**OpenCode**
- llms.txt, https://opencode.ai/llms.txt; docs index, https://opencode.ai/docs/llms.txt
- Intro/install, https://opencode.ai/docs/
- Config, https://opencode.ai/docs/config/
- Skills, https://opencode.ai/docs/skills/ (also https://opencode.ai/v2/docs/skills/)
- Agents, https://opencode.ai/docs/agents/
- Commands, https://opencode.ai/docs/commands/
- Instructions, https://opencode.ai/docs/instructions/
- Plugins (configure), https://opencode.ai/docs/plugins/; CLI plugins, https://opencode.ai/docs/cli/plugins/
- Build plugins, https://opencode.ai/docs/build/plugins/; server API, https://opencode.ai/docs/build/plugins/server/; V1 plugin migration, https://opencode.ai/docs/build/plugins/migrate-v1/
- MCP servers, https://opencode.ai/docs/mcp-servers/
- Permissions, https://opencode.ai/docs/permissions/; Tools, https://opencode.ai/docs/tools/; Troubleshooting, https://opencode.ai/docs/troubleshooting/
- Migrate from V1, https://opencode.ai/docs/migrate-v1/
- V1 Windows (WSL), https://opencode.ai/v1/docs/windows-wsl/; V1 plugins, https://opencode.ai/v1/docs/plugins/
- Changelog, https://opencode.ai/changelog (2.3.0 [2026-11-13]; 1.19.6 [2026-11-17])
- npm `@opencode/cli` 2.3.0, `@opencode/plugin` 2.3.0, `opencode-ai` 1.19.6, `@opencode-ai/plugin`: https://www.npmjs.com/package/@opencode/cli, https://www.npmjs.com/package/@opencode/plugin, https://www.npmjs.com/package/opencode-ai
- Repo, https://github.com/anomalyco/opencode
- Windows user config path [secondary]: https://bdbch.github.io/ai-dotfiles/install/windows, https://blog-022.pages.dev/Tech/OpenCode-Configuration-Path-Discovery
- Claude-plugin bridges [third-party]: https://lzw.me/docs/opencodedocs/code-yeongyu/oh-my-opencode/appendix/claude-code-compatibility, https://www.pkgstats.com/pkg:@koriit/opencode-claude-bridge

**Codex**
- Build skills (optional metadata), https://learn.chatgpt.com/docs/build-skills; mirror, https://developers.openai.com/codex/skills
- skill-creator `references/openai_yaml.md`, https://github.com/openai/skills/tree/main/skills/.system/skill-creator
