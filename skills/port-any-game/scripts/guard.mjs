// Hook adapter: `pag guard --host=<x>` reads an agent hook payload on stdin, asks policy.mjs, and denies in the host's format.
// Never crashes the agent: any internal error exits 0 with nothing on stdout (policy in the scripts stays authoritative).

const SHELL = new Set(['bash', 'shell', 'powershell', 'pwsh', 'run_shell_command', 'run_command', 'execute_bash', 'exec_command', 'local_shell', 'terminal', 'run_terminal_cmd', 'execute_command']);
const WRITE = new Set(['write', 'edit', 'multiedit', 'notebookedit', 'create', 'create_file', 'write_file', 'edit_file', 'replace', 'str_replace_editor', 'str_replace_based_edit_tool', 'apply_patch', 'patch', 'replace_in_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content']);
const FETCH = new Set(['webfetch', 'web_fetch', 'fetch', 'fetch_url']);
const kind = (n) => { const k = String(n ?? '').toLowerCase(); return SHELL.has(k) ? 'shell' : WRITE.has(k) ? 'write' : FETCH.has(k) ? 'fetch' : 'other'; };
const first = (...v) => v.find((x) => x !== undefined && x !== null && x !== '');
const asObj = (a) => {
  if (typeof a !== 'string') return a && typeof a === 'object' ? a : {};
  try { const j = JSON.parse(a); return j && typeof j === 'object' ? j : { command: a }; } catch { return { command: a }; }
};

export function normalizeEvent(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let name, args;
  if (r.toolCall) { name = r.toolCall.name; args = asObj(r.toolCall.args); }                       // antigravity
  else if (Array.isArray(r.resources)) { name = r.action; args = { command: r.resources.join(' '), paths: r.resources, url: r.resources.join(' ') }; } // opencode v2
  else if (r.input?.tool && r.output?.args) { name = r.input.tool; args = asObj(r.output.args); }  // opencode v1
  else { name = first(r.tool_name, r.toolName); args = asObj(first(r.tool_input, r.toolArgs, r.toolInput)); }
  if (!name && typeof r.command === 'string') { name = 'shell'; args = { command: r.command }; }       // cursor beforeShellExecution
  const tool = kind(name);
  let command = first(args.command, args.CommandLine, args.cmd);
  if (Array.isArray(command)) command = command.join(' ');
  const cwd = first(args.working_directory, args.cwd, args.Cwd, args.workdir, args.directory, r.cwd, r.workspace_roots?.[0], r.workspacePaths?.[0], process.cwd());
  const out = { tool, cwd };
  if (tool === 'shell' && command !== undefined) out.command = String(command);
  if (tool === 'write') {
    let paths = Array.isArray(args.paths) ? args.paths : [first(args.file_path, args.filePath, args.path, args.notebook_path, args.target_file, args.TargetFile)].filter(Boolean);
    if (!paths.length && typeof command === 'string') paths = [...command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$|^\*\*\* Move to: (.+?)\s*$/gm)].map((m) => m[1] ?? m[2]); // codex apply_patch
    if (paths.length) { out.path = String(paths[0]); out.paths = paths.map(String); }
  }
  if (tool === 'fetch' && first(args.url, args.URL)) out.url = String(first(args.url, args.URL));
  return out;
}

export function formatDeny(host, reason) {
  const json = (o) => ({ stdout: `${JSON.stringify(o)}\n`, stderr: '', exitCode: 0 });
  switch (host) {
    case 'copilot': return json({ permissionDecision: 'deny', permissionDecisionReason: reason });
    case 'antigravity': case 'agentplugins': return json({ decision: 'deny', reason });
    // Spike note b-hooks-windows (R16): Codex denies with JSON at exit 0, independent of the Windows shell.
    case 'codex': return json({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    default: return { stdout: '', stderr: `${reason}\n`, exitCode: 2 };
  }
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '');
}

function hostOf(argv) {
  const i = argv.findIndex((a) => a === '--host' || a.startsWith('--host='));
  return i < 0 ? 'claude' : argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1];
}

export async function run(argv, io = {}) {
  io = { read: readStdin, out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t), load: () => import('./policy.mjs'), ...io };
  try {
    const host = String(hostOf(argv) ?? 'claude').toLowerCase();
    const text = (await io.read()).trim();
    if (!text) return 0;
    const ev = normalizeEvent(JSON.parse(text));
    const { checkToolUse } = await io.load(); // late import: a broken policy module must fail open, not crash the hook
    for (const p of ev.paths ?? [ev.path]) {
      const res = checkToolUse({ ...ev, path: p });
      if (res.deny) {
        const d = formatDeny(host, res.reason);
        if (d.stdout) io.out(d.stdout);
        if (d.stderr) io.err(d.stderr);
        return d.exitCode;
      }
    }
    return 0;
  } catch (e) {
    io.err(`pag guard: internal error, allowing: ${e?.message ?? e}\n`);
    return 0;
  }
}

