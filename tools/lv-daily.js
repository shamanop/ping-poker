'use strict';
// N2 check (levers): what is the daily appointment worth to a player who spins once a day at `bet` cents (and plays the Callback right after it arms)?
// Same loop as the critic's _crit/daily.js but on the LIVE CFG with overrides. node tools/lv-daily.js [bet=100] [players=3000] [days=365]
const E = require('../games/coldcall-engine.js');
const bet = +process.argv[2] || 100, players = +process.argv[3] || 3000, DAYS = +process.argv[4] || 365;
const base = JSON.parse(JSON.stringify(E.CFG.pull));
const V = [['no daily', { base: 0, perStreak: 0, streakMax: 0, stakeCap: 100 }], ['live CFG (8/4/4 cap 100)', base.daily],
  ['0.2/0.1/4 cap 10', { base: 0.2, perStreak: 0.1, streakMax: 4, stakeCap: 10 }], ['0.1/0.05/4 cap 10', { base: 0.1, perStreak: 0.05, streakMax: 4, stakeCap: 10 }]];
let ref = null;
for (const [name, daily] of V) {
  E.CFG.pull = Object.assign(JSON.parse(JSON.stringify(base)), { daily });
  let staked = 0, back = 0, cbs = 0, days = 0;
  for (let seed = 1; seed <= players; seed++) {
    const rng = E.rngFrom(seed * 7 + 1); let st = E.newState(), t = Date.UTC(2026, 0, 1, 18);
    for (let d = 0; d < DAYS; d++) {
      const day = new Date(t).toISOString().slice(0, 10); days++;
      for (let k = 0; k < 2; k++) {
        const r = E.playRound(rng, { buy: null, bet, state: st, now: t + k * 1000, day, script: false, auto: true }, []);
        staked += E.cents(r.costTenths, r.betCents); back += E.cents(r.winTenths, r.betCents); st = r.newState; if (r.callback) cbs++;
        if (!st.cb) break;
      }
      t += 86400000 - 60000;
    }
  }
  const prof = (back - staked) / days / 100; if (ref === null) ref = prof;
  console.log(`${name.padEnd(28)} bet ${bet}c: payback ${(100 * back / staked).toFixed(0)}%, ${cbs} Callbacks (1 per ${(days / Math.max(1, cbs)).toFixed(1)} days), profit/day ${prof.toFixed(3)} $  gift vs no daily ${(prof - ref).toFixed(3)} $/day`);
}
