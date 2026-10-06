'use strict';
// Service tests. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open, MoneyError } = require('../../money/ledger');
const { createService, START_CHIPS, START_PLAY } = require('../../money/service');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
function throwsCode(fn, code) {
  try { fn(); } catch (e) { if (e instanceof MoneyError && e.code === code) return e; throw new Error('wanted ' + code + ', got ' + (e && e.code || e) + ' ' + (e && e.message)); }
  throw new Error('did not throw ' + code);
}

const dir = fs.mkdtempSync(path.join(process.env.MONEY_TMP || os.tmpdir(), 'money-service-'));
let n = 0, clock = 1000000;
const env = (file) => {
  const f = file || path.join(dir, 's' + (++n) + '.jsonl');
  const ledger = open(f, { now: () => clock });
  return { f, ledger, svc: createService(ledger, { now: () => clock }) };
};
// all player-held value across both currencies, and the books for each
function totals(ledger) {
  const sum = (cur) => ['bank:', 'play:', 'seat:', 'pot:', 'orphan:'].reduce((a, p) => a + ledger.list(p, cur).reduce((x, r) => x + r.balance, 0), 0);
  return { chips: sum('chips'), play: sum('play') };
}
const booksOk = (ledger) => { const c = ledger.check(); ok(c.chips.ok && c.play.ok, 'books balance ' + JSON.stringify(c)); };

t('ensureAccount mints once', () => {
  const { svc, ledger } = env();
  const r = svc.ensureAccount('chris');
  ok(r.created); eq(ledger.balance('bank:chris', 'chips'), START_CHIPS); eq(ledger.balance('play:chris', 'play'), START_PLAY);
  const r2 = svc.ensureAccount('chris');
  ok(!r2.created); eq(ledger.balance('bank:chris', 'chips'), START_CHIPS);
  eq(ledger.balance('mint:signup', 'chips'), -START_CHIPS);
  // spending everything does not make the account "new" again
  svc.buyIn('chris', 'T', START_CHIPS, 'chips', 'chips', 'b1');
  ok(!svc.ensureAccount('chris').created); eq(ledger.balance('bank:chris', 'chips'), 0);
  booksOk(ledger);
});

t('ensureAccount after reopen does not remint', () => {
  const e = env(); e.svc.ensureAccount('a'); e.ledger.close();
  const e2 = env(e.f); ok(!e2.svc.ensureAccount('a').created); eq(e2.ledger.balance('bank:a', 'chips'), START_CHIPS);
});

t('buyIn / cashOut conserve per currency, same-currency and through fx', () => {
  const { svc, ledger } = env();
  svc.ensureAccount('a'); svc.ensureAccount('b');
  const before = totals(ledger);
  svc.buyIn('a', 'CT', 2000, 'chips', 'chips', 'bi:a');     // chips table from the bank
  svc.buyIn('b', 'CT', 3000, 'chips', 'play', 'bi:b');      // chips table from Play $ (fx)
  svc.buyIn('a', 'PT', 5000, 'play', 'chips', 'bi:a2');     // Play table from the bank (fx)
  svc.buyIn('b', 'PT', 7000, 'play', 'play', 'bi:b2');      // Play table from the wallet
  eq(ledger.balance('seat:CT:a', 'chips'), 2000); eq(ledger.balance('seat:CT:b', 'chips'), 3000);
  eq(ledger.balance('seat:PT:a', 'play'), 5000); eq(ledger.balance('seat:PT:b', 'play'), 7000);
  eq(ledger.balance('bank:a', 'chips'), START_CHIPS - 2000 - 5000); eq(ledger.balance('play:b', 'play'), START_PLAY - 3000 - 7000);
  eq(ledger.balance('bank:b', 'chips'), START_CHIPS); eq(ledger.balance('play:a', 'play'), START_PLAY);
  booksOk(ledger);
  // fx legs: b's chips seat from Play $ (fx:play +3000, fx:chips -3000), a's Play seat from the bank (fx:play -5000, fx:chips +5000)
  eq(ledger.balance('fx:play', 'play'), -2000, 'fx:play leg'); eq(ledger.balance('fx:chips', 'chips'), 2000, 'fx:chips leg');
  // table results move value between seats of one table (stand-in for a hand), then cash out to each seat's fund
  svc.settleHand('CT', 1, 'chips', { committed: { a: 500, b: 500 }, payouts: { b: 1000 }, returned: {} });
  svc.cashOut('a', 'CT', 1500, 'chips', 'chips', 'co:a');
  svc.cashOut('b', 'CT', 3500, 'chips', 'play', 'co:b');
  eq(ledger.balance('bank:a', 'chips'), START_CHIPS - 2000 - 5000 + 1500);
  eq(ledger.balance('play:b', 'play'), START_PLAY - 3000 - 7000 + 3500, 'b comes back to Play $ with the net result');
  eq(ledger.balance('seat:CT:a', 'chips') + ledger.balance('seat:CT:b', 'chips'), 0);
  svc.cashOut('a', 'PT', 5000, 'play', 'chips', 'co:a2'); svc.cashOut('b', 'PT', 7000, 'play', 'play', 'co:b2');
  booksOk(ledger);
  // value across currencies is unchanged except for the poker transfer between a and b
  const after = totals(ledger);
  eq(after.chips + after.play, before.chips + before.play, 'nothing minted or lost');
  // fx accounts net to zero across the two currencies they bridge
  eq(ledger.balance('fx:chips', 'chips') + ledger.balance('fx:play', 'play'), 0, 'fx legs 1:1');
});

t('buyIn / cashOut guard rails', () => {
  const { svc, ledger } = env();
  svc.ensureAccount('a');
  throwsCode(() => svc.buyIn('a', 'T', START_CHIPS + 1, 'chips', 'chips', 'r1'), 'insufficient');
  throwsCode(() => svc.buyIn('a', 'T', START_PLAY + 1, 'chips', 'play', 'r2'), 'insufficient');
  eq(ledger.balance('bank:a', 'chips'), START_CHIPS, 'failed buy-in changed nothing'); eq(ledger.lastId, 2);
  throwsCode(() => svc.buyIn('a', 'T', 0, 'chips', 'chips', 'r3'), 'bad_amount');
  throwsCode(() => svc.buyIn('a', 'T', 1.5, 'chips', 'chips', 'r4'), 'bad_amount');
  throwsCode(() => svc.buyIn('a', 'T', 10, 'gold', 'chips', 'r5'), 'bad_cur');
  throwsCode(() => svc.buyIn('a', 'T', 10, 'chips', 'gold', 'r6'), 'bad_fund');
  throwsCode(() => svc.buyIn('a', 'T', 10, 'chips', 'chips', ''), 'bad_ref');
  throwsCode(() => svc.buyIn('a:b', 'T', 10, 'chips', 'chips', 'r7'), 'bad_key');
  throwsCode(() => svc.buyIn('a', 'T:1', 10, 'chips', 'chips', 'r8'), 'bad_table');
  svc.buyIn('a', 'T', 100, 'chips', 'chips', 'ok1');
  throwsCode(() => svc.cashOut('a', 'T', 101, 'chips', 'chips', 'c1'), 'insufficient');  // no clamp: cannot cash out more than the seat holds
  eq(ledger.balance('seat:T:a', 'chips'), 100);
  eq(svc.cashOut('a', 'T', 0, 'chips', 'chips', 'c0').noop, true, 'zero stack leaving is a no-op');
  // missing fund = the table's own currency
  svc.buyIn('a', 'T', 10, 'chips', null, 'ok2'); eq(ledger.balance('seat:T:a', 'chips'), 110);
  throwsCode(() => svc.buyIn('nobody', 'T', 10, 'chips', 'chips', 'ghost'), 'insufficient');
});

t('idempotent refs: retry is a no-op, changed content is a conflict', () => {
  const { svc, ledger } = env();
  svc.ensureAccount('a');
  eq(svc.buyIn('a', 'T', 100, 'chips', 'chips', 'x').dup, false);
  eq(svc.buyIn('a', 'T', 100, 'chips', 'chips', 'x').dup, true);
  eq(svc.buyIn('a', 'T2', 100, 'chips', 'play', 'y').dup, false);
  eq(svc.buyIn('a', 'T2', 100, 'chips', 'play', 'y').dup, true, 'fx batch retry');
  eq(svc.buyIn('a', 'T', 100, 'chips', 'chips', 'x').dup, true, 'retry of the first buy-in after the seat was funded is still a dup');
  eq(ledger.balance('seat:T:a', 'chips'), 100); eq(ledger.balance('seat:T2:a', 'chips'), 100);
  throwsCode(() => svc.buyIn('a', 'T', 101, 'chips', 'chips', 'x'), 'ref_conflict');
  throwsCode(() => svc.buyIn('a', 'T2', 100, 'chips', 'chips', 'y'), 'ref_conflict', 'same ref, different fund');
  eq(svc.cashOut('a', 'T', 50, 'chips', 'chips', 'c').dup, false); eq(svc.cashOut('a', 'T', 50, 'chips', 'chips', 'c').dup, true);
  eq(ledger.balance('seat:T:a', 'chips'), 50);
});

t('one fund per seat while it holds chips: fund_mismatch writes nothing; a 0 seat may switch', () => {
  const { svc, ledger } = env();
  svc.ensureAccount('a'); svc.ensureAccount('b');
  svc.buyIn('a', 'T', 1000, 'chips', 'chips', 'a1');
  const id = ledger.lastId, snap = JSON.stringify([ledger.list('', 'chips'), ledger.list('', 'play')]);
  const e = throwsCode(() => svc.buyIn('a', 'T', 500, 'chips', 'play', 'a2'), 'fund_mismatch');
  eq(e.details.have, 'chips'); eq(e.details.want, 'play');
  eq(ledger.lastId, id, 'nothing written'); eq(JSON.stringify([ledger.list('', 'chips'), ledger.list('', 'play')]), snap); ok(!ledger.has('a2'));
  // same-fund rebuy unchanged, 'bank' alias and a missing fund both mean chips on a chips table
  eq(svc.buyIn('a', 'T', 100, 'chips', 'chips', 'a3').dup, false); svc.buyIn('a', 'T', 100, 'chips', 'bank', 'a4'); svc.buyIn('a', 'T', 100, 'chips', null, 'a5');
  eq(ledger.balance('seat:T:a', 'chips'), 1300);
  // a seat funded from Play $: a bank (or default) rebuy is the mismatch
  svc.buyIn('b', 'T', 400, 'chips', 'play', 'b1'); svc.buyIn('b', 'T', 100, 'chips', 'play', 'b2');
  const e2 = throwsCode(() => svc.buyIn('b', 'T', 100, 'chips', null, 'b3'), 'fund_mismatch'); eq(e2.details.have, 'play'); eq(e2.details.want, 'chips');
  throwsCode(() => svc.buyIn('b', 'T', 100, 'chips', 'chips', 'b4'), 'fund_mismatch');
  eq(ledger.balance('seat:T:b', 'chips'), 500);
  // a different table is a different seat: the other fund is fine there
  svc.buyIn('b', 'T9', 100, 'chips', 'chips', 'b5');
  // switch at 0: b loses everything in a hand, then comes back through the bank
  svc.settleHand('T', 1, 'chips', { committed: { a: 500, b: 500 }, payouts: { a: 1000 }, returned: {} });
  eq(ledger.balance('seat:T:b', 'chips'), 0);
  svc.buyIn('b', 'T', 300, 'chips', 'chips', 'b6');
  eq(svc.seatFund('T', 'b', 'chips'), 'chips');
  const bankBefore = ledger.balance('bank:b', 'chips');
  svc.cashOut('b', 'T', 100, 'chips', 'chips', 'cb');
  eq(ledger.balance('bank:b', 'chips'), bankBefore + 100);
  // and the old fund is now the mismatch
  throwsCode(() => svc.buyIn('b', 'T', 10, 'chips', 'play', 'b7'), 'fund_mismatch');
  // switch after a full cash-out, and bootRecover returns to the NEW fund
  svc.cashOut('b', 'T', 200, 'chips', 'chips', 'cb2');
  svc.buyIn('b', 'T', 250, 'chips', 'play', 'b8'); eq(svc.seatFund('T', 'b', 'chips'), 'play');
  const playBefore = ledger.balance('play:b', 'play');
  const rep = svc.bootRecover('boot-x');
  eq(ledger.balance('play:b', 'play'), playBefore + 250, 'recovered to Play $, the new fund');
  ok(rep.seats.some(x => x.key === 'b' && x.fund === 'play'));
  booksOk(ledger);
});

t('a switched fund survives a restart (read from the ledger) and cashOut honours the caller fund', () => {
  const e = env(); const { svc } = e;
  svc.ensureAccount('a'); svc.buyIn('a', 'T', 100, 'chips', 'chips', 'x'); svc.cashOut('a', 'T', 100, 'chips', 'chips', 'y');
  svc.buyIn('a', 'T', 100, 'chips', 'play', 'z'); e.ledger.close();
  const e2 = env(e.f); eq(e2.svc.seatFund('T', 'a', 'chips'), 'play');
  throwsCode(() => e2.svc.buyIn('a', 'T', 5, 'chips', 'chips', 'w'), 'fund_mismatch');
  e2.svc.buyIn('a', 'T', 5, 'chips', 'play', 'w2'); e2.svc.cashOut('a', 'T', 105, 'chips', 'play', 'out');
  eq(e2.ledger.balance('play:a', 'play'), START_PLAY);
});

t('settleHand: payouts, uncalled return, odd chips; conserves; one ledger line', () => {
  const { svc, ledger } = env();
  for (const k of ['a', 'b', 'c']) { svc.ensureAccount(k); svc.buyIn(k, 'T', 1000, 'chips', 'chips', 'bi:' + k); }
  const id0 = ledger.lastId;
  const r = svc.settleHand('T', 7, 'chips', { committed: { a: 300, b: 300, c: 100 }, payouts: { a: 500, c: 101 }, returned: { b: 99 } });
  eq(ledger.lastId, id0 + 1, 'one line'); eq(r.dup, false);
  eq(ledger.balance('seat:T:a', 'chips'), 1200); eq(ledger.balance('seat:T:b', 'chips'), 799); eq(ledger.balance('seat:T:c', 'chips'), 1001);
  eq(ledger.balance('pot:T:7', 'chips'), 0, 'pot is empty outside the batch');
  eq(svc.settleHand('T', 7, 'chips', { committed: { c: 100, b: 300, a: 300 }, payouts: { c: 101, a: 500 }, returned: { b: 99 } }).dup, true, 'key order does not matter');
  throwsCode(() => svc.settleHand('T', 7, 'chips', { committed: { a: 300, b: 300, c: 100 }, payouts: { a: 501, c: 100 }, returned: { b: 99 } }), 'ref_conflict');
  const flat = [...ledger.entries(e => e.batchRef === 'hand:T:7')];
  ok(flat.some(e => e.to === 'pot:T:7') && flat.some(e => e.from === 'pot:T:7'));
  eq(svc.settleHand('T', 8, 'chips', { committed: {}, payouts: {}, returned: {} }).noop, true);
  booksOk(ledger);
});

t('settleHand rejects a non-conserving settlement and writes nothing', () => {
  const { svc, ledger } = env();
  for (const k of ['a', 'b']) { svc.ensureAccount(k); svc.buyIn(k, 'T', 1000, 'chips', 'chips', 'bi:' + k); }
  const id = ledger.lastId;
  const s = (c, p, r) => () => svc.settleHand('T', 1, 'chips', { committed: c, payouts: p, returned: r });
  throwsCode(s({ a: 100, b: 100 }, { a: 201 }, {}), 'not_conserved');     // mints 1
  throwsCode(s({ a: 100, b: 100 }, { a: 199 }, {}), 'not_conserved');     // burns 1
  throwsCode(s({ a: 100, b: 100 }, { a: 100 }, { b: 99 }), 'not_conserved');
  throwsCode(s({ a: 100 }, { a: -5, b: 105 }, {}), 'bad_amount');
  throwsCode(s({ a: 100.5, b: 100 }, { a: 200.5 }, {}), 'bad_amount');
  throwsCode(s({ a: NaN }, {}, {}), 'bad_amount');
  throwsCode(s({ a: 5000 }, { a: 5000 }, {}), 'insufficient');             // committed more than the seat holds
  throwsCode(() => svc.settleHand('T', 'x:y', 'chips', { committed: { a: 1 }, payouts: { a: 1 } }), 'bad_hand');
  eq(ledger.lastId, id, 'nothing written'); eq(ledger.balance('seat:T:a', 'chips'), 1000);
  ok(!ledger.has('hand:T:1'));
});

t('a kicked seat cashes out its stack only; committed is settled by the hand batch (N1)', () => {
  const { svc, ledger } = env();
  for (const k of ['a', 'b', 'c']) { svc.ensureAccount(k); svc.buyIn(k, 'T', 1000, 'chips', 'chips', 'bi:' + k); }
  // hand in progress (engine tracks bets in memory only): b has committed 400 of 1000 and is kicked, stack 600
  svc.cashOut('b', 'T', 600, 'chips', 'chips', 'co:b:kick');
  eq(ledger.balance('bank:b', 'chips'), START_CHIPS - 1000 + 600);
  eq(ledger.balance('seat:T:b', 'chips'), 400, 'the committed part stays in the seat');
  // the hand finishes: a wins. b's committed is in `committed`, b gets nothing back
  svc.settleHand('T', 1, 'chips', { committed: { a: 400, b: 400, c: 400 }, payouts: { a: 1200 }, returned: {} });
  eq(ledger.balance('seat:T:b', 'chips'), 0, 'seat drained by the batch, nothing left behind');
  eq(ledger.balance('seat:T:a', 'chips'), 1800); eq(ledger.balance('seat:T:c', 'chips'), 600);
  eq(ledger.balance('bank:b', 'chips'), START_CHIPS - 400, 'b lost exactly what b committed');
  // had the settlement lost track of b's bet it could not conserve
  throwsCode(() => svc.settleHand('T', 2, 'chips', { committed: { a: 100, c: 100 }, payouts: { a: 300 }, returned: {} }), 'not_conserved');
  booksOk(ledger);
  const ns = svc.nightSummary('T');
  eq(ns.perKey.b.net, -400); eq(ns.perKey.a.open, 1800); ok(ns.zeroSum, 'night is zero-sum with open seats');
});

t('a seat that left mid-hand and WON cannot be paid out below zero', () => {
  // cashing out stack AND committed first would leave the batch short: the ledger refuses instead of clamping
  const { svc, ledger } = env();
  for (const k of ['a', 'b']) { svc.ensureAccount(k); svc.buyIn(k, 'T', 1000, 'chips', 'chips', 'bi:' + k); }
  svc.cashOut('a', 'T', 1000, 'chips', 'chips', 'co:a');       // wrong: took the committed part too
  throwsCode(() => svc.settleHand('T', 1, 'chips', { committed: { a: 400, b: 400 }, payouts: { b: 800 } }), 'insufficient');
  eq(ledger.balance('seat:T:b', 'chips'), 1000);
});

t('bootRecover after a crash mid-hand returns everything, idempotent on a second boot', () => {
  const e = env();
  const { svc, ledger } = e;
  const keys = ['a', 'b', 'c', 'd'];
  for (const k of keys) svc.ensureAccount(k);
  const start = {}; for (const k of keys) start[k] = svc.balances(k);
  const total0 = totals(ledger);
  svc.buyIn('a', 'CT', 2000, 'chips', 'chips', 'bi:a');
  svc.buyIn('b', 'CT', 2500, 'chips', 'play', 'bi:b');       // chips seat funded from Play $
  svc.buyIn('c', 'PT', 4000, 'play', 'play', 'bi:c');
  svc.buyIn('d', 'PT', 3000, 'play', 'chips', 'bi:d');       // Play seat funded from the bank
  // one finished hand, then the process dies mid-hand: bets were in memory only, so the ledger holds just the stacks
  svc.settleHand('CT', 1, 'chips', { committed: { a: 100, b: 100 }, payouts: { a: 200 }, returned: {} });
  ledger.close();
  const e2 = env(e.f);                                   // reboot: reload from the file
  const rep = e2.svc.bootRecover('boot-1');
  eq(rep.errors.length, 0); eq(rep.seats.length, 4);
  eq(e2.ledger.list('seat:', 'chips').length + e2.ledger.list('seat:', 'play').length, 0, 'no seat money left');
  eq(e2.ledger.balance('bank:a', 'chips'), START_CHIPS + 100, 'a won 100 and is back in the bank');
  eq(e2.ledger.balance('play:b', 'play'), START_PLAY - 100, 'b was funded from Play $ and returns to Play $ with the loss');
  eq(e2.ledger.balance('bank:b', 'chips'), START_CHIPS);
  eq(e2.ledger.balance('play:c', 'play'), START_PLAY); eq(e2.ledger.balance('bank:d', 'chips'), START_CHIPS); eq(e2.ledger.balance('play:d', 'play'), START_PLAY);
  const t1 = totals(e2.ledger);
  eq(t1.chips + t1.play, total0.chips + total0.play, 'nothing minted or lost');
  booksOk(e2.ledger);
  const before = JSON.stringify([e2.ledger.list('', 'chips'), e2.ledger.list('', 'play')]); const id = e2.ledger.lastId;
  const rep2 = e2.svc.bootRecover('boot-2');
  eq(rep2.seats.length, 0); eq(e2.ledger.lastId, id, 'second boot writes nothing');
  const rep3 = e2.svc.bootRecover('boot-1');             // same bootId again (crash during boot, boot again)
  eq(rep3.seats.length, 0);
  eq(JSON.stringify([e2.ledger.list('', 'chips'), e2.ledger.list('', 'play')]), before);
  // fund survives a restart: it is read from the ledger, not from memory
  e2.svc.buyIn('b', 'CT', 500, 'chips', 'play', 'bi:b2'); e2.ledger.close();
  const e3 = env(e.f); eq(e3.svc.seatFund('CT', 'b', 'chips'), 'play');
  e3.svc.bootRecover('boot-3'); eq(e3.ledger.balance('play:b', 'play'), START_PLAY - 100);
});

t('bootRecover: a crash half way through a boot is finished by the next boot', () => {
  const e = env(); const { svc, ledger } = e;
  for (const k of ['a', 'b']) { svc.ensureAccount(k); svc.buyIn(k, 'T', 1000, 'chips', k === 'a' ? 'chips' : 'play', 'bi:' + k); }
  // simulate: seat a was already swept under boot-1, then the process died before b
  ledger.transfer('seat:T:a', 'bank:a', 1000, 'chips', 'boot:chips', 'boot:boot-1:seat:T:a');
  ledger.close();
  const e2 = env(e.f); const rep = e2.svc.bootRecover('boot-1');
  eq(rep.seats.length, 1); eq(rep.seats[0].key, 'b'); eq(e2.ledger.balance('play:b', 'play'), START_PLAY);
  eq(e2.ledger.balance('bank:a', 'chips'), START_CHIPS);
});

t('bootRecover: a stray pot is refunded pro rata and reported as an error', () => {
  const { svc, ledger } = env();
  for (const k of ['a', 'b', 'c']) { svc.ensureAccount(k); svc.buyIn(k, 'T', 1000, 'chips', 'chips', 'bi:' + k); }
  // a hand batch can never leave a pot behind, so build one by hand: contributions 300/200/100, pot pays out 1 less
  ledger.batch([
    { from: 'seat:T:a', to: 'pot:T:5', amount: 300, cur: 'chips' },
    { from: 'seat:T:b', to: 'pot:T:5', amount: 200, cur: 'chips' },
    { from: 'seat:T:c', to: 'pot:T:5', amount: 100, cur: 'chips' },
    { from: 'pot:T:5', to: 'seat:T:c', amount: 1, cur: 'chips' },
  ], 'bad-hand', 'hand');
  eq(ledger.balance('pot:T:5', 'chips'), 599);
  const total0 = totals(ledger);
  const rep = svc.bootRecover('b1');
  ok(rep.errors.some(x => x.code === 'stray_pot'), 'logged as an error'); eq(rep.pots.length, 1);
  const refunded = rep.pots[0].refunded.reduce((x, r) => x + r.amount, 0); eq(refunded, 599, 'all of the pot goes back');
  const by = {}; for (const r of rep.pots[0].refunded) by[r.seat] = r.amount;
  ok(by['seat:T:a'] > by['seat:T:b'] && by['seat:T:b'] > by['seat:T:c'], 'pro rata order');
  eq(ledger.balance('pot:T:5', 'chips'), 0);
  eq(ledger.list('seat:', 'chips').length, 0, 'seats swept too');
  eq(totals(ledger).chips, total0.chips); booksOk(ledger);
  eq(svc.bootRecover('b2').seats.length, 0);
});

t('topUpEligible sees seat money (H7) and the cooldown', () => {
  const { svc, ledger } = env();
  svc.ensureAccount('a');
  eq(svc.topUpEligible('a').eligible, false); eq(svc.topUpEligible('a').why, 'not_needed');
  svc.buyIn('a', 'PT', START_PLAY - 5000, 'play', 'play', 'bi1');      // wallet 5,000 (< 10,000), seat 995,000
  let e = svc.topUpEligible('a');
  eq(e.wallet, 5000); eq(e.seats, START_PLAY - 5000); eq(e.total, START_PLAY); eq(e.eligible, false, 'H7: seat money counts');
  throwsCode(() => svc.topUp('a', 'tu0'), 'not_needed');
  // lose it at the table: cash out 50, rest lost to b
  svc.ensureAccount('b'); svc.buyIn('b', 'PT', 1000, 'play', 'play', 'bi2');
  svc.settleHand('PT', 1, 'play', { committed: { a: START_PLAY - 5050, b: 1000 }, payouts: { b: START_PLAY - 5050 + 1000 }, returned: {} });
  svc.cashOut('a', 'PT', 50, 'play', 'play', 'co1');
  e = svc.topUpEligible('a'); eq(e.total, 5000 + 50); eq(e.eligible, true);
  const before = totals(ledger);
  const r = svc.topUp('a', 'tu1'); eq(r.dup, false);
  eq(svc.balances('a').play, START_PLAY - 0, 'back to START_PLAY');
  eq(ledger.balance('mint:topup', 'play'), -(START_PLAY - 5050));
  eq(svc.topUp('a', 'tu1').dup, true, 'retry with the same ref'); eq(totals(ledger).play, before.play + START_PLAY - 5050);
  // spend it, and the cooldown (1h) blocks an immediate second top-up
  svc.buyIn('a', 'PT', START_PLAY, 'play', 'play', 'bi3');
  e = svc.topUpEligible('a'); eq(e.total, START_PLAY, 'seat money still counts'); eq(e.eligible, false);
  svc.settleHand('PT', 2, 'play', { committed: { a: START_PLAY }, payouts: { b: START_PLAY }, returned: {} });
  e = svc.topUpEligible('a'); eq(e.total, 0); eq(e.eligible, false); eq(e.why, 'cooldown'); ok(e.retryMs > 0 && e.retryMs <= 3600000);
  throwsCode(() => svc.topUp('a', 'tu2'), 'cooldown');
  clock += 3600001;
  eq(svc.topUpEligible('a').eligible, true); svc.topUp('a', 'tu2'); eq(svc.balances('a').play, START_PLAY);
  booksOk(ledger);
});

t('mint, house and admin operations', () => {
  const { svc, ledger } = env();
  svc.ensureAccount('a');
  svc.mint('bonus', 'a', 500, 'chips', 'bon1'); svc.mint('achv', 'a', 20, 'play', 'ach1'); svc.mint('topup', 'a', 5, 'play', 'tu');
  eq(ledger.balance('bank:a', 'chips'), START_CHIPS + 500); eq(ledger.balance('mint:achv', 'play'), -20);
  eq(svc.mint('bonus', 'a', 500, 'chips', 'bon1').dup, true); eq(ledger.balance('bank:a', 'chips'), START_CHIPS + 500);
  throwsCode(() => svc.mint('signup', 'a', 5, 'chips', 'x'), 'bad_kind');
  throwsCode(() => svc.mint('bonus', 'a', 0, 'chips', 'x'), 'bad_amount');
  svc.houseSpend('bender', 'a', 300, 'play', 'bd1'); svc.houseCredit('bender', 'a', 1000, 'play', 'bd2'); svc.houseCredit('coldcall', 'a', 50, 'chips', 'cc1');
  eq(ledger.balance('house:bender', 'play'), 300 - 1000, 'house may go negative');
  throwsCode(() => svc.houseSpend('roulette', 'a', 1, 'play', 'x'), 'bad_game');
  throwsCode(() => svc.houseSpend('bender', 'a', START_PLAY * 2, 'play', 'x2'), 'insufficient');
  svc.adminAdjust('a', 250, 'chips', 'gift', 'adm1'); svc.adminAdjust('a', -100, 'chips', 'oops', 'adm2');
  eq(ledger.balance('bank:a', 'chips'), START_CHIPS + 500 + 50 + 250 - 100);
  throwsCode(() => svc.adminAdjust('a', -(START_CHIPS * 5), 'chips', 'too much', 'adm3'), 'insufficient');
  throwsCode(() => svc.adminAdjust('a', 0, 'chips', 'zero', 'adm4'), 'bad_amount');
  throwsCode(() => svc.adminAdjust('a', 1.5, 'chips', 'frac', 'adm5'), 'bad_amount');
  throwsCode(() => svc.adminAdjust('a', 5, 'chips', '  ', 'adm6'), 'bad_reason');
  const e = [...ledger.entries(x => x.ref === 'adm2')][0]; eq(e.reason, 'admin:oops');
  booksOk(ledger);
});

t('adminAdjust cannot see or move seat money (H5): the seat is untouched', () => {
  const { svc, ledger } = env();
  svc.ensureAccount('a'); svc.buyIn('a', 'T', 3000, 'chips', 'chips', 'bi');
  svc.adminAdjust('a', 1, 'chips', 'x', 'adm');
  eq(ledger.balance('seat:T:a', 'chips'), 3000); eq(svc.balances('a').atTable.chips, 3000);
  throwsCode(() => svc.adminAdjust('a', -(START_CHIPS - 3000 + 2), 'chips', 'x', 'adm2'), 'insufficient');
});

t('mirror folds open seats and orphans into the old file shapes', () => {
  const { svc, ledger } = env();
  svc.ensureAccount('a'); svc.ensureAccount('b');
  svc.buyIn('a', 'CT', 1000, 'chips', 'chips', 'b1'); svc.buyIn('b', 'PT', 400, 'play', 'play', 'b2');
  svc.buyIn('b', 'CT', 10000, 'chips', 'chips', 'b3');          // drains b's bank to 0: must still appear
  ledger.transfer('mint:migration', 'orphan:dial-up', 77, 'chips', 'migration', 'mig:orphan');
  const m = svc.mirror();
  eq(m.bank.a, START_CHIPS); eq(m.bank.b, START_CHIPS);        // bank + chips seat = unchanged
  eq(m.wallet.b, START_PLAY); eq(m.wallet.a, START_PLAY);
  eq(m.bank['dial-up'], 77);
  svc.cashOut('b', 'CT', 10000, 'chips', 'chips', 'c3'); svc.buyIn('b', 'CT', 10000, 'chips', 'chips', 'b4');
  eq(svc.mirror().bank.b, START_CHIPS);
  const sum = (o) => Object.values(o).reduce((x, y) => x + y, 0);
  eq(sum(m.bank), totals(ledger).chips); eq(sum(m.wallet), totals(ledger).play);
});

t('mirror keeps a zero balance (the old server would mint 10,000 for a missing row)', () => {
  const { svc } = env();
  svc.ensureAccount('a'); svc.adminAdjust('a', -START_CHIPS, 'chips', 'drain', 'adm');
  const m = svc.mirror(); eq(m.bank.a, 0); ok(Object.prototype.hasOwnProperty.call(m.bank, 'a'));
});

t('nightSummary: buy-ins, cash-outs, net, zero-sum, survives restart and a recovery', () => {
  const e = env(); const { svc } = e;
  for (const k of ['a', 'b', 'c']) svc.ensureAccount(k);
  svc.buyIn('a', 'T', 1000, 'chips', 'chips', 'bi:a'); svc.buyIn('b', 'T', 1000, 'chips', 'play', 'bi:b'); svc.buyIn('c', 'T', 1000, 'chips', 'chips', 'bi:c');
  svc.buyIn('a', 'T', 500, 'chips', 'chips', 'bi:a2');                                  // rebuy
  svc.buyIn('a', 'OTHER', 700, 'chips', 'chips', 'bi:other');                           // another table, not counted
  svc.settleHand('T', 1, 'chips', { committed: { a: 1000, b: 1000, c: 500 }, payouts: { a: 2500 }, returned: {} });
  svc.settleHand('T', 2, 'chips', { committed: { a: 100, c: 100 }, payouts: { c: 200 }, returned: {} });
  svc.cashOut('a', 'T', 2000, 'chips', 'chips', 'co:a');
  let ns = svc.nightSummary('T');
  eq(ns.perKey.a.buyIn, 1500); eq(ns.perKey.a.cashOut, 2000); eq(ns.perKey.a.open, 900); eq(ns.perKey.a.net, 1400);
  eq(ns.perKey.b.net, -1000); eq(ns.perKey.c.net, -400);
  eq(ns.perKey.b.buyIn, 1000); ok(ns.zeroSum, 'zero-sum while seats are open');
  e.ledger.close();
  const e2 = env(e.f);
  e2.svc.bootRecover('boot');                                                           // everyone is swept
  ns = e2.svc.nightSummary('T');
  ok(ns.zeroSum, 'zero-sum after recovery'); eq(ns.sum, 0);
  for (const k of ['a', 'b', 'c']) eq(ns.perKey[k].open, 0);
  eq(ns.perKey.a.net, 1400); eq(ns.perKey.b.net, -1000); eq(ns.perKey.c.net, -400);
  ok(!('a' in e2.svc.nightSummary('NOPE').perKey));
  // net matches what the accounts actually gained at this table
  eq(e2.ledger.balance('bank:a', 'chips') - START_CHIPS, 1400, 'the other table round-trips and is not in this net');
});

t('balances(): everything a key holds', () => {
  const { svc } = env();
  svc.ensureAccount('a'); svc.buyIn('a', 'CT', 100, 'chips', 'chips', 'x'); svc.buyIn('a', 'PT', 40, 'play', 'play', 'y');
  const b = svc.balances('a');
  eq(b.chips, START_CHIPS - 100); eq(b.play, START_PLAY - 40); eq(b.atTable.chips, 100); eq(b.atTable.play, 40); eq(b.seats.length, 2);
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`money-service: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
