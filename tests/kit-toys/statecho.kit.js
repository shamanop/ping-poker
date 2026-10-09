'use strict';
// Kit adapter for the example game (ADD-A-GAME.md "the kit"): tells tests/game-kit.js how to play it with its own socket messages. Never touches money.
// This file (games/_example-coinflip.kit.js) is the ONE adapter the kit registers for the run: the example is not in MODULES. The kit knows it by its FILE NAME, not by a field,
// so a copy of this adapter is a normal adapter and gets the full registration check (it must be in MODULES, SOURCE_ACCOUNTS and GAMES).
module.exports = {
  id: 'statecho',
  module: 'statecho.js',          // path under games/
  maxReturn: 1.0,                          // REQUIRED: the most the game may pay back per unit staked, over the kit's seeded run (the table says 96%; the run adds noise)
  bets: { good: [100, 500, 1000, 5000], min: 100, max: 5000 },
  open: (cur, bet) => ({ ev: 'flip', payload: { mode: cur, bet, call: 'heads' } }),
  // one whole round; g.call throws when the game answers an error. Returns what the CLIENT was shown.
  play(g, sock, { cur, bet, i }) {
    const r = g.call(sock, 'flip', { mode: cur, bet, call: i % 2 ? 'tails' : 'heads' });
    return { roundId: r.roundId, cost: bet, win: r.win };
  },
  heldPoints: [],                          // an instant game has no point where a round stays open
};
