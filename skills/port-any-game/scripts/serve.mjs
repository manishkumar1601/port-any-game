// `pag serve [dist]`: static server for a port's dist/ (also used by `pag verify` via startServer).
// Loopback by default; every response carries X-Robots-Tag; response headers beyond that come only from <root>/_headers.
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { createReadStream, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { assertTarget, PolicyError } from './policy.mjs';
import { fixtureIndexUrl } from '../assets/shell/pure.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.swf': 'application/x-shockwave-flash', '.zip': 'application/zip',
  '.jsdos': 'application/zip', '.data': 'application/octet-stream', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

// Netlify `_headers`: a pattern at column 0, indented `Name: value` lines below it.
export function parseHeadersFile(text, warn = () => {}) {
  const rules = [];
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      const i = raw.indexOf(':');
      if (i > 0 && rules.length) {
        const k = raw.slice(0, i).trim(), v = raw.slice(i + 1).trim();
        try { http.validateHeaderName(k); http.validateHeaderValue(k, v); rules.at(-1).headers[k] = v; }
        catch { warn(`_headers: skipping invalid header line '${raw.trim()}'`); }
      }
    } else rules.push({ pattern: raw.trim(), headers: {} });
  }
  return rules;
}
const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const patternRe = (p) => new RegExp(`^${p.split('*').map(escapeRe).join('.*')}$`);

const inside = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
const statOf = (p) => { try { return statSync(p); } catch { return null; } };

// Resolve a request path under base. Returns {file, size} | {status}.
function resolve(base, rawPath, caseFallback, log) {
  const segs = [];
  for (const s of rawPath.split('/')) {
    if (!s || s === '.') continue;
    let d;
    try { d = decodeURIComponent(s); } catch { return { status: 400 }; }
    if (d === '..' || d.includes('\0') || d.includes(String.fromCharCode(92)) || d.includes('/')) return { status: 400 };
    segs.push(d);
  }
  // Match every segment against the real directory entry so lookups are case-exact even on
  // case-insensitive filesystems (Windows/macOS); caseFallback relaxes that to case-insensitive.
  let cur = base, folded = false;
  for (const s of segs) {
    let names;
    try { names = readdirSync(cur); } catch { return { status: 404 }; }
    const nfc = s.normalize('NFC');
    let hit = names.find((n) => n === s || n.normalize('NFC') === nfc);
    if (!hit && caseFallback) { hit = names.find((n) => n.normalize('NFC').toLowerCase() === nfc.toLowerCase()); folded = !!hit; }
    if (!hit) return { status: 404 };
    cur = path.join(cur, hit);
  }
  if (!inside(base, cur)) return { status: 400 };
  let st = statOf(cur);
  if (st?.isDirectory()) { cur = path.join(cur, 'index.html'); st = statOf(cur); }
  if (!st?.isFile()) return { status: 404 };
  try { if (!inside(realpathSync(base), realpathSync(cur))) return { status: 404 }; } catch { return { status: 404 }; }
  if (folded) log(`case-fallback: ${rawPath} -> ${path.relative(base, cur)}`);
  return { file: cur, size: st.size };
}

const FIXTURE_INDEX = fixtureIndexUrl('/__fixture/');
export const loopbackHost = (h, port) => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(String(h ?? '').toLowerCase());
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// fixtureIndex (verify, R31/R34): served beside the mount at /__fixture.index.json, so verify never writes an index
// into the game folder and the index never shadows a game file named index.json.
export function startServer({ root, host = '127.0.0.1', port = 0, password, fixtureDir, fixtureIndex, caseFallback = false, log = (m) => process.stderr.write(`${m}\n`) }) {
  const base = path.resolve(root);
  const fixture = fixtureDir && path.resolve(fixtureDir);
  const loopback = host !== '0.0.0.0';
  const rules = [];
  try { for (const r of parseHeadersFile(readFileSync(path.join(base, '_headers'), 'utf8'), log)) rules.push({ re: patternRe(r.pattern), headers: r.headers }); } catch { /* none */ }

  const server = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0].split('#')[0];
    const send = (status, headers = {}, body) => {
      for (const r of rules) if (r.re.test(pathname)) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.setHeader('X-Robots-Tag', 'noindex, nofollow'); // last: _headers must not weaken it
      res.statusCode = status;
      if (body?.pipe) body.pipe(res); else res.end(body);
    };
    // M6: DNS rebinding. A loopback server answers only to its own loopback names (the stable ports are predictable).
    if (loopback && !loopbackHost(req.headers.host, server.address()?.port)) return send(421);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { Allow: 'GET, HEAD' });
    if (password) {
      const m = /^Basic (.+)$/i.exec(req.headers.authorization || '');
      const given = m ? Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':') : '';
      if (!m || !crypto.timingSafeEqual(sha(given), sha(password))) return send(401, { 'WWW-Authenticate': 'Basic realm="port-any-game"' });
    }
    if (fixtureIndex && pathname === FIXTURE_INDEX) {
      const json = Buffer.from(JSON.stringify(fixtureIndex));
      return send(200, { 'Content-Type': MIME['.json'], 'Content-Length': json.length }, req.method === 'HEAD' ? undefined : json);
    }
    let dir = base, rel = pathname;
    if (fixture && (pathname === '/__fixture' || pathname.startsWith('/__fixture/'))) { dir = fixture; rel = pathname.slice('/__fixture'.length); }
    const r = resolve(dir, rel, caseFallback, log);
    if (!r.file) return send(r.status);

    const headers = { 'Content-Type': MIME[path.extname(r.file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    let status = 200, start = 0, end = r.size - 1;
    const rm = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || ''); // single range only; anything else serves the full file
    if (rm && (rm[1] || rm[2])) {
      const invalid = rm[1] && rm[2] && Number(rm[2]) < Number(rm[1]); // RFC 9110: ignore the header, serve 200
      if (!invalid) {
        if (rm[1]) { start = Number(rm[1]); if (rm[2]) end = Math.min(Number(rm[2]), end); }
        else { start = Math.max(0, r.size - Number(rm[2])); }
        if (start >= r.size || start > end) return send(416, { 'Content-Range': `bytes */${r.size}` });
        status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${r.size}`;
      }
    }
    headers['Content-Length'] = r.size ? end - start + 1 : 0;
    if (req.method === 'HEAD' || !r.size) return send(status, headers);
    const body = createReadStream(r.file, { start, end });
    res.on('close', () => body.destroy()); // client abort must release the file handle
    body.on('error', (e) => {
      if (res.headersSent) return res.destroy();
      res.removeHeader('Content-Length'); res.removeHeader('Content-Range');
      res.statusCode = e.code === 'ENOENT' ? 404 : 500;
      res.end();
    });
    send(status, headers, body);
  });
  return new Promise((resolveP, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const { port: p } = server.address();
      resolveP({ address: server.address().address, url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${p}`, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) });
    });
  });
}

// R28: a per-game default port in 20000-29999 (below the OS ephemeral ranges), so a packaged launcher and `pag serve` agree.
export const stablePort = (id) => 20000 + (sha(id).readUInt32BE(0) % 10000);

const USAGE = 'usage: pag serve [dist] [--port N] [--lan --password-env VAR] [--open]\n';

function nearestPort(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    try { return JSON.parse(readFileSync(path.join(d, 'port.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { /* keep looking */ }
    if (path.dirname(d) === d) return {};
  }
}

export async function run(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { port: { type: 'string' }, lan: { type: 'boolean' }, 'password-env': { type: 'string' }, open: { type: 'boolean' } } });
    if (args.positionals.length > 1) throw new Error('too many arguments');
  } catch (e) { io.err(`pag serve: ${e.message}\n${USAGE}`); return 2; }
  const { values } = args;
  const root = path.resolve(args.positionals[0] ?? 'dist');
  const explicitPort = values.port !== undefined;
  const portNum = explicitPort ? Number(values.port) : undefined;
  if (explicitPort && (!Number.isInteger(portNum) || portNum < 0 || portNum > 65535)) { io.err(`pag serve: invalid --port\n${USAGE}`); return 2; }
  if (!statOf(root)?.isDirectory()) { io.err(`pag serve: ${root} is not a directory (build or pack the port first)\n${USAGE}`); return 2; }

  let password;
  if (values['password-env']) password = process.env[values['password-env']] || undefined;
  if (values.lan) {
    try { assertTarget(nearestPort(root), 'lan', { password }); } catch (e) { io.err(`pag serve: ${e.message}\n`); return e instanceof PolicyError ? 4 : 2; }
  } else password = undefined; // loopback needs no auth

  let caseFallback = false;
  try { caseFallback = JSON.parse(readFileSync(path.join(root, 'shell.json'), 'utf8').replace(/^\uFEFF/, '')).serve?.caseFallback === true; } catch { /* defaults */ }

  const known = nearestPort(root);
  const port = explicitPort ? portNum : stablePort(known.id ?? root);
  let srv;
  try { srv = await startServer({ root, host: values.lan ? '0.0.0.0' : '127.0.0.1', port, password, caseFallback, log: (m) => io.err(`${m}\n`) }); }
  catch (e) {
    if (e.code === 'EADDRINUSE') { io.err(`pag serve: port ${port} is in use (another copy of this game may already be running); pass --port\n`); return 1; }
    io.err(`pag serve: ${e.message}\n`); return 1; // M19: a failure, not a usage error
  }
  io.out(`${srv.url}\n`);
  if (values.open) {
    const [cmd, ...a] = process.platform === 'win32' ? ['explorer.exe', srv.url] : [process.platform === 'darwin' ? 'open' : 'xdg-open', srv.url];
    try { const c = spawn(cmd, a, { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch { /* ignore */ }
  }
  await new Promise((r) => { for (const s of ['SIGINT', 'SIGTERM']) process.once(s, r); });
  await srv.close();
  return 0;
}
