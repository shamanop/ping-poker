'use strict';
// Money hardening 1008, K3-1 / K3-1b: a kick NEVER changes a live hand. Real engine, real ledger, fake clock.
// A seat that is dealt into a live hand and has not folded is only marked kickPending: it keeps its seat, its socket, its stack, its turn
// and its turn clock until the hand is settled or voided; then it is cashed out and removed, and the `kicked` events go out. A seat that
// is not in a live hand (or has folded) is kicked at once. A player's OWN leave keeps its old behaviour. Cash conserved to the cent.
const { world, rigDeck, quiet, suite, eq, ok } = require('./lib-money-1008-tables');
const { t, done } = suite(__filename);
const DRY = ['3c', '8d', '9h', '4s', 'Jh'];

function table(mode, seats, amounts, timer, sitN) {
  const W = world({ keys: ['a', 'b', 'c'], cash: { a: 100000, b: 100000, c: 100000 } });
  const cash = mode === 'play';
  const T = W.registry.create('a', { name: 'Test table', mode, buyIn: cash ? { min: 500, max: 50000, default: 20000 } : { min: 100, max: 50000, default: 2000 }, blinds: cash ? { sb: 50, bb: 100 } : { sb: 25, bb: 50 }, seats, autoStart: false, actionTimerSec: timer || 60 });
  T.actionTimerSec = timer || 0;             // K3-9: the validator refuses timer 0 for Cash; these tests drive every action by hand, so the clock is switched off after create
  W.cur = cash ? 'play' : 'chips'; W.stack = cash ? 20000 : 2000; W.bb = cash ? 100 : 50;
  for (const k of ['a', 'b', 'c']) if (!cash) W.service.ensureAccount(k);
  ['a', 'b', 'c'].slice(0, sitN || seats).forEach((k, i) => T.sit(k, { amount: amounts ? amounts[i] * W.stack : W.stack, seat: i, socketId: 's-' + k }));
  W.before = Object.fromEntries(['a', 'b', 'c'].map(k => [k, W.held(k, W.cur)])); W.total0 = W.total(W.cur);
  return { W, T };
}
const net = W => Object.fromEntries(Object.keys(W.before).map(k => [k, W.held(k, W.cur) - W.before[k]]));
const sum = o => Object.values(o).reduce((x, y) => x + y, 0);
const finish = W => { quiet(() => W.clock.advance(60000)); return net(W); };
const conserved = W => { eq(W.total(W.cur), W.total0, 'money conserved'); eq(sum(net(W)), 0, 'nets sum to zero'); };
const noSeatAccount = (W, T, k) => eq(W.ledger.list('seat:' + T.id + ':', W.cur).filter(x => x.account.endsWith(':' + k)).length, 0, 'seat account swept');
const evs = (W, T, f) => W.events.filter(e => e[0] === T.id && f(e));
const tev = (W, T, kind, key) => evs(W, T, e => e[1] === 'table_event' && e[2].kind === kind && (!key || e[2].key === key)).length;
const leftEv = (W, T, key) => evs(W, T, e => e[1] === 'left' && e[2].key === key);
// Everyone left to act calls / checks until the betting is over (the victim keeps his turn, so he acts too).
const calldown = (T, max) => { let g = 0; while (T.handLive() && T.hand.phase === 'betting' && g++ < (max || 40)) { const s = T.seats.get(T.hand.toAct); T.act(s.key, { type: T.hand.currentBet > T.hand.seats[s.seat].bet ? 'call' : 'check' }); } };
const inHand = (T, k) => { const s = T.seatOfKey(k); return !!(s && T.hand && T.hand.seats[s.seat] && !T.hand.seats[s.seat].folded); };

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';

  t(`${tag}: K3-1b the lead's case: kick the seat on turn facing the host's all-in: he keeps his turn, calls, his aces win, then he is paid and removed`, () => {
    const { W, T } = table(mode, 2, null, 30);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: 10 * W.bb }); T.act('b', { type: 'raise', to: 20 * W.bb }); T.act('a', { type: 'raise', to: W.stack });
    eq(T.hand.toAct, 1);
    const s = T.seatOfKey('b'), stack0 = s.stack, hs = T.hand.seats[1];
    quiet(() => T.kick('a', 'b', false));
    ok(T.seatOfKey('b') && !T.seatOfKey('b').leaving, 'still seated');
    ok(s.connected && s.socketId === 's-b' && s.stack === stack0 && T.hand.toAct === 1 && !hs.folded, 'socket, stack, turn and hand untouched');
    eq(tev(W, T, 'kick_pending', 'b'), 1, 'host is told it was taken'); eq(tev(W, T, 'kicked', 'b'), 0, 'no kicked event yet'); eq(leftEv(W, T, 'b').length, 0, 'no left event yet');
    eq(W.ledger.balance('seat:' + T.id + ':b', W.cur), W.stack, 'nothing was cashed out');
    ok(T.hasDeadline('phase'), 'his turn clock still runs');
    T.act('b', { type: 'call' });
    const d = finish(W);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W);
    eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b');
    eq(tev(W, T, 'kicked', 'b'), 1, 'kicked event once, at the end'); eq(leftEv(W, T, 'b').length, 1);
    eq(leftEv(W, T, 'b')[0][2].reason, 'kicked');
  });

  t(`${tag}: kick of an all-in caller in the run-out: the aces still win; removed after the hand`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    eq(T.phase, 'runout');
    quiet(() => T.kick('a', 'b', false));
    ok(T.seatOfKey('b') && T.hand.seats[1].folded === false);
    const d = finish(W);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W);
    eq(T.seatOfKey('b'), null, 'removed after the hand'); noSeatAccount(W, T, 'b');
  });

  t(`${tag}: kick of the all-in loser: he still loses, the host gets no refund for him`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['As', 'Ad'], ['7c', '2d']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    quiet(() => T.kick('a', 'b', false));
    const d = finish(W);
    eq([d.a, d.b], [W.stack, -W.stack]); conserved(W);
  });

  t(`${tag}: kick on every street, for the seat on turn and for the seat not on turn, victim wins or loses: the cards decide, he acts after the kick`, () => {
    for (const street of ['preflop', 'flop', 'turn', 'river']) {
      for (const victimWins of [true, false]) {
        for (const onTurn of [true, false]) {
          const { W, T } = table(mode, 2);
          W.decks.push(rigDeck(victimWins ? [['7c', '2d'], ['As', 'Ad']] : [['Ks', 'Kd'], ['7c', '2h']], DRY));
          quiet(() => T.startHand());
          let kicked = false, g = 0;
          while (T.handLive() && T.hand.phase === 'betting' && g++ < 40) {
            if (!kicked && T.hand.street === street && (T.hand.toAct === 1) === onTurn) {
              quiet(() => T.kick('a', 'b', false)); kicked = true;
              ok(inHand(T, 'b') && T.seatOfKey('b').connected, 'untouched by the kick');
              if (onTurn) eq(T.hand.toAct, 1, 'still his turn');
              continue;
            }
            const s = T.seats.get(T.hand.toAct);
            T.act(s.key, { type: T.hand.currentBet > T.hand.seats[s.seat].bet ? 'call' : 'check' });
          }
          ok(kicked, `the kick happened on ${street} onTurn=${onTurn}`);
          const d = finish(W);
          const w = victimWins ? 'b' : 'a';
          ok(d[w] > 0 && d[w === 'a' ? 'b' : 'a'] < 0, `${street}/${victimWins}/${onTurn}: ${JSON.stringify(d)}`);
          eq(d[w], W.bb); conserved(W);
          eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b');
        }
      }
    }
  });

  t(`${tag}: kick, then the victim raises: allowed, the hand goes on (host folds, the raise stands)`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'call' });                                         // b (BB) to act
    quiet(() => T.kick('a', 'b', false));
    T.act('b', { type: 'raise', to: 5 * W.bb });
    ok(T.seatOfKey('b') && T.hand.toAct === 0);
    T.act('a', { type: 'fold' });
    const d = finish(W);
    eq([d.a, d.b], [-W.bb, W.bb]); conserved(W); eq(T.seatOfKey('b'), null);
  });

  t(`${tag}: kick, then the victim's own clock runs out: the clock folds him (his clock, not the kick), then he is paid what is left and removed`, () => {
    const { W, T } = table(mode, 2, null, 30);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: 4 * W.bb });
    quiet(() => T.kick('a', 'b', false));
    ok(T.seatOfKey('b') && T.hand.toAct === 1);
    quiet(() => W.clock.advance(31000));                                  // his turn clock fires
    eq(T.hand.seats[1].folded || !T.handLive(), true, 'folded by the clock');
    const d = finish(W);
    eq([d.a, d.b], [W.bb, -W.bb]); conserved(W); eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b');
  });

  t(`${tag}: kick twice: one kick_pending, no second effect, one kicked at the end`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack });
    quiet(() => { T.kick('a', 'b', false); T.kick('a', 'b', false); });
    eq(tev(W, T, 'kick_pending', 'b'), 1);
    T.act('b', { type: 'call' });
    const d = finish(W);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W);
    eq(tev(W, T, 'kicked', 'b'), 1); eq(leftEv(W, T, 'b').length, 1);
    const hands = [...W.ledger.entries(e => typeof e.ref === 'string' && e.ref.startsWith('hand:'))].map(e => e.ref);
    eq([...new Set(hands)].length, 1, 'one ledger write for the hand');
  });

  t(`${tag}: admin kick follows the same rule`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack });
    quiet(() => T.kick('admin', 'b', true));
    ok(inHand(T, 'b') && T.hand.toAct === 1);
    T.act('b', { type: 'call' });
    const d = finish(W);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W); eq(T.seatOfKey('b'), null);
  });

  t(`${tag}: kick + pause pending: the hand finishes with the victim in it, then he goes and the table pauses`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack });
    quiet(() => { T.kick('a', 'b', false); T.pause(); });
    eq(T.pausePending, true);
    T.act('b', { type: 'call' });
    const d = finish(W);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W);
    eq(T.seatOfKey('b'), null); eq(T.paused, true); eq(T.pausePending, false);
  });

  t(`${tag}: kick + end of night pending: the victim is paid exactly what he would have been, the night ends`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack });
    quiet(() => { T.kick('a', 'b', false); T.endNight('host'); });
    T.act('b', { type: 'call' });
    const d = finish(W);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W);
    eq(T.phase, 'ended'); eq(T.seats.size, 0); eq(W.ledger.list('seat:', W.cur).length, 0);
  });

  t(`${tag}: kick + void (hand never committed): the victim gets exactly his stack back and is removed; nobody wins or loses`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack });
    quiet(() => T.kick('a', 'b', false));
    quiet(() => T.void('test'));
    eq(net(W), { a: 0, b: 0, c: 0 }); eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b');
    eq(tev(W, T, 'kicked', 'b'), 1);
  });

  t(`${tag}: kick + server restart mid-hand: both refunded exactly, nothing left in a seat account`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    quiet(() => { T.kick('a', 'b', false); T.kick('a', 'b', false); });
    eq(W.ledger.balance('seat:' + T.id + ':b', W.cur), W.stack, 'the committed chips are still in the seat account, once');
    W.restart();
    eq(net(W), { a: 0, b: 0, c: 0 }); eq(W.total(W.cur), W.total0);
    eq(W.ledger.list('seat:', W.cur).length, 0);
  });

  t(`${tag}: kick of a seat that has already folded takes effect at once (cashed out now); his blind stays in the pot`, () => {
    const { W, T } = table(mode, 3);
    W.decks.push(rigDeck([['7c', '2d'], ['Ks', 'Kd'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());                                            // a button/UTG, b SB, c BB
    T.act('a', { type: 'call' }); T.act('b', { type: 'fold' });
    const sb = W.bb / 2;
    quiet(() => T.kick('a', 'b', false));
    eq(tev(W, T, 'kicked', 'b'), 1, 'kicked now'); eq(tev(W, T, 'kick_pending', 'b'), 0);
    eq(W.ledger.balance('seat:' + T.id + ':b', W.cur), sb, 'cashed out now, only the SB he posted is left in the seat account');
    eq(leftEv(W, T, 'b')[0][2].cashedOut, W.stack - sb);
    calldown(T);
    const d = finish(W);
    eq(d.b, -sb); conserved(W); eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b');
  });

  t(`${tag}: kick of a seat that is not in a live hand (between hands) is at once`, () => {
    const { W, T } = table(mode, 3);
    W.decks.push(rigDeck([['7c', '2d'], ['Ks', 'Kd'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'fold' }); T.act('b', { type: 'fold' });
    eq(T.phase, 'between');
    quiet(() => T.kick('a', 'c', false));
    eq(T.seatOfKey('c'), null); eq(tev(W, T, 'kicked', 'c'), 1); eq(tev(W, T, 'kick_pending', 'c'), 0); noSeatAccount(W, T, 'c');
  });

  t(`${tag}: a seat that sat down during the hand (not dealt in) is kicked at once`, () => {
    const { W, T } = table(mode, 3, null, 0, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.sit('c', { amount: W.stack, seat: 2 });
    ok(!T.seatOfKey('c').dealt);
    quiet(() => T.kick('a', 'c', false));
    eq(T.seatOfKey('c'), null); eq(tev(W, T, 'kicked', 'c'), 1); eq(tev(W, T, 'kick_pending', 'c'), 0);
    eq(W.held('c', W.cur), W.before.c, 'his whole buy-in is back at once');
  });

  t(`${tag}: two kicks in one run-out (host all-in against both): the best hand wins whoever is kicked`, () => {
    const { W, T } = table(mode, 3);
    W.decks.push(rigDeck([['7c', '2d'], ['Ks', 'Kd'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' }); T.act('c', { type: 'call' });
    eq(T.phase, 'runout');
    quiet(() => { T.kick('a', 'b', false); T.kick('a', 'c', false); });
    const d = finish(W);
    eq([d.a, d.b, d.c], [-W.stack, -W.stack, 2 * W.stack]); conserved(W);
    eq(T.seats.size, 1);
  });

  t(`${tag}: a player who leaves of his own accord while all-in is paid what he wins, then the seat goes`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: W.stack }); T.act('b', { type: 'call' });
    quiet(() => T.leave('b', 'leave'));
    ok(T.hand.seats[1].folded === false);
    const d = finish(W);
    eq([d.a, d.b], [-W.stack, W.stack]); conserved(W); eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b');
  });

  t(`${tag}: stand-up of the biggest all-in stack in the run-out (his uncalled layer already handed back), and a kick of him: his aces still win the main and side pot`, () => {
    for (const how of ['leave', 'kick']) {
      const { W, T } = table(mode, 3, [0.5, 1, 0.25]);
      W.decks.push(rigDeck([['Ks', 'Kd'], ['As', 'Ad'], ['Qs', 'Qd']], DRY));
      quiet(() => T.startHand());
      T.act('a', { type: 'raise', to: W.stack / 2 }); T.act('b', { type: 'raise', to: W.stack }); T.act('c', { type: 'call' });
      eq(T.phase, 'runout');
      if (how === 'leave') quiet(() => T.leave('b', 'leave')); else quiet(() => T.kick('a', 'b', false));
      ok(T.hand.seats[1].folded === false, how + ' did not fold him');
      const d = finish(W);
      eq([d.a, d.b, d.c], [-W.stack / 2, W.stack * 0.75, -W.stack / 4], how); conserved(W);
    }
  });

  t(`${tag}: a player who walks out of his own accord with a decision still ahead of him folds, as before`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: 4 * W.bb });
    quiet(() => T.leave('b', 'leave'));
    eq(T.hand.seats[1].folded, true);
    const d = finish(W);
    eq([d.a, d.b], [W.bb, -W.bb]); conserved(W);
  });

  t(`${tag}: kick pending, then the victim walks out himself with a decision ahead: his own fold, paid once, kicked event once`, () => {
    const { W, T } = table(mode, 2);
    W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], DRY));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: 4 * W.bb });
    quiet(() => T.kick('a', 'b', false));
    quiet(() => T.leave('b', 'leave'));
    eq(T.hand.seats[1].folded, true);
    const d = finish(W);
    eq([d.a, d.b], [W.bb, -W.bb]); conserved(W); eq(T.seatOfKey('b'), null); noSeatAccount(W, T, 'b');
    ok(tev(W, T, 'kicked', 'b') <= 1);
  });
}
done();
