// Fallback Driver over playwright (toolchain.lock version) imported from the tool cache, never from node_modules:
// `pag setup playwright --yes` installs it with its Chromium. Same interface as driver-cdp.mjs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { cacheDir } from '../lib/fsx.mjs';
import { chromeFlags, playwrightEntry } from './browser.mjs';
import { isCrossOrigin } from './checks.mjs';

export async function openPlaywright({ browser = 'chromium', headless = true, initScript = '' }) {
  const entry = playwrightEntry();
  if (!entry) throw new Error('Playwright is not installed (run: pag setup playwright --yes)');
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(cacheDir(), 'ms-playwright'); // where pag setup put the browsers
  const pw = await import(pathToFileURL(entry).href);
  const b = await pw[browser].launch({ headless, ...(browser === 'chromium' ? { args: chromeFlags() } : {}) });
  try {
    const page = await (await b.newContext()).newPage();
    await page.addInitScript({ content: initScript });
    let origin = null;
    const on = (event, fn) => page.on(event, (x) => { try { fn(x); } catch { /* a listener must not break the run */ } });
    return {
      async open(url) { origin = new URL(url).origin; await page.goto(url, { waitUntil: 'load', timeout: 30000 }); },
      reload: () => page.reload({ waitUntil: 'load', timeout: 30000 }),
      // A string expression, not eval() inside the page: the shell's CSP has no 'unsafe-eval'.
      evaluate: (fnSource, arg) => page.evaluate(`(${fnSource})(${arg === undefined ? '' : JSON.stringify(arg)})`),
      screenshot: (file) => page.screenshot({ path: file }),
      click: (x, y) => page.mouse.click(x, y),
      async key(code) { await page.keyboard.down(code); await sleep(100); await page.keyboard.up(code); },
      setViewport: (width, height) => page.setViewportSize({ width, height }),
      onConsole(cb) {
        on('console', (m) => cb({ level: m.type(), text: m.text() }));
        on('pageerror', (e) => cb({ level: 'pageerror', text: e.stack ?? e.message }));
      },
      onRequest: (cb) => on('request', (r) => cb({ url: r.url(), method: r.method(), hasBody: r.postDataBuffer() !== null, crossOrigin: isCrossOrigin(r.url(), origin) })),
      onResponse(cb) {
        on('response', (r) => cb({ url: r.url(), status: r.status() }));
        on('requestfailed', (r) => { const error = r.failure()?.errorText; if (error !== 'net::ERR_ABORTED') cb({ url: r.url(), status: 0, error }); });
      },
      close: () => b.close(),
    };
  } catch (e) {
    await b.close();
    throw e;
  }
}
