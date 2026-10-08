'use strict';
// Money hardening 1008, K3-5: a seat the SERVER cashed out (boot recovery after a restart, the 2-minute disconnect grace) may sit down again at a
// table with a buy-in cap: that return is not the player's rebuy. The cap still counts every buy-in the player makes himself, and the re-entry is
// limited to the amount the server returned, so pulling the plug is not a way to rebuy.
const { world, quiet, code, suite, eq, ok } = require('./lib-money-1008-tables');
const { t, done } = suite(__filename);

function table(mode, over, W0) {
  const W = W0 || world({ keys: ['a', 'b'], cash: { a: 1000000, b: 1000000 } });
  const cash = mode === 'play';
  const T = W.registry.create('a', { name: 'Test table', mode, buyIn: cash ? { min: 500, max: 50000, default: 20000 } : { min: 100, max: 50000, default: 2000 }, blinds: cash ? { sb: 50, bb: 100 } : { sb: 25, bb: 50 }, seats: 2, autoStart: false, actionTimerSec: 60, rebuys: false, ...(over || {}) });
  T.actionTimerSec = (over && over.actionTimerSec) || 0;             // K3-9: the validator refuses timer 0 for Cash; these tests drive every action by hand, so the clock is switched off after create
  W.cur = cash ? 'play' : 'chips'; W.stack = cash ? 20000 : 2000;
  if (!cash) for (const k of ['a', 'b']) W.service.ensureAccount(k);
  return { W, T };
}
const sit = (T, k, amount) => code(() => T.sit(k, { amount, socketId: 's-' + k }));

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';

  t(`${tag}: after a restart both players sit again at a no-rebuy table (the old code answered rebuy_off)`, () => {
    const { W, T } = table(mode);
    T.sit('a', { amount: W.stack }); T.sit('b', { amount: W.stack });
    const before = { a: W.held('a', W.cur), b: W.held('b', W.cur) }, total0 = W.total(W.cur);
    const rep = W.restart();
    eq(rep.seats.length, 2);
    const T2 = W.registry.get(T.id);
    eq(W.held('a', W.cur), before.a); eq(W.total(W.cur), total0, 'nothing minted or lost by the restart');
    eq([sit(T2, 'a', W.stack), sit(T2, 'b', W.stack)], ['none', 'none']);
    eq(W.ledger.balance('seat:' + T.id + ':a', W.cur), W.stack);
    // the return was not a rebuy but a second player-made buy-in is still one too many
    quiet(() => T2.leave('a', 'leave'));
    eq(sit(T2, 'a', W.stack), 'rebuy_off', 'his own leave is his own cash-out: the cap holds');
    eq(W.total(W.cur), total0);
  });

  t(`${tag}: the re-entry is limited to what the server returned (a bigger stack than he had is a rebuy)`, () => {
    const { W, T } = table(mode);
    T.sit('a', { amount: W.stack }); T.sit('b', { amount: W.stack });
    // a loses half of his stack to b's seat by a direct ledger move? no: play a hand where a pays b, then restart
    const cashOutHalf = Math.floor(W.stack / 2);
    W.port.cashOut(T, 'a', W.stack - cashOutHalf, 'leave');        // his own partial cash-out: stack at the table is now half
    T.seatOfKey('a').stack = cashOutHalf;
    W.restart();                                                    // the server returns the half that is left
    const T2 = W.registry.get(T.id);
    eq(sit(T2, 'a', W.stack), 'rebuy_off', 'more than the server returned');
    eq(sit(T2, 'a', cashOutHalf), 'none', 'exactly what the server returned');
    eq(W.ledger.balance('seat:' + T.id + ':a', W.cur), cashOutHalf);
  });

  t(`${tag}: the 2-minute disconnect grace is a server cash-out too, and survives a restart afterwards`, () => {
    const { W, T } = table(mode);
    T.sit('a', { amount: W.stack, socketId: 'sa' }); T.sit('b', { amount: W.stack, socketId: 'sb' });
    T.disconnect('sa');
    quiet(() => W.clock.advance(121000));
    eq(T.seatOfKey('a'), null, 'grace cashed him out');
    eq(sit(T, 'a', W.stack), 'none', 'he comes back with the money the server sent home');
    eq(sit(T, 'a', W.stack), 'none', 'already seated: a reconnect, not a buy-in');
    // grace again, then a restart: the replay from the ledger must agree with the in-memory count
    T.disconnect('s-a');
    quiet(() => W.clock.advance(121000));
    eq(T.seatOfKey('a'), null);
    W.restart();
    const T2 = W.registry.get(T.id);
    eq(sit(T2, 'a', W.stack), 'none', 'after the restart he can still sit once with what was returned');
    quiet(() => T2.leave('a', 'leave'));
    eq(sit(T2, 'a', W.stack), 'rebuy_off', 'but not twice');
  });

  t(`${tag}: a player who left or was kicked himself gets no free re-entry from a restart`, () => {
    const { W, T } = table(mode);
    T.sit('a', { amount: W.stack }); T.sit('b', { amount: W.stack });
    quiet(() => T.leave('b', 'leave'));                              // b's own cash-out: nothing for the server to return
    W.restart();
    const T2 = W.registry.get(T.id);
    eq(sit(T2, 'b', W.stack), 'rebuy_off');
    eq(sit(T2, 'a', W.stack), 'none');
  });

  t(`${tag}: a rebuy limit is the same: the returned seat re-enters, the next player-made buy-in past the limit is refused`, () => {
    const { W, T } = table(mode, { rebuys: true, rebuyLimit: 1 });
    T.sit('a', { amount: W.stack }); T.sit('b', { amount: W.stack });
    // a busts-out is hard to stage; use his two allowed buy-ins by leaving and sitting (own cash-out) once:
    quiet(() => T.leave('a', 'leave')); eq(sit(T, 'a', W.stack), 'none');           // buy-in 2 of 2 (limit 1 rebuy)
    quiet(() => T.leave('a', 'leave')); eq(sit(T, 'a', W.stack), 'rebuy_off');
    W.restart();
    const T2 = W.registry.get(T.id);
    // a is not seated (refused above): only b has a seat to be returned
    eq(sit(T2, 'b', W.stack), 'none');
    eq(sit(T2, 'a', W.stack), 'rebuy_off', 'a had used both of his own buy-ins and was not sent home by the server');
  });

  t(`${tag}: tables with unlimited rebuys are untouched (no re-entry bookkeeping)`, () => {
    const { W, T } = table(mode, { rebuys: true, rebuyLimit: 0 });
    T.sit('a', { amount: W.stack }); T.sit('b', { amount: W.stack });
    W.restart();
    const T2 = W.registry.get(T.id);
    eq(T2.reentry, {});
    eq(sit(T2, 'a', W.stack), 'none');
  });
}
done();
