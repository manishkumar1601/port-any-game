// Git guard for a port folder. Standalone, zero dependencies. Run by pre-commit (staged files)
// and pre-push (`--push`, commits being pushed). Rejects game magic bytes, survey.json hashes
// and binaries over 5 MiB. Skipped only when the game data may be public: the user recorded ACK_RIGHTS_HOLDER with pag
// (it adds `at`) or the data is catalog-redistributable (the same rule as policy.isPublicAllowed, R63).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const MAX = 5 * 1024 * 1024;
const MAGICS = ['MZ', 'GDPC', 'RGSSAD', 'XP3\r\n', 'UnityFS', 'RPA-', 'CLIB\x1a', 'IWAD', 'PWAD', 'PACK',
  'KenSilverman', 'BIK', 'SMK', 'FWS', 'CWS', 'ZWS', 'XFIR', 'RIFX'].map((m) => Buffer.from(m, 'latin1'));
const ZERO = /^0+$/;

const git = (args, opts = {}) => execFileSync('git', args, { maxBuffer: 2 ** 31 - 1, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const read = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

const port = read('port.json');
if (port?.data?.redistributable === true || (port?.acks ?? []).some((a) => a?.id === 'ACK_RIGHTS_HOLDER' && a.at)) process.exit(0);

const hashes = new Set();
(function collect(v) {
  if (Array.isArray(v)) return v.forEach(collect);
  if (v && typeof v === 'object') {
    if (typeof v.sha256 === 'string' && !v.partial) hashes.add(v.sha256.replace(/^sha256:/, '').toLowerCase());
    Object.values(v).forEach(collect);
  }
})(read('survey.json'));

// Items to check: {path, rev}; blob = `<rev><path>` ('' + ':' = index).
const items = [];
const names = (out) => out.toString('utf8').split('\0').filter(Boolean);
if (process.argv[2] === '--push') {
  const stdin = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  for (const line of stdin) {
    const [, local, , remote] = line.split(' ');
    if (!local || ZERO.test(local)) continue;
    const range = ZERO.test(remote) ? [local, '--not', '--remotes'] : [`${remote}..${local}`];
    for (const c of git(['rev-list', ...range]).toString().split('\n').filter(Boolean)) {
      for (const p of names(git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--diff-filter=ACMR', '--root', c]))) {
        items.push({ path: p, rev: `${c}:` });
      }
    }
  }
} else {
  for (const p of names(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']))) items.push({ path: p, rev: ':' });
}

const bad = [];
for (const { path: p, rev } of items) {
  const spec = `${rev}${p}`;
  let blob;
  try { blob = git(['cat-file', 'blob', spec]); } catch { continue; }
  const why = [];
  const magic = MAGICS.find((m) => blob.subarray(0, m.length).equals(m));
  if (magic) why.push(`starts with game magic '${magic.toString('latin1').replace(/[^\x20-\x7e]/g, '?')}'`);
  if (hashes.has(createHash('sha256').update(blob).digest('hex'))) why.push('matches a game file hash in survey.json');
  if (blob.length > MAX && blob.subarray(0, 8000).includes(0)) why.push('binary over 5 MiB');
  if (why.length) bad.push(`  ${p}: ${why.join('; ')}`);
}
if (bad.length) {
  process.stderr.write(`port-any-game git guard: refusing, these look like game data:\n${bad.join('\n')}\nKeep game bytes out of git (game/, work/, build/, dist/, analysis/ are ignored).\n`);
  process.exit(1);
}
