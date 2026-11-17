// port-any-game CLI dispatcher. Run as `node <abs path>/pag.mjs <command> ...`.
// Add a command = one line in COMMANDS; its module exports run(argv) -> exit code.
const COMMANDS = {
  survey: () => import('./survey/survey.mjs'),
  guard: () => import('./guard.mjs'),
};

const usage = () => `usage: pag <command> [args]\ncommands: ${Object.keys(COMMANDS).join(', ')}\n`;

const [cmd, ...rest] = process.argv.slice(2);
if (!Object.hasOwn(COMMANDS, cmd ?? '')) {
  process.stderr.write(cmd ? `pag: unknown command '${cmd}'\n${usage()}` : usage());
  process.exitCode = 2;
} else {
  process.exitCode = await (await COMMANDS[cmd]()).run(rest);
}
