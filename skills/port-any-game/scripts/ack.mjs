// `pag ack <ID> [portDir] [--note=<the user's own words> | --note-env VAR]` (R50): record one acknowledgement the user
// gave, as {id, at, note?} in the nearest port.json. Only pag writes port.json (the guard blocks agent edits); the skill
// asks the user a plain question and runs this only after a yes. Exit 0 recorded or already there, 1 failure, 2 usage.
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { findPort } from './status.mjs';

// Note 04 §B.9 plus ACK_RIGHTS_HOLDER (R21); the two the survey verdict itself requires (UPX, other warn-level
// protection); and R52: one ID for each spec §11 Warn item that has none of the above.
export const ACK_IDS = ['ACK_PRIVATE_USE_ONLY', 'ACK_RUNTIME_LICENSE', 'ACK_GREY_ASSET_EXTRACT', 'ACK_GREY_DECOMPILE',
  'ACK_RIGHTS_HOLDER', 'ACK_UPX_PACKED', 'ACK_PROTECTION_WARN',
  'ACK_WARN_STORE_LICENSED', 'ACK_WARN_LIGHTLY_ENCRYPTED', 'ACK_WARN_NETWORKING_DISABLED',
  'ACK_WARN_PROPRIETARY_MIDDLEWARE', 'ACK_WARN_BEYOND_LOOPBACK'];
const USAGE = 'usage: pag ack <ID> [portDir] [--note=<the user\'s own words> | --note-env VAR]\n';

export async function run(argv, io = {}) {
  io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t), cwd: process.cwd(), ...io };
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { note: { type: 'string' }, 'note-env': { type: 'string' } } });
    if (args.positionals.length < 1 || args.positionals.length > 2) throw new Error('expected an acknowledgement ID and an optional port folder');
    if (args.values.note !== undefined && args.values['note-env'] !== undefined) throw new Error('pass --note or --note-env, not both');
  } catch (e) { io.err(`pag ack: ${e.message}\n${USAGE}`); return 2; }
  const [id, portDir = '.'] = args.positionals;
  let { note } = args.values;
  // --note-env: the shell never parses the words (Windows PowerShell 5.1 drops `"` inside native-command arguments).
  const envVar = args.values['note-env'];
  if (envVar !== undefined) {
    note = process.env[envVar];
    if (note === undefined) { io.err(`pag ack: environment variable ${envVar} is not set\n`); return 2; }
  }
  if (!ACK_IDS.includes(id)) { io.err(`pag ack: unknown acknowledgement '${id}'. Known: ${ACK_IDS.join(', ')}\n`); return 2; }
  // The rights statement is the user's own, kept word for word as the audit trail; the agent never words it for them.
  if (id === 'ACK_RIGHTS_HOLDER' && !note?.trim()) { io.err('pag ack: ACK_RIGHTS_HOLDER needs --note (or --note-env) with the user\'s own words, copied exactly from what the user said\n'); return 2; }
  try {
    const found = findPort(path.resolve(io.cwd, portDir));
    if (!found) { io.err(`pag ack: no port.json at or above ${path.resolve(io.cwd, portDir)}; run pag new first or pass the port folder\n`); return 2; }
    const { dir, port } = found;
    const file = path.join(dir, 'port.json');
    if (port.acks !== undefined && !Array.isArray(port.acks)) { io.err(`pag ack: ${file} has an "acks" field that is not a list; it was left unchanged\n`); return 1; }
    const acks = port.acks ?? [];
    const had = acks.find((a) => a?.id === id);
    if (had) { io.out(`${id} is already recorded${had.at ? ` (${had.at})` : ''}; nothing changed.\n`); return 0; }
    const entry = { id, at: new Date().toISOString(), ...(note !== undefined ? { note } : {}) };
    port.acks = [...acks, entry];
    const tmp = `${file}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, `${JSON.stringify(port, null, 2)}\n`);
      renameSync(tmp, file); // a crash mid-write never leaves a half-written port.json
    } catch (e) { rmSync(tmp, { force: true }); throw e; }
    // The note is echoed JSON-quoted so the agent can compare it, character for character, with what the user said.
    io.out(`Recorded ${id} at ${entry.at} in ${file}${note !== undefined ? `, note: ${JSON.stringify(note)}` : ''}.\n`);
    return 0;
  } catch (e) { io.err(`pag ack: ${e.message}\n`); return 1; }
}
