'use strict';
module.exports = {
  id: 'cashbug', module: 'cashbug.js',
  currencies: ['chips'],                    // "optional" in ADD-A-GAME.md section 9
  bets: { good: [100, 500, 1000, 5000], min: 100, max: 5000 },
  open: (cur, bet) => ({ ev: 'flip', payload: { mode: cur, bet, call: 'heads' } }),
  play(g, sock, { cur, bet, i }) { const r = g.call(sock, 'flip', { mode: cur, bet, call: i % 2 ? 'tails' : 'heads' }); return { roundId: r.roundId, cost: bet, win: r.win }; },
  heldPoints: [],
};
