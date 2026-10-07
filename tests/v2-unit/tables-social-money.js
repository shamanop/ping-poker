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

// ---- P6 W3b fix round 2: D1 / D2, a crash between the bonus mint and the account record leaves the player what an uncrashed claim gives ----
const DAY = 86400000;
const day7 = (w, key) => ((w.accounts.social(key).achv || {}).c || {}).day7 || 0;
const fullWeek = (w, key) => w.social.achvView(key).list.find((x) => x.id === 'day7').done;
// claims on days 1..n (one a day). crashOn = the day whose claim dies after the mint (the mint is written, the record is not), then boot. Returns the world and the socket.
function claimsTo(n, crashOn) {
  const w = world(), key = w.signup('Ann'); let s = w.sock(key);
  for (let d = 1; d <= n; d++) {
    if (d === crashOn) { w.accounts.flush(); const i = w.social.bonusInfo(key); w.service.mint('bonus', key, i.amountCents, 'play', `bonus:${key}:${w.today()}`); w.boot(); s = w.sock(key); }
    else s.fire('bonus:claim');
    if (d < n) w.clock += DAY;
  }
  return { w, key, s };
}
const state = (w, key) => ({ bal: w.play(key), bonus: w.accounts.social(key).bonus, day7: day7(w, key), full: fullWeek(w, key), bonusMints: w.mints('bonus').length, achvMints: w.mints('achv').filter((e) => e.ref === `achv:${key}:day7`).length });

t('D1: the day-7 claim dies after the mint (record unwritten), restart, the player asks: claimed, no second payment, and the day7 counter, Full Week and its reward are exactly what an uncrashed day 7 gives', () => {
  const c = claimsTo(7), ctl = state(c.w, c.key);
  eq([ctl.day7, ctl.full, ctl.achvMints], [1, true, 1], 'the control unlocked Full Week');
  const x = claimsTo(7, 7); x.s.fire('bonus:status'); x.s.fire('bonus:claim');
  eq(x.s.last('bonus:claimed'), { ok: false, code: 'claimed' }, 'claimed, nothing paid again');
  eq(state(x.w, x.key), ctl, 'the player holds what an uncrashed claim gives');
  eq(x.s.all('achv:unlocked').filter((a) => a.id === 'day7').length, 1, 'Full Week is announced');
  x.w.boot(); const s2 = x.w.sock(x.key); s2.fire('bonus:claim'); x.w.social.checkAchv(x.key); eq(state(x.w, x.key), ctl, 'a second restart and claim change nothing');
});

t('D1: the claim\'s record write carries the day7 counter in the SAME write (a crash cannot leave the day recorded and the counter not)', () => {
  const w = world(), key = w.signup('Ann'); const s = w.sock(key);
  for (let d = 1; d <= 6; d++) { s.fire('bonus:claim'); w.clock += DAY; }
  const real = w.accounts.social, writes = [];
  w.accounts.social = (k, fn) => { if (fn) { const probe = { achv: { u: {}, c: { day7: 0 } } }; fn(probe); if (probe.bonus) writes.push([probe.bonus.streak, probe.achv.c.day7]); } return real(k, fn); };
  s.fire('bonus:claim');
  eq(writes, [[7, 1]], 'one write: streak 7 and day7 counter 1 together');
});

for (const [n, label] of [[3, 'a day-3 claim'], [6, 'a day-6 claim']]) {
  t(`D2: ${label} dies after the mint (record unwritten) and nobody asks for the status that day: the next day the streak is carried on (day ${n + 1}), as an uncrashed claim, and the next claim pays once`, () => {
    const c = claimsTo(n); c.w.clock += DAY; c.s.fire('bonus:status'); const ctl = c.s.last('bonus:status'); c.s.fire('bonus:claim');
    const ctlState = state(c.w, c.key);
    const x = claimsTo(n, n); x.w.clock += DAY;                                    // the player comes back the next day only
    x.s.fire('bonus:status'); const st = x.s.last('bonus:status');
    eq([st.available, st.streak, st.day, st.amountCents], [ctl.available, n + 1, n + 1, ctl.amountCents], 'the status continues the streak');
    x.s.fire('bonus:claim'); eq(x.s.last('bonus:claimed').amountCents, c.s.last('bonus:claimed').amountCents);
    eq(state(x.w, x.key), ctlState, 'balance, record, counter and mints equal the uncrashed run'); eq(state(x.w, x.key).bonusMints, n + 1);
    x.s.fire('bonus:claim'); eq(x.s.last('bonus:claimed'), { ok: false, code: 'claimed' }); eq(state(x.w, x.key), ctlState, 'no second payment');
  });
}

t('D2: the same crash and the player comes back two days later (the streak broke in both runs): day 1 again, equal to the uncrashed run, the lost mint is recorded, nothing paid twice', () => {
  const c = claimsTo(3); c.w.clock += 2 * DAY; c.s.fire('bonus:claim'); const ctl = state(c.w, c.key);
  const x = claimsTo(3, 3); x.w.clock += 2 * DAY; x.s.fire('bonus:claim');
  eq(x.s.last('bonus:claimed').streak, 1); eq(state(x.w, x.key), ctl);
});

t('D2: the crash on day 6, the player comes back on day 7 and is asked nothing before: Full Week is paid at day 7 as in the uncrashed run (100000 for the claim, the achievement once)', () => {
  const c = claimsTo(6); c.w.clock += DAY; c.s.fire('bonus:claim'); const ctl = state(c.w, c.key);
  const x = claimsTo(6, 6); x.w.clock += DAY; x.s.fire('bonus:claim');
  eq(x.s.last('bonus:claimed').amountCents, 100000); eq(state(x.w, x.key), ctl); eq([ctl.day7, ctl.full, ctl.achvMints], [1, true, 1]);
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
