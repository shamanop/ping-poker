'use strict';
// tables/money-port.js tests against a real money.open() on a temp file. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createMoneyPort } = require('../../tables/money-port');
const { TableError } = require('../../tables/errors');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
function throwsTable(fn, code) {
  try { fn(); } catch (e) { if (e instanceof TableError && e.code === code) return e; throw new Error('wanted ' + code + ', got ' + (e && (e.code || e.message))); }
  throw new Error('did not throw ' + code);
}

const dir = fs.mkdtempSync(path.join(process.env.TABLES_TMP || path.join(__dirname, '..', '..', 'tables', 'runs'), 'mp-'));
let n = 0;
function env(extra) {
  const file = path.join(dir, 'm' + (++n) + '.jsonl');
  const ledger = open(file, { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  const touched = [], fences = [];
  const port = createMoneyPort({ service, ledger, bootId: 'bt', afterWrite: k => touched.push(k.join(',')), onFence: e => fences.push(e.code), ...(extra || {}) });
  for (const k of ['ann', 'bob']) service.ensureAccount(k);
  return { file, ledger, service, port, touched, fences, T: { id: 'T1', cur: 'chips' }, P: { id: 'P1', cur: 'play' } };
}
const invariant = e => { const c = e.ledger.check(); ok(c.chips.ok && c.play.ok, 'books do not balance'); };

t('buyIn moves bank to seat, fires afterWrite once', () => {
  const e = env(); const r = e.port.buyIn(e.T, 'ann', 2000, null);
  ok(!r.dup); eq(e.ledger.balance('bank:ann', 'chips'), 8000); eq(e.port.seatBalance(e.T, 'ann'), 2000); eq(e.touched, ['ann']); invariant(e);
});
t('refs are kind:table:key:boot.n and unique per intent', () => {
  const e = env(); const a = e.port.intent('buyin', e.T, 'ann', 1), b = e.port.intent('buyin', e.T, 'ann', 1);
  ok(/^buyin:T1:ann:bt\.\d+$/.test(a.ref), a.ref); ok(a.ref !== b.ref);
});
t('retrying the same intent answers dup and pays once, no second afterWrite', () => {
  const e = env(); const first = e.port.buyIn(e.T, 'ann', 500, null);
  const again = e.port.buyIn(e.T, 'ann', 500, null, first.intent);
  ok(again.dup); eq(e.port.seatBalance(e.T, 'ann'), 500); eq(e.touched.length, 1); invariant(e);
});
t('a new intent is a new buy-in', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 500, null); e.port.buyIn(e.T, 'ann', 500, null);
  eq(e.port.seatBalance(e.T, 'ann'), 1000);
});
t('insufficient is mapped to code bank with fund, have, need', () => {
  const e = env(); const x = throwsTable(() => e.port.buyIn(e.T, 'ann', 10001, null), 'bank');
  eq(x.details, { fund: 'chips', have: 10000, need: 10001 }); eq(e.port.seatBalance(e.T, 'ann'), 0);
  const y = throwsTable(() => e.port.buyIn(e.T, 'ann', 1000001, 'play'), 'bank'); eq(y.details.fund, 'play');
});
t('Play fund into a chips table: one batch through fx, seat fund is play', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 700, 'play');
  eq(e.ledger.balance('play:ann', 'play'), 1000000 - 700); eq(e.port.seatBalance(e.T, 'ann'), 700); eq(e.port.seatFund(e.T, 'ann'), 'play'); invariant(e);
});
t('wrong fund while chips sit at the seat throws fund_mismatch and writes nothing', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 700, 'play'); const before = e.ledger.lastId;
  throwsTable(() => e.port.buyIn(e.T, 'ann', 100, 'chips'), 'fund_mismatch'); eq(e.ledger.lastId, before);
});
t('a 0 seat may switch fund', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 700, 'play'); e.port.sweep(e.T, 'ann'); e.port.buyIn(e.T, 'ann', 100, 'chips');
  eq(e.port.seatFund(e.T, 'ann'), 'chips'); invariant(e);
});
t('play table: chips fund goes through fx the other way', () => {
  const e = env(); e.port.buyIn(e.P, 'bob', 900, 'chips');
  eq(e.ledger.balance('bank:bob', 'chips'), 9100); eq(e.port.seatBalance(e.P, 'bob'), 900); eq(e.port.seatFund(e.P, 'bob'), 'chips'); invariant(e);
});
t('sweep returns the seat to its own fund, no-op at 0', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 700, 'play');
  const r = e.port.sweep(e.T, 'ann'); ok(!r.noop);
  eq(e.ledger.balance('play:ann', 'play'), 1000000); eq(e.ledger.balance('bank:ann', 'chips'), 10000); eq(e.port.seatBalance(e.T, 'ann'), 0);
  ok(e.port.sweep(e.T, 'ann').noop); invariant(e);
});
t('leaveAmount = seat balance - committed, never below 0', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 2000, null);
  eq(e.port.leaveAmount(e.T, 'ann', 0), 2000); eq(e.port.leaveAmount(e.T, 'ann', 450), 1550); eq(e.port.leaveAmount(e.T, 'ann', 9999), 0);
});
t('N1: leaving mid-hand cashes out the stack only; the committed part stays until swept after the batch', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 2000, null);
  // hand start stack 2000, committed 500 (engine stack 1500 after the bet): leave cashes 1500, 500 stays
  e.port.leave(e.T, 'ann', 500, 'kick');
  eq(e.ledger.balance('bank:ann', 'chips'), 8000 + 1500); eq(e.port.seatBalance(e.T, 'ann'), 500);
  // the hand batch: ann lost the 500 to bob's pot; payouts to bob only
  e.port.buyIn(e.T, 'bob', 2000, null);
  e.port.settleHand(e.T, 7, { committed: { ann: 500, bob: 500 }, payouts: { bob: 1000 }, returned: {} });
  eq(e.port.seatBalance(e.T, 'ann'), 0); eq(e.port.seatBalance(e.T, 'bob'), 2500);
  ok(e.port.sweep(e.T, 'ann').noop, 'nothing left to sweep'); invariant(e);
});
t('E1 shape: a kicked top bettor gets an uncalled layer back in the batch and the sweep returns it', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 2000, null); e.port.buyIn(e.T, 'bob', 2000, null);
  e.port.leave(e.T, 'ann', 500, 'kick');
  e.port.settleHand(e.T, 1, { committed: { ann: 500, bob: 50 }, payouts: { bob: 100 }, returned: { ann: 450 } });
  eq(e.port.seatBalance(e.T, 'ann'), 450);
  e.port.sweep(e.T, 'ann'); eq(e.ledger.balance('bank:ann', 'chips'), 10000 - 500 + 450); invariant(e);
});
t('settleHand is one ledger line, idempotent by hand ref, not_conserved writes nothing', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 1000, null); e.port.buyIn(e.T, 'bob', 1000, null);
  const maps = { committed: { ann: 100, bob: 100 }, payouts: { ann: 200 }, returned: {} };
  const s0 = e.ledger.lastId; const r = e.port.settleHand(e.T, 3, maps); ok(!r.dup); eq(e.ledger.lastId, s0 + 1);
  ok(e.port.settleHand(e.T, 3, maps).dup); eq(e.ledger.lastId, s0 + 1);
  let thrown = null; try { e.port.settleHand(e.T, 4, { committed: { ann: 100 }, payouts: { ann: 99 }, returned: {} }); } catch (x) { thrown = x; }
  ok(thrown && thrown.code === 'not_conserved'); eq(e.ledger.lastId, s0 + 1); invariant(e);
});
t('buyInCount counts buy-ins since a ledger id and survives a reopen', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 500, null); const mark = e.ledger.lastId;
  e.port.buyIn(e.T, 'ann', 500, null); e.port.buyIn(e.T, 'ann', 500, 'play'.replace('play', 'chips'));
  eq(e.port.buyInCount(e.T, 'ann', 0), 3); eq(e.port.buyInCount(e.T, 'ann', mark), 2); eq(e.port.buyInCount(e.T, 'bob', 0), 0); eq(e.port.buyInCount(e.P, 'ann', 0), 0);
  e.ledger.close();
  const l2 = open(e.file, { fsync: 'none', log: () => {} }); const p2 = createMoneyPort({ service: createService(l2), ledger: l2, bootId: 'b2' });
  eq(p2.buyInCount(e.T, 'ann', 0), 3);
});
t('buyInCount counts a Play-funded buy-in once (batch has two legs)', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 500, 'play'); eq(e.port.buyInCount(e.T, 'ann', 0), 1);
});
t('lastHandNo is the highest settled hand of THAT table, 0 if none, and survives a reopen', () => {
  const e = env(); eq(e.port.lastHandNo('T1'), 0);
  e.port.buyIn(e.T, 'ann', 1000, null); e.port.buyIn(e.T, 'bob', 1000, null);
  for (const h of [1, 2, 10]) e.port.settleHand(e.T, h, { committed: { ann: 10, bob: 10 }, payouts: { bob: 20 }, returned: {} });
  e.port.buyIn(e.P, 'ann', 500, 'chips'); e.port.buyIn(e.P, 'bob', 500, 'chips');
  e.port.settleHand(e.P, 99, { committed: { ann: 10, bob: 10 }, payouts: { bob: 20 }, returned: {} });
  eq(e.port.lastHandNo('T1'), 10); eq(e.port.lastHandNo('P1'), 99); eq(e.port.lastHandNo('T'), 0);
  e.ledger.close(); const l2 = open(e.file, { fsync: 'none', log: () => {} });
  eq(createMoneyPort({ service: createService(l2), ledger: l2 }).lastHandNo('T1'), 10);
});
t('drift: clean when memory matches, reports each mismatch and strays', () => {
  const e = env(); e.port.buyIn(e.T, 'ann', 1000, null); e.port.buyIn(e.T, 'bob', 1000, null);
  eq(e.port.drift(e.T, [{ key: 'ann', stack: 900, handBet: 100 }, { key: 'bob', stack: 1000 }]), []);
  const d = e.port.drift(e.T, [{ key: 'ann', stack: 1000 }]);
  eq(d.map(x => [x.account, x.ledger, x.memory]), [['seat:T1:bob', 1000, 0]]);
  const d2 = e.port.drift(e.T, [{ key: 'ann', stack: 999 }, { key: 'bob', stack: 1000 }]); eq(d2.length, 1); eq(d2[0].ledger, 1000); eq(d2[0].memory, 999);
});
t('a fenced ledger maps to money_down and calls onFence', () => {
  const e = env(); e.ledger.close();
  throwsTable(() => e.port.buyIn(e.T, 'ann', 100, null), 'money_down'); ok(e.fences.length === 1, 'onFence called ' + e.fences.length);
});
t('afterWrite throwing does not break the money call', () => {
  const e = env({ afterWrite: () => { throw new Error('boom'); } });
  const o = console.error; console.error = () => {}; try { e.port.buyIn(e.T, 'ann', 100, null); } finally { console.error = o; }
  eq(e.port.seatBalance(e.T, 'ann'), 100);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
