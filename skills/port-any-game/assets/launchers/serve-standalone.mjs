// Standalone static server for a packaged port. No plugin imports: it must run with only Node installed.
// Reads launch.json {port, needs_coi} and headers.json [{pattern, headers}] beside it; serves ./dist on 127.0.0.1.
import http from 'node:http';
import path from 'node:path';
import { createReadStream, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const readJson = (f, d) => { try { return JSON.parse(readFileSync(path.join(here, f), 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const { port, case_fallback: caseFallback } = readJson('launch.json', {});
const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const rules = readJson('headers.json', []).map((r) => ({ re: new RegExp(`^${r.pattern.split('*').map(escapeRe).join('.*')}$`), headers: r.headers }));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.swf': 'application/x-shockwave-flash', '.zip': 'application/zip',
  '.jsdos': 'application/zip', '.txt': 'text/plain; charset=utf-8',
};
const inside = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
const statOf = (p) => { try { return statSync(p); } catch { return null; } };

function resolve(rawPath) {
  let cur = dist;
  for (const s of rawPath.split('/')) {
    if (!s || s === '.') continue;
    let d;
    try { d = decodeURIComponent(s); } catch { return { status: 400 }; }
    if (d === '..' || d.includes('\0') || d.includes('\\') || d.includes('/') || (process.platform === 'win32' && d.includes(':'))) return { status: 400 };
    let next = path.join(cur, d);
    if (caseFallback && !statOf(next)) { // per-segment case-insensitive lookup, like serve.mjs caseFallback
      let names = [];
      try { names = readdirSync(cur); } catch { /* 404 below */ }
      const want = d.normalize('NFC').toLowerCase();
      const hit = names.find((n) => n.normalize('NFC').toLowerCase() === want);
      if (hit) next = path.join(cur, hit);
    }
    cur = next;
  }
  if (!inside(dist, cur)) return { status: 400 };
  let st = statOf(cur);
  if (st?.isDirectory()) { cur = path.join(cur, 'index.html'); st = statOf(cur); }
  if (!st?.isFile()) return { status: 404 };
  try { if (!inside(realpathSync(dist), realpathSync(cur))) return { status: 404 }; } catch { return { status: 404 }; }
  return { file: cur, size: st.size };
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0].split('#')[0];
  const send = (status, headers = {}, body) => {
    for (const r of rules) if (r.re.test(pathname)) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.statusCode = status;
    if (body?.pipe) body.pipe(res); else res.end(body);
  };
  // DNS rebinding: answer only to this server's own loopback names (like serve.mjs).
  if (![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(String(req.headers.host ?? '').toLowerCase())) return send(421);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { Allow: 'GET, HEAD' });
  const r = resolve(pathname);
  if (!r.file) return send(r.status);
  const headers = { 'Content-Type': MIME[path.extname(r.file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  let status = 200, start = 0, end = r.size - 1;
  const rm = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rm && (rm[1] || rm[2]) && !(rm[1] && rm[2] && Number(rm[2]) < Number(rm[1]))) {
    if (rm[1]) { start = Number(rm[1]); if (rm[2]) end = Math.min(Number(rm[2]), end); }
    else start = Math.max(0, r.size - Number(rm[2]));
    if (start >= r.size || start > end) return send(416, { 'Content-Range': `bytes */${r.size}` });
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${r.size}`;
  }
  headers['Content-Length'] = r.size ? end - start + 1 : 0;
  if (req.method === 'HEAD' || !r.size) return send(status, headers);
  const body = createReadStream(r.file, { start, end });
  res.on('close', () => body.destroy());
  body.on('error', () => res.destroy());
  send(status, headers, body);
});

const url = `http://127.0.0.1:${port}/`;
function open() {
  if (process.env.PAG_NO_OPEN === '1') return;
  const [cmd, ...a] = process.platform === 'win32' ? ['explorer.exe', url] : [process.platform === 'darwin' ? 'open' : 'xdg-open', url];
  try { const c = spawn(cmd, a, { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch { /* the URL is printed anyway */ }
}

if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('launch.json is missing or has no valid port'); process.exit(1); }
server.once('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`Port ${port} is in use; assuming this game is already running. Opening ${url}`); open(); process.exit(0); }
  console.error(e.message); process.exit(1);
});
server.listen(port, '127.0.0.1', () => { console.log(`Playing at ${url}  (close this window to stop)`); open(); });
