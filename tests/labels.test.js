'use strict';
const assert = require('assert');
const srv = require('../server.js');

const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const NAMES = ['', 'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'];

// ── Independent reference evaluator: returns { cat, tb } over any 5-7 cards ──
function ref(cards) {
  const v = c => RANKS.indexOf(c.rank) + 2;
  const byRank = {}, bySuit = {};
  for (const c of cards) { (byRank[v(c)] ||= []).push(c); (bySuit[c.suit] ||= []).push(v(c)); }
  const present = new Set(cards.map(v));
  const straightHigh = set => {
    for (let h = 14; h >= 5; h--) {
      let ok = true;
      for (let k = 0; k < 5; k++) { const x = h - k === 1 ? 14 : h - k; if (!set.has(x)) { ok = false; break; } }
      if (ok) return h;
    }
    return 0;
  };
  const desc = a => [...a].sort((x, y) => y - x);
  let flushVals = null;
  for (const s of SUITS) if ((bySuit[s] || []).length >= 5) flushVals = bySuit[s];
  if (flushVals) {
    const h = straightHigh(new Set(flushVals));
    if (h) return { cat: h === 14 ? 10 : 9, tb: [h] };
  }
  const groups = Object.entries(byRank).map(([r, cs]) => ({ r: +r, n: cs.length }))
    .sort((a, b) => b.n - a.n || b.r - a.r);
  const quads = groups.filter(g => g.n === 4), trips = groups.filter(g => g.n === 3), pairs = groups.filter(g => g.n === 2);
  const singles = desc(groups.map(g => g.r));
  if (quads.length) {
    const rest = desc(groups.filter(g => g.r !== quads[0].r).map(g => g.r));
    return { cat: 8, tb: [quads[0].r, rest[0]] };
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0].r;
    const pr = desc([...trips.slice(1).map(g => g.r), ...pairs.map(g => g.r)])[0];
    return { cat: 7, tb: [t, pr] };
  }
  if (flushVals) return { cat: 6, tb: desc(flushVals).slice(0, 5) };
  const sh = straightHigh(present);
  if (sh) return { cat: 5, tb: [sh] };
  if (trips.length) {
    const rest = singles.filter(x => x !== trips[0].r).slice(0, 2);
    return { cat: 4, tb: [trips[0].r, ...rest] };
  }
  if (pairs.length >= 2) {
    const pp = pairs.map(g => g.r).sort((a, b) => b - a).slice(0, 2);
    const kick = singles.filter(x => !pp.includes(x))[0];
    return { cat: 3, tb: [...pp, kick] };
  }
  if (pairs.length === 1) {
    const rest = singles.filter(x => x !== pairs[0].r).slice(0, 3);
    return { cat: 2, tb: [pairs[0].r, ...rest] };
  }
  return { cat: 1, tb: singles.slice(0, 5) };
}
function refCmp(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.tb.length, b.tb.length); i++) {
    const d = (a.tb[i] || 0) - (b.tb[i] || 0);
    if (d) return d;
  }
  return 0;
}

const C = s => { // "As" "10h" "Kd" "2c"
  const m = s.match(/^(10|[2-9JQKA])([shdc])$/);
  return { rank: m[1], suit: { s: '♠', h: '♥', d: '♦', c: '♣' }[m[2]] };
};
const H = str => str.trim().split(/\s+/).map(C);

let failures = 0, checks = 0;
function fail(msg) { failures++; if (failures <= 25) console.log('FAIL:', msg); }
const show = cs => cs.map(c => c.rank + c.suit).join(' ');

function checkHand(hole, board, expectName) {
  checks++;
  const r = ref([...hole, ...board]);
  const got = srv.bestHand(hole, board);
  const want = expectName || NAMES[r.cat];
  if (got.name !== want) fail(`label [${show(hole)} | ${show(board)}] got "${got.name}" want "${want}"`);
  const g = { cat: NAMES.indexOf(got.name), tb: got.kickers };
  if (refCmp({ cat: g.cat, tb: got.kickers }, r) !== 0) fail(`strength [${show(hole)} | ${show(board)}] got ${got.name} ${got.kickers} want ${NAMES[r.cat]} ${r.tb}`);
}

// ── Edge cases ──
checkHand(H('Ah 2d'), H('3c 4s 5h 9d Kc'), 'Straight');            // wheel
checkHand(H('Ah 2h'), H('3h 4h 5h 9d Kc'), 'Straight Flush');      // steel wheel
checkHand(H('Ah Kh'), H('Qh Jh 10h 2d 3c'), 'Royal Flush');
checkHand(H('9h Kh'), H('Qh Jh 10h 2d 3c'), 'Straight Flush');
checkHand(H('2h 9h'), H('Kh 5h 7h Jh 3c'), 'Flush');               // 6 suited
checkHand(H('Ah 9h'), H('Kh 5h 7h Jh 3c'), 'Flush');
checkHand(H('Ah Ad'), H('Ac Kh Kd 2c 3s'), 'Full House');
checkHand(H('Ah Ad'), H('Ac Kh Kd Ks 3s'), 'Full House');          // two trips
checkHand(H('Ah Ad'), H('Kc Kh Qd Qs 3s'), 'Two Pair');            // 3 pairs
checkHand(H('Ah Ad'), H('Kc Kh Qd Qs As'), 'Full House');
checkHand(H('2h 7d'), H('Ah Kd Qc Jc 9s'), 'High Card');
checkHand(H('2h 7d'), H('Ah Ad Qc Jc 9s'), 'Pair');
checkHand(H('2h 2d'), H('2c 7d Qc Jc 9s'), 'Three of a Kind');
checkHand(H('6h 7d'), H('2c 3d 4c 5c 9s'), 'Straight');            // 7-high via 3-7
checkHand(H('Kh Kd'), H('Ac 2d 3c 4c 5s'), 'Straight');
checkHand(H('Ah Kd'), H('Qc Jd 10c 9s 2s'), 'Straight');           // broadway
checkHand(H('Ah Kd'), H('Qc Jd 10c 2s 2h'), 'Straight');
checkHand(H('9h 9d'), H('9c 9s 2c 2d 2s'), 'Four of a Kind');      // quads + trips on board
checkHand(H('3h 3d'), H('3c 2s 2c 2d 9s'), 'Full House');
checkHand(H('Ah Kd'), H('Qc Jd 10c 9s 8s'), 'Straight');
// 5-card boards-only (board plays)
checkHand(H('2c 3d'), H('As Ks Qs Js 10s'), 'Royal Flush');
checkHand(H('2c 3d'), H('Ah Ad Ac Kd Kc'), 'Full House');
// flush that is not a straight flush while a straight also exists
checkHand(H('9h 8h'), H('7h 6h 5c 2h 4d'), 'Flush');
checkHand(H('9h 8h'), H('7h 6h 5h 2h 4d'), 'Straight Flush');
checkHand(H('Ah 2h'), H('3h 4h 6h 5h 9d'), 'Straight Flush');      // 6-high SF beats wheel SF

// ── Random hands, labels ──
function deck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ rank: r, suit: s });
  return d;
}
function shuffle(d) { for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return d; }

for (let i = 0; i < 20000; i++) {
  const d = shuffle(deck());
  const n = 5 + (i % 3);
  const cards = d.slice(0, n);
  checkHand(cards.slice(0, 2), cards.slice(2));
}
// biased decks to hit rare categories (few ranks / few suits)
for (let i = 0; i < 20000; i++) {
  const ranks = shuffle([...RANKS]).slice(0, 4 + (i % 4));
  const suits = shuffle([...SUITS]).slice(0, 1 + (i % 3));
  const d = shuffle(deck().filter(c => ranks.includes(c.rank) && suits.includes(c.suit)));
  if (d.length < 7) continue;
  checkHand(d.slice(0, 2), d.slice(2, 7));
}
for (let i = 0; i < 10000; i++) { // consecutive ranks (straights / wheels)
  const start = Math.floor(Math.random() * 9);
  const ranks = RANKS.slice(start, start + 5 + (i % 3));
  if (Math.random() < 0.25) ranks.push('A');
  const d = shuffle(deck().filter(c => ranks.includes(c.rank)));
  checkHand(d.slice(0, 2), d.slice(2, 7));
}

// ── Showdown winners / splits via the real showdown() ──
// v2: server.js re-exports only bestHand/compareHands/evaluate5; showdown()/makeRoom() died with the old room code. Showdown winners, splits and side
// pots are pinned by tests/v2 (01-06, 26) and tests/v2-unit/run-engine.js, so this section is skipped on purpose.
if (typeof srv.showdown !== 'function' || typeof srv.makeRoom !== 'function') console.log('labels.test: showdown()/makeRoom() section SKIPPED (stale by design in v2; covered by tests/v2 and run-engine.js)');
else {
const emitted = [];
srv.io.to = () => ({ emit: (ev, payload) => emitted.push([ev, payload]) });

function runShowdown(holes, board, contributions) {
  const room = srv.makeRoom('T' + Math.random(), null);
  room.community = board;
  room.players = holes.map((h, i) => {
    const p = srv.makePlayer('s' + i, 'P' + i, '', 0);
    p.cards = h;
    p.chips = 0;
    p.handBet = contributions ? contributions[i] : 1000;
    return p;
  });
  room.pot = room.players.reduce((a, p) => a + p.handBet, 0);
  if (!contributions) room.pot = 1000 * holes.length;
  emitted.length = 0;
  srv.showdown(room);
  return { room, result: emitted.find(e => e[0] === 'showdown_result')[1] };
}

function checkShowdown(holes, board) {
  checks++;
  const scores = holes.map(h => ref([...h, ...board]));
  let best = scores[0];
  for (const s of scores) if (refCmp(s, best) > 0) best = s;
  const want = scores.map((s, i) => refCmp(s, best) === 0 ? 'P' + i : null).filter(Boolean).sort();
  const { result } = runShowdown(holes, board);
  const got = result.winners.map(w => w.name).sort();
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`winners [${holes.map(show).join(' / ')} | ${show(board)}] got ${got} want ${want}`);
  for (const w of result.winners) if (w.handName !== NAMES[best.cat]) fail(`winner label got "${w.handName}" want "${NAMES[best.cat]}" board ${show(board)}`);
}

// hand-picked: split pot, board plays
checkShowdown([H('2c 3d'), H('4c 5d')], H('As Ks Qs Js 10s'));
checkShowdown([H('Ac 3d'), H('Ad 5d')], H('Ks Kh 9s 8h 7c'));
checkShowdown([H('Ac Kd'), H('Ad Kh')], H('2s 3h 9s 8h 7c'));
checkShowdown([H('Ac 2d'), H('Ad 6h')], H('3s 4h 5s 9h Kc'));      // wheel vs 6-high straight
checkShowdown([H('Ac 2d'), H('Ad 2h')], H('3s 4h 5s 9h Kc'));
checkShowdown([H('Ac Qd'), H('Ad Jh'), H('9c 9d')], H('Ks Kh 2s 2h 7c'));
checkShowdown([H('Ac 9d'), H('Kd 8h')], H('Ks Qh 2s 2h 7c'));      // kicker
for (let i = 0; i < 4000; i++) {
  const d = shuffle(deck());
  const np = 2 + (i % 5);
  const holes = []; for (let k = 0; k < np; k++) holes.push(d.slice(k * 2, k * 2 + 2));
  checkShowdown(holes, d.slice(np * 2, np * 2 + 5));
}
// duplicate-heavy decks to force many ties
for (let i = 0; i < 3000; i++) {
  const ranks = shuffle([...RANKS]).slice(0, 5 + (i % 3));
  const d = shuffle(deck().filter(c => ranks.includes(c.rank)));
  checkShowdown([d.slice(0, 2), d.slice(2, 4), d.slice(4, 6)], d.slice(6, 11));
}

// ── Side pots: short all-in must not win more than it contributed ──
{
  // P0 all-in 100 with best hand; P1 and P2 each put in 500; P1 beats P2.
  const board = H('2s 7h 9d Jc 3s');
  const holes = [H('Ac Ad'), H('Kc Kd'), H('Qc Qd')];
  const { room } = runShowdown(holes, board, [100, 500, 500]);
  const chips = room.players.map(p => p.chips);
  checks++;
  if (JSON.stringify(chips) !== JSON.stringify([300, 800, 0])) fail(`side pot chips ${chips} want 300,800,0`);
}

}

console.log(`${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
