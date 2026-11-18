import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { walk, readHeadTail } from '../../skills/port-any-game/scripts/lib/fsx.mjs';
import { parseExecutable } from '../../skills/port-any-game/scripts/survey/pe.mjs';
import { detectEngines, detectApis } from '../../skills/port-any-game/scripts/survey/engines.mjs';
import { detectProtection } from '../../skills/port-any-game/scripts/survey/protection.mjs';
import { detectIdentity } from '../../skills/port-any-game/scripts/survey/identity.mjs';
import { makePE, makeMZ } from '../fixtures/make-pe.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'pag-rules-'));
process.on('exit', () => rmSync(root, { recursive: true, force: true }));
let n = 0;

// Builds a folder from {relPath: Buffer|string}; returns walk entries and parsed executables.
async function scan(tree) {
  const dir = path.join(root, `t${n++}`);
  for (const [rel, data] of Object.entries(tree)) {
    const abs = path.join(dir, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, data);
  }
  const files = [];
  for await (const f of walk(dir)) files.push(f);
  const exes = [];
  for (const f of files.filter((x) => /\.(exe|dll)$/i.test(x.rel))) {
    const info = await parseExecutable(f.abs, f.size);
    if (info) exes.push(info);
  }
  return { files, exes };
}
const engines = async (tree) => { const { files, exes } = await scan(tree); return detectEngines(files, exes, readHeadTail); };
const ids = (xs) => xs.map((x) => x.id);

test('NW.js folder -> nwjs + rpgmaker-mv', async () => {
  const e = await engines({ 'nw.dll': '', 'www/js/rpg_core.js': 'Utils.RPGMAKER_VERSION = "1.6.2";' });
  assert.ok(ids(e).includes('nwjs'));
  const mv = e.find((x) => x.id === 'rpgmaker-mv');
  assert.ok(mv);
  assert.equal(mv.version, '1.6.2');
});

test('Electron app.asar -> electron', async () => {
  assert.ok(ids(await engines({ 'resources/app.asar': 'x' })).includes('electron'));
});

test('projector overlay -> flash-projector', async () => {
  const swf = Buffer.concat([Buffer.from('FWS\x09'), Buffer.alloc(20)]);
  const trailer = Buffer.alloc(8); trailer.writeUInt32BE(0x563412fa, 0); trailer.writeUInt32LE(swf.length, 4);
  assert.ok(ids(await engines({ 'game.exe': makePE({ overlay: Buffer.concat([swf, trailer]) }) })).includes('flash-projector'));
});

test('MZ-only exe -> dos', async () => {
  const e = await engines({ 'GAME.EXE': makeMZ(Buffer.from('code')) });
  assert.ok(ids(e).includes('dos'));
  assert.ok(!ids(e).includes('native-win32'));
});

test('UnityPlayer.dll + GameAssembly.dll -> unity-il2cpp', async () => {
  const e = await engines({ 'UnityPlayer.dll': '', 'GameAssembly.dll': '' });
  assert.ok(ids(e).includes('unity-il2cpp'));
  assert.ok(!ids(e).includes('unity-mono'));
});

test('.pck with GDPC magic -> godot', async () => {
  assert.ok(ids(await engines({ 'game.pck': Buffer.from('GDPC\x02\0\0\0') })).includes('godot'));
});

test('RPG_RT.ldb -> rpgmaker-2k', async () => {
  assert.ok(ids(await engines({ 'RPG_RT.ldb': '' })).includes('rpgmaker-2k'));
});

test('renpy version from renpy/vc_version.py', async () => {
  const e = await engines({ 'game/scripts.rpa': 'x', 'renpy/vc_version.py': "version_name = '9.9'\nofficial = True\nversion = '8.1.3.23091805'\n" });
  assert.equal(e.find((x) => x.id === 'renpy')?.version, '8.1.3.23091805');
  const bare = await engines({ 'game/script.rpyc': 'x', 'renpy/vc_version.py': 'vc_version = 3191\n' });
  assert.equal(bare.find((x) => x.id === 'renpy')?.version, null, 'a bare build number is no version');
});

test('DOOM.WAD IWAD magic -> idtech-doom', async () => {
  assert.ok(ids(await engines({ 'DOOM.WAD': Buffer.from('IWAD\0\0\0\0') })).includes('idtech-doom'));
  assert.ok(!ids(await engines({ 'x.wad': Buffer.from('WAD3\0\0\0\0') })).includes('idtech-doom'));
});

test('engines sorted by confidence, plain PE falls back to native-win32', async () => {
  const e = await engines({ 'a.exe': makePE({ imports: { 'kernel32.dll': ['Sleep'] } }) });
  assert.deepEqual(ids(e), ['native-win32']);
  const m = await engines({ 'nw.dll': '', 'www/js/rpg_core.js': '' });
  for (let i = 1; i < m.length; i++) assert.ok(m[i - 1].confidence >= m[i].confidence);
});

const prot = async (tree) => { const { files, exes } = await scan(tree); return detectProtection(files, exes); };

test('.bind section -> steamstub STOP', async () => {
  const p = await prot({ 'game.exe': makePE({ sections: [{ name: '.bind', size: 512 }] }) });
  const s = p.find((x) => x.id === 'steamstub');
  assert.equal(s.severity, 'STOP');
  assert.equal(s.class, 'DRM');
});

test('steam_api.dll alone -> steam-api WARN, not STOP', async () => {
  const p = await prot({ 'steam_api.dll': '', 'game.exe': makePE({ imports: { 'steam_api.dll': ['SteamAPI_Init'] } }) });
  assert.equal(p.find((x) => x.id === 'steam-api').severity, 'WARN');
  assert.ok(!p.some((x) => x.severity === 'STOP'));
});

test('UPX0/UPX1 -> upx WARN', async () => {
  const p = await prot({ 'game.exe': makePE({ sections: [{ name: 'UPX0', size: 512 }, { name: 'UPX1', size: 512 }] }) });
  const u = p.find((x) => x.id === 'upx');
  assert.equal(u.severity, 'WARN');
  assert.equal(u.class, 'PACKER');
});

test('.NET exe with 1 import is not packed', async () => {
  const p = await prot({ 'game.exe': makePE({ clr: true, imports: { 'mscoree.dll': ['_CorExeMain'] },
    sections: [{ name: '.text', size: 65536, fill: 'random' }] }) });
  assert.ok(!p.some((x) => x.class === 'PACKER'));
});

test('native exe with high-entropy code and few imports -> packed-generic WARN', async () => {
  const p = await prot({ 'game.exe': makePE({ imports: { 'kernel32.dll': ['Sleep'] },
    sections: [{ name: '.text', size: 65536, fill: 'random' }] }) });
  assert.equal(p.find((x) => x.class === 'PACKER').severity, 'WARN');
});

test('steam_emu.ini -> pirated-steam-emu STOP', async () => {
  const p = await prot({ 'steam_emu.ini': '' });
  assert.equal(p.find((x) => x.id === 'pirated-steam-emu').severity, 'STOP');
  assert.equal((await prot({ 'steam_settings/x.txt': '' })).find((x) => x.id === 'pirated-steam-emu').class, 'PIRATED');
});

test('anti-cheat file markers', async () => {
  const p = await prot({ 'EasyAntiCheat/EasyAntiCheat_Setup.exe': '', 'BattlEye/BEService.exe': '' });
  assert.deepEqual(ids(p).sort(), ['battleye', 'easyanticheat']);
  assert.ok(p.every((x) => x.class === 'ANTI_CHEAT' && x.severity === 'STOP'));
});

test('clean folder has no protection', async () => {
  assert.deepEqual(await prot({ 'readme.txt': 'hi' }), []);
});

const ident = async (tree, withExes = false) => {
  const { files, exes } = await scan(tree);
  return detectIdentity(files, readHeadTail, withExes ? exes : []);
};

test('steam_appid.txt -> steam_appid', async () => {
  assert.equal((await ident({ 'steam_appid.txt': '480\r\n' })).steam_appid, '480');
  assert.equal((await ident({ 'steam_appid.txt': 'not a number' })).steam_appid, null);
});

test('goggame-1207658924.info -> gog_id', async () => {
  const r = await ident({ 'goggame-1207658924.info': JSON.stringify({ gameId: '1207658924', name: 'Some Game' }) });
  assert.equal(r.gog_id, '1207658924');
  assert.equal(r.title_guess, 'Some Game');
});

test('ProductName -> title_guess', async () => {
  const r = await ident({ 'game.exe': makePE({ productName: 'Super Quest' }) }, true);
  assert.equal(r.title_guess, 'Super Quest');
  assert.deepEqual(await ident({ 'readme.txt': '' }), { steam_appid: null, gog_id: null, title_guess: null });
});

test('d3d9 via dllStrings -> graphics d3d9 dynamic', async () => {
  const { exes } = await scan({ 'game.exe': makePE({ imports: { 'kernel32.dll': ['Sleep'] },
    sections: [{ name: '.rdata', size: 256, data: Buffer.from('d3d9.dll\0kernel32.dll\0') }] }) });
  const a = detectApis(exes);
  assert.deepEqual(a.graphics, [{ id: 'd3d9', via: 'dynamic' }]);
  assert.deepEqual(a.audio, []);
});

test('apis by import and delay, versioned DLL names, import wins over delay', () => {
  const exe = { imports: ['D3D8.dll', 'xaudio2_7.dll', 'ws2_32.dll', 'dinput8.dll', 'binkw32.dll'], delayImports: ['d3d8.dll', 'opengl32.dll'], dllStrings: [] };
  const a = detectApis([exe]);
  assert.deepEqual(a.graphics.map((x) => `${x.id}:${x.via}`).sort(), ['d3d8:import', 'opengl:delay']);
  assert.deepEqual(ids(a.audio), ['xaudio2']);
  assert.deepEqual(ids(a.network), ['winsock']);
  assert.deepEqual(ids(a.input), ['dinput8']);
  assert.deepEqual(ids(a.video), ['bink']);
});

test('generic-name markers alone are WARN, not STOP', async () => {
  for (const [file, id] of [['appxmanifest.xml', 'msix-package'], ['sub/AppxManifest.xml', 'msix-package'],
    ['00000001.tmp', 'safedisc-marker'], ['__Installer/installerdata.xml', 'ea-origin-installer'], ['protect.x86', 'starforce-marker']]) {
    const p = await prot({ [file]: '' });
    assert.deepEqual(p.map((x) => [x.id, x.severity]), [[id, 'WARN']], file);
  }
});

test('MicrosoftGame.config is STOP', async () => {
  const p = await prot({ 'MicrosoftGame.config': '' });
  assert.deepEqual(p.map((x) => [x.id, x.class, x.severity]), [['ms-store-gdk', 'LAUNCHER', 'STOP']]);
});

test('distinctive SafeDisc / StarForce / EA Origin evidence stays STOP', async () => {
  assert.equal((await prot({ 'secdrv.sys': '' })).find((x) => x.id === 'safedisc').severity, 'STOP');
  assert.equal((await prot({ 'sfdrv01.sys': '' })).find((x) => x.id === 'starforce').severity, 'STOP');
  assert.equal((await prot({ 'Core/Activation64.dll': '' })).find((x) => x.id === 'ea-origin').severity, 'STOP');
});
