'use strict';
// Side pots with four different stacks, and the odd chip of a split pot (L1). Audit repro 04.
const { startServer, P, rigDeck, runPot, diffTotals, suite, expect } = require('./lib');
const T = suite(__filename);
const specs = [
  { title: 'sidepots-four-stacks-all-in', bug: [], names: ['Gus', 'Hal', 'Ivy', 'Jon'], stacks: [100, 300, 600, 1000], settings: { blinds: { sb: 5, bb: 10 } },
    deck: rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['Qs', 'Qd'], ['Js', 'Jd']], ['2c', '7d', '9h', '3s', '4c']),
    policies: [P.allin, P.allin, P.allin, P.allin], strength: [4, 3, 2, 1], committed: S => ({ Gus: 100, Hal: 300, Ivy: 600, Jon: 1000 }) },
  { title: 'odd-chip-of-a-split-pot-goes-to-first-winner-left-of-button', bug: ['L1'], names: ['Kim', 'Lou', 'Max'], stacks: [1000, 1000, 1000],
    deck: rigDeck([['2c', '3d'], ['4c', '5d'], ['2d', '4h']], ['Ts', 'Jh', 'Qd', 'Kc', 'Ac']),
    policies: [P.call, P.fold, P.call], strength: [1, 0, 1], folded: S => new Set(['Lou']), committed: S => ({ Kim: 50, Lou: S.blinds.Lou, Max: 50 }) },
];
(async () => {
  const srv = await startServer(0, { handDelayMs: 1200 });
  for (const spec of specs) {
    await T.check(spec.title, spec.bug, async () => {
      const r = await runPot(srv, spec);
      expect(r.res.sd, 'no showdown_result');
      const d = diffTotals(r.res.totals, r.exp.totals);
      expect(!d, d + ` (button ${r.S.button})`);
    });
  }
  await srv.stop();
  await T.done();
})();
