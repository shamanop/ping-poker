'use strict';
// Test fixture: VERBATIM copy of the evaluator and showdown() from server.js at base commit 9440541
// (the version verified correct in the audit). Used only as a differential oracle by the engine tests.
// Do not edit the copied bodies. `oldShowdown` wraps the copied showdown() with stubs for its I/O.
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

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

function makeOldShowdown() {
  const roomLog = () => {};
  const bankKey = n => String(n).toLowerCase();
  const io = { to: () => ({ emit: () => {} }) };
  const scheduleNextHand = () => {};
  function showdown(room) {
    if (room.nextHandTimer) return; // hand already ended
    const contenders = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
    roomLog(room, '--- Showdown ---');

    const results = contenders.map(p => ({
      player: p, idx: room.players.indexOf(p), hand: bestHand(p.cards, room.community),
    }));
    results.sort((a, b) => compareHands(b.hand, a.hand));

    // Split the pot in layers by total contribution so short all-ins only win what they covered.
    const paid = new Map();
    const levels = [...new Set(room.players.map(p => p.handBet || 0).filter(b => b > 0))].sort((a, b) => a - b);
    let prev = 0, awarded = 0;
    for (const level of levels) {
      const layer = room.players.reduce((sum, p) => sum + Math.max(0, Math.min(p.handBet || 0, level) - prev), 0);
      prev = level;
      if (layer === 0) continue;
      let pool = results.filter(r => (r.player.handBet || 0) >= level);
      if (pool.length === 0) pool = results;
      const top = pool.reduce((b, r) => (compareHands(r.hand, b) > 0 ? r.hand : b), pool[0].hand);
      const layerWinners = pool.filter(r => compareHands(r.hand, top) === 0).sort((a, b) => a.idx - b.idx);
      const share = Math.floor(layer / layerWinners.length);
      const rem = layer - share * layerWinners.length;
      layerWinners.forEach((w, i) => {
        const amt = share + (i === 0 ? rem : 0);
        w.player.chips += amt;
        paid.set(w, (paid.get(w) || 0) + amt);
      });
      awarded += layer;
    }
    if (awarded < room.pot) { // contributions untracked: fall back to a single pot
      const top = results[0].hand;
      const ws = results.filter(r => compareHands(r.hand, top) === 0).sort((a, b) => a.idx - b.idx);
      const extra = room.pot - awarded, share = Math.floor(extra / ws.length), rem = extra - share * ws.length;
      ws.forEach((w, i) => { const amt = share + (i === 0 ? rem : 0); w.player.chips += amt; paid.set(w, (paid.get(w) || 0) + amt); });
    }
    const winners = [...paid.keys()].sort((a, b) => a.idx - b.idx);

    const winnerList = winners.map(w => ({ name: w.player.name, handName: w.hand.name, cards: w.player.cards, amount: paid.get(w), net: paid.get(w) - (w.player.handBet || 0) }));
    for (const w of winners) w.player.winHand = w.hand.name;
    for (const w of winners) roomLog(room, `${w.player.name} wins ${paid.get(w)} with ${w.hand.name}`);

    room.handHistory.unshift({
      handNum:  room.handNum,
      winners:  winners.map(w => w.player.name),
      handName: results[0].hand.name,
      pot:      room.pot,
    });
    if (room.handHistory.length > 10) room.handHistory.pop();
    const reveals = results.map(r => ({ name: r.player.name, handName: r.hand.name, cards: r.player.cards }));
    for (const r of reveals) (room.shown ||= {})[bankKey(r.name)] = [true, true];
    io.to(room.id).emit('showdown_result', { winners: winnerList, pot: room.pot, reveals, nextMs: 5000 });
    room.pot = 0;
    scheduleNextHand(room, 5000);
  }

  return showdown;
}
const showdownFn = makeOldShowdown();

// holes: { seat: [c, c] }, committed: { seat: total put in, uncalled included }, folded: Set of seats, board: 5 cards
// -> { seat: chips credited by the old showdown }  (the old code pays the uncalled layer back as a "win")
function oldShowdown(holes, committed, folded, board) {
  const seats = Object.keys(committed).map(Number).sort((a, b) => a - b);
  const players = seats.map(s => ({
    name: 'S' + s, cards: holes[s], chips: 0, handBet: committed[s],
    folded: folded.has(s), sittingOut: false, connected: true,
  }));
  const room = { id: 'T', players, community: board, pot: seats.reduce((t, s) => t + committed[s], 0), handHistory: [], handNum: 1, nextHandTimer: null };
  showdownFn(room);
  const paid = {};
  seats.forEach((s, i) => { paid[s] = players[i].chips; });
  return paid;
}

module.exports = { evaluate5, compareHands, bestHand, oldShowdown };
