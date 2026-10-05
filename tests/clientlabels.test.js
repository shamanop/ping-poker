'use strict';
// Compares the client's live hand labels (public/game.js) against the server evaluator.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const srv = require('../server.js');

const src = fs.readFileSync(path.join(__dirname, '../public/game.js'), 'utf8');
const start = src.indexOf('// ─── Hand labels');
const end = src.indexOf('// ─── Utils');
assert(start > 0 && end > start, 'could not locate hand label region in game.js');
const ctx = vm.createContext({});
vm.runInContext(src.slice(start, end) + '\nthis.evalHandLabel = evalHandLabel; this.evalPreflopLabel = evalPreflopLabel;', ctx);
const { evalHandLabel, evalPreflopLabel } = ctx;

const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const DECK = [];
for (const r of RANKS) for (const s of SUITS) DECK.push({ rank: r, suit: s });
const card = (r, s) => ({ rank: r, suit: s });
const val = c => RANKS.indexOf(c.rank) + 2;

let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function deal(n) {
  const d = [...DECK];
  for (let i = 0; i < n; i++) { const j = i + Math.floor(rnd() * (d.length - i)); [d[i], d[j]] = [d[j], d[i]]; }
  return d.slice(0, n);
}

const MADE_LEN = { 'High Card': 0, 'Pair': 1, 'Two Pair': 2, 'Three of a Kind': 1, 'Straight': 1, 'Flush': 5, 'Full House': 2, 'Four of a Kind': 1, 'Straight Flush': 1, 'Royal Flush': 1 };

// Board-only category on 3-4 cards, by rank counts only (server evaluate5 misreads short flushes)
function partialBoard(comm) {
  const f = {};
  for (const c of comm) f[val(c)] = (f[val(c)] || 0) + 1;
  const g = Object.entries(f).map(([r, n]) => ({ r: +r, n })).sort((a, b) => b.n - a.n || b.r - a.r);
  const name = g[0].n === 4 ? 'Four of a Kind' : g[0].n === 3 ? 'Three of a Kind' : g[0].n === 2 && g[1]?.n === 2 ? 'Two Pair' : g[0].n === 2 ? 'Pair' : 'High Card';
  return { name, made: g.filter(x => x.n >= 2).map(x => x.r) };
}

function expected(hole, comm) {
  const me = srv.bestHand(hole, comm);
  const n = MADE_LEN[me.name];
  if (comm.length >= 5) {
    const bd = srv.bestHand([], comm);
    if (srv.compareHands(me, bd) === 0) return 'Board plays';
    if (me.name === bd.name && me.name !== 'High Card' && me.kickers.slice(0, n).join() === bd.kickers.slice(0, n).join()) return `Board ${me.name.toLowerCase()}`;
    return me.name;
  }
  const bd = partialBoard(comm);
  if (bd.name === me.name && me.name !== 'High Card' && me.kickers.slice(0, n).join() === bd.made.join()) return `Board ${me.name.toLowerCase()}`;
  return me.name;
}

function check(hole, comm, tag) {
  const exp = expected(hole, comm), got = evalHandLabel(hole, comm);
  assert.strictEqual(got, exp, `${tag}: hole=${hole.map(c => c.rank + c.suit)} board=${comm.map(c => c.rank + c.suit)} expected "${exp}" got "${got}"`);
}

// ── Targeted scenarios ──
const T = [
  ['wheel', [card('A','♠'), card('2','♥')], [card('3','♦'), card('4','♣'), card('5','♠'), card('K','♥'), card('9','♦')], 'Straight'],
  ['wheel straight flush', [card('A','♠'), card('2','♠')], [card('3','♠'), card('4','♠'), card('5','♠'), card('K','♥'), card('9','♦')], 'Straight Flush'],
  ['royal', [card('A','♠'), card('K','♠')], [card('Q','♠'), card('J','♠'), card('10','♠'), card('2','♥'), card('9','♦')], 'Royal Flush'],
  ['flush 6 suited', [card('A','♠'), card('2','♠')], [card('7','♠'), card('9','♠'), card('J','♠'), card('K','♠'), card('3','♦')], 'Flush'],
  ['full house two trips', [card('K','♠'), card('K','♥')], [card('K','♦'), card('5','♠'), card('5','♥'), card('5','♦'), card('2','♣')], 'Full House'],
  ['three pairs', [card('K','♠'), card('5','♥')], [card('K','♦'), card('5','♠'), card('3','♥'), card('3','♦'), card('9','♣')], 'Two Pair'],
  ['board plays straight', [card('2','♠'), card('2','♥')], [card('5','♦'), card('6','♣'), card('7','♠'), card('8','♥'), card('9','♦')], 'Board plays'],
  ['board plays quads', [card('2','♠'), card('3','♥')], [card('K','♦'), card('K','♣'), card('K','♠'), card('K','♥'), card('9','♦')], 'Board plays'],
  ['board plays flush', [card('2','♥'), card('3','♥')], [card('K','♠'), card('9','♠'), card('7','♠'), card('5','♠'), card('4','♠')], 'Board plays'],
  ['hole improves board flush', [card('A','♠'), card('3','♥')], [card('K','♠'), card('9','♠'), card('7','♠'), card('5','♠'), card('4','♠')], 'Flush'],
  ['board pair kicker only', [card('A','♠'), card('3','♥')], [card('K','♦'), card('K','♣'), card('7','♠'), card('5','♥'), card('9','♦')], 'Board pair'],
  ['board pair flop', [card('A','♠'), card('3','♥')], [card('K','♦'), card('K','♣'), card('7','♠')], 'Board pair'],
  ['hole pair on board pair', [card('A','♠'), card('A','♥')], [card('K','♦'), card('K','♣'), card('7','♠')], 'Two Pair'],
  ['board two pair, hole higher pair', [card('9','♠'), card('9','♥')], [card('5','♦'), card('5','♣'), card('3','♠'), card('3','♥')], 'Two Pair'],
  ['board two pair turn unchanged', [card('A','♠'), card('9','♥')], [card('5','♦'), card('5','♣'), card('3','♠'), card('3','♥')], 'Board two pair'],
  ['board trips', [card('A','♠'), card('9','♥')], [card('5','♦'), card('5','♣'), card('5','♠')], 'Board three of a kind'],
  ['flop flush draw not flush', [card('A','♠'), card('9','♠')], [card('5','♠'), card('6','♠'), card('K','♥')], 'High Card'],
  ['flop three suited board', [card('A','♥'), card('9','♥')], [card('5','♠'), card('6','♠'), card('K','♠')], 'High Card'],
  ['pair kicker', [card('A','♠'), card('Q','♥')], [card('Q','♦'), card('7','♣'), card('2','♠'), card('3','♥'), card('9','♦')], 'Pair'],
];
for (const [name, hole, comm, exp] of T) {
  assert.strictEqual(evalHandLabel(hole, comm), exp, `scenario "${name}"`);
  check(hole, comm, `scenario "${name}"`);
}

// ── Random sweeps ──
const N = 30000;
for (const [len, tag] of [[3, 'flop'], [4, 'turn'], [5, 'river']]) {
  for (let i = 0; i < N; i++) { const d = deal(2 + len); check(d.slice(0, 2), d.slice(2), tag); }
}
// Biased sweeps: small rank pool to force trips/quads/full houses/two+ pairs; few suits for flushes; wheel ranks
function biased(pool, suits, len) {
  const d = [];
  const seen = new Set();
  while (d.length < 2 + len) {
    const c = card(pool[Math.floor(rnd() * pool.length)], suits[Math.floor(rnd() * suits.length)]);
    const k = c.rank + c.suit;
    if (!seen.has(k)) { seen.add(k); d.push(c); }
  }
  return d;
}
const pools = [['A','2','3','4','5','6'], ['K','Q','J','10','9'], ['2','3','4','5'], ['7','8','9','10','J','Q']];
for (const len of [3, 4, 5]) {
  for (let i = 0; i < 15000; i++) {
    const pool = pools[i % pools.length];
    const suits = i % 3 === 0 ? ['♠', '♥'] : i % 3 === 1 ? ['♠'] : SUITS;
    if (pool.length * suits.length < 2 + len) continue;
    const d = biased(pool, suits, len);
    check(d.slice(0, 2), d.slice(2), `biased-${len}`);
  }
}

// ── Preflop ──
const NAMES = { '2': 'Twos', '3': 'Threes', '4': 'Fours', '5': 'Fives', '6': 'Sixes', '7': 'Sevens', '8': 'Eights', '9': 'Nines', '10': 'Tens', 'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings', 'A': 'Aces' };
function expectedPre(a, b) {
  const suited = a.suit === b.suit;
  if (a.rank === b.rank) return `Pocket ${NAMES[a.rank]}`;
  const [hi, lo] = val(a) > val(b) ? [a, b] : [b, a];
  const key = hi.rank + lo.rank;
  const named = { AK: ['Ace-King Suited', 'Big Slick'], AQ: ['Ace-Queen Suited', 'Ace-Queen'], KQ: ['King-Queen Suited', 'King-Queen'], AJ: ['Ace-Jack Suited', 'Ace-Jack'] }[key];
  if (named) return suited ? named[0] : named[1];
  const gap = val(hi) - val(lo);
  if (gap === 1) return suited ? 'Suited Connectors' : 'Connectors';
  return `${hi.rank}-${lo.rank} ${suited ? 'Suited' : 'Offsuit'}`;
}
let pre = 0;
for (const a of DECK) for (const b of DECK) {
  if (a === b) continue;
  assert.strictEqual(evalPreflopLabel([a, b]), expectedPre(a, b), `preflop ${a.rank}${a.suit} ${b.rank}${b.suit}`);
  pre++;
}
assert.strictEqual(evalPreflopLabel([card('A','♠'), card('A','♥')]), 'Pocket Aces');
assert.strictEqual(evalPreflopLabel([card('A','♠'), card('K','♠')]), 'Ace-King Suited');
assert.strictEqual(evalPreflopLabel([card('A','♠'), card('2','♠')]), 'A-2 Suited');
assert.strictEqual(evalPreflopLabel([]), '');

console.log(`clientlabels: ${T.length} scenarios, ${N * 3 + 45000} random boards, ${pre} preflop combos OK`);
