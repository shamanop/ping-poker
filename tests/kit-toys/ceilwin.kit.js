'use strict';
module.exports = {
  id: 'ceilwin', module: 'ceilwin.js', maxReturn: 0.95, paybackRounds: 2000,   // the table says 90%
  bets: { good: [1, 5, 100, 500], min: 1, max: 500 },
  open: (cur, bet) => ({ ev: 'flip', payload: { mode: cur, bet } }),
  play(g, sock, { cur, bet }) { const r = g.call(sock, 'flip', { mode: cur, bet }); return { roundId: r.roundId, cost: bet, win: r.win }; },
  heldPoints: [],
};
