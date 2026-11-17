// DRM / protector / packer / anti-cheat detection. STOP rules must stay precise: a false STOP blocks a legitimate game.
import { loadRules, matchStatic } from './rulematch.mjs';

// Generic packed heuristic (WARN only): high-entropy code section, almost no imports, never for CLR images.
const PACKED_ENTROPY = 7.3, PACKED_MAX_IMPORTS = 3;

function packedGeneric(exes) {
  const ev = [];
  for (const e of exes) {
    if (e.clr || !e.format?.startsWith('PE')) continue;
    if (e.imports.length + e.delayImports.length > PACKED_MAX_IMPORTS) continue;
    const hot = e.sections.find((s, i) => (i === 0 || /^(\.text|code)$/i.test(s.name)) && s.rawSize >= 4096 && s.entropy > PACKED_ENTROPY);
    if (hot) ev.push(`entropy:${hot.name}=${hot.entropy.toFixed(2)}`);
  }
  return ev;
}

export function detectProtection(files, exes) {
  const out = [];
  for (const r of loadRules('protection')) {
    const evidence = matchStatic(r, files, exes);
    if (evidence.length) out.push({ id: r.id, class: r.class, severity: r.severity, evidence });
  }
  const ev = packedGeneric(exes);
  if (ev.length && !out.some((x) => x.class === 'PACKER')) out.push({ id: 'packed-generic', class: 'PACKER', severity: 'WARN', evidence: ev.slice(0, 3) });
  return out;
}
