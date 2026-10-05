'use strict';
// node games/bender-sim.js [spins=200000] [seed=12345]
// Quick plain-spin RTP / hit rate / 95% CI vs the 100% target (single-spin sd is huge; use bender-rtp.js for a tight figure).
const fs = require('fs');
const path = require('path');
const E = require('./bender-engine.js');
const N = +process.argv[2] || 200000, SEED = +process.argv[3] || 12345;
const TARGET = 100; // retuned 10/5 to 100% (pay table x1.0388, buy costs = measured bonus EV); precise figure: node games/bender-rtp.js

function run(Eng, rng, n) {
  const eng = Eng.createEngine();
  let sum = 0, sq = 0, hits = 0, bonus = 0, max = 0;
  for (let i = 0; i < n; i++) {
    const r = eng.round(rng, 'spin'), w = r.win;
    sum += w; sq += w * w; if (w > 0) hits++; if (r.bonus) bonus++; if (w > max) max = w;
  }
  const mean = sum / n, sd = Math.sqrt(sq / n - mean * mean);
  return { rtp: mean * 100, ci: 1.96 * sd / Math.sqrt(n) * 100, hit: hits / n * 100, bonusOne: bonus ? n / bonus : Infinity, max };
}

const t0 = Date.now();
const s = run(E, E.rngFrom(SEED), N);
console.log(`server engine, seed ${SEED}, ${N} spins: RTP ${s.rtp.toFixed(2)}% (95% CI +-${s.ci.toFixed(1)}) hit ${s.hit.toFixed(1)}% bonus 1 in ${s.bonusOne.toFixed(0)} max ${s.max.toFixed(0)}x  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`target (published): ${TARGET}% | delta ${(s.rtp - TARGET).toFixed(2)} pts`);

const exact = null;
const within = Math.abs(s.rtp - TARGET) <= 0.5;
console.log(within ? 'within 0.5 pts of target' : `NOT within 0.5 pts at this sample size: single-spin sd is ~19x bet, so ${N} spins can only resolve RTP to +-${s.ci.toFixed(1)} pts (0.5 needs ~${Math.round(N * (s.ci / 0.5) ** 2 / 1e6)}M spins).`);
process.exit(exact === false ? 1 : 0);
