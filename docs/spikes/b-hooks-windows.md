# Spike B: hook configs and stdin payloads on Windows (Codex, Copilot, Claude, others)

Date: 2026-11-17. Windows 11, Node 22.22.3. Labels: **observed** (I ran it), **documented** (vendor doc, not run), **unverified**.

## Verdict

**The real hook round-trip was not run for any agent.** Triggering a shell tool call in Codex or Copilot needs an authenticated model session, which R5 forbids, and Copilot CLI is not installed (the PATH `copilot` is a VS Code shim). The payload fixtures are therefore **documented**, not captured. Every fixture carries `_provenance`; all are `documented:`, including opencode-v1 (typed from the installed d.ts, not a live capture).

What I could settle by running things locally:
1. **A PowerShell hook command loses exit code 2.** `powershell -NoProfile -Command "node guard.mjs"` returns **1** when node exits 2; only `...; exit $LASTEXITCODE` returns 2 (observed). On Claude, Codex and Cursor an exit 1 is not a block (fail-open). Copilot `preToolUse` is fail-closed, so any non-zero denies there.
2. The guard script reads a **BOM + CRLF** stdin payload correctly via the async `for await (const c of process.stdin)` pattern under cmd, PowerShell, Git Bash and direct exec (observed; see table).
3. `PLUGIN_ROOT` style expansion works as follows in each Windows shell (observed with an env var I set myself, not one the agent set).

Recommendation for Task 9 (guard) and Task 22 (hook files):
- **Claude**: exec form (`command: "node"`, `args: [...]`), no shell, so exit 2 is safe. Documented in note 01 §3; I could not run a session to confirm.
- **Codex**: deny with JSON on stdout and **exit 0** (`hookSpecificOutput.permissionDecision:"deny"`, documented). That is independent of whatever shell Codex uses on Windows. Use `command` for POSIX and `commandWindows` for Windows. Build the path from `PLUGIN_ROOT` (set by Codex, documented) with a fallback to `CLAUDE_PLUGIN_ROOT` (also set, documented), or have `guard.mjs` locate itself via `import.meta.url` and avoid path substitution entirely.
- **Copilot**: `bash` and `powershell` fields; deny with JSON `{"permissionDecision":"deny","permissionDecisionReason":...}` and exit 0, or exit 2 (documented: exit 2 and any other non-zero deny on `preToolUse`). If the `powershell` string runs node directly, end it with `; exit $LASTEXITCODE` anyway.
- **Never print non-JSON to stdout** (Copilot, Antigravity). Logs go to stderr.
- Make `guard.mjs` independent of `cwd` and of path substitution where possible: derive its own location from `import.meta.url`, so a hook command only has to be `node <abs path>/guard.mjs` and a wrong `%VAR%` vs `$env:VAR` guess cannot break it.

## What the shells did (observed)

Probe: `docs/spikes/scratch/t3/shellprobe/probe.mjs` (scratch, not committed). It spawns each shell without `shell: true`, feeds a BOM + CRLF Claude Bash payload on stdin, sets `PLUGIN_ROOT` itself, and runs the no-op logging guard, then a variant that exits 2.

| Case | Result (observed) |
|---|---|
| `cmd.exe /d /s /c "node "%PLUGIN_ROOT%\...\guard.mjs" --host=cmd"` | `%PLUGIN_ROOT%` expands, guard ran, exit 0. Needs `windowsVerbatimArguments` when spawned from Node. Exit 2 propagates. |
| `powershell.exe -NoProfile -NonInteractive -Command 'node "$env:PLUGIN_ROOT/..." ...; exit $LASTEXITCODE'` | `$env:PLUGIN_ROOT` expands, forward slashes accepted, guard ran. Exit 2 propagates **only with** `exit $LASTEXITCODE`. Without it a denying guard gives exit **1**. |
| Git Bash `bash -c 'node "$PLUGIN_ROOT/..."'` | Works with a backslash value (`D:\a\b`) and with a forward-slash value; exit 2 propagates. |
| Exec form: `node <abs path>\guard.mjs` (no shell) | Works; exit codes pass through unchanged. |
| `pwsh.exe` (PowerShell 7) | Not installed on this machine (ENOENT). Windows PowerShell 5.1 only. |

Guard saw the payload intact (BOM and CRLF both present) in every case; `JSON.parse(raw.replace(/^\uFEFF/, ''))` handles it.

## Per agent: what is known

### Claude Code 2.1.132 (CLI installed)
- Payload shape for PreToolUse (Bash, Write) and SessionStart: documented, https://code.claude.com/docs/en/hooks.md. On Windows `tool_input.file_path` for Write/Edit/Read arrives with **backslashes** (documented), so the guard must normalise separators.
- Shell form runs Git Bash, or PowerShell when Git Bash is missing; `shell: "powershell"` forces PowerShell; exec form needs a real `.exe` (documented). Deny = exit 2 + stderr, or JSON `permissionDecision:"deny"` (documented).
- Observed only that a plugin carrying `hooks/hooks.json` in exec form installs and lists as enabled (spike A). A session is needed to see it fire.

### Codex CLI 0.166.0 (installed)
- Payload: documented, https://learn.chatgpt.com/docs/hooks.md. Common fields `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`; PreToolUse adds `turn_id`, `tool_name`, `tool_use_id`, `tool_input` (`Bash` and `apply_patch` use `tool_input.command`). `SessionStart` adds `source`.
- Deny: JSON `hookSpecificOutput.permissionDecision:"deny"`, legacy `{decision:"block"}`, or exit 2 + stderr. **A PreToolUse error, timeout or malformed response lets the tool run** (documented). Plain stdout text is ignored.
- Plugin hooks get `PLUGIN_ROOT`, `PLUGIN_DATA`, and also `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA` (documented). They must be reviewed and trusted (`/hooks` in the CLI) before they run, and a changed script needs a new review.
- `commandWindows` is a Windows-only override of `command` (documented). The docs do **not** say which shell runs `command` on Windows.
- `codex features list` (observed): `hooks` stable/true; `plugin_hooks` shows `removed false` (the flag no longer exists; speculation, unverified: plugin hooks may now be always on in 0.166.0).
- `codex plugin add` installs the flat repo (spike A) but I could not see hooks load or fire.
- Fixtures: `codex-pretooluse.json`, `codex-sessionstart.json` (documented).

### Copilot CLI (not installed)
- `copilot` on PATH is the VS Code shim; it reports "GitHub Copilot CLI was not found". Nothing run.
- Payloads documented at https://docs.github.com/en/copilot/reference/hooks-reference: camelCase (`sessionId`, `timestamp` Unix ms, `cwd`, `toolName`, `toolArgs`) for `preToolUse`, snake_case (`hook_event_name`, `tool_name`, `tool_input`, ISO timestamp) for PascalCase `PreToolUse`. In the PascalCase form `tool_name` is the Claude name (`Bash` for both `bash` and `powershell`). `toolArgs` is typed `unknown`; the PascalCase text says `tool_input` is "parsed from JSON string when possible", so camelCase `toolArgs` is most likely a JSON string. **The guard must accept string or object.**
- Fail behaviour (documented): command `preToolUse` is fail-closed (crash or any non-zero exit, including 2, denies). Timeouts are fail-open (default 30 s). Cloud agent is Linux and only honours `bash`/`command`.
- Documented fields: `bash`, `powershell`, `command` (copied to both when absent), `exec` + `args` (CLI only, no shell), `timeoutSec`.
- The hooks reference does **not** mention a plugin-root variable. Whether Copilot sets `PLUGIN_ROOT` for plugin hooks is **unverified** and note 01's Copilot examples rely on it. Safest: have `guard.mjs` locate itself and avoid the variable, or use paths relative to the plugin dir if hook cwd is the plugin root (unverified).
- Fixtures: `copilot-pretooluse.json`, `copilot-pretooluse-pascalcase.json`, `copilot-sessionstart.json` (documented).

### Others (documented only, fixtures saved)
- Cursor `preToolUse`: shell tool is `Shell`, `tool_input.command`; exit 2 denies, other non-zero fail-open; JSON `{"permission":"deny",...}` (https://cursor.com/docs/hooks.md).
- Gemini CLI `BeforeTool`: `tool_name:"run_shell_command"`, exit 2 or `decision:"deny"`; timeouts in ms (https://geminicli.com/docs/hooks/reference.md).
- Antigravity `PreToolUse`: `toolCall.name:"run_command"`, `toolCall.args.CommandLine`; stdout JSON with required `decision` (https://antigravity.google/docs/hooks.md).

- Cursor, Gemini CLI and Antigravity hook shapes, deny outputs and exit-code semantics were not run; fixtures are documented only. Maintainer to verify (needs each agent installed and authenticated).

## Fixtures written (`test/fixtures/hook-payloads/`)

`claude-pretooluse-bash`, `claude-pretooluse-write`, `claude-sessionstart`, `codex-pretooluse`, `codex-sessionstart`, `copilot-pretooluse`, `copilot-pretooluse-pascalcase`, `copilot-sessionstart`, `cursor-pretooluse`, `gemini-beforetool`, `antigravity-pretooluse`, `opencode-v2-permission-evaluate`, `opencode-v1-tool-execute-before`.

Each has a top-level `_provenance` ("documented: <url>" or "observed: <how>") and most have a `_notes` line. Field values (ids, paths, timestamps) are illustrative; the **shapes** come from the cited docs. The guard parser must ignore `_provenance` and `_notes`. Deny samples use `steamless.exe x game.exe`.

## Maintainer must verify

Moved to the checklist in [docs/evals/tier1.md](../evals/tier1.md) (section 3). The original list follows for context.

1. **Codex on Windows**: install the plugin, review and trust the hook, run one shell call. Record: which shell ran `command` vs `commandWindows`; whether `PLUGIN_ROOT` was visible and in what form (`%PLUGIN_ROOT%`, `$env:PLUGIN_ROOT`, or an already-substituted path); the raw stdin payload (replace the Codex fixtures with it and flip `_provenance` to `observed:`); whether JSON deny at exit 0 blocks and whether exit 2 blocks; whether a `commandWindows` that ends `; exit $LASTEXITCODE` is needed.
2. **Copilot CLI on Windows**: same, with `bash` and `powershell` fields. Also: is `PLUGIN_ROOT` (or any root variable) set for plugin hooks, what is the hook cwd, is `toolArgs` a string or object, does `exec` + `args` work.
3. **Claude Code**: one Bash and one Write call with the exec-form hook; confirm payload and that exit 2 blocks.
4. Whether Codex runs plugin hooks installed via `codex plugin add` from the CLI, or only on desktop (note 01 open risk 3).
