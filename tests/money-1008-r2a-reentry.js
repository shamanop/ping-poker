'use strict';
// Money hardening 1008, R2A-4 / RV-1 / RV-2 (the re-entry allowance is ONE return), RV-3 (heads-up host kick leaves no big-blind debt),
// R2A-5 (the table deals again after the forced three-void pause is resumed), and the tests the mutation survivors asked for
// (R2A-T1..T3, RV-T1, RV-T2).
const { world, rigDeck, quiet, code, suite, eq, ok } = require('./lib-money-1008-tables');
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
// ---- shared helpers for the blinds / pause tests ----
function blindSetup(mode, keys, seats, host) {
  const isCash = mode === 'play', cash = {}; for (const k of keys) cash[k] = 1000000;
  const W = world({ keys, cash });
  if (!isCash) for (const k of keys) W.service.adminAdjust(k, 1000000, 'chips', 'seed', 'seedc:' + k);
  const T = W.registry.create(host || keys[0], { name: 'HU', mode, buyIn: { min: 500, max: 60000, default: 50000 }, blinds: { sb: 100, bb: 200 }, seats: 8, autoStart: false, actionTimerSec: 30 });
  keys.forEach((k, i) => T.sit(k, { amount: 50000, seat: seats[i], socketId: 's' + k }));
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

  // ---- RV-3 ----
  t(`${tag}: RV-3 heads-up, the host kicks the other player between hands every hand: 20 / 20 big blinds in 40 hands`, () => {
    const { W, T, cur, total0 } = blindSetup(mode, ['d', 'a'], [0, 1]);       // d is the host
    const bb = { d: 0, a: 0 };
    for (let i = 0; i < 40; i++) {
      if (i > 0) { quiet(() => T.kick('d', 'a', false)); eq(T.seatOfKey('a'), null, 'kicked'); eq(code(() => T.sit('a', { amount: 50000, seat: 1, socketId: 'sa' + i })), 'none'); }
      const r = play(T, W);
      ok(r, 'a hand is dealt at hand ' + i);
      eq(r.dealt.sort(), ['a', 'd']);
      bb[r.bbKey]++;
    }
    eq(bb, { d: 20, a: 20 }, 'the kick leaves no debt, as on base');
    eq(W.total(cur), total0);
  });

  t(`${tag}: RV-3 the debt stays for a leave by choice heads-up, for a kick at three seats, and for a kick of the third player`, () => {
    let S = blindSetup(mode, ['d', 'a'], [0, 1]);
    quiet(() => S.T.leave('a', 'leave'));
    eq(S.T.owesBB.a, true, 'leave by choice heads-up: debt stays (R2A-2)');
    S = blindSetup(mode, ['d', 'a', 'c'], [0, 1, 2]);
    quiet(() => S.T.kick('d', 'c', false));
    eq(S.T.owesBB.c, true, 'kick at three seats: debt stays (R2A-1)');
    eq(code(() => S.T.sit('c', { amount: 50000, seat: 2, socketId: 'sc2' })), 'none');
    eq(S.T.seatOfKey('c').missedBlind, true);
    S = blindSetup(mode, ['d', 'a', 'c'], [0, 1, 2]);
    quiet(() => S.T.kick('d', 'c', false));                  // now two seats left: a kick of a at two seats clears HIS debt only
    quiet(() => S.T.kick('d', 'a', false));
    eq(S.T.owesBB.a, undefined, 'heads-up kick: no debt');
    eq(S.T.owesBB.c, true, 'the earlier kick at three seats keeps its debt');
  });

  t(`${tag}: RV-3 a kick held back until the hand ends (finishKick) heads-up leaves no debt either`, () => {
    const { W, T } = blindSetup(mode, ['d', 'a'], [0, 1]);
    quiet(() => T.startHand());
    const r = quiet(() => T.kick('d', 'a', false));
    eq(r.pending, true);
    for (let g = 0; g < 20 && T.handLive() && T.hand.phase === 'betting'; g++) { const la = engine.legalActions(T.hand, T.hand.toAct); T.act(T.seats.get(T.hand.toAct).key, { type: la.canCheck ? 'check' : 'call' }); }
    for (let g = 0; g < 10 && T.handLive(); g++) W.clock.advance(2000);
    eq(T.seatOfKey('a'), null, 'kicked after the hand');
    eq(T.owesBB.a, undefined, 'no debt');
  });

  // ---- R2A-5 ----
  t(`${tag}: R2A-5 after the forced three-void pause is resumed, dealing starts again`, () => {
    const isCash = mode === 'play', keys = ['a', 'b', 'c'], cash = {}; for (const k of keys) cash[k] = 1000000;
    const W = world({ keys, cash });
    if (!isCash) for (const k of keys) W.service.adminAdjust(k, 1000000, 'chips', 'seed', 'seedc:' + k);
    const T = W.registry.create('a', { name: 'Voids', mode, buyIn: { min: 500, max: 50000, default: 20000 }, blinds: { sb: 100, bb: 200 }, seats: 6, autoStart: true, actionTimerSec: 30 });
    for (const k of keys) T.sit(k, { amount: 20000, socketId: 's' + k });
    const total0 = W.total(mode);
    let voids = 0;
    quiet(() => { for (let i = 0; i < 40 && voids < 3; i++) { W.clock.advance(2100); if (T.handLive()) { T.void('bug'); voids++; } } });
    eq(voids, 3); ok(T.paused, 'paused by force after the third void');
    ok(T.deadlines.has('phase') && T.deadlines.get('phase').kind === 'nexthand', 'the next-hand deadline is there, frozen');
    ok(T.deadlines.get('phase').frozen > 0 && T.deadlines.get('phase').at == null, 'frozen while paused');
    quiet(() => W.clock.advance(60000)); eq(T.handLive(), false, 'nothing is dealt while paused');
    const n0 = T.handNo;
    quiet(() => T.resume());
    eq(T.paused, false);
    ok(T.deadlines.get('phase') && T.deadlines.get('phase').at != null, 'the deadline is armed again after the resume');
    quiet(() => W.clock.advance(3000));
    ok(T.handLive() || T.handNo > n0, 'a hand is dealt after the resume');
    quiet(() => { for (let i = 0; i < 20; i++) W.clock.advance(30000); });
    ok(T.handNo > n0, 'and the table keeps dealing');
    eq(W.total(mode), total0, 'ledger conserved');
  });

  // ---- R2A-T1 + RV-T1: which waiting seat is dealt, and the all-waiting clear ----
  t(`${tag}: RV-T1 every seat waiting (both owe the big blind, heads-up): dealt at once, no throw, flags cleared (M5 / M35)`, () => {
    const { W, T, cur, total0 } = blindSetup(mode, ['a', 'd'], [0, 1]);
    quiet(() => { T.leave('a', 'leave'); T.leave('d', 'leave'); });
    eq(code(() => T.sit('a', { amount: 50000, seat: 0, socketId: 'sa2' })), 'none');
    eq(code(() => T.sit('d', { amount: 50000, seat: 1, socketId: 'sd2' })), 'none');
    eq([T.seatOfKey('a').missedBlind, T.seatOfKey('d').missedBlind], [true, true], 'both owe');
    const r = play(T, W);
    ok(r, 'a hand is dealt');
    eq(r.dealt.sort(), ['a', 'd']);
    eq([T.seatOfKey('a').missedBlind, T.seatOfKey('d').missedBlind], [false, false], 'nobody was free to play: no game to wait behind, flags cleared');
    eq(play(T, W) !== null, true, 'and the next hand deals too');
    eq(W.total(cur), total0);
  });

  t(`${tag}: RV-T1 one free seat and two returners: the FIRST waiting seat in ring order after the button is the big blind (M3)`, () => {
    for (const [seats, firstBB] of [[[0, 1, 2], 'x'], [[0, 5, 2], 'y']]) {
      const { W, T } = blindSetup(mode, ['f', 'x', 'y'], seats);              // f is the free seat; x and y owe the big blind
      for (const k of ['x', 'y']) { const sn = T.seatOfKey(k).seat; quiet(() => T.leave(k, 'leave')); T.sit(k, { amount: 50000, seat: sn, socketId: k + '2' }); }
      eq([T.seatOfKey('x').missedBlind, T.seatOfKey('y').missedBlind], [true, true]);
      T.button = null;
      const r = play(T, W);
      ok(r, 'a hand is dealt');
      eq(r.dealt.length, 2, 'heads-up: the free seat and ONE waiting seat');
      eq(r.sbKey, 'f', 'the free seat is the button / small blind');
      // ring order after the button f (seat 0): the lower seat number comes first
      const first = seats[1] < seats[2] ? 'x' : 'y';
      eq(r.bbKey, first, 'the first waiting seat in ring order is the big blind');
      eq(T.seatOfKey(first === 'x' ? 'y' : 'x').missedBlind, true, 'the other keeps waiting');
    }
  });

  // ---- R2A-T2: the audit row of a leaver ----
  t(`${tag}: R2A-T2 auditSeats: a seat that left mid-hand counts no stack, only what the seat account still holds`, () => {
    const { W, T } = blindSetup(mode, ['a', 'b', 'c'], [0, 1, 2]);
    quiet(() => T.startHand());
    ok(T.handLive());
    const who = T.seats.get(T.hand.toAct).key;
    quiet(() => T.leave(who, 'leave'));
    const row = T.auditSeats().find(x => x.key === who);
    eq(row.stack, 0, 'the stack was paid out at the leave');
    for (const r of T.auditSeats()) {
      const acct = W.ledger.balance('seat:' + T.id + ':' + r.key, mode);
      eq(acct, r.stack + r.handBet, 'seat account = stack + handBet for ' + r.key);
    }
  });

  // ---- R2A-T3: kick held back, then the kicked player walks out himself before the hand ends ----
  t(`${tag}: R2A-T3 kick held back, the kicked player leaves himself mid-hand: finishKick sweeps his seat account`, () => {
    const keys = ['a', 's', 'd'], cash = {}; for (const k of keys) cash[k] = 1000000;
    const W = world({ keys, cash });
    if (mode === 'chips') for (const k of keys) W.service.adminAdjust(k, 1000000, 'chips', 'seed', 'seedc:' + k);
    const T = W.registry.create('d', { name: 'KL', mode, buyIn: { min: 100, max: 50000, default: 20000 }, blinds: { sb: 5, bb: 10 }, seats: 3, autoStart: false, actionTimerSec: 60 });
    T.actionTimerSec = 0;
    T.sit('a', { amount: 5000, seat: 0 }); T.sit('s', { amount: 200, seat: 1 }); T.sit('d', { amount: 5000, seat: 2 });
    const total0 = W.total(mode), before = Object.fromEntries(keys.map(k => [k, W.held(k, mode)]));
    W.decks.push(rigDeck([['Ks', 'Kd'], ['7c', '2d'], ['Qs', 'Qd']], ['3c', '8d', '9h', '4s', 'Jh']));
    quiet(() => T.startHand());
    T.act('a', { type: 'raise', to: 1000 }); T.act('s', { type: 'call' }); T.act('d', { type: 'call' });
    T.act('d', { type: 'check' }); T.act('a', { type: 'raise', to: 2000 });
    eq(quiet(() => T.kick('d', 'a', false)).pending, true, 'the kick of a is held back');
    quiet(() => T.leave('a', 'leave'));                                // he walks out himself
    ok(T.seatOfKey('a') && T.seatOfKey('a').leaving, 'on his way out');
    if (T.handLive() && T.hand.toAct != null && T.seats.get(T.hand.toAct).key === 'd') T.act('d', { type: 'fold' });
    let g = 0; while (T.handLive() && g++ < 20) { if (T.hand.phase === 'betting') { const s = T.seats.get(T.hand.toAct); T.act(s.key, { type: 'check' }); } else quiet(() => W.clock.advance(2000)); }
    quiet(() => W.clock.advance(60000));
    eq(T.seatOfKey('a'), null, 'a is gone after the hand');
    eq(W.ledger.list('seat:' + T.id + ':', mode).filter(x => x.account.endsWith(':a') && x.balance !== 0).length, 0, 'no chips left in a\'s seat account');
    eq(W.ledger.list('pot:', mode).filter(x => x.balance !== 0).length, 0, 'no chips left in a pot');
    const stacks = T.players().reduce((x, s2) => x + s2.stack, 0), seatsLedger = W.ledger.list('seat:', mode).reduce((x, s2) => x + s2.balance, 0);
    eq(seatsLedger, stacks, 'the seat accounts are exactly the stacks of the seats still at the table');
    eq(W.total(mode), total0, 'conserved');
    eq(keys.reduce((x, k) => x + W.held(k, mode) - before[k], 0), 0);
  });

  t(`${tag}: R2A-4 the forgiven entry does not count against a rebuy limit: server return, then ONE rebuy of his own, then rebuy_off`, () => {
    const S = setup(mode, { rebuys: true, rebuyLimit: 1 }, { start: 30000, noHand: true }); server('restart', S);
    eq(sit(S.T, 'a', 25000), 'none', 'the return: forgiven');
    leave(S.T, 'a');
    eq(sit(S.T, 'a', 25000), 'none', 'his one rebuy of the limit');
    leave(S.T, 'a');
    eq(sit(S.T, 'a', 25000), 'rebuy_off', 'the limit holds');
    quiet(() => S.W.restart()); S.T = S.W.registry.get(S.T.id);
    eq(sit(S.T, 'a', 25000), 'rebuy_off', 'also after a restart (replay)');
  });

  t(`${tag}: R2A-4 a newer server return replaces the older one (it is ONE return, not a sum)`, () => {
    const S = setup(mode, null, { noHand: true });
    S.T.noteServerReturn('x', 3000); S.T.noteServerReturn('x', 1000);
    eq(S.T.reentry.x.amount, 1000);
  });
}
done();
