'use strict';
module.exports = {
  id: 'dropper', module: 'dropper.js', oneOpen: true,
  bets: { good: [100, 500, 1000, 5000], min: 100, max: 5000 },
  open: (cur, bet) => ({ ev: 'deal', payload: { mode: cur, bet } }),
  play(g, sock, { cur, bet }) { const d = g.call(sock, 'deal', { mode: cur, bet }); const r = g.call(sock, 'reveal', { roundId: d.roundId, mode: cur }); return { roundId: d.roundId, cost: bet, win: r.win }; },
  heldPoints: [{
    name: 'dealt',
    hold(g, sock, { cur, bet }) { const d = g.call(sock, 'deal', { mode: cur, bet }); return { roundId: d.roundId, cost: bet, bootWin: bet }; },
    finish(g, sock, held) { const r = g.call(sock, 'reveal', { roundId: held.roundId, mode: held.cur }); return { win: r.win }; },
  }],
};
