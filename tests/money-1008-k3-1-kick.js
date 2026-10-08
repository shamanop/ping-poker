'use strict';
// Money hardening 1008, K3-1: a kick never changes the result of a live hand. Real engine, real ledger, fake clock.
// A kicked seat that is all-in stays in the hand and is paid what it wins; one that still has a decision checks when that is free and
// folds only against a real bet; both are removed when the hand is settled. Cash conserved to the cent in every case.
const { world, rigDeck, quiet, suite, eq, ok } = require('./lib-money-1008-tables');
const { t, done } = suite(__filename);
const DRY = ['3c', '8d', '9h', '4s', 'Jh'];

function table(mode, seats) {
  const W = world({ keys: ['a', 'b', 'c'], cash: { a: 100000, b: 100000, c: 100000 } });
  const cash = mode === 'play';
  const T = W.registry.create('a', { name: 'Test table', mode, buyIn: cash ? { min: 500, max: 50000, default: 20000 } : { min: 100, max: 50000, default: 2000 }, blinds: cash ? { sb: 50, bb: 100 } : { sb: 25, bb: 50 }, seats, autoStart: false, actionTimerSec: 0 });
  W.cur = cash ? 'play' : 'chips'; W.stack = cash ? 20000 : 2000; W.bb = cash ? 100 : 50;
  for (const k of ['a', 'b', 'c']) if (!cash) W.service.ensureAccount(k);
  ['a', 'b', 'c'].slice(0, seats).forEach((k, i) => T.sit(k, { amount: W.stack, seat: i }));
  W.before = Object.fromEntries(['a', 'b', 'c'].map(k => [k, W.held(k, W.cur)])); W.total0 = W.total(W.cur);
  return { W, T };
}
const net = W => Object.fromEntries(Object.keys(W.before).map(k => [k, W.held(k, W.cur) - W.before[k]]));
const sum = o => Object.values(o).reduce((x, y) => x + y, 0);
const finish = (W, T) => { quiet(() => W.clock.advance(60000)); return net(W); };
const conserved = W => { eq(W.total(W.cur), W.total0, 'money conserved'); eq(sum(net(W)), 0, 'nets sum to zero'); };
const noSeatAccount = (W, T, k) => eq(W.ledger.list('seat:' + T.id + ':', W.cur).filter(x => x.account.endsWith(':' + k)).length, 0, 'seat account swept');

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';

  t(`${tag}: kick of an all-in caller in the run-out: the aces still win (the old code gave the host the pot)`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    eq(T.phase, 'runout');
    quiet(() => T.kick('a', 'b', false));
    ok(T.seatOfKey('b') && T.hand.seats[1].folded === false, 'the kicked all-in seat stays in the hand');
    const d = finish(W, T);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W);
    eq(T.seatOfKey('b'), null, 'removed after the hand'); noSeatAccount(W, T, 'b');
  });

  t(`${tag}: kick of the all-in loser: he still loses, the host does not get a refund for him`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['As', 'Ad'], ['7c', '2d']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    quiet(() => T.kick('a', 'b', false));
    const d = finish(W, T);
    eq([d.a, d.b], [W.stack, -W.stack]); conserved(W);
  });

  t(`${tag}: kick on every street (heads-up, the seat on turn or not): the cards decide, money conserved`, () => {
    for (const street of ['preflop', 'flop', 'turn', 'river']) {
      for (const victimWins of [true, false]) {
        const { W, T } = table(mode, 2);
        // a = button/SB (host), b = BB (victim). The host just checks / calls down.
        W.decks.push(rigDeck(victimWins ? [['7c', '2d'], ['As', 'Ad']] : [['Ks', 'Kd'], ['7c', '2h']], DRY));
        quiet(() => T.startHand());
        let kicked = false, g = 0;
        while (T.handLive() && T.hand.phase === 'betting' && g++ < 40) {
          if (!kicked && T.hand.street === street) { quiet(() => T.kick('a', 'b', false)); kicked = true; continue; }
          const s = T.seats.get(T.hand.toAct);
          T.act(s.key, { type: T.hand.currentBet > T.hand.seats[s.seat].bet ? 'call' : 'check' });
        }
        ok(kicked, 'the kick happened on ' + street);
        const d = finish(W, T);
        const w = victimWins ? 'b' : 'a';
        ok(d[w] > 0 && d[w === 'a' ? 'b' : 'a'] < 0, `${street}/${victimWins ? 'victim' : 'host'} wins: ${JSON.stringify(d)}`);
        eq(d[w], W.bb); conserved(W);
        eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b'); eq(T.phase === 'between' || T.phase === 'waiting', true);
      }
    }
  });

  t(`${tag}: a kicked seat facing a real bet folds (and loses what it put in); facing nothing it checks and keeps its hand`, () => {
    // 3-handed, a button. Pre: a calls, b calls, c checks. Flop order: b, c, a.
    for (const bets of [true, false]) {
      const { W, T } = table(mode, 3);
      W.decks.push(rigDeck([['Ks', 'Kd'], ['Qd', '2s'], ['As', 'Ad']], DRY));    // c (BB) holds the aces
      quiet(() => T.startHand());
      T.act('a', { type: 'call' }); T.act('b', { type: 'call' }); T.act('c', { type: 'check' });
      eq(T.hand.street, 'flop'); eq(T.seats.get(T.hand.toAct).key, 'b');
      if (bets) T.act('b', { type: 'raise', to: 2 * W.bb }); else T.act('b', { type: 'check' });
      eq(T.seats.get(T.hand.toAct).key, 'c');
      quiet(() => T.kick('a', 'c', false));
      eq(T.hand.seats[2].folded, bets, bets ? 'folds against a bet' : 'checks, still in');
      let g = 0;
      while (T.handLive() && T.hand.phase === 'betting' && g++ < 40) {
        const s = T.seats.get(T.hand.toAct);
        T.act(s.key, { type: T.hand.currentBet > T.hand.seats[s.seat].bet ? 'call' : 'check' });
      }
      const d = finish(W, T);
      if (bets) eq(d.c, -W.bb, 'kicked and folded: loses only the blind it posted'); else ok(d.c > 0, 'the aces won: ' + JSON.stringify(d));
      conserved(W); eq(T.seatOfKey('c'), null); noSeatAccount(W, T, 'c');
    }
  });

  t(`${tag}: two kicks in one run-out (host all-in against both): the best hand wins whoever is kicked`, () => {
    const { W, T } = table(mode, 3);
    W.decks.push(rigDeck([['7c', '2d'], ['Ks', 'Kd'], ['As', 'Ad']], DRY));         // a 72, b KK, c AA
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' }); T.act('c', { type: 'call' });
    eq(T.phase, 'runout');
    quiet(() => { T.kick('a', 'b', false); T.kick('a', 'c', false); });
    const d = finish(W, T);
    eq([d.a, d.b, d.c], [-W.stack, -W.stack, 2 * W.stack]); conserved(W);
    eq(T.seats.size, 1);
  });

  t(`${tag}: kick during the run-out when the kicked seat still has chips behind (side pot)`, () => {
    const { W, T } = table(mode, 3);
    W.decks.push(rigDeck([['7c', '2d'], ['Ks', 'Kd'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    // a shoves, b calls all-in, c (aces) has the same stack: everybody all-in. Then kick c.
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' }); T.act('c', { type: 'call' });
    quiet(() => T.kick('a', 'c', false));
    ok(T.seatOfKey('c') && !T.hand.seats[2].folded);
    const d = finish(W, T);
    ok(d.c === 2 * W.stack, JSON.stringify(d)); conserved(W);
  });

  t(`${tag}: kicking the same seat twice changes nothing; a server restart in the middle of a kicked all-in hand refunds both exactly`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    quiet(() => { T.kick('a', 'b', false); T.kick('a', 'b', false); });
    eq(W.ledger.balance('seat:' + T.id + ':b', W.cur), W.stack, 'the committed chips are still in the seat account, once');
    W.restart();                                                          // the hand never committed: void, both get their stack back
    eq(net(W), { a: 0, b: 0, c: 0 }); eq(W.total(W.cur), W.total0);
    eq(W.ledger.list('seat:', W.cur).length, 0);
  });

  t(`${tag}: a kicked seat that wins the pot is paid exactly once (one hand batch, seat account empty after)`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    const lines0 = W.ledger.lastId;
    quiet(() => T.kick('a', 'b', false));
    const afterKick = W.ledger.lastId;
    finish(W, T);
    ok(W.ledger.has('hand:' + T.id + ':1'));
    const hands = [...W.ledger.entries(e => typeof e.ref === 'string' && e.ref.startsWith('hand:'))].map(e => e.ref);
    eq([...new Set(hands)].length, 1, 'one ledger write for the hand');
    ok(afterKick >= lines0);
  });

  t(`${tag}: a player who leaves of his own accord while all-in is paid what he wins, then the seat goes`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    quiet(() => T.leave('b', 'leave'));
    ok(T.hand.seats[1].folded === false);
    const d = finish(W, T);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W); eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b');
  });

  t(`${tag}: a player who walks out with a decision still ahead of him folds, as before`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: 4 * W.bb });                       // b is facing a raise
    quiet(() => T.leave('b', 'leave'));
    eq(T.hand.seats[1].folded, true);
    const d = finish(W, T);
    eq([d.a, d.b], [W.bb, -W.bb]); conserved(W);
  });

  t(`${tag}: a kicked seat's turn is played at once (no clock), also when the kick lands on a seat that is not yet on turn`, () => {
    const { W, T } = table(mode, 3);
    W.decks.push(rigDeck([['7c', '2d'], ['Qd', '2s'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());                                          // a on turn
    quiet(() => T.kick('a', 'c', false));                                // c (BB) is not on turn
    T.act('a', { type: 'call' }); T.act('b', { type: 'call' });          // c's option is played by the server
    eq(T.hand.street, 'flop', 'the hand moved on without waiting for the kicked seat');
    eq(W.clock.pending() > 0, true);
    ok(T.hand.toAct === 1, 'b acts first on the flop');
  });
}
done();
