'use strict';
// Kit adapter for Campaign Trail (ADD-A-GAME.md section 9). Plays the game with its own messages only: start / step / cash. Never touches money.
const path = require('path');

const HOME = 'OH';
const next = (run) => run.options.find((o) => !o.deadEnd && !o.landslide);   // a step that cannot end the run by itself

module.exports = {
  id: 'campaign',
  module: 'campaign.js',
  env: { CAMPAIGN_TEST: '1' },                      // the QA hook: step payloads may carry force: 'survive' | 'scandal'
  files: (dir) => ({ campaign: path.join(dir, 'campaign.json') }),
  crash(mod) {                                       // a kill: no timer fires afterwards, the store keeps only what it already wrote
    for (const rec of mod._test.runs.values()) if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    try { mod._test.store.close(true); } catch {}
  },
  bets: { good: [100, 200, 500, 1000, 2500], min: 100, max: 2500 },
  oneOpen: true,                                     // one open run per account
  playVariants: 3,                                   // 0: withdraw at step 0 (refund), 1: one step then cash out, 2: a scandal on the first step (stake lost)
  open: (cur, bet) => ({ ev: 'start', payload: { mode: cur, bet, home: HOME } }),
  play(g, sock, { cur, bet, i }) {
    const run = g.call(sock, 'start', { mode: cur, bet, home: HOME }).run;
    const roundId = run.roundId, v = i % 3;
    if (v === 0) return { roundId, cost: bet, win: g.call(sock, 'cash', { roundId }).win };
    const s = g.call(sock, 'step', { roundId, n: 1, to: next(run).to, force: v === 1 ? 'survive' : 'scandal' });
    if (!s.run) return { roundId, cost: bet, win: s.win };                       // the step ended the run (a scandal, or nowhere left to go)
    return { roundId, cost: bet, win: g.call(sock, 'cash', { roundId }).win };
  },
  heldPoints: [
    { name: 'opened',                                // a run with 0 steps: a restart refunds the stake
      hold(g, sock, { cur, bet }) { const run = g.call(sock, 'start', { mode: cur, bet, home: HOME }).run; return { roundId: run.roundId, cost: bet, bootWin: bet }; },
      finish: (g, sock, held) => ({ win: g.call(sock, 'cash', { roundId: held.roundId }).win }) },
    { name: 'stepped',                               // one survived step: a restart cashes out at the multiplier the client was last shown
      hold(g, sock, { cur, bet }) {
        const run = g.call(sock, 'start', { mode: cur, bet, home: HOME }).run;
        const s = g.call(sock, 'step', { roundId: run.roundId, n: 1, to: next(run).to, force: 'survive' });
        return { roundId: run.roundId, cost: bet, bootWin: s.run.cashout };
      },
      finish: (g, sock, held) => ({ win: g.call(sock, 'cash', { roundId: held.roundId }).win }) },
  ],
};
