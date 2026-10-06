'use strict';
// Property test: seeded random hands with 2-9 seats, random stacks (including below the blinds), random legal and
// illegal actions, random foldOut. OWNER: engine builder.
const L = require('./engine-lib');
const { assert, H, mulberry32, rint, pick, clone } = L;
const { bestHand, compareHands } = require('../../engine/evaluate');

const J = x => JSON.stringify(x);
const seatsOf = h => Object.keys(h.seats).map(Number).sort((a, b) => a - b);
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

// Independent settlement oracle: water-fill the pots from the live seats' net commitments, evaluate hands with
// the evaluator, give the odd chips one at a time to the winners in seat order left of the button.
function oracle(hand) {
  const all = seatsOf(hand);
  const live = all.filter(s => !hand.seats[s].folded);
  const rem = {};
  for (const s of all) rem[s] = hand.seats[s].committed - hand.seats[s].returned;
  const pots = [];
  for (;;) {
    const eligible = live.filter(s => rem[s] > 0);
    if (!eligible.length) break;
    const m = Math.min(...eligible.map(s => rem[s]));
    let amount = 0;
    for (const s of all) { const take = Math.min(rem[s], m); amount += take; rem[s] -= take; }
    pots.push({ amount, eligible });
  }
  const leftover = all.reduce((t, s) => t + rem[s], 0); // dead chips of folded seats above every live level
  if (leftover && pots.length) pots[pots.length - 1].amount += leftover;
  else if (leftover) pots.push({ amount: leftover, eligible: live }); // only folded seats put chips in
  const leftOfButton = s => (s - hand.button - 1 + 100) % 100; // ascending distance clockwise from the button
  const payouts = {};
  for (const s of all) payouts[s] = 0;
  const hands = {};
  if (live.length > 1) for (const s of live) hands[s] = bestHand(hand.seats[s].hole, hand.board);
  for (const p of pots) {
    let winners = p.eligible;
    if (live.length > 1) {
      let best = p.eligible[0];
      for (const s of p.eligible) if (compareHands(hands[s], hands[best]) > 0) best = s;
      winners = p.eligible.filter(s => compareHands(hands[s], hands[best]) === 0);
    }
    winners = winners.slice().sort((a, b) => leftOfButton(a) - leftOfButton(b));
    const share = Math.floor(p.amount / winners.length), r = p.amount - share * winners.length;
    winners.forEach((w, i) => { payouts[w] += share + (i < r ? 1 : 0); });
  }
  return { pots, payouts };
}

// Is this (seat, action) something legalActions offers? la = legalActions(hand, toAct) for the real turn seat.
function offered(hand, la, seat, action) {
  if (!la || typeof seat !== 'number' || seat !== hand.toAct) return false;
  if (!action || typeof action !== 'object') return false;
  switch (action.type) {
    case 'fold': return true;
    case 'check': return la.canCheck;
    case 'call': return la.canCall;
    case 'raise': return la.canRaise && Number.isSafeInteger(action.to) && action.to >= la.minRaiseTo && action.to <= la.maxRaiseTo;
    default: return false;
  }
}

function junkAction(rng, la) {
  const types = ['fold', 'check', 'call', 'raise', 'raise', 'raise', 'bet', 'allin', '', undefined, 7];
  const type = pick(rng, types);
  const lo = la.minRaiseTo ?? 1, hi = la.maxRaiseTo ?? 1000;
  const tos = [undefined, null, NaN, Infinity, -1, 0, 1.5, '100', lo - 1, lo, lo + 1, hi - 1, hi, hi + 1, hi * 2, rint(rng, 0, hi * 2 + 5), rint(rng, lo, hi), 2 ** 53];
  const a = { type };
  const to = pick(rng, tos);
  if (to !== undefined || rng() < 0.5) a.to = to;
  return a;
}

function checkInvariants(hand, total, ctx) {
  const all = seatsOf(hand);
  let t = 0, live = 0;
  for (const s of all) {
    const x = hand.seats[s];
    for (const k of ['stack', 'bet', 'committed', 'returned']) assert(Number.isSafeInteger(x[k]) && x[k] >= 0, `${ctx}: seat ${s} ${k}=${x[k]}`);
    assert(x.bet <= x.committed, `${ctx}: bet > committed seat ${s}`);
    assert(x.returned <= x.committed, `${ctx}: returned > committed seat ${s}`);
    assert.strictEqual(x.allIn, x.stack === 0, `${ctx}: allIn flag vs stack seat ${s} (stack ${x.stack}, allIn ${x.allIn})`);
    t += x.stack + x.committed - x.returned;
    if (!x.folded) live++;
  }
  if (hand.phase !== 'done') assert.strictEqual(t, total, `${ctx}: chips not conserved`);
  assert(live >= 1, `${ctx}: no live seat`);
  const used = [0, 0, 0, 4, 6, 8][hand.board.length] ?? NaN;
  assert.strictEqual(hand.deck.length, 52 - 2 * all.length - used, `${ctx}: deck length`);
  let maxBet = 0;
  for (const s of all) maxBet = Math.max(maxBet, hand.seats[s].bet);
  if (hand.phase === 'betting') {
    assert(live >= 2, `${ctx}: betting with <2 live`);
    const x = hand.seats[hand.toAct];
    assert(x && !x.folded && !x.allIn, `${ctx}: toAct is not an able seat`);
    assert(hand.currentBet >= maxBet, `${ctx}: currentBet below a bet`);
    assert(hand.lastFullRaise >= 1, `${ctx}: lastFullRaise`);
  } else {
    assert.strictEqual(hand.toAct, null, `${ctx}: toAct set outside betting`);
    for (const s of all) assert.strictEqual(hand.seats[s].bet, 0, `${ctx}: bet left outside betting`);
  }
  if (hand.phase === 'runout') assert(live >= 2 && hand.board.length < 5, `${ctx}: runout state`);
}

function checkSettlement(hand, init, r, ctx) {
  const all = seatsOf(hand);
  const committed = {};
  for (const s of all) committed[s] = hand.seats[s].committed;
  assert.strictEqual(sum(r.payouts) + sum(r.returned), sum(committed), `${ctx}: sum(payouts)+sum(returned) != sum(committed)`);
  assert.strictEqual(sum(r.net), 0, `${ctx}: net does not sum to 0`);
  assert.strictEqual(sum(r.pots.map(p => p.amount)), sum(committed) - sum(r.returned), `${ctx}: pots do not hold the net commitments`);
  const o = oracle(hand);
  for (const s of all) {
    assert.strictEqual(r.net[s], r.payouts[s] + r.returned[s] - committed[s], `${ctx}: net formula seat ${s}`);
    assert.strictEqual(hand.seats[s].stack - init[s], r.net[s], `${ctx}: final stack - start != net, seat ${s}`);
    assert(hand.seats[s].stack >= 0, `${ctx}: negative stack`);
    // no seat is paid more than the pots it is eligible for
    const cap = o.pots.filter(p => p.eligible.includes(s)).reduce((a, p) => a + p.amount, 0);
    assert(r.payouts[s] <= cap, `${ctx}: seat ${s} paid ${r.payouts[s]} > eligible ${cap}`);
    if (hand.seats[s].folded) assert.strictEqual(r.payouts[s], 0, `${ctx}: folded seat ${s} paid`);
    assert.strictEqual(r.payouts[s], o.payouts[s], `${ctx}: payout seat ${s} differs from the oracle`);
  }
  for (const p of r.pots) {
    assert(p.winners.length >= 1 && p.winners.every(w => p.eligible.includes(w)), `${ctx}: pot winners not eligible`);
    assert(p.eligible.every(s => !hand.seats[s].folded), `${ctx}: folded seat eligible`);
  }
  assert.deepStrictEqual(r.pots.map(p => ({ amount: p.amount, eligible: p.eligible })), o.pots.map(p => ({ amount: p.amount, eligible: p.eligible })), `${ctx}: pots differ from the oracle`);
  assert.strictEqual(hand.phase, 'done');
  assert.strictEqual(H.settle(hand), r, `${ctx}: settle not idempotent`);
}

function playOne(rng, i, seed, cov) {
  const trace = { log: [] };
  try { return playOneInner(rng, i, seed, cov, trace); } catch (e) {
    e.message += `\n    repro: button ${trace.setup && trace.setup.button} sb/bb ${trace.setup && trace.setup.sb}/${trace.setup && trace.setup.bb} seats ${trace.setup && J(trace.setup.seats)}\n    actions: ${trace.log.join(' ').slice(-1200)}`;
    throw e;
  }
}

function playOneInner(rng, i, seed, cov, trace) {
  const setup = L.randomSetup(rng);
  trace.setup = setup;
  const ctx = `seed ${seed} hand ${i}`;
  let hand = H.createHand({ handNo: i, button: setup.button, sb: setup.sb, bb: setup.bb, seats: setup.seats, deck: setup.deck });
  let twin = clone(hand);
  const init = {}, total = setup.seats.reduce((t, x) => t + x.stack, 0);
  for (const x of setup.seats) init[x.seat] = x.stack;
  const probePct = rng() < 0.5 ? 0.5 : 0.1;
  const foldOutPct = rng() < 0.3 ? 0.04 : 0;
  const shove = pick(rng, [0.05, 0.15, 0.4]);
  if (setup.seats.length === 2) cov.hu++;
  if (setup.seats.length === 9) cov.nine++;
  if (setup.seats.some(x => x.stack < setup.bb)) cov.shortStack++;
  checkInvariants(hand, total, ctx + ' (create)');
  if (hand.phase === 'runout') cov.blindRunout++;

  let forced = false;
  for (let step = 0; step < 800; step++) {
    const sctx = `${ctx} step ${step} (${hand.phase}/${hand.street})`;
    if (rng() < 0.2) hand = clone(hand); // JSON round-trip mid-hand
    if (hand.phase === 'showdown') break;
    assert(hand.phase === 'betting' || hand.phase === 'runout', `${sctx}: unexpected phase`);

    if (foldOutPct && rng() < foldOutPct) {
      const seat = pick(rng, seatsOf(hand));
      const before = J(hand);
      trace.log.push(`foldOut(${seat})`);
      const ev = H.foldOut(hand, seat);
      if (before !== J(hand)) forced = true;
      twin = clone(twin); H.foldOut(twin, seat);
      assert.strictEqual(J(hand), J(twin), `${sctx}: twin diverged after foldOut`);
      cov.foldOut++;
      void ev;
      checkInvariants(hand, total, sctx + ' foldOut');
      continue;
    }
    if (hand.phase === 'runout') {
      assert.strictEqual(H.legalActions(hand, pick(rng, seatsOf(hand))), null);
      trace.log.push('deal');
      const ev = H.dealNext(hand);
      twin = clone(twin); H.dealNext(twin);
      assert.strictEqual(J(hand), J(twin), `${sctx}: twin diverged after dealNext`);
      assert(ev.length >= 1);
      cov.runout++;
      checkInvariants(hand, total, sctx + ' dealNext');
      continue;
    }

    // betting: every seat other than toAct must get null from legalActions
    const t = hand.toAct;
    const la = H.legalActions(hand, t);
    assert(la, `${sctx}: no legalActions for toAct ${t}`);
    for (const s of seatsOf(hand)) if (s !== t) assert.strictEqual(H.legalActions(hand, s), null, `${sctx}: legalActions for seat ${s} off turn`);
    assert(la.canCheck !== la.canCall, `${sctx}: exactly one of check/call`);
    if (la.canRaise) assert(la.minRaiseTo <= la.maxRaiseTo && la.minRaiseTo > hand.currentBet, `${sctx}: raise bounds`);

    let seatArg = t, action;
    if (rng() < probePct) {
      action = junkAction(rng, la);
      if (rng() < 0.3) seatArg = rng() < 0.5 ? pick(rng, seatsOf(hand)) : rint(rng, -1, 10);
      if (rng() < 0.05) seatArg = String(seatArg);
    } else action = L.legalPick(la, rng, { shove });
    const isOffered = offered(hand, la, seatArg, action) || (typeof seatArg === 'string' && /^\d+$/.test(seatArg) && Number(seatArg) === t && offered(hand, la, t, action));

    trace.log.push(`${J(seatArg)}:${J(action)}`);
    const snap = J(hand);
    let events = null, err = null;
    try { events = H.apply(hand, seatArg, action); } catch (e) { err = e; }
    if (err) {
      assert(err instanceof H.RuleError, `${sctx}: non-RuleError thrown: ${err && err.stack}`);
      assert.strictEqual(J(hand), snap, `${sctx}: hand changed by a rejected action ${J(action)}`);
      assert(!isOffered, `${sctx}: legalActions offered ${J(action)} (${la.canRaise ? la.minRaiseTo + '-' + la.maxRaiseTo : 'no raise'}) but apply threw ${err.code}`);
      cov.rejected++;
      if (err.code === 'raise_closed') cov.raiseClosed++;
      if (err.code === 'raise_too_small') cov.tooSmall++;
      if (err.code === 'bad_amount') cov.badAmount++;
      if (err.code === 'not_your_turn') cov.notTurn++;
      // the twin must reject it too and stay equal
      twin = clone(twin);
      assert.throws(() => H.apply(twin, seatArg, action), H.RuleError);
      continue;
    }
    assert(isOffered, `${sctx}: apply accepted ${J(action)} for seat ${J(seatArg)} but legalActions did not offer it`);
    twin = clone(twin); H.apply(twin, seatArg, action);
    assert.strictEqual(J(hand), J(twin), `${sctx}: twin diverged after apply`);
    for (const e of events) {
      if (e.type === 'raise' && !e.full) cov.shortRaise++;
      if (e.type === 'raise' && e.allIn) cov.shove++;
      if (e.type === 'returned') cov.returned++;
      if (e.type === 'call' && e.allIn) cov.allInCall++;
    }
    checkInvariants(hand, total, sctx);
  }
  assert.strictEqual(hand.phase, 'showdown', `${ctx}: hand did not terminate`);
  checkInvariants(hand, total, ctx + ' (showdown)');
  const live = seatsOf(hand).filter(s => !hand.seats[s].folded);
  const r = H.settle(hand);
  twin = clone(twin); const rt = H.settle(twin);
  assert.strictEqual(J(r), J(rt), `${ctx}: twin settle differs`);
  assert.strictEqual(J(hand), J(twin), `${ctx}: twin final state differs`);
  checkSettlement(hand, init, r, ctx);
  if (live.length === 1) cov.foldWin++; else cov.showdown++;
  if (r.pots.length >= 2) cov.sidePots++;
  if (r.pots.length >= 3) cov.sidePots3++;
  if (r.pots.some(p => p.winners.length > 1)) cov.split++;
  if (r.pots.some(p => p.amount % p.winners.length)) cov.oddChip++;
  if (forced) cov.forcedHands++;
  return r;
}

module.exports = function register(t, env) {
  t.case(`property: ${env.hands} random hands (seed ${env.seed}), legal+illegal actions, foldOut, JSON twin`, () => {
    const cov = { hu: 0, nine: 0, shortStack: 0, blindRunout: 0, foldOut: 0, runout: 0, rejected: 0, raiseClosed: 0, tooSmall: 0, badAmount: 0, notTurn: 0,
      shortRaise: 0, shove: 0, returned: 0, allInCall: 0, foldWin: 0, showdown: 0, sidePots: 0, sidePots3: 0, split: 0, oddChip: 0, forcedHands: 0 };
    const rng = mulberry32(env.seed * 1000003 + 17);
    for (let i = 0; i < env.hands; i++) playOne(rng, i, env.seed, cov);
    if (env.hands >= 2000) {
      for (const k of Object.keys(cov)) assert(cov[k] > 0, `coverage: never exercised "${k}" (${J(cov)})`);
    }
    t.coverage = cov;
    if (process.env.ENGINE_VERBOSE) console.log('    coverage', J(cov));
  });
};
