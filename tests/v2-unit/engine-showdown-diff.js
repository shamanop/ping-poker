'use strict';
// Differential check against the old server's showdown() (copied into engine-old-server.js): same board, same holes,
// same commitments and folds -> same money. Differences allowed: the odd chip (L1) and how the uncalled part is
// labelled (L3: old pays it as a win, new returns it; payouts + returned is what compares). OWNER: engine builder.
const L = require('./engine-lib');
const { assert, H, mulberry32, clone } = L;
const OLD = require('./engine-old-server');

const seatsOf = h => Object.keys(h.seats).map(Number).sort((a, b) => a - b);

// Plays random legal actions only (no foldOut) until showdown. exact => all amounts are multiples of UNIT.
function playToShowdown(rng, { exact, shove }) {
  const s = L.randomSetup(rng, { exact });
  const hand = H.createHand({ handNo: 1, button: s.button, sb: s.sb, bb: s.bb, seats: s.seats, deck: s.deck });
  for (let step = 0; step < 800 && (hand.phase === 'betting' || hand.phase === 'runout'); step++) {
    if (hand.phase === 'runout') { H.dealNext(hand); continue; }
    const la = H.legalActions(hand, hand.toAct);
    H.apply(hand, hand.toAct, L.legalPick(la, rng, { shove, exact }));
  }
  assert.strictEqual(hand.phase, 'showdown');
  return hand;
}

function compare(hand, exact, ctx) {
  const all = seatsOf(hand);
  const live = all.filter(s => !hand.seats[s].folded);
  if (live.length === 1) return 1; // fold-wins never went through the old showdown() (instantWin); covered by the rule and property tests
  const holes = {}, committed = {}, folded = new Set();
  for (const s of all) { holes[s] = hand.seats[s].hole; committed[s] = hand.seats[s].committed; if (hand.seats[s].folded) folded.add(s); }
  const old = OLD.oldShowdown(holes, committed, folded, hand.board);
  const r = H.settle(hand);
  let tol = 0;
  if (!exact) for (const p of r.pots) tol += p.winners.length - 1;
  let oldTotal = 0;
  for (const s of all) {
    const nu = r.payouts[s] + r.returned[s];
    oldTotal += old[s];
    const diff = Math.abs(nu - old[s]);
    // folded levels can split an old layer in two, so each distinct commitment level may add odd chips
    const bound = exact ? 0 : tol + new Set(all.map(x => committed[x])).size * 8;
    assert(diff <= bound, `${ctx}: seat ${s} new ${nu} (payout ${r.payouts[s]} + returned ${r.returned[s]}) vs old ${old[s]}, bound ${bound}`);
  }
  const total = all.reduce((t, s) => t + committed[s], 0);
  assert.strictEqual(oldTotal, total, `${ctx}: old showdown lost chips`);
  return live.length;
}

module.exports = function register(t, env) {
  t.case(`old-server showdown differential, exact amounts (no odd chips): ${env.hands} random hands, payouts + returned must match`, () => {
    const rng = mulberry32(env.seed * 31337 + 5);
    let n = 0;
    for (let i = 0; i < env.hands; i++) {
      const hand = playToShowdown(rng, { exact: true, shove: [0.05, 0.3, 0.7][i % 3] });
      if (compare(hand, true, `seed ${env.seed} hand ${i}`) > 1) n++;
    }
    assert(n > env.hands / 4, `only ${n} contested showdowns`);
  });

  t.case(`old-server showdown differential, arbitrary amounts: ${env.hands} random hands, equal up to the odd chip`, () => {
    const rng = mulberry32(env.seed * 7777 + 9);
    let n = 0;
    for (let i = 0; i < env.hands; i++) {
      const hand = playToShowdown(rng, { exact: false, shove: [0.05, 0.3, 0.7][i % 3] });
      if (compare(hand, false, `seed ${env.seed} hand ${i}`) > 1) n++;
    }
    assert(n > env.hands / 4, `only ${n} contested showdowns`);
  });

  t.case('old server pays the odd chip to the lowest seat index; the engine pays the first winner left of the button (L1)', () => {
    // Kim (seat 0, button) and Max (seat 2) split 125 after Lou (seat 1) folds the small blind
    const h = L.mk({ stacks: [1000, 1000, 1000], button: 0, holes: [['2c', '3d'], ['4c', '5d'], ['2d', '4h']], board: ['Ts', 'Jh', 'Qd', 'Kc', 'Ac'] });
    L.play(h, [[0, 'call'], [1, 'fold'], [2, 'check']]);
    for (let st = 0; st < 3; st++) L.play(h, [[2, 'check'], [0, 'check']]);
    const holes = {}, committed = {};
    for (const s of [0, 1, 2]) { holes[s] = h.seats[s].hole; committed[s] = h.seats[s].committed; }
    const old = OLD.oldShowdown(holes, committed, new Set([1]), h.board);
    const r = H.settle(h);
    assert.deepStrictEqual(old, { 0: 63, 1: 0, 2: 62 });
    assert.deepStrictEqual(r.payouts, { 0: 62, 1: 0, 2: 63 });
  });

  t.case('old server announces the uncalled part as a win; the engine reports it as returned (L3)', () => {
    const h = L.mk({ stacks: [5000, 1000], button: 0, holes: [['7c', '2d'], ['As', 'Ad']], board: ['3c', '8d', '9h', '4s', 'Kc'] });
    L.play(h, [[0, 'raise', 5000], [1, 'call']]);
    L.runOut(h);
    const holes = { 0: h.seats[0].hole, 1: h.seats[1].hole };
    const old = OLD.oldShowdown(holes, { 0: 5000, 1: 1000 }, new Set(), h.board);
    const r = H.settle(h);
    assert.deepStrictEqual(old, { 0: 4000, 1: 2000 });          // old: seat 0 "wins" its own 4000
    assert.deepStrictEqual(r.payouts, { 0: 0, 1: 2000 });       // new: seat 0 wins nothing
    assert.deepStrictEqual(r.returned, { 0: 4000, 1: 0 });      // and the 4000 is labelled returned
  });
};
