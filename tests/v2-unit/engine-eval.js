'use strict';
// Evaluator tests: port of audit repro 03_eval.js, extra hand-class cases, and a differential run against
// the evaluator copied from the old server (engine-old-server.js). OWNER: engine builder.
const L = require('./engine-lib');
const { assert, card } = L;
const E = require('../../engine/evaluate');
const OLD = require('./engine-old-server');
const { makeDeck, shuffle } = require('../../engine/deck');

const hand = (hole, board) => E.bestHand(hole.map(card), board.map(card));
const cmp = (a, b) => Math.sign(E.compareHands(a, b));

// [name, holeA, holeB, board, expected sign of compare(A, B)]  (verbatim from briefs/audit-1006/server/repro/03_eval.js)
const CASES = [
  ['wheel loses to 6-high straight', ['As', '2d'], ['6c', '7h'], ['3s', '4h', '5d', 'Kc', 'Qd'], -1],
  ['wheel is a straight (beats trips)', ['As', '2d'], ['Kh', 'Ks'], ['3s', '4h', '5d', 'Kc', '9d'], 1],
  ['steel wheel = straight flush, not royal', ['Ah', '2h'], ['Kd', 'Kc'], ['3h', '4h', '5h', 'Kh', 'Ks'], 1],
  ['flush beats straight', ['2h', '9h'], ['Ts', 'Jd'], ['7h', '8h', 'Qh', '9c', '3d'], 1],
  ['two pair on board, A kicker beats Q kicker', ['Ad', '3c'], ['Qd', '4c'], ['Ks', 'Kh', '8s', '8h', '2d'], 1],
  ['board plays -> tie', ['2c', '3d'], ['2d', '4h'], ['Ts', 'Jh', 'Qd', 'Kc', 'Ac'], 0],
  ['three pairs: best two + kicker', ['Ac', '9c'], ['Ad', '2c'], ['As', '9d', '5h', '5c', '2d'], 1],
  ['full house: higher trips first', ['8c', '8d'], ['7c', 'Kd'], ['8s', '7s', '7h', 'Kc', '2d'], 1],
  ['quads kicker', ['Ac', '2d'], ['Kc', '3d'], ['9s', '9h', '9d', '9c', '4d'], 1],
  ['flush 5-card compare (6th card ignored)', ['Ah', '2h'], ['Kh', '3h'], ['Qh', 'Jh', '9h', '4c', '5c'], 1],
  ['ace-high straight beats king-high', ['Ac', '2d'], ['9c', '2c'], ['Ts', 'Jh', 'Qd', 'Kc', '3d'], 1],
];

module.exports = function register(t, env) {
  for (const [name, h1, h2, board, want] of CASES) {
    t.case(`eval (03_eval): ${name}`, () => {
      const a = hand(h1, board), b = hand(h2, board);
      assert.strictEqual(cmp(a, b), want, `${a.name} [${a.kickers}] vs ${b.name} [${b.kickers}]`);
      assert.strictEqual(cmp(b, a) + want, 0);
    });
  }

  const NAMES = [
    ['royal flush', ['As', 'Ks'], ['Qs', 'Js', 'Ts', '2c', '3d'], 'Royal Flush'],
    ['straight flush', ['9h', '8h'], ['7h', '6h', '5h', 'Kc', '2d'], 'Straight Flush'],
    ['four of a kind', ['9h', '9d'], ['9s', '9c', '5h', 'Kc', '2d'], 'Four of a Kind'],
    ['full house', ['9h', '9d'], ['9s', '5c', '5h', 'Kc', '2d'], 'Full House'],
    ['flush', ['9h', '2h'], ['Kh', '5h', 'Jh', 'Kc', '2d'], 'Flush'],
    ['straight', ['9h', '8d'], ['7s', '6c', '5h', 'Kc', '2d'], 'Straight'],
    ['three of a kind', ['9h', '9d'], ['9s', '6c', '5h', 'Kc', '2d'], 'Three of a Kind'],
    ['two pair', ['9h', '9d'], ['5s', '5c', 'Th', 'Kc', '2d'], 'Two Pair'],
    ['pair', ['9h', '9d'], ['4s', '5c', 'Th', 'Kc', '2d'], 'Pair'],
    ['high card', ['9h', '3d'], ['4s', '5c', 'Th', 'Kc', '2d'], 'High Card'],
  ];
  for (const [label, hole, board, want] of NAMES) {
    t.case(`eval names: ${label}`, () => assert.strictEqual(hand(hole, board).name, want));
  }

  t.case('eval: the hand classes are strictly ordered', () => {
    const order = NAMES.map(([, h, b]) => hand(h, b));
    for (let i = 0; i + 1 < order.length; i++) assert(E.compareHands(order[i], order[i + 1]) > 0, `${order[i].name} should beat ${order[i + 1].name}`);
  });

  t.case('eval: 5 and 6 card boards work (turn-only and flop-only evaluation)', () => {
    assert.strictEqual(E.bestHand(['As', 'Ks'].map(card), ['Qs', 'Js', 'Ts'].map(card)).name, 'Royal Flush');
    assert.strictEqual(E.bestHand(['As', 'Ks'].map(card), ['Qs', 'Js', '2c', 'Ts'].map(card)).name, 'Royal Flush');
  });

  t.case(`eval differential: ${env.hands} random 7-card hands vs the old server evaluator`, () => {
    const rng = L.mulberry32(env.seed * 7919 + 1);
    const base = makeDeck();
    let ties = 0, classes = new Set();
    for (let i = 0; i < env.hands; i++) {
      const d = shuffle(base, rng);
      const board = d.slice(0, 5), h1 = d.slice(5, 7), h2 = d.slice(7, 9);
      const a = E.bestHand(h1, board), b = E.bestHand(h2, board);
      const oa = OLD.bestHand(h1, board), ob = OLD.bestHand(h2, board);
      assert.deepStrictEqual(a, oa, `hand ${i}: bestHand differs`);
      assert.deepStrictEqual(b, ob, `hand ${i}: bestHand differs`);
      const s = Math.sign(E.compareHands(a, b));
      assert.strictEqual(s, Math.sign(OLD.compareHands(oa, ob)), `hand ${i}: compare differs`);
      assert.strictEqual(Math.sign(E.compareHands(b, a)) + s, 0);
      if (s === 0) ties++;
      classes.add(a.name);
    }
    if (env.hands >= 2000) assert(classes.size >= 8, `random hands covered only ${classes.size} classes`);
  });
};
