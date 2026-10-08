'use strict';
// Table-driven rule tests, one named case per rule. OWNER: engine builder.
const L = require('./engine-lib');
const { assert, H, mk, play, runOut, finish, stacksOf, clone, throwsRule, rigDeck, card } = L;
const { sidePots } = require('../../engine/pots');
const { makeDeck, shuffle } = require('../../engine/deck');

const BROADWAY = ['Ts', 'Jh', 'Qd', 'Kc', 'Ac']; // board plays: everyone holding no better splits
const DRY = ['3c', '8d', '9h', '4s', '5h'];
const J = x => JSON.stringify(x);

module.exports = function register(t) {
  // ─── blinds and order ──────────────────────────────────────────────────────
  t.case('H4 heads-up: button posts SB and acts first preflop', () => {
    for (const [seats, button] of [[[0, 1], 0], [[0, 1], 1], [[4, 7], 7], [[4, 7], 4], [[2, 8], 8]]) {
      const stacks = {}; for (const s of seats) stacks[s] = 1000;
      const h = mk({ stacks, button });
      const other = seats.find(s => s !== button);
      assert.strictEqual(h.sbSeat, button);
      assert.strictEqual(h.bbSeat, other);
      assert.strictEqual(h.seats[button].bet, 25);
      assert.strictEqual(h.seats[other].bet, 50);
      assert.strictEqual(h.toAct, button);
      assert.strictEqual(H.legalActions(h, other), null);
    }
  });

  t.case('H4 heads-up: BB acts first on every postflop street', () => {
    const h = mk({ stacks: [1000, 1000], button: 0 });
    play(h, [[0, 'call'], [1, 'check']]);
    assert.strictEqual(h.street, 'flop');
    assert.strictEqual(h.toAct, 1);
    play(h, [[1, 'check'], [0, 'check']]);
    assert.strictEqual(h.street, 'turn'); assert.strictEqual(h.toAct, 1);
    play(h, [[1, 'check'], [0, 'check']]);
    assert.strictEqual(h.street, 'river'); assert.strictEqual(h.toAct, 1);
  });

  t.case('blinds and first-to-act, 3 to 9 handed (contiguous seats)', () => {
    // n, button -> sb, bb, utg
    for (let n = 3; n <= 9; n++) for (let button = 0; button < n; button++) {
      const h = mk({ stacks: Array(n).fill(1000), button });
      assert.strictEqual(h.sbSeat, (button + 1) % n, `n=${n} b=${button} sb`);
      assert.strictEqual(h.bbSeat, (button + 2) % n, `n=${n} b=${button} bb`);
      assert.strictEqual(h.toAct, (button + 3) % n, `n=${n} b=${button} utg`);
      assert.strictEqual(h.seats[h.sbSeat].bet, 25);
      assert.strictEqual(h.seats[h.bbSeat].bet, 50);
      assert.strictEqual(h.currentBet, 50);
    }
  });

  t.case('blinds and order with gaps in the seat numbers and a button wrap', () => {
    const h = mk({ stacks: { 1: 1000, 4: 1000, 6: 1000, 8: 1000 }, button: 6 });
    assert.deepStrictEqual([h.sbSeat, h.bbSeat, h.toAct], [8, 1, 4]);
    const h2 = mk({ stacks: { 1: 1000, 4: 1000, 6: 1000, 8: 1000 }, button: 8 });
    assert.deepStrictEqual([h2.sbSeat, h2.bbSeat, h2.toAct], [1, 4, 6]);
  });

  t.case('action order: full lap preflop, then first live seat left of the button postflop', () => {
    const h = mk({ stacks: Array(5).fill(1000), button: 1 }); // sb 2, bb 3, utg 4
    assert.strictEqual(h.toAct, 4);
    play(h, [[4, 'call'], [0, 'fold'], [1, 'call'], [2, 'fold'], [3, 'check']]);
    assert.strictEqual(h.street, 'flop');
    assert.strictEqual(h.toAct, 3); // left of button 1 is 2 (folded), then 3
    assert.strictEqual(h.board.length, 3);
    play(h, [[3, 'check'], [4, 'check'], [1, 'check']]);
    assert.strictEqual(h.street, 'turn'); assert.strictEqual(h.toAct, 3);
  });

  t.case('deal order: one card per seat ascending, twice; burn + flop + burn + turn + burn + river', () => {
    const holes = [['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd']];
    const board = ['2c', '7d', '9h', 'Js', '3d'];
    const deck = rigDeck(holes, board);
    const before = clone(deck);
    const h = mk({ stacks: [1000, 1000, 1000], button: 2, holes, board });
    holes.forEach((hc, i) => assert.deepStrictEqual(h.seats[i].hole, hc.map(card)));
    assert.deepStrictEqual(deck, before, 'createHand must not mutate the caller deck');
    play(h, [[2, 'call'], [0, 'call'], [1, 'check']]);
    assert.deepStrictEqual(h.board, board.slice(0, 3).map(card));
    play(h, [[0, 'check'], [1, 'check'], [2, 'check']]);
    assert.deepStrictEqual(h.board, board.slice(0, 4).map(card));
    play(h, [[0, 'check'], [1, 'check'], [2, 'check']]);
    assert.deepStrictEqual(h.board, board.slice(0, 5).map(card));
  });

  t.case('short stack posts its blind all-in', () => {
    const h = mk({ stacks: [1000, 10, 1000], button: 0 }); // SB seat 1 has 10
    assert.strictEqual(h.seats[1].bet, 10);
    assert.strictEqual(h.seats[1].allIn, true);
    assert.strictEqual(h.seats[1].stack, 0);
    assert.strictEqual(h.currentBet, 50);
    assert.strictEqual(h.toAct, 0);
  });

  // ─── min raise (H2) ────────────────────────────────────────────────────────
  t.case('H2 min-raise is the last full raise: 50 BB, raise to 300, 350 rejected, 550 ok', () => {
    const h = mk({ stacks: [5000, 5000, 5000], button: 0 });
    assert.strictEqual(H.legalActions(h, 0).minRaiseTo, 100);
    play(h, [[0, 'raise', 300]]);
    const la = H.legalActions(h, 1);
    assert.strictEqual(la.minRaiseTo, 550);
    assert.strictEqual(la.maxRaiseTo, 5000);
    const before = J(h);
    const e = throwsRule(() => H.apply(h, 1, { type: 'raise', to: 350 }), 'raise_too_small');
    assert.strictEqual(e.details.min, 550);
    assert.strictEqual(J(h), before);
    throwsRule(() => H.apply(h, 1, { type: 'raise', to: 549 }), 'raise_too_small');
    play(h, [[1, 'raise', 550]]);
    assert.strictEqual(h.currentBet, 550);
    assert.strictEqual(h.lastFullRaise, 250);
  });

  t.case('H2 a re-raise sets the new raise size; next min follows it', () => {
    const h = mk({ stacks: [5000, 5000, 5000], button: 0 });
    play(h, [[0, 'raise', 300], [1, 'raise', 1000]]);
    assert.strictEqual(h.lastFullRaise, 700);
    assert.strictEqual(H.legalActions(h, 2).minRaiseTo, 1700);
  });

  t.case('lastFullRaise resets to the big blind each street', () => {
    const h = mk({ stacks: [5000, 5000, 5000], button: 0 });
    play(h, [[0, 'raise', 300], [1, 'call'], [2, 'call']]);
    assert.strictEqual(h.street, 'flop');
    assert.strictEqual(h.lastFullRaise, 50);
    assert.strictEqual(h.currentBet, 0);
    assert.strictEqual(H.legalActions(h, 1).minRaiseTo, 50);
    play(h, [[1, 'raise', 100]]); // a bet of 100 is a raise of 100
    assert.strictEqual(H.legalActions(h, 2).minRaiseTo, 200);
  });

  // ─── short all-in (H3, M8) ────────────────────────────────────────────────
  t.case('H3 short all-in does not reopen: raise 300, call, shove 400 -> first two only call or fold', () => {
    const h = mk({ stacks: [5000, 5000, 400], button: 0 }); // seat 2 is the BB with 400
    play(h, [[0, 'raise', 300], [1, 'call'], [2, 'raise', 400]]);
    assert.strictEqual(h.currentBet, 400);
    assert.strictEqual(h.lastFullRaise, 250, 'a short raise must not change the raise size');
    assert.strictEqual(h.toAct, 0);
    let la = H.legalActions(h, 0);
    assert.strictEqual(la.canRaise, false);
    assert.strictEqual(la.toCall, 100);
    assert.strictEqual(la.canCall, true);
    const before = J(h);
    throwsRule(() => H.apply(h, 0, { type: 'raise', to: 1500 }), 'raise_closed');
    assert.strictEqual(J(h), before);
    play(h, [[0, 'call']]);
    la = H.legalActions(h, 1);
    assert.strictEqual(la.canRaise, false);
    assert.strictEqual(la.toCall, 100);
    throwsRule(() => H.apply(h, 1, { type: 'raise', to: 2000 }), 'raise_closed');
    play(h, [[1, 'fold']]);
    assert.strictEqual(h.phase, 'runout'); // seat 0 vs all-in seat 2: only one seat can still act
  });

  t.case('H3 after a short all-in the closed-seat hand runs out when only one seat can act', () => {
    const h = mk({ stacks: [5000, 5000, 400], button: 0 });
    play(h, [[0, 'raise', 300], [1, 'call'], [2, 'raise', 400], [0, 'call'], [1, 'call']]);
    assert.strictEqual(h.street, 'flop');
    assert.strictEqual(h.phase, 'betting'); // seats 0 and 1 still have chips and can bet
    assert.strictEqual(h.toAct, 1);
    assert.strictEqual(H.legalActions(h, 1).canRaise, true);
  });

  t.case('H3 a seat that has not acted yet may still raise a short all-in', () => {
    const h = mk({ stacks: [400, 5000, 5000, 5000], button: 0 }); // seat0 btn 400, sb 1, bb 2, utg 3
    play(h, [[3, 'raise', 300]]);
    assert.strictEqual(h.toAct, 0);
    play(h, [[0, 'raise', 400]]); // short all-in (100 < 250)
    assert.strictEqual(h.lastFullRaise, 250);
    assert.strictEqual(h.toAct, 1);
    const la = H.legalActions(h, 1);
    assert.strictEqual(la.canRaise, true);
    assert.strictEqual(la.minRaiseTo, 650); // 400 + last full raise 250
    play(h, [[1, 'raise', 650]]);
    // seat 2 (BB, not yet acted) may raise, seat 3 (acted at 300) is reopened by a full raise
    play(h, [[2, 'call']]);
    const l3 = H.legalActions(h, 3);
    assert.strictEqual(l3.canRaise, true);
    assert.strictEqual(l3.minRaiseTo, 900);
  });

  t.case('H3 an all-in that IS a full raise reopens the action for everyone', () => {
    const g = mk({ stacks: [5000, 5000, 5000, 400], button: 0 }); // utg 3 has 400
    play(g, [[3, 'raise', 400]]); // all-in raise of 350 over the BB 50: full raise
    assert.strictEqual(g.lastFullRaise, 350);
    assert.strictEqual(H.legalActions(g, 0).canRaise, true);
    assert.strictEqual(H.legalActions(g, 0).minRaiseTo, 750);
  });

  t.case('M8 short all-in below the min-raise is legal (min reported equals max)', () => {
    const h = mk({ stacks: [5000, 400, 5000], button: 0 });
    play(h, [[0, 'raise', 300]]);
    const la = H.legalActions(h, 1); // SB posted 25, stack 375, max 400, nominal min 550
    assert.strictEqual(la.canRaise, true);
    assert.strictEqual(la.minRaiseTo, 400);
    assert.strictEqual(la.maxRaiseTo, 400);
    throwsRule(() => H.apply(h, 1, { type: 'raise', to: 399 }), 'raise_too_small');
    throwsRule(() => H.apply(h, 1, { type: 'raise', to: 401 }), 'raise_too_big');
    const ev = play(h, [[1, 'raise', 400]]);
    assert.strictEqual(ev[0].full, false);
    assert.strictEqual(ev[0].allIn, true);
    assert.strictEqual(h.seats[1].allIn, true);
    assert.strictEqual(h.currentBet, 400);
  });

  t.case('M8 a stack that only covers the call can only call (no raise offered)', () => {
    const h = mk({ stacks: [5000, 5000, 300], button: 0 });
    play(h, [[0, 'raise', 300]]);
    play(h, [[1, 'fold']]);
    const la = H.legalActions(h, 2); // BB has 250 behind, toCall 250
    assert.strictEqual(la.canRaise, false);
    assert.strictEqual(la.callAmount, 250);
    throwsRule(() => H.apply(h, 2, { type: 'raise', to: 300 }), 'raise_too_small');
    throwsRule(() => H.apply(h, 2, { type: 'raise', to: 301 }), 'raise_too_big');
    const ev = play(h, [[2, 'call']]);
    assert.strictEqual(ev[0].allIn, true);
    assert.strictEqual(h.phase, 'runout');
  });

  t.case('a short stack that cannot cover the call calls for less (call amount = stack)', () => {
    const h = mk({ stacks: [5000, 5000, 120], button: 0 });
    play(h, [[0, 'raise', 300], [1, 'fold']]);
    const la = H.legalActions(h, 2);
    assert.strictEqual(la.toCall, 250);
    assert.strictEqual(la.callAmount, 70);
    play(h, [[2, 'call']]);
    assert.strictEqual(h.seats[2].committed, 120);
    assert.strictEqual(h.seats[0].returned, 180); // 300 - 120
  });

  t.case('a short all-in bet postflop (below the BB) is legal and sets the next min raise from the last full size', () => {
    const h = mk({ stacks: [5000, 30, 5000], button: 0 });
    // preflop: seat 1 (SB) has 30: posts 25, leaves 5. make everyone limp
    play(h, [[0, 'call'], [1, 'call'], [2, 'check']]);
    // seat 1 is all-in now (30 total); flop betting between 0 and 2, seat 2 first
    assert.strictEqual(h.street, 'flop');
    assert.strictEqual(h.toAct, 2);
    play(h, [[2, 'check']]);
    assert.strictEqual(H.legalActions(h, 0).minRaiseTo, 50);
  });

  t.case('everyone else all-in: no raise is offered, only call or fold', () => {
    const h = mk({ stacks: [1000, 5000], button: 0 });
    play(h, [[0, 'raise', 1000]]);
    const la = H.legalActions(h, 1);
    assert.strictEqual(la.canRaise, false);
    assert.strictEqual(la.minRaiseTo, null);
    assert.strictEqual(la.callAmount, 950);
    throwsRule(() => H.apply(h, 1, { type: 'raise', to: 3000 }), 'raise_closed');
  });

  // ─── BB option, all-ins from blinds, run-out ──────────────────────────────
  t.case('BB option preflop: limpers, then BB may check or raise', () => {
    const h = mk({ stacks: [5000, 5000, 5000], button: 0 });
    play(h, [[0, 'call'], [1, 'call']]);
    assert.strictEqual(h.street, 'preflop');
    assert.strictEqual(h.toAct, 2);
    const la = H.legalActions(h, 2);
    assert.strictEqual(la.canCheck, true);
    assert.strictEqual(la.canCall, false);
    assert.strictEqual(la.canRaise, true);
    assert.strictEqual(la.minRaiseTo, 100);
    play(h, [[2, 'raise', 150]]);
    assert.strictEqual(h.street, 'preflop');
    assert.strictEqual(h.toAct, 0); // reopened
    assert.strictEqual(H.legalActions(h, 0).canRaise, true);
  });

  t.case('BB option: check closes the round and deals the flop', () => {
    const h = mk({ stacks: [5000, 5000, 5000], button: 0 });
    play(h, [[0, 'call'], [1, 'call'], [2, 'check']]);
    assert.strictEqual(h.street, 'flop');
    assert.strictEqual(h.board.length, 3);
  });

  t.case('M1 heads-up all-in from the blinds runs out (and the extra 5 comes back)', () => {
    const h = mk({ stacks: [20, 15], button: 0, holes: [['As', 'Ad'], ['Ks', 'Kd']], board: DRY });
    assert.strictEqual(h.phase, 'runout');
    assert.strictEqual(h.toAct, null);
    assert.strictEqual(h.seats[0].returned, 5);
    assert.strictEqual(h.seats[0].stack, 5);
    assert.strictEqual(H.legalActions(h, 0), null);
    const r = finish(h);
    assert.deepStrictEqual(stacksOf(h), [35, 0]);
    assert.deepStrictEqual(r.returned, { 0: 5, 1: 0 });
    assert.deepStrictEqual(r.payouts, { 0: 30, 1: 0 });
    assert.strictEqual(h.board.length, 5);
  });

  t.case('M1 SB short all-in against a full BB: straight to run-out, uncalled part returned', () => {
    const h = mk({ stacks: [20, 1000], button: 0, holes: [['As', 'Ad'], ['Ks', 'Kd']], board: DRY });
    assert.strictEqual(h.phase, 'runout');
    assert.strictEqual(h.seats[1].returned, 30);
    const r = finish(h);
    assert.deepStrictEqual(stacksOf(h), [40, 980]);
    assert.strictEqual(r.net[0], 20);
  });

  t.case('M1 three-way where both blinds are all-in and the button covers: button calls, then run-out', () => {
    const h = mk({ stacks: [1000, 10, 30], button: 0, holes: [['7c', '2d'], ['As', 'Ad'], ['Ks', 'Kd']], board: DRY });
    assert.strictEqual(h.phase, 'betting');
    assert.strictEqual(h.toAct, 0);
    play(h, [[0, 'call']]);
    assert.strictEqual(h.phase, 'runout');
    const r = finish(h);
    assert.deepStrictEqual(stacksOf(h), [970, 30, 40]); // 20 of the button's 50 comes back
    assert.strictEqual(r.pots.length, 2);
  });

  t.case('everyone all-in preflop runs out street by street via dealNext', () => {
    const h = mk({ stacks: [500, 700, 900], button: 0, holes: [['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd']], board: DRY });
    play(h, [[0, 'raise', 500], [1, 'raise', 700], [2, 'call']]); // seat 2 could only call: both others are all-in
    assert.strictEqual(h.phase, 'runout');
    assert.strictEqual(h.seats[2].stack, 200);
    assert.strictEqual(h.board.length, 0);
    let ev = H.dealNext(h);
    assert.strictEqual(ev[0].street, 'flop'); assert.strictEqual(h.board.length, 3); assert.strictEqual(h.phase, 'runout');
    ev = H.dealNext(h);
    assert.strictEqual(ev[0].street, 'turn'); assert.strictEqual(h.board.length, 4);
    ev = H.dealNext(h);
    assert.strictEqual(ev[0].street, 'river'); assert.strictEqual(h.board.length, 5);
    assert.strictEqual(h.phase, 'showdown');
    assert.strictEqual(ev[ev.length - 1].type, 'showdown');
    throwsRule(() => H.dealNext(h), 'not_runout');
    H.settle(h);
    assert.strictEqual(h.phase, 'done');
    throwsRule(() => H.dealNext(h), 'not_runout');
  });

  t.case('all-in on the flop: turn and river come from dealNext only', () => {
    const h = mk({ stacks: [1000, 1000], button: 0 });
    play(h, [[0, 'call'], [1, 'check'], [1, 'raise', 950], [0, 'call']]);
    assert.strictEqual(h.phase, 'runout');
    assert.strictEqual(h.board.length, 3);
    H.dealNext(h); H.dealNext(h);
    assert.strictEqual(h.phase, 'showdown');
    assert.strictEqual(h.board.length, 5);
  });

  t.case('dealNext outside a run-out throws', () => {
    const h = mk({ stacks: [1000, 1000], button: 0 });
    throwsRule(() => H.dealNext(h), 'not_runout');
  });

  // ─── fold-win and returned (L3) ───────────────────────────────────────────
  t.case('L3 fold-win: the uncalled raise comes back as `returned`, not payout', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0, holes: [['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], board: BROADWAY });
    const ev = play(h, [[0, 'raise', 300], [1, 'fold'], [2, 'fold']]);
    assert.deepStrictEqual(ev.filter(e => e.type === 'returned'), [{ type: 'returned', seat: 0, amount: 250 }]);
    assert.strictEqual(h.phase, 'showdown');
    assert.strictEqual(h.uncontested, true);
    const r = H.settle(h);
    assert.deepStrictEqual(r.returned, { 0: 250, 1: 0, 2: 0 });
    assert.deepStrictEqual(r.payouts, { 0: 125, 1: 0, 2: 0 });
    assert.deepStrictEqual(r.net, { 0: 75, 1: -25, 2: -50 });
    assert.deepStrictEqual(r.pots, [{ amount: 125, eligible: [0], winners: [0] }]);
    assert.deepStrictEqual(r.reveals, []);
    assert.deepStrictEqual(stacksOf(h), [1075, 975, 950]);
  });

  t.case('L3 river bet folded to: the bet is returned and not announced as a win', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0, holes: [['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], board: DRY });
    play(h, [[0, 'call'], [1, 'call'], [2, 'check']]);
    for (let st = 0; st < 3; st++) { play(h, [[1, 'check'], [2, 'check']]); if (st < 2) play(h, [[0, 'check']]); }
    play(h, [[0, 'raise', 500], [1, 'fold'], [2, 'fold']]);
    const r = H.settle(h);
    assert.deepStrictEqual(r.returned, { 0: 500, 1: 0, 2: 0 });
    assert.deepStrictEqual(r.payouts, { 0: 150, 1: 0, 2: 0 });
    assert.deepStrictEqual(stacksOf(h), [1100, 950, 950]);
  });

  t.case('S4 heads-up shove and call: the bigger stack gets the uncalled part back even when it loses', () => {
    const h = mk({ stacks: [5000, 1000], button: 0, holes: [['7c', '2d'], ['As', 'Ad']], board: ['3c', '8d', '9h', '4s', 'Kc'] });
    play(h, [[0, 'raise', 5000], [1, 'call']]);
    const r = finish(h);
    assert.deepStrictEqual(stacksOf(h), [4000, 2000]);
    assert.deepStrictEqual(r.returned, { 0: 4000, 1: 0 });
    assert.deepStrictEqual(r.payouts, { 0: 0, 1: 2000 });
    assert.deepStrictEqual(r.net, { 0: -1000, 1: 1000 });
  });

  // ─── odd chip (L1) ────────────────────────────────────────────────────────
  t.case('L1 odd chip, 2-way split: first winner left of the button, not the dealer', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0, holes: [['2c', '3d'], ['4c', '5d'], ['2d', '4h']], board: BROADWAY });
    play(h, [[0, 'call'], [1, 'fold'], [2, 'check']]);
    for (let st = 0; st < 3; st++) play(h, [[2, 'check'], [0, 'check']]);
    const r = H.settle(h);
    assert.deepStrictEqual(r.payouts, { 0: 62, 1: 0, 2: 63 });
    assert.deepStrictEqual(stacksOf(h), [1012, 975, 1013]);
  });

  t.case('L1 odd chip, 2-way split between SB and button goes to the SB', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0, sb: 25, bb: 51, holes: [['2c', '3d'], ['4c', '5d'], ['2d', '4h']], board: BROADWAY });
    play(h, [[0, 'call'], [1, 'call'], [2, 'fold']]);
    for (let st = 0; st < 3; st++) play(h, [[1, 'check'], [0, 'check']]);
    const r = H.settle(h);
    assert.strictEqual(r.pots[0].amount, 153);
    assert.deepStrictEqual(r.payouts, { 0: 76, 1: 77, 2: 0 });
  });

  t.case('L1 odd chip, 3-way split (remainder 1) -> first winner left of the button', () => {
    const h = mk({ stacks: [1000, 1000, 1000, 1000], button: 0, holes: [['2c', '3d'], ['4c', '5d'], ['2d', '4h'], ['3h', '5s']], board: BROADWAY });
    play(h, [[3, 'call'], [0, 'call'], [1, 'fold'], [2, 'check']]);
    for (let st = 0; st < 3; st++) play(h, [[2, 'check'], [3, 'check'], [0, 'check']]);
    H.settle(h);
    assert.deepStrictEqual(stacksOf(h), [1008, 975, 1009, 1008]);
  });

  t.case('L1 3-way split with remainder 2: one extra chip each to the first two winners left of the button', () => {
    const h = mk({ stacks: [1000, 1000, 1000, 1000], button: 0, sb: 26, bb: 50, holes: [['2c', '3d'], ['4c', '5d'], ['2d', '4h'], ['3h', '5s']], board: BROADWAY });
    play(h, [[3, 'call'], [0, 'call'], [1, 'fold'], [2, 'check']]);
    for (let st = 0; st < 3; st++) play(h, [[2, 'check'], [3, 'check'], [0, 'check']]);
    const r = H.settle(h);
    assert.strictEqual(r.pots[0].amount, 176);
    assert.deepStrictEqual(r.payouts, { 0: 58, 1: 0, 2: 59, 3: 59 });
  });

  t.case('L1 4-way split, 6 handed: S2 of the audit', () => {
    const h = mk({ stacks: Array(6).fill(1000), button: 0, holes: [['2c', '3d'], ['4c', '5d'], ['2d', '4h'], ['3h', '5s'], ['2h', '3s'], ['6c', '7d']], board: BROADWAY });
    play(h, [[3, 'call'], [4, 'call'], [5, 'fold'], [0, 'call'], [1, 'fold'], [2, 'check']]);
    for (let st = 0; st < 3; st++) play(h, [[2, 'check'], [3, 'check'], [4, 'check'], [0, 'check']]);
    H.settle(h);
    assert.deepStrictEqual(stacksOf(h), [1006, 975, 1007, 1006, 1006, 1000]);
  });

  t.case('odd chip in a side pot: 1000/333/1000/1000, tie for the side pot', () => {
    const h = mk({ stacks: [1000, 333, 1000, 1000], button: 0, holes: [['Ks', 'Ah'], ['As', 'Ad'], ['Kd', 'Ac'], ['7c', '2d']], board: ['3c', '8d', '9h', '4s', 'Jh'] });
    play(h, [[3, 'raise', 1000], [0, 'call'], [1, 'call'], [2, 'call']]);
    finish(h);
    assert.deepStrictEqual(stacksOf(h), [1000, 1332, 1001, 0]);
  });

  // ─── side pots ────────────────────────────────────────────────────────────
  t.case('side pots 100/300/600/1000 all-in, AA KK QQ JJ: 400/600/600 and 400 returned', () => {
    const h = mk({ stacks: [100, 300, 600, 1000], button: 0, holes: [['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd'], ['Js', 'Jd']], board: ['2c', '7d', '9h', '3s', '4c'] });
    play(h, [[3, 'raise', 1000], [0, 'call'], [1, 'call'], [2, 'call']]);
    const r = finish(h);
    assert.deepStrictEqual(r.pots.map(p => p.amount), [400, 600, 600]);
    assert.deepStrictEqual(r.pots.map(p => p.eligible), [[0, 1, 2, 3], [1, 2, 3], [2, 3]]);
    assert.deepStrictEqual(r.pots.map(p => p.winners), [[0], [1], [2]]);
    assert.deepStrictEqual(r.returned, { 0: 0, 1: 0, 2: 0, 3: 400 });
    assert.deepStrictEqual(stacksOf(h), [400, 600, 600, 400]);
    assert.deepStrictEqual(r.net, { 0: 300, 1: 300, 2: 0, 3: -600 });
  });

  t.case('S3 a folded contributor\'s chips stay in the pots; the winning bet is returned', () => {
    const h = mk({ stacks: [5000, 300, 5000], button: 0, holes: [['Ks', 'Kd'], ['As', 'Ad'], ['7c', '2d']], board: ['3c', '8d', '9h', '4s', '5c'] });
    play(h, [[0, 'raise', 1000], [1, 'call'], [2, 'call'], [2, 'raise', 2000], [0, 'fold']]);
    assert.strictEqual(h.phase, 'runout'); // seat 1 is all-in, seat 2 is alone with chips
    const r = finish(h);
    assert.deepStrictEqual(r.returned, { 0: 0, 1: 0, 2: 2000 });
    assert.deepStrictEqual(r.pots.map(p => p.amount), [900, 1400]);
    assert.deepStrictEqual(r.pots.map(p => p.eligible), [[1, 2], [2]]);
    assert.deepStrictEqual(stacksOf(h), [4000, 900, 5400]);
  });

  t.case('S5 all-in seats always reach showdown: short stack with the best hand wins its main pot', () => {
    const h = mk({ stacks: [3000, 500, 3000], button: 0, holes: [['Ks', 'Kd'], ['As', 'Ad'], ['7c', '2d']], board: ['3c', '8d', '9h', '4s', '5h'] });
    play(h, [[0, 'raise', 3000], [1, 'call'], [2, 'call']]);
    finish(h);
    assert.deepStrictEqual(stacksOf(h), [5000, 1500, 0]);
  });

  t.case('S5b the covering stack wins everything and gets the uncalled 1000 back', () => {
    const h = mk({ stacks: [3000, 500, 2000], button: 0, holes: [['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], board: ['3c', '8d', '9h', '4s', '5h'] });
    play(h, [[0, 'raise', 3000], [1, 'call'], [2, 'call']]);
    finish(h);
    assert.deepStrictEqual(stacksOf(h), [5500, 0, 0]);
  });

  t.case('S7c heads-up SB all-in from the blind: BB (button) keeps its unmatched 25', () => {
    const h = mk({ stacks: [1000, 25], button: 0, holes: [['7c', '2d'], ['As', 'Ad']], board: DRY });
    // button posts SB 25 and must complete to 50; seat 1 posted its whole stack as BB
    play(h, [[0, 'call']]);
    finish(h);
    assert.deepStrictEqual(stacksOf(h), [975, 50]);
  });

  t.case('S9 side pot tie: AA main pot 903, 700 each for the AK hands', () => {
    const h = mk({ stacks: [1001, 301, 1001], button: 0, holes: [['Ks', 'Ah'], ['As', 'Ad'], ['Kd', 'Ac']], board: ['3c', '8d', '9h', '4s', '2h'] });
    play(h, [[0, 'raise', 1001], [1, 'call'], [2, 'call']]);
    finish(h);
    assert.deepStrictEqual(stacksOf(h), [700, 903, 700]);
  });

  t.case('sidePots(): layering, folded contributions, dead chips above the top live commitment', () => {
    assert.deepStrictEqual(sidePots({ 0: 100, 1: 300, 2: 600, 3: 1000 }, []), [
      { amount: 400, eligible: [0, 1, 2, 3] }, { amount: 600, eligible: [1, 2, 3] },
      { amount: 600, eligible: [2, 3] }, { amount: 400, eligible: [3] }]);
    assert.deepStrictEqual(sidePots({ 0: 100, 1: 300, 2: 300 }, [0]), [{ amount: 700, eligible: [1, 2] }]);
    assert.deepStrictEqual(sidePots({ 0: 500, 1: 100, 2: 300 }, [0]), [
      { amount: 300, eligible: [1, 2] }, { amount: 400, eligible: [2] }, { amount: 200, eligible: [], refund: { 0: 200 } }]);
    // K3-2: chips above the highest live commitment are nobody's to win: each contributor gets its own back
    assert.deepStrictEqual(sidePots({ 0: 1000, 1: 100, 2: 1000 }, [0, 2]), [
      { amount: 300, eligible: [1] }, { amount: 1800, eligible: [], refund: { 0: 900, 2: 900 } }]);
    assert.deepStrictEqual(sidePots({ 0: 50, 1: 50, 2: 0 }, new Set()), [{ amount: 100, eligible: [0, 1] }]);
    assert.deepStrictEqual(sidePots({}, []), []);
    assert.deepStrictEqual(sidePots({ 0: 1, 1: 2, 2: 0 }, [0, 1]), [{ amount: 3, eligible: [2] }]);
    assert.throws(() => sidePots({ 0: 1.5 }, []), TypeError);
  });

  // ─── foldOut ──────────────────────────────────────────────────────────────
  t.case('foldOut off turn: seat folds, turn stays, the left seat\'s blind stays in the pot as dead money (K3-2: nobody has to call it)', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0 });
    const ev = H.foldOut(h, 2); // BB leaves while seat 0 is to act
    assert.deepStrictEqual(ev, [{ type: 'fold', seat: 2, forced: true }]);
    assert.strictEqual(h.toAct, 0);
    assert.strictEqual(h.seats[2].folded, true);
    assert.strictEqual(H.legalActions(h, 0).toCall, 25, 'the bet to call is what a seat still in has put in (the small blind)');
    play(h, [[0, 'call'], [1, 'check']]);
    assert.strictEqual(h.street, 'flop');
    assert.strictEqual(h.toAct, 1);
    assert.strictEqual(H.totalPot(h), 75, 'the left BB\'s 50 is dead only up to what the others put in (the other 25 is returned to him)');
    play(h, [[1, 'check'], [0, 'check'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'check']]);
    const r = H.settle(h);
    assert.strictEqual(r.pots.reduce((a, p) => a + p.amount, 0), 75);
    assert.strictEqual(r.returned[2], 25);
    assert.strictEqual(r.payouts[2], 0);
  });

  t.case('foldOut on turn: same as a fold, play moves to the next seat', () => {
    const h = mk({ stacks: [1000, 1000, 1000, 1000], button: 0 }); // utg seat 3
    assert.strictEqual(h.toAct, 3);
    H.foldOut(h, 3);
    assert.strictEqual(h.toAct, 0);
    H.foldOut(h, 0);
    assert.strictEqual(h.toAct, 1);
    assert.strictEqual(h.phase, 'betting');
  });

  t.case('foldOut that leaves one seat ends the hand: uncalled bet returned, blinds go to the last seat', () => {
    const h = mk({ stacks: [1000, 1000], button: 0 });
    const ev = H.foldOut(h, 0);
    assert.deepStrictEqual(ev.map(e => e.type), ['fold', 'returned', 'showdown']);
    assert.strictEqual(h.phase, 'showdown');
    const r = H.settle(h);
    assert.deepStrictEqual(r.returned, { 0: 0, 1: 25 });
    assert.deepStrictEqual(r.payouts, { 0: 0, 1: 50 });
    assert.deepStrictEqual(stacksOf(h), [975, 1025]);
  });

  t.case('foldOut of the last seat that still had to act closes the betting round', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0 });
    play(h, [[0, 'call']]);          // seat 1 (SB) to act, seat 2 (BB) has the option
    H.foldOut(h, 1);
    assert.strictEqual(h.toAct, 2);   // BB still gets its option against seat 0
    H.foldOut(h, 0);
    assert.strictEqual(h.phase, 'showdown');
    assert.strictEqual(h.uncontested, true);
  });

  t.case('foldOut during run-out drops an all-in seat (kick/leave); the rest play on', () => {
    const h = mk({ stacks: [1000, 3000, 600], button: 0, holes: [['Ks', 'Kd'], ['As', 'Ad'], ['Qs', 'Qd']], board: DRY });
    play(h, [[0, 'raise', 1000], [1, 'raise', 3000], [2, 'call']]);
    assert.strictEqual(h.phase, 'runout');
    assert.strictEqual(h.seats[1].returned, 2000);
    H.foldOut(h, 1);
    assert.strictEqual(h.phase, 'runout');
    finish(h);
    assert.deepStrictEqual(stacksOf(h), [2600, 2000, 0]);
  });

  t.case('foldOut of everyone but a seat that has put in nothing: it wins what is left, nothing vanishes', () => {
    // property-test find (seed 2, hand 6746): button 4, blinds 1/2, seats 0,2,3,4
    const h = mk({ stacks: { 0: 385, 2: 20, 3: 142, 4: 58 }, button: 4, sb: 1, bb: 2 });
    assert.strictEqual(h.toAct, 3);
    H.foldOut(h, 2);
    play(h, [[3, 'fold']]);
    assert.strictEqual(h.toAct, 4);
    H.foldOut(h, 0);
    assert.strictEqual(h.phase, 'showdown');
    const r = H.settle(h);
    // E1: the folded BB (2) is the top bettor over the folded SB (1): its uncalled 1 comes back
    assert.deepStrictEqual(r.returned, { 0: 0, 2: 1, 3: 0, 4: 0 });
    assert.deepStrictEqual(r.payouts, { 0: 0, 2: 0, 3: 0, 4: 2 });
    assert.deepStrictEqual(r.net, { 0: -1, 2: -1, 3: 0, 4: 2 });
    assert.deepStrictEqual(r.pots, [{ amount: 2, eligible: [4], winners: [4] }]);
  });

  t.case('foldOut of the top bettor: the matched part stays in the pot, nobody is asked to call the rest, it comes back to its owner', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0 });
    play(h, [[0, 'raise', 300]]);
    H.foldOut(h, 0); // the raiser is kicked while seat 1 is to act
    assert.strictEqual(h.toAct, 1);
    assert.strictEqual(H.legalActions(h, 1).toCall, 25, 'the kicked raiser\'s 300 is not a bet to call');
    play(h, [[1, 'fold']]);
    assert.strictEqual(h.phase, 'showdown');
    const r = H.settle(h);
    assert.deepStrictEqual(r.returned, { 0: 250, 1: 0, 2: 0 });
    assert.deepStrictEqual(r.payouts, { 0: 0, 1: 0, 2: 125 });
    // and with a live raiser the uncalled part still comes back
    const g = mk({ stacks: [1000, 1000, 1000], button: 0 });
    play(g, [[0, 'raise', 300]]);
    H.foldOut(g, 1);
    play(g, [[2, 'fold']]);
    assert.deepStrictEqual(H.settle(g).returned, { 0: 250, 1: 0, 2: 0 });
  });

  t.case('K3-3 SB over two short all-ins: the SB is not asked to call a bet nobody made; his blind above the all-ins is returned', () => {
    // seed 7 hand 8895 of the old-showdown differential: SB 5040 in, BB all-in 2520, caller all-in 2520. The old server made the SB call
    // 7560 and forfeited his whole blind when he folded; the engine now returns the 2520 nobody matched.
    const h = mk({ stacks: { 0: 40320, 1: 2520, 3: 98280, 4: 2520, 7: 80640 }, button: 1, sb: 5040, bb: 7560 });
    const ev = play(h, [[7, 'fold'], [0, 'fold'], [1, 'call']]);
    assert.deepStrictEqual(ev.filter(e => e.type === 'returned'), [{ type: 'returned', seat: 3, amount: 2520 }]);
    runOut(h);
    assert.strictEqual(h.phase, 'showdown');
    const r = H.settle(h);
    assert.deepStrictEqual(r.returned, { 0: 0, 1: 0, 3: 2520, 4: 0, 7: 0 });
    assert.strictEqual(r.payouts[1] + r.payouts[3] + r.payouts[4], 7560);
    assert(r.net[3] >= -2520, 'the small blind loses at most what the all-in seats covered');
  });

  t.case('E1 heads-up: host limps, P1 raises to 500, host kicks P1 -> P1 gets his uncalled 450 back, host wins 100', () => {
    const h = mk({ stacks: [1000, 1000], button: 0 }); // seat 0 (button/SB) is "the host"
    play(h, [[0, 'call'], [1, 'raise', 500]]);
    assert.strictEqual(h.toAct, 0);
    const ev = H.foldOut(h, 1);
    assert.deepStrictEqual(ev.filter(e => e.type === 'returned'), [{ type: 'returned', seat: 1, amount: 450 }]);
    assert.strictEqual(h.seats[1].stack, 950); // 1000 - 500 + 450: cashes out stack only
    const r = H.settle(h);
    assert.deepStrictEqual(r.returned, { 0: 0, 1: 450 });
    assert.deepStrictEqual(r.payouts, { 0: 100, 1: 0 });
    assert.deepStrictEqual(r.net, { 0: 50, 1: -50 });
    assert.deepStrictEqual(stacksOf(h), [1050, 950]);
  });

  t.case('E1 4-handed: kicked raiser called only by a short all-in -> the layer above the call returns to the kicked seat', () => {
    const h = mk({ stacks: [5000, 300, 5000, 5000], button: 0 }); // sb 1 (300), bb 2, utg 3
    play(h, [[3, 'raise', 1000], [0, 'fold'], [1, 'call']]);
    assert.strictEqual(h.toAct, 2);
    H.foldOut(h, 3);
    play(h, [[2, 'fold']]);
    assert.strictEqual(h.phase, 'showdown');
    const r = H.settle(h);
    assert.deepStrictEqual(r.returned, { 0: 0, 1: 0, 2: 0, 3: 700 });
    assert.deepStrictEqual(r.payouts, { 0: 0, 1: 650, 2: 0, 3: 0 });
    assert.deepStrictEqual(r.net, { 0: 0, 1: 350, 2: -50, 3: -300 });
  });

  t.case('E1 a kicked top bettor on the river: the unanswered bet comes back, earlier streets stay in the pot', () => {
    const h = mk({ stacks: [1000, 1000], button: 0, holes: [['7c', '2d'], ['As', 'Ad']], board: DRY });
    play(h, [[0, 'call'], [1, 'check'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'check'], [1, 'check'], [0, 'raise', 400]]);
    H.foldOut(h, 0);
    const r = H.settle(h);
    assert.deepStrictEqual(r.returned, { 0: 400, 1: 0 });
    assert.deepStrictEqual(r.payouts, { 0: 0, 1: 100 });
  });

  t.case('foldOut errors: unknown seat, repeat is a no-op, after showdown throws', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0 });
    throwsRule(() => H.foldOut(h, 7), 'not_in_hand');
    H.foldOut(h, 1);
    assert.deepStrictEqual(H.foldOut(h, 1), []);
    H.foldOut(h, 2);
    assert.strictEqual(h.phase, 'showdown');
    throwsRule(() => H.foldOut(h, 0), 'hand_over');
    H.settle(h);
    throwsRule(() => H.foldOut(h, 0), 'hand_over');
  });

  t.case('timeout = apply(toCall ? fold : check): both are always legal', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0 });
    for (let k = 0; k < 40 && h.phase === 'betting'; k++) {
      const la = H.legalActions(h, h.toAct);
      H.apply(h, h.toAct, { type: la.toCall ? 'fold' : 'check' });
    }
    assert.strictEqual(h.phase, 'showdown');
    assert.strictEqual(h.uncontested, true);
  });

  // ─── bad input (L5), turn order ───────────────────────────────────────────
  t.case('L5 non-integer, out-of-range and bad amounts throw RuleError and leave the hand unchanged', () => {
    const h = mk({ stacks: [5000, 5000, 5000], button: 0 });
    const before = J(h);
    const cases = [
      [NaN, 'bad_amount'], [Infinity, 'bad_amount'], [-300, 'bad_amount'], [0, 'bad_amount'], [150.5, 'bad_amount'],
      ['300', 'bad_amount'], [null, 'bad_amount'], [undefined, 'bad_amount'], [{}, 'bad_amount'], [2 ** 60, 'bad_amount'],
      [99, 'raise_too_small'], [50, 'raise_too_small'], [1, 'raise_too_small'],
      [5001, 'raise_too_big'], [100000, 'raise_too_big'],
    ];
    for (const [to, code] of cases) {
      throwsRule(() => H.apply(h, 0, { type: 'raise', to }), code);
      assert.strictEqual(J(h), before, `hand changed after to=${String(to)}`);
    }
    // the boundary values are accepted exactly as given
    const ok = clone(h); H.apply(ok, 0, { type: 'raise', to: 100 }); assert.strictEqual(ok.currentBet, 100);
    const ok2 = clone(h); H.apply(ok2, 0, { type: 'raise', to: 5000 }); assert.strictEqual(ok2.currentBet, 5000);
  });

  t.case('check with a bet to face, call with nothing to call, unknown action type, missing action', () => {
    const h = mk({ stacks: [5000, 5000, 5000], button: 0 });
    const before = J(h);
    throwsRule(() => H.apply(h, 0, { type: 'check' }), 'cannot_check');
    throwsRule(() => H.apply(h, 0, { type: 'bet', to: 100 }), 'bad_action');
    throwsRule(() => H.apply(h, 0, { type: 'allin' }), 'bad_action');
    throwsRule(() => H.apply(h, 0, null), 'bad_action');
    throwsRule(() => H.apply(h, 0, undefined), 'bad_action');
    throwsRule(() => H.apply(h, 0, {}), 'bad_action');
    assert.strictEqual(J(h), before);
    play(h, [[0, 'call'], [1, 'call']]);
    const b2 = J(h);
    throwsRule(() => H.apply(h, 2, { type: 'call' }), 'cannot_call');
    assert.strictEqual(J(h), b2);
  });

  t.case('acting out of turn throws not_your_turn and changes nothing', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0 });
    const before = J(h);
    for (const seat of [1, 2, 3, 99, -1, 1.5, NaN, undefined, null, '', true, [], {}, 'x', '-1', '1.5', '1']) {
      for (const a of [{ type: 'fold' }, { type: 'check' }, { type: 'call' }, { type: 'raise', to: 200 }]) {
        throwsRule(() => H.apply(h, seat, a), 'not_your_turn');
      }
      assert.strictEqual(H.legalActions(h, seat), null);
    }
    assert.strictEqual(J(h), before);
  });

  t.case('no actions once betting is over: run-out, showdown and done are not_your_turn', () => {
    const h = mk({ stacks: [500, 500], button: 0 });
    play(h, [[0, 'raise', 500], [1, 'call']]);
    assert.strictEqual(h.phase, 'runout');
    for (const s of [0, 1]) { throwsRule(() => H.apply(h, s, { type: 'check' }), 'not_your_turn'); assert.strictEqual(H.legalActions(h, s), null); }
    runOut(h);
    throwsRule(() => H.apply(h, 0, { type: 'check' }), 'not_your_turn');
    H.settle(h);
    throwsRule(() => H.apply(h, 0, { type: 'check' }), 'not_your_turn');
  });

  t.case('legalActions shape: null off turn, full record on turn', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0 });
    assert.strictEqual(H.legalActions(h, 1), null);
    assert.deepStrictEqual(H.legalActions(h, 0), { toCall: 50, canCheck: false, canCall: true, callAmount: 50, canRaise: true, minRaiseTo: 100, maxRaiseTo: 1000 });
    play(h, [[0, 'call'], [1, 'call']]);
    assert.deepStrictEqual(H.legalActions(h, 2), { toCall: 0, canCheck: true, canCall: false, callAmount: 0, canRaise: true, minRaiseTo: 100, maxRaiseTo: 1000 });
  });

  // ─── state shape and purity ───────────────────────────────────────────────
  t.case('state survives JSON round-trips at every phase and play continues identically', () => {
    const script = [[0, 'raise', 300], [1, 'call'], [2, 'call'], [1, 'check'], [2, 'raise', 200], [0, 'fold'], [1, 'call']];
    const a = mk({ stacks: [2000, 2000, 2000], button: 0, rng: L.mulberry32(11) });
    const b = clone(a);
    let bb = b;
    for (const [seat, type, to] of script) {
      H.apply(a, seat, to === undefined ? { type } : { type, to });
      bb = clone(bb);
      H.apply(bb, seat, to === undefined ? { type } : { type, to });
      bb = clone(bb);
      assert.strictEqual(J(a), J(bb));
    }
    for (const x of [a, bb]) while (x.phase === 'betting') H.apply(x, x.toAct, { type: 'check' });
    runOut(a); runOut(bb);
    const ra = H.settle(a);
    const rb = H.settle(clone(bb));
    assert.strictEqual(J(ra), J(rb));
    assert.strictEqual(J(clone(a)), J(a));
  });

  t.case('hand state has the contract fields', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 1 });
    for (const k of ['handNo', 'button', 'sbSeat', 'bbSeat', 'sb', 'bb', 'street', 'phase', 'board', 'deck', 'toAct', 'currentBet', 'lastFullRaise', 'seats']) assert(k in h, k);
    for (const k of ['stack', 'bet', 'committed', 'folded', 'allIn', 'hole', 'acted', 'canRaise']) assert(k in h.seats[0], k);
    assert.strictEqual(h.street, 'preflop'); assert.strictEqual(h.phase, 'betting');
    assert.strictEqual(h.deck.length, 52 - 6);
    assert.strictEqual(h.handNo, 1);
  });

  t.case('settle: only from showdown, idempotent, credits stack once, conservation', () => {
    const h = mk({ stacks: [1000, 1000], button: 0 });
    throwsRule(() => H.settle(h), 'not_settleable');
    play(h, [[0, 'raise', 1000], [1, 'call']]);
    throwsRule(() => H.settle(h), 'not_settleable'); // still in run-out
    runOut(h);
    const r1 = H.settle(h);
    const stacks = stacksOf(h);
    const r2 = H.settle(h);
    assert.strictEqual(r1, r2);
    assert.deepStrictEqual(stacksOf(h), stacks);
    const sum = o => Object.values(o).reduce((x, y) => x + y, 0);
    assert.strictEqual(sum(r1.payouts) + sum(r1.returned), 2000);
    assert.strictEqual(sum(r1.net), 0);
    assert.strictEqual(h.phase, 'done');
    assert.strictEqual(h.street, 'done');
  });

  t.case('settle reveals every contender at a contested showdown and names the hands', () => {
    const h = mk({ stacks: [1000, 1000, 1000], button: 0, holes: [['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], board: DRY });
    play(h, [[0, 'raise', 1000], [1, 'call'], [2, 'fold']]);
    const r = finish(h);
    assert.deepStrictEqual(r.reveals, [0, 1]);
    assert.deepStrictEqual(r.handNames, { 0: 'Pair', 1: 'Pair' });
  });

  t.case('createHand rejects bad input', () => {
    const deck = shuffle(makeDeck(), L.mulberry32(3));
    const base = { handNo: 1, button: 0, sb: 25, bb: 50, seats: [{ seat: 0, stack: 100 }, { seat: 1, stack: 100 }], deck };
    H.createHand(base);
    throwsRule(() => H.createHand({ ...base, seats: [{ seat: 0, stack: 100 }] }), 'bad_seats');
    throwsRule(() => H.createHand({ ...base, seats: [{ seat: 0, stack: 100 }, { seat: 0, stack: 100 }] }), 'bad_seats');
    throwsRule(() => H.createHand({ ...base, button: 5 }), 'bad_button');
    throwsRule(() => H.createHand({ ...base, seats: [{ seat: 0, stack: 0 }, { seat: 1, stack: 100 }] }), 'bad_stack');
    throwsRule(() => H.createHand({ ...base, seats: [{ seat: 0, stack: 10.5 }, { seat: 1, stack: 100 }] }), 'bad_stack');
    throwsRule(() => H.createHand({ ...base, sb: 60 }), 'bad_blinds');
    throwsRule(() => H.createHand({ ...base, bb: 0, sb: 0 }), 'bad_blinds');
    throwsRule(() => H.createHand({ ...base, deck: deck.slice(0, 5) }), 'bad_deck');
    throwsRule(() => H.createHand({ ...base, deck: null }), 'bad_deck');
  });

  t.case('deck: makeDeck is 52 distinct cards, shuffle is seeded, pure and complete', () => {
    const d = makeDeck();
    assert.strictEqual(d.length, 52);
    assert.strictEqual(new Set(d.map(c => c.rank + c.suit)).size, 52);
    const s1 = shuffle(d, L.mulberry32(5)), s2 = shuffle(d, L.mulberry32(5)), s3 = shuffle(d, L.mulberry32(6));
    assert.deepStrictEqual(s1, s2);
    assert.notDeepStrictEqual(s1, s3);
    assert.strictEqual(new Set(s1.map(c => c.rank + c.suit)).size, 52);
    assert.deepStrictEqual(d, makeDeck(), 'shuffle must not mutate its input');
    assert.throws(() => shuffle(d), TypeError);
  });
};
