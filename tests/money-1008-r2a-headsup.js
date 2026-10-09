'use strict';
// Money hardening 1008, R2A-2: the missed-blind debt of R2A-1 holds at any table size. Heads-up (fewer than two other seats free to
// play) a returning player who owes the big blind is dealt in AS THE BIG BLIND in his first hand back: the button / small blind goes
// to the other player, whatever seat number he chose. Being dealt that big blind clears the debt. A player who never left is unaffected.
const { world, quiet, suite, eq, ok } = require('./lib-money-1008-tables');
const engine = require('../engine/hand');
const { t, done } = suite(__filename);

function setup(mode, keys, seats) {
  const isCash = mode === 'play', cash = {}; for (const k of keys) cash[k] = 1000000;
  const W = world({ keys, cash });
  if (!isCash) for (const k of keys) W.service.adminAdjust(k, 1000000, 'chips', 'seed', 'seedc:' + k);
  const T = W.registry.create(keys[0], { name: 'HU', mode, buyIn: { min: 500, max: 60000, default: 50000 }, blinds: { sb: 100, bb: 200 }, seats: 8, autoStart: false, actionTimerSec: 30 });
  keys.forEach((k, i) => T.sit(k, { amount: 50000, seat: seats[i] }));
  return { W, T, cur: isCash ? 'play' : 'chips', total0: W.total(isCash ? 'play' : 'chips') };
}
function play(T, W) {
  quiet(() => T.startHand());
  if (!T.handLive()) return null;
  const h = T.hand, r = { button: h.button, bb: h.bbSeat, sb: h.sbSeat, dealt: T.players().filter(s => s.dealt).map(s => s.key), bbKey: T.seats.get(h.bbSeat).key, sbKey: T.seats.get(h.sbSeat).key };
  for (let g = 0; g < 20 && T.handLive() && T.hand.phase === 'betting'; g++) { const la = engine.legalActions(T.hand, T.hand.toAct); T.act(T.seats.get(T.hand.toAct).key, { type: la.canCheck ? 'check' : 'call' }); }
  for (let g = 0; g < 10 && T.handLive(); g++) W.clock.advance(2000);
  return r;
}

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';

  // Whatever seat number he picks (every one of the 8), the returner owing the big blind posts it in his first hand back.
  t(`${tag}: heads-up, a returner owing the big blind is the big blind in his first hand back in every seat number`, () => {
    for (let to = 0; to < 8; to++) {
      for (const aSeat of [0, 3, 7]) {
        if (to === aSeat) continue;
        const { W, T, cur, total0 } = setup(mode, ['a', 'd'], [aSeat, aSeat === 0 ? 1 : 0]);
        play(T, W); play(T, W);
        quiet(() => { T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: to }); });
        eq(T.seatOfKey('d').missedBlind, true, 'owes at sit');
        const r = play(T, W);
        ok(r, 'a hand is dealt');
        eq(r.dealt.sort(), ['a', 'd'], `both dealt (a at ${aSeat}, d to ${to})`);
        eq(r.bbKey, 'd', `d is the big blind (a at ${aSeat}, d to ${to})`);
        eq(r.sbKey, 'a', 'a is the button / small blind');
        eq(T.seatOfKey('d').missedBlind, false, 'the big blind clears the debt');
        eq(W.total(cur), total0, 'ledger conserved');
      }
    }
  });

  t(`${tag}: after that big blind the debt is cleared and the button moves on normally`, () => {
    const { W, T } = setup(mode, ['a', 'd'], [0, 1]);
    play(T, W);
    quiet(() => { T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: 5 }); });
    const r1 = play(T, W), r2 = play(T, W), r3 = play(T, W);
    eq(r1.bbKey, 'd', 'first hand back: d is the big blind');
    eq(r2.bbKey, 'a', 'next hand: the button moved on, a is the big blind');
    eq(r3.bbKey, 'd', 'and back again');
    eq(r2.sbKey, 'd', 'd is the small blind in the hand after');
  });

  t(`${tag}: heads-up seat hopping for 80 hands: the hopper posts the big blind in every hand he hops, never the button`, () => {
    for (const aSeat of [0, 3]) {
      const { W, T, cur, total0 } = setup(mode, ['a', 'd'], [aSeat, aSeat === 0 ? 1 : 0]);
      let hops = 0, hopSb = 0, bbD = 0;
      for (let i = 0; i < 80; i++) {
        const mine = T.seatOfKey('d'), others = [0, 1, 2, 3, 4, 5, 6, 7].filter(n => n !== aSeat && n !== mine.seat);
        quiet(() => { T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: others[i % others.length] }); }); hops++;
        const r = play(T, W);
        if (r.sbKey === 'd') hopSb++;
        if (r.bbKey === 'd') bbD++;
      }
      eq(hopSb, 0, `the hopper never gets the small blind / button (a at ${aSeat})`);
      eq(bbD, 80, 'he posts the big blind every hand');
      eq(W.total(cur), total0, 'ledger conserved');
    }
  });

  t(`${tag}: a player who never left is not affected: 80 hands, 40 big blinds each`, () => {
    const { W, T } = setup(mode, ['a', 'd'], [0, 1]);
    const bb = { a: 0, d: 0 };
    for (let i = 0; i < 80; i++) bb[play(T, W).bbKey]++;
    eq(bb, { a: 40, d: 40 });
  });

  t(`${tag}: a player who was never at the table is dealt in at once, heads-up too`, () => {
    const W2 = setup(mode, ['a', 'e'], [0, 4]);
    const r = play(W2.T, W2.W);
    eq(r.dealt.sort(), ['a', 'e']);
  });

  t(`${tag}: 3-handed, one waits and two play: he waits for the big blind as before`, () => {
    const { W, T } = setup(mode, ['a', 'b', 'd'], [0, 1, 2]);
    play(T, W);
    quiet(() => { T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: 6 }); });
    eq(T.seatOfKey('d').missedBlind, true);
    let first = null;
    for (let i = 0; i < 6 && !first; i++) { const r = play(T, W); if (r && r.dealt.includes('d')) first = r; else eq(T.seatOfKey('d').missedBlind, true, 'still waiting when not dealt'); }
    ok(first, 'dealt in eventually');
    eq(first.bbKey, 'd', 'only as the big blind');
    eq(T.seatOfKey('d').missedBlind, false);
  });

  t(`${tag}: one player plays, two return owing: the first in ring order is the big blind, the second keeps waiting`, () => {
    const { W, T } = setup(mode, ['a', 'x', 'y'], [0, 1, 2]);
    play(T, W);
    quiet(() => { T.leave('x', 'leave'); T.leave('y', 'leave'); T.sit('x', { amount: 50000, seat: 4 }); T.sit('y', { amount: 50000, seat: 6 }); });
    const r = play(T, W);
    eq(r.sbKey, 'a'); ok(['x', 'y'].includes(r.bbKey));
    eq(r.dealt.length, 2, 'heads-up: only one of the two is dealt in');
    const other = r.bbKey === 'x' ? 'y' : 'x';
    eq(T.seatOfKey(other).missedBlind, true, 'the other still owes');
    eq(T.seatOfKey(r.bbKey).missedBlind, false);
  });
}
done();
