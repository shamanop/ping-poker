'use strict';
module.exports = {
  id: 'freeclean', maxReturn: 1.0, module: 'freeclean.js',
  bets: { good: [100, 500, 1000, 5000], min: 100, max: 5000 },
  playVariants: 2,                                   // 0: a paid flip, 1: a free flip when a token is held (else a paid one)
  open: (cur, bet) => ({ ev: 'flip', payload: { mode: cur, bet } }),
  play(g, sock, { cur, bet, i }) {
    if (i % 2) { const f = g.try(sock, 'flip', { mode: cur, bet, free: true }); if (f.ok) return { roundId: f.payload.roundId, cost: f.payload.cost, win: f.payload.win }; }
    const r = g.call(sock, 'flip', { mode: cur, bet });
    return { roundId: r.roundId, cost: r.cost, win: r.win };
  },
  heldPoints: [],
};
