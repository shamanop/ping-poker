'use strict';
// tables/viewlog.js: the old presentation rows and the legacy room view, driven by real tables through the registry.
const fs = require('fs');
const path = require('path');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createMoneyPort } = require('../../tables/money-port');
const { createRegistry } = require('../../tables/registry');
const { createViewlog } = require('../../tables/viewlog');
const { createLedger } = require('../../ledger');
const { rigDeck } = require('./engine-lib');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };

const dir = fs.mkdtempSync(path.join(__dirname, '..', '..', 'tables', 'runs', 'vl-'));
let n = 0;
function fakeClock() {
  let now = 1700000000000, id = 0; const timers = new Map();
  return { now: () => now, setTimeout: (fn, ms) => { const h = ++id; timers.set(h, { at: now + ms, fn }); return h; }, clearTimeout: h => { timers.delete(h); },
    advance(ms) { const end = now + ms; for (;;) { let b = null; for (const [h, x] of timers) if (x.at <= end && (!b || x.at < b[1].at)) b = [h, x]; if (!b) break; timers.delete(b[0]); now = Math.max(now, b[1].at); b[1].fn(); } now = end; } };
}
function env() {
  n++;
  const ledger = open(path.join(dir, 'm' + n + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  const pres = createLedger({ file: path.join(dir, 'p' + n + '.json') });
  const calls = { hand: [], nights: [], rooms: [] }, decks = [];
  const bankOf = k => ledger.balance('bank:' + k, 'chips');
  let vl = null;
  const port = createMoneyPort({ service, ledger, bootId: 'bt', onWrite: w => vl.onWrite(w) });
  for (const k of ['ann', 'bob']) service.ensureAccount(k);
  const clock = fakeClock();
  let reg = null;
  vl = createViewlog({ presLedger: pres, bankOf, profileOf: k => ({ display: k.toUpperCase() }), nightNets: tb => reg.nightOf(tb),
    accounts: { recordHand: (k, x) => calls.hand.push([k, x]), recordNight: (k, x) => calls.nights.push([k, x]) }, social: { onHandEnd: r => { if (calls.boom) throw new Error('social down'); calls.rooms.push(r); } } });
  reg = createRegistry({ money: port, service, ledger, clock, file: path.join(dir, 't' + n + '.json'), viewlog: vl, deckSource: () => decks.shift() || null, hooks: { profileOf: k => ({ display: k.toUpperCase() }) } });
  reg.load();
  return { reg, pres, calls, decks, clock, ledger, rows: () => pres.entries().filter(r => r.type !== 'bank-start') };
}
const SET = { name: 'VL', mode: 'chips', buyIn: { min: 100, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 }, seats: 6 };
const heads = e => { const tb = e.reg.create('ann', SET); e.decks.push(rigDeck([['As', 'Ad'], ['Ks', 'Kd']], ['2c', '7d', 'Jh', '3s', '4d'])); tb.sit('ann', { amount: 2000, socketId: 'a' }); tb.sit('bob', { amount: 2000, socketId: 'b' }); return tb; };

t('buy-in and rebuy rows carry mode, table, night, key, bank balance after', () => {
  const e = new Object(env()); const tb = e.reg.create('ann', SET); tb.sit('ann', { amount: 2000, socketId: 'a' });
  const r = e.rows()[0]; eq([r.type, r.name, r.amount, r.balanceAfter, r.tableChips, r.room], ['buyin', 'ANN', 2000, 8000, 2000, tb.id]);
  eq([r.mode, r.tableId, r.nightId, r.key], ['chips', tb.id, tb.nightId, 'ann']);
  const s = tb.seatOfKey('ann'); e.reg.out; tb.money.cashOut(tb, 'ann', 2000, 'leave'); s.stack = 0; tb.rebuy('ann', { amount: 500 });
  eq(e.rows().map(x => x.type), ['buyin', 'cashout', 'rebuy']);
});
t('leave / kick / grace / night cash-outs become cashout rows with the reason; grace is parked', () => {
  const e = env(); const tb = e.reg.create('ann', SET); tb.sit('ann', { amount: 1000, socketId: 'a' }); tb.sit('bob', { amount: 1000, socketId: 'b' });
  tb.kick('ann', 'bob'); tb.disconnect('a'); e.clock.advance(125000); tb.sit('bob', { amount: 700, socketId: 'b2' }); tb.endNight('host');
  const c = e.rows().filter(r => r.type === 'cashout'); eq(c.map(r => [r.key, r.amount, r.reason, !!r.park]), [['bob', 1000, 'kick', false], ['ann', 1000, 'grace', true], ['bob', 700, 'night', false]]);
});
t('a hand writes a snapshot plus win/loss rows, calls social.onHandEnd and recordHand with the legacy room view', () => {
  const e = env(); const tb = heads(e); tb.startHand(); tb.act(tb.seats.get(tb.hand.toAct).key, { type: 'raise', to: 2000 }); tb.act(tb.seats.get(tb.hand.toAct).key, { type: 'call' }); e.clock.advance(1500 * 3 + 1);
  const types = e.rows().map(r => r.type); ok(types.includes('snapshot')); const w = e.rows().filter(r => r.type === 'win' || r.type === 'loss');
  eq(w.map(r => [r.name, r.type, r.amount]).sort(), [['ANN', 'win', 2000], ['BOB', 'loss', 2000]]); ok(w.every(r => r.nightId === tb.nightId && r.mode === 'chips'));
  eq(e.calls.rooms.length, 1); const room = e.calls.rooms[0]; eq([room.id, room.bb, room.unit, room.nightId], [tb.id, 50, 'chips', tb.nightId]);
  eq(room.players.map(p => [p.acct, p.handStartChips, p.chips, p.handBet, p.winHand]).sort(), [['ann', 2000, 4000, 2000, 'Pair'], ['bob', 2000, 0, 2000, undefined]]);
  eq(e.calls.hand.map(c => [c[0], c[1].won, c[1].pot]).sort(), [['ann', true, 4000], ['bob', false, 4000]]);
});
t('night end writes a night-end row and records each player night net', () => {
  const e = env(); const tb = heads(e); tb.startHand(); tb.act(tb.seats.get(tb.hand.toAct).key, { type: 'raise', to: 2000 }); tb.act(tb.seats.get(tb.hand.toAct).key, { type: 'call' }); e.clock.advance(1500 * 3 + 1);
  tb.endNight('host'); const ne = e.rows().filter(r => r.type === 'night-end'); eq(ne.length, 1); eq([ne[0].nightId, ne[0].reason, ne[0].tableName], [tb.nightId, 'host', 'VL']);
  eq(e.calls.nights.map(c => [c[0], c[1].net]).sort(), [['ann', 2000], ['bob', -2000]]);
  const sum = e.pres.nightSummary(tb.nightId); eq(sum.players.map(p => p.net).sort((a, b) => a - b), [-2000, 2000]); eq(sum.zeroSum, true); eq(sum.ended, true);
});
t('a failing social hook never breaks the hand', () => {
  const e = env(); const tb = heads(e); e.calls.boom = true; const oe = console.error; console.error = () => {};
  tb.startHand(); tb.act(tb.seats.get(tb.hand.toAct).key, { type: 'raise', to: 2000 }); tb.act(tb.seats.get(tb.hand.toAct).key, { type: 'call' }); e.clock.advance(1500 * 3 + 1);
  console.error = oe; eq(tb.phase, 'between'); ok(e.ledger.has('hand:' + tb.id + ':1')); eq(tb.hasDeadline('phase'), true); eq(e.calls.rooms.length, 0);
});

console.log(`tables-viewlog.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
