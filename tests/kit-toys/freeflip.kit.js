'use strict';
module.exports = {
  id: 'freeflip', module: 'freeflip.js',
  bets: { good: [100, 500, 1000, 5000], min: 100, max: 5000 },
  playVariants: 2,                                   // 0: a plain flip, 1: a boosted flip when a token is held (else a plain one)
  open: (cur, bet) => ({ ev: 'flip', payload: { mode: cur, bet } }),
  play(g, sock, { cur, bet, i }) {
    if (i % 2) { const f = g.try(sock, 'flip', { mode: cur, bet, boost: true }); if (f.ok) return { roundId: f.payload.roundId, cost: f.payload.cost, win: f.payload.win }; }
    const r = g.call(sock, 'flip', { mode: cur, bet });
    return { roundId: r.roundId, cost: r.cost, win: r.win };
  },
  heldPoints: [],
};
