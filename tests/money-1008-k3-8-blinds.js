'use strict';
// Money hardening 1008, K3-8: a seat that missed a hand while sitting out (or away) is dealt in again only when the big blind reaches it
// (it waits, it never posts out of turn, it can never be the button). Without that rule a player sits out when a blind is due and sits in
// for the button: dealt in for free all night while the others pay every blind. Real engine, real ledger, fake clock.
const { world, quiet, suite, eq, ok } = require('./lib-money-1008-tables');
const engine = require('../engine/hand');
const { t, done } = suite(__filename);

function table(mode, n, opts) {
  const keys = ['k0', 'k1', 'k2', 'k3', 'k4'];
  const cash = {}; for (const k of keys) cash[k] = 1000000;
  const W = world({ keys, cash });
  const isCash = mode === 'play';
  const T = W.registry.create('k0', { name: 'Blinds', mode, buyIn: isCash ? { min: 500, max: 60000, default: 50000 } : { min: 100, max: 60000, default: 5000 }, blinds: isCash ? { sb: 100, bb: 200 } : { sb: 25, bb: 50 }, seats: 5, autoStart: false, actionTimerSec: 0 });
  W.stack = isCash ? 50000 : 5000; W.cur = isCash ? 'play' : 'chips';
  if (!isCash) for (const k of keys) W.service.ensureAccount(k);
  keys.slice(0, n).forEach((k, i) => T.sit(k, { amount: W.stack, seat: i }));
  W.total0 = W.total(W.cur);
  return { W, T };
}
// Play one hand: everybody folds to the big blind (checks when free), so the blinds are the only money that moves. Returns the record.
function play(T) {
  if (T.handLive()) throw new Error('hand still live');
  const waiting = T.players().filter(s => s.missedBlind && s.stack > 0 && s.connected && !s.sitOutNext && !s.leaving).map(s => s.key);
  const prevButton = T.button;
  quiet(() => T.startHand());
  if (!T.handLive()) return null;
  const h = T.hand, rec = { handNo: h.handNo, button: h.button, prevButton, sb: h.sbSeat, bb: h.bbSeat, dealt: T.players().filter(s => s.dealt).map(s => s.key), waiting, posted: {} };
  for (const s of T.players()) if (s.dealt) rec.posted[s.key] = (s.seat === h.sbSeat || s.seat === h.bbSeat) ? h.seats[s.seat].committed : 0;
  for (let g = 0; g < 20 && T.handLive() && T.hand.phase === 'betting' && T.hand.toAct != null; g++) {
    const la = engine.legalActions(T.hand, T.hand.toAct);
    T.act(T.seats.get(T.hand.toAct).key, { type: la.canCheck ? 'check' : 'fold' });
  }
  rec.keySeat = k => T.seatOfKey(k).seat;
  return rec;
}

for (const mode of ['play', 'chips']) {
  const tag = mode === 'play' ? 'Cash' : 'Chips';

  t(`${tag}: the dodger (sits out when a blind is due, sits in for the button) now posts: 80 hands, every return is dealt in as the big blind`, () => {
    const { W, T } = table(mode, 3);
    const posted = { k0: 0, k1: 0, k2: 0 }, dealt = { k0: 0, k1: 0, k2: 0 };
    let free = 0, returns = 0, firstAfterReturn = [];
    const wouldPost = () => {            // would k0 post a blind if the old rule dealt him in? (the cheat's own look at the next hand)
      const nos = T.players().filter(s => s.stack > 0 && s.connected && (s.key === 'k0' || !s.sitOutNext)).map(s => s.seat).sort((a, b) => a - b);
      const button = T.button == null ? nos[0] : (nos.find(n => n > T.button) ?? nos[0]);
      const ring = nos.filter(n => n > button).concat(nos.filter(n => n <= button));
      const sb = nos.length === 2 ? button : ring[0], bb = nos.length === 2 ? nos.find(n => n !== button) : ring[1];
      const me = T.seatOfKey('k0').seat; return me === sb || me === bb;
    };
    let wasOut = false;
    for (let i = 0; i < 80; i++) {
      const me = T.seatOfKey('k0'), want = wouldPost();
      if (me.sitOutNext !== want) quiet(() => T.sitOut('k0'));
      const r = play(T); if (!r) break;
      if (wasOut && r.dealt.includes('k0')) { returns++; firstAfterReturn.push(r.bb === T.seatOfKey('k0').seat); }
      wasOut = T.seatOfKey('k0').sitOutNext || !r.dealt.includes('k0');
      for (const k of r.dealt) { dealt[k]++; posted[k] += r.posted[k]; }
      if (r.dealt.includes('k0') && r.posted.k0 === 0 && !(i === 0)) free++;
    }
    ok(dealt.k0 > 0, 'he is dealt in sometimes');
    ok(posted.k0 > 0, 'the dodger paid blinds: ' + JSON.stringify(posted));
    eq(firstAfterReturn.every(Boolean), true, 'the first hand after each return is the big blind');
    ok(returns > 5, 'he returned several times: ' + returns);
    ok(posted.k0 >= 0.8 * Math.min(posted.k1, posted.k2), `his share of the blinds is not dodged: ${JSON.stringify(posted)}`);
    eq(W.total(W.cur), W.total0);
  });

  t(`${tag}: a returning seat does not post out of turn and is never the button; the button keeps moving through the seats that play`, () => {
    const { W, T } = table(mode, 4);
    const rec = [];
    rec.push(play(T)); rec.push(play(T));
    quiet(() => T.sitOut('k3'));
    for (let i = 0; i < 3; i++) rec.push(play(T));                       // k3 misses three hands
    quiet(() => T.sitOut('k3'));                                         // back in
    ok(T.seatOfKey('k3').missedBlind === true);
    const before = T.seatOfKey('k3').stack;
    for (let i = 0; i < 12; i++) {
      const r = play(T); rec.push(r);
      if (r.waiting.includes('k3') && !r.dealt.includes('k3')) eq(T.seatOfKey('k3').stack, before, 'a waiting seat has paid nothing');
      if (r.waiting.includes('k3')) ok(r.button !== 3, 'a waiting seat is never the button');
      if (r.dealt.includes('k3') && r.waiting.includes('k3')) { eq(r.bb, 3, 'dealt in only as the big blind'); ok(r.posted.k3 > 0); }
    }
    ok(rec.slice(5).some(r => r.dealt.includes('k3') && r.waiting.includes('k3')), 'he was dealt in again within 12 hands');
    // the button moves to the next seat in order among the seats that were free to play
    for (const r of rec.filter(Boolean)) {
      if (r.prevButton == null) continue;
      const nos = [0, 1, 2, 3].filter(n => r.dealt.includes('k' + n) && !r.waiting.includes('k' + n));
      const want = nos.find(n => n > r.prevButton) ?? nos[0];
      eq(r.button, want, 'button of hand ' + r.handNo);
    }
    eq(W.total(W.cur), W.total0);
  });

  t(`${tag}: heads-up: a seat that sits out and in again is dealt straight back in (no game to wait behind)`, () => {
    const { W, T } = table(mode, 2);
    play(T);
    quiet(() => T.sitOut('k1'));
    eq(play(T), null, 'one seat cannot play');
    quiet(() => T.sitOut('k1'));
    const r = play(T);
    ok(r && r.dealt.length === 2, 'both dealt in again at once');
    eq(T.seatOfKey('k1').missedBlind, false);
  });

  t(`${tag}: sitting out and in between two hands, with no hand dealt in between, owes nothing`, () => {
    const { W, T } = table(mode, 3);
    play(T);
    quiet(() => { T.sitOut('k2'); T.sitOut('k2'); });
    eq(T.seatOfKey('k2').missedBlind, false);
    const r = play(T); eq(r.dealt.length, 3);
  });

  t(`${tag}: a seat that was away (disconnected) for a hand waits for the big blind like a sit-out`, () => {
    const { W, T } = table(mode, 4);
    T.seatOfKey('k3').socketId = 'sock3';
    play(T);
    quiet(() => T.disconnect('sock3'));
    play(T);                                                               // dealt without him
    ok(T.seatOfKey('k3').missedBlind === true, 'he missed a hand');
    quiet(() => T.sit('k3', { amount: W.stack, socketId: 'sock3b' }));     // reconnects
    let dealtAgain = null;
    for (let i = 0; i < 8 && !dealtAgain; i++) { const r = play(T); if (r.dealt.includes('k3')) dealtAgain = r; else ok(r.button !== 3); }
    ok(dealtAgain, 'dealt in again'); eq(dealtAgain.bb, 3, 'as the big blind'); ok(dealtAgain.posted.k3 > 0);
  });

  t(`${tag}: a new seat joining a running table is dealt in at the next hand (the rule for new seats is unchanged)`, () => {
    const { W, T } = table(mode, 3);
    play(T); play(T);
    quiet(() => T.sit('k3', { amount: W.stack, seat: 3 }));
    eq(T.seatOfKey('k3').missedBlind, false);
    const r = play(T);
    ok(r.dealt.includes('k3'), 'dealt in at once, in whatever position the button gives');
  });

  t(`${tag}: a hand that is voided did not happen: the sit-out seat owes nothing for it`, () => {
    const { W, T } = table(mode, 3);
    play(T);
    quiet(() => T.sitOut('k2'));
    quiet(() => T.startHand());
    ok(T.handLive() && T.seatOfKey('k2').missedBlind === true);
    quiet(() => T.void('test'));
    eq(T.seatOfKey('k2').missedBlind, false);
  });

  t(`${tag}: a waiting seat that is not the big blind has no cards and no chips in the pot`, () => {
    const { W, T } = table(mode, 4);
    play(T); quiet(() => T.sitOut('k3')); play(T); quiet(() => T.sitOut('k3'));
    let waited = 0, dealtIn = 0;
    for (let i = 0; i < 6; i++) {
      const wasWaiting = T.seatOfKey('k3').missedBlind;
      quiet(() => T.startHand());
      const s = T.seatOfKey('k3');
      if (wasWaiting && !s.dealt) { waited++; eq(s.stack, W.stack); ok(!T.hand.seats[3]); eq(s.folded, false); }
      else if (wasWaiting && s.dealt) { dealtIn++; eq(T.hand.bbSeat, 3); }
      for (let g = 0; g < 20 && T.handLive() && T.hand.phase === 'betting'; g++) { const la = engine.legalActions(T.hand, T.hand.toAct); T.act(T.seats.get(T.hand.toAct).key, { type: la.canCheck ? 'check' : 'fold' }); }
    }
    ok(waited >= 1 && dealtIn === 1, `waited ${waited}, dealt in ${dealtIn}`);
  });
}
done();
