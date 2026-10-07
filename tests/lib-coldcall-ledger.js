'use strict';
// A ledger-backed world for the COLD CALL server tests (P6 W2-d). Everything is real except the socket layer: money/ledger.js on a temp file, money/service.js, transport/game-money.js
// (ctx.money), the games registry (games/index.js, which calls recover() at boot exactly as server.js does) and games/coldcall.js. No wallet.js anywhere.
//
//   const w = H.world({ rng, potRng, roundRng, keys, dir, t });   // boots: ledger -> service -> accounts -> registry -> recover()
//   w.fund('ann', 'play', 1e10)            // through the service (an admin:adjust line), either currency
//   w.bal('ann', 'chips'), w.escrows(), w.pool('play'), w.house('chips'), w.lines(fn), w.has(ref), w.conservation('play')   // read from the LEDGER
//   w.reboot()                             // "crash and reboot": the old instance is abandoned (nothing unwritten is flushed), a new ledger / service / registry opens the same files, recover() runs
//   w.hooks.before.settle = (args) => { throw new Crash() }   // inject a failure before / after any ctx.money call (round, open, settle, void); w.hooks.after.settle = (args, result) => ...
//   w.sock('ann'), w.send(sock, ev, payload), H.last(sock, ev), H.all(sock, ev)
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createGameMoney } = require('../transport/game-money');
const { createWalletAdapter } = require('../transport/wallet-adapter');
const games = require('../games');
const SRV = require('../games/coldcall.js');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coldcall-ledger-'));
let counter = 0;
let current = null;           // games/coldcall.js is one module per process, so there is one live world: a new world (the same dir = a restart) first "crashes" the old one (nothing unwritten is flushed, its files are closed)

const last = (s, ev) => { for (let i = s.out.length - 1; i >= 0; i--) if (s.out[i][0] === ev) return s.out[i][1]; return null; };
const all = (s, ev) => s.out.filter((o) => o[0] === ev).map((o) => o[1]);

class Crash extends Error { constructor(m) { super(m || 'simulated crash'); this.name = 'Crash'; } }

const CALLS = ['round', 'open', 'settle', 'void'];
const curOf = (c) => (c === 'chips' ? 'chips' : 'play');
const acct = (key, cur) => (cur === 'chips' ? 'bank:' : 'play:') + String(key).toLowerCase().trim();

function world(opts = {}) {
  const dir = opts.dir || fs.mkdtempSync(path.join(base, 'w'));
  if (current) { try { current.crash(); } catch {} }
  const files = { money: path.join(dir, 'money.jsonl'), pull: path.join(dir, 'coldcall-pull.json'), cfg: path.join(dir, 'coldcall-config.json') };
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  let t = opts.t || 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
  const hooks = { before: {}, after: {}, calls: [] };       // calls: every ctx.money write call, [name, key, cur, roundId, outcome] in order
  const w = { dir, files, io, clock, hooks, SRV, keys: new Set((opts.keys || []).map((k) => String(k).toLowerCase())), boots: 0, funded: { chips: 0, play: 0 }, report: null };

  function boot() {
    w.boots++;
    SRV.log = opts.log || (() => {});
    SRV.potRng = opts.potRng || (() => 1);          // never hits unless a test says so
    SRV.roundRng = opts.roundRng;                   // the whole-cent rounding source (undefined = crypto); a separate stream from the round's own rng
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
    const wallet = createWalletAdapter({ service, ledger, onChange, log: () => {} });
    w.money = real.forGame('coldcall');                // the bound ctx.money as a module sees it, without the call log or the hooks
    io.removeAllListeners('connection');
    reg = w.g = games({ io, wallet, money: gm, service, modules: [SRV], accounts: {}, tables: {}, rooms: {}, now: clock.now, rng: opts.rng, files: { coldcallPull: files.pull, coldcallConfig: files.cfg }, ledger: { log: () => {} } });
    w.wallet = wallet;
    w.report = reg.recover();
    return w.report;
  }

  w.addKey = (k) => { k = String(k).toLowerCase().trim(); w.keys.add(k); if (w.service) w.service.ensureAccount(k); };
  // a player who plays has an account; a socket for an unknown key creates it first
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
  // put money into the office pot through the ledger, the only way it gets there: a real round of a funded player whose whole stake is the pot feed (pool legs of ONE batch, house nets 0).
  // The game's mirror of the pot (a record in its own file, never money) is refreshed so a test can read it at once.
  w.seedPool = (cur, n) => {
    cur = curOf(cur); const k = 'poolfeeder'; w.addKey(k); w.fund(k, cur, n);
    w.money.round(k, cur, 'seed' + (++counter), { cost: n, pool: { name: 'office', feed: n } });
    const p = SRV._pull.store.pot(cur); p.bal = w.pool(cur); p.fed += n; SRV._pull.store.potChanged();
    return w.pool(cur);
  };
  // set a balance to an exact number (a delta through the service)
  w.setBal = (key, cur, v) => { const d = v - w.bal(key, cur); if (d) w.fund(key, cur, d); return v; };

  // ---- reads, all from the ledger ----
  w.bal = (key, cur) => w.ledger.balance(acct(key, curOf(cur)), curOf(cur));
  w.balances = (key) => ({ play: w.bal(key, 'play'), chips: w.bal(key, 'chips') });
  w.escrows = (cur) => { const out = []; for (const c of cur ? [cur] : ['chips', 'play']) for (const x of w.ledger.list('escrow:coldcall:', c)) out.push({ ...x, cur: c }); return out; };
  w.escrowSum = (cur) => w.escrows(cur).reduce((n, x) => n + x.balance, 0);
  w.pool = (cur) => w.ledger.balance('pool:coldcall:office', curOf(cur));
  w.house = (cur) => w.ledger.balance('house:coldcall', curOf(cur));
  w.has = (ref) => w.ledger.has(ref);
  w.lines = (fn) => [...w.ledger.entries(fn || null)];
  w.lastId = () => w.ledger.lastId;
  // the lines written after `id`
  w.since = (id) => [...w.ledger.entries(null, id)];
  // every game account of one currency, plus the players: for "nothing was created or lost"
  w.conservation = (cur) => {
    cur = curOf(cur);
    const sum = (prefix) => w.ledger.list(prefix, cur).reduce((n, x) => n + x.balance, 0);
    const players = sum(cur === 'chips' ? 'bank:' : 'play:'), escrows = sum('escrow:'), pool = sum('pool:'), house = sum('house:coldcall');
    const everything = w.ledger.list('', cur).reduce((n, x) => n + x.balance, 0);
    return { players, escrows, pool, house, held: players + escrows + pool + house, everything };
  };
  // the game's own file as the next boot will read it (written state, not memory)
  w.disk = () => { try { return JSON.parse(fs.readFileSync(files.pull, 'utf8')); } catch { return null; } };
  w.store = () => SRV._pull.store;
  w.potOf = (mode) => SRV._pull.store.pot(mode);          // the game's own pot record (mirror, statistics, remainder): never the money
  w.open = SRV._pull.open;
  w.flush = () => SRV._pull.store.flush();

  // "crash and reboot": whatever the old instance had not written is gone, then the same files are opened by a fresh ledger / service / registry and recover() runs
  w.crash = () => {
    for (const rec of SRV._pull.open.values()) if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    try { SRV._pull.store.close(true); } catch {}
    try { w.ledger.close(); } catch {}
    hooks.before = {}; hooks.after = {};
  };
  w.reboot = () => { w.crash(); return boot(); };
  w.boot = boot;
  w.audit = () => SRV.audit();
  boot();
  current = w;
  return w;
}

// ---- the client side of a round, for the tests that only need to play ----
const assert = require('assert');
function spin(w, sock, payload) {            // 200 ms after the last thing; the newest result (or error) this send produced
  w.clock.advance(200);
  const n = all(sock, 'g:coldcall:result').length, e = all(sock, 'error').length;
  sock.send('g:coldcall:spin', payload);
  const rs = all(sock, 'g:coldcall:result');
  if (rs.length > n) return rs[rs.length - 1];
  const es = all(sock, 'error'); assert.ok(es.length > e, 'a spin gives a result or an error');
  return { error: es[es.length - 1] };
}
const policy = (i, pend) => (pend.k === 'pick' ? { k: 'pick', p: pend.choices[i % 2 ? pend.choices.length - 1 : 0] } : { k: 'more', take: i % 3 !== 0 });
function decide(w, sock, res, d) {
  const n = all(sock, 'g:coldcall:result').length;
  sock.send('g:coldcall:decide', { roundId: res.roundId, ...d });
  const rs = all(sock, 'g:coldcall:result'); assert.ok(rs.length > n, 'a decision gives a result: ' + JSON.stringify(last(sock, 'error')));
  return rs[rs.length - 1];
}
function play(w, sock, payload, i = 0) {      // spin, then answer every decision with the policy until the round is done
  let r = spin(w, sock, payload), n = 0;
  while (r.status === 'pending') r = decide(w, sock, r, policy(i + n++, r.pending));
  return r;
}
function toPending(w, sock, kind, mode = 'play', bet = 10) {   // buy bonuses until one stops at a decision of the wanted kind
  for (let i = 0; i < 600; i++) {
    let r = spin(w, sock, { bet, mode, buyBonus: i % 3 === 2 ? 'bonus2' : 'bonus1' });
    if (r.error) throw new Error('toPending: ' + JSON.stringify(r.error));
    let n = 0;
    while (r.status === 'pending') { if (r.pending.k === kind) return r; r = decide(w, sock, r, policy(i + n++, r.pending)); }
  }
  throw new Error('no ' + kind + ' decision in 600 buys');
}

module.exports = { world, last, all, Crash, SRV, spin, decide, play, toPending, policy };
