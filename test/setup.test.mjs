import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createZip } from '../skills/port-any-game/assets/shell/zip.js';
import { ensureTool, run, toolDir } from '../skills/port-any-game/scripts/setup.mjs';

function tarEntry(name, body) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0' + '00', 257);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

const enc = (s) => new TextEncoder().encode(s);
const zip = Buffer.from(createZip([{ name: 'ruffle.js', data: enc('// r'.repeat(500)) }, { name: 'LICENSE.md', data: enc('MIT') }]));
const tgz = gzipSync(Buffer.concat([tarEntry('package/dist/js-dos.js', enc('x'.repeat(2000))), Buffer.alloc(1024)]));
const sha = (b) => createHash('sha256').update(b).digest('hex');

const base = mkdtempSync(path.join(tmpdir(), 'pag-setup-'));
let server;
let url;
const requests = [];
before(async () => {
  process.env.PAG_CACHE = path.join(base, 'cache');
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, range: req.headers.range });
    const body = req.url.startsWith('/z') ? zip : tgz;
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    if (m) {
      res.writeHead(206, { 'content-length': body.length - Number(m[1]) });
      res.end(body.subarray(Number(m[1])));
    } else {
      res.writeHead(200, { 'content-length': body.length });
      res.end(body);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(base, { recursive: true, force: true }); });

const lock = (over = {}) => ({
  'ruffle-selfhosted': { name: 'ruffle-selfhosted', version: 't1', url: `${url}/z.zip`, sha256: sha(zip), size: zip.length, archive: 'zip', licenseFile: 'LICENSE.md', ...over },
  'js-dos': { name: 'js-dos', version: 't1', url: `${url}/t.tgz`, sha256: sha(tgz), size: tgz.length, archive: 'tgz', strip: 1, licenseFile: 'x' },
});

test('setup downloads, verifies and extracts', async () => {
  const l = lock();
  const dir = await ensureTool('ruffle', { lock: l });
  assert.equal(dir, toolDir(l['ruffle-selfhosted']));
  assert.ok(existsSync(path.join(dir, 'ruffle.js')));
  assert.ok(existsSync(path.join(dir, '.ok')));
  const js = await ensureTool('jsdos', { lock: l });
  assert.ok(existsSync(path.join(js, 'dist', 'js-dos.js')), 'strip 1 drops package/');
  assert.deepEqual(readdirSync(path.dirname(dir)).filter((n) => n.includes('.tmp-')), []);
});

test('setup is a no-op when .ok exists', async () => {
  const l = lock();
  await ensureTool('ruffle', { lock: l });
  const n = requests.length;
  await ensureTool('ruffle', { lock: l });
  assert.equal(requests.length, n);
});

test('setup resumes partial download and rejects bad hash', async () => {
  const l = lock({ version: 't2' });
  const part = path.join(process.env.PAG_CACHE, 'downloads', 'ruffle-selfhosted-t2.zip.part');
  mkdirSync(path.dirname(part), { recursive: true });
  writeFileSync(part, zip.subarray(0, 100));
  requests.length = 0;
  const dir = await ensureTool('ruffle-selfhosted', { lock: l });
  assert.equal(requests[0].range, 'bytes=100-');
  assert.ok(existsSync(path.join(dir, 'ruffle.js')));

  const bad = lock({ version: 't3', sha256: 'a'.repeat(64) });
  await assert.rejects(ensureTool('ruffle', { lock: bad }), /sha256 mismatch/);
  assert.equal(existsSync(toolDir(bad['ruffle-selfhosted'])), false);
  assert.deepEqual(readdirSync(path.join(process.env.PAG_CACHE, 'tools')).filter((n) => n.includes('t3')), []);
});

test('setup without --yes downloads nothing', async () => {
  const l = lock({ version: 't4' });
  requests.length = 0;
  assert.equal(await run(['ruffle'], { lock: l }), 0);
  assert.equal(requests.length, 0);
  assert.equal(existsSync(toolDir(l['ruffle-selfhosted'])), false);
  assert.equal(await run(['core'], { lock: l }), 0);
});

test('playwright installs only via runner, with browsers path in cache', async () => {
  const l = { playwright: { name: 'playwright', version: '9.9.9', special: 'npm' } };
  const calls = [];
  const dir = await ensureTool('playwright', { lock: l, run: (cmd, args, env) => calls.push({ cmd, args, b: env.PLAYWRIGHT_BROWSERS_PATH }) });
  assert.equal(calls[0].cmd, 'npm');
  assert.ok(calls[0].args.includes('playwright@9.9.9') && calls[0].args.includes(dir));
  assert.equal(calls[1].b, path.join(process.env.PAG_CACHE, 'ms-playwright'));
  assert.ok(existsSync(path.join(dir, '.ok')));
});

test('real lock pins are well-formed', () => {
  const l = JSON.parse(readFileSync(new URL('../skills/port-any-game/scripts/toolchain.lock.json', import.meta.url), 'utf8'));
  for (const n of ['ruffle-selfhosted', 'js-dos']) assert.match(l[n].sha256, /^[0-9a-f]{64}$/);
  assert.equal(l.playwright.special, 'npm');
});
