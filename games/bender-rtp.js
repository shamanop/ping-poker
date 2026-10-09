'use strict';
// Stratified RTP estimator: node games/bender-rtp.js [procs=12] [baseSpinsPerProc=4000000] [bonusRunsPerProc=300000]
// RTP = E[base cluster win] + sum_n P(n scatters) * (scatterPay_n + E[bonus | n]); buy RTP = E[bonus]/cost.
// Splitting the bonus out and sampling it directly resolves RTP far tighter than plain spin-by-spin sims.
const { fork } = require('child_process');
const E = require('./bender-engine.js');

// ---- the server's payback check (K2-Bcfg): measure(cfg) is the same stratified estimator, in process, in slices that yield to the event loop; the CLI below is unchanged.
// Two modes. DIRECT (any config): sample the base game and each bonus kind and combine, as the CLI does, with a stated SE; the bonuses have a heavy tail, so the buys come out with a wide SE at a budget a server
// can spend (see the report). PAIRED (the config differs from the shipped one ONLY in pay / scatterPay / buyCost, which do not steer the game, so the same random numbers give the same boards): the shipped
// config and the new one are played on identical streams and only the DIFFERENCE is sampled, on top of games/bender-ref.json (the shipped numbers, from a long offline run). A rigged pay table is a huge difference
// with a tiny SE, the shipped numbers themselves cost nothing and the error is the reference's.
// R2C-3: a way is accepted only if its UPPER bound (measured + BOUND_SE standard errors) is at or under the ceiling: the check's own uncertainty counts against the admin, a fixed seed that reads low cannot decide it.
const BOUND_SE = 3;
const CEILING_PCT = 100.0, PB_SEED = 20261008, SLICE_MS = 40, PB_DEADLINE_MS = 300000;
// R2C-3b: a way UNDECIDED after the budget (measured at or under the ceiling, measured + BOUND_SE standard errors above it) gets more rounds, for THAT way only (the parts of its standard error that are largest first),
// EXT_STEP batches at a time, until it is decided (upper bound at or under the ceiling = accept; measured above it = refuse), each part has been sampled EXT_MAX_X times its budget, or EXT_MS of wall clock have passed
// since the check began: still undecided then = refused. A way whose uncertainty is mostly the reference's own (the paired mode) cannot be decided by more rounds and is not extended.
const EXT_MAX_X = 8, EXT_MS = 240000;
const PB_PLAN = { base: 700000, e3: 60000, l4: 60000, l5: 4000, l6: 1000, batches: 50 };
const PB_PLAN_PAIRED = { base: 150000, e3: 20000, l4: 20000, l5: 1500, l6: 300, batches: 50 };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const varOf = (a) => { const m = mean(a); return a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1); };
const stable = (v) => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
const cfgHash = (c) => require('crypto').createHash('sha256').update(JSON.stringify(stable(c))).digest('hex');
let REF = null;
function loadRef() {                     // null when the file is missing or was made for other default numbers (then only the direct mode is used)
  if (REF !== null) return REF || null;
  try { const r = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'bender-ref.json'), 'utf8')); REF = E.DEFAULT_CFG && r.cfgHash === cfgHash(E.DEFAULT_CFG) ? r : false; } catch { REF = false; }
  return REF || null;
}
// R2C-1: a buy is charged in whole cents, Math.round(buyCost x bet), at every allowed bet, and its win is paid unscaled (bet x multiple). Its payback at one bet is therefore E[bonus] x bet / round(buyCost x bet), highest
// where the rounding takes most off the price. The check measures every buy at the LOWEST price in multiples of the bet that any allowed bet pays (a bet whose price rounds to 0 cannot be played, the handler refuses it),
// so a config is accepted only if the buy is at or under the ceiling at every bet a player can pick.
const lowestPrice = (cost) => { let lo = Infinity; for (const b of E.BET_LEVELS) { const c = Math.round(cost * b); if (c > 0 && c / b < lo) lo = c / b; } return Number.isFinite(lo) ? Math.min(lo, cost) : cost; };
const sameDynamics = (a, b) => { const f = (c) => { const x = JSON.parse(JSON.stringify(c)); delete x.pay; delete x.scatterPay; delete x.buyCost; return cfgHash(x); }; return f(a) === f(b); };
// ways: spin (the base game incl. the scatter-triggered bonus), buyElection, buyLandslide, each in % of its stake. opts: { seed, scale, direct }
async function measure(cfg, opts = {}) {
  const seed = (opts.seed === undefined ? PB_SEED : opts.seed) >>> 0, scale = opts.scale === undefined ? 1 : opts.scale, t0 = Date.now(), J = 50;
  const ref = opts.direct ? null : loadRef(), paired = !!(ref && sameDynamics(cfg, E.DEFAULT_CFG)), PLAN = paired ? PB_PLAN_PAIRED : PB_PLAN;
  const e = E.createEngine(cfg), eS = paired ? E.createEngine(JSON.parse(JSON.stringify(E.DEFAULT_CFG))) : null, plan = {};
  for (const k of Object.keys(PLAN)) plan[k] = k === 'batches' ? J : Math.max(J, Math.round(PLAN[k] * scale / J) * J);
  const rngAt = (stream, k) => E.rngFrom((seed + Math.imul(stream + 1, 0x9E3779B1) + Math.imul(k + 1, 0x85EBCA6B)) >>> 0);
  const acc = { base: [], e3: [], l4: [], l5: [], l6: [] };           // direct: bonus mean | base batch; paired: the same with the DIFFERENCE to the shipped config
  let maxStretch = 0, mark = process.hrtime.bigint(), rounds = 0;
  const lap = () => { const t = process.hrtime.bigint(); maxStretch = Math.max(maxStretch, Number(t - mark) / 1e6); mark = t; };
  const tick = async () => { if (Number(process.hrtime.bigint() - mark) / 1e6 >= SLICE_MS) { lap(); await new Promise((r) => setImmediate(r)); mark = process.hrtime.bigint(); if (Date.now() - t0 > PB_DEADLINE_MS) throw new Error('payback check did not finish in ' + PB_DEADLINE_MS / 1000 + ' s'); if (opts.cancelled && opts.cancelled()) throw new Error('payback check cancelled'); } };
  const KINDS = { e3: ['election', 3], l4: ['landslide', 4], l5: ['landslide', 5], l6: ['landslide', 6] };
  const bonusB = async (key, upto) => { const per = plan[key] / J, [kind, n] = KINDS[key]; while (acc[key].length < upto) { const j = acc[key].length, st = 1 + Object.keys(KINDS).indexOf(key), r = rngAt(st, j), rS = paired ? rngAt(st, j) : null; let s = 0; for (let i = 0; i < per; i++) { s += e.playBonus(r, kind, n, E.MAX_WIN_X).total; if (paired) s -= eS.playBonus(rS, kind, n, E.MAX_WIN_X).total; rounds++; await tick(); } acc[key].push(s / per); } };
  const baseB = async (upto) => { const per = plan.base / J; while (acc.base.length < upto) { const j = acc.base.length, r = rngAt(0, j), rS = paired ? rngAt(0, j) : null, b = { n: per, win: 0, sc: [0, 0, 0, 0] }; for (let i = 0; i < per; i++) { const x = e.playSpin(r, { bonus: false, capLeft: E.MAX_WIN_X }); b.win += x.win; if (paired) b.win -= eS.playSpin(rS, { bonus: false, capLeft: E.MAX_WIN_X }).win; if (x.scatters >= 3) b.sc[Math.min(x.scatters, 6) - 3]++; rounds++; if ((i & 63) === 63) await tick(); } acc.base.push(b); } };
  const compute = () => {
    const mu = (key) => ({ m: mean(acc[key]), v: varOf(acc[key]) / acc[key].length }), B = [mu('e3'), mu('l4'), mu('l5'), mu('l6')];
    if (paired) {
      const spS = E.DEFAULT_CFG.scatterPay, p = ref.p, dsp = [0, 1, 2, 3].map((i) => (cfg.scatterPay[i + 3] || 0) - (spS[i + 3] || 0));
      const per = acc.base.map((b) => b.win / b.n + p.reduce((a, pn, i) => a + pn * (dsp[i] + B[i].m), 0));       // the same bonus term in every batch: the spread is the base difference's
      const parts = { base: varOf(acc.base.map((b) => b.win / b.n)) / acc.base.length };
      for (let i = 0; i < 4; i++) parts[['e3', 'l4', 'l5', 'l6'][i]] = p[i] ** 2 * B[i].v;
      const se2 = Object.values(parts).reduce((a, b) => a + b, 0), sp = { pct: ref.spin.pct + mean(per) * 100, se: Math.hypot(ref.spin.se, Math.sqrt(se2) * 100), fixed: ref.spin.se, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v * 1e4])) };
      const buy = (i, cost) => ({ pct: (ref.B[i].m + B[i].m) / cost * 100, se: Math.hypot(ref.B[i].se, Math.sqrt(B[i].v)) / cost * 100, fixed: ref.B[i].se / cost * 100, parts: { [['e3', 'l4'][i]]: B[i].v / cost ** 2 * 1e4 } });
      return { spin: sp, buyElection: buy(0, lowestPrice(cfg.buyCost.election)), buyLandslide: buy(1, lowestPrice(cfg.buyCost.landslide)) };
    }
    const c = [0, 1, 2, 3].map((i) => (cfg.scatterPay[i + 3] || 0) + B[i].m);     // scatter pay + the bonus it starts, for 3, 4, 5, 6 scatters
    const per = acc.base.map((b) => b.win / b.n + b.sc.reduce((a, k, i) => a + (k / b.n) * c[i], 0));
    const parts = { base: varOf(per) / per.length };
    for (let i = 0; i < 4; i++) parts[['e3', 'l4', 'l5', 'l6'][i]] = mean(acc.base.map((b) => b.sc[i] / b.n)) ** 2 * B[i].v;
    const pE = lowestPrice(cfg.buyCost.election), pL = lowestPrice(cfg.buyCost.landslide);
    return { spin: { pct: mean(per) * 100, se: Math.sqrt(Object.values(parts).reduce((a, b) => a + b, 0)) * 100, fixed: 0, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v * 1e4])) }, buyElection: { pct: B[0].m / pE * 100, se: Math.sqrt(B[0].v) / pE * 100, fixed: 0, parts: { e3: B[0].v / pE ** 2 * 1e4 } }, buyLandslide: { pct: B[1].m / pL * 100, se: Math.sqrt(B[1].v) / pL * 100, fixed: 0, parts: { l4: B[1].v / pL ** 2 * 1e4 } } };
  };
  const worstOf = (ways) => Object.entries(ways).map(([way, x]) => ({ way, pct: x.pct, se: x.se })).sort((a, b) => (b.pct || 0) - (a.pct || 0))[0];
  let ways = null, early = false;
  // paired and the config IS the shipped one in every number: nothing to sample, the answer is the reference
  const identical = paired && cfgHash(cfg) === cfgHash(E.DEFAULT_CFG);
  if (identical) ways = { spin: { ...ref.spin }, buyElection: { ...ref.buyElection }, buyLandslide: { ...ref.buyLandslide } };
  else for (const upto of [Math.max(5, Math.round(J / 10)), J]) {
    await baseB(upto); await bonusB('e3', upto); await bonusB('l4', upto); await bonusB('l5', upto); await bonusB('l6', upto);
    ways = compute(); const w = worstOf(ways);
    if (upto < J && w.pct - 6 * w.se > CEILING_PCT) { early = true; break; }
  }
  // R2C-3b: extend the undecided ways (see EXT_MAX_X); not after an early stop, not for a config already over the ceiling on a point estimate, not for a way the reference's own uncertainty already keeps above it.
  const up = (x) => x.pct + BOUND_SE * x.se, undecided = (x) => x.pct <= CEILING_PCT && up(x) > CEILING_PCT && x.pct + BOUND_SE * (x.fixed || 0) < CEILING_PCT;
  const grow = (key, upto) => (key === 'base' ? baseB(upto) : bonusB(key, upto)), ext = { rounds: 0, batches: {}, capped: false, ms: 0 }, extT0 = Date.now(), r0 = rounds;
  while (!identical && !early && !Object.values(ways).some((x) => x.pct > CEILING_PCT)) {
    const und = Object.entries(ways).filter(([, x]) => up(x) > CEILING_PCT).sort((a, b) => up(b[1]) - up(a[1]));
    if (!und.length) break;
    if (!undecided(und[0][1])) { ext.capped = true; break; }                // the worst way cannot be decided by more rounds
    const cand = Object.entries(und[0][1].parts).filter(([k, v]) => v > 0 && acc[k].length < EXT_MAX_X * J).sort((a, b) => b[1] - a[1]);
    if (!cand.length || Date.now() - t0 > (opts.extMs || EXT_MS)) { ext.capped = true; break; }
    const key = cand[0][0], upto = Math.min(EXT_MAX_X * J, acc[key].length + J / 2);
    await grow(key, upto); ext.batches[key] = upto; ways = compute();
  }
  ext.rounds = rounds - r0; ext.ms = Date.now() - extT0;
  lap();
  const worst = worstOf(ways), finite = Object.values(ways).every((x) => Number.isFinite(x.pct) && Number.isFinite(x.se));
  const bound = Object.entries(ways).map(([way, x]) => ({ way, pct: x.pct, se: x.se, upper: x.pct + BOUND_SE * x.se })).sort((a, b) => (b.upper || 0) - (a.upper || 0))[0];
  return { ok: finite && bound.upper <= CEILING_PCT, finite, ceilingPct: CEILING_PCT, boundSe: BOUND_SE, bound, ways, worst, rounds, extraRounds: ext.rounds, extended: ext, ms: Date.now() - t0, maxStretchMs: maxStretch, seed, scale, early, mode: paired ? 'paired' : 'direct' };
}
// R2C-4: the admin path never runs a config's smoke test or its measuring on the server's event loop. A worker thread (this file again, `benderCheck` in workerData) plays the 300-round smoke test of the config and then measure();
// the server only waits for its message. A config whose smoke test does not end in SMOKE_LIMIT_MS, or whose check does not end in PB_DEADLINE_MS, or that the admin withdrew (opts.cancelled), is stopped (terminate) and refused.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const SMOKE_LIMIT_MS = 10000;
function measureInWorker(cfg, opts = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { benderCheck: true, cfg, opts: { scale: opts.scale, seed: opts.seed, extMs: opts.extMs } }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
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
if (!isMainThread && workerData && workerData.benderCheck) {
  (async () => {
    try { E.validateConfig(workerData.cfg); parentPort.postMessage({ stage: 'smoke' }); parentPort.postMessage({ ok: true, r: await measure(workerData.cfg, workerData.opts) }); }
    catch (e) { parentPort.postMessage({ ok: false, message: String(e && e.message) }); }
  })();
}
module.exports = { measure, measureInWorker, loadRef, cfgHash, lowestPrice, CEILING_PCT, BOUND_SE };

if (require.main === module && isMainThread) {              // R2C-4: not inside the checking worker thread, where this file is the entry script too (the CLI forked 12 estimator processes per check)
// BB_CFG='{"scatterW":1.3,"payScale":1.9}' overrides engine CFG for tuning runs (payScale multiplies pay + scatterPay). Workers inherit the env.
if (process.env.BB_CFG) {
  const o = JSON.parse(process.env.BB_CFG), k = o.payScale; delete o.payScale;
  if (k) { for (const a of Object.values(E.CFG.pay)) for (let i = 0; i < a.length; i++) a[i] *= k; for (const n in E.CFG.scatterPay) E.CFG.scatterPay[n] *= k; }
  Object.assign(E.CFG, o);
}

if (process.argv[2] === 'worker') {
  const [seed, nBase, nBonus] = process.argv.slice(3).map(Number);
  const rng = E.rngFrom(seed), eng = E.createEngine();
  const out = { base: { n: 0, sum: 0, sq: 0 }, sc: {}, bonus: {} };
  const acc = (o, x) => { o.n++; o.sum += x; o.sq += x * x; };
  for (let i = 0; i < nBase; i++) {
    const b = eng.playSpin(rng, { bonus: false, capLeft: E.MAX_WIN_X });
    acc(out.base, b.win);
    const n = Math.min(b.scatters, 6); out.sc[n] = (out.sc[n] || 0) + 1;
  }
  for (const [kind, n, div] of [['election', 3, 1], ['landslide', 4, 1], ['landslide', 5, 8], ['landslide', 6, 40]]) {
    const o = out.bonus[kind + n] = { n: 0, sum: 0, sq: 0 };
    for (let i = 0; i < nBonus / div; i++) acc(o, eng.playBonus(rng, kind, n, E.MAX_WIN_X).total);
  }
  process.send(out); process.exit(0);
}

const P = +process.argv[2] || 12, NB = +process.argv[3] || 4e6, NO = +process.argv[4] || 3e5;
const cfg = E.CFG, res = [];
let done = 0;
for (let i = 0; i < P; i++) {
  const c = fork(__filename, ['worker', String(1000 + i * 7919), String(NB), String(NO)]);
  c.on('message', (m) => { res.push(m); if (++done === P) report(); });
}
function merge(key, get) { const t = { n: 0, sum: 0, sq: 0 }; for (const r of res) { const o = get(r); if (!o) continue; t.n += o.n; t.sum += o.sum; t.sq += o.sq; } return t; }
function stat(t) { const m = t.sum / t.n; const sd = Math.sqrt(Math.max(0, t.sq / t.n - m * m)); return { mean: m, se: sd / Math.sqrt(t.n) }; }
function report() {
  const base = merge('base', (r) => r.base), bs = stat(base);
  const scN = {}; let tot = 0; for (const r of res) for (const [n, c] of Object.entries(r.sc)) { scN[n] = (scN[n] || 0) + c; tot += c; }
  let rtp = bs.mean, varSum = bs.se ** 2;
  const lines = [`base spin n=${base.n} mean ${bs.mean.toFixed(4)}x (se ${bs.se.toFixed(4)})  [includes cluster wins on triggering spins]`];
  for (const n of [3, 4, 5, 6]) {
    const p = (scN[n] || 0) / tot; if (!p) continue;
    const bonusN = n === 4 ? 'landslide4' : n === 5 ? 'landslide5' : n === 6 ? 'landslide6' : 'election3';
    const s = stat(merge(bonusN, (r) => r.bonus[bonusN]));
    const add = p * (cfg.scatterPay[n] + s.mean);
    rtp += add; varSum += (p * s.se) ** 2;
    lines.push(`${n} scatters p=1 in ${(1 / p).toFixed(0)}  scatterPay ${cfg.scatterPay[n]}x  ${bonusN} EV ${s.mean.toFixed(2)}x (se ${s.se.toFixed(2)}) -> +${(add * 100).toFixed(3)} pts`);
  }
  const bE = stat(merge('election3', (r) => r.bonus.election3)), bL = stat(merge('landslide4', (r) => r.bonus.landslide4));
  lines.push(`BUY election: EV ${bE.mean.toFixed(3)}x (se ${bE.se.toFixed(3)}) cost ${cfg.buyCost.election}x -> RTP ${(bE.mean / cfg.buyCost.election * 100).toFixed(2)}%`);
  lines.push(`BUY landslide: EV ${bL.mean.toFixed(3)}x (se ${bL.se.toFixed(3)}) cost ${cfg.buyCost.landslide}x -> RTP ${(bL.mean / cfg.buyCost.landslide * 100).toFixed(2)}%`);
  console.log(lines.join('\n'));
  console.log(`BASE-GAME RTP ${(rtp * 100).toFixed(3)}% (95% CI +-${(1.96 * Math.sqrt(varSum) * 100).toFixed(3)})`);
  console.log(JSON.stringify({ rtp, ci: 1.96 * Math.sqrt(varSum), buyE: bE.mean, buyL: bL.mean }));
}

}
