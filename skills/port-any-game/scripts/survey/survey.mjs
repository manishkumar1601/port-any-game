// `pag survey <dir>`: static, bounded, read-only scan. Never executes anything from the game folder.
// Output holds relative paths and a salted root_id only.
import { statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { walk, readHeadTail, sha256File, rootId } from '../lib/fsx.mjs';
import { parseExecutable } from './pe.mjs';
import { detectEngines, detectApis } from './engines.mjs';
import { detectProtection } from './protection.mjs';
import { detectIdentity } from './identity.mjs';
import { loadCatalog, matchCatalog } from '../catalog.mjs';
import { decide } from './verdict.mjs';

const MiB = 1024 * 1024;
const MAX_PARSE = 200; // executables/modules parsed (4 MiB read cap each)
const MAX_EXES_OUT = 100;
const INSTALLER = /(^|[\\/_ .-])(unins\w*|setup\w*|install\w*|redist\w*|vcredist\w*|dxsetup|dotnet\w*|crashhandler|crashpad\w*)\.exe$/i;
const SCRUB = (m) => String(m).split(',')[0].replace(/'.*$/, '').trim(); // fs messages embed absolute paths

export async function survey(gameDir, { maxFiles = 200000 } = {}) {
  const root = path.resolve(gameDir);
  let st;
  try { st = statSync(root); } catch { /* handled below */ }
  if (!st?.isDirectory()) throw new Error('not a directory');

  const files = [], skipped = [];
  let truncated = false, total = 0;
  for await (const f of walk(root, { maxFiles })) {
    if (f.truncated) { truncated = true; break; }
    if (f.error) skipped.push({ path: f.rel, reason: SCRUB(f.error) });
    else if (f.isSymlink) skipped.push({ path: f.rel, reason: 'symlink not followed' });
    files.push(f);
    if (!f.isSymlink) total += f.size;
  }
  const real = files.filter((f) => !f.isSymlink && !f.error);

  // Parse executables first (shallowest first), then DLL modules, up to MAX_PARSE.
  const depth = (f) => f.rel.split('/').length;
  const cand = real.filter((f) => f.size > 0 && /\.(exe|com|dll)$/i.test(f.rel))
    .sort((a, b) => (/\.dll$/i.test(a.rel) - /\.dll$/i.test(b.rel)) || depth(a) - depth(b) || (a.rel < b.rel ? -1 : 1)).slice(0, MAX_PARSE);
  const parsed = [];
  for (const f of cand) {
    try {
      const info = await parseExecutable(f.abs, f.size);
      if (info) parsed.push({ f, info, isDll: /\.dll$/i.test(f.rel) });
    } catch (e) { skipped.push({ path: f.rel, reason: `unparseable: ${SCRUB(e.message)}` }); }
  }
  const infos = parsed.map((p) => p.info);

  // Executables (not modules): main = largest non-installer.
  const exeEntries = parsed.filter((p) => !p.isDll);
  const mainEntry = exeEntries.filter((p) => !INSTALLER.test(p.f.rel)).sort((a, b) => b.f.size - a.f.size)[0];
  const executables = [];
  for (const p of exeEntries.slice(0, MAX_EXES_OUT)) {
    const { f, info } = p;
    const h = await sha256File(f.abs, f.size).catch(() => ({ sha256: null, partial: false }));
    executables.push({
      path: f.rel, role: p === mainEntry ? 'main' : INSTALLER.test(f.rel) ? 'installer' : 'other',
      format: info.format, machine: info.machine, subsystem: info.subsystem, bytes: f.size,
      sha256: h.sha256, ...(h.partial ? { partial: true } : {}),
      clr: info.clr, linker: info.linker ?? null, timestamp: { value: info.timestamp ?? null, trust: 'low' },
      version_info: info.productName ? { ProductName: info.productName } : {},
      overlay: info.overlay ?? null, sections: info.sections.map((s) => ({ name: s.name, entropy: s.entropy })),
      apis: detectApis([info]),
    });
  }

  const engines = await detectEngines(files, infos, readHeadTail);
  const protection = detectProtection(files, infos);
  const identity = await detectIdentity(files, readHeadTail, infos);
  const catalog_matches = matchCatalog(loadCatalog(), { identity, files: real, engines });

  const main = executables.find((e) => e.role === 'main');
  const has = (re) => files.some((f) => re.test(f.rel));
  const builds = [];
  if (infos.some((i) => i.format?.startsWith('PE'))) builds.push('windows');
  if (infos.some((i) => i.format === 'ELF')) builds.push('linux');
  if (infos.some((i) => i.format === 'MachO') || has(/\.app\//i)) builds.push('macos');

  const partial = {
    schema: 'port-any-game/survey@1',
    tool: { name: 'pag', version: '0.1.0', rulesets: [] },
    scanned_at: new Date().toISOString(),
    target: {
      root_id: `sha256:${rootId(root)}`, label: path.basename(root), total_bytes: total, file_count: real.length,
      largest: real.slice().sort((a, b) => b.size - a.size).slice(0, 5).map((f) => ({ path: f.rel, bytes: f.size })),
      builds_present: builds,
    },
    executables, engines,
    store: {
      steam_appid: identity.steam_appid, gog_id: identity.gog_id, title_guess: identity.title_guess,
      steam_api: has(/(^|\/)steam_api(64)?\.dll$/i), epic: has(/(^|\/)\.egstore\//i),
    },
    protection,
    encryption: [], // ponytail: keyed-pack detection arrives with the lanes that need it
    features: {
      bitness: main?.machine === 'i386' ? 32 : main?.machine === 'amd64' || main?.machine === 'arm64' ? 64 : null,
      apis: detectApis(infos),
      size_class: total < 300 * MiB ? 'ok' : total < 2048 * MiB ? 'streaming' : 'hard',
    },
    era: { timestamp: main?.timestamp.value ?? null, linker: main?.linker ?? null, trust: 'low' },
    catalog_matches, skipped, truncated,
  };
  const d = decide(partial);
  return { ...partial, legal_flags: d.legal_flags, lanes: d.lanes, verdict: d.verdict };
}

function human(s) {
  const v = s.verdict, p = s.lanes.find((l) => l.lane === v.primary_lane);
  const main = s.executables.find((e) => e.role === 'main');
  const head = [
    `Verdict: ${v.overall}${p ? ` | lane: ${p.lane}${p.odds ? ` (odds ${p.odds})` : ''}` : ' | lane: none available yet'}`,
    `Game: ${s.store.title_guess ?? s.target.label} | engine: ${s.engines[0]?.id ?? 'unknown'} | exe: ${main ? `${main.format} ${main.machine ?? ''}`.trim() : 'none'} | ${s.target.file_count} files`,
  ];
  const tail = [`Catalog: ${s.catalog_matches.length ? s.catalog_matches.slice(0, 3).map((m) => `${m.game_id} (${m.tier})`).join(', ') : 'no match'}`];
  const warn = [...s.protection.filter((x) => x.severity === 'WARN').map((x) => x.id), ...(s.skipped.length ? [`${s.skipped.length} entries skipped`] : []), ...(s.truncated ? ['file cap reached'] : [])];
  if (warn.length) tail.push(`Warnings: ${warn.join(', ')}`);
  if (v.required_acknowledgements.length) tail.push(`Acknowledgements: ${v.required_acknowledgements.join(', ')}`);
  // reasons fill the remaining lines, most important first; on STOP the remote-play line (last) always survives
  const slots = 8 - head.length - tail.length;
  const r = v.reasons.length <= slots ? v.reasons : v.overall === 'STOP' ? [...v.reasons.slice(0, slots - 1), v.reasons.at(-1)] : v.reasons.slice(0, slots);
  return [...head, ...r.map((x, i) => (i ? `  ${x}` : `Why: ${x}`)), ...tail].join('\n');
}

// CLI entry (loaded lazily by pag.mjs). Returns the exit code: 0 GO/HARD, 4 STOP, 2 usage error.
export async function run(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }) {
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { json: { type: 'boolean' }, out: { type: 'string' } } });
  } catch (e) { io.err(`pag survey: ${e.message}\nusage: pag survey <dir> [--json] [--out <file>]\n`); return 2; }
  if (args.positionals.length !== 1) { io.err('usage: pag survey <dir> [--json] [--out <file>]\n'); return 2; }
  let s;
  try { s = await survey(args.positionals[0]); } catch (e) { io.err(`pag survey: ${e.message}\n`); return 2; }
  const json = JSON.stringify(s, null, 2);
  if (args.values.out) {
    try { writeFileSync(args.values.out, json + '\n'); } catch (e) { io.err(`pag survey: cannot write --out file (${SCRUB(e.message)})\n`); return 2; }
  }
  io.out((args.values.json ? json : human(s)) + '\n');
  return s.verdict.overall === 'STOP' ? 4 : 0;
}
