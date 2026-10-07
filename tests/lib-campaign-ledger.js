'use strict';
// A ledger-backed world for the CAMPAIGN TRAIL server tests (the idea of tests/lib-coldcall-ledger.js). Everything is real except the socket layer: money/ledger.js on a temp file, money/service.js,
// transport/game-money.js (ctx.money), the games registry (games/index.js, which calls recover() at boot exactly as server.js does) and games/campaign.js. No wallet.js anywhere.
//
//   const w = H.world({ rng, keys, dir, t });      // boots: ledger -> service -> registry -> recover()
//   w.fund('ann', 'play', 1e10)                    // through the service (an admin:adjust line), either currency
//   w.bal('ann', 'chips'), w.escrows(), w.house('chips'), w.lines(fn), w.has(ref), w.conservation('play')   // read from the LEDGER
//   w.reboot()                                     // "crash and reboot": the old instance is abandoned (nothing unwritten is flushed), a new ledger / service / registry opens the same files, recover() runs
//   w.hooks.before.settle = (args) => { throw new Crash() }   // inject a failure before / after any ctx.money call (open, settle, void, round); w.hooks.after.settle = (args, result) => ...
//   w.sock('ann'), H.last(sock, ev), H.all(sock, ev)
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createGameMoney } = require('../transport/game-money');
const games = require('../games');
const SRV = require('../games/campaign.js');
const E = require('../games/campaign-engine.js');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-ledger-'));
let counter = 0;
let current = null;           // games/campaign.js is one module per process, so there is one live world: a new world first "crashes" the old one

const last = (s, ev) => { for (let i = s.out.length - 1; i >= 0; i--) if (s.out[i][0] === ev) return s.out[i][1]; return null; };
const all = (s, ev) => s.out.filter((o) => o[0] === ev).map((o) => o[1]);

class Crash extends Error { constructor(m) { super(m || 'simulated crash'); this.name = 'Crash'; } }

const CALLS = ['round', 'open', 'settle', 'void'];
const curOf = (c) => (c === 'chips' ? 'chips' : 'play');
const acct = (key, cur) => (cur === 'chips' ? 'bank:' : 'play:') + String(key).toLowerCase().trim();

function world(opts = {}) {
  const dir = opts.dir || fs.mkdtempSync(path.join(base, 'w'));
  if (current) { try { current.crash(); } catch {} }
  const files = { money: path.join(dir, 'money.jsonl'), store: path.join(dir, 'campaign.json') };
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  let t = opts.t || 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
  const hooks = { before: {}, after: {}, calls: [] };       // calls: every ctx.money write call, [name, key, cur, roundId, outcome] in order
  const w = { dir, files, io, clock, hooks, SRV, E, keys: new Set((opts.keys || []).map((k) => String(k).toLowerCase())), boots: 0, funded: { chips: 0, play: 0 }, report: null };

  function boot() {
    w.boots++;
    SRV.log = opts.log || (() => {});
    const ledger = w.ledger = open(files.money, { fsync: 'none', log: () => {} });
    const service = w.service = createService(ledger);
    for (const k of w.keys) service.ensureAccount(k);
    let reg = null;
    const onChange = (k) => { if (reg) reg.pushWallet(k); };
    const real = createGameMoney({ service, ledger, onChange, log: () => {} });
    // the bound money object, wrapped so a test can fail a call before or after it ran and see every write call in order
    const gm = {
      forGame: (game) => {
        const m = real.forGame(game), out = { ...m };
        for (const name of CALLS) {
          out[name] = (...args) => {
            const rec = [name, args[0], args[1], args[2], args[3]];
            if (hooks.before[name]) hooks.before[name](args);
            const res = m[name](...args);
            hooks.calls.push(rec);
            if (hooks.after[name]) hooks.after[name](args, res);
            return res;
          };
        }
        return out;
      },
    };
    w.money = real.forGame('campaign');                // the bound ctx.money as a module sees it, without the call log or the hooks
    io.removeAllListeners('connection');
    reg = w.g = games({ io, wallet: undefined, money: gm, service, modules: [SRV], accounts: {}, tables: {}, rooms: {}, now: clock.now, rng: opts.rng, files: { campaign: files.store }, ledger: { log: () => {} } });
    w.report = reg.recover();
    return w.report;
  }

  w.addKey = (k) => { k = String(k).toLowerCase().trim(); w.keys.add(k); if (w.service) w.service.ensureAccount(k); };
  w.sock = (a) => {
    const acctObj = typeof a === 'string' ? { key: a } : a;
    if (acctObj && acctObj.key) w.addKey(acctObj.key);
    const s = new EventEmitter();
    s.data = a ? { acct: acctObj } : {};
    s.out = [];
    const emit = s.emit.bind(s);
    s.send = (ev, p) => emit(ev, p);             // client -> server
    s.emit = (ev, p) => { if (ev in { error: 1, wallet: 1 } || ev.startsWith('g:') || ev.startsWith('floor:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
    io.sockets.sockets.set(String(Math.random()), s);
    io.emit('connection', s);
    return s;
  };
  w.send = (s, ev, p) => s.send(ev, p);

  // ---- funding: through the service, either currency ----
  w.fund = (key, cur, amount) => {
    key = String(key).toLowerCase().trim(); curOf(cur);
    w.addKey(key);
    const r = w.service.adminAdjust(key, amount, curOf(cur), 'test-fund', `test:fund:${w.boots}:${++counter}`);
    if (amount > 0) w.funded[curOf(cur)] += amount;
    return r;
  };
  w.rich = (key, cur = 'play') => w.fund(key, cur, 1e10);
  w.setBal = (key, cur, v) => { const d = v - w.bal(key, cur); if (d) w.fund(key, cur, d); return v; };

  // ---- reads, all from the ledger ----
  w.bal = (key, cur) => w.ledger.balance(acct(key, curOf(cur)), curOf(cur));
  w.balances = (key) => ({ play: w.bal(key, 'play'), chips: w.bal(key, 'chips') });
  w.escrows = (cur) => { const out = []; for (const c of cur ? [cur] : ['chips', 'play']) for (const x of w.ledger.list('escrow:campaign:', c)) if (x.balance !== 0) out.push({ ...x, cur: c }); return out; };
  w.escrowSum = (cur) => w.escrows(cur).reduce((n, x) => n + x.balance, 0);
  w.house = (cur) => w.ledger.balance('house:campaign', curOf(cur));
  w.has = (ref) => w.ledger.has(ref);
  w.lines = (fn) => [...w.ledger.entries(fn || null)];
  w.lastId = () => w.ledger.lastId;
  w.since = (id) => [...w.ledger.entries(null, id)];
  w.campaignLines = () => w.lines((l) => /^campaign:/.test(String(l.ref || '')));
  w.conservation = (cur) => {
    cur = curOf(cur);
    const sum = (prefix) => w.ledger.list(prefix, cur).reduce((n, x) => n + x.balance, 0);
    const players = sum(cur === 'chips' ? 'bank:' : 'play:'), escrows = sum('escrow:'), house = sum('house:campaign');
    const everything = w.ledger.list('', cur).reduce((n, x) => n + x.balance, 0);
    return { players, escrows, house, held: players + escrows + house, everything };
  };
  // the game's own file as the next boot will read it (written state, not memory)
  w.disk = () => { try { return JSON.parse(fs.readFileSync(files.store, 'utf8')); } catch { return null; } };
  w.store = () => SRV._test.store;
  w.runs = SRV._test.runs;
  w.flush = () => SRV._test.store.flush();
  w.audit = () => SRV.audit();

  // "crash and reboot": whatever the old instance had not written is gone, then the same files are opened by a fresh ledger / service / registry and recover() runs
  w.crash = () => {
    for (const rec of SRV._test.runs.values()) if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    try { SRV._test.store.close(true); } catch {}
    try { w.ledger.close(); } catch {}
    hooks.before = {}; hooks.after = {};
  };
  w.reboot = () => { w.crash(); return boot(); };
  w.boot = boot;
  boot();
  current = w;
  return w;
}

// ---- the client side, for the tests that only need to play ----
const assert = require('assert');
// send an event 200 ms after the last thing and return what came back: { ev, payload } for the newest campaign event, or { error }
function call(w, sock, ev, payload) {
  w.clock.advance(200);
  const n = sock.out.length;
  sock.send('g:campaign:' + ev, payload);
  const got = sock.out.slice(n);
  const errs = got.filter((o) => o[0] === 'error');
  if (errs.length) return { error: errs[errs.length - 1][1], got };
  const g = got.filter((o) => o[0].startsWith('g:campaign:'));
  assert.ok(g.length, ev + ' gives an answer or an error');
  return { ev: g[g.length - 1][0].slice('g:campaign:'.length), payload: g[g.length - 1][1], got };
}
const start = (w, sock, mode, bet, home) => call(w, sock, 'start', { mode, bet, home });
module.exports = { world, last, all, Crash, SRV, E, call, start };
