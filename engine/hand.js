'use strict';
// OWNER: engine builder. Pure poker hand state machine (V2-DESIGN.md "engine/").
// No timers, no I/O, no Date, no Math.random. State is a plain object that survives JSON round-trips.
const { bestHand, compareHands } = require('./evaluate');
const { sidePots } = require('./pots');

const STREETS = ['preflop', 'flop', 'turn', 'river'];

class RuleError extends Error {
  constructor(code, details) {
    super(code);
    this.name = 'RuleError';
    this.code = code;
    this.details = details || {};
  }
}

const isInt = n => Number.isSafeInteger(n);

// Seat argument: an integer, or a digit string (socket/object keys). Anything else is NaN (never a seat).
function toSeat(x) {
  if (typeof x === 'number' && Number.isInteger(x)) return x;
  if (typeof x === 'string' && /^\d{1,6}$/.test(x)) return Number(x);
  return NaN;
}

// ─── seat helpers ────────────────────────────────────────────────────────────

function seatNums(hand) { return Object.keys(hand.seats).map(Number).sort((a, b) => a - b); }

// Seats in clockwise order starting just after `from`, ending with `from` itself.
function ringAfter(hand, from) {
  const all = seatNums(hand);
  return all.filter(s => s > from).concat(all.filter(s => s <= from));
}

function liveSeats(hand) { return seatNums(hand).filter(s => !hand.seats[s].folded); }

function othersCanAct(hand, n) {
  return seatNums(hand).some(t => t !== n && !hand.seats[t].folded && !hand.seats[t].allIn);
}

// Does this seat still owe a decision on the current street?
function needsAction(hand, n) {
  const s = hand.seats[n];
  if (s.folded || s.allIn) return false;
  if (s.bet < hand.currentBet) return true;
  if (!s.acted) return othersCanAct(hand, n);
  return false;
}

function nextToAct(hand, from) {
  for (const s of ringAfter(hand, from)) if (needsAction(hand, s)) return s;
  return null;
}

function totalPot(hand) {
  let t = 0;
  for (const s of seatNums(hand)) t += hand.seats[s].committed - hand.seats[s].returned;
  return t;
}

// ─── createHand ──────────────────────────────────────────────────────────────

function createHand(opts) {
  const { handNo, button, sb, bb, seats, deck } = opts || {};
  if (!Array.isArray(seats) || seats.length < 2) throw new RuleError('bad_seats', { need: 'at least 2 seats' });
  if (!isInt(sb) || !isInt(bb) || sb < 1 || bb < 1 || sb > bb) throw new RuleError('bad_blinds', { sb, bb });
  if (!Array.isArray(deck)) throw new RuleError('bad_deck', {});
  if (deck.length < seats.length * 2 + 8) throw new RuleError('bad_deck', { have: deck.length });
  const map = {};
  for (const x of seats) {
    if (!x || !isInt(x.seat) || x.seat < 0) throw new RuleError('bad_seats', { seat: x && x.seat });
    if (map[x.seat]) throw new RuleError('bad_seats', { dup: x.seat });
    if (!isInt(x.stack) || x.stack < 1) throw new RuleError('bad_stack', { seat: x.seat, stack: x.stack });
    map[x.seat] = { stack: x.stack, bet: 0, committed: 0, returned: 0, folded: false, allIn: false, hole: [], acted: false, canRaise: true };
  }
  if (!isInt(button) || !map[button]) throw new RuleError('bad_button', { button });

  const hand = {
    handNo, button, sbSeat: null, bbSeat: null, sb, bb,
    street: 'preflop', phase: 'betting', board: [], deck: deck.slice(), toAct: null,
    currentBet: bb, lastFullRaise: bb, uncontested: false, result: null,
    seats: map,
  };
  const order = seatNums(hand);
  for (let r = 0; r < 2; r++) for (const s of order) hand.seats[s].hole.push(hand.deck.pop());

  if (order.length === 2) {
    hand.sbSeat = button;
    hand.bbSeat = order.find(s => s !== button);
  } else {
    hand.sbSeat = ringAfter(hand, button)[0];
    hand.bbSeat = ringAfter(hand, hand.sbSeat)[0];
  }
  postBlind(hand, hand.sbSeat, sb);
  postBlind(hand, hand.bbSeat, bb);

  const first = nextToAct(hand, hand.bbSeat);
  if (first === null) closeBetting(hand, []);
  else hand.toAct = first;
  return hand;
}

function postBlind(hand, n, amount) {
  const s = hand.seats[n];
  const pay = Math.min(amount, s.stack);
  s.stack -= pay; s.bet += pay; s.committed += pay;
  if (s.stack === 0) s.allIn = true;
}

// ─── legalActions ────────────────────────────────────────────────────────────

function info(hand, n) {
  const s = hand.seats[n];
  const toCall = Math.max(0, hand.currentBet - s.bet);
  const max = s.bet + s.stack;
  let min = hand.currentBet + hand.lastFullRaise;
  if (min > max) min = max;
  const canRaise = s.canRaise && s.stack > toCall && othersCanAct(hand, n);
  return { toCall, callAmount: Math.min(toCall, s.stack), canRaise, min, max };
}

function legalActions(hand, seat) {
  const n = toSeat(seat);
  if (hand.phase !== 'betting' || !Number.isInteger(n) || hand.toAct !== n) return null;
  const i = info(hand, n);
  return {
    toCall: i.toCall,
    canCheck: i.toCall === 0,
    canCall: i.toCall > 0,
    callAmount: i.callAmount,
    canRaise: i.canRaise,
    minRaiseTo: i.canRaise ? i.min : null,
    maxRaiseTo: i.canRaise ? i.max : null,
  };
}

// ─── apply ───────────────────────────────────────────────────────────────────

function apply(hand, seat, action) {
  const n = toSeat(seat);
  if (hand.phase !== 'betting' || !Number.isInteger(n) || hand.toAct !== n) {
    throw new RuleError('not_your_turn', { seat, toAct: hand.toAct });
  }
  if (!action || typeof action !== 'object') throw new RuleError('bad_action', {});
  const s = hand.seats[n];
  const i = info(hand, n);
  const events = [];

  switch (action.type) {
    case 'fold':
      s.folded = true;
      events.push({ type: 'fold', seat: n });
      break;

    case 'check':
      if (i.toCall > 0) throw new RuleError('cannot_check', { toCall: i.toCall });
      s.acted = true;
      events.push({ type: 'check', seat: n });
      break;

    case 'call': {
      if (i.toCall === 0) throw new RuleError('cannot_call', {});
      const pay = i.callAmount;
      s.stack -= pay; s.bet += pay; s.committed += pay;
      if (s.stack === 0) s.allIn = true;
      s.acted = true;
      events.push({ type: 'call', seat: n, amount: pay, allIn: s.allIn });
      break;
    }

    case 'raise': {
      const to = action.to;
      if (!isInt(to) || to <= 0) throw new RuleError('bad_amount', { have: to });
      const det = { min: i.min, max: i.max, have: to };
      if (!s.canRaise || !othersCanAct(hand, n)) throw new RuleError('raise_closed', det);
      if (s.stack <= i.toCall) throw new RuleError(to > i.max ? 'raise_too_big' : 'raise_too_small', det);
      if (to > i.max) throw new RuleError('raise_too_big', det);
      if (to < i.min) throw new RuleError('raise_too_small', det);

      const add = to - s.bet;
      const size = to - hand.currentBet;
      const full = size >= hand.lastFullRaise;
      const kind = hand.currentBet === 0 ? 'bet' : 'raise';
      s.stack -= add; s.bet = to; s.committed += add;
      if (s.stack === 0) s.allIn = true;
      s.acted = true;
      hand.currentBet = to;
      for (const o of seatNums(hand)) {
        if (o === n) continue;
        const x = hand.seats[o];
        if (x.folded || x.allIn) continue;
        if (full) { x.acted = false; x.canRaise = true; }
        else if (x.acted) x.canRaise = false; // short all-in does not reopen for seats that already acted
      }
      if (full) hand.lastFullRaise = size;
      events.push({ type: 'raise', kind, seat: n, to, added: add, allIn: s.allIn, full });
      break;
    }

    default:
      throw new RuleError('bad_action', { type: action.type });
  }

  advance(hand, n, events);
  return events;
}

function advance(hand, from, events) {
  if (liveSeats(hand).length === 1) { closeBetting(hand, events); return; }
  const nxt = nextToAct(hand, from);
  if (nxt === null) closeBetting(hand, events);
  else hand.toAct = nxt;
}

// ─── closing a betting round ────────────────────────────────────────────────

function returnUncalled(hand, events) {
  const bets = seatNums(hand).map(s => ({ s, bet: hand.seats[s].bet })).filter(e => e.bet > 0).sort((a, b) => b.bet - a.bet);
  if (!bets.length) return;
  const second = bets.length > 1 ? bets[1].bet : 0;
  if (bets[0].bet <= second) return;
  const x = hand.seats[bets[0].s];
  // A seat that folded by its own action forfeits its whole bet (dead money, same as the old server's showdown).
  // E1: a seat removed by foldOut (kicked, stood up) still gets the uncalled layer back.
  if (x.folded && !x.forced) return;
  const back = bets[0].bet - second;
  // Only skip when handing it back would leave the pot empty (nothing for the live seat to play for).
  if (totalPot(hand) - back <= 0) return;
  x.bet -= back; x.stack += back; x.returned += back;
  if (x.stack > 0) x.allIn = false;
  events.push({ type: 'returned', seat: bets[0].s, amount: back });
}

function toShowdown(hand, events) {
  hand.phase = 'showdown';
  hand.street = 'showdown';
  hand.toAct = null;
  hand.uncontested = liveSeats(hand).length === 1;
  events.push({ type: 'showdown', uncontested: hand.uncontested });
}

function dealStreet(hand, events) {
  const next = STREETS[STREETS.indexOf(hand.street) + 1];
  hand.deck.pop(); // burn
  const cards = [];
  for (let k = next === 'flop' ? 3 : 1; k > 0; k--) cards.push(hand.deck.pop());
  hand.board.push(...cards);
  hand.street = next;
  events.push({ type: 'street', street: next, cards });
}

function closeBetting(hand, events) {
  hand.toAct = null;
  returnUncalled(hand, events);
  for (const s of seatNums(hand)) hand.seats[s].bet = 0;
  hand.currentBet = 0;
  const live = liveSeats(hand);
  if (live.length === 1 || hand.street === 'river') { toShowdown(hand, events); return; }
  const canAct = live.filter(s => !hand.seats[s].allIn);
  if (canAct.length < 2) {
    hand.phase = 'runout';
    events.push({ type: 'runout' });
    return;
  }
  dealStreet(hand, events);
  hand.lastFullRaise = hand.bb;
  for (const s of canAct) { hand.seats[s].acted = false; hand.seats[s].canRaise = true; }
  hand.toAct = nextToAct(hand, hand.button);
}

// ─── dealNext / foldOut ─────────────────────────────────────────────────────

function dealNext(hand) {
  if (hand.phase !== 'runout') throw new RuleError('not_runout', { phase: hand.phase });
  const events = [];
  dealStreet(hand, events);
  if (hand.street === 'river') toShowdown(hand, events);
  return events;
}

function foldOut(hand, seat) {
  const n = toSeat(seat);
  const s = Number.isInteger(n) ? hand.seats[n] : undefined;
  if (!s) throw new RuleError('not_in_hand', { seat });
  if (hand.phase === 'showdown' || hand.phase === 'done') throw new RuleError('hand_over', { phase: hand.phase });
  if (s.folded) return [];
  s.folded = true;
  s.forced = true;
  const events = [{ type: 'fold', seat: n, forced: true }];
  if (hand.phase === 'runout') {
    if (liveSeats(hand).length === 1) toShowdown(hand, events);
    return events;
  }
  if (liveSeats(hand).length === 1) { closeBetting(hand, events); return events; }
  if (hand.toAct === n || !needsAction(hand, hand.toAct)) advance(hand, hand.toAct, events);
  return events;
}

// ─── settle ──────────────────────────────────────────────────────────────────

// Phase 'showdown' only (everyone-else-folded counts). Credits the payouts to `stack`, sets phase 'done',
// and caches the result on the hand so a second call returns the same object.
function settle(hand) {
  if (hand.result) return hand.result;
  if (hand.phase !== 'showdown') throw new RuleError('not_settleable', { phase: hand.phase });
  const all = seatNums(hand);
  const live = liveSeats(hand);
  const contested = live.length > 1;
  const folded = all.filter(s => hand.seats[s].folded);
  const net0 = {};
  for (const s of all) net0[s] = hand.seats[s].committed - hand.seats[s].returned;
  const pots = sidePots(net0, folded);

  const hands = {};
  if (contested) for (const s of live) hands[s] = bestHand(hand.seats[s].hole, hand.board);

  const order = ringAfter(hand, hand.button); // first seat left of the button first
  const payouts = {}, returned = {}, net = {};
  for (const s of all) { payouts[s] = 0; returned[s] = hand.seats[s].returned; }

  const outPots = pots.map(p => {
    let winners = p.eligible;
    if (contested && p.eligible.length > 1) {
      let top = hands[p.eligible[0]];
      for (const s of p.eligible) if (compareHands(hands[s], top) > 0) top = hands[s];
      winners = p.eligible.filter(s => compareHands(hands[s], top) === 0);
    }
    winners = winners.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const share = Math.floor(p.amount / winners.length);
    const rem = p.amount - share * winners.length;
    winners.forEach((w, k) => { payouts[w] += share + (k < rem ? 1 : 0); });
    return { amount: p.amount, eligible: p.eligible.slice(), winners };
  });

  for (const s of all) net[s] = payouts[s] + returned[s] - hand.seats[s].committed;
  const reveals = contested ? live.slice() : [];
  const handNames = {};
  for (const s of reveals) handNames[s] = hands[s].name;

  for (const s of all) hand.seats[s].stack += payouts[s];
  hand.phase = 'done';
  hand.street = 'done';
  hand.result = { pots: outPots, payouts, returned, net, reveals, handNames };
  return hand.result;
}

module.exports = { createHand, legalActions, apply, foldOut, dealNext, settle, totalPot, RuleError };
