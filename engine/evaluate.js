'use strict';
// OWNER: engine builder. Moved from server.js unchanged (combs, evaluate5, compareHands, bestHand).
const { RANKS } = require('./deck');

function combs(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  return [...combs(rest, k - 1).map(c => [first, ...c]), ...combs(rest, k)];
}

const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
function rankVal(card) { return RANK_VAL[card.rank]; }
function sortDesc(vals) { return [...vals].sort((a, b) => b - a); }

function evaluate5(cards) {
  const vals   = cards.map(rankVal);
  const suits  = cards.map(c => c.suit);
  const sorted = sortDesc(vals);

  const isFlush  = new Set(suits).size === 1;
  const uniqueVals = [...new Set(sorted)];

  let isStraight = false, straightHigh = 0;
  if (uniqueVals.length >= 5) {
    const t = sorted.slice(0, 5);
    if (t[0] - t[4] === 4) { isStraight = true; straightHigh = t[0]; }
    if (!isStraight && sorted.includes(14)) {
      const low = sortDesc(sorted.map(v => v === 14 ? 1 : v)).slice(0, 5);
      if (low[0] - low[4] === 4) { isStraight = true; straightHigh = 5; }
    }
  }

  const freq = {};
  for (const v of sorted) freq[v] = (freq[v] || 0) + 1;
  const counts = Object.entries(freq)
    .map(([v, c]) => ({ v: Number(v), c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);
  const [f1, f2] = counts;

  if (isFlush && isStraight) return straightHigh === 14
    ? { rank: 10, name: 'Royal Flush',    kickers: [14] }
    : { rank: 9,  name: 'Straight Flush', kickers: [straightHigh] };
  if (f1.c === 4) return { rank: 8, name: 'Four of a Kind',  kickers: [f1.v, f2.v] };
  if (f1.c === 3 && f2?.c >= 2) return { rank: 7, name: 'Full House',  kickers: [f1.v, f2.v] };
  if (isFlush)    return { rank: 6, name: 'Flush',           kickers: sortDesc(vals).slice(0, 5) };
  if (isStraight) return { rank: 5, name: 'Straight',        kickers: [straightHigh] };
  if (f1.c === 3) return { rank: 4, name: 'Three of a Kind', kickers: [f1.v, ...counts.slice(1).map(e => e.v)] };
  if (f1.c === 2 && f2?.c === 2) return { rank: 3, name: 'Two Pair',  kickers: [f1.v, f2.v, ...(counts[2] ? [counts[2].v] : [])] };
  if (f1.c === 2) return { rank: 2, name: 'Pair',            kickers: [f1.v, ...counts.slice(1).map(e => e.v)] };
  return { rank: 1, name: 'High Card', kickers: sortDesc(vals).slice(0, 5) };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const d = (a.kickers[i] || 0) - (b.kickers[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function bestHand(hole, community) {
  const all   = [...hole, ...community];
  const picks = all.length >= 5 ? combs(all, 5) : [all];
  let best = null, bestCards = null;
  for (const five of picks) {
    const result = evaluate5(five);
    if (!best || compareHands(result, best) > 0) { best = result; bestCards = five; }
  }
  return { ...best, cards: bestCards };
}

module.exports = { evaluate5, compareHands, bestHand };
