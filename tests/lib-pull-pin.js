'use strict';
// THE PULL tests test MECHANISMS, not tuning. The levers agent owns the VALUES of CFG.pull (and may change them any time),
// so the pull test files pin CFG.pull to these fixed numbers for their own run and put the real values back at the end.
// Only CFG.pull is pinned: other levers (weights, extra, buyCost) are not touched by these tests.
const PINNED = {
  on: true, list: 50, fill: { dead: 1.2, win: 0.6, bonus: 0.6 }, callback: { kind: 'bonus1' }, carryOver: true,
  cold: { afterMs: 86400000, stepMs: 21600000, batch: 3, floor: 10 }, warm: { chance: 0.35, cap: 4 },
  ghost: { on: true, maxWinTenths: 10, minTenths: 0 },
  pick: { on: true, minLeads: 2, mult: { bronze: 0, silver: 2, gold: 3, upsell: 2, close: 2 } },
  more: { on: true, mult: 2, rtp: 0.98, minTenths: 20 }, daily: { base: 3, perStreak: 1, streakMax: 4, stakeCap: 100 },
  pot: { feedBps: 50, oneInPerDollar: 20000, seed: 0, minBal: 100, capCents: 1000000 }, feed: { minWinX: 100, minWinCents: 0 }, decision: { timeoutMs: 20000 },
};
function pin(E) {
  const real = JSON.parse(JSON.stringify(E.CFG.pull));
  const names = Object.keys(real).sort();
  const put = (src) => { for (const k of Object.keys(E.CFG.pull)) delete E.CFG.pull[k]; Object.assign(E.CFG.pull, JSON.parse(JSON.stringify(src))); };
  put(PINNED);
  return { PINNED, knobNames: names, real, restore: () => put(real) };
}
module.exports = { pin, PINNED };
