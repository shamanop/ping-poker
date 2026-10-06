// Minimal Chrome DevTools Protocol client (Node 22+ global WebSocket, no dependencies). Runs on shaman.
export class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.cb = new Map(); this.on = new Map(); this.sessions = new Set();
    ws.addEventListener('close', () => { for (const c of this.cb.values()) c.rej(new Error('websocket closed (' + c.method + ')')); this.cb.clear(); });
    ws.addEventListener('message', (m) => { const d = JSON.parse(m.data);
      if (d.id) { const c = this.cb.get(d.id); if (c) { this.cb.delete(d.id); d.error ? c.rej(new Error(d.error.message + ' (' + c.method + ')')) : c.res(d.result); } }
      else if (d.method) { const k = (d.sessionId || '') + '|' + d.method; (this.on.get(k) || []).forEach((f) => f(d.params)); (this.on.get('*|' + d.method) || []).forEach((f) => f(d.params, d.sessionId)); } }); }
  static async connect(url) { const ws = new WebSocket(url); await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('ws error ' + url))); }); return new CDP(ws); }
  send(method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.cb.set(id, { res, rej, method }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  listen(method, f, sessionId = '') { const k = sessionId + '|' + method; this.on.set(k, [...(this.on.get(k) || []), f]); return () => this.on.set(k, (this.on.get(k) || []).filter((x) => x !== f)); }
  close() { try { this.ws.close(); } catch {} }
}
// a page session on a browser-level connection
export class Page {
  constructor(cdp, sessionId, targetId) { this.c = cdp; this.sid = sessionId; this.targetId = targetId; }
  send(m, p) { return this.c.send(m, p, this.sid); }
  on(m, f) { return this.c.listen(m, f, this.sid); }
  async eval(expr, { awaitPromise = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
}
export async function newPage(cdp, url = 'about:blank') {
  const { targetId } = await cdp.send('Target.createTarget', { url });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  return new Page(cdp, sessionId, targetId);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
