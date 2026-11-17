// port-any-game CLI dispatcher. Run as `node <abs path>/pag.mjs <command> ...`.
// Add a command = one line in COMMANDS; its module exports run(argv) -> exit code.
const COMMANDS = {
  survey: () => import('./survey/survey.mjs'),
  new: () => import('./new.mjs'),
  serve: () => import('./serve.mjs'),
  doctor: () => import('./doctor.mjs'),
  setup: () => import('./setup.mjs'),
  // guard fails open (Copilot hooks fail closed on a crash): any import failure exits 0 silently.
  guard: () => import('./guard.mjs').catch((e) => ({ run: async () => (process.stderr.write(`pag guard: load error, allowing: ${e?.message}
`), 0) })),
};

const usage = () => `usage: pag <command> [args]\ncommands: ${Object.keys(COMMANDS).join(', ')}\n`;

const [cmd, ...rest] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, cmd ?? '')) {
  process.stderr.write(cmd ? `pag: unknown command '${cmd}'\n${usage()}` : usage());
  process.exitCode = 2;
} else {
  process.exitCode = await (await COMMANDS[cmd]()).run(rest);
}
