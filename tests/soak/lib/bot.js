'use strict';
// A player socket with just enough bookkeeping for the soak. The bot never decides anything: actors do.
// Listeners registered with on(ev, fn) run synchronously when the event arrives (the model is fed from them).
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ASYNC_ERRS = new Set(['hand_void', 'taken_over']);       // errors that are not an answer to anything we sent

class Bot {
  constructor(ctl, name) {
    this.ctl = ctl; this.name = name; this.key = name.toLowerCase(); this.token = null; this.pin = '1234';
    this.sock = null; this.authed = false; this.gen = 0;
    this.gs = null; this.wallet = null; this.moneyView = null; this.achvList = null; this.bonusStatus = null;
    this.wantTable = null;                  // the table to rejoin after a reconnect
    this.tableId = null;                    // the room this socket is in (table_joined .. table_left)
    this.seatFund = null;                   // fund of the seat at tableId, as requested by us
    this.busted = false; this.errors = []; this.waiters = []; this.listeners = new Map();
    this.spinsInFlight = 0;
  }
  on(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, []); this.listeners.get(ev).push(fn); }
  _fire(ev, d) { for (const fn of this.listeners.get(ev) || []) { try { fn(d, this); } catch (e) { console.error('[soak] listener', ev, e && e.stack || e); } } }

  connect() {
    this.close();
    const sock = this.ctl.connect(); this.sock = sock; this.authed = false; const gen = ++this.gen;
    this.tableId = null; this.seatFund = null;
    const evs = ['auth_ok', 'auth_error', 'game_state', 'your_cards', 'showdown_result', 'bust_out', 'wallet', 'money', 'table_joined', 'table_left', 'table_created',
      'g:bender:result', 'g:bender:state', 'bonus:claimed', 'bonus:status', 'achv:unlocked', 'achv:state', 'admin_result', 'admin_overview', 'table_event', '__audit', 'error',
      'room_update', 'balance_update', 'settle_up', 'table_info', 'lobby_tables', 'ok',
      'g:coldcall:result', 'g:coldcall:state', 'g:coldcall:voided', 'g:coldcall:timer', 'g:coldcall:cfg', 'g:coldcall:history', 'g:coldcall:floor',
      'g:campaign:run', 'g:campaign:step', 'g:campaign:end', 'g:campaign:state'];
    for (const ev of evs) sock.on(ev, d => { if (gen === this.gen) this._recv(ev, d); });
    sock.on('disconnect', () => { if (gen === this.gen) { this.authed = false; this.tableId = null; this.seatFund = null; } });
    return new Promise((res, rej) => {
      if (sock.connected) return res(this);
      const t = setTimeout(() => rej(new Error('connect timeout')), 5000);
      sock.once('connect', () => { clearTimeout(t); res(this); });
      sock.once('connect_error', e => { clearTimeout(t); rej(e); });
    });
  }
  _recv(ev, d) {
    if (ev === 'game_state') this.gs = d;
    else if (ev === 'wallet') this.wallet = d;
    else if (ev === 'money') this.moneyView = d;
    else if (ev === 'achv:state') this.achvList = d;
    else if (ev === 'bonus:status') this.bonusStatus = d;
    else if (ev === 'table_joined') { this.tableId = d.tableId; this.busted = false; }
    else if (ev === 'table_left') { if (this.tableId === d.tableId) { this.tableId = null; this.seatFund = null; } }
    else if (ev === 'bust_out') this.busted = true;
    else if (ev === 'settle_up') { if (d && this.tableId === d.tableId) { this.tableId = null; this.seatFund = null; } }
    else if (ev === 'auth_ok') this.authed = true;
    else if (ev === 'error') this.errors.push({ t: Date.now(), code: d && d.code, message: d && d.message });
    this._fire(ev, d);
    const multi = this.waiters.filter(w => w.multi);
    for (const w of multi) {                       // a collector takes every answer, in order
      if (ev === 'error' && !ASYNC_ERRS.has(d && d.code)) w.done({ error: d });
      else if (w.ok.includes(ev)) w.done({ ev, data: d });
    }
    if (multi.length) return;
    for (const w of [...this.waiters]) {
      if (ev === 'error' && !ASYNC_ERRS.has(d && d.code)) { if (w.errs !== false) w.done({ error: d }); }
      else if (ev === 'auth_error') w.done({ error: d });
      else if (w.ok.includes(ev) && (!w.pred || w.pred(d, ev))) w.done({ ev, data: d });
    }
  }
  // Send `ev`, resolve with { ev, data } on the first matching ok event, { error } on an error event, { timeout: true } otherwise.
  // opts { pred(d, ev), errs: false } (errs:false = ignore error events, wait for ok or timeout)
  req(ev, payload, ok, ms = 4000, opts = {}) {
    return new Promise(res => {
      const w = { ok: Array.isArray(ok) ? ok : [ok], pred: opts.pred, errs: opts.errs, done: r => { clearTimeout(t); this.waiters = this.waiters.filter(x => x !== w); res(r); } };
      const t = setTimeout(() => w.done({ timeout: true }), ms);
      this.waiters.push(w);
      if (!this.sock || !this.sock.connected) return w.done({ error: { code: 'not_connected' } });
      this.sock.emit(ev, payload);
    });
  }
  emit(ev, payload) { if (this.sock && this.sock.connected) this.sock.emit(ev, payload); }
  wait(ok, ms = 3000, pred) {
    return new Promise(res => {
      const w = { ok: Array.isArray(ok) ? ok : [ok], pred, errs: false, done: r => { clearTimeout(t); this.waiters = this.waiters.filter(x => x !== w); res(r); } };
      const t = setTimeout(() => w.done({ timeout: true }), ms);
      this.waiters.push(w);
    });
  }
  // Gathers the next `n` answers (any of `evs`, or a non-async error) after `send()` ran. Resolves early with what it has on timeout.
  collect(evs, n, ms, send) {
    return new Promise(res => {
      const got = [];
      const w = { ok: evs, errs: true, done: r => { got.push(r); if (got.length >= n) finish(); }, multi: true };
      const finish = () => { clearTimeout(t); this.waiters = this.waiters.filter(x => x !== w); res(got); };
      const t = setTimeout(finish, ms);
      this.waiters.push(w);
      send();
    });
  }
  async signup() {
    const r = await this.req('auth_signup', { name: this.name, pin: this.pin, avatar: 'a01' }, 'auth_ok', 6000);
    if (r.data) { this.token = r.data.token; this.key = r.data.account.key; }
    return r;
  }
  async claimAdmin() {
    this.pin = '4321';
    const r = await this.req('auth_claim', { name: this.name, pin: '4321', avatar: 'a01', roomPassword: 'ping' }, 'auth_ok', 6000);
    if (r.data) { this.token = r.data.token; this.key = r.data.account.key; }
    return r;
  }
  async resume() { return this.req('auth_resume', { key: this.key, token: this.token }, 'auth_ok', 6000); }
  close() { this.gen++; this.authed = false; this.tableId = null; this.seatFund = null; for (const w of [...this.waiters]) w.done({ error: { code: 'closed' } }); if (this.sock) { try { this.sock.close(); } catch {} this.sock = null; } }
  connected() { return !!(this.sock && this.sock.connected && this.authed); }
  // on turn according to the last game_state (the server sends legalActions only to the seat on turn)
  legal() { const g = this.gs; return g && g.status === 'playing' && g.legalActions ? g.legalActions : null; }
}
module.exports = { Bot, sleep };
