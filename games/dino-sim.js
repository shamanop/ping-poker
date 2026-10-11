'use strict';
// node games/dino-sim.js [rounds=200000] [seed=12345] [mode=spin|ante|buy]
// Quick round-by-round payback / hit rate / bonus frequency / 95% CI against the 96% target (single-round sd is large: use dino-rtp.js for a tight figure).
const E = require('./dino-engine.js');
const N = +process.argv[2] || 200000, SEED = +process.argv[3] || 12345, MODE = process.argv[4] || 'spin';
const TARGET = 96;
if (!['spin', 'ante', 'buy'].includes(MODE)) { console.error('mode: spin | ante | buy'); process.exit(2); }

const eng = E.createEngine(), rng = E.rngFrom(SEED), t0 = Date.now();
let staked = 0, sum = 0, sq = 0, hits = 0, bonus = 0, max = 0, maxed = 0;
for (let i = 0; i < N; i++) {
  const r = eng.round(rng, MODE), w = r.win / r.cost;
  staked += r.cost; sum += r.win; sq += w * w; if (r.win > 0) hits++; if (r.bonus) bonus++; if (r.win > max) max = r.win; if (r.maxed) maxed++;
}
const mean = sum / staked, sd = Math.sqrt(Math.max(0, sq / N - mean * mean)), ci = 1.96 * sd / Math.sqrt(N) * 100;
console.log(`dino ${MODE}, seed ${SEED}, ${N} rounds: RTP ${(mean * 100).toFixed(2)}% (95% CI +-${ci.toFixed(1)}) hit ${(hits / N * 100).toFixed(1)}% bonus 1 in ${bonus ? (N / bonus).toFixed(0) : '-'} max ${max.toFixed(0)}x capped ${maxed}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
console.log(`target ${TARGET}% | delta ${(mean * 100 - TARGET).toFixed(2)} pts${Math.abs(mean * 100 - TARGET) > ci ? ' (outside the CI at this sample size: run games/dino-rtp.js)' : ''}`);
