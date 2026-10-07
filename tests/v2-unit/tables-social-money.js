'use strict';
// P6 W3b A2 + A3: the daily bonus and the achievement rewards are gated by the mint line in the ledger (bonus:<key>:<day>, achv:<key>:<id>), not by a flag in
// accounts.json. Real accounts.js + ledger + service + wallet adapter + social.js on temp files; "a crash between the ledger write and the accounts write" is built
// by writing the mint through the service with the account record untouched, then booting a fresh accounts + social from the files. Asserts on ledger lines and on
// what the socket is sent. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createWalletAdapter } = require('../../transport/wallet-adapter');
const { createAccounts } = require('../../accounts.js');
const { createSocial } = require('../../social.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-money-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let nWorld = 0;

// One world = one data dir. boot() opens accounts + ledger + service + adapter + social from the files in it: calling it again is "the process died, restart".
function world() {
  const d = path.join(dir, 'w' + (++nWorld)); fs.mkdirSync(d);
  const files = { accounts: path.join(d, 'accounts.json'), money: path.join(d, 'money.jsonl') };
  const w = { clock: Date.parse('2026-10-05T15:00:00Z'), files };
  const now = () => w.clock;
  w.boot = () => {
    const handlers = [], socks = new Map();
    const io = { sockets: { sockets: socks }, on(e, f) { handlers.push(f); } };
    w.accounts = createAccounts({ file: files.accounts });
    w.ledger = open(files.money, { fsync: 'none', log: () => {} });
    w.service = createService(w.ledger);
    w.wallet = createWalletAdapter({ service: w.service, ledger: w.ledger, onChange: () => {}, log: () => {} });
    w.social = createSocial({ io, accounts: w.accounts, now });
    w.social.setWallet(w.wallet); w.social.setLedger(w.ledger);
    w.sock = (key) => {
      const h = {}; const s = { data: { acct: key }, ev: [], emit(e, p) { this.ev.push([e, p]); }, on(e, f) { h[e] = f; }, fire(e, p) { h[e] && h[e](p); }, all(e) { return this.ev.filter((x) => x[0] === e).map((x) => x[1]); }, last(e) { return this.all(e).pop(); } };
      socks.set(key + Math.random(), s); handlers.forEach((f) => f(s)); return s;
    };
    return w;
  };
  w.signup = (name) => { const a = w.accounts.signup(name, '1234', 'a01', { ip: 't-' + name }).account; w.service.ensureAccount(a.key); w.accounts.flush(); return a.key; };
  w.mints = (kind) => [...w.ledger.entries((e) => e.ref && e.ref.startsWith(kind + ':'))];
  w.play = (key) => w.ledger.balance('play:' + key, 'play');
  w.today = () => require('../../social.js').dayOf(w.clock);
  return w.boot();
}

// ---- A2: the daily bonus ----
t('A2: the mint is in the ledger but accounts.json never got the claim (crash): status says claimed, claim answers claimed, pays nothing, the streak is not counted twice', () => {
  const w = world(); const key = w.signup('Ann');
  w.service.mint('bonus', key, 10000, 'play', `bonus:${key}:${w.today()}`);     // the payment landed; the record write did not
  const before = w.play(key), lines = [...w.ledger.entries()].length;
  w.boot();                                                                      // restart: the record on disk has no bonus
  eq(w.accounts.social(key).bonus, undefined, 'the record really is behind');
  const s = w.sock(key);
  s.fire('bonus:status'); eq(s.last('bonus:status').available, false, 'status says claimed');
  s.fire('bonus:claim');
  eq(s.last('bonus:claimed'), { ok: false, code: 'claimed' }, 'claim answers claimed');
  eq(s.last('bonus:status').available, false);
  eq(w.play(key), before, 'no second payment'); eq([...w.ledger.entries()].length, lines, 'no ledger line written');
  eq(w.mints('bonus').length, 1);
  eq(w.accounts.social(key).bonus, { last: w.today(), streak: 1 }, 'the record is mended with the streak that claim counted: 1, not 2');
  // tomorrow continues the streak from that claim: day 2, $125
  w.clock += 86400000; s.fire('bonus:status'); const st = s.last('bonus:status');
  eq([st.available, st.streak, st.day, st.amountCents], [true, 2, 2, 12500]);
  s.fire('bonus:claim'); eq(s.last('bonus:claimed').ok, true); eq(w.mints('bonus').length, 2);
});

t('A2: a claim writes the mint first; a crash right after it (before the record write) and a restart changes nothing for the player', () => {
  const w = world(); const key = w.signup('Bea');
  const real = w.accounts.social;
  w.accounts.social = (k, fn) => { if (fn) { const probe = {}; fn(probe); if (probe.bonus) throw new Error('crash: the process died before accounts.json was written'); } return real(k, fn); };
  const s = w.sock(key);
  s.fire('bonus:claim');                                                         // the handler guard turns the throw into an error event
  eq(w.mints('bonus').length, 1, 'the ledger line is there'); eq(w.play(key), w.service.START_PLAY + 10000);
  w.boot();
  const s2 = w.sock(key);
  s2.fire('bonus:status'); eq(s2.last('bonus:status').available, false);
  s2.fire('bonus:claim'); eq(s2.last('bonus:claimed').ok, false);
  eq(w.mints('bonus').length, 1); eq(w.play(key), w.service.START_PLAY + 10000);
});

t('A2: a normal claim still pays once, answers ok, and a second claim the same day is refused', () => {
  const w = world(); const key = w.signup('Cy');
  const s = w.sock(key);
  s.fire('bonus:claim'); const c = s.last('bonus:claimed');
  eq([c.ok, c.amountCents, c.streak, c.day], [true, 10000, 1, 1]);
  eq(w.mints('bonus').map((e) => [e.ref, e.amount]), [[`bonus:${key}:${w.today()}`, 10000]]);
  s.fire('bonus:claim'); eq(s.last('bonus:claimed'), { ok: false, code: 'claimed' });
  eq(w.mints('bonus').length, 1); eq(w.accounts.social(key).bonus, { last: w.today(), streak: 1 });
});

// ---- A3: achievements ----
t('A3: the reward mint is in the ledger but the account has no flag (crash): no second achv:unlocked, no second mint, the view shows it unlocked', () => {
  const w = world(); const key = w.signup('Dee');
  w.accounts.social(key, (rec) => { rec.stats = { hands: 1 }; });                 // the progress that earns first_hand
  w.service.mint('achv', key, 2500, 'play', `achv:${key}:first_hand`);            // the reward landed; the flag write did not
  w.accounts.flush();
  const before = w.play(key);
  w.boot();
  eq(((w.accounts.social(key).achv || {}).u || {}).first_hand, undefined, 'the flag really is missing');
  const s = w.sock(key);
  s.fire('achv:state');
  const v = s.last('achv:state'); ok(v.list.find((x) => x.id === 'first_hand').done, 'the view shows it unlocked');
  w.social.checkAchv(key);
  eq(s.all('achv:unlocked').filter((x) => x.id === 'first_hand'), [], 'no second achv:unlocked');
  eq(w.mints('achv').filter((e) => e.ref === `achv:${key}:first_hand`).length, 1, 'no second mint');
  eq(w.play(key), before, 'no second reward');
  ok(w.accounts.social(key).achv.u.first_hand > 0, 'the flag is mended');
  // more play later does not pay it either
  w.accounts.social(key, (rec) => { rec.stats.hands = 5; }); w.social.checkAchv(key);
  eq(w.mints('achv').filter((e) => e.ref === `achv:${key}:first_hand`).length, 1);
  eq(s.all('achv:unlocked').filter((x) => x.id === 'first_hand'), []);
});

t('A3: a normal unlock pays once, sends achv:unlocked once, and the ledger line is written before the flag', () => {
  const w = world(); const key = w.signup('Eve'); const s = w.sock(key);
  w.accounts.social(key, (rec) => { rec.stats = { hands: 1 }; });
  const real = w.accounts.social; let flagWrites = 0, mintsAtFlag = null;
  w.accounts.social = (k, fn) => { if (fn) { const probe = { achv: { u: {}, c: {} } }; fn(probe); if (probe.achv.u.first_hand) { flagWrites++; mintsAtFlag = w.mints('achv').length; } } return real(k, fn); };
  w.social.checkAchv(key);
  eq(s.all('achv:unlocked').filter((x) => x.id === 'first_hand').length, 1);
  eq(w.mints('achv').filter((e) => e.ref === `achv:${key}:first_hand`).map((e) => e.amount), [2500]);
  eq([flagWrites, mintsAtFlag], [1, 1], 'the flag was written after the mint line existed');
  w.social.checkAchv(key); eq(s.all('achv:unlocked').filter((x) => x.id === 'first_hand').length, 1); eq(w.mints('achv').filter((e) => e.ref === `achv:${key}:first_hand`).length, 1);
});

t('A3: a mint that throws leaves no flag, no event and no xp (the next check tries again)', () => {
  const w = world(); const key = w.signup('Fay'); const s = w.sock(key);
  w.accounts.social(key, (rec) => { rec.stats = { hands: 1 }; });
  const real = w.service.mint; let n = 0;
  w.service.mint = (...a) => { if (!n++) throw new Error('disk'); return real(...a); };
  w.social.checkAchv(key);
  eq(s.all('achv:unlocked').length, 0); eq(w.mints('achv').length, 0);
  eq(((w.accounts.social(key).achv || {}).u || {}).first_hand, undefined);
  w.social.checkAchv(key);
  eq(s.all('achv:unlocked').filter((x) => x.id === 'first_hand').length, 1); eq(w.mints('achv').length, 1);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
