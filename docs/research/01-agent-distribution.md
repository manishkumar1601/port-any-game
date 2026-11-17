# 01 — Shipping one skill/plugin to many coding agents on Windows, macOS and Linux

Research note for **port-any-game** (planning stage). Accessed/verified on **2026-11-17**.
Scope: packaging and installation only (skills, plugins, hooks, subagents, rules, commands, MCP). The game-porting pipeline itself is covered in notes 02–04.

Marker used below: **(u)** = from a secondary source, or not checked against the vendor's own docs. Verify before relying on it.

---

## TL;DR

1. **The portable core is `skills/<name>/SKILL.md` (Agent Skills spec).** Every agent in scope can load it. Keep the frontmatter to the spec's six fields (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`). Claude.ai uploads and the Skills API reject any other key with a hard error.
2. **Agent Plugins 1.0.0 shipped in Aug 2026** (agent-plugins.org). It is a root `plugin.json` plus `skills/` plus `mcp.json`. The steering committee is Amazon, Cursor, Microsoft, OpenAI and Vercel. Clients supporting it at launch: Codex/ChatGPT, Cursor, GitHub Copilot (CLI and VS Code), Kiro and VS Code. Devin also reads it as a fallback. **Claude Code, Gemini CLI, Antigravity and OpenCode do not use it as their native format.** v1.1.0 (working draft) adds portable hooks.
3. **Hooks, subagents, commands and rules are not portable.** Each one needs a small host-specific wrapper file. Hook config files collide on the same path (`hooks/hooks.json` uses different schemas in Claude, Cursor and Gemini). The fix is the per-host manifest path override each host offers, or a generated branch for Gemini.
4. **Write one hook implementation as a zero-dependency Node ESM script, always invoked as `node <script>`.** Do not use `.sh`, `python3` or shebangs: Windows ignores shebangs, `python3` is usually missing or the Store stub, and Claude's exec form cannot spawn `.cmd` shims. Each host gets a thin config that calls the same script with `--host=<x>`, which chooses that host's deny format.
5. **Do not rely on hooks for legal guardrails.** Many hosts fail open:
   - Codex: a PreToolUse error or timeout can let the tool run.
   - Cursor: exit codes other than 0 and 2 let the action proceed.
   - Devin: plugin hooks are best-effort.
   - Codex and Gemini: hooks are skipped until the user trusts them.

   Put the anti-DRM and no-publishing checks inside the skill's own scripts as well. Hooks are only a second layer.
6. **The landscape moved a lot in 2026:**
   - Gemini CLI is being replaced by **Antigravity CLI (`agy`)**: announced 2026-05-19; individual-tier Gemini CLI access ended 2026-06-18 (u).
   - **Windsurf became Devin Desktop** on 2026-06-02.
   - **OpenCode 2.0** changed its plugin API (v1 users are offered the upgrade from 2026-11-17).
   - **Roo Code is end-of-life** (2026-05-15).
   - **Continue joined Cursor** (2026-06-18).
   - Codex custom prompts are deprecated in favour of skills.
7. **`.agents/skills/` is the de facto cross-agent skills directory.** It is read by Codex, Cursor, Copilot, Gemini CLI, Antigravity, OpenCode, Devin, Amp, Cline and others. It is **not** read by Claude Code (`.claude/skills/` only) or Kiro (`.kiro/skills/`).
8. **The Claude marketplace file is the most widely read marketplace format.** `.claude-plugin/marketplace.json` is also read by Codex ("legacy-compatible"), Copilot CLI, VS Code, Factory Droid and Qwen Code. Devin and Antigravity can import Claude plugins.
9. **MCP: don't ship one in v1.** Shell-invoked scripts work in every host. MCP config is fragmented across 7+ file formats, and Cursor doesn't even expand `${PLUGIN_ROOT}`.
10. **Installers:** no runtime dependency. Document `npx skills add <org>/port-any-game` (Vercel, MIT, 75+ agents, skills only) as the universal fallback. Optionally use **rulesync** (MIT, very active) at build time; its plugin targets don't cover Codex or Copilot plugin manifests.

---

## 1. Agent Skills open standard (agentskills.io)

**Spec** (`docs/specification.mdx` in `agentskills/agentskills`):

| Field | Req. | Constraint |
|---|---|---|
| `name` | yes | 1–64 chars, `[a-z0-9-]`, no leading/trailing `-`, no `--`, **must equal parent dir name** |
| `description` | yes | 1–1024 chars; say what it does **and when to use it** |
| `license` | no | short name or bundled file ref |
| `compatibility` | no | ≤500 chars (e.g. "Requires Node 20+, git, internet") |
| `metadata` | no | string→string map; use unique keys |
| `allowed-tools` | no | space-separated, **experimental**, support varies |

**Layout and limits:**
- A skill is a directory: `SKILL.md` plus optional `scripts/`, `references/` and `assets/`.
- Progressive disclosure:
  - metadata is about 100 tokens at startup;
  - the body is loaded on activation (recommended under 5,000 tokens, `SKILL.md` under 500 lines);
  - resources are loaded on demand.
- Reference files with relative paths, one level deep.
- Validate with `skills-ref validate ./skill` (reference lib in the same repo).

**Host-side budgets that matter for descriptions:**
- Claude Code truncates `description` + `when_to_use` at **1,536 chars** in the listing.
- Codex caps the whole initial skill list at **2% of context / 8,000 chars** (configurable via `skills.max_context_tokens`, up to 10,000) and shortens descriptions first.
- Front-load trigger words.

**Scripts guidance (spec "using-scripts"):** self-contained scripts with inline dependencies (PEP 723 + `uv run`, `deno`, `bun`), pinned `npx pkg@ver`, no interactive prompts, `--help`, structured output.

**Directory convention (client implementer guide):** clients should scan `<project>/.agents/skills/` and `~/.agents/skills/` in addition to their native dir. Some also scan `.claude/skills/`.

**Clients listed on agentskills.io:** Junie, Gemini CLI, OpenCode, OpenHands, Cursor, Amp, Letta, Goose, GitHub Copilot, VS Code, Claude Code, Claude, ChatGPT and Codex, Factory, pi, TRAE, Roo Code, Mistral Vibe, Kiro, Tabnine, OpenClaw, Snowflake Cortex, Databricks, Spring AI and about 20 more.

---

## 2. Support matrix

### 2a. Skills and plugin packaging

`~` = `%USERPROFILE%` on Windows unless noted.

| Agent | Skills: project | Skills: user | Plugin/extension format | Install |
|---|---|---|---|---|
| **Claude Code** | `.claude/skills/` (+ parents up to repo root, nested on demand) | `~/.claude/skills/` | `.claude-plugin/plugin.json` (optional; only `name` required); dirs `skills/ commands/ agents/ hooks/hooks.json .mcp.json bin/` | `claude plugin marketplace add <owner/repo>` → `claude plugin install <p>@<m> [-s user\|project\|local]`; in-session `/plugin …` |
| **Codex** (CLI, IDE, ChatGPT desktop) | `.agents/skills/` in each dir CWD→repo root | `~/.agents/skills/`, `/etc/codex/skills` | **Agent Plugins** root `plugin.json` + `extensions."com.openai"`; fallback `.codex-plugin/plugin.json`; also accepts Claude-format | `codex plugin marketplace add <owner/repo> [--ref] [--sparse]`, then `/plugins` (or `codex plugin add <p>@<m>` (u)). Plugins **not** in IDE extension |
| **OpenCode 2.x** | `.opencode/skills/`; compat `.claude/skills/`, `.agents/skills/` | `~/.config/opencode/skills/`; compat `~/.claude/skills/`, `~/.agents/skills/` | JS/TS package (`@opencode/plugin`, `Plugin.define`); auto-load `.opencode/plugins/`, `~/.config/opencode/plugins/` | `opencode plugin add <npm \| github:o/r#ref::path:sub>` or `"plugins": [...]` in `opencode.json(c)` |
| **Gemini CLI** (legacy for individuals) | `.gemini/skills/` or `.agents/skills/` (alias wins) | `~/.gemini/skills/` or `~/.agents/skills/` | `gemini-extension.json` **at extension root**; `commands/*.toml skills/ agents/ hooks/hooks.json policies/` | `gemini extensions install <github-url\|path> [--ref] [--consent]`; `gemini extensions link <path>`; `gemini skills install <git-url>` |
| **Google Antigravity** (App, `agy` CLI, IDE) | `.agents/skills/` (also `.agent/`, `_agents/`) | `~/.gemini/config/skills/`; CLI also `~/.gemini/antigravity-cli/skills/`, `~/.gemini/skills/` | root `plugin.json` (`antigravity.google/schemas/v1/plugin.json`) **or `.antigravity-plugin/plugin.json` (wins; meant for multi-provider repos)**; `skills/ agents/ rules/ hooks.json mcp_config.json` | `agy plugin install <name>@antigravity-plugins-official \| <github-url> \| <path>`; `agy plugin validate --strict`; `agy plugin import claude\|gemini` |
| **Cursor** | `.agents/skills/`, `.cursor/skills/`; compat `.claude/skills/`, `.codex/skills/` | `~/.agents/skills/`, `~/.cursor/skills/` (+ compat) | Agent Plugins (skills+MCP only) **or** `.cursor-plugin/plugin.json` (rules, agents, commands, hooks, variables); marketplace `.cursor-plugin/marketplace.json` | Public Marketplace = manual review; team marketplaces (Teams: 1, Enterprise: unlimited) import a repo; local dev `~/.cursor/plugins/local/<plugin>` |
| **GitHub Copilot** (CLI, VS Code, cloud agent) | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/`, `~/.agents/skills/`; cloud: dotfiles `.copilot/skills` | **Agent Plugins 1.0/1.1** root `plugin.json` (wins over `.plugin/` and `.claude-plugin/`); Copilot extras in `com.github.copilot/{agents,commands,rules,hooks/hooks.json,lsp.json}`; legacy formats still load | CLI: `copilot plugin marketplace add <spec>`; `copilot plugin install <p@m \| OWNER/REPO \| OWNER/REPO:PATH \| git-url \| ./path>`. VS Code: `chat.plugins.marketplaces` (exp.), `chat.pluginLocations`, `/plugin …` |
| **Kiro** (IDE, CLI, Web) | `.kiro/skills/` | `~/.kiro/skills/` | **Powers** = Agent Plugins `plugin.json` (legacy `POWER.md` still works) | Powers from catalog, GitHub repo or local dir |
| **Devin Desktop / CLI** (ex-Windsurf) | `.agents/skills/`, `.devin/skills/`, `.windsurf/skills/` | `~/.agents/skills/`, `~/.config/devin/skills/` (Win `%APPDATA%\devin\`), `~/.codeium/<channel>/skills/` | `.devin-plugin/plugin.json` > **`.claude-plugin/plugin.json`** > root `plugin.json` (Agent Plugins 1.0.0) | `devin plugins …` (u: exact syntax) |
| **Factory Droid** | `.agents/skills/` (u) | `~/.factory/skills/` (u) | Installs **Claude plugins directly**, translating them to `.factory-plugin/` | `droid plugin marketplace add <src>`; `droid plugin install <p@m> --scope user` |
| **Qwen Code** | `.qwen/skills/` (u) | `~/.qwen/skills/` (u) | `qwen-extension.json`; installs Claude marketplace plugins and Gemini extensions by converting them | `qwen extensions install <marketplace>:<plugin>` (u) |
| Amp / Cline / Goose / Junie | `.agents/skills/` / `.agents/skills/` / `.goose/skills/` / `.junie/skills/` (u) | `~/.config/agents/skills/` / `~/.agents/skills/` / `~/.config/goose/skills/` / `~/.junie/skills/` (u) | — (skills only for our purposes) | `npx skills add … -a <agent>` |
| Roo Code | `.roo/skills/` | `~/.roo/skills/` | **EOL 2026-05-15**; fork "Zoo Code" reads the same tree (u) | — |

### 2b. Hooks, subagents, rules, commands, MCP

| Agent | Hooks: where / block | Subagents | Rules / instructions | Commands | MCP config |
|---|---|---|---|---|---|
| **Claude Code** | `~/.claude/settings.json`, `.claude/settings(.local).json`, plugin `hooks/hooks.json`, skill/agent frontmatter. ~30 events. **exit 2** (stderr→model) or `hookSpecificOutput.permissionDecision:"deny"` | `.claude/agents/*.md`, `~/.claude/agents/`, plugin `agents/` | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/`, `~/.claude/CLAUDE.md`; reads `AGENTS.md` only if no CLAUDE.md (≥ v2.1.277). Plugin-root CLAUDE.md is **not** loaded | `.claude/commands/*.md` (legacy; a skill folder name is its `/command`) | `.mcp.json`, `~/.claude.json`, plugin `.mcp.json`; `claude mcp add` |
| **Codex** | `~/.codex/hooks.json`, `~/.codex/config.toml [hooks]`, `<repo>/.codex/…` (trusted projects only), plugin `hooks/hooks.json` or `extensions.com.openai.hooks`. Claude-like schema. `permissionDecision:"deny"`, legacy `decision:"block"`, or exit 2. **Must be trusted first** (hash-based) | `.codex/agents/*.toml`, `~/.codex/agents/` (`name`, `description`, `developer_instructions`) | `AGENTS.md` / `AGENTS.override.md` (global `~/.codex`, then root→cwd), `project_doc_fallback_filenames`, 32 KiB cap | `~/.codex/prompts/*.md` **deprecated** → skills (`$skill`, `/skills`) | `~/.codex/config.toml [mcp_servers.x]`, project `.codex/config.toml`; `codex mcp add` |
| **OpenCode 2.x** | In-process plugin code: `ctx.tool.hook("execute.before", e => { throw … })` (v1: `"tool.execute.before"`). No shell-hook config file. Declarative `permissions` (allow/ask/deny) | `.opencode/agents/<n>.md`, `~/.config/opencode/agents/` (`mode: subagent`) | **`AGENTS.md` only** in v2 (no CLAUDE.md fallback); `~/.config/opencode/AGENTS.md` | `.opencode/commands/*.md`, `~/.config/opencode/commands/` (`$ARGUMENTS`) | `"mcp"` in `opencode.json(c)` |
| **Gemini CLI** | `settings.json` `hooks` (`.gemini/`, `~/.gemini/`, `/etc/gemini-cli/`), extension `hooks/hooks.json`. Events `BeforeTool`, `AfterTool`, `BeforeAgent`, `SessionStart`… **exit 2** or `decision:"deny"`. **timeout in ms** (default 60000). Project hooks fingerprinted | `.gemini/agents/*.md`, `~/.gemini/agents/` (preview) | `GEMINI.md` (`context.fileName` can add `AGENTS.md`) | `.gemini/commands/*.toml`, `~/.gemini/commands/` (`prompt`, `{{args}}`, `!{…}`) | `settings.json` `mcpServers`; extension manifest `mcpServers` |
| **Antigravity** | `.agents/hooks.json`, `~/.gemini/config/hooks.json`, plugin `hooks.json`. Events `SessionStart`, `PreToolUse`, `PostToolUse`, `Pre/PostInvocation`, `Stop`. camelCase JSON. `decision: allow\|deny\|force_ask` (+`reason`). Timeout s (default 30). Plugin hook **cwd = plugin root** | `.agents/agents/<n>.md` or `<n>/agent.md`, `~/.gemini/config/agents/` | `AGENTS.md`, `GEMINI.md`, `.agents/rules/*.md` | Skills are the slash commands (legacy commands converted to skills) | `.agents/mcp_config.json`, `~/.gemini/config/mcp_config.json` (remote uses `serverUrl`) |
| **Cursor** | `.cursor/hooks.json`, `~/.cursor/hooks.json` (`"version":1`), plugin hooks. `preToolUse`, `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, `sessionStart`, `stop`… exit 2 = deny; JSON `permission: allow\|deny\|ask`; **other non-zero = fail-open**. **Also runs Claude hooks** from `.claude/settings*.json` / `~/.claude/settings.json` (setting on by default) | `.cursor/agents/` (+ `.claude/agents/`, `.codex/agents/`); `~/.cursor/agents/` (+ compat). `name`, `description`, `model`, `readonly`, `is_background` | `.cursor/rules/*.mdc` (`description`, `globs`, `alwaysApply`); `AGENTS.md` | `.cursor/commands/*.md` (u, legacy; Cursor ships `/migrate-to-skills`) | `.cursor/mcp.json`, `~/.cursor/mcp.json`; plugin `mcp.json` (use `${CURSOR_PLUGIN_ROOT}`) |
| **Copilot** | `.github/hooks/*.json`, `~/.copilot/hooks/*.json` (`%USERPROFILE%\.copilot\hooks\`), inline `hooks` in `.github/copilot/settings.json` / `~/.copilot/settings.json`, plugins. `{"version":1,"hooks":{"preToolUse":[{"bash":…,"powershell":…}]}}`; CLI also `exec`+`args`. `permissionDecision: allow\|deny\|ask`. **Command preToolUse is fail-closed** (any non-zero → deny). Cloud agent: Linux, `bash`/`command` only | `.github/agents/*.agent.md`, `~/.copilot/agents/*.agent.md` (`description` required, `tools`, `model`, `disable-model-invocation`, `user-invocable`…) | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, nearest `AGENTS.md`, or root `CLAUDE.md`/`GEMINI.md` | Plugin `com.github.copilot/commands/`; VS Code prompt files `.github/prompts/*.prompt.md` (u) | CLI `~/.copilot/mcp-config.json`, project `.mcp.json`; VS Code `.vscode/mcp.json` (u); plugin `mcp.json` |
| **Kiro** | `.kiro/hooks/<id>.json`; CLI V3 global `~/.kiro/hooks/`. **exit 2 blocks** PreToolUse; other non-zero → warn and proceed | `.kiro/agents/*.json` (CLI) / `*.md` (IDE) (u) | `.kiro/steering/*.md`, `~/.kiro/steering/`, `AGENTS.md` | — (skills) | `.kiro/settings/mcp.json`, `~/.kiro/settings/mcp.json` (u) |
| **Devin** | `.devin/hooks.v1.json`; **also reads Claude-format hooks** in `.claude/settings*.json`, `~/.claude/settings.json`, `~/.claude.json`. exit 2 or `decision:"block"`. Plugin hooks fail-open | Imports `.claude/agents/` | `AGENTS.md`/`AGENT.md`/`CLAUDE.md`, `.cursor/rules`, `.windsurf/rules` | Imports `.claude/commands/` | `.devin/config.json` (u); imports `opencode.json`, `.zed/settings.json` |

---

## 3. Per-agent notes (what matters for us)

### Claude Code (code.claude.com)

- **Manifest fields.** `name` (required, kebab-case, namespaces every component). Optional: `displayName`, `version` (setting it pins users until bumped), `description`, `author{name,email,url}`, `homepage`, `repository`, `license`, `keywords`, `metadata`, `defaultEnabled`, `dependencies`, `userConfig`.
- **Component path keys.** `skills` adds to the default scan. `commands`, `agents`, `outputStyles` and `workflows` **replace** their default scans. `hooks`, `mcpServers` and `lspServers` load together with the defaults.
- **Path rules.** Unknown top-level keys are stripped (warning). Paths must stay inside the plugin root (`..` is an error).
- **Validate** with `claude plugin validate ./dir`.
- **Variables:**
  - `${CLAUDE_PLUGIN_ROOT}` changes on every update, so never write state there.
  - `${CLAUDE_PLUGIN_DATA}` is `~/.claude/plugins/data/<id>/` and survives updates. Use it for `node_modules` and caches.
- **Windows hook execution:**
  - Shell form runs `sh -c` on macOS/Linux, **Git Bash on Windows, or PowerShell if Git Bash is absent**. `shell: "powershell"` forces PowerShell.
  - **Exec form** (`"command":"node","args":[…]`) uses no shell and is the documented cross-platform pattern. `.cmd`/`.bat` shims (npx, eslint) **cannot** be exec-spawned.
  - Substituted paths use forward slashes in shell form and native backslashes in exec form.
- **Skill frontmatter.** Claude-only skill keys (`when_to_use`, `argument-hint`, `disable-model-invocation`, `user-invocable`, `context: fork`, `agent`, `hooks`, `paths`, `model`, `effort`, `shell`…) work inside Claude Code. They **break claude.ai/Skills API uploads**.
- **Marketplace file.** `.claude-plugin/marketplace.json` at the repo root. Plugin `source` can be:
  - a relative path, written from the marketplace root;
  - `github` / `git-subdir` objects.

  The install id is `<entry-name>@<marketplace-name>`. Keep the entry name equal to the manifest `name`.
- **Team auto-enable.** Put `extraKnownMarketplaces` and `enabledPlugins` in the project `.claude/settings.json`. VS Code honours the same keys.

### OpenAI Codex (docs moved to learn.chatgpt.com)

- **Skills.** `.agents/skills` only (not `.codex/skills`). Optional `agents/openai.yaml` sets UI metadata, `policy.allow_implicit_invocation`, and tool dependencies such as an MCP server.
- **Plugins.** The portable root `plugin.json` is the recommended format; `@plugin-creator` still scaffolds `.codex-plugin/plugin.json`.
  - OpenAI extras go under `extensions."com.openai"`: `apps`, `hooks`, `onboardingSkill`, `interface{displayName, shortDescription, logo, …}`.
  - When the inline object is present it **replaces** `.codex-plugin/plugin.json` entirely.
  - Install cache: `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`.
- **Marketplace sources Codex reads:**
  - `$REPO_ROOT/.agents/plugins/marketplace.json`
  - **`$REPO_ROOT/.claude-plugin/marketplace.json` (legacy-compatible)**
  - `~/.agents/plugins/marketplace.json`
- **Plugin hooks:**
  - Default file is `hooks/hooks.json`. An explicit `extensions.com.openai.hooks` (path, array or inline) **replaces** default discovery.
  - Env vars `PLUGIN_ROOT`/`PLUGIN_DATA`, **plus `CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA`** for compatibility.
  - Hooks are **not trusted until the user reviews them**.
  - Plugins with hooks are **not eligible for the public directory**.
  - The docs say lifecycle hooks are "supported for plugins installed manually in Codex desktop" (u: CLI behaviour).
- **Hook handlers.** Fields: `command`, `commandWindows` (Windows override), `timeout` (s, default 600), `statusMessage`, `async`. `prompt`/`agent` handlers are parsed but skipped.
- **Subagents.** One TOML per agent. Custom agents inherit the parent's permissions, provider and MCP servers.

### OpenCode (v2.x; v1 still widespread)

- **Version status.** OpenCode 2.3.0 shipped 2026-11-13. v1.19.6 began offering the 2.0 upgrade on 2026-11-17, so expect a mixed install base. rulesync keeps separate `opencode` and `opencodev1` targets.
- **v2 plugins** are npm packages or local dirs with server/TUI/GUI/RPC parts. Guard hook: `ctx.tool.hook("execute.before", …)`; throw to block.
- **Declarative alternative.** `permissions` rules in `opencode.json` can deny shell patterns with no code.
- **Rules.** v2 recognises **only `AGENTS.md`**.

### Gemini CLI → Antigravity

- **Gemini CLI status:**
  - Docs and repo are live; extension, hooks, skills and subagents are all documented.
  - Google announced Antigravity CLI (`agy`) on 2026-05-19. Individual Gemini CLI access ended 2026-06-18, while enterprise and API-key users continue (u, secondary sources).
  - The official migration guide converts extensions with `agy plugin import gemini`, turns legacy commands into skills, and moves `.gemini/skills` → `.agents/skills`.
- **Gemini extension layout limits:**
  - The extension **must have `gemini-extension.json` at its root**.
  - Hooks live only in `hooks/hooks.json`; the path is fixed.
  - Variables: `${extensionPath}`, `${workspacePath}`, `${/}` (platform path separator).
- **Antigravity plugins:**
  - Variables: `${PLUGIN_ROOT}`, `${PLUGIN_DATA}`.
  - Hooks run with cwd = plugin root. Docs recommend `node ./scripts/policy.mjs`-style relative commands.
  - **`.antigravity-plugin/plugin.json` exists specifically so a repo can also ship `.claude-plugin/` / `.cursor-plugin/`.**
  - Customisation manifests (`.agents/skills.json` with `entries` / `inherits` / `exclude`) can pull skills from a shared checkout.

### Cursor

- **Two plugin formats** are identified by manifest location. In `.cursor-plugin/plugin.json`, any component path field (`rules`, `agents`, `skills`, `commands`, `hooks`, `mcpServers`) **replaces** folder discovery. That is the escape hatch for path collisions.
- **Compatibility reads.** Cursor reads Claude/Codex skill and agent dirs, and runs Claude hooks: `PreToolUse`→`preToolUse`, `permissionDecision`→`permission`.
- **Untested.** Which format wins if both root `plugin.json` and `.cursor-plugin/plugin.json` exist (u).

### GitHub Copilot / VS Code

- **Format precedence.**
  - Copilot CLI: a root `plugin.json` carrying an Agent Plugins `$schema` **takes precedence over `.claude-plugin/plugin.json`**. An unsupported Agent Plugins version → plugin rejected (no silent fallback).
  - Legacy manifest search order: `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, `.claude-plugin/plugin.json`.
- **Marketplace search order:** `marketplace.json`, `.plugin/…`, `.github/plugin/…`, `.claude-plugin/marketplace.json`.
- **VS Code formats.** VS Code reads Agent Plugins, Copilot, **Claude (`.claude-plugin/plugin.json`, `${CLAUDE_PLUGIN_ROOT}`)** and legacy OpenPlugin formats. It uses the Claude marketplace schema.
- **Hooks.** Per-OS `bash` / `powershell` fields are the cross-OS facility. PascalCase event names give snake_case (VS Code-compatible) payloads.

### Kiro

- Powers use the Agent Plugins format, so a root `plugin.json` package installs as a power (skills + MCP).
- Hooks and steering are project/user files, not plugin components. They need a manual copy step.

### Devin (ex-Windsurf), Factory Droid, Qwen Code

- All three consume **Claude Code plugins** directly or via auto-conversion (Devin falls back to `.claude-plugin/plugin.json`; Droid translates at install; Qwen converts to `qwen-extension.json`).
- Devin and Droid substitute `${CLAUDE_PLUGIN_ROOT}`.
- Devin's plugin hooks are fail-open. Droid has no version pinning (u).

---

## 4. Cross-OS hook strategy

### 4.1 What the guard must hook

| Host | "before tool" event | "session start" event | Deny signal we should emit |
|---|---|---|---|
| Claude Code | `PreToolUse` (matcher `Bash\|Write\|Edit`) | `SessionStart` | exit 2 + reason on stderr |
| Codex | `PreToolUse` (`Bash`, `apply_patch`/`Edit`/`Write`) | `SessionStart` | exit 2 + stderr (or JSON `permissionDecision`) |
| Copilot | `preToolUse` / `PreToolUse` | `sessionStart` | JSON `{"permissionDecision":"deny","permissionDecisionReason":…}`, exit 0 |
| Cursor | `preToolUse` / `beforeShellExecution` | `sessionStart` | exit 2 (or `{"permission":"deny","user_message":…}`) |
| Gemini CLI | `BeforeTool` (`run_shell_command`, `write_file`…) | `SessionStart` | exit 2 + stderr |
| Antigravity | `PreToolUse` (`run_command`, `replace_file_content`…) | `SessionStart` | JSON `{"decision":"deny","reason":…}` |
| Kiro | `PreToolUse` | `SessionStart` (u) | exit 2 + stderr |
| Devin | Claude-format `PreToolUse` | `SessionStart` | exit 2 |
| Agent Plugins 1.1 (draft) | `PreToolUse` (portable `tool_profile`) | `SessionStart` | JSON `{"decision":"deny","reason":…}` with **exit 0**; a non-zero exit is a *failure*, not a decision |
| OpenCode | `ctx.tool.hook("execute.before")` | plugin `setup` | `throw new Error(reason)` |

**Fail-open vs fail-closed:**
- Fail-closed: Copilot command hooks.
- Fail-open on crash, timeout or odd exit: Codex, Cursor, Devin plugins and Kiro (non-2).

Treat hooks as a UX guardrail. The authoritative check lives in the skill's own scripts: they refuse to run DRM-removal tooling or publish/upload steps regardless of hooks.

**Trust gates mean a hook may not run on day one:**
- Codex: hash-based review.
- Gemini: project-hook fingerprinting.
- Copilot: folder trust and `allowManagedHooksOnly`.

So the **dependency check should be a script the skill calls first** (`node …/doctor.mjs`), not only a `SessionStart` hook.

### 4.2 One implementation

- **Runtime: Node ≥ 20 (22 LTS recommended), ESM `.mjs`, zero dependencies.**
  - Node is already required by Gemini CLI, Copilot CLI, the Vercel `skills` CLI (≥ 22.20) and any web-build toolchain.
  - Python is not reliably present on Windows: the `python3` alias is missing and `python` may be the Store stub.
  - The Claude Code native installer and the Codex Rust binary do *not* bring Node, so the doctor script must report a missing `node` clearly.
- **Invocation per host.** Always run as `node <abs-or-root-relative path> --host=<id> --event=<pre|start>`:

  | Host | Form |
  |---|---|
  | Claude | exec form `{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/skills/port-any-game/scripts/guard.mjs","--host=claude"]}` |
  | Copilot | `"bash":"node \"$PLUGIN_ROOT/…/guard.mjs\" --host=copilot"`, `"powershell":"node \"$env:PLUGIN_ROOT/…/guard.mjs\" --host=copilot"` |
  | Codex | `command` + `commandWindows` (u: which Windows shell Codex uses — test both) |
  | Antigravity, Agent Plugins | `node ./skills/port-any-game/scripts/guard.mjs` (cwd = plugin root) |
  | Gemini | `node ${extensionPath}${/}skills${/}port-any-game${/}scripts${/}guard.mjs --host=gemini` |

- **Script rules:**
  - Read stdin asynchronously to EOF (don't use `readFileSync(0)` on Windows pipes). Tolerate CRLF and BOM.
  - Normalise snake_case and camelCase payloads (`tool_name`/`toolName`, `tool_input`/`toolArgs`) and Cursor's `command` field.
  - Never print non-JSON to stdout: Copilot, Agent Plugins and Antigravity parse stdout strictly. Use stderr for logs.
  - Use `path`/`fileURLToPath` for paths. Never rely on a shebang or the execute bit.
  - Mind timeouts: Gemini's are **milliseconds**, everyone else's are seconds.
- **Skeleton** (shape only):

```js
// skills/port-any-game/scripts/guard.mjs  — node guard.mjs --host=<claude|codex|copilot|cursor|gemini|antigravity|kiro|agentplugins>
import { check } from './policy.mjs';                    // same module the build scripts import
const host = (process.argv.find(a => a.startsWith('--host=')) || '--host=claude').slice(7);
let raw = ''; for await (const c of process.stdin) raw += c;
const ev = JSON.parse(raw.replace(/^﻿/, '') || '{}');
const tool = ev.tool_name ?? ev.toolName ?? ''; const input = ev.tool_input ?? ev.toolArgs ?? ev.toolInput ?? { command: ev.command };
const v = check(tool, input);                            // { deny: bool, reason: string }
if (!v.deny) process.exit(0);                            // no output = no opinion everywhere
if (host === 'copilot') console.log(JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: v.reason }));
else if (host === 'antigravity' || host === 'agentplugins') console.log(JSON.stringify({ decision: 'deny', reason: v.reason }));
else { process.stderr.write(v.reason); process.exit(2); } // claude, codex, cursor, gemini, kiro, devin
```

---

## 5. Existing cross-agent installers and converters

| Tool | What it does | Agents | Hooks? | Maturity (npm) | License |
|---|---|---|---|---|---|
| **Vercel `skills`** (`npx skills add o/r`) | Copies or links SKILL.md folders into each agent's dir. Lockfile `skills-lock.json` v2 with content hash. Finds skills via `.claude-plugin/marketplace.json` / `plugin.json` or recursive search. `-g` for user scope | 75+ (table in `docs/agents.md`) | no (skills only) | v1.9.0, 2026-11-16; Vercel Labs; telemetry on (`DISABLE_TELEMETRY=1`) | MIT |
| **rulesync** | One `.rulesync/` source → rules, ignore, mcp, commands, subagents, skills, hooks, permissions for ~65 tools. Plugin targets: `claudecode-plugin`, `antigravity-plugin`, `devin-plugin`, `augmentcode-plugin`, `kimi-code-plugin`, `zcode-plugin`, `vibe-plugin` | Claude, Codex, Copilot (+CLI), Cursor, OpenCode (v1/v2), Kiro, Antigravity, Droid, Qwen, Goose, Cline, Junie… (no plain "Gemini CLI" row) | yes | v43.9.0, 2026-11-16; 397 versions (fast-moving, so pin it) | MIT |
| **ruler** (`@intellectronica/ruler`) | `.ruler/` → rules, MCP, skills, subagents | ~30 | no | v0.3.46, 2026-10-22 | MIT |
| **openskills** | Installs skills and writes an `<available_skills>` block into AGENTS.md | Claude, Cursor, Windsurf, Aider, Codex… | no | v1.5.0, 2026-01-17 (stale) | Apache-2.0 |
| `gh skill` (GitHub CLI) | Installs skills from GitHub repos for Copilot | Copilot | no | official | — |
| Host-native importers | `agy plugin import claude\|gemini`; Droid auto-translates Claude plugins; Qwen installs Claude marketplace plugins; Devin reads `.claude-plugin/` | — | partly | official | — |
| Precedent: **EveryInc/compound-engineering** | A real multi-host plugin. Root `.claude-plugin/marketplace.json` + `.cursor-plugin/marketplace.json`; `plugins/<name>/.claude-plugin/` + `.cursor-plugin/`; bun converters for OpenCode and Qwen; installs on 14 hosts incl. `codex plugin marketplace add EveryInc/compound-engineering-plugin` | 14 | — | active | (check) |

**Verdict:**
- **Don't depend on any of them at runtime.**
- Recommend `npx skills add <org>/port-any-game` in the README as the "any other agent" path.
- If we later want generated per-host files, use **rulesync as a pinned devDependency at build time**, but it doesn't emit Codex/Copilot plugin manifests. Hand-writing about 8 tiny wrapper files is less work than learning `.rulesync/`.

---

## 6. MCP server: worth it?

**Not for v1.** The pipeline steps (detect engine, extract, build with Emscripten etc., serve, test) are batch CLI jobs. A skill that runs `node scripts/x.mjs …` works in every host with no config.

**Costs of an MCP server:**
- Config format differs per host: `.mcp.json`, `mcp.json` with Agent Plugins `$schema`, `mcp_config.json` with `serverUrl`, `config.toml [mcp_servers]`, `opencode.json "mcp"`, `settings.json mcpServers`, `.cursor/mcp.json`.
- Cursor does not expand `${PLUGIN_ROOT}`.
- On Windows, `npx`-launched servers hit `.cmd` spawn issues.
- It adds approval prompts and a long-running process.

**Revisit only if** we need streaming, stateful tools: a long-lived browser-preview/test harness, or a binary inspector that returns structured data too big for stdout. Even then, ship it as an optional component (`mcp.json` + `.mcp.json`).

---

## 7. Recommendation: single-source layout and per-agent outputs

The plugin lives in `plugins/port-any-game/`, mirroring retro-port and compound-engineering. The repo root is only a marketplace plus host-specific extras that can't live in the plugin dir.

```
port-any-game/                                  # repo root = marketplace root
├── .claude-plugin/marketplace.json             # Claude; also read by Codex (legacy), Copilot CLI, VS Code, Droid, Qwen, Vercel skills
├── .cursor-plugin/marketplace.json             # Cursor team-marketplace import
├── plugins/port-any-game/                      # ← the plugin
│   ├── plugin.json                             # Agent Plugins 1.0.0 + extensions."com.openai" {hooks:"./hooks/codex.json", interface…}
│   ├── .claude-plugin/plugin.json              # Claude Code (+ Devin, Droid, Qwen, VS Code, `agy plugin import claude`)
│   ├── .cursor-plugin/plugin.json              # {"rules":"./rules/cursor","hooks":"./hooks/cursor.json"}
│   ├── .antigravity-plugin/plugin.json         # Antigravity (wins over root plugin.json)
│   ├── skills/                                 # PORTABLE CORE — six spec frontmatter fields only
│   │   └── port-any-game/
│   │       ├── SKILL.md                        # includes the legal guardrails in prose
│   │       ├── scripts/{doctor,guard,policy,…}.mjs   # ONE Node implementation; travels with skills-only installs
│   │       └── references/ assets/
│   ├── agents/<name>.md                        # canonical subagents: name + description + body (Claude/Cursor/Antigravity)
│   ├── com.github.copilot/
│   │   ├── agents/<name>.agent.md              # generated from agents/
│   │   └── hooks/hooks.json                    # Copilot format (bash + powershell → node guard.mjs --host=copilot)
│   ├── hooks/hooks.json                        # Claude format (exec form, ${CLAUDE_PLUGIN_ROOT})
│   ├── hooks/codex.json                        # Codex format (command + commandWindows)
│   ├── hooks/cursor.json                       # Cursor format ("version":1)
│   ├── hooks.json                              # Antigravity format (cwd = plugin root)
│   └── rules/cursor/*.mdc                      # optional
├── hosts/                                      # outputs that can't share the plugin dir
│   ├── gemini/  gemini-extension.json, commands/*.toml, hooks/hooks.json (BeforeTool)  → CI publishes branch `gemini` (skills copied in)
│   ├── opencode/port-any-game/index.ts         # v2 plugin: ctx.tool.hook("execute.before") → policy.mjs (+ v1 variant)
│   ├── codex/agents/*.toml                     # generated from agents/ (Codex plugins don't carry custom agents (u))
│   └── kiro/hooks/port-any-game.json           # copied into .kiro/hooks/ or ~/.kiro/hooks/
├── tools/build.mjs                             # zero-dep: agents/*.md → .agent.md / .toml / Gemini TOML; assembles `gemini` branch; fails CI on drift
└── README.md, LICENSE
```

**Why it is shaped this way:**
- **Hook-path collisions:**
  - `hooks/hooks.json` is Claude's default and is always loaded, so it holds the Claude format.
  - Codex is redirected with `extensions.com.openai.hooks`, and Cursor with `.cursor-plugin` `"hooks"`.
  - Copilot reads `com.github.copilot/hooks/hooks.json` because the root `plugin.json` has the Agent Plugins `$schema`.
  - Antigravity uses the root `hooks.json`, which Agent Plugins 1.0 clients ignore.
- **Gemini gets a separate branch.** Its fixed `hooks/hooks.json` path and root-only manifest can't coexist with the Claude file.
- **Target Agent Plugins 1.0.0, not the 1.1 draft.** Under 1.1 a root `hooks.json` becomes the *portable* hooks file and would collide with Antigravity's.
- **Scripts live inside the skill,** so `npx skills add` / `.agents/skills` installs still get the doctor and policy checks even with no hooks.

**Graceful degradation:**

| Capability | Missing on | Fallback |
|---|---|---|
| Hooks | Amp/Goose/Junie/Cline (skills-only installs), Kiro and Gemini when installed via skills only, untrusted Codex/Gemini hooks | Skill instructions + script-level policy checks; `doctor.mjs` as step 1 of SKILL.md |
| Subagents | Codex plugin installs, skills-only installs | SKILL.md runs the phases inline; subagents are an optimisation |
| Slash commands | Codex (prompts deprecated), Antigravity, Kiro | Invoke the skill (`/port-any-game`, `$port-any-game`, or by description) |
| Rules | All plugin installs (Claude ignores plugin CLAUDE.md) | Guardrail text lives in SKILL.md and is loaded on activation |
| MCP | — | not used |

### 7.1 Install instructions (per agent and OS)

`<org>` = the GitHub org. CLI commands are identical on Windows (PowerShell), macOS and Linux unless shown. Prerequisites everywhere: `git`, **Node ≥ 20** on PATH (`node --version`).

| Agent | Install |
|---|---|
| **Claude Code** | `claude plugin marketplace add <org>/port-any-game` → `claude plugin install port-any-game@port-any-game` (`-s project` + commit `.claude/settings.json` to share) |
| **Codex CLI / ChatGPT desktop** | `codex plugin marketplace add <org>/port-any-game` → `/plugins` → install (or `codex plugin add port-any-game@port-any-game` (u)). Then **trust the hooks** when prompted. Optional subagents: copy `hosts/codex/agents/*.toml` → `~/.codex/agents/` |
| **Codex IDE extension** (no plugins) | `npx skills add <org>/port-any-game -a codex -g` |
| **Copilot CLI** | `copilot plugin marketplace add <org>/port-any-game` → `copilot plugin install port-any-game@port-any-game` (or `copilot plugin install <org>/port-any-game:plugins/port-any-game`) |
| **VS Code (Copilot agent mode)** | settings.json `"chat.plugins.marketplaces": ["<org>/port-any-game"]` → install from Agent Customizations / `/plugin install` |
| **Cursor (individual)** | macOS/Linux: `git clone https://github.com/<org>/port-any-game && cp -r port-any-game/plugins/port-any-game ~/.cursor/plugins/local/`. Windows: `git clone …; Copy-Item -Recurse port-any-game\plugins\port-any-game "$env:USERPROFILE\.cursor\plugins\local\"`. Skills-only alternative: `npx skills add <org>/port-any-game -a cursor -g` |
| **Cursor (team)** | Dashboard → Plugins & MCPs → Team Marketplace → **Import from Repo** `https://github.com/<org>/port-any-game` |
| **Antigravity (`agy`, App, IDE)** | `git clone …` → `agy plugin validate --strict ./port-any-game/plugins/port-any-game` → `agy plugin install ./port-any-game/plugins/port-any-game` (or `agy plugin install https://github.com/<org>/port-any-game` if subdir discovery works (u)) |
| **Gemini CLI** (enterprise/API-key users) | `gemini extensions install https://github.com/<org>/port-any-game --ref gemini` |
| **OpenCode 2.x** | Skills: `npx skills add <org>/port-any-game -a opencode -g`. Guard: `opencode plugin add "github:<org>/port-any-game#main::path:hosts/opencode/port-any-game"`. Subagents: copy `plugins/port-any-game/agents/*.md` → `~/.config/opencode/agents/` (add `mode: subagent`; build step) |
| **Kiro** | Install the power from GitHub (`plugins/port-any-game`, Agent Plugins manifest). Hooks: macOS/Linux `cp hosts/kiro/hooks/*.json ~/.kiro/hooks/`; Windows `Copy-Item hosts\kiro\hooks\*.json "$env:USERPROFILE\.kiro\hooks\"` |
| **Devin Desktop/CLI** | Install as a plugin from the repo (reads `.claude-plugin/plugin.json`) — `devin plugins …` (u) |
| **Factory Droid** | `droid plugin marketplace add https://github.com/<org>/port-any-game` → `droid plugin install port-any-game@port-any-game --scope user` |
| **Qwen Code** | `qwen extensions install https://github.com/<org>/port-any-game:port-any-game` (u) |
| **Anything else** (Amp, Cline, Goose, Junie, Zed, Warp, Trae…) | `npx skills add <org>/port-any-game -g -a <agent-id>` (Node ≥ 22.20; ids in Vercel `docs/agents.md`). Manual: copy `plugins/port-any-game/skills/port-any-game` into `~/.agents/skills/` (macOS/Linux `cp -r`, Windows `Copy-Item -Recurse … "$env:USERPROFILE\.agents\skills\"`) **and** `~/.claude/skills/` for Claude Code |

**Windows note.** Prefer copy over symlink; symlinks need Developer Mode or admin.

---

## 8. Open risks and unverified points

1. **Agent Plugins is young:** 1.0.0 shipped Aug 2026; 1.1.0 is a working draft with hooks. Anthropic is not on the steering committee and Claude Code has not adopted it, so we must keep `.claude-plugin/` indefinitely.
2. **Manifest precedence when several manifests coexist** has not been tested:
   - Cursor: root `plugin.json` vs `.cursor-plugin/plugin.json`.
   - Antigravity: `.antigravity-plugin` vs a root Agent Plugins `plugin.json` with a foreign `$schema`.
   - Claude Code: possible warnings on stray `plugin.json` / `com.github.copilot/`.

   **Spike this first.**
3. **Codex hooks on Windows** need testing: which shell, `${PLUGIN_ROOT}` vs `%PLUGIN_ROOT%` vs `$env:`, and whether `args` is honoured. Also whether CLI-installed plugins run hooks or only "manually installed desktop" ones.
4. **Gemini CLI's future** is uncertain for individuals. Treat it as tier 2: generated branch, best effort.
5. **OpenCode v1 → v2 transition.** The plugin API differs (`@opencode-ai/plugin` "tool.execute.before" vs `@opencode/plugin` `ctx.tool.hook`), so we may need both variants for a while.
6. **Hook fail-open behaviour and trust prompts.** Hooks can't be the legal control. Document that the scripts enforce policy themselves.
7. **Rows marked (u) need verification against vendor docs before launch:** Amp, Goose, Junie, Cline, Droid and Qwen paths/commands, Kiro MCP/agents paths, VS Code prompt files and `.vscode/mcp.json`.
8. **Distribution review.** Public listings are reviewed: Cursor Marketplace, the Codex public directory (hooks make a plugin ineligible) and the Antigravity Marketplace. A tool that ingests commercial game files will draw scrutiny, so self-hosted marketplaces (GitHub) are the realistic channel.
9. **Name and size budgets.** Skill-listing budgets (Claude 1% of context, Codex 2%/8,000 chars) mean one primary skill with a sharp description beats many small skills.

---

## Sources (all accessed 2026-11-17)

- Agent Skills spec — https://agentskills.io/specification ; repo `agentskills/agentskills` `docs/specification.mdx`, `docs/clients.mdx`/`snippets/clients.jsx`, `docs/client-implementation/adding-skills-support.mdx`, `docs/skill-creation/using-scripts.mdx`
- Agent Plugins — https://agent-plugins.org/ ; https://agent-plugins.org/llms.txt ; https://agent-plugins.org/schemas/1.0.0/plugin.schema.json ; repo `agentplugins/agent-plugins-spec` (`spec/1.0.0.md`, `spec/1.1.0.md`, `FUTURE_CONSIDERATIONS.md`)
- Vercel changelog "Introducing Agent Plugins 1.0.0" — https://vercel.com/changelog/introducing-agent-plugins-1-0-0
- AAIF blog (2026-08-06) — https://aaif.io/blog/from-skills-and-tools-to-portable-agent-plugins
- The AI Wire (filed 2026-08-07) — https://news.baeke.info/articles/agent-plugins-1-0-0-releases-open-specification-for-portable-agent-components
- Claude Code — https://code.claude.com/docs/en/plugins-reference.md , /hooks.md , /skills.md , /sub-agents.md , /plugin-marketplaces.md , /mcp.md , /memory.md , /plugins/cli-reference.md
- OpenAI — https://developers.openai.com/plugins/build/plugins.md ; https://learn.chatgpt.com/docs/build-skills.md , /docs/hooks.md , /docs/agent-configuration/subagents.md , /docs/agent-configuration/agents-md.md , /docs/custom-prompts.md , /docs/plugins.md , /docs/extend/mcp
- OpenCode — https://opencode.ai/llms.txt , https://opencode.ai/docs/llms.txt , /docs/plugins.md , /docs/build/plugins.md , /docs/build/plugins/server.md , /docs/build/plugins/migrate-v1.md , /docs/migrate-v1.md , /docs/skills.md , /docs/agents.md , /docs/commands.md , /docs/instructions.md , /docs/mcp-servers.md , https://opencode.ai/changelog.md
- Gemini CLI — https://geminicli.com/llms.txt (sections: docs/cli/skills, docs/extensions/reference, docs/extensions/releasing, docs/hooks, docs/hooks/reference, docs/core/subagents, docs/cli/custom-commands, docs/cli/gemini-md, docs/tools/mcp-server)
- Antigravity — https://antigravity.google/llms.txt ; /docs/plugins.md , /docs/build-plugins.md , /docs/hooks.md , /docs/skills.md , /docs/customization-discovery.md , /docs/mcp.md , /docs/cli/gcli-migration.md
- Gemini→Antigravity timeline (secondary) — https://agentpedia.codes/blog/gemini-cli-to-antigravity-cli-migration ; https://thenewstack.io/gemini-cli-antigravity-replacement/
- Cursor — https://cursor.com/llms.txt ; /docs/plugins.md , /docs/reference/plugins.md , /docs/skills.md , /docs/hooks.md , /docs/reference/third-party-hooks.md , /docs/subagents.md , /docs/rules.md , /docs/mcp.md
- GitHub Copilot — https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference ; /reference/hooks-reference ; /concepts/agents/about-agent-skills ; /reference/custom-agents-configuration ; /how-tos/configure-custom-instructions/add-repository-instructions ; /reference/copilot-cli-reference/cli-config-dir-reference (fetched via `docs.github.com/api/article/body`)
- VS Code — https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference.md
- Kiro — https://kiro.dev/llms.txt ; /docs/powers/create.md , /docs/skills.md , /docs/hooks.md , /docs/hooks/actions.md , /docs/steering.md
- Devin (ex-Windsurf) — https://docs.devin.ai/llms.txt ; /cli/extensibility/index.md , /plugins/overview.md , /skills/overview.md , /hooks/overview.md ; rename context https://docs.devin.ai/desktop/devin-desktop-faq
- Factory Droid (search summary) — https://docs.factory.ai/cli/configuration/plugins ; https://docs.factory.ai/guides/building/building-plugins
- Qwen Code (search summary) — https://qwenlm.github.io/qwen-code-docs/en/users/extension/introduction/
- Vercel `skills` — repo `vercel-labs/skills` README, `docs/agents.md`, `docs/creating-skills.md`; npm `skills` 1.9.0 (2026-11-16)
- rulesync — repo `dyoshikawa/rulesync` README; npm `rulesync` 43.9.0 (2026-11-16)
- ruler — npm `@intellectronica/ruler` 0.3.46 (2026-10-22) readme
- openskills — repo `numman-ali/openskills` README; npm `openskills` 1.5.0 (2026-01-17)
- compound-engineering — repo `EveryInc/compound-engineering-plugin` README and file tree (via jsDelivr)
