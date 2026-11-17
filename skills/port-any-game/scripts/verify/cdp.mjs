// Minimal Chrome DevTools Protocol client over Node 22's global WebSocket: one browser-level connection,
// flattened sessions (commands and events carry sessionId). No dependencies.
export function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })])
    .finally(() => clearTimeout(timer));
}

export class Cdp {
  #ws;
  #id = 0;
  #pending = new Map(); // id -> {resolve, reject, method}
  #handlers = new Map(); // event -> Set<cb(params, sessionId)>

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== undefined) {
        const p = this.#pending.get(m.id);
        this.#pending.delete(m.id);
        if (m.error) p?.reject(new Error(`${p.method}: ${m.error.message}`));
        else p?.resolve(m.result);
        return;
      }
      // A failing listener must not break the client, but it must not vanish either.
      const report = (e) => process.stderr.write(`pag verify: CDP ${m.method} listener failed: ${e?.stack ?? e}\n`);
      for (const cb of this.#handlers.get(m.method) ?? []) {
        try { Promise.resolve(cb(m.params, m.sessionId)).catch(report); } catch (e) { report(e); }
      }
    });
    ws.addEventListener('close', () => {
      for (const p of this.#pending.values()) p.reject(new Error(`${p.method}: CDP connection closed`));
      this.#pending.clear();
    });
  }

  static connect(wsUrl, timeoutMs = 10000) {
    if (typeof WebSocket !== 'function') return Promise.reject(new Error('the CDP runner needs Node 22+ (global WebSocket)'));
    const ws = new WebSocket(wsUrl);
    const opened = new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(new Cdp(ws)), { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${wsUrl}`)), { once: true });
    });
    return withTimeout(opened, timeoutMs, `no DevTools connection to ${wsUrl} within ${timeoutMs / 1000} s`)
      .catch((e) => { ws.close(); throw e; });
  }

  // A browser that hangs (or a page stuck in a loop) must not hang verify: every command times out.
  send(method, params = {}, sessionId, timeoutMs = 30000) {
    if (this.#ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`${method}: CDP connection closed`));
    const id = ++this.#id;
    const reply = new Promise((resolve, reject) => this.#pending.set(id, { resolve, reject, method }));
    this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return withTimeout(reply, timeoutMs, `${method} timed out after ${timeoutMs / 1000} s`).finally(() => this.#pending.delete(id));
  }

  on(event, cb) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(cb);
    return () => this.#handlers.get(event).delete(cb);
  }

  close() {
    try { this.#ws.close(); } catch { /* already closed */ }
  }
}
