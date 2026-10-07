'use strict';
/* CAMPAIGN TRAIL simulator. Plays the real engine (games/campaign-engine.js) with seeded strategies and prints RTP with a 95% interval per line.
   Usage:   node games/campaign-sim.js [--runs 1000000] [--seed 20261007] [--workers 6] [--only substring] [--json out.json]
   Output:  one line per strategy: RTP % [95% interval], share of runs ending in a scandal, average picks per run (a failed pick counts),
            average and largest multiplier paid (over runs that paid), dead ends reached, landslides. A line whose interval misses 96.00 is flagged.
   Runs are split into chunks of 50,000 over worker_threads; every chunk has its own seed derived from --seed, so a result depends on (seed, runs) only.
   Every run starts at a uniformly random home state (except the hunter: Maine). Stake 100 units unless the line says otherwise; x = payout / stake.
   Strategies pick among the options on offer; the cash-out target is checked after each surviving step (cash when mx >= target).
   - tier strategies: the wanted growth (safe 104, lean 110, swing 130). When that tier is not on offer the NEAREST tier by growth is taken
     (ties go to the lower growth); several options of the best tier: uniform random among them.
   - always-safe = wanted safe, always-swing = wanted swing, mixed = uniform random option.
   - greedy-growth: highest nextMx, ties to the option with the most onward (unvisited) neighbours. greedy-risk: lowest pFail, same tie rule.
   - first-step-and-out: wanted tier on the first pick, then cash out at once (so the first-step odds are measured alone).
   - hunter: follows the stored LANDSLIDE witness route from Maine, never cashes out.
   - bet lines: mixed, target 2x, one line per bet level with the SAME seed as each other, paid through E.payout(run, bet) (whole units).
     The runs are identical, so RTP, shares and multipliers are identical; only the units change. */
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const E = require('./campaign-engine.js');
const { mulberry32 } = require('../tests/soak/lib/prng.js');
const S = E.MAP.states, CODES = E.MAP.codes;
const CHUNK = 50000;
const WITNESS = 'ME NH VT MA RI CT NY NJ DE MD PA WV OH MI IN IL WI MN ND MT SD IA NE KS CO WY UT ID WA AK HI CA OR NV AZ NM OK TX LA AR MO KY VA NC SC GA FL AL MS TN'.split(' ');
const TARGETS = [['1.5x', 150], ['2x', 200], ['5x', 500], ['20x', 2000], ['never', Infinity]];

const onward = (run, o) => S[o.to].adj.filter((a) => a !== o.to && !run.trail.includes(a)).length;
const tierPick = (g) => (run, opts, rng) => {
  let best = Infinity, c = [];
  for (const o of opts) { const d = Math.abs(o.g100 - g) + (o.g100 < g ? -0.5 : 0); if (d < best) { best = d; c = [o]; } else if (d === best) c.push(o); }
  return c[rng.int(c.length)];
};
const greedy = (key, sign) => (run, opts) => opts.slice().sort((a, b) => sign * (a[key] - b[key]) || onward(run, b) - onward(run, a))[0];
const PICKS = {
  safe: tierPick(104), lean: tierPick(110), swing: tierPick(130),
  mixed: (run, opts, rng) => opts[rng.int(opts.length)],
  growth: greedy('nextMx', -1), risk: greedy('pFail', 1),
  hunter: (run, opts) => opts.find((o) => o.to === WITNESS[run.steps + 1]),
};

function lines() {
  const L = [];
  for (const [label, strat] of [['always-safe', 'safe'], ['always-swing', 'swing'], ['mixed', 'mixed'], ['greedy-growth', 'growth'], ['greedy-risk', 'risk']])
    for (const [tl, tx] of TARGETS) L.push({ name: label + ' @ ' + tl, pick: strat, target: tx, bet: 100 });
  for (const t of ['safe', 'lean', 'swing']) L.push({ name: 'first-step-and-out ' + t, pick: t, target: 0, bet: 100 });
  L.push({ name: 'LANDSLIDE hunter (witness, never cash)', pick: 'hunter', target: Infinity, bet: 100, home: 'ME' });
  for (const b of E.BET_LEVELS) L.push({ name: 'mixed @ 2x, bet ' + b, pick: 'mixed', target: 200, bet: b, seedKey: 'bet' });
  return L;
}

function chunk(L, runs, seed) {
  const rng = mulberry32(seed), pick = PICKS[L.pick];
  const a = { n: 0, sum: 0, sumsq: 0, scandals: 0, picks: 0, paid: 0, paidSum: 0, max: 0, deadends: 0, landslides: 0 };
  for (let i = 0; i < runs; i++) {
    let run = E.newRun(L.home || rng.pick(CODES));
    for (;;) {
      const s = E.step(run, pick(run, E.options(run), rng).to, rng); run = s.run; a.picks++;
      if (run.done || run.mx >= L.target) break;
    }
    const x = run.done === 'scandal' ? 0 : E.payout(run, L.bet) / L.bet;
    if (run.done === 'scandal') a.scandals++; else if (run.done === 'deadend') a.deadends++; else if (run.done === 'landslide') a.landslides++;
    a.n++; a.sum += x; a.sumsq += x * x; if (x > 0) { a.paid++; a.paidSum += x; if (x > a.max) a.max = x; }
  }
  return a;
}
const mix = (base, i, c) => (base ^ Math.imul(i + 1, 0x9E3779B1) ^ Math.imul(c + 1, 0x85EBCA6B)) >>> 0;

if (!isMainThread) {
  parentPort.on('message', (job) => {
    const L = lines()[job.line];
    parentPort.postMessage({ line: job.line, acc: chunk(L, job.runs, mix(job.seed, L.seedKey ? 999 : job.line, job.chunk)) });
  });
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const RUNS = +arg('runs', 1000000), SEED = +arg('seed', 20261007), W = +arg('workers', 6), ONLY = arg('only', ''), JSON_OUT = arg('json', '');
  const L = lines(), jobs = [], res = L.map(() => ({ n: 0, sum: 0, sumsq: 0, scandals: 0, picks: 0, paid: 0, paidSum: 0, max: 0, deadends: 0, landslides: 0 }));
  L.forEach((l, i) => { if (!ONLY || l.name.includes(ONLY)) for (let c = 0, left = RUNS; left > 0; c++, left -= CHUNK) jobs.push({ line: i, chunk: c, runs: Math.min(CHUNK, left), seed: SEED }); });
  let pending = jobs.length, started = Date.now();
  const finish = () => {
    console.log('CAMPAIGN TRAIL sim: engine v' + E.VERSION + ', seed ' + SEED + ', ' + RUNS + ' runs per line, ' + ((Date.now() - started) / 1000).toFixed(0) + ' s');
    console.log('line'.padEnd(42) + 'RTP %   95% interval       scandal%  picks  avg paid x  max paid x  deadends  landslides');
    const out = [];
    L.forEach((l, i) => {
      const a = res[i]; if (!a.n) return;
      const mean = a.sum / a.n, sd = Math.sqrt(Math.max(0, a.sumsq / a.n - mean * mean)), hw = 1.96 * sd / Math.sqrt(a.n);
      const lo = (mean - hw) * 100, hi = (mean + hw) * 100, miss = lo > 96 || hi < 96;
      const row = { name: l.name, rtp: mean * 100, lo, hi, scandal: a.scandals / a.n * 100, picks: a.picks / a.n, avgPaid: a.paid ? a.paidSum / a.paid : 0, maxPaid: a.max, deadends: a.deadends, landslides: a.landslides, miss };
      out.push(row);
      console.log(l.name.padEnd(42) + row.rtp.toFixed(2).padStart(6) + '  [' + lo.toFixed(2).padStart(6) + ', ' + hi.toFixed(2).padStart(6) + ']  ' + row.scandal.toFixed(2).padStart(8) + '  ' + row.picks.toFixed(2).padStart(5) +
        '  ' + row.avgPaid.toFixed(2).padStart(10) + '  ' + row.maxPaid.toFixed(2).padStart(10) + '  ' + String(a.deadends).padStart(8) + '  ' + String(a.landslides).padStart(10) + (miss ? '  <-- 96.00 OUTSIDE' : ''));
    });
    if (JSON_OUT) require('fs').writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
    process.exit(out.some((r) => r.miss) ? 1 : 0);
  };
  const workers = [];
  const feed = (w) => { const j = jobs.shift(); if (j) w.postMessage(j); };
  for (let k = 0; k < Math.min(W, jobs.length); k++) {
    const w = new Worker(__filename, { workerData: {} }); workers.push(w);
    w.on('message', (m) => { const r = res[m.line], a = m.acc; for (const key of Object.keys(a)) r[key] = key === 'max' ? Math.max(r.max, a.max) : r[key] + a[key]; if (--pending === 0) finish(); else feed(w); });
    w.on('error', (e) => { console.error(e); process.exit(2); });
    feed(w);
  }
}
