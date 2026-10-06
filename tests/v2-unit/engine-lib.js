'use strict';
// Shared helpers for the engine tests. OWNER: engine builder.
const assert = require('assert');
const H = require('../../engine/hand');
const { makeDeck, shuffle } = require('../../engine/deck');

// Seeded rng (mulberry32). seed -> () => [0,1)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rint = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)); // inclusive
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ─── tiny test registry ──────────────────────────────────────────────────────
// A test file exports register(t, env). t.case(name, fn) queues a case; run() returns counts.
function makeSuite(file) {
  const cases = [];
  return {
    file, cases,
    case(name, fn) { cases.push({ name, fn }); },
  };
}
function runSuite(suite, log) {
  let pass = 0, fail = 0;
  const failures = [];
  for (const c of suite.cases) {
    try { c.fn(); pass++; } catch (e) {
      fail++;
      failures.push(`${suite.file} :: ${c.name}\n    ${String(e && e.message || e).split('\n').slice(0, 6).join('\n    ')}`);
    }
  }
  return { pass, fail, failures };
}

// ─── cards ───────────────────────────────────────────────────────────────────
const SU = { s: '♠', h: '♥', d: '♦', c: '♣' };
const card = c => ({ rank: c[0] === 'T' ? '10' : c[0], suit: SU[c[1]] });
const ALL = (() => { const o = []; for (const s of 'shdc') for (const r of '23456789TJQKA') o.push(r + s); return o; })();

// holes: one ['As','Kd'] per dealt seat in ascending seat order. board: 5 cards. Returns a deck for createHand
// (pop order: holes round 1, holes round 2, burn, flop x3, burn, turn, burn, river). Same as tests/v2/lib.js rigDeck.
function rigDeck(holes, board) {
  const used = new Set([...holes.flat(), ...board]);
  const rest = ALL.filter(c => !used.has(c));
  const burns = rest.splice(0, 3);
  const pops = [...holes.map(h => h[0]), ...holes.map(h => h[1]), burns[0], board[0], board[1], board[2], burns[1], board[3], burns[2], board[4]];
  return [...rest, ...pops.reverse()].map(card);
}

// ─── hand scripting ──────────────────────────────────────────────────────────
// stacks: { seat: stack } or array (seat = index). Returns the hand.
function mk({ stacks, button = 0, sb = 25, bb = 50, holes, board, deck, handNo = 1, rng }) {
  const seatNums = Array.isArray(stacks) ? stacks.map((_, i) => i) : Object.keys(stacks).map(Number).sort((a, b) => a - b);
  const get = s => (Array.isArray(stacks) ? stacks[s] : stacks[s]);
  let d = deck;
  if (!d) {
    if (holes) d = rigDeck(holes, board || ['2c', '7d', '9h', 'Js', '3d']);
    else d = shuffle(makeDeck(), rng || mulberry32(7));
  }
  return H.createHand({ handNo, button, sb, bb, seats: seatNums.map(s => ({ seat: s, stack: get(s) })), deck: d });
}

// script: [[seat, 'fold'|'check'|'call'|'raise', to?], ...]. Applies in order; returns all events.
function play(hand, script) {
  const ev = [];
  for (const [seat, type, to] of script) ev.push(...H.apply(hand, seat, to === undefined ? { type } : { type, to }));
  return ev;
}
// Deal any remaining run-out streets.
function runOut(hand) {
  while (hand.phase === 'runout') H.dealNext(hand);
  return hand;
}
function finish(hand) { runOut(hand); return H.settle(hand); }
function stacksOf(hand) { return Object.keys(hand.seats).map(Number).sort((a, b) => a - b).map(s => hand.seats[s].stack); }

const clone = x => JSON.parse(JSON.stringify(x));

function throwsRule(fn, code) {
  try { fn(); } catch (e) {
    assert(e instanceof H.RuleError, `expected RuleError, got ${e && e.stack || e}`);
    if (code) assert.strictEqual(e.code, code, `expected ${code}, got ${e.code}`);
    return e;
  }
  assert.fail(`expected RuleError${code ? ' ' + code : ''}, nothing thrown`);
}

module.exports = { assert, H, mulberry32, rint, pick, makeSuite, runSuite, card, ALL, rigDeck, mk, play, runOut, finish, stacksOf, clone, throwsRule };
