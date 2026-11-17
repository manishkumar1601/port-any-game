import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const MiB = 1024 * 1024;
const PARTIAL_OVER = 256 * MiB;

export function cacheDir() {
  const dir = process.env.PAG_CACHE || path.join(homedir(), '.port-any-game');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Depth-first walk. Never throws on per-entry problems: yields {error} instead.
// Regular files are opened once so locked/unreadable ones are reported up front.
export async function* walk(root, { maxFiles = 200000 } = {}) {
  const stack = [''];
  let count = 0;
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(root, relDir);
    let names;
    try {
      names = await readdir(absDir);
    } catch (e) {
      yield { rel: relDir, abs: absDir, size: 0, isSymlink: false, error: e.message };
      continue;
    }
    names.sort();
    for (const name of names) {
      const rel = relDir ? `${relDir}/${name}` : name;
      const abs = path.join(root, ...rel.split('/'));
      let st;
      try {
        st = await lstat(abs);
      } catch (e) {
        yield { rel, abs, size: 0, isSymlink: false, error: e.message };
        continue;
      }
      if (st.isDirectory()) {
        stack.push(rel);
        continue;
      }
      if (count >= maxFiles) {
        yield { rel: '', truncated: true };
        return;
      }
      count++;
      const entry = { rel, abs, size: st.size, isSymlink: st.isSymbolicLink() };
      if (st.isFile()) {
        try {
          await (await open(abs, 'r')).close();
        } catch (e) {
          entry.error = e.message;
        }
      }
      yield entry;
    }
  }
}

export async function readRange(abs, offset, length) {
  const fh = await open(abs, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    return bytesRead === length ? buf : buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function readHeadTail(abs, size, n = 65536) {
  const len = Math.min(n, size);
  const head = await readRange(abs, 0, len);
  const tail = size <= n ? head : await readRange(abs, size - len, len);
  return { head, tail };
}

// Files over 256 MiB hash only their first and last 1 MiB (partial: true).
export async function sha256File(abs, size) {
  const h = createHash('sha256');
  if (size > PARTIAL_OVER) {
    h.update(await readRange(abs, 0, MiB));
    h.update(await readRange(abs, size - MiB, MiB));
    return { sha256: h.digest('hex'), partial: true };
  }
  for await (const chunk of createReadStream(abs)) h.update(chunk);
  return { sha256: h.digest('hex'), partial: false };
}

// SHA-256(salt + absolute path); the salt lives in <cacheDir>/salt so the path never leaves the machine.
export function rootId(absRoot) {
  const saltPath = path.join(cacheDir(), 'salt');
  if (!existsSync(saltPath)) writeFileSync(saltPath, randomBytes(16).toString('hex'));
  const salt = readFileSync(saltPath, 'utf8').trim();
  return createHash('sha256').update(salt + absRoot).digest('hex');
}
