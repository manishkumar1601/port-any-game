// Find and launch the user's Chrome/Edge for the CDP runner (spike d), and locate the cached Playwright fallback.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { findBrowsers } from '../doctor.mjs';
import { loadLock, toolDir } from '../setup.mjs';
import { withTimeout } from './cdp.mjs';

// Doctor's discovery, first hit. PAG_BROWSER pins the choice: when it is set but the file does not exist there is no
// browser at all (no silent fallback to some other installed one), which is also how tests force "no browser".
export function findBrowser() {
  const [first] = findBrowsers();
  const pin = process.env.PAG_BROWSER;
  if (pin) return first?.path === pin ? first : null;
  return first ?? null;
}

// <cacheDir>/tools/playwright-<v>/node_modules/playwright/index.mjs once `pag setup playwright --yes` has run, else null.
export function playwrightEntry() {
  const dir = toolDir(loadLock().playwright);
  const entry = path.join(dir, 'node_modules', 'playwright', 'index.mjs');
  return existsSync(path.join(dir, '.ok')) && existsSync(entry) ? entry : null;
}

// Extra Chromium flags for both runners: exact heap numbers for the soak; no OS keychain prompt for a throwaway
// profile (macOS/Linux CI). Linux CI has no GPU: SwiftShader WebGL. --no-sandbox only as root (Chromium refuses to
// start sandboxed as root). PAG_CHROME_FLAGS adds more, split on spaces.
export function chromeFlags() {
  const flags = ['--enable-precise-memory-info', '--use-mock-keychain', '--password-store=basic'];
  if (process.platform === 'linux') {
    flags.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
    if (process.getuid?.() === 0) flags.push('--no-sandbox');
  }
  return [...flags, ...(process.env.PAG_CHROME_FLAGS ?? '').split(' ').filter(Boolean)];
}

// Launch with a fresh profile and --remote-debugging-port=0, then read <profile>/DevToolsActivePort (line 1 port,
// line 2 browser path). close() kills the whole process tree (Windows: taskkill /T /F; POSIX: the process group) and,
// when the profile was ours, removes it, retrying while dying children still hold files (EBUSY/EPERM).
export async function launchBrowser({ path: exe, headless = true, userDataDir }) {
  const profile = userDataDir ?? mkdtempSync(path.join(os.tmpdir(), 'pag-verify-'));
  const args = [
    ...(headless ? ['--headless=new'] : []), '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...chromeFlags(), 'about:blank',
  ];
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: headless, detached: process.platform !== 'win32' });
  let exited = null;
  const gone = new Promise((resolve) => {
    child.once('exit', (code, signal) => { exited = signal ?? code ?? 0; resolve(); });
    child.once('error', (e) => { exited = e.message; resolve(); });
  });
  const waitGone = (ms) => withTimeout(gone, ms, 'still running').catch(() => {});

  const close = async () => {
    if (exited === null && child.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      await waitGone(10000);
    }
    if (!userDataDir) {
      try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
      catch (e) { process.stderr.write(`pag verify: could not remove the temporary browser profile ${profile}: ${e.code ?? e.message}\n`); }
    }
  };

  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (const t0 = Date.now(); ; await sleep(50)) {
      if (exited !== null) throw new Error(`${path.basename(exe)} exited while starting (${exited})`);
      let lines = [];
      try { lines = readFileSync(portFile, 'utf8').split(/\r?\n/); } catch { /* not written yet */ }
      if (lines[1]) return { wsEndpoint: `ws://127.0.0.1:${lines[0]}${lines[1]}`, pid: child.pid, close };
      if (Date.now() - t0 > 30000) throw new Error(`${path.basename(exe)} did not open a DevTools port within 30 s`);
    }
  } catch (e) {
    await close();
    throw e;
  }
}

