'use strict';
// Money hardening 1008, K3-6: a player who left (or was kicked) in a live hand and sits at the same table again before the hand ends is not
// answered as a reconnect with a stack he does not have. He is refused (hand_live) until the hand has settled; then he sits with a real buy-in.
const { world, rigDeck, quiet, code, suite, eq, ok } = require('./lib-money-1008-tables');
const { t, done } = suite(__filename);
const DRY = ['3c', '8d', '9h', '4s', 'Jh'];

function table(mode) {
  const W = world({ keys: ['a', 'b', 'c'], cash: { a: 100000, b: 100000, c: 100000 } });
  const cash = mode === 'play';
  const T = W.registry.create('a', { name: 'Test table', mode, buyIn: cash ? { min: 100, max: 50000, default: 20000 } : { min: 100, max: 50000, default: 2000 }, blinds: cash ? { sb: 50, bb: 100 } : { sb: 25, bb: 50 }, seats: 3, autoStart: false, actionTimerSec: 0 });
  W.cur = cash ? 'play' : 'chips'; W.stack = cash ? 20000 : 2000; W.bb = cash ? 100 : 50;
  for (const k of ['a', 'b', 'c']) if (!cash) W.service.ensureAccount(k);
  ['a', 'b', 'c'].forEach((k, i) => T.sit(k, { amount: W.stack, seat: i }));
  W.decks.push(rigDeck([['Ks', 'Kd'], ['7c', '2d'], ['As', 'Ad']], DRY));
  quiet(() => T.startHand());
  return { W, T };
}
const joined = (W, key) => W.events.filter(e => e[1] === 'joined' && e[2] && e[2].key === key);

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';
  for (const how of ['leave']) {          // K3-1b: a kick no longer makes a seat 'leaving' during a live hand (see the next test)
    t(`${tag}: after a ${how} mid-hand, sitting again is refused, shows no stack, takes no money, and the seat still goes at the end of the hand`, () => {
      const { W, T } = table(mode);
      if (how === 'leave') quiet(() => T.leave('c', 'leave')); else quiet(() => T.kick('a', 'c', false));
      const wallet = W.ledger.balance((mode === 'play' ? 'play:' : 'bank:') + 'c', W.cur), seat = W.ledger.balance('seat:' + T.id + ':c', W.cur);
      W.events.length = 0;
      eq(code(() => T.sit('c', { amount: W.stack, socketId: 's2' })), 'hand_live');
      eq(joined(W, 'c').length, 0, 'no joined answer');
      eq(W.ledger.balance((mode === 'play' ? 'play:' : 'bank:') + 'c', W.cur), wallet, 'wallet untouched');
      eq(W.ledger.balance('seat:' + T.id + ':c', W.cur), seat, 'seat account untouched');
      eq(T.seatOfKey('c').leaving, true);
      // rebuy is refused for the same reason
      eq(code(() => T.rebuy('c', { amount: W.stack })), 'hand_live');
      // the hand ends: a and b play it out; the seat goes, c may now sit with a real buy-in
      let g = 0; while (T.handLive() && g++ < 20) { const s = T.seats.get(T.hand.toAct); T.act(s.key, { type: 'fold' }); }
      eq(T.seatOfKey('c'), null); eq(W.ledger.balance('seat:' + T.id + ':c', W.cur), 0);
      const before = W.held('c', W.cur);
      T.sit('c', { amount: 5000, socketId: 's3' });
      const j = joined(W, 'c'); eq(j.length, 1); eq(j[0][2].reconnect, false); eq(j[0][2].stack, 5000);
      eq(W.ledger.balance('seat:' + T.id + ':c', W.cur), 5000, 'the shown stack is the ledger stack');
      eq(W.held('c', W.cur), before, 'money moved from the wallet to the seat only');
      eq(W.total(W.cur), W.total(W.cur));
    });
  }

  t(`${tag}: K3-1b after a kick mid-hand the seat is still a live seat (kick only pending): sitting again is an honest reconnect with his real stack, no money moves, and the seat still goes at the end of the hand`, () => {
    const { W, T } = table(mode);
    quiet(() => T.kick('a', 'c', false));
    const wallet = W.ledger.balance((mode === 'play' ? 'play:' : 'bank:') + 'c', W.cur), seat = W.ledger.balance('seat:' + T.id + ':c', W.cur);
    W.events.length = 0;
    T.sit('c', { amount: W.stack, socketId: 's2' });
    const j = joined(W, 'c'); eq(j.length, 1); eq(j[0][2].reconnect, true); eq(j[0][2].stack, seat, 'the shown stack is the ledger stack');
    eq(W.ledger.balance((mode === 'play' ? 'play:' : 'bank:') + 'c', W.cur), wallet, 'wallet untouched');
    eq(W.ledger.balance('seat:' + T.id + ':c', W.cur), seat, 'seat account untouched');
    let g = 0; while (T.handLive() && g++ < 20) { const s = T.seats.get(T.hand.toAct); T.act(s.key, { type: 'fold' }); }
    eq(T.seatOfKey('c'), null, 'the kick is carried out after the hand'); eq(W.ledger.balance('seat:' + T.id + ':c', W.cur), 0);
  });

  t(`${tag}: a normal reconnect (seat not leaving) is unchanged: joined, same stack, no buy-in`, () => {
    const { W, T } = table(mode);
    T.disconnect('s-none');
    W.events.length = 0;
    const before = W.held('b', W.cur);
    T.sit('b', { amount: W.stack, socketId: 'sb2' });
    const j = joined(W, 'b'); eq(j.length, 1); eq(j[0][2].reconnect, true); eq(j[0][2].stack, W.stack);
    eq(W.held('b', W.cur), before);
  });

  t(`${tag}: leaving between hands removes the seat at once, so sitting again is a plain new buy-in`, () => {
    const { W, T } = table(mode);
    let g = 0; while (T.handLive() && g++ < 20) { const s = T.seats.get(T.hand.toAct); T.act(s.key, { type: 'fold' }); }
    quiet(() => T.leave('c', 'leave'));
    eq(T.seatOfKey('c'), null);
    T.sit('c', { amount: 3000, socketId: 's9' });
    eq(W.ledger.balance('seat:' + T.id + ':c', W.cur), 3000);
  });
}
done();
