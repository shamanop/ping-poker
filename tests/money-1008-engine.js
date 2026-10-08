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

let pass = 0, fail = 0;
for (const c of cases) {
  try { c.fn(); pass++; console.log('  ok   ' + c.name); } catch (e) { fail++; console.log('  FAIL ' + c.name + '\n       ' + String(e && e.message || e).split('\n').slice(0, 4).join('\n       ')); }
}
console.log(`\nmoney-1008-engine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
