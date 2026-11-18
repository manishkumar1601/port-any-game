import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { survey } from '../../skills/port-any-game/scripts/survey/survey.mjs';
import { decide } from '../../skills/port-any-game/scripts/survey/verdict.mjs';
import { LANES, rankLanes } from '../../skills/port-any-game/scripts/lanes/index.mjs';
import { makePE, makeMZ } from '../fixtures/make-pe.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-survey-'));
process.env.PAG_CACHE = path.join(base, 'cache'); // never the real home
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
function game(files, name = `g${n++}`) {
  const dir = path.join(base, name);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

test('GO via web-extract for NW.js folder', async () => {
  const s = await survey(game({ 'package.nw': 'PK', 'nw.pak': 'x', 'Game.exe': makePE() }));
  assert.equal(s.schema, 'port-any-game/survey@1');
  assert.equal(s.verdict.overall, 'GO');
  assert.equal(s.verdict.primary_lane, 'web-extract');
  assert.ok(s.verdict.required_acknowledgements.includes('ACK_PRIVATE_USE_ONLY'));
  assert.ok(s.lanes.some((l) => l.lane === 'web-extract' && l.verdict === 'GO'));
});

test('STOP for steamstub with remote-play still listed', async () => {
  const s = await survey(game({ 'game.exe': makePE({ sections: [{ name: '.bind', size: 512 }] }), 'package.nw': 'PK' }));
  assert.equal(s.verdict.overall, 'STOP');
  assert.equal(s.verdict.primary_lane, null);
  assert.ok(s.protection.some((p) => p.id === 'steamstub' && p.severity === 'STOP'));
  for (const l of s.lanes.filter((x) => x.lane !== 'remote-play')) assert.equal(l.verdict, 'NO');
  const rp = s.lanes.find((l) => l.lane === 'remote-play');
  assert.ok(rp && rp.verdict !== 'NO' && rp.available === false && rp.milestone === 'M2');
  const reasons = s.verdict.reasons.join('\n');
  assert.match(reasons, /steamstub/);
  assert.match(reasons, /remote-play/);
  assert.match(reasons, /M2/);
});

test('known-port first on catalog match', async () => {
  // steam appid 517790 = Caesar III in the catalog; also an NW.js marker so web-extract applies at rung 0 too
  const s = await survey(game({ 'steam_appid.txt': '517790', 'package.nw': 'PK', 'game.exe': makePE() }));
  assert.ok(s.catalog_matches.some((m) => m.game_id === 'caesar3'));
  assert.equal(s.lanes[0].lane, 'known-port');
  assert.equal(s.verdict.primary_lane, 'known-port');
  assert.ok(s.verdict.required_acknowledgements.includes('ACK_PRIVATE_USE_ONLY'));
});

test('UPX is WARN and adds ACK', async () => {
  const s = await survey(game({ 'package.nw': 'PK', 'game.exe': makePE({ sections: [{ name: 'UPX0', size: 512 }, { name: 'UPX1', size: 512 }] }) }));
  assert.notEqual(s.verdict.overall, 'STOP');
  assert.ok(s.protection.some((p) => p.id === 'upx' && p.severity === 'WARN'));
  assert.ok(s.verdict.required_acknowledgements.includes('ACK_UPX_PACKED'));
  assert.ok(s.legal_flags.some((f) => /upx/.test(f)));
});

test('primary_lane skips unavailable lanes', () => {
  const unavailable = decide({ engines: [{ id: 'scummvm-candidate', confidence: 0.9 }], executables: [], protection: [], catalog_matches: [] });
  assert.ok(unavailable.lanes.some((l) => l.lane === 'rt-scummvm' && l.available === false));
  assert.equal(unavailable.verdict.primary_lane, null);
  assert.notEqual(unavailable.verdict.overall, 'STOP');
  assert.match(unavailable.verdict.reasons.join('\n'), /rt-scummvm.*available in M2/);

  // an unavailable lane that outranks an available one (GO before HARD) must not become primary
  const both = decide({ engines: [{ id: 'scummvm-candidate', confidence: 0.9 }], executables: [], protection: [], catalog_matches: [{ game_id: 'x', tier: 'title', needs_confirm: true }] });
  assert.equal(both.lanes[0].lane, 'rt-scummvm');
  assert.equal(both.verdict.primary_lane, 'known-port');
  assert.ok(LANES['rt-scummvm'] && LANES['rt-scummvm'].available === false);
  assert.ok(rankLanes({ engines: [{ id: 'flash-swf' }] }).every((l) => l.lane !== 'rt-scummvm'));
});

test('every M1 and M2 lane descriptor has checklist items and acks', () => {
  for (const [id, milestone] of [['web-extract', 'M1'], ['known-port', 'M1'], ['rt-ruffle', 'M1'], ['dos-jsdos', 'M1'], ['rt-easyrpg', 'M2']]) {
    const l = LANES[id];
    assert.equal(l.available, true);
    assert.equal(l.milestone, milestone);
    assert.ok(l.checklist.length >= 3 && l.checklist.every((x) => typeof x === 'string'));
    assert.ok(l.acks.length >= 1);
    assert.equal(typeof l.detect, 'function');
  }
  assert.equal(LANES['remote-play'].milestone, 'M2');
  assert.equal(LANES['remote-play'].available, false);
});

test('dos and flash lanes detect', async () => {
  assert.equal((await survey(game({ 'GAME.EXE': makeMZ(Buffer.alloc(200)) }))).verdict.primary_lane, 'dos-jsdos');
  assert.equal((await survey(game({ 'game.swf': Buffer.from('FWS\x09') }))).verdict.primary_lane, 'rt-ruffle');
});

test('survey output has only relative paths and root_id', async () => {
  const dir = game({ 'sub/package.nw': 'PK', 'sub/Game.exe': makePE(), 'steam_appid.txt': '1' });
  const s = await survey(dir);
  const json = JSON.stringify(s);
  assert.ok(!json.includes(dir));
  assert.ok(!json.includes(JSON.stringify(dir).slice(1, -1)));
  assert.ok(!json.includes(base));
  assert.match(s.target.root_id, /^sha256:[0-9a-f]{64}$/);
  assert.equal(s.target.label, path.basename(dir));
  assert.ok(s.executables.every((e) => !path.isAbsolute(e.path)));
  assert.ok(s.target.largest.every((e) => !path.isAbsolute(e.path)));
});

test('survey handles unicode/space paths', async () => {
  const dir = game({ 'package.nw': 'PK', 'Dätä/Épée Ñ.exe': makePE() }, 'Gamé Ñame (x86)');
  const s = await survey(dir);
  assert.equal(s.target.label, 'Gamé Ñame (x86)');
  assert.equal(s.verdict.primary_lane, 'web-extract');
  assert.ok(s.executables.some((e) => e.path === 'Dätä/Épée Ñ.exe'));
  assert.deepEqual(s.skipped, []);
});

const filesN = (k) => Object.fromEntries(Array.from({ length: k }, (_, i) => [`f${String(i).padStart(3, '0')}.dat`, 'x']));

test('survey skips unreadable and broken entries and caps file count', async (t) => {
  const dir = game(filesN(100));
  const locked = path.join(dir, 'a-locked.dat');
  writeFileSync(locked, 'secret');
  let child;
  try {
    if (process.platform === 'win32') {
      // exclusive lock held by a separate process (no shell), same technique as the walk test
      const quoted = locked.replace(/'/g, "''");
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `$f=[IO.File]::Open('${quoted}','Open','Read','None'); Write-Output ready; Start-Sleep 120`], { stdio: ['ignore', 'pipe', 'ignore'] });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', () => reject(new Error('lock helper exited early')));
        child.stdout.on('data', (d) => d.toString().includes('ready') && resolve());
      });
    } else {
      if (process.getuid?.() === 0) return t.skip('running as root, chmod 000 does not block reads');
      chmodSync(locked, 0o000);
    }
    try { fs.closeSync(fs.openSync(locked, 'r')); return t.skip('this machine cannot make a file unreadable for the current user (an open succeeded despite the lock/chmod)'); } catch { /* unreadable, as the test needs */ }
    const s = await survey(dir, { maxFiles: 50 });
    assert.equal(s.truncated, true);
    assert.ok(s.skipped.some((x) => x.path === 'a-locked.dat'), 'locked file is reported as skipped');
    assert.ok(s.skipped.every((x) => !x.reason.includes(base)));
    // walk counts every non-directory entry toward the cap; survey splits them into readable and skipped
    assert.equal(s.target.file_count + s.skipped.length, 50);
  } finally {
    if (child) {
      const gone = new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
      child.kill();
      await gone;
    } else chmodSync(locked, 0o600);
  }
});

test('survey reports a dangling symlink as skipped and counts it toward the cap', async (t) => {
  const dir = game(filesN(100));
  try { symlinkSync(path.join(dir, 'does-not-exist'), path.join(dir, 'a-dangling')); } catch { return t.skip('symlink creation not permitted on this machine'); }
  const s = await survey(dir, { maxFiles: 50 });
  assert.ok(s.skipped.some((x) => x.path === 'a-dangling' && /symlink/.test(x.reason)));
  assert.equal(s.truncated, true);
  assert.equal(s.target.file_count + s.skipped.length, 50);
});

test('ProductName reaches store.title_guess through survey', async () => {
  const s = await survey(game({ 'Game.exe': makePE({ productName: 'Zork Reborn' }) }));
  assert.equal(s.store.title_guess, 'Zork Reborn');
});

test('title-only catalog hit does not outrank a GO lane', async () => {
  // ProductName "Caesar III" = title-only catalog hit; package.nw makes web-extract a GO lane
  const s = await survey(game({ 'package.nw': 'PK', 'Game.exe': makePE({ productName: 'Caesar III' }) }));
  assert.ok(s.catalog_matches.some((m) => m.game_id === 'caesar3' && m.tier === 'title'));
  assert.equal(s.lanes.find((l) => l.lane === 'known-port').verdict, 'HARD');
  assert.equal(s.verdict.primary_lane, 'web-extract');
  assert.equal(s.verdict.overall, 'GO');
  assert.match(s.verdict.reasons.join('\n'), /Possible existing port: .*confirm the game title/);
});

test('confident catalog match (store/signature) still makes known-port primary', async () => {
  for (const files of [{ 'steam_appid.txt': '517790', 'package.nw': 'PK' }, { 'c3.emp': 'x', 'package.nw': 'PK' }]) {
    const s = await survey(game(files));
    assert.equal(s.verdict.primary_lane, 'known-port');
    assert.equal(s.verdict.overall, 'GO');
  }
});

test('survey rejects a missing directory', async () => {
  await assert.rejects(survey(path.join(base, 'nope')), /not a directory/);
});
