'use strict';
// node games/bender-sim.js [spins=200000] [seed=12345]
// Prints RTP / hit rate / 95% CI vs the published figure, and (if vp-slot is present) checks the server engine is bit-identical
// to the original engine by replaying the same seeded stream.
const fs = require('fs');
const path = require('path');
const E = require('./bender-engine.js');
const N = +process.argv[2] || 200000, SEED = +process.argv[3] || 12345;
const TARGET = 95.84; // vp-slot/bender/sim/out/FINAL.txt: 12M spins, 95% CI +-1.6

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

const orig = path.join(__dirname, '..', '..', 'vp-slot', 'bender', 'engine.js');
let exact = null;
if (fs.existsSync(orig)) {
  const o = run(require(orig), E.rngFrom(SEED), N);
  exact = o.rtp === s.rtp && o.hit === s.hit;
  console.log(`original vp-slot engine, same seed: RTP ${o.rtp.toFixed(2)}% hit ${o.hit.toFixed(1)}% -> ${exact ? 'IDENTICAL (math unchanged)' : 'MISMATCH'}`);
}
const within = Math.abs(s.rtp - TARGET) <= 0.5;
console.log(within ? 'within 0.5 pts of target' : `NOT within 0.5 pts at this sample size: single-spin sd is ~19x bet, so ${N} spins can only resolve RTP to +-${s.ci.toFixed(1)} pts (0.5 needs ~${Math.round(N * (s.ci / 0.5) ** 2 / 1e6)}M spins). Exact-match check above is the real guard.`);
process.exit(exact === false ? 1 : 0);
