// `pag build [portDir]`: run the port's lane build step (lanes add build(portDir) in Tasks 16-18).
// Exit 0 ok, 1 failure or no build step, 2 usage, 4 policy refusal.
import path from 'node:path';
import { PolicyError } from './policy.mjs';
import { LANES } from './lanes/index.mjs';
import { readPort } from './pack.mjs';

// opts.laneModule overrides LANES[port.lane] (tests).
export async function run(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, { laneModule } = {}) {
  const [portDir = '.', ...extra] = argv;
  if (extra.length || portDir.startsWith('-')) { io.err('usage: pag build [portDir]\n'); return 2; }
  const dir = path.resolve(portDir);
  let port;
  try { port = readPort(dir); } catch (e) { io.err(`pag build: ${e.message}\n`); return 2; }
  const lane = laneModule ?? LANES[port.lane];
  if (!lane) { io.err(`pag build: unknown lane '${port.lane}' in port.json\n`); return 2; }
  if (typeof lane.build !== 'function') { io.err(`pag build: lane ${lane.id} has no build step yet\n`); return 1; }
  try {
    io.out(`${JSON.stringify((await lane.build(dir)) ?? {}, null, 2)}\n`);
    return 0;
  } catch (e) {
    io.err(`pag build: ${e.message}\n`);
    return e instanceof PolicyError ? 4 : 1;
  }
}
