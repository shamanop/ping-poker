'use strict';
// Money hardening 1008, R2A-3: at a table with a buy-in cap, a stack BELOW the table minimum that the SERVER cashed out (restart, the
// disconnect grace) may sit down again: a seat-back that uses the server-return allowance may be for less than the minimum, up to exactly
// what the server returned and never more. It is not a rebuy. A player who left by his own choice gets no such waiver.
const { world, quiet, code, suite, eq, ok } = require('./lib-money-1008-tables');
const { t, done } = suite(__filename);

const MIN = 20000, MAX = 50000;
function setup(mode, over) {
  const W = world({ keys: ['a', 'b'], cash: { a: 1000000, b: 1000000 } });
  const cur = mode;
  if (mode === 'chips') for (const k of ['a', 'b']) W.service.adminAdjust(k, 1000000, 'chips', 'seed', 'seedc:' + k);
  const T = W.registry.create('b', Object.assign({ name: 'No rebuy', mode, buyIn: { min: MIN, max: MAX, default: MIN }, blinds: { sb: 100, bb: 200 }, seats: 2, autoStart: false, actionTimerSec: 30, rebuys: false }, over || {}));
  const total0 = W.total(cur);
  T.sit('a', { amount: MIN, socketId: 'sa' }); T.sit('b', { amount: MIN, socketId: 'sb' });
  // one honest hand: a raises to 150, b moves all-in, a folds: a keeps 50 (below the minimum 200), b has 350.
  quiet(() => T.startHand());
  for (let g = 0; g < 6 && T.handLive() && T.hand.phase === 'betting'; g++) {
    const k = T.seats.get(T.hand.toAct).key, hs = T.hand.seats[T.hand.toAct];
    if (k === 'a') T.act('a', hs.committed < 15000 ? { type: 'raise', to: 15000 } : { type: 'fold' });
    else T.act('b', { type: 'raise', to: 20000 });
  }
  quiet(() => W.clock.advance(100));
  return { W, T, cur, total0, stackA: T.seatOfKey('a').stack, stackB: T.seatOfKey('b').stack };
}
function server(how, S) {
  if (how === 'restart') { quiet(() => S.W.restart()); S.T = S.W.registry.get(S.T.id); }
  else quiet(() => { S.T.disconnect('sa'); S.T.disconnect('sb'); S.W.clock.advance(121000); });
}
const sit = (T, k, amount) => code(() => T.sit(k, { amount, socketId: 's2' + k }));

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';
  for (const how of ['restart', 'grace']) {
    t(`${tag}: ${how}: the short stack sits back with exactly what the server returned (below the minimum), the winner too`, () => {
      const S = setup(mode); server(how, S);
      eq(S.stackA, 5000); ok(S.stackA < MIN);
      eq(sit(S.T, 'a', S.stackA), 'none', 'a sits with what he had');
      eq(S.T.seatOfKey('a').stack, S.stackA);
      eq(sit(S.T, 'b', S.stackB), 'none', 'b sits with what he had');
      eq(S.W.total(S.cur), S.total0, 'ledger conserved');
    });

    t(`${tag}: ${how}: never more than the server returned: one unit over is refused, the minimum is refused`, () => {
      const S = setup(mode); server(how, S);
      ok(sit(S.T, 'a', S.stackA + 1) !== 'none', 'a unit over what he had');
      ok(sit(S.T, 'a', MIN) !== 'none', 'the table minimum is more than he had');
      ok(!S.T.seatOfKey('a'), 'not seated');
      eq(sit(S.T, 'a', S.stackA), 'none', 'what he had is still open to him');
    });

    t(`${tag}: ${how}: less than the server returned is fine; the allowance is ONE return, spent whole by the first sit (R2A-4)`, () => {
      const S = setup(mode); server(how, S);
      eq(sit(S.T, 'a', 3000), 'none');
      quiet(() => S.T.leave('a', 'leave'));                        // his own cash-out: 3000 back in his wallet
      ok(sit(S.T, 'a', 2000) !== 'none', 'the other 2000 are not a second entry: the allowance was spent whole');
      ok(sit(S.T, 'a', 100) !== 'none', 'allowance spent: no more below-minimum seats');
      eq(S.W.total(S.cur), S.total0);
    });
  }

  t(`${tag}: a player who left by his own choice gets no waiver (K3-5 stays)`, () => {
    const S = setup(mode);
    // a stands up after the hand (own choice), then tries to come back with what he had
    quiet(() => S.T.leave('a', 'leave'));
    ok(sit(S.T, 'a', S.stackA) !== 'none', 'short stack after his own leave');
    ok(sit(S.T, 'a', MIN) !== 'none', 'no-rebuy: the minimum is a rebuy');
    ok(!S.T.seatOfKey('a'));
    eq(S.W.total(S.cur), S.total0);
  });

  t(`${tag}: a disconnect that the player then cashes out himself after returning is still no waiver`, () => {
    const S = setup(mode); server('restart', S);
    eq(sit(S.T, 'a', S.stackA), 'none');
    quiet(() => S.T.leave('a', 'leave'));
    ok(sit(S.T, 'a', S.stackA) !== 'none', 'second sit with his own cash-out is refused');
  });

  t(`${tag}: junk amounts are still refused after a server cash-out`, () => {
    const S = setup(mode); server('restart', S);
    for (const bad of [0, -5000, 0.5, 5000.5, NaN, Infinity, '5000', null, undefined]) ok(sit(S.T, 'a', bad) !== 'none', 'junk ' + String(bad));
    ok(!S.T.seatOfKey('a'));
  });

  t(`${tag}: a table with rebuys on is unchanged: a short stack sits with the minimum or more, not with less`, () => {
    const S = setup(mode, { rebuys: true }); quiet(() => S.W.restart()); S.T = S.W.registry.get(S.T.id);
    ok(sit(S.T, 'a', S.stackA) !== 'none', 'below the minimum, no allowance at an unlimited-rebuy table');
    eq(sit(S.T, 'a', MIN), 'none');
  });

  t(`${tag}: a capped-rebuy table (rebuyLimit 2): below the minimum is open only up to what the server returned`, () => {
    const S = setup(mode, { rebuys: true, rebuyLimit: 2 }); quiet(() => S.W.restart()); S.T = S.W.registry.get(S.T.id);
    ok(sit(S.T, 'a', S.stackA + 1000) !== 'none', 'rebuys left do not open a below-minimum amount past the allowance');
    ok(!S.T.seatOfKey('a'));
    eq(sit(S.T, 'a', S.stackA), 'none', 'exactly what the server returned');
    eq(S.W.total(S.cur), S.total0);
  });
}
done();
