import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import plugin from '../opencode/plugin/index.js';

const PLUGIN = fileURLToPath(new URL('../opencode/plugin/index.js', import.meta.url));
const SKILL = fileURLToPath(new URL('../skills/port-any-game', import.meta.url));

// Mock v2 ctx: permission.hook records each handler by name (spike c's mock).
function v2() {
  const hooks = {};
  return { hooks, ctx: { directory: process.cwd(), permission: { hook: async (name, fn) => { hooks[name] = fn; } } } };
}

test('opencode v2 hook denies steamless', async () => {
  const { hooks, ctx } = v2();
  await plugin.setup(ctx);
  assert.deepEqual(Object.keys(hooks), ['evaluate']);
  const e = { action: 'shell', resources: ['steamless.exe a'], effect: 'allow' };
  await hooks.evaluate(e);
  assert.equal(e.effect, 'deny');
  assert.match(e.message, /DRM removal/);
  for (const ok of [{ action: 'shell', resources: ['node pag.mjs survey x'] }, { action: 'read', resources: ['steamless.exe'] }]) {
    const ev = { ...ok, effect: 'allow' };
    await hooks.evaluate(ev);
    assert.equal(ev.effect, 'allow', JSON.stringify(ok));
  }
});

test('opencode v1 hook throws on steamless', async () => {
  const before = (await plugin.server({ directory: process.cwd() }))['tool.execute.before'];
  await assert.rejects(before({ tool: 'bash', sessionID: 's', callID: 'c' }, { args: { command: 'steamless.exe a' } }), /DRM removal/);
  await before({ tool: 'bash' }, { args: { command: 'node pag.mjs survey x' } });
  await before({ tool: 'read' }, { args: { filePath: 'steamless.exe' } });
});

// The plugin folder alone (as `opencode plugin add github:…::path:opencode/plugin` may install it), under a temp
// HOME/USERPROFILE/XDG_CONFIG_HOME so the skill lookup never reads the real user's dirs (R5). Returns the loaded plugin.
async function lonePlugin(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-ocplugin-'));
  const home = path.join(dir, 'home');
  const saved = Object.fromEntries(['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME'].map((k) => [k, process.env[k]]));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(dir, 'xdg') });
  try {
    const p = path.join(dir, 'pkg', 'plugin');
    cpSync(path.dirname(PLUGIN), p, { recursive: true }); // no skill two levels up: the relative import fails
    await fn({ home, load: async () => (await import(pathToFileURL(path.join(p, 'index.js')).href)).default });
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('opencode plugin fails open when the policy cannot load', async () => {
  await lonePlugin(async ({ load }) => {
    const lone = await load();
    await (await lone.server({}))['tool.execute.before']({ tool: 'bash' }, { args: { command: 'steamless.exe a' } });
    const { hooks, ctx } = v2();
    await lone.setup(ctx);
    const e = { action: 'shell', resources: ['steamless.exe a'], effect: 'allow' };
    await hooks.evaluate?.(e);
    assert.equal(e.effect, 'allow');
    await plugin.setup({}); // a host without ctx.permission must not break plugin load either
  });
});

test('opencode plugin finds the skill in ~/.agents/skills when it is not next to the plugin (R57)', async () => {
  await lonePlugin(async ({ home, load }) => {
    cpSync(SKILL, path.join(home, '.agents', 'skills', 'port-any-game'), { recursive: true });
    const lone = await load();
    await assert.rejects((await lone.server({}))['tool.execute.before']({ tool: 'bash' }, { args: { command: 'steamless.exe a' } }), /DRM removal/);
    const { hooks, ctx } = v2();
    await lone.setup(ctx);
    const e = { action: 'shell', resources: ['steamless.exe a'], effect: 'allow' };
    hooks.evaluate(e);
    assert.equal(e.effect, 'deny');
  });
});
