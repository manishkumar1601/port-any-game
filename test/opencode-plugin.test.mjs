import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import plugin from '../opencode/plugin/index.js';

const PLUGIN = fileURLToPath(new URL('../opencode/plugin/index.js', import.meta.url));

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

test('opencode plugin fails open when the policy cannot load', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pag-ocplugin-'));
  try {
    // The plugin alone, with no skill two levels up: its relative policy import fails.
    const f = path.join(dir, 'a', 'b', 'index.js');
    mkdirSync(path.dirname(f), { recursive: true });
    copyFileSync(PLUGIN, f);
    writeFileSync(path.join(dir, 'a', 'b', 'package.json'), '{"type":"module"}\n');
    const { default: lone } = await import(pathToFileURL(f).href);
    await (await lone.server({}))['tool.execute.before']({ tool: 'bash' }, { args: { command: 'steamless.exe a' } });
    const { hooks, ctx } = v2();
    await lone.setup(ctx);
    const e = { action: 'shell', resources: ['steamless.exe a'], effect: 'allow' };
    await hooks.evaluate?.(e);
    assert.equal(e.effect, 'allow');
    await plugin.setup({}); // a host without ctx.permission must not break plugin load either
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
