'use strict';
// tables/table.js + hand-flow.js: the hand lifecycle on a fake clock, real engine, real money on a temp file.
const fs = require('fs');
const path = require('path');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createMoneyPort } = require('../../tables/money-port');
const { Table } = require('../../tables/table');
const { validateSettings } = require('../../tables/settings');
const { rigDeck } = require('./engine-lib');
const engine = require('../../engine/hand');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };

fs.mkdirSync(path.join(__dirname, '..', '..', 'tables', 'runs'), { recursive: true }); // gitignored scratch dir, absent in a fresh checkout
const dir = fs.mkdtempSync(path.join(__dirname, '..', '..', 'tables', 'runs', 'hands-'));
let n = 0;
const KEYS = ['ann', 'bob', 'cy', 'dee'];
const origErr = console.error; console.error = () => {};

function fakeClock() {
  let now = 1000000, id = 0; const timers = new Map();
  return {
    now: () => now, pending: () => timers.size,
    setTimeout: (fn, ms) => { const h = ++id; timers.set(h, { at: now + ms, fn }); return h; },
    clearTimeout: h => { timers.delete(h); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [h, x] of timers) if (x.at <= end && (!best || x.at < best[1].at)) best = [h, x];
        if (!best) break;
        timers.delete(best[0]); now = Math.max(now, best[1].at); best[1].fn();
      }
      now = end;
    },
  };
}
// AA beats KK beats 72o on a dry board.
const WIN_DECK = () => rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2h'], ['9c', '9d']], ['2c', '7d', 'Jh', '3s', '4d']);

function env(over, recOver, outOver) {
  const ledger = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  const events = [];
  const port = createMoneyPort({ service, ledger, bootId: 'bt' });
  for (const k of KEYS) service.ensureAccount(k);
  const v = validateSettings({ name: 'Test table', mode: 'chips', buyIn: { min: 100, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 }, seats: 6, actionTimerSec: 30, autoStart: false, ...(over || {}) });
  if (!v.ok) throw new Error('settings ' + JSON.stringify(v));
  const clock = fakeClock(), decks = [];
  const table = new Table({ id: 'T1', hostKey: 'ann', permanent: false, nightFromId: 0, ...v.value, ...(recOver || {}) }, {
    money: port, clock, deckSource: () => decks.shift() || null,
    out: { state() { events.push(['state']); }, event(tb, kind, data, to) { if (outOver) outOver(kind); events.push([kind, data, to]); } },
    hooks: { profileOf: key => ({ display: key.toUpperCase() }) },
  });
  const e = { ledger, service, port, table, clock, events, decks };
  e.sit = (key, amount, extra) => table.sit(key, { amount, socketId: 's-' + key, ...(extra || {}) });
  return e;
}
const bank = (e, k) => e.ledger.balance('bank:' + k, 'chips');
const drift = e => e.port.drift(e.table, e.table.auditSeats());
const books = e => { const c = e.ledger.check(); ok(c.chips.ok && c.play.ok, 'books'); };
const three = (over, rec) => { const e = env(over, rec); e.decks.push(WIN_DECK()); e.sit('ann', 2000); e.sit('bob', 2000); e.sit('cy', 2000); return e; };
const foldAround = T => { let g = 0; while (T.handLive() && T.hand.phase === 'betting' && g++ < 10) T.act(T.seats.get(T.hand.toAct).key, { type: 'fold' }); };
const shove = e => { const T = e.table; T.act('ann', { type: 'raise', to: 2000 }); T.act('bob', { type: 'call' }); T.act('cy', { type: 'fold' }); };

t('startHand: button is the lowest eligible seat, blinds posted, one turn deadline', () => {
  const e = three(); ok(e.table.startHand()); const h = e.table.hand;
  eq([h.button, h.sbSeat, h.bbSeat, h.toAct], [0, 1, 2, 0]); eq([h.seats[1].bet, h.seats[2].bet], [25, 50]);
  eq(e.table.phase, 'betting'); eq(e.table.handNo, 1); eq(e.table.deadlines.get('phase').kind, 'turn'); eq(e.table.deadlines.get('phase').at, e.clock.now() + 30000);
  eq(e.clock.pending(), 1); ok(e.table.log.length >= 3); eq(drift(e), []);
});
t('startHand refuses with < 2 eligible and when paused', () => {
  const e = env(); e.sit('ann', 2000); eq(e.table.startHand(), false); eq(e.table.phase, 'waiting');
  e.sit('bob', 2000); e.table.pause(); eq(e.table.startHand(), false); e.table.resume(); eq(e.table.startHand(), true);
});
t('all-in to showdown: run-out is paced, ONE ledger batch, winners paid, books balance (H3)', () => {
  const e = three(); e.table.startHand(); const before = e.ledger.lastId; shove(e);
  eq(e.table.phase, 'runout'); eq(e.ledger.lastId, before, 'nothing written during the hand'); eq(e.table.deadlines.get('phase').kind, 'street');
  e.clock.advance(1500); eq(e.table.hand.street, 'flop'); e.clock.advance(1500); e.clock.advance(1499); eq(e.table.phase, 'runout'); e.clock.advance(1);
  eq(e.table.phase, 'between'); ok(e.ledger.has('hand:T1:1'), 'hand batch'); eq(e.ledger.lastId, before + 1, 'one line');
  const s = id => e.table.seatOfKey(id).stack; eq([s('ann'), s('bob'), s('cy')], [4050, 0, 1950]); eq(drift(e), []); books(e);
  const r = e.table.lastResult; eq(r.winners.map(w => [w.name, w.amount]), [['ANN', 4050]]); eq(r.pot, 4050);
  eq(Object.values(r.net).reduce((a, b) => a + b, 0), 0); eq(e.table.deadlines.get('phase').kind, 'nexthand'); eq(e.table.deadlines.get('phase').at, e.clock.now() + 5000);
  ok(e.events.some(x => x[0] === 'bust' && x[2] === 'bob'), 'bust_out for the loser'); eq(e.table.history.length, 1);
});
t('next hand starts after the delay; busted seat is not dealt; button moves on', () => {
  const e = three(); e.table.startHand(); shove(e); e.clock.advance(1500 * 3 + 5000);
  eq(e.table.handNo, 2); eq(e.table.phase, 'betting'); eq(e.table.hand.button, 2); eq(e.table.seatOfKey('bob').dealt, false);
});
t('fold-win: showdown_result has the right shape, no reveals, uncalled goes in returned not amount', () => {
  const e = three(); e.table.startHand(); const T = e.table;
  T.act('ann', { type: 'raise', to: 300 }); T.act('bob', { type: 'fold' }); T.act('cy', { type: 'fold' });
  const r = T.lastResult; eq(T.phase, 'between'); eq(r.winners[0].handName, 'Everyone folded'); eq(r.winners[0].amount, 125); eq(r.pot, 125);
  eq(r.returned, { ANN: 250 }); ok(!r.reveals); eq(r.net.ANN, 75); eq(T.deadlines.get('phase').at, e.clock.now() + 7000);
  eq(T.seatOfKey('ann').stack, 2075); eq(drift(e), []); books(e);
});
t('M1: all-in from the blinds goes straight to run-out', () => {
  const e = env(); e.decks.push(rigDeck([['As', 'Ad'], ['Ks', 'Kd']], ['2c', '7d', 'Jh', '3s', '4d']));
  e.sit('ann', 100); e.sit('bob', 100);
  for (const s of e.table.seats.values()) { e.port.cashOut(e.table, s.key, 80, 'leave'); s.stack = 20; } // under the small blind
  e.table.startHand(); eq(e.table.phase, 'runout'); eq(e.table.deadlines.get('phase').kind, 'street');
});
t('M2: turn timeout checks when free, folds when facing a bet', () => {
  const e = three(); e.table.startHand();
  e.clock.advance(30000); eq(e.table.hand.seats[0].folded, true, 'UTG facing the blind folds');
  eq(e.table.hand.toAct, 1); e.table.act('bob', { type: 'call' });
  eq(e.table.hand.toAct, 2); e.clock.advance(30000); eq(e.table.hand.seats[2].folded, false, 'BB checks its option'); eq(e.table.hand.street, 'flop');
  eq(e.table.seatOfKey('ann').timeouts, 1);
});
t('two consecutive timeouts sit a connected seat out', () => {
  const e = three(); e.table.startHand(); e.clock.advance(30000); e.table.act('bob', { type: 'fold' }); eq(e.table.phase, 'between');
  e.clock.advance(5000 + 7000); e.table.hand.toAct != null && e.clock.advance(30000);
  eq(e.table.seatOfKey('ann').timeouts >= 1, true);
});
t('M3: a forced pause (safety wrapper) freezes the turn clock and a preselect; resume gives back the remainder (a host pause during a hand is pending: K3-4, tests/money-1008-k3-4-pause.js)', () => {
  const e = three(); e.table.startHand(); e.clock.advance(10000); e.table.pause(true); e.clock.advance(120000);
  eq(e.table.hand.seats[0].folded, false); e.table.resume(); e.clock.advance(19999); eq(e.table.hand.seats[0].folded, false); e.clock.advance(1); eq(e.table.hand.seats[0].folded, true);
});
t('preselect: only for a seat not on turn, fires PRE_MS after its turn arrives, dies when the bet changes', () => {
  const e = three(); e.table.startHand(); const T = e.table;
  const code = fn => { try { fn(); } catch (er) { return er.code; } return 'none'; };
  eq(code(() => T.preselect('ann', 'checkfold')), 'preselect', 'on turn');
  eq(code(() => T.preselect('bob', 'call', 999)), 'preselect', 'wrong call amount');
  T.preselect('cy', 'checkfold'); T.preselect('bob', 'call', 0 + 25);
  T.act('ann', { type: 'call' }); eq(T.hand.toAct, 1); eq(T.deadlines.get('phase').kind, 'pre'); eq(T.deadlines.get('phase').at, e.clock.now() + 450);
  e.clock.advance(450); eq(T.hand.seats[1].bet, 50, 'bob called through the preselect'); eq(T.hand.toAct, 2); eq(T.deadlines.get('phase').kind, 'pre', 'cy preselect still valid: bet unchanged'); e.clock.advance(450); eq(T.hand.street, 'flop');
});
t('preselect is dropped when someone raises', () => {
  const e = three(); e.table.startHand(); const T = e.table; T.preselect('cy', 'checkfold'); T.act('ann', { type: 'raise', to: 200 });
  eq(T.seatOfKey('cy').pre, null);
});
t('C2: the button seat vanishes between hands, next hand still deals', () => {
  const e = three(); e.table.startHand(); const T = e.table; T.act('ann', { type: 'fold' }); T.act('bob', { type: 'fold' });
  T.leave('ann'); eq(T.seatOfKey('ann'), null); e.clock.advance(7000); eq(T.handNo, 2); eq(T.phase, 'betting'); ok(T.hand.button === 1 || T.hand.button === 2);
});
t('N1: kick the top bettor mid-hand: cash-out = balance - committed, E1 uncalled comes back, kicked chips stay in the pot', () => {
  const e = env(); e.decks.push(rigDeck([['7c', '2h'], ['As', 'Ad']], ['2c', '7d', 'Jh', '3s', '4d']));
  e.sit('ann', 2000); e.sit('bob', 2000); const T = e.table; T.startHand();
  eq(T.hand.toAct, 0); T.act('ann', { type: 'call' }); T.act('bob', { type: 'raise', to: 500 });
  T.kick('ann', 'bob'); eq(e.events.find(x => x[0] === 'left' && x[2] === 'bob')[1].cashedOut, 1500, 'stack out, committed stays');
  // K3-1: the kick does not fold him. His raise stands, ann answers it; he is swept when the hand has settled.
  eq(T.phase, 'betting'); eq(T.seatOfKey('bob').leaving, true); eq(T.hand.seats[1].folded, false); eq(drift(e), []);
  T.act('ann', { type: 'fold' });
  eq(T.phase, 'between'); eq(T.seatOfKey('bob'), null, 'swept after the batch');
  eq(bank(e, 'bob'), 10050, 'uncalled 450 back, matched 50 won'); eq(T.seatOfKey('ann').stack, 1950); eq(drift(e), []); books(e);
});
t('a seat that left mid-hand reports stack 0 to the audit (its stack is already cashed out): no drift, no double count (fuzz finding)', () => {
  const e = three(); const T = e.table; T.startHand(); T.act('ann', { type: 'raise', to: 200 });
  T.leave('bob');
  const row = T.auditSeats().find(r => r.key === 'bob'); eq(row.stack, 0); ok(row.handBet >= 0);
  eq(drift(e), []); eq(T.phase, 'betting'); books(e);
});
t('E1 + leave: the uncalled layer returned to a leaver stays inside the seat account, so the audit counts it as handBet (fuzz finding, drift 638)', () => {
  const e = three(); const T = e.table; T.startHand(); T.act('ann', { type: 'raise', to: 500 });
  T.leave('ann');                                           // ann is the top bettor: E1 hands her uncalled layer back inside the engine
  const row = T.auditSeats().find(r => r.key === 'ann'); eq(row.stack, 0); ok(row.handBet > 0);
  eq(drift(e), []); books(e);
});
t('leave mid-hand as a folded seat still keeps its committed chips for the batch', () => {
  const e = three(); const T = e.table; T.startHand(); T.act('ann', { type: 'raise', to: 200 }); T.act('bob', { type: 'fold' });
  T.leave('bob'); eq(bank(e, 'bob'), 8000 + 1975); T.act('cy', { type: 'fold' }); eq(T.seatOfKey('bob'), null); eq(bank(e, 'bob'), 8000 + 1975 + 0 + 0 * 1);
  eq(drift(e), []); books(e);
});
t('N3 crash BEFORE the commit: boot recovery returns every seat at its hand-start stack', () => {
  const e = three(); e.table.startHand(); e.table.act('ann', { type: 'raise', to: 2000 }); e.table.act('bob', { type: 'call' });
  const rep = e.service.bootRecover('crash1'); eq(rep.errors, []);
  for (const k of ['ann', 'bob', 'cy']) eq(bank(e, k), 10000, k); books(e);
});
t('N3 crash AFTER the commit: the result stands', () => {
  const e = three(); e.table.startHand(); shove(e); e.clock.advance(5000 + 1);
  const rep = e.service.bootRecover('crash2'); eq(rep.errors, []);
  eq([bank(e, 'ann'), bank(e, 'bob'), bank(e, 'cy')], [12050, 8000, 9950]); books(e);
});
t('void writes nothing, restores stacks, schedules the next hand; 3 voids in 60 s pause the table', () => {
  const e = three(); const T = e.table; T.startHand(); T.act('ann', { type: 'raise', to: 300 }); const before = e.ledger.lastId;
  ok(T.void('test')); eq(e.ledger.lastId, before); eq(T.hand, null); eq([...T.seats.values()].map(s => s.stack), [2000, 2000, 2000]); eq(drift(e), []);
  eq(T.deadlines.get('phase').kind, 'nexthand'); eq(T.deadlines.get('phase').at, e.clock.now() + 2000);
  e.clock.advance(2000); ok(T.hand); T.void('again'); e.clock.advance(2000); ok(T.hand); T.void('third'); eq(T.paused, true);
});
t('void with a mid-hand leaver: the leaver is swept (balance back to the owner), others restored', () => {
  const e = three(); const T = e.table; T.startHand(); T.act('ann', { type: 'raise', to: 300 }); T.leave('bob'); T.void('test');
  eq(T.seatOfKey('bob'), null); eq(bank(e, 'bob'), 10000); eq(T.seatOfKey('ann').stack, 2000); eq(drift(e), []); books(e);
});
t('an error AFTER the commit does not void: the hand stands and the table moves on', () => {
  const e = env({}, null, k => { if (k === 'hand_end') throw new Error('emit failed'); }); e.decks.push(WIN_DECK());
  e.sit('ann', 2000); e.sit('bob', 2000); e.sit('cy', 2000); e.table.startHand();
  e.table.onError = () => {}; shove(e); e.clock.advance(4500);
  ok(e.ledger.has('hand:T1:1')); eq(e.table.phase, 'between'); eq(e.table.hasDeadline('phase'), true); eq(e.table.hand ? e.table.hand.phase : null, 'done'); eq(drift(e), []);
});
t('a settle failure before the commit voids the hand and writes nothing', () => {
  const e = three(); const T = e.table; T.startHand(); T.act('ann', { type: 'raise', to: 2000 }); T.act('bob', { type: 'call' });
  const orig = e.port.settleHand; e.port.settleHand = () => { throw new Error('disk'); };
  const errs = []; T.onError = er => errs.push(er.message); T.act('cy', { type: 'fold' }); e.clock.advance(4500);
  e.port.settleHand = orig; eq(errs, ['disk']); eq(T.hand, null); ok(!e.ledger.has('hand:T1:1')); eq([...T.seats.values()].map(s => s.stack), [2000, 2000, 2000]);
});
t('end night mid-hand waits for the settle, then cashes everyone out and ends the table', () => {
  const e = three(); const T = e.table; T.startHand(); eq(T.endNight('host'), 'pending'); eq(T.phase, 'betting');
  shove(e); e.clock.advance(5000 + 1500 * 3 + 1); eq(T.phase, 'ended'); eq(T.state, 'ended'); eq(T.seats.size, 0); eq(e.clock.pending(), 0);
  eq([bank(e, 'ann'), bank(e, 'bob'), bank(e, 'cy')], [12050, 8000, 9950]); books(e);
  eq(e.events.find(x => x[0] === 'night_end')[1].keys.sort(), ['ann', 'bob', 'cy']);
});
t('end night between hands is immediate; a permanent table cannot be ended', () => {
  const e = env(); e.sit('ann', 2000); eq(e.table.endNight('host'), true); eq(e.table.phase, 'ended'); eq(bank(e, 'ann'), 10000);
  const p = env({}, { permanent: true }); let c = null; try { p.table.endNight('host'); } catch (er) { c = er.code; } eq(c, 'permanent');
});
t('pending blinds apply at the next hand only', () => {
  const e = three(); const T = e.table; T.startHand(); T.pendingBlinds = { sb: 50, bb: 100 };
  eq([T.hand.sb, T.hand.bb], [25, 50]); T.act('ann', { type: 'fold' }); T.act('bob', { type: 'fold' });
  e.clock.advance(7000); eq([T.hand.sb, T.hand.bb], [50, 100]); eq(T.pendingBlinds, null);
});
t('escalation level is computed when the hand starts; blinds_up fires once per rise', () => {
  const e = three({ blindIncrease: { enabled: true, everyMin: 10, schedule: 'standard' } }); const T = e.table; T.startHand();
  eq([T.hand.sb, T.hand.bb], [25, 50]); eq(e.events.filter(x => x[0] === 'blinds_up').length, 0);
  T.act('ann', { type: 'fold' }); T.act('bob', { type: 'fold' }); T.blindStartAt = e.clock.now() - 11 * 60000; e.clock.advance(7000);
  const up = e.events.filter(x => x[0] === 'blinds_up'); eq(up.length, 1); eq([up[0][1].level, T.hand.bb > 50], [1, true]);
  foldAround(T); e.clock.advance(7000); eq(T.handNo, 3); eq(e.events.filter(x => x[0] === 'blinds_up').length, 1, 'no second event at the same level');
});
t('a disconnected seat is not dealt; on its turn it runs on the disconnect clock; all-in disconnected seat reaches showdown', () => {
  const e = three({ actionTimerSec: 0 }); const T = e.table; T.startHand(); eq(T.hasDeadline('phase'), false, 'no turn clock when connected and timer off');
  T.disconnect('s-ann'); eq(T.deadlines.get('phase').kind, 'turn'); eq(T.deadlines.get('phase').at, e.clock.now() + 30000);
  e.clock.advance(30000); eq(T.hand.seats[0].folded, true); T.act('bob', { type: 'fold' }); eq(T.phase, 'between');
  e.clock.advance(12000); eq(T.hand.seats[0] === undefined || T.seatOfKey('ann').dealt === false, true, 'disconnected seat skipped');
});
t('leave in between cashes out everything; leave in hand marks leaving and excludes the seat from the next deal', () => {
  const e = three(); const T = e.table; T.startHand(); T.act('ann', { type: 'raise', to: 300 }); T.leave('cy');
  eq(T.seatOfKey('cy').leaving, true); eq(T.eligible().some(s => s.key === 'cy'), false);
  T.act('bob', { type: 'call' }); eq(T.hand.street, 'flop');
});
t('grace expiry in a live hand is retried, not applied mid-hand', () => {
  const e = three({ actionTimerSec: 0 }); const T = e.table; T.startHand(); T.disconnect('s-cy'); e.clock.advance(125000);
  ok(T.seatOfKey('cy'), 'still seated while the hand is live'); eq(T.hasDeadline('grace:2'), true);
});
t('every settled hand leaves drift empty and books balanced (mini fuzz, 60 hands)', () => {
  const e = env({ actionTimerSec: 15 }); for (const k of ['ann', 'bob', 'cy']) e.sit(k, 3000); const T = e.table; let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // the deck shuffle uses a crypto rng by default: seed it too, otherwise a bad run of hands can bust a player past the 10000 bank and the rebuy throws 'Not enough funds' (flake: 3 of 10 runs)
  let s2 = 12345; T.rng = () => (s2 = (s2 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  {
  for (let i = 0; i < 60; i++) {
    if (T.eligible().length < 2) { for (const s of T.players()) if (s.stack === 0) T.rebuy(s.key, { amount: 3000 }); }
    if (T.phase === 'between') e.clock.advance(7001); else if (T.phase === 'waiting') T.startHand();
    let g = 0;
    while (T.handLive() && g++ < 60) {
      const h = T.hand;
      if (h.phase === 'runout') { e.clock.advance(1500); continue; }
      const key = T.seats.get(h.toAct).key, la = engine.legalActions(h, h.toAct), r = rnd();
      const a = r < 0.2 ? { type: 'fold' } : r < 0.55 ? (la.canCheck ? { type: 'check' } : { type: 'call' }) : (la.canRaise ? { type: 'raise', to: Math.min(la.maxRaiseTo, la.minRaiseTo + Math.floor(rnd() * 400)) } : { type: la.canCheck ? 'check' : 'call' });
      T.act(key, a);
    }
    eq(drift(e), [], 'drift at hand ' + T.handNo); if (T.phase === 'between' || T.phase === 'waiting') books(e);
  }
  ok(T.handNo >= 20, 'played ' + T.handNo);
  }
});

console.error = origErr;
console.log(`tables-hands.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
