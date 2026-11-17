// Driver over the user's Chrome/Edge: one browser-level CDP connection, Target.createTarget + attachToTarget
// {flatten: true}. Trusted input (Input.dispatch*), console + exceptions + Log entries, network from the page and
// from its workers, nested ones included (auto-attached: the BYO import Worker's fixture fetches are only visible that
// way). Popups (window.open) are reported, not followed: their requests are not recorded.
//
// Driver interface (also implemented by driver-playwright.mjs):
//   {open(url), evaluate(fnSource, arg?), screenshot(file), click(x, y), key(code), setViewport(w, h), reload(),
//    onConsole(cb({level, text})), onRequest(cb({url, method, hasBody, crossOrigin})), onResponse(cb({url, status, error?})),
//    onPopup(cb({url})), close()}
// level 'pageerror' = an uncaught exception; status 0 = the request failed without a response.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launchBrowser } from './browser.mjs';
import { Cdp, withTimeout } from './cdp.mjs';
import { isCrossOrigin } from './checks.mjs';

// KeyboardEvent.code -> [key, legacy keyCode, text]: games read e.code, e.key or e.keyCode.
const NAMED = {
  Enter: ['Enter', 13, '\r'], Space: [' ', 32, ' '], Escape: ['Escape', 27], Tab: ['Tab', 9], Backspace: ['Backspace', 8],
  ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
  ShiftLeft: ['Shift', 16], ShiftRight: ['Shift', 16], ControlLeft: ['Control', 17], ControlRight: ['Control', 17],
  AltLeft: ['Alt', 18], AltRight: ['Alt', 18],
};
export function keyInfo(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return { key: m[1].toLowerCase(), keyCode: m[1].charCodeAt(0), text: m[1].toLowerCase() };
  if ((m = /^Digit(\d)$/.exec(code))) return { key: m[1], keyCode: 48 + Number(m[1]), text: m[1] };
  if ((m = /^F([1-9]|1[0-2])$/.exec(code))) return { key: code, keyCode: 111 + Number(m[1]) };
  const [key = code, keyCode = 0, text] = NAMED[code] ?? [];
  return { key, keyCode, text };
}

const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };

export async function openCdp({ path: exe, headless = true, initScript = '' }) {
  const browser = await launchBrowser({ path: exe, headless });
  let cdp;
  try {
    cdp = await Cdp.connect(browser.wsEndpoint);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (method, params) => cdp.send(method, params, sessionId);
    const sessions = new Set([sessionId]);
    const cbs = { console: [], request: [], response: [], popup: [] };
    const emit = (kind, v) => { for (const cb of cbs[kind]) cb(v); };
    const ours = (fn) => (p, sid) => { if (sessions.has(sid)) fn(p, sid); };
    const urls = new Map(); // requestId -> url, for loadingFailed
    let origin = null;

    cdp.on('Runtime.consoleAPICalled', ours((p) => emit('console', { level: p.type, text: p.args.map((a) => a.value ?? a.description ?? a.type).join(' ') })));
    cdp.on('Runtime.exceptionThrown', ours((p) => emit('console', { level: 'pageerror', text: p.exceptionDetails.exception?.description ?? p.exceptionDetails.text })));
    cdp.on('Log.entryAdded', ours((p) => emit('console', { level: p.entry.level, text: `${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ''}` })));
    cdp.on('Network.requestWillBeSent', ours((p) => {
      urls.set(p.requestId, p.request.url);
      emit('request', { url: p.request.url, method: p.request.method, hasBody: !!(p.request.hasPostData || p.request.postData), crossOrigin: isCrossOrigin(p.request.url, origin) });
    }));
    cdp.on('Network.responseReceived', ours((p) => emit('response', { url: p.response.url, status: p.response.status })));
    cdp.on('Network.loadingFailed', ours((p) => { if (!p.canceled) emit('response', { url: urls.get(p.requestId) ?? '', status: 0, error: p.blockedReason ?? p.errorText }); }));
    // Workers start paused until we listen to them, and auto-attach their own workers the same way. ponytail:
    // out-of-process (cross-origin) iframes would attach here too and get no instrument; the shell's CSP
    // (default-src 'self') blocks them, so they are not handled.
    cdp.on('Target.attachedToTarget', ours(async (p) => {
      const child = p.sessionId;
      sessions.add(child);
      const C = (method, params) => cdp.send(method, params, child);
      await Promise.allSettled([C('Network.enable'), C('Runtime.enable'), C('Target.setAutoAttach', AUTO_ATTACH)]);
      C('Runtime.runIfWaitingForDebugger').catch(() => {});
    }));
    // window.open(), target=_blank links and forms open a window: reported, its own requests are not recorded.
    cdp.on('Page.windowOpen', ours((p) => emit('popup', { url: p.url })));
    cdp.on('Target.detachedFromTarget', (p) => { if (p.sessionId !== sessionId) sessions.delete(p.sessionId); });

    await Promise.all([S('Page.enable'), S('Runtime.enable'), S('Log.enable'), S('Network.enable'), S('Emulation.setFocusEmulationEnabled', { enabled: true })]);
    await S('Page.addScriptToEvaluateOnNewDocument', { source: initScript });
    await S('Target.setAutoAttach', AUTO_ATTACH);

    const navigate = async (go) => {
      let off;
      const loaded = new Promise((resolve) => { off = cdp.on('Page.loadEventFired', (_, sid) => { if (sid === sessionId) resolve(); }); });
      try {
        const r = await go();
        if (r?.errorText) throw new Error(`navigation failed: ${r.errorText}`);
        await withTimeout(loaded, 30000, 'the page did not finish loading within 30 s');
      } finally { off(); }
    };

    return {
      async open(url) { origin = new URL(url).origin; await navigate(() => S('Page.navigate', { url })); },
      reload: () => navigate(() => S('Page.reload')),
      async evaluate(fnSource, arg) {
        const r = await S('Runtime.evaluate', { expression: `(${fnSource})(${arg === undefined ? '' : JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      async screenshot(file) {
        // A page that has not painted for ~15 s (a frozen game) made captureScreenshot hang until timeout in headless
        // Edge 157, unless the tab is brought to the front first (activating once at start was not enough).
        await S('Page.bringToFront');
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId, 10000);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, Buffer.from(data, 'base64'));
      },
      async click(x, y) {
        await S('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await S('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await S('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      },
      async key(code) {
        const { key, keyCode, text } = keyInfo(code);
        const k = { code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
        await S('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...k, ...(text ? { text, unmodifiedText: text } : {}) });
        await sleep(100); // held across a few frames, so games that poll key state see it
        await S('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
      },
      setViewport: (width, height) => S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }),
      onConsole: (cb) => cbs.console.push(cb),
      onRequest: (cb) => cbs.request.push(cb),
      onResponse: (cb) => cbs.response.push(cb),
      onPopup: (cb) => cbs.popup.push(cb),
      async close() { cdp.close(); await browser.close(); },
    };
  } catch (e) {
    cdp?.close();
    await browser.close();
    throw e;
  }
}
