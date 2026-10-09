'use strict';
// Self-test toy adapter (tests/game-kit-selftest.js). Broken on purpose: see proxykey.js.
module.exports = {
  id: 'proxykey', module: 'proxykey.js', example: true,
  bets: { good: [100, 500, 1000, 5000], min: 100, max: 5000 },
  open: (cur, bet) => ({ ev: 'flip', payload: { mode: cur, bet } }),
  play(g, sock, { cur, bet }) { const r = g.call(sock, 'flip', { mode: cur, bet }); return { roundId: r.roundId, cost: bet, win: r.win }; },
  heldPoints: [],
};
