// Rung 0: the game already is a web app in a native wrapper (or HTML5 engine export).
// build() extracts it to <port>/build/game/ (R35), scans for Node/Steam API use and counts case-mismatched references.
import { appendFileSync, copyFileSync, cpSync, renameSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAsar, extractZip } from '../lib/archive.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'lanes', 'web-extract', 'frame-hook.js');
const ENGINES = ['nwjs', 'electron', 'rpgmaker-mv', 'rpgmaker-mz', 'construct', 'gdevelop', 'twine'];

const API_RES = [['require', /\brequire\(/g], ['process', /\bprocess\./g], ['nw', /\bnw\./g], ['greenworks', /\bgreenworks/g]];
const GUARD_LINES = 3; // ponytail: a use is "guarded" when Utils.isNwjs() is within 3 lines above; no scope analysis (a long guarded block slips through as HARD, a stray guard above hides a use). Upgrade to a real parse when a game needs it.
const REF_RE = /["'(]([^"'()\s]+\.(?:png|jpe?g|gif|webp|svg|ogg|mp3|m4a|wav|js|css|json|html?|ttf|otf|woff2?|mp4|webm))["')]/gi;

const isDir = (p) => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true;
const isFile = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() === true;

function listFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/'));
}

// Extraction order: package.nw, zip appended to an exe, resources/app.asar | resources/app/, www/.
async function extract(portDir, game, out) {
  const nw = path.join(game, 'package.nw');
  if (isDir(nw)) return cpSync(nw, out, { recursive: true });
  if (isFile(nw)) return void (await extractZip(nw, out));
  let survey = {};
  try { survey = JSON.parse(readFileSync(path.join(portDir, 'survey.json'), 'utf8')); } catch { /* no survey: skip this source */ }
  const exe = (survey.executables ?? []).filter((e) => e.overlay?.magic === 'zip' && isFile(path.join(game, e.path))).sort((a, b) => (b.role === 'main') - (a.role === 'main'))[0];
  if (exe) return void (await extractZip(path.join(game, exe.path), out));
  const asar = path.join(game, 'resources', 'app.asar');
  if (isFile(asar)) return void (await extractAsar(asar, out));
  if (isDir(path.join(game, 'resources', 'app'))) return cpSync(path.join(game, 'resources', 'app'), out, { recursive: true });
  if (isDir(path.join(game, 'www'))) return cpSync(path.join(game, 'www'), out, { recursive: true });
  throw new Error('no web content found: expected package.nw, a zip appended to the exe, resources/app.asar, resources/app/ or www/');
}

// package.json main (an html file inside the folder) wins, else index.html. build/game/index.html is the entry the adapter
// loads; when main is another file, index.html becomes a meta-refresh to it (an existing index.html is kept as __pag_index_orig.html).
// Returns the real entry path. The frame hook goes in first in its <head> (R39).
function normaliseEntry(out) {
  let main;
  try { main = JSON.parse(readFileSync(path.join(out, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).main; } catch { /* none */ }
  if (typeof main === 'string') {
    main = main.replace(/^file:\/+/, '').replace(/[?#].*$/, '').replace(/\\/g, '/');
    const n = path.posix.normalize(main);
    main = /\.html?$/i.test(n) && !main.startsWith('/') && !path.win32.isAbsolute(main) && !n.startsWith('..') && isFile(path.join(out, n)) ? n : undefined;
  } else main = undefined;
  let entry = 'index.html';
  if (main && main !== 'index.html') {
    if (isFile(path.join(out, 'index.html'))) renameSync(path.join(out, 'index.html'), path.join(out, '__pag_index_orig.html'));
    writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${encodeURI(main)}">\n`);
    entry = main;
  } else if (!isFile(path.join(out, 'index.html'))) {
    throw new Error('no entry HTML found: package.json main is not an html file inside the game and there is no index.html');
  }
  return entry;
}

// Inserts <script src="__pag_hook.js"> as the first child of <head> (creating the position after <html> or the doctype when absent,
// else after a byte-order mark). T16: a Buffer gets the ASCII tag spliced into its own bytes, so a Latin-1 or Shift-JIS page
// is never re-encoded (latin1 decoding is one char per byte, so match offsets are byte offsets).
export function injectHook(html, src) {
  const tag = `<script src="${src}"></script>`;
  const bytes = Buffer.isBuffer(html);
  const text = bytes ? html.toString('latin1') : html;
  let at = /^(﻿|\xEF\xBB\xBF)/.exec(text)?.[0].length ?? 0;
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(text);
    if (m) { at = m.index + m[0].length; break; }
  }
  return bytes ? Buffer.concat([html.subarray(0, at), Buffer.from(tag), html.subarray(at)]) : text.slice(0, at) + tag + text.slice(at);
}

// Shared by web lanes: normalises the entry, injects the frame hook, then swaps tmp in as out (out is untouched when tmp has no entry).
export function finishWebBuild(tmp, out) {
  const entry = normaliseEntry(tmp);
  const hookSrc = path.posix.relative(path.posix.dirname(entry), '__pag_hook.js');
  copyFileSync(HOOK, path.join(tmp, '__pag_hook.js'));
  const ep = path.join(tmp, ...entry.split('/'));
  writeFileSync(ep, injectHook(readFileSync(ep), hookSrc)); // T16: bytes in, bytes out
  rmSync(out, { recursive: true, force: true, maxRetries: 2 });
  renameSync(tmp, out);
  return { entry };
}

function scanApis(out, files) {
  const uses = [];
  for (const f of files.filter((n) => /\.js$/i.test(n) && !/(^|\/)node_modules\//.test(n))) {
    const lines = readFileSync(path.join(out, f), 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      for (const [api, re] of API_RES) {
        re.lastIndex = 0;
        if (!re.test(text)) continue;
        const from = Math.max(0, i - GUARD_LINES);
        if (lines.slice(from, i + 1).some((l) => l.includes('Utils.isNwjs()'))) continue;
        uses.push({ file: f, line: i + 1, api });
      }
    });
  }
  return uses;
}

// Counts references (html/js/css) whose case differs from the file on disk. Report only: files stay unchanged.
function countCaseFixes(out, files) {
  const exact = new Set(files);
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  let n = 0;
  for (const f of files.filter((x) => /\.(html?|js|css)$/i.test(x))) {
    const text = readFileSync(path.join(out, f), 'utf8');
    for (const m of text.matchAll(REF_RE)) {
      const ref = m[1].replace(/[?#].*$/, '');
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref)) continue;
      const bases = [path.posix.dirname(f), '']; // relative to the file, or to the game root (js usually loads relative to the page)
      const cands = bases.map((b) => path.posix.normalize(path.posix.join(b, ref.replace(/^\//, ''))));
      if (cands.some((c) => exact.has(c))) continue;
      if (cands.some((c) => lower.has(c.toLowerCase()))) n++;
    }
  }
  return n;
}

export default {
  id: 'web-extract', rung: 0, available: true, milestone: 'M1', dataModes: ['bundled'], requiresBuild: true, // M4
  acks: ['ACK_PRIVATE_USE_ONLY'], odds: '85-95%',
  checklist: ['Extract package.nw / app.asar / www into build/game', 'Find the entry HTML', 'Map path case', 'Scan for Node and Steamworks API use', 'Serve and verify the first frame'],
  // R38: the survey carries no full file list, so an engine hit is GO; build() validates the entry and fails clearly without one.
  detect(s) {
    const hit = (s.engines ?? []).find((e) => ENGINES.includes(e.id));
    return hit ? { verdict: 'GO', why: `already web content (${hit.id})` } : { verdict: 'NO', why: 'no web wrapper or HTML5 engine found' };
  },
  async build(portDir) {
    const dir = path.resolve(portDir);
    const out = path.join(dir, 'build', 'game');
    const tmp = path.join(dir, 'build', `.tmp-${process.pid}`);
    rmSync(out, { recursive: true, force: true, maxRetries: 2 }); // R35; a failed build then leaves no half-built game for pack (R27)
    rmSync(tmp, { recursive: true, force: true, maxRetries: 2 });
    mkdirSync(tmp, { recursive: true });
    let files, nodeApiUses, caseFixes;
    try {
      await extract(dir, path.join(dir, 'game'), tmp);
      finishWebBuild(tmp, out);
      files = listFiles(out);
      nodeApiUses = scanApis(out, files);
      caseFixes = countCaseFixes(out, files);
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 2 });
      rmSync(out, { recursive: true, force: true, maxRetries: 2 });
      throw e;
    }
    const verdict = nodeApiUses.length ? 'HARD' : 'GO';
    const log = path.join(dir, 'PORTING_LOG.md');
    const section = [
      '', `## web-extract build (${new Date().toISOString().slice(0, 10)})`, '',
      `- Entry: game/index.html; ${files.length} files; verdict ${verdict}`,
      `- Mixed-case references: ${caseFixes} (served with caseFallback; files unchanged)`,
      nodeApiUses.length ? `- Node/Steam API uses (${nodeApiUses.length}), shims come in a later plan:` : '- Node/Steam API uses: none',
      ...nodeApiUses.map((u) => `  - ${u.file}:${u.line} ${u.api}`), '',
    ].join('\n');
    if (existsSync(log)) appendFileSync(log, section); else writeFileSync(log, section.trimStart());
    return { entryHtml: 'game/index.html', nodeApiUses, caseFixes, verdict };
  },
  shell: () => ({
    serve: { caseFallback: true },
    // R61: RPG Maker MV/MZ (damage formulas, PixiJS shaders), Twine (inline story engine) and many plugins need these.
    // The build is the user's own game code; verify reports the relaxation.
    csp: { 'script-src': ["'unsafe-eval'", "'unsafe-inline'"] },
    verify: { target_fps: 30, inputs: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], audio_on_title: false, budget_ready_s: 30 },
  }),
};
