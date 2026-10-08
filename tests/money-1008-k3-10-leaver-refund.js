'use strict';
// Money hardening 1008, lead steer 17:41 (K3-10 candidate): table level through the real registry, after the engine merge (K3-2 / K3-3 / K1-4).
// A short stack is all-in for 200; two deep stacks A and D both put in 1000; D folds by his own action to A's later bet; then A LEAVES (or is
// kicked, with the K3-1b rule). After the hand: money conserved, nothing left in a seat or a pot, every wallet line right (the chips above
// the short stack's level go to the deep seat that matched them or back to the seat that put them in, never to the short stack), and a seat
// that already left gets its refund in its WALLET.
const { world, rigDeck, quiet, suite, eq, ok } = require('./lib-money-1008-tables');
const { t, done } = suite(__filename);
const DRY = ['3c', '8d', '9h', '4s', 'Jh'];

function table(mode) {
  const keys = ['a', 's', 'd'], cash = {}; for (const k of keys) cash[k] = 1000000;
  const W = world({ keys, cash });
  const isCash = mode === 'play', U = isCash ? 1 : 1;
  const T = W.registry.create('d', { name: 'Short stack', mode, buyIn: { min: 100, max: 50000, default: 20000 }, blinds: { sb: 5, bb: 10 }, seats: 3, autoStart: false, actionTimerSec: 60 });
  T.actionTimerSec = 0;
  W.cur = isCash ? 'play' : 'chips';
  if (!isCash) for (const k of keys) W.service.ensureAccount(k);
  T.sit('a', { amount: 5000, seat: 0 }); T.sit('s', { amount: 200, seat: 1 }); T.sit('d', { amount: 5000, seat: 2 });
  W.before = Object.fromEntries(keys.map(k => [k, W.held(k, W.cur)])); W.total0 = W.total(W.cur);
  W.wallet = k => W.ledger.balance((isCash ? 'play:' : 'bank:') + k, W.cur);
  W.wallet0 = Object.fromEntries(keys.map(k => [k, W.wallet(k)]));
  return { W, T };
}

// a (button, UTG) raises to 1000, s (SB) calls all-in for 200, d (BB) calls; flop: d checks, a bets 2000, d folds.
function play(T, W, sWins, leaver, how, when) {
  W.decks.push(sWins ? rigDeck([['Ks', 'Kd'], ['As', 'Ad'], ['7c', '2d']], DRY) : rigDeck([['Ks', 'Kd'], ['7c', '2d'], ['Qs', 'Qd']], DRY));
  quiet(() => T.startHand());
  T.act('a', { type: 'raise', to: 1000 }); T.act('s', { type: 'call' }); T.act('d', { type: 'call' });
  eq(T.hand.street, 'flop');
  T.act('d', { type: 'check' }); T.act('a', { type: 'raise', to: 2000 });
  const out = () => quiet(() => { if (how === 'leave') T.leave(leaver, 'leave'); else T.kick('d', leaver, false); });
  if (when === 'before') out();
  if (T.handLive() && T.hand.toAct != null && T.seats.get(T.hand.toAct).key === 'd') T.act('d', { type: 'fold' });
  if (when === 'after') out();
  let g = 0; while (T.handLive() && g++ < 20) { if (T.hand.phase === 'betting') { const s = T.seats.get(T.hand.toAct); T.act(s.key, { type: 'check' }); } else quiet(() => W.clock.advance(2000)); }
  quiet(() => W.clock.advance(60000));
}

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';
  for (const how of ['leave', 'kick']) for (const sWins of [true, false]) for (const when of ['after', 'before']) {
    t(`${tag}: ${how} of A ${when} D's fold, short stack ${sWins ? 'wins' : 'loses'}: conserved, nothing stranded, wallets right, the refund is in A's wallet`, () => {
      const { W, T } = table(mode);
      play(T, W, sWins, 'a', how, when);
      eq(W.total(W.cur), W.total0, 'Cash conserved');
      eq(W.ledger.list('pot:', W.cur).filter(x => x.balance !== 0).length, 0, 'no chips left in a pot');
      eq(T.seatOfKey('a'), null, 'A is gone after the hand');
      eq(W.ledger.list('seat:' + T.id + ':', W.cur).filter(x => x.account.endsWith(':a') && x.balance !== 0).length, 0, 'no chips left in A\'s seat account');
      const stacks = T.players().reduce((x, s) => x + s.stack, 0), seatsLedger = W.ledger.list('seat:', W.cur).reduce((x, s) => x + s.balance, 0);
      eq(seatsLedger, stacks, 'the seat accounts are exactly the stacks of the seats still at the table');
      const net = {}; for (const k of ['a', 's', 'd']) net[k] = W.held(k, W.cur) - W.before[k];
      eq(net.a + net.s + net.d, 0);
      ok(net.s <= 600 && net.s >= -200, `the short stack never gets more than the three 200 layers: ${JSON.stringify(net)}`);
      eq(W.wallet('a') - W.wallet0.a - 5000, net.a, 'the refund / winnings of the seat that left are in his WALLET');
      if (when === 'after') {
        // D folded, A is the only deep seat in: the side pot (800 + 800) is A's, A's 2000 flop bet was never called and comes back to him
        eq(net.a, sWins ? 600 : 1200, 'A'); eq(net.s, sWins ? 400 : -200, 'S'); eq(net.d, -1000, 'D');
      }
    });
  }
}
done();
