'use strict';
// OWNER: engine builder. Pure: no Math.random, no Date, no I/O.
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Ordered 52-card deck (suit-major, same order as server.js makeDeck before its shuffle).
function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  return deck;
}

// Fisher-Yates, same loop as server.js makeDeck. Returns a new array; `rng` is a () => [0,1) function.
function shuffle(deck, rng) {
  if (typeof rng !== 'function') throw new TypeError('shuffle(deck, rng): rng must be a function');
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

module.exports = { SUITS, RANKS, makeDeck, shuffle };
