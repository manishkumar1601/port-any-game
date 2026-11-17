// BYO import: the user's own game folder -> OPFS /game/. Files are identified against manifest.files by relative
// path + size, then hashed (same rule as the manifest) and copied one at a time in a Worker: a .part file, verify,
// move into /game/, then a .done marker holding the sha256, so an interrupted import resumes per file. The .part
// and .done files live in their own OPFS tree (importLayout), never beside game files.
// This module is also that Worker (it detects WorkerGlobalScope). No DOM at module top level.
import { fileHasher, fixtureIndexUrl, importLayout, matchManifest, normalizePath } from './pure.js';
import { dirAt } from './storage.js';

const PROGRESS_STEP = 8 * 1024 * 1024;

async function isDone(e) {
  const L = importLayout(e.path);
  try {
    const dir = await dirAt(L.stateDir);
    return (await (await (await dir.getFileHandle(L.done)).getFile()).text()) === e.sha256;
  } catch { return false; }
}

// manifest.files entries not yet in OPFS with a matching .done marker.
export async function missingFiles(manifest) {
  const out = [];
  for (const e of manifest.files) if (!(await isDone(e))) out.push(e);
  return out;
}

// path -> File snapshot for every manifest entry (after a complete import).
export async function opfsFiles(manifest) {
  const map = new Map();
  for (const e of manifest.files) {
    const L = importLayout(e.path);
    map.set(e.path, await (await (await dirAt(L.gameDir)).getFileHandle(L.name)).getFile());
  }
  return map;
}

// Candidate sources -> [{path, size?, file | url}].
// <input webkitdirectory> (or files set by verify over CDP, which may lack webkitRelativePath).
export const fromFileList = (list) => [...list].map((file) => ({ path: file.webkitRelativePath || file.name, size: file.size, file }));

export async function fromDirectoryHandle(dir, prefix = '') {
  const out = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') out.push(...(await fromDirectoryHandle(h, `${prefix}${name}/`)));
    else { const file = await h.getFile(); out.push({ path: prefix + name, size: file.size, file }); }
  }
  return out;
}

// Folder drag-and-drop. Call synchronously from the drop handler: items are only readable before the first await.
export async function fromDataTransfer(dt) {
  const roots = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const out = [];
  const visit = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: prefix + entry.name, size: file.size, file });
      return;
    }
    const reader = entry.createReader();
    for (let batch; (batch = await new Promise((res, rej) => reader.readEntries(res, rej))).length;) {
      for (const child of batch) await visit(child, `${prefix}${entry.name}/`);
    }
  };
  for (const r of roots) await visit(r, '');
  return out;
}

// Test hook ?verify_import=/__fixture/: /__fixture.index.json lists paths (strings or {path, size}) under that url;
// the Worker fetches them.
export async function fromFixture(url) {
  const index = fixtureIndexUrl(url);
  const res = await fetch(index);
  if (!res.ok) throw new Error(`verify_import: ${index}: HTTP ${res.status}`);
  const out = [];
  for (const item of await res.json()) {
    const rel = normalizePath(typeof item === 'string' ? item : item?.path ?? '');
    if (rel) out.push({ path: rel, size: typeof item === 'object' ? item.size : undefined, url: url + rel.split('/').map(encodeURIComponent).join('/') });
  }
  return out;
}

const newWorker = () => new Worker(new URL('./import.js', import.meta.url), { type: 'module' });

// Copies matched files that are not done yet. Resolves {missing, failed, copied, skipped}. Rejects when the Worker
// itself fails (could not load, or crashed), so the shell shows an error instead of waiting forever.
// interruptAfter (test hook): reload after that many copies, only on a run that started with nothing done.
export async function importFiles(manifest, candidates, { onProgress = () => {}, interruptAfter = 0, createWorker = newWorker } = {}) {
  const { matched, missing } = matchManifest(manifest.files, candidates);
  const todo = [];
  let skipped = 0;
  for (const m of matched) if (await isDone(m.entry)) skipped++; else todo.push(m);
  const failed = [];
  let copied = 0;
  if (!todo.length) return { missing, failed, copied, skipped };
  const total = todo.reduce((s, m) => s + m.entry.size, 0);
  let doneBytes = 0;
  let current = null;
  let fatal = null;
  const worker = createWorker();
  worker.onmessage = ({ data }) => {
    if (data.progress !== undefined) onProgress(doneBytes + data.progress, total);
    else if (data.ok) current?.resolve();
    else current?.reject(new Error(data.error));
  };
  worker.onerror = (e) => {
    e?.preventDefault?.();
    fatal = new Error(`the import worker failed${e?.message ? `: ${e.message}` : ' to start'}`);
    current?.reject(fatal);
  };
  const copyOne = (msg) => new Promise((resolve, reject) => {
    if (fatal) return reject(fatal);
    current = { resolve, reject };
    worker.postMessage(msg);
  });
  try {
    for (const { entry, candidate } of todo) {
      try {
        await copyOne({ path: entry.path, size: entry.size, sha256: entry.sha256, src: candidate.file ?? candidate.url });
        copied++;
      } catch (e) {
        if (fatal) throw fatal;
        failed.push({ path: entry.path, error: e.message });
      }
      doneBytes += entry.size;
      onProgress(doneBytes, total);
      if (interruptAfter && copied === interruptAfter && skipped === 0) {
        location.reload();
        return new Promise(() => {}); // the page is going away
      }
    }
  } finally { worker.terminate(); }
  return { missing, failed, copied, skipped };
}

// ---- Worker side ----

async function writeAll(dir, name, blob) {
  const h = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
  try {
    h.truncate(0);
    const reader = blob.stream().getReader();
    for (let r, at = 0; !(r = await reader.read()).done; at += r.value.length) h.write(r.value, { at });
    h.flush();
  } finally { h.close(); }
}

async function copy({ path, size, sha256, src }) {
  const L = importLayout(path);
  const state = await dirAt(L.stateDir, true);
  await state.removeEntry(L.done).catch(() => {});
  const part = await state.getFileHandle(L.part, { create: true });
  const hasher = fileHasher(size);
  const out = await part.createSyncAccessHandle();
  let at = 0;
  try {
    out.truncate(0);
    let body;
    if (typeof src === 'string') {
      const res = await fetch(src); // same-origin GET only (verify_import is validated by parseVerifyParams)
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = res.body ?? new Blob([]).stream();
    } else body = src.stream();
    const reader = body.getReader();
    for (let r, next = PROGRESS_STEP; !(r = await reader.read()).done;) {
      out.write(r.value, { at });
      hasher.update(r.value);
      at += r.value.length;
      if (at >= next) { self.postMessage({ progress: at }); next = at + PROGRESS_STEP; }
    }
    out.flush();
  } finally { out.close(); }
  const got = hasher.digest().sha256;
  if (at !== size || got !== sha256) {
    await state.removeEntry(L.part);
    throw new Error(`${at !== size ? `size ${at}, expected ${size}` : 'content differs'}: a different version of the game?`);
  }
  const game = await dirAt(L.gameDir, true);
  await game.removeEntry(L.name).catch(() => {});
  try { await part.move(game, L.name); } // not every engine moves between OPFS folders: copy, then delete
  catch { await writeAll(game, L.name, await part.getFile()); await state.removeEntry(L.part); }
  await writeAll(state, L.done, new Blob([sha256]));
}

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async ({ data }) => {
    try { await copy(data); self.postMessage({ ok: true }); }
    catch (e) { self.postMessage({ ok: false, error: String(e?.message ?? e) }); }
  };
}
