'use strict';
// Money hardening 1008, K3-4: a pause can never hold a live hand open. A pause asked for during a hand takes effect when that hand has
// settled; the run-out and the turn clock keep going until then. Real engine, real ledger, fake clock, Cash and Chips.
const { world, rigDeck, quiet, suite, eq, ok } = require('./lib-money-1008-tables');
const { t, done } = suite(__filename);
const DRY = ['3c', '8d', '9h', '4s', 'Jh'];

function table(mode, seats, over) {
  const W = world({ keys: ['a', 'b', 'c'], cash: { a: 100000, b: 100000, c: 100000 } });
  const cash = mode === 'play';
  const T = W.registry.create('a', { name: 'Test table', mode, buyIn: cash ? { min: 500, max: 50000, default: 20000 } : { min: 100, max: 50000, default: 2000 }, blinds: cash ? { sb: 50, bb: 100 } : { sb: 25, bb: 50 }, seats, autoStart: false, actionTimerSec: 60, ...(over || {}) });
  T.actionTimerSec = (over && over.actionTimerSec) || 0;             // K3-9: the validator refuses timer 0 for Cash; these tests drive every action by hand, so the clock is switched off after create
  W.cur = cash ? 'play' : 'chips'; W.stack = cash ? 20000 : 2000; W.bb = cash ? 100 : 50;
  for (const k of ['a', 'b', 'c']) if (!cash) W.service.ensureAccount(k);
  ['a', 'b', 'c'].slice(0, seats).forEach((k, i) => T.sit(k, { amount: W.stack, seat: i }));
  W.before = Object.fromEntries(['a', 'b', 'c'].map(k => [k, W.held(k, W.cur)])); W.total0 = W.total(W.cur);
  return { W, T };
}
const allIn = (W, T) => { quiet(() => T.startHand()); T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' }); };

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';

  t(`${tag}: a pause during the all-in run-out is pending; the hand runs out and settles; then the table is paused`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    allIn(W, T); eq(T.phase, 'runout');
    eq(T.pause(), true); eq(T.paused, false, 'not paused yet'); eq(T.pausePending, true); eq(T.state, 'open');
    quiet(() => W.clock.advance(10000));                                    // street clock keeps running
    eq(T.phase, 'between', 'the hand settled'); eq(T.paused, true); eq(T.state, 'paused'); eq(T.pausePending, false);
    eq(W.ledger.has('hand:' + T.id + ':1'), true, 'one ledger batch');
    eq(T.seatOfKey('b').stack, 2 * W.stack, 'the winner is paid at the table');
    // nothing is held open: end the night now, everybody is cashed out in full
    eq(T.endNight('host'), true);
    eq([W.held('a', W.cur) - W.before.a, W.held('b', W.cur) - W.before.b], [-W.stack, W.stack]);
    eq(W.total(W.cur), W.total0);
    eq(W.ledger.list('seat:' + T.id + ':', W.cur).length, 0);
  });

  t(`${tag}: a pause during a betting round: the turn clock keeps going and folds; the pause starts after the hand`, () => {
    const { W, T } = table(mode, 3, { actionTimerSec: 30 });
    quiet(() => T.startHand());
    W.clock.advance(10000);
    eq(T.pause(), true); eq(T.paused, false);
    quiet(() => W.clock.advance(30000 * 3));                                  // every turn times out: the hand ends
    eq(T.handLive(), false); eq(T.phase, 'between'); eq(T.paused, true);
    eq(W.total(W.cur), W.total0);
    eq(T.deadlines.get('phase').frozen > 0, true, 'the next hand is frozen, not started');
    const handNo = T.handNo; quiet(() => W.clock.advance(120000)); eq(T.handNo, handNo, 'paused: no new hand');
    T.resume(); quiet(() => W.clock.advance(8000)); eq(T.handNo, handNo + 1, 'resume plays on');
  });

  t(`${tag}: resume before the hand ends cancels the pending pause`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    allIn(W, T);
    T.pause(); eq(T.pausePending, true);
    eq(T.resume(), true); eq(T.pausePending, false);
    quiet(() => W.clock.advance(6000)); eq(T.paused, false); eq(T.phase, 'between');
    eq(T.pause(), true); eq(T.paused, true, 'between hands a pause is immediate');
    eq(T.pause(), false, 'already paused');
  });

  t(`${tag}: pausing twice during a hand asks once; a pause in the middle of a hand never leaves a deadline frozen`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    allIn(W, T);
    eq(T.pause(), true); eq(T.pause(), false);
    for (const d of T.deadlines.values()) eq(d.frozen, undefined, 'no frozen deadline while the hand is live');
    ok(T.deadlines.get('phase') && T.deadlines.get('phase').at != null, 'the street clock is armed');
  });

  t(`${tag}: kick then pause during the run-out: the kicked seat is paid, removed, and the table pauses after`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    allIn(W, T);
    quiet(() => T.kick('a', 'b', false)); T.pause();
    quiet(() => W.clock.advance(10000));
    eq(T.paused, true); eq(T.seatOfKey('b'), null);
    eq([W.held('a', W.cur) - W.before.a, W.held('b', W.cur) - W.before.b], [-W.stack, W.stack]); eq(W.total(W.cur), W.total0);
  });

  t(`${tag}: end night asked during the hand together with a pause: the night ends, nothing stays frozen`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    allIn(W, T);
    eq(T.endNight('host'), 'pending'); T.pause();
    quiet(() => W.clock.advance(20000));
    eq(T.phase, 'ended'); eq(W.ledger.list('seat:' + T.id + ':', W.cur).length, 0); eq(W.total(W.cur), W.total0);
    eq([W.held('a', W.cur) - W.before.a, W.held('b', W.cur) - W.before.b], [-W.stack, W.stack]);
  });

  t(`${tag}: pause then a server restart in the middle of the hand: the hand is voided, everybody gets exactly their buy-in back`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    allIn(W, T); T.pause();
    const id = T.id;
    W.restart();
    eq([W.held('a', W.cur) - W.before.a, W.held('b', W.cur) - W.before.b], [0, 0]); eq(W.total(W.cur), W.total0);
    eq(W.registry.get(id).state, 'paused', 'the host asked for a pause: it is honoured once the hand is void, and the table comes back paused');
    eq(W.ledger.list('seat:', W.cur).length, 0);
  });
}

t('the safety wrapper (money fenced, pauseAll) still stops a table at once, hand or not', () => {
  const { W, T } = table('play', 2);
  W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
  allIn(W, T);
  quiet(() => W.registry.pauseAll());
  eq(T.paused, true); eq(T.pausePending, false);
  for (const d of T.deadlines.values()) if (d.hand) eq(d.at, null, 'hand deadlines frozen');
});

t('three voids in a minute still pause the table at once', () => {
  const { W, T } = table('play', 2);
  for (let i = 0; i < 3; i++) { W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY)); quiet(() => { T.startHand(); T.void('test'); W.clock.advance(100); }); }
  eq(T.paused, true);
});
done();
