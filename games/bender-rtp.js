'use strict';
// Stratified RTP estimator: node games/bender-rtp.js [procs=12] [baseSpinsPerProc=4000000] [bonusRunsPerProc=300000]
// RTP = E[base cluster win] + sum_n P(n scatters) * (scatterPay_n + E[bonus | n]); buy RTP = E[bonus]/cost.
// Splitting the bonus out and sampling it directly resolves RTP far tighter than plain spin-by-spin sims.
const { fork } = require('child_process');
const E = require('./bender-engine.js');
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
