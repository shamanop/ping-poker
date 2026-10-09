'use strict';
// Kit adapter for the example game (ADD-A-GAME.md "the kit"): tells tests/game-kit.js how to play it with its own socket messages. Never touches money.
module.exports = {
  id: 'walk2',
  module: 'walk2.js',          // path under games/
  example: true,                           // not in MODULES: the kit registers its house account for the run
  bets: { good: [100, 500, 1000, 5000], min: 100, max: 5000 },
  open: (cur, bet) => ({ ev: 'flip', payload: { mode: cur, bet, call: 'heads' } }),
  // one whole round; g.call throws when the game answers an error. Returns what the CLIENT was shown.
  play(g, sock, { cur, bet, i }) {
    const r = g.call(sock, 'flip', { mode: cur, bet, call: i % 2 ? 'tails' : 'heads' });
    return { roundId: r.roundId, cost: bet, win: r.win };
  },
  heldPoints: [],                          // an instant game has no point where a round stays open
};
