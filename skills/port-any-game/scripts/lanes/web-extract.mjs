// Rung 0: the game already is a web app in a native wrapper (or HTML5 engine export).
// build() extracts it to <port>/build/game/ (R35), scans for Node/Steam API use and counts case-mismatched references.
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractAsar, extractZip } from '../lib/archive.mjs';

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
  const exe = (survey.executables ?? []).find((e) => e.overlay?.magic === 'zip' && isFile(path.join(game, e.path)));
  if (exe) return void (await extractZip(path.join(game, exe.path), out));
  const asar = path.join(game, 'resources', 'app.asar');
  if (isFile(asar)) return void (await extractAsar(asar, out));
  if (isDir(path.join(game, 'resources', 'app'))) return cpSync(path.join(game, 'resources', 'app'), out, { recursive: true });
  if (isDir(path.join(game, 'www'))) return cpSync(path.join(game, 'www'), out, { recursive: true });
  throw new Error('no web content found: expected package.nw, a zip appended to the exe, resources/app.asar, resources/app/ or www/');
}

// package.json main when it is an html file, else index.html. Normalised so build/game/index.html is the entry.
function normaliseEntry(out) {
  let main;
  try { main = JSON.parse(readFileSync(path.join(out, 'package.json'), 'utf8').replace(/^﻿/, '')).main; } catch { /* none */ }
  if (typeof main === 'string') {
    main = path.posix.normalize(main.replace(/^file:\/+/, '').replace(/[?#].*$/, '').replace(/\\/g, '/'));
    if (!/\.html?$/i.test(main) || main.startsWith('..') || !isFile(path.join(out, main))) main = undefined;
  }
  if (main && main !== 'index.html' && !isFile(path.join(out, 'index.html'))) {
    // ponytail: when both exist index.html wins over package.json main; a meta refresh keeps relative urls working.
    writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${encodeURI(main)}">\n`);
  } else if (!isFile(path.join(out, 'index.html'))) {
    throw new Error('no entry HTML found: package.json main is not an html file and there is no index.html');
  }
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
  id: 'web-extract', rung: 0, available: true, milestone: 'M1', dataModes: ['bundled'],
  acks: ['ACK_PRIVATE_USE_ONLY'], odds: '85-95%',
  checklist: ['Extract package.nw / app.asar / www into build/game', 'Find the entry HTML', 'Map path case', 'Scan for Node and Steamworks API use', 'Serve and verify the first frame'],
  // The survey cannot say whether an entry HTML exists (it lists no archive contents), so an engine hit is GO and build() fails clearly without an entry.
  detect(s) {
    const hit = (s.engines ?? []).find((e) => ENGINES.includes(e.id));
    return hit ? { verdict: 'GO', why: `already web content (${hit.id})` } : { verdict: 'NO', why: 'no web wrapper or HTML5 engine found' };
  },
  async build(portDir) {
    const dir = path.resolve(portDir);
    const out = path.join(dir, 'build', 'game');
    rmSync(out, { recursive: true, force: true, maxRetries: 2 });
    mkdirSync(out, { recursive: true });
    await extract(dir, path.join(dir, 'game'), out);
    normaliseEntry(out);
    const files = listFiles(out);
    const nodeApiUses = scanApis(out, files);
    const caseFixes = countCaseFixes(out, files);
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
    verify: { target_fps: 30, inputs: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], audio_on_title: false, budget_ready_s: 30 },
  }),
};
