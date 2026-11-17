// OPFS helpers, persist/estimate, saves export/import, selfTest. No DOM at module top level
// (the import Worker and the Node tests import this module).
import { createZip } from './zip.js';
import { normalizePath, readStoredZip } from './pure.js';

export const opfsRoot = () => navigator.storage.getDirectory();

// Directory handle for path segments under the OPFS root.
export async function dirAt(segs, create = false) {
  let d = await opfsRoot();
  for (const s of segs) d = await d.getDirectoryHandle(s, { create });
  return d;
}

function savesDir(savesPath, create) {
  const segs = normalizePath(savesPath ?? '')?.split('/');
  if (!segs) throw new Error('no saves folder configured');
  return dirAt(segs, create);
}

// Ask the browser not to evict imported files and saves (Safari evicts after 7 days otherwise).
export async function persist() {
  try { return (await navigator.storage.persist?.()) ?? false; } catch { return false; }
}

export async function selfTest() {
  const r = { ok: false, opfs: false, persisted: false, usage: null, quota: null };
  try {
    const est = await navigator.storage.estimate();
    r.usage = est.usage ?? null;
    r.quota = est.quota ?? null;
    r.persisted = (await navigator.storage.persisted?.()) ?? false;
    const root = await opfsRoot();
    const fh = await root.getFileHandle('.pag-selftest', { create: true });
    if (fh.createWritable) {
      const w = await fh.createWritable();
      await w.write('ok');
      await w.close();
      r.opfs = (await (await fh.getFile()).text()) === 'ok';
    } else r.opfs = true; // Safari main thread: handles work, writes need a Worker
    await root.removeEntry('.pag-selftest');
    r.ok = r.opfs;
  } catch (e) { r.error = String(e?.message ?? e); }
  return r;
}

async function* files(dir, prefix = '') {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') yield* files(h, `${prefix}${name}/`);
    else yield [`${prefix}${name}`, h];
  }
}

// Saves = the OPFS saves folder (shell.json data.saves) + this origin's localStorage. Returns a zip Blob.
export async function exportSaves(savesPath) {
  const entries = [];
  try {
    for await (const [rel, h] of files(await savesDir(savesPath))) {
      entries.push({ name: `opfs/${rel}`, data: new Uint8Array(await (await h.getFile()).arrayBuffer()) });
    }
  } catch (e) { if (e?.name !== 'NotFoundError') throw e; }
  try {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) ls[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    entries.push({ name: 'localStorage.json', data: new TextEncoder().encode(JSON.stringify(ls)) });
  } catch { /* storage blocked: OPFS saves only */ }
  return new Blob([createZip(entries)], { type: 'application/zip' });
}

export async function importSaves(blob, savesPath) {
  for (const { name, data } of readStoredZip(new Uint8Array(await blob.arrayBuffer()))) {
    if (name === 'localStorage.json') {
      for (const [k, v] of Object.entries(JSON.parse(new TextDecoder().decode(data)))) localStorage.setItem(k, String(v));
      continue;
    }
    const rel = name.startsWith('opfs/') ? normalizePath(name.slice(5)) : null;
    if (!rel) continue;
    const segs = rel.split('/');
    const file = segs.pop();
    let dir = await savesDir(savesPath, true);
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create: true });
    const w = await (await dir.getFileHandle(file, { create: true })).createWritable();
    await w.write(data);
    await w.close();
  }
}
