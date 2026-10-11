'use strict';
// Stratified RTP estimator for Dino: node games/dino-rtp.js [procs=3] [spinsPerProc=2000000] [bonusPerProc=150000]
// A round = its paid spin (tumble wins D + scatter pay) and, when it lands 4+ scatters (I = 1), a bonus whose value does not depend on how it was triggered
// (always 10 free spins). So RTP(way) = (E[D] + P(I) * E[bonus]) / cost, with the bonus sampled on its own: far tighter than spin-by-spin play.
//   spin: cost 1   ante: cost anteCost (more scatters)   buy: cost buyCost, its spin starts with 4-6 scatters (I = 1)
// The 10,000x round cap is applied to each part on its own (a bonus is capped at 10,000x; base + bonus is not re-capped), so the estimate is at or above the true
// payback by a negligible amount (rounds whose spin + bonus cross the cap only through their sum).
const { fork } = require('child_process');
const E = require('./dino-engine.js');

const BOUND_SE = 3;
const CEILING_PCT = 100.0, PB_SEED = 20261011, SLICE_MS = 40, PB_DEADLINE_MS = 300000;
const PB_PLAN = { spin: 400000, ante: 400000, buy: 100000, bonus: 40000, batches: 50 };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const varOf = (a) => { const m = mean(a); return a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1); };
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
const cfgHash = (c) => require('crypto').createHash('sha256').update(JSON.stringify(stable(c))).digest('hex');
// a price is charged in whole units, Math.round(cost x bet); measured at the LOWEST price in multiples of the bet any allowed bet pays (ante: only the ante levels)
const lowestPrice = (cost, levels) => { let lo = Infinity; for (const b of levels || E.BET_LEVELS) { const c = Math.round(cost * b); if (c > 0 && c / b < lo) lo = c / b; } return Number.isFinite(lo) ? Math.min(lo, cost) : cost; };

// one paid spin of a way -> { d: tumble win + scatter pay (x bet), trig: 0|1 }
function spinPart(e, rng, way) {
  const cfg = e.cfg;
  const s = way === 'buy' ? e.playSpin(rng, { kind: 'base', scatters: pickBuy(rng, cfg), capLeft: E.MAX_WIN_X }) : e.playSpin(rng, { kind: way === 'ante' ? 'ante' : 'base', capLeft: E.MAX_WIN_X });
  const trig = s.scatters >= 4 ? 1 : 0;
  return { d: s.spinWin + (trig ? cfg.scatterPay[Math.min(s.scatters, 6)] : 0), trig, s };
}
function pickBuy(rng, cfg) { const t = cfg.buyScatters, tot = t.reduce((a, b) => a + b[1], 0); let x = rng() * tot; for (const [v, w] of t) { x -= w; if (x < 0) return v; } return t[t.length - 1][0]; }

// ways: spin, ante, buy, each in % of its stake. opts: { seed, scale, cancelled }
async function measure(cfg, opts = {}) {
  const seed = (opts.seed === undefined ? PB_SEED : opts.seed) >>> 0, scale = opts.scale === undefined ? 1 : opts.scale, t0 = Date.now(), J = PB_PLAN.batches;
  const e = E.createEngine(cfg), plan = {};
  for (const k of Object.keys(PB_PLAN)) plan[k] = k === 'batches' ? J : Math.max(J, Math.round(PB_PLAN[k] * scale / J) * J);
  const rngAt = (stream, k) => E.rngFrom((seed + Math.imul(stream + 1, 0x9E3779B1) + Math.imul(k + 1, 0x85EBCA6B)) >>> 0);
  const acc = { spin: [], ante: [], buy: [], bonus: [] };
  let maxStretch = 0, mark = process.hrtime.bigint(), rounds = 0;
  const lap = () => { const t = process.hrtime.bigint(); maxStretch = Math.max(maxStretch, Number(t - mark) / 1e6); mark = t; };
  const tick = async () => { if (Number(process.hrtime.bigint() - mark) / 1e6 >= SLICE_MS) { lap(); await new Promise((r) => setImmediate(r)); mark = process.hrtime.bigint(); if (Date.now() - t0 > PB_DEADLINE_MS) throw new Error('payback check did not finish in ' + PB_DEADLINE_MS / 1000 + ' s'); if (opts.cancelled && opts.cancelled()) throw new Error('payback check cancelled'); } };
  const WAYS = ['spin', 'ante', 'buy'];
  for (let j = 0; j < J; j++) {
    for (let w = 0; w < 3; w++) {
      const way = WAYS[w], r = rngAt(w, j), per = plan[way] / J, b = { n: per, d: 0, i: 0 };
      for (let i = 0; i < per; i++) { const x = spinPart(e, r, way); b.d += x.d; b.i += x.trig; rounds++; if ((i & 63) === 63) await tick(); }
      acc[way].push(b);
    }
    const r = rngAt(3, j), per = plan.bonus / J; let s = 0;
    for (let i = 0; i < per; i++) { s += e.playBonus(r, E.MAX_WIN_X).total; rounds++; await tick(); }
    acc.bonus.push(s / per);
  }
  lap();
  const B = { m: mean(acc.bonus), v: varOf(acc.bonus) / J };
  const costs = { spin: 1, ante: lowestPrice(cfg.anteCost, E.BET_LEVELS.filter((b) => Number.isSafeInteger(b * cfg.anteCost))), buy: lowestPrice(cfg.buyCost) };
  const ways = {};
  for (const way of WAYS) {
    const per = acc[way].map((b) => (b.d + b.i * B.m) / b.n), p = mean(acc[way].map((b) => b.i / b.n)), cost = costs[way];
    const parts = { [way]: varOf(per) / J, bonus: p * p * B.v };
    ways[way] = { pct: mean(per) / cost * 100, se: Math.sqrt(parts[way] + parts.bonus) / cost * 100, trigger: p, parts: { [way]: parts[way] / cost ** 2 * 1e4, bonus: parts.bonus / cost ** 2 * 1e4 } };
  }
  const worst = Object.entries(ways).map(([way, x]) => ({ way, pct: x.pct, se: x.se })).sort((a, b) => (b.pct || 0) - (a.pct || 0))[0];
  const finite = Object.values(ways).every((x) => Number.isFinite(x.pct) && Number.isFinite(x.se));
  const bound = Object.entries(ways).map(([way, x]) => ({ way, pct: x.pct, se: x.se, upper: x.pct + BOUND_SE * x.se })).sort((a, b) => (b.upper || 0) - (a.upper || 0))[0];
  return { ok: finite && bound.upper <= CEILING_PCT, finite, ceilingPct: CEILING_PCT, boundSe: BOUND_SE, bound, ways, worst, bonusEV: B.m, rounds, ms: Date.now() - t0, maxStretchMs: maxStretch, seed, scale, mode: 'direct' };
}
// Same shape as bender-rtp.js measureInWorker: the 300-round smoke test and measure() run in a worker thread, never on the server's event loop.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const SMOKE_LIMIT_MS = 10000;
function measureInWorker(cfg, opts = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { dinoCheck: true, cfg, opts: { scale: opts.scale, seed: opts.seed } }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    let done = false, smoked = false;
    const end = (fn, v) => { if (done) return; done = true; clearInterval(poll); clearTimeout(smokeT); clearTimeout(deadT); w.terminate(); fn(v); };
    const poll = setInterval(() => { if (opts.cancelled && opts.cancelled()) end(reject, new Error('payback check cancelled')); }, 50);
    const smokeT = setTimeout(() => { if (!smoked) end(reject, new Error('cfg: the config is too slow to check: its smoke test did not finish in ' + SMOKE_LIMIT_MS / 1000 + ' s')); }, SMOKE_LIMIT_MS);
    const deadT = setTimeout(() => end(reject, new Error('payback check did not finish in ' + PB_DEADLINE_MS / 1000 + ' s')), PB_DEADLINE_MS + 5000);
    w.on('message', (m) => { if (m.stage === 'smoke') smoked = true; else if (m.ok) end(resolve, m.r); else end(reject, new Error(m.message)); });
    w.on('error', (e) => end(reject, e));
    w.on('exit', (c) => end(reject, new Error('payback check worker stopped (' + c + ')')));
  });
}
if (!isMainThread && workerData && workerData.dinoCheck) {
  (async () => {
    try { E.validateConfig(workerData.cfg); parentPort.postMessage({ stage: 'smoke' }); parentPort.postMessage({ ok: true, r: await measure(workerData.cfg, workerData.opts) }); }
    catch (e) { parentPort.postMessage({ ok: false, message: String(e && e.message) }); }
  })();
}
module.exports = { measure, measureInWorker, cfgHash, lowestPrice, CEILING_PCT, BOUND_SE };

if (require.main === module && isMainThread) {
// DINO_CFG='{"bombW":7,"payScale":1.1}' overrides engine CFG for tuning runs (payScale multiplies the pay table). Workers inherit the env.
if (process.env.DINO_CFG) {
  const o = JSON.parse(process.env.DINO_CFG), k = o.payScale; delete o.payScale;
  if (k) for (const a of Object.values(E.CFG.pay)) for (let i = 0; i < a.length; i++) a[i] *= k;
  Object.assign(E.CFG, o);
}
const TAIL = [100, 500, 1000, 2500, 5000, 10000];

if (process.argv[2] === 'worker') {
  const [seed, nSpin, nBonus] = process.argv.slice(3).map(Number);
  const rng = E.rngFrom(seed), eng = E.createEngine();
  const st = () => ({ n: 0, d: 0, d2: 0, i: 0, di: 0, hit: 0, tum: 0 });
  const out = { spin: st(), ante: st(), buy: st(), bonus: { n: 0, sum: 0, sq: 0, max: 0, tail: TAIL.map(() => 0), spins: 0, bombSpins: 0, winSpins: 0, applied: 0, bombSum: 0, bombs: 0, retrig: 0, capped: 0 } };
  for (const way of ['spin', 'ante', 'buy']) {
    const o = out[way], n = way === 'buy' ? Math.round(nSpin / 10) : nSpin;
    for (let k = 0; k < n; k++) { const x = spinPart(eng, rng, way); o.n++; o.d += x.d; o.d2 += x.d * x.d; o.i += x.trig; o.di += x.d * x.trig; if (x.d > 0) o.hit++; o.tum += x.s.steps.length; }
  }
  const b = out.bonus;
  for (let k = 0; k < nBonus; k++) {
    const r = eng.playBonus(rng, E.MAX_WIN_X), t = r.total;
    b.n++; b.sum += t; b.sq += t * t; if (t > b.max) b.max = t; TAIL.forEach((x, i) => { if (t >= x) b.tail[i]++; });
    if (r.retriggers) b.retrig++; if (r.capped) b.capped++;
    for (const s of r.spins) { b.spins++; if (s.bombs.length) b.bombSpins++; b.bombs += s.bombs.length; if (s.winBeforeBombs > 0) b.winSpins++; if (s.bombApplied) { b.applied++; b.bombSum += s.bombSum; } }
  }
  process.send(out); process.exit(0);
}

const P = Math.min(+process.argv[2] || 3, 3), NS = +process.argv[3] || 2e6, NB = +process.argv[4] || 150000;
const cfg = E.CFG, res = [];
let done = 0;
const t0 = Date.now();
for (let i = 0; i < P; i++) {
  const c = fork(__filename, ['worker', String(4000 + i * 7919), String(NS), String(NB)]);
  c.on('message', (m) => { res.push(m); if (++done === P) report(); });
}
function sumOf(get) { const t = {}; for (const r of res) { const o = get(r); for (const [k, v] of Object.entries(o)) t[k] = Array.isArray(v) ? (t[k] || v.map(() => 0)).map((x, i) => x + v[i]) : k === 'max' ? Math.max(t[k] || 0, v) : (t[k] || 0) + v; } return t; }
function report() {
  const b = sumOf((r) => r.bonus), ev = b.sum / b.n, evVar = (b.sq / b.n - ev * ev) / b.n, sd = Math.sqrt(b.sq / b.n - ev * ev);
  const anteCost = lowestPrice(cfg.anteCost, E.BET_LEVELS.filter((x) => Number.isSafeInteger(x * cfg.anteCost))), buyCost = lowestPrice(cfg.buyCost);
  const lines = [], summary = {};
  for (const [way, cost] of [['spin', 1], ['ante', anteCost], ['buy', buyCost]]) {
    const o = sumOf((r) => r[way]), n = o.n, md = o.d / n, p = o.i / n;
    const vD = o.d2 / n - md * md, cov = o.di / n - md * p, vI = p * (1 - p);
    const varRound = vD + ev * ev * vI + 2 * ev * cov;
    const rtp = (md + p * ev) / cost, se = Math.sqrt(varRound / n + p * p * evVar) / cost;
    summary[way] = { rtp: +(rtp * 100).toFixed(3), se: +(se * 100).toFixed(3) };
    lines.push(`${way.padEnd(4)} n=${n} RTP ${(rtp * 100).toFixed(2)}% +-${(se * 100).toFixed(2)} (1 se)  spin part ${(md / cost * 100).toFixed(2)}%  hit ${(o.hit / n * 100).toFixed(1)}%  bonus 1 in ${p ? (1 / p).toFixed(0) : '-'}  tumbles/spin ${(o.tum / n).toFixed(2)}  round sd ${Math.sqrt(varRound).toFixed(1)}x`);
  }
  const pSpin = sumOf((r) => r.spin), pTrig = pSpin.i / pSpin.n;
  lines.push(`bonus n=${b.n} EV ${ev.toFixed(2)}x (se ${Math.sqrt(evVar).toFixed(2)}, sd ${sd.toFixed(0)}) max ${b.max.toFixed(0)}x  retrigger in ${(b.retrig / b.n * 100).toFixed(1)}%  spins/bonus ${(b.spins / b.n).toFixed(2)}`);
  lines.push(`  bonus >= ${TAIL.map((x, i) => x + 'x: 1 in ' + (b.tail[i] ? Math.round(b.n / b.tail[i]) : '>' + b.n)).join(', ')}`);
  lines.push(`  cap (10,000x) per bonus: ${b.capped} of ${b.n}; per base spin ~1 in ${b.capped ? Math.round(1 / (pTrig * b.capped / b.n)).toLocaleString() : '>' + Math.round(b.n / pTrig).toLocaleString()}`);
  lines.push(`  bombs: on ${(b.bombSpins / b.spins * 100).toFixed(1)}% of free spins, ${(b.bombs / b.spins).toFixed(2)} per spin; spins winning ${(b.winSpins / b.spins * 100).toFixed(1)}%; bombs applied on ${(b.applied / b.spins * 100).toFixed(1)}% of spins, mean bomb sum when applied ${(b.bombSum / b.applied).toFixed(2)}x`);
  console.log(lines.join('\n'));
  console.log(JSON.stringify({ ...summary, bonusEV: +ev.toFixed(3), secs: Math.round((Date.now() - t0) / 1000) }));
}

}
