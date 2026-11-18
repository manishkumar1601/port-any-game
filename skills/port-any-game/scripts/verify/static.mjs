// verify steps 1-2 (spec §9), no browser: static checks on dist/ and a probe of what the server really sends.
import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { sha256File, walk } from '../lib/fsx.mjs';
import { isPublicAllowed } from '../policy.mjs';
import { startServer } from '../serve.mjs';

const MiB = 1024 * 1024;

// port: the parsed port.json, or null when none was found (a public build then cannot show its rights).
export async function staticChecks(dist, shell, manifest, port) {
  const out = [];
  const add = (name, status, detail) => out.push({ name, status, detail });
  const missing = ['game_id', 'lane', 'entry.adapter', 'data.mode', 'data.manifest', 'verify.target_fps']
    .filter((k) => k.split('.').reduce((o, p) => o?.[p], shell) == null);
  if (shell.schema !== 1) missing.unshift('schema: 1');
  if (shell.entry?.adapter && !statSync(path.join(dist, ...shell.entry.adapter.split('/')), { throwIfNoEntry: false })?.isFile()) missing.push(`${shell.entry.adapter} (no such file)`);
  add('schema', missing.length ? 'fail' : 'pass', missing.length ? `shell.json: missing ${missing.join(', ')}` : 'shell.json ok');

  // Public game data needs the rights holder's acknowledgement or catalog-redistributable data (spec §11).
  if (shell.data?.mode === 'bundled-public') {
    add('public', isPublicAllowed(port) ? 'pass' : 'fail', isPublicAllowed(port) ? 'public data allowed by port.json'
      : `a bundled-public build needs an ACK_RIGHTS_HOLDER acknowledgement or catalog-redistributable data in port.json${port ? '' : ' (no port.json found)'}`);
  }

  const files = [];
  for await (const e of walk(dist)) if (!e.truncated && !e.error) files.push(e);
  const problems = [];
  if (shell.data?.mode === 'byo') {
    const carried = files.filter((e) => e.rel.startsWith('game/'));
    if (carried.length) problems.push(`a byo build must not carry game files, found ${carried.length} (${carried[0].rel})`);
  } else {
    for (const f of manifest.files ?? []) {
      const abs = path.join(dist, 'game', ...f.path.split('/'));
      const st = statSync(abs, { throwIfNoEntry: false });
      if (!st?.isFile()) problems.push(`${f.path}: missing`);
      else if (st.size !== f.size) problems.push(`${f.path}: ${st.size} bytes, manifest says ${f.size}`);
      else if ((await sha256File(abs, st.size)).sha256 !== f.sha256) problems.push(`${f.path}: SHA-256 differs from the manifest`);
    }
  }
  add('manifest', problems.length ? 'fail' : 'pass', problems.length ? problems.slice(0, 5).join('; ')
    : `${manifest.files?.length ?? 0} game files, ${((manifest.total_bytes ?? 0) / MiB).toFixed(1)} MiB, ${shell.data?.mode}`);
  const big = files.filter((e) => e.size > 25 * MiB);
  add('host limits', big.length ? 'warn' : 'pass', big.length ? `${big.length} files over 25 MiB, which some static hosts refuse (${big[0].rel})` : `${files.length} files, none over 25 MiB`);

  let headers = null;
  try { headers = readFileSync(path.join(dist, '_headers'), 'utf8'); } catch { /* checked below */ }
  const coi = /Cross-Origin-Opener-Policy:\s*same-origin/i.test(headers) && /Cross-Origin-Embedder-Policy:\s*require-corp/i.test(headers);
  const hp = !headers ? 'no _headers file' : /credentialless/i.test(headers) ? '_headers uses credentialless (Safari lacks it)'
    : shell.needs_coi && !coi ? 'needs_coi is true but _headers lacks COOP same-origin + COEP require-corp' : null;
  add('headers', hp ? 'fail' : 'pass', hp ?? '_headers present');
  // R61: info, not warn, so every port of such a lane does not exit 2.
  if (shell.csp) add('csp', 'info', `the lane relaxes the Content-Security-Policy for the game's own code: ${Object.entries(shell.csp).map(([k, v]) => `${k} += ${v.join(' ')}`).join('; ')}`);
  const lic = files.filter((e) => e.rel.startsWith('LICENSES/'));
  add('licenses', lic.length ? 'pass' : 'fail', lic.length ? lic.map((e) => e.rel.slice(9)).join(', ') : 'no notices in LICENSES/');
  return out;
}

// Headers (COOP/COEP when needed, never credentialless, X-Robots-Tag) and Range on the verify server at url; then
// password auth on a short-lived second server over the same dist: 401 without credentials, 200 with them.
export async function probe(url, shell, dist) {
  const issues = [];
  const head = await fetch(`${url}/`, { method: 'HEAD' });
  const h = (k) => head.headers.get(k);
  if (shell.needs_coi && (h('cross-origin-opener-policy') !== 'same-origin' || h('cross-origin-embedder-policy') !== 'require-corp')) issues.push('COOP/COEP not served');
  if (/credentialless/i.test(h('cross-origin-embedder-policy') ?? '')) issues.push('COEP credentialless served');
  if (!h('x-robots-tag')) issues.push('no X-Robots-Tag');
  const r = await fetch(`${url}/shell/shell.js`, { headers: { Range: 'bytes=0-15' } });
  const body = await r.arrayBuffer();
  if (r.status !== 206 || body.byteLength !== 16) issues.push(`Range bytes=0-15 gave HTTP ${r.status} with ${body.byteLength} bytes`);

  const password = randomUUID();
  const locked = await startServer({ root: dist, password, log: () => {} });
  try {
    const get = async (headers) => { const res = await fetch(`${locked.url}/`, { headers }); await res.arrayBuffer(); return res.status; };
    const without = await get({});
    const withPw = await get({ Authorization: `Basic ${Buffer.from(`verify:${password}`).toString('base64')}` });
    if (without !== 401 || withPw !== 200) issues.push(`password auth gave ${without} without and ${withPw} with credentials (want 401/200)`);
  } finally { await locked.close(); }
  return { name: 'serve', status: issues.length ? 'fail' : 'pass', detail: issues.join('; ') || 'headers ok, Range 206, auth 401/200' };
}
