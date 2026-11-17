// Shared, data-driven rule matching for engines.json / protection.json. Pure: no file reads here.
import { readFileSync } from 'node:fs';

const cache = new Map();
export function loadRules(name) {
  if (!cache.has(name)) {
    const raw = JSON.parse(readFileSync(new URL(`../rules/${name}.json`, import.meta.url), 'utf8'));
    cache.set(name, raw.map((r) => ({ ...r, _files: (r.files ?? []).map((x) => new RegExp(x, 'i')), _absent: (r.absent ?? []).map((x) => new RegExp(x, 'i')) })));
  }
  return cache.get(name);
}

const MAX_EVIDENCE = 3;
const lc = (a) => a.map((x) => x.toLowerCase());

// Evidence for the file/section/import/overlay/format signals of one rule. [] = no match.
export function matchStatic(rule, files, exes) {
  if (rule._absent.some((re) => files.some((f) => re.test(f.rel)))) return [];
  const ev = [];
  const add = (xs, prefix) => xs.slice(0, MAX_EVIDENCE).forEach((x) => ev.push(`${prefix}:${x}`));
  if (rule._files.length) add(files.filter((f) => rule._files.some((re) => re.test(f.rel))).map((f) => f.rel), 'file');
  if (rule.sections) {
    const want = new Set(lc(rule.sections));
    add([...new Set(exes.flatMap((e) => e.sections.map((s) => s.name)).filter((n) => want.has(n.toLowerCase())))], 'section');
  }
  if (rule.imports) {
    const want = new Set(lc(rule.imports));
    add([...new Set(exes.flatMap((e) => [...e.imports, ...e.delayImports]).filter((d) => want.has(d.toLowerCase())))], 'import');
  }
  if (rule.overlay && exes.some((e) => e.overlay?.magic === rule.overlay)) ev.push(`overlay:${rule.overlay}`);
  if (rule.formats && exes.some((e) => rule.formats.includes(e.format) && !e.clr)) ev.push(`format:${rule.formats.join('/')}`);
  return ev;
}
