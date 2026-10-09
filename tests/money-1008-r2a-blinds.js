'use strict';
// Money hardening 1008, R2A-1: the missed-blind debt belongs to the PLAYER at the table, not to a seat number or a hand count.
// Standing up and sitting again (at once, or in another seat number) never clears it; only being dealt the big blind does.
// A player who was never at this table may still sit and be dealt in at the next hand. Real engine, real ledger, fake clock.
const { world, quiet, suite, eq, ok } = require('./lib-money-1008-tables');
const engine = require('../engine/hand');
const { t, done } = suite(__filename);

function setup(mode, others) {
  const keys = ['d', 'p1', 'p2', 'p3'], isCash = mode === 'play';
  const cash = {}; for (const k of keys) cash[k] = 1000000;
  const W = world({ keys, cash });
  if (!isCash) for (const k of keys) W.service.adminAdjust(k, 1000000, 'chips', 'seed', 'seedc:' + k);
  const T = W.registry.create('p1', { name: 'R2A', mode, buyIn: { min: 500, max: 60000, default: 50000 }, blinds: { sb: 100, bb: 200 }, seats: 8, autoStart: false, actionTimerSec: 30 });
  ['p1', 'p2', 'p3'].forEach((k, i) => T.sit(k, { amount: 50000, seat: others[i] }));
  return { W, T, cur: isCash ? 'play' : 'chips', total0: W.total(isCash ? 'play' : 'chips') };
}
// Deal one hand and check everybody out; returns { dealt: keys, bb, sb, posted } or null.
function play(T, W, rec) {
  quiet(() => T.startHand());
  if (!T.handLive()) return null;
  const h = T.hand, r = { bb: h.bbSeat, sb: h.sbSeat, dealt: [], posted: {} };
  for (const s of T.players()) if (s.dealt) { r.dealt.push(s.key); r.posted[s.key] = (s.seat === h.sbSeat || s.seat === h.bbSeat) ? h.seats[s.seat].committed : 0; }
  for (let g = 0; g < 20 && T.handLive() && T.hand.phase === 'betting'; g++) { const la = engine.legalActions(T.hand, T.hand.toAct); T.act(T.seats.get(T.hand.toAct).key, { type: la.canCheck ? 'check' : 'fold' }); }
  for (let g = 0; g < 10 && T.handLive(); g++) W.clock.advance(2000);
  if (rec) for (const k of r.dealt) { rec.dealt[k] = (rec.dealt[k] || 0) + 1; rec.posted[k] = (rec.posted[k] || 0) + r.posted[k]; }
  return r;
}

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';

  t(`${tag}: A) leave and sit again at once after missing hands: still waiting for the big blind, a second stand-up clears nothing`, () => {
    const { W, T } = setup(mode, [0, 1, 2]);
    quiet(() => T.sit('d', { amount: 50000, seat: 3 }));
    play(T, W);
    quiet(() => T.leave('d', 'leave'));
    play(T, W); play(T, W);                                                  // hands without him
    quiet(() => T.sit('d', { amount: 50000, seat: 3 }));
    eq(T.seatOfKey('d').missedBlind, true, 'waiting after missed hands');
    quiet(() => { T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: 3 }); });
    eq(T.seatOfKey('d').missedBlind, true, 'a second stand-up and sit still waits');
    quiet(() => { T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: 5 }); });
    eq(T.seatOfKey('d').missedBlind, true, 'another seat number still waits');
  });

  t(`${tag}: B) leaving between two hands and sitting in another seat number owes the big blind; he is dealt in only as the big blind`, () => {
    const { W, T } = setup(mode, [0, 2, 4]);
    quiet(() => T.sit('d', { amount: 50000, seat: 1 }));
    play(T, W);
    quiet(() => { T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: 6 }); });
    eq(T.seatOfKey('d').missedBlind, true, 'no hand was missed, the debt is there anyway');
    let dealtD = 0;
    for (let i = 0; i < 12; i++) { const r = play(T, W); if (r && r.dealt.includes('d')) { dealtD++; eq(r.bb, T.seatOfKey('d').seat, 'dealt in only as the big blind'); break; } }
    eq(dealtD, 1, 'the big blind reached him');
    eq(T.seatOfKey('d').missedBlind, false, 'being dealt the big blind clears it');
  });

  t(`${tag}: 80 hands of hopping (variant A and B): the hopper posts at least a share of the blinds, never plays a free position`, () => {
    for (const variant of ['A', 'B']) {
      const others = variant === 'A' ? [0, 1, 2] : [0, 2, 4];
      const { W, T, cur, total0 } = setup(mode, others);
      const rec = { dealt: {}, posted: {} };
      let freeDeals = 0;
      for (let i = 0; i < 80; i++) {
        const mine = T.seatOfKey('d');
        if (variant === 'A') {
          if (mine) quiet(() => T.leave('d', 'leave'));
          else { quiet(() => T.sit('d', { amount: 50000, seat: 3 })); quiet(() => { T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: 3 }); }); }
        } else {
          const free = [0, 1, 2, 3, 4, 5, 6, 7].filter(n => !others.includes(n) && (!mine || n !== mine.seat));
          const to = free[i % free.length];
          quiet(() => { if (mine) T.leave('d', 'leave'); T.sit('d', { amount: 50000, seat: to }); });
        }
        const r = play(T, W, rec);
        if (i > 0 && r && r.dealt.includes('d') && r.bb !== T.seatOfKey('d').seat) freeDeals++;   // hand 0: his first sit at this table, no debt yet
      }
      eq(freeDeals, 0, `variant ${variant}: dealt in outside the big blind`);
      ok((rec.dealt.d || 0) === 0 || (rec.posted.d || 0) > 0, `variant ${variant}: dealt ${rec.dealt.d || 0} hands, posted ${rec.posted.d || 0}`);
      eq(W.total(cur), total0, 'ledger conserved');
    }
  });

  t(`${tag}: a player who was never at this table is dealt in at once`, () => {
    const { W, T } = setup(mode, [0, 1, 2]);
    play(T, W);
    quiet(() => T.sit('d', { amount: 50000, seat: 3 }));
    eq(T.seatOfKey('d').missedBlind, false);
    const r = play(T, W);
    ok(r && r.dealt.includes('d'), 'dealt at the next hand');
  });
}
done();
