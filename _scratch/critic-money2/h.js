'use strict';
// shared fake-io harness for the money critic 2 repro scripts. Run every script from the root of a slim export of b596408:
//   cd $D && node /path/to/_scratch/critic-money2/<script>.js
const fs = require('fs'), os = require('os'), path = require('path'), EventEmitter = require('events');
const ROOT = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cm2-run-'));
process.env.WALLET_FILE = path.join(tmp, 'wallet.json');
process.env.COLDCALL_CFG_FILE = path.join(tmp, 'coldcall-config.json');
for (const k of ['COLDCALL_PULL_FILE', 'DATA_DIR', 'RAILWAY_VOLUME_MOUNT_PATH', 'BENDER_ADMIN_TOKEN', 'COLDCALL_TEST']) delete process.env[k];
const E = require(ROOT + '/games/coldcall-engine.js');
const L = require(ROOT + '/games/coldcall-livecfg.js');
const SRV = require(ROOT + '/games/coldcall.js');
const games = require(ROOT + '/games');
const { createWallet } = require(ROOT + '/wallet.js');
function makeSocket(io, acct) {
  const s = new EventEmitter();
  s.data = acct ? { acct: typeof acct === 'string' ? { key: acct } : acct } : {};
  s.out = [];
  const emit = s.emit.bind(s);
  s.send = (ev, p) => emit(ev, p);
  s.emit = (ev, p) => { if (ev in { error: 1, wallet: 1 } || ev.startsWith('g:') || ev.startsWith('floor:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
  io.sockets.sockets.set(String(Math.random()), s);
  io.emit('connection', s);
  return s;
}
const last = (s, ev) => { for (let i = s.out.length - 1; i >= 0; i--) if (s.out[i][0] === ev) return s.out[i][1]; return null; };
const all = (s, ev) => s.out.filter((o) => o[0] === ev).map((o) => o[1]);
function setup(opts = {}) {
  SRV._history.clear(); SRV.log = opts.log || (() => {});
  SRV.potRng = opts.potRng || (() => 1); SRV.roundRng = opts.roundRng;
  const dir = opts.dir || fs.mkdtempSync(path.join(tmp, 's'));
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  const ledger = { log: () => {} };
  let t = opts.t || Date.UTC(2026, 9, 6, 18);
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const hook = { push: () => {} };
  const bank = opts.bank || new Map();
  const chips = { get: (k) => (bank.has(k) ? bank.get(k) : 10000000), add: (k, d) => { bank.set(k, Math.max(0, chips.get(k) + d)); hook.push(k); } };
  const wallet = createWallet({ file: path.join(dir, 'wallet.json'), ledger, chips, now: clock.now, onChange: (k) => hook.push(k) });
  const g = games({ io, ledger, now: clock.now, rng: opts.rng, accounts: {}, tables: {}, rooms: {}, wallet, chips });
  hook.push = g.pushWallet;
  const store = () => SRV._pull.store;
  return { io, clock, wallet, g, dir, bank, chips, store, potOf: (m) => store().pot(m, 0), sock: (a) => makeSocket(io, a), open: SRV._pull.open };
}
function spin(s, sock, payload) {
  s.clock.advance(200);
  const n = sock.out.length;
  sock.send('g:coldcall:spin', payload);
  const fresh = sock.out.slice(n);
  const r = fresh.filter((o) => o[0] === 'g:coldcall:result').pop(), e = fresh.filter((o) => o[0] === 'error').pop();
  return r ? r[1] : e ? { error: e[1] } : null;
}
function decide(s, sock, payload) {
  const n = sock.out.length;
  sock.send('g:coldcall:decide', payload);
  const fresh = sock.out.slice(n);
  const r = fresh.filter((o) => o[0] === 'g:coldcall:result').pop(), e = fresh.filter((o) => o[0] === 'error').pop();
  return r ? r[1] : e ? { error: e[1] } : null;
}
// play a spin to the end, answering every decision with `policy(pending)` (default: first square, bank)
function playOut(s, sock, payload, policy) {
  let r = spin(s, sock, payload), n = 0;
  while (r && r.status === 'pending' && n++ < 10) {
    const p = r.pending, d = (policy && policy(p, r)) || (p.k === 'pick' ? { k: 'pick', p: p.choices[0] } : { k: 'more', take: false });
    r = decide(s, sock, { roundId: r.roundId, ...d });
  }
  return r;
}
module.exports = { ROOT, tmp, E, L, SRV, setup, spin, decide, playOut, last, all, makeSocket };
