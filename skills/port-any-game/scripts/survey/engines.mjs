// Engine/runtime and graphics/audio/input API detection. Knowledge lives in rules/*.json.
import { loadRules, matchStatic } from './rulematch.mjs';

const MAX_MAGIC_FILES = 16;

async function matchMagic(rule, files, readHeadTail) {
  const ev = [];
  for (const m of rule.magic ?? []) {
    const re = new RegExp(m.file, 'i');
    const want = Buffer.from(m.hex, 'hex');
    for (const f of files.filter((x) => re.test(x.rel) && x.size >= want.length && !x.isSymlink && !x.error).slice(0, MAX_MAGIC_FILES)) {
      const { head, tail } = await readHeadTail(f.abs, f.size);
      const hit = m.offset === 'tail' ? tail.includes(want) : m.offset === 'head' ? head.includes(want)
        : head.subarray(m.offset, m.offset + want.length).equals(want);
      if (hit) { ev.push(`magic:${f.rel}`); break; }
    }
  }
  return ev;
}

async function findVersion(rule, files, readHeadTail) {
  if (!rule.version) return null;
  const fre = new RegExp(rule.version.file, 'i'), vre = new RegExp(rule.version.regex);
  for (const f of files.filter((x) => fre.test(x.rel) && x.size > 0 && !x.isSymlink && !x.error).slice(0, 4)) {
    const { head, tail } = await readHeadTail(f.abs, f.size);
    const m = vre.exec(head.toString('latin1')) ?? vre.exec(tail.toString('latin1'));
    if (m) return m[1];
  }
  return null;
}

export async function detectEngines(files, exes, readHeadTail) {
  const out = [];
  let fallback = null;
  for (const r of loadRules('engines')) {
    const evidence = [...matchStatic(r, files, exes), ...(await matchMagic(r, files, readHeadTail))];
    if (!evidence.length) continue;
    const confidence = Math.round(Math.min(0.99, r.confidence + 0.02 * (evidence.length - 1)) * 100) / 100;
    const hit = { id: r.id, family: r.family, version: await findVersion(r, files, readHeadTail), confidence, evidence };
    if (r.fallback) fallback = hit; else out.push(hit);
  }
  if (!out.length && fallback) out.push(fallback);
  return out.sort((a, b) => b.confidence - a.confidence);
}

const VIA_RANK = { import: 0, delay: 1, dynamic: 2 };
const CATEGORIES = ['graphics', 'audio', 'input', 'video', 'network'];
let apiRules;

export function detectApis(exes) {
  apiRules ??= loadRules('apis').map((r) => ({ ...r, re: new RegExp(r.dll, 'i') }));
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, new Map()]));
  for (const e of exes) {
    for (const [list, via] of [[e.imports, 'import'], [e.delayImports, 'delay'], [e.dllStrings, 'dynamic']]) {
      for (const dll of list ?? []) {
        const r = apiRules.find((x) => x.re.test(dll));
        const seen = r && out[r.category].get(r.id);
        if (r && (!seen || VIA_RANK[via] < VIA_RANK[seen])) out[r.category].set(r.id, via);
      }
    }
  }
  return Object.fromEntries(CATEGORIES.map((c) => [c, [...out[c]].map(([id, via]) => ({ id, via }))]));
}
