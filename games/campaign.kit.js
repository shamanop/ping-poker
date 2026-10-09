'use strict';
// Kit adapter for Campaign Trail (ADD-A-GAME.md section 9). Plays the game with its own messages only: start / step / cash. Never touches money.
const path = require('path');

const HOME = 'OH';
const next = (run) => run.options.find((o) => !o.deadEnd && !o.landslide);   // a step that cannot end the run by itself
// One step with a fixed draw: 0 always fails it (a scandal), 0.999999 always survives it. Goes through the game's own rng seam (module.rng, the ctx.rng of every other game), the same in both
// currencies: the game's QA `force` hook is Chips-only since Money 1008 K5-F, and a Cash run never honours it.
const stepWith = (g, sock, draw, payload) => {
  const mod = g.world.mod, prev = mod.rng;
  mod.rng = () => draw;
  try { return g.call(sock, 'step', payload); } finally { mod.rng = prev; }
};
const SURVIVE = 0.999999, SCANDAL = 0;

module.exports = {
  id: 'campaign',
  module: 'campaign.js',
  maxReturn: 0.70,                                   // measured by the kit's seeded run: 68.00% at both bets (the adapter's three round shapes are fixed draws)
  paybackRounds: 3000,
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
    const s = stepWith(g, sock, v === 1 ? SURVIVE : SCANDAL, { roundId, n: 1, to: next(run).to });
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
        const s = stepWith(g, sock, SURVIVE, { roundId: run.roundId, n: 1, to: next(run).to });
        return { roundId: run.roundId, cost: bet, bootWin: s.run.cashout };
      },
      finish: (g, sock, held) => ({ win: g.call(sock, 'cash', { roundId: held.roundId }).win }) },
  ],
};
