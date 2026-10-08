'use strict';
// Money hardening 2026-10-08, engine side. Plain node: exit 0 on pass, 1 on fail.
//   K3-2  a seat all-in for X never wins more than X from each other seat; a pot is paid only to seats that put chips into it;
//         nobody still in the hand is asked to call a bet whose owner was folded out (kick / leave).
//   K3-3  a short big blind does not create a bet nobody made; the unmatched part of a bet or blind goes back to its owner,
//         also when the owner folds.
//   K1-4  split-pot odd chips are paid one each, first seat left of the button first (a dropped remainder voids the hand).
//   plus a fuzz over 2-9 seats with short blinds, forced folds and voluntary folds.
const path = require('path');
const L = require('./v2-unit/engine-lib');
const { assert, H, mk, play, runOut, finish, mulberry32, randomSetup, legalPick } = L;
const { sidePots } = require('../engine/pots');

const cases = [];
const t = (name, fn) => cases.push({ name, fn });
const ROYAL = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
const DRY = ['3c', '8d', '9h', '4s', 'Jh'];

// ─── K3-3 ────────────────────────────────────────────────────────────────────
t('K3-3 heads-up: big blind all-in for less than the small blind -> nobody is asked to call, the rest of the small blind comes back', () => {
  const h = mk({ stacks: { 0: 10000, 1: 2 }, button: 0, sb: 20, bb: 40, holes: [['Ks', 'Kd'], ['As', 'Ad']], board: DRY });
  assert.notStrictEqual(h.phase, 'betting', 'the small blind must not be asked to call a bet nobody made');
  assert.strictEqual(h.toAct, null);
  const r = finish(h);
  assert.strictEqual(r.returned[0], 18);
  assert.deepStrictEqual(r.net, { 0: -2, 1: 2 });
  assert.strictEqual(h.seats[0].stack, 10000 - 2);
});

t('K3-3 3-handed: the button is asked to call what the small blind put in (not the full blind); a fold loses at most the short big blind', () => {
  const h = mk({ stacks: { 0: 10000, 1: 10000, 2: 2 }, button: 0, sb: 20, bb: 40, holes: [['Ks', 'Kd'], ['Qs', 'Qd'], ['As', 'Ad']], board: DRY });
  assert.strictEqual(h.toAct, 0);
  assert.strictEqual(H.legalActions(h, 0).toCall, 20, 'to call is the small blind, a bet that exists');
  play(h, [[0, 'fold']]);
  assert.strictEqual(h.phase, 'runout', 'the small blind has nothing left to call');
  const r = finish(h);
  assert.strictEqual(r.returned[1], 18);
  assert.deepStrictEqual(r.net, { 0: 0, 1: -2, 2: 2 });
});

t('K3-3 the turn clock cannot fold anyone into a loss: the small blind against a short big blind is never to act', () => {
  const h = mk({ stacks: { 0: 10000, 1: 10 }, button: 0, sb: 20, bb: 40 });
  assert.strictEqual(h.toAct, null);
  for (const s of [0, 1]) assert.strictEqual(H.legalActions(h, s), null);
});

t('K3-3 a big blind all-in for MORE than the small blind but less than bb: to call is what he put in', () => {
  const h = mk({ stacks: { 0: 10000, 1: 30 }, button: 0, sb: 20, bb: 40 });
  assert.strictEqual(h.currentBet, 30);
  assert.strictEqual(H.legalActions(h, 0).toCall, 10);
});

t('K3-3 normal blinds are unchanged (to call is the big blind)', () => {
  const h = mk({ stacks: [1000, 1000, 1000], button: 0, sb: 25, bb: 50 });
  assert.strictEqual(h.currentBet, 50);
  assert.strictEqual(H.legalActions(h, h.toAct).toCall, 50);
});

t('K3-3 a short small blind calling all-in: the part of the big blind above it goes back to the big blind', () => {
  const h = mk({ stacks: { 0: 1000, 1: 30, 2: 1000 }, button: 0, sb: 20, bb: 40, holes: [['2c', '3d'], ['As', 'Ad'], ['7c', '8d']], board: DRY });
  play(h, [[0, 'fold'], [1, 'call']]);
  const r = finish(h);
  assert.strictEqual(r.returned[2], 10, 'the 10 above the all-in call goes back to the big blind');
  assert.deepStrictEqual(r.net, { 0: 0, 1: 30, 2: -30 });
});

// ─── K3-2 ────────────────────────────────────────────────────────────────────
function k32Hand(shortBest) {
  const holes = shortBest ? [['Ks', 'Kd'], ['As', 'Ad'], ['7c', '2d']] : [['Ks', 'Kd'], ['7c', '2d'], ['As', 'Ad']];
  const h = mk({ stacks: { 0: 20000, 1: 2000, 2: 20000 }, button: 0, sb: 50, bb: 100, holes, board: DRY });
  play(h, [[0, 'raise', 2000], [1, 'call'], [2, 'call']]);        // seat 1 all-in for 2000
  assert.strictEqual(h.street, 'flop');
  play(h, [[2, 'raise', 5000], [0, 'call']]);
  assert.strictEqual(h.street, 'turn');
  play(h, [[2, 'raise', 3000]]);
  return h;
}

t('K3-2 a kicked bettor: the last deep stack is not asked to call his bet and wins the side pot; the short stack gets only its 3 x 2000', () => {
  const h = k32Hand(true);
  assert.strictEqual(h.toAct, 0);
  assert.strictEqual(H.legalActions(h, 0).toCall, 3000);
  H.foldOut(h, 2);                                               // host kicks seat 2 mid-hand
  assert.notStrictEqual(h.phase, 'betting', 'seat 0 is not asked to call a bet whose owner is gone');
  const r = finish(h);
  assert.deepStrictEqual(r.returned, { 0: 0, 1: 0, 2: 3000 });
  assert.deepStrictEqual(r.payouts, { 0: 10000, 1: 6000, 2: 0 });
  assert.deepStrictEqual(r.net, { 0: 3000, 1: 4000, 2: -7000 });
});

t('K3-2 the same with the short stack holding the worst hand: it cannot win anything', () => {
  const h = k32Hand(false);
  H.foldOut(h, 2);
  const r = finish(h);
  assert.strictEqual(r.payouts[1], 0);
  assert.strictEqual(r.payouts[0], 16000);
});

t('K3-2 the deep stack that is asked first leaves instead: the other deep stack is the only one in the side pot and takes it', () => {
  const h = k32Hand(true);
  H.foldOut(h, 0);                                              // seat 0 is the one to act, facing 3000
  assert.notStrictEqual(h.phase, 'betting');
  const r = finish(h);
  assert.deepStrictEqual(r.returned, { 0: 0, 1: 0, 2: 3000 });
  assert.deepStrictEqual(r.payouts, { 0: 0, 1: 6000, 2: 10000 });
  assert.strictEqual(r.net[1], 4000);
});

t('K3-2 both deep stacks leave: the short stack gets only its main pot; the deep stacks get their own chips back, nobody is paid from a pot he is not in', () => {
  const h = k32Hand(true);
  H.foldOut(h, 2);
  H.foldOut(h, 0);
  assert.strictEqual(h.phase, 'showdown');
  const r = finish(h);
  assert.deepStrictEqual(r.payouts, { 0: 5000, 1: 6000, 2: 5000 });
  assert.deepStrictEqual(r.net, { 0: -2000, 1: 4000, 2: -2000 - 3000 + 3000 - 0 + 0 });
});

t('K3-2 pots.js: chips above the highest live commitment are never added to a pot of someone who did not match them', () => {
  // seat 1 live for 2000; seats 0 and 2 folded having put in 7000 each
  const pots = sidePots({ 0: 7000, 1: 2000, 2: 7000 }, [0, 2]);
  assert.deepStrictEqual(pots[0], { amount: 6000, eligible: [1] });
  const total = pots.reduce((a, p) => a + p.amount, 0);
  assert.strictEqual(total, 16000);
  for (const p of pots.slice(1)) {
    assert.deepStrictEqual(p.eligible, [], 'no live seat is in this layer');
    assert.deepStrictEqual(p.refund, { 0: 5000, 2: 5000 });
  }
});

t('K3-2 pots.js: a live seat that is the only one in a layer takes it', () => {
  const pots = sidePots({ 0: 7000, 1: 2000, 2: 7000 }, [2]);
  assert.deepStrictEqual(pots, [{ amount: 6000, eligible: [0, 1] }, { amount: 10000, eligible: [0] }]);
});

t('K3-2 pots.js: the old walk-over case still pays the live seat the dead money', () => {
  assert.deepStrictEqual(sidePots({ 0: 5, 1: 10 }, [0, 1]).length, 0);
  assert.deepStrictEqual(sidePots({ 0: 5, 1: 10, 2: 0 }, [0, 1]), [{ amount: 15, eligible: [2] }]);
});

// ─── K1-4 ────────────────────────────────────────────────────────────────────
t('K1-4 two-way split of an odd pot: 15 -> 8 to the first seat left of the button, 7 to the other', () => {
  const h = mk({ stacks: [1000, 1000, 1000], button: 0, sb: 1, bb: 3, holes: [['2c', '3d'], ['4c', '5d'], ['6c', '7d']], board: ROYAL });
  play(h, [[0, 'raise', 6], [1, 'call'], [2, 'fold']]);
  while (h.phase === 'betting') play(h, [[h.toAct, 'check']]);
  const r = finish(h);
  assert.deepStrictEqual(r.pots, [{ amount: 15, eligible: [0, 1], winners: [1, 0] }]);
  assert.deepStrictEqual(r.payouts, { 0: 7, 1: 8, 2: 0 });
  assert.strictEqual(r.payouts[0] + r.payouts[1], 15);
});

t('K1-4 three-way split of an odd pot: 19 -> 7, 6, 6 in order from the button', () => {
  const h = mk({ stacks: [1000, 1000, 1000, 1000], button: 0, sb: 1, bb: 3, holes: [['2c', '3d'], ['4c', '5d'], ['6c', '7d'], ['8c', '9d']], board: ROYAL });
  play(h, [[3, 'raise', 6], [0, 'call'], [1, 'fold'], [2, 'call']]);
  while (h.phase === 'betting') play(h, [[h.toAct, 'check']]);
  const r = finish(h);
  assert.deepStrictEqual(r.pots, [{ amount: 19, eligible: [0, 2, 3], winners: [2, 3, 0] }]);
  assert.deepStrictEqual(r.payouts, { 0: 6, 1: 0, 2: 7, 3: 6 });
});

t('K1-4 an odd main pot split by two winners while a short all-in loses: 33 -> 17 to the first seat left of the button, 16 to the other', () => {
  const h = mk({ stacks: { 0: 11, 1: 1000, 2: 1000 }, button: 0, sb: 1, bb: 2, holes: [['7c', '8d'], ['As', 'Ad'], ['Ah', 'Ac']], board: ['2c', '2d', '3h', '3s', '4c'] });
  play(h, [[0, 'raise', 11], [1, 'call'], [2, 'call']]);
  while (h.phase === 'betting') play(h, [[h.toAct, 'check']]);
  const r = finish(h);
  assert.deepStrictEqual(r.pots, [{ amount: 33, eligible: [0, 1, 2], winners: [1, 2] }]);
  assert.deepStrictEqual(r.payouts, { 0: 0, 1: 17, 2: 16 });
  assert.strictEqual(r.payouts[0] + r.payouts[1] + r.payouts[2], 33);
});

// ─── fuzz: short blinds, forced and voluntary folds, 2-9 seats ───────────────
function fuzz(hands, seed) {
  const rng = mulberry32(seed);
  const stat = { hands: 0, short: 0, forced: 0, orphan: 0, allin: 0, walk: 0 };
  for (let it = 0; it < hands; it++) {
    const setup = randomSetup(rng, {});
    // lots of short stacks so blinds are often posted short
    if (rng() < 0.5) for (const s of setup.seats) if (rng() < 0.4) s.stack = 1 + Math.floor(rng() * Math.max(1, setup.sb * 2));
    const h = H.createHand({ handNo: it + 1, ...setup });
    const ctx = `seed ${seed} hand ${it + 1}`;
    const liveMax = () => Math.max(0, ...Object.keys(h.seats).map(Number).filter(s => !h.seats[s].folded).map(s => h.seats[s].bet));
    if (Object.values(h.seats).some(s => s.committed < setup.sb && s.allIn)) stat.short++;
    let guard = 0;
    while (h.phase === 'betting' && guard++ < 400) {
      assert(h.currentBet <= liveMax(), `${ctx}: currentBet ${h.currentBet} is above every live seat's bet ${liveMax()}`);
      const toAct = h.toAct;
      const la = H.legalActions(h, toAct);
      assert(la, `${ctx}: no legal actions for the seat to act`);
      assert(la.toCall <= liveMax() - h.seats[toAct].bet || la.toCall === 0, `${ctx}: asked to call more than another live seat has put in`);
      const r = rng();
      if (r < 0.08) {                                                  // someone is kicked / leaves (not necessarily the seat to act)
        const live = Object.keys(h.seats).map(Number).filter(s => !h.seats[s].folded);
        H.foldOut(h, live[Math.floor(rng() * live.length)]);
        stat.forced++;
      } else if (r < 0.12 && la.canCheck) H.apply(h, toAct, { type: 'fold' }); // a voluntary fold with nothing to call
      else H.apply(h, toAct, legalPick(la, rng, { shove: 0.25 }));
    }
    if (h.phase === 'runout' && rng() < 0.2) { const live = Object.keys(h.seats).map(Number).filter(s => !h.seats[s].folded); if (live.length > 1) H.foldOut(h, live[0]); }
    runOut(h);
    if (h.phase !== 'showdown') continue;
    const committed = {}, sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    for (const s of Object.keys(h.seats)) committed[s] = h.seats[s].committed;
    const r = H.settle(h);
    stat.hands++;
    if (Object.values(h.seats).some(s => s.allIn)) stat.allin++;
    assert.strictEqual(sum(r.payouts) + sum(r.returned), sum(committed), `${ctx}: payouts + returned != committed`);
    const net = {};
    for (const s of Object.keys(h.seats)) {
      assert(h.seats[s].stack >= 0, `${ctx}: negative stack`);
      net[s] = committed[s] - r.returned[s];
      assert(net[s] >= 0 && r.returned[s] >= 0 && r.payouts[s] >= 0, `${ctx}: negative amount`);
    }
    assert.strictEqual(sum(r.net), 0, `${ctx}: net does not sum to 0`);
    // a seat can win at most what it put in from each seat (the walk-over of a live seat that put in nothing is exempt)
    for (const s of Object.keys(h.seats)) {
      let cap = 0;
      for (const o of Object.keys(h.seats)) cap += Math.min(net[o], net[s]);
      if (net[s] === 0 && !h.seats[s].folded) { stat.walk++; continue; }
      assert(r.payouts[s] <= cap, `${ctx}: seat ${s} (in for ${net[s]}) was paid ${r.payouts[s]} but matched only ${cap}: ${JSON.stringify(r.pots)}`);
    }
    for (const p of r.pots) for (const w of p.winners) assert(p.eligible.includes(w) || p.refund, `${ctx}: winner ${w} not eligible`);
    if (r.pots.some(p => p.refund)) stat.orphan++;
  }
  return stat;
}

t('fuzz: 6000 hands, short blinds + forced folds + folds mid-hand: conserved, no negative stack, no seat paid beyond what it matched', () => {
  const s = fuzz(Number(process.env.MONEY_FUZZ_HANDS || 6000), Number(process.env.MONEY_FUZZ_SEED || 1008));
  console.log('    fuzz coverage ' + JSON.stringify(s));
  assert(s.hands > 3000 && s.short > 100 && s.forced > 300 && s.allin > 1000, 'the fuzz did not reach the cases it is for: ' + JSON.stringify(s));
});

let pass = 0, fail = 0;
for (const c of cases) {
  try { c.fn(); pass++; console.log('  ok   ' + c.name); } catch (e) { fail++; console.log('  FAIL ' + c.name + '\n       ' + String(e && e.message || e).split('\n').slice(0, 4).join('\n       ')); }
}
console.log(`\nmoney-1008-engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
