import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cacheDir, walk, readHeadTail, readRange, sha256File, rootId } from '../../skills/port-any-game/scripts/lib/fsx.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'pag-fsx-'));
const collect = async (it) => { const a = []; for await (const e of it) a.push(e); return a; };

function withCache(dir, fn) {
  const old = process.env.PAG_CACHE;
  process.env.PAG_CACHE = dir;
  try { return fn(); } finally {
    if (old === undefined) delete process.env.PAG_CACHE; else process.env.PAG_CACHE = old;
  }
}

test('cacheDir honours PAG_CACHE and creates it', () => {
  const base = tmp();
  try {
    const want = path.join(base, 'c', 'd');
    assert.equal(withCache(want, cacheDir), want);
    assert.ok(existsSync(want));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('walk yields relative forward-slash paths', async () => {
  const root = tmp();
  try {
    mkdirSync(path.join(root, 'a', 'b'), { recursive: true });
    writeFileSync(path.join(root, 'a', 'b', 'f.txt'), 'xyz');
    writeFileSync(path.join(root, 'top.txt'), '');
    const got = await collect(walk(root));
    assert.deepEqual(got.map((e) => e.rel).sort(), ['a/b/f.txt', 'top.txt']);
    const f = got.find((e) => e.rel === 'a/b/f.txt');
    assert.equal(f.size, 3);
    assert.equal(f.isSymlink, false);
    assert.equal(f.abs, path.join(root, 'a', 'b', 'f.txt'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('walk truncates at maxFiles', async () => {
  const root = tmp();
  try {
    for (let i = 0; i < 5; i++) writeFileSync(path.join(root, `f${i}`), 'x');
    const got = await collect(walk(root, { maxFiles: 3 }));
    assert.equal(got.length, 4);
    assert.deepEqual(got.at(-1), { rel: '', truncated: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('walk reports unreadable entry with error', async (t) => {
  const root = tmp();
  let child;
  try {
    const bad = path.join(root, 'locked.bin');
    writeFileSync(bad, 'secret');
    writeFileSync(path.join(root, 'ok.bin'), 'fine');
    if (process.platform === 'win32') {
      // Hold an exclusive lock from a separate process (no shell).
      const quoted = bad.replace(/'/g, "''");
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$f=[IO.File]::Open('${quoted}','Open','Read','None'); Write-Output ready; Start-Sleep 120`],
      { stdio: ['ignore', 'pipe', 'ignore'] });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', () => reject(new Error('lock helper exited early')));
        child.stdout.on('data', (d) => d.toString().includes('ready') && resolve());
      });
    } else {
      if (process.getuid?.() === 0) return t.skip('running as root, chmod 000 does not block reads');
      chmodSync(bad, 0o000);
    }
    try { fs.closeSync(fs.openSync(bad, 'r')); return t.skip('this machine cannot make a file unreadable for the current user (an open succeeded despite the lock/chmod)'); } catch { /* unreadable, as the test needs */ }
    const got = await collect(walk(root));
    assert.ok(got.find((e) => e.rel === 'locked.bin').error, 'locked file carries error');
    assert.equal(got.find((e) => e.rel === 'ok.bin').error, undefined);
  } finally {
    if (child) {
      const gone = new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
      child.kill();
      await gone;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('readHeadTail and readRange read bounded slices', async () => {
  const root = tmp();
  try {
    const p = path.join(root, 'f');
    const data = Buffer.from('0123456789');
    writeFileSync(p, data);
    const { head, tail } = await readHeadTail(p, data.length, 4);
    assert.equal(head.toString(), '0123');
    assert.equal(tail.toString(), '6789');
    const small = await readHeadTail(p, data.length, 100);
    assert.equal(small.head.toString(), '0123456789');
    assert.equal(small.tail.toString(), '0123456789');
    assert.equal((await readRange(p, 2, 3)).toString(), '234');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sha256File full for small files', async () => {
  const root = tmp();
  try {
    const p = path.join(root, 'f');
    writeFileSync(p, 'abc');
    assert.deepEqual(await sha256File(p, 3), { sha256: createHash('sha256').update('abc').digest('hex'), partial: false });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sha256File partial over 256MiB', async () => {
  const root = tmp();
  try {
    const p = path.join(root, 'big.bin');
    const size = 257 * 1024 * 1024;
    const fh = await open(p, 'w');
    await fh.truncate(size);
    await fh.write(Buffer.from('HEAD'), 0, 4, 0);
    await fh.write(Buffer.from('TAIL'), 0, 4, size - 4);
    await fh.close();
    const r = await sha256File(p, size);
    assert.equal(r.partial, true);
    const MiB = 1024 * 1024;
    const head = Buffer.alloc(MiB); head.write('HEAD');
    const tail = Buffer.alloc(MiB); tail.write('TAIL', MiB - 4);
    assert.equal(r.sha256, createHash('sha256').update(head).update(tail).digest('hex'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rootId is stable, salted, and not the plain hash', () => {
  const base = tmp();
  try {
    withCache(base, () => {
      const a = rootId('/some/game');
      assert.match(a, /^[0-9a-f]{64}$/);
      assert.equal(rootId('/some/game'), a);
      assert.notEqual(rootId('/other'), a);
      assert.notEqual(a, createHash('sha256').update('/some/game').digest('hex'));
      assert.ok(existsSync(path.join(base, 'salt')));
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
