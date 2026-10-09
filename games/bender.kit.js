'use strict';
// Kit adapter for Ballot Bender (ADD-A-GAME.md section 9). An instant game: every spin (plain or a bought bonus) is ONE ctx.money.round. Never touches money.
const Eng = require('./bender-engine.js');

const BUYS = [null, 'election', 'landslide'];
const buyMax = Math.max(...Object.values(Eng.CFG.buyCost));

module.exports = {
  id: 'bender',
  module: 'bender.js',
  prepare(mod) { mod._history.clear(); },
  bets: { good: [Eng.BET_LEVELS[0], Eng.BET_LEVELS[Math.floor(Eng.BET_LEVELS.length / 2)], Eng.BET_LEVELS[Eng.BET_LEVELS.length - 1]], min: Eng.BET_LEVELS[0], max: Eng.BET_LEVELS[Eng.BET_LEVELS.length - 1] },
  maxCost: (bet) => Math.ceil(bet * buyMax) + 1,       // a bought bonus costs a multiple of the bet
  playVariants: 3,                                     // 0: a plain spin, 1: buy the election bonus, 2: buy the landslide bonus
  open: (cur, bet) => ({ ev: 'spin', payload: { mode: cur, bet } }),
  play(g, sock, { cur, bet, i }) {
    const p = { mode: cur, bet };
    if (BUYS[i % 3]) p.buyBonus = BUYS[i % 3];
    const r = g.call(sock, 'spin', p);
    return { roundId: r.roundId, cost: r.cost, win: r.totalWin };
  },
  heldPoints: [],
};
