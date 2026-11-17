// launchBrowser cleanup when verify's process ends without close(): exit (all OSes) and SIGTERM (POSIX; Windows
// cannot deliver a catchable signal to another process).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { findBrowser } from '../../skills/port-any-game/scripts/verify/browser.mjs';

const base = mkdtempSync(path.join(tmpdir(), 'pag-verify-browser-'));
after(() => rmSync(base, { recursive: true, force: true }));
const browser = findBrowser();
const skip = browser ? false : 'no Chrome/Edge found (install one or set PAG_BROWSER); browser test skipped';

// The child launches a browser, prints {pid, profile}, then either exits without close() or waits for a signal.
const CHILD = path.join(base, 'child.mjs');
writeFileSync(CHILD, `
import { findBrowser, launchBrowser } from ${JSON.stringify(new URL('../../skills/port-any-game/scripts/verify/browser.mjs', import.meta.url).href)};
const b = await launchBrowser({ path: findBrowser().path, headless: true });
process.stdout.write(JSON.stringify({ pid: b.pid, profile: b.userDataDir }) + '\\n');
if (process.argv[2] === 'exit') process.exit(0);
setInterval(() => {}, 1000);
`);

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function launchInChild(mode) {
  const child = spawn(process.execPath, [CHILD, mode], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve(code ?? signal)));
  let out = '';
  for await (const chunk of child.stdout) { out += chunk; if (out.includes('\n')) break; }
  return { child, exited, ...JSON.parse(out) };
}
// The child exits only after its cleanup ran (taskkill up to 60 s, profile removal up to ~30 s under load), so this
// rarely waits; the bounded poll covers process teardown that finishes after the kill returns.
async function assertCleaned({ pid, profile }) {
  for (const end = Date.now() + 30000; (alive(pid) || existsSync(profile)) && Date.now() < end;) await sleep(100);
  assert.equal(alive(pid), false, `browser ${pid} still running`);
  assert.equal(existsSync(profile), false, `profile ${profile} left behind`);
}

test('browser and profile are cleaned up when the process exits without close()', { skip }, async () => {
  const c = await launchInChild('exit');
  assert.ok(existsSync(c.profile));
  assert.equal(await c.exited, 0);
  await assertCleaned(c);
});

test('browser and profile are cleaned up on SIGTERM (exit 143)', { skip: skip || (process.platform === 'win32' && 'Windows cannot deliver SIGTERM to a handler') }, async () => {
  const c = await launchInChild('wait');
  c.child.kill('SIGTERM');
  assert.equal(await c.exited, 143);
  await assertCleaned(c);
});
