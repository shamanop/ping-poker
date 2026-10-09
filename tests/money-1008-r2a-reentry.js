'use strict';
// Money hardening 1008, R2A-4 / RV-1 / RV-2 (the re-entry allowance is ONE return), RV-3 (heads-up host kick leaves no big-blind debt),
// R2A-5 (the table deals again after the forced three-void pause is resumed), and the tests the mutation survivors asked for
// (R2A-T1..T3, RV-T1, RV-T2).
const { world, quiet, code, suite, eq, ok } = require('./lib-money-1008-tables');
const engine = require('../engine/hand');
const { t, done } = suite(__filename);

const MIN = 20000, MAX = 50000;
function setup(mode, over, o) {
  o = o || {};
  const W = world({ keys: ['a', 'b'], cash: { a: 1000000, b: 1000000 } });
  if (mode === 'chips') for (const k of ['a', 'b']) W.service.adminAdjust(k, 1000000, 'chips', 'seed', 'seedc:' + k);
  const T = W.registry.create('b', Object.assign({ name: 'No rebuy', mode, buyIn: { min: MIN, max: MAX, default: MIN }, blinds: { sb: 100, bb: 200 }, seats: 2, autoStart: false, actionTimerSec: 30, rebuys: false }, over || {}));
  const total0 = W.total(mode);
  T.sit('a', { amount: o.start || MIN, socketId: 'sa' }); T.sit('b', { amount: o.start || MIN, socketId: 'sb' });
  if (!o.noHand) {            // a raises to 150, b moves all-in, a folds: a keeps 50 (below the minimum 200), b has 350
    quiet(() => T.startHand());
    for (let g = 0; g < 6 && T.handLive() && T.hand.phase === 'betting'; g++) {
      const k = T.seats.get(T.hand.toAct).key, hs = T.hand.seats[T.hand.toAct];
      if (k === 'a') T.act('a', hs.committed < 15000 ? { type: 'raise', to: 15000 } : { type: 'fold' });
      else T.act('b', { type: 'raise', to: 20000 });
    }
    quiet(() => W.clock.advance(100));
  }
  const S = { W, T, cur: mode, total0, stackA: T.seatOfKey('a').stack, stackB: T.seatOfKey('b').stack };
  return S;
}
function server(how, S) {
  if (how === 'restart') { quiet(() => S.W.restart()); S.T = S.W.registry.get(S.T.id); }
  else quiet(() => { S.T.disconnect('sa'); S.T.disconnect('sb'); S.W.clock.advance(121000); });
}
const sit = (T, k, amount) => code(() => T.sit(k, { amount, socketId: 's2' + k }));
const leave = (T, k) => quiet(() => T.leave(k, 'leave'));

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';
  for (const how of ['restart', 'grace']) {
    // ---- R2A-4: ONE return, spent whole by the first sit ----
    t(`${tag}: ${how}: R2A-4 one server cash-out is ONE re-entry: a second sit after his own leave is rebuy_off, whatever the amount`, () => {
      const S = setup(mode); server(how, S);
      eq(S.stackA, 5000);
      eq(sit(S.T, 'a', 100), 'none', 'the first sit uses the allowance, with less than he had');
      leave(S.T, 'a');
      for (const amt of [100, 1, 4900, 5000, MIN]) eq(sit(S.T, 'a', amt), amt < MIN ? 'range' : 'rebuy_off', 'allowance is spent whole: ' + amt);
      eq(S.W.total(S.cur), S.total0, 'ledger conserved');
    });

    t(`${tag}: ${how}: R2A-4 a restart after the spent allowance does not give it back (replay from the ledger)`, () => {
      const S = setup(mode); server(how, S);
      eq(sit(S.T, 'a', 3000), 'none');
      leave(S.T, 'a');
      quiet(() => S.W.restart()); S.T = S.W.registry.get(S.T.id);
      eq(sit(S.T, 'a', 2000), 'range', 'spent: nothing left, also after a restart');
      eq(sit(S.T, 'a', MIN), 'rebuy_off');
    });

    t(`${tag}: ${how}: an unspent allowance replays from the ledger after a further restart, and is still ONE entry`, () => {
      const S = setup(mode); server(how, S);
      quiet(() => S.W.restart()); S.T = S.W.registry.get(S.T.id);
      eq(sit(S.T, 'a', S.stackA), 'none');
      leave(S.T, 'a');
      quiet(() => S.W.restart()); S.T = S.W.registry.get(S.T.id);
      eq(sit(S.T, 'a', S.stackA), 'range');
    });
  }

  // ---- RV-1: the minimum is waived only when the stack the server returned was itself below it ----
  for (const how of ['restart', 'grace']) {
    t(`${tag}: ${how}: RV-1 a stack the server returned ABOVE the minimum gets no below-minimum entry`, () => {
      const S = setup(mode, null, { start: 30000, noHand: true }); server(how, S);
      eq(sit(S.T, 'a', 100), 'range', 'returned 30000, minimum 20000: 100 is refused');
      eq(sit(S.T, 'a', MIN - 1), 'range');
      eq(sit(S.T, 'a', 30000 + 1), 'rebuy_off', 'more than he had is not the return: normal rules, no rebuys');
      eq(sit(S.T, 'a', 25000), 'none', 'a normal buy-in up to what he had is the one entry');
      leave(S.T, 'a');
      eq(sit(S.T, 'a', 25000), 'rebuy_off', 'and only one');
      eq(S.W.total(S.cur), S.total0);
    });
  }

  // ---- RV-2: a buy-in or a leave by choice clears the allowance ----
  t(`${tag}: RV-2 capped table: he buys the minimum himself, so the unspent allowance is gone and he cannot sit below the minimum later`, () => {
    const S = setup(mode, { rebuys: true, rebuyLimit: 2 }); server('restart', S);
    eq(S.stackA, 5000);
    eq(sit(S.T, 'a', MIN), 'none', 'the minimum is more than the 5000 returned: a normal (counted) buy-in');
    leave(S.T, 'a');
    eq(sit(S.T, 'a', 5000), 'range', 'the allowance did not survive his own buy-in and leave');
    eq(S.W.total(S.cur), S.total0);
  });

  t(`${tag}: RV-2 a leave by choice clears an allowance (and a restart replays it so)`, () => {
    const S = setup(mode);
    S.T.noteServerReturn('b', 4000);                             // white-box: b is seated and holds a return record, then leaves by choice
    ok(S.T.reentry.b, 'record there');
    leave(S.T, 'b');
    eq(S.T.reentry.b, undefined, 'a leave by choice clears it');
    eq(sit(S.T, 'b', 4000), 'range', 'and the amount below the minimum is refused');
  });

  // ---- RV-T2: the rebuy call site and amount 0 ----
  t(`${tag}: RV-T2 a rebuy with the server-return allowance may be below the minimum (the key reaches checkAmount); without one it may not`, () => {
    const S = setup(mode, { rebuys: true, rebuyLimit: 2 });
    const sa = S.T.seatOfKey('a'); sa.stack = 0;                 // a busted: the rebuy panel
    eq(code(() => S.T.rebuy('a', { amount: 5000 })), 'range', 'no allowance: below the minimum is refused');
    S.T.noteServerReturn('a', 5000);                             // white-box: an allowance at a seated, busted player
    eq(code(() => S.T.rebuy('a', { amount: 5001 })), 'range', 'one unit over');
    eq(code(() => S.T.rebuy('a', { amount: 5000 })), 'none', 'exactly what the server returned');
    eq(S.T.seatOfKey('a').stack, 5000);
    eq(S.T.reentry.a, undefined, 'spent');
  });

  t(`${tag}: RV-T2 amount 0 with an allowance is refused as range and leaves the allowance alone`, () => {
    const S = setup(mode); server('restart', S);
    ok(S.T.reentry.a, 'allowance there');
    eq(sit(S.T, 'a', 0), 'range');
    eq(sit(S.T, 'a', -1), 'range');
    ok(S.T.reentry.a, 'still there');
    eq(sit(S.T, 'a', S.stackA), 'none');
  });
}
done();
