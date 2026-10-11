'use strict';
// Kit adapter for Dino (ADD-A-GAME.md section 9). An instant game: every spin (plain, ante or a bought feature) is ONE ctx.money.round. Never touches money.
const Eng = require('./dino-engine.js');

const ANTE = Eng.anteLevels();
const L = Eng.BET_LEVELS;

module.exports = {
  id: 'dino',
  module: 'dino.js',
  maxReturn: 1.03,                                     // measured by the kit's seeded 20,000-round run (variants plain / ante / buy in turn): 95.39% at the smallest bet, 99.41% at the largest, both currencies.
                                                       // The buy rounds (100x stake) dominate what is staked, so it reads the buy's 96.1% plus the noise of ~6,700 bonuses (sd 135x, about +-1.7 points); _dino/MATH-FINAL.md has the 36M-spin figures per way
  prepare(mod) { mod._history.clear(); mod._lastAt.clear(); },
  bets: { good: [L[0], L[Math.floor(L.length / 2)], L[L.length - 1]], min: L[0], max: L[L.length - 1] },
  maxCost: (bet) => Math.ceil(bet * Math.max(Eng.CFG.buyCost, Eng.CFG.anteCost)),   // a bought feature costs buyCost x bet
  playVariants: 3,                                     // 0: a plain spin, 1: an ante spin (a plain spin at a bet with no ante), 2: buy the feature
  open: (cur, bet) => ({ ev: 'spin', payload: { mode: cur, bet } }),
  play(g, sock, { cur, bet, i }) {
    const p = { mode: cur, bet }, v = i % 3;
    if (v === 1 && ANTE.includes(bet)) p.ante = true;
    if (v === 2) p.buy = true;
    const r = g.call(sock, 'spin', p);
    return { roundId: r.roundId, cost: r.cost, win: r.totalWin };
  },
  heldPoints: [],
};
