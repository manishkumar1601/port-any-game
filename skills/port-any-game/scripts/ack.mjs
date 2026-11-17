// `pag ack <ID> [portDir] [--note "<the user's own words>"]` (R50): record one acknowledgement the user gave, as
// {id, at, note?} in the nearest port.json. Only pag writes port.json (the guard blocks agent edits); the skill asks the
// user a plain question and runs this only after a yes. Exit 0 recorded or already there, 1 failure, 2 usage error.
import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { findPort } from './status.mjs';

// Note 04 §B.9 plus ACK_RIGHTS_HOLDER (R21), plus the two the survey verdict itself requires (spec §11 Warn list:
// UPX, other warn-level protection), so every ID in survey.json required_acknowledgements can be recorded.
export const ACK_IDS = ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE', 'ACK_GREY_ASSET_EXTRACT', 'ACK_GREY_DECOMPILE',
  'ACK_RIGHTS_HOLDER', 'ACK_UPX_PACKED', 'ACK_PROTECTION_WARN'];
const USAGE = 'usage: pag ack <ID> [portDir] [--note "<the user\'s own words>"]\n';

export async function run(argv, io = {}) {
  io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t), cwd: process.cwd(), ...io };
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { note: { type: 'string' } } });
    if (args.positionals.length < 1 || args.positionals.length > 2) throw new Error('expected an acknowledgement ID and an optional port folder');
  } catch (e) { io.err(`pag ack: ${e.message}\n${USAGE}`); return 2; }
  const [id, portDir = '.'] = args.positionals;
  const { note } = args.values;
  if (!ACK_IDS.includes(id)) { io.err(`pag ack: unknown acknowledgement '${id}'. Known: ${ACK_IDS.join(', ')}\n`); return 2; }
  // The rights statement is the user's own, kept word for word as the audit trail; the agent never words it for them.
  if (id === 'ACK_RIGHTS_HOLDER' && !note?.trim()) { io.err('pag ack: ACK_RIGHTS_HOLDER needs --note "<the user\'s own words>", copied exactly from what the user said\n'); return 2; }
  try {
    const found = findPort(path.resolve(io.cwd, portDir));
    if (!found) { io.err(`pag ack: no port.json at or above ${path.resolve(io.cwd, portDir)}; run pag new first or pass the port folder\n`); return 2; }
    const { dir, port } = found;
    const acks = Array.isArray(port.acks) ? port.acks : [];
    const had = acks.find((a) => a?.id === id);
    if (had) { io.out(`${id} is already recorded${had.at ? ` (${had.at})` : ''}; nothing changed.\n`); return 0; }
    const entry = { id, at: new Date().toISOString(), ...(note !== undefined ? { note } : {}) };
    port.acks = [...acks, entry];
    const file = path.join(dir, 'port.json');
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(port, null, 2)}\n`);
    renameSync(tmp, file); // a crash mid-write never leaves a half-written port.json
    io.out(`Recorded ${id} at ${entry.at} in ${file}.\n`);
    return 0;
  } catch (e) { io.err(`pag ack: ${e.message}\n`); return 1; }
}
