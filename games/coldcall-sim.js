'use strict';
// COLD CALL simulator. Run niced and capped at 6 worker threads (the box is shared):
//   nice -n 15 node games/coldcall-sim.js [spins=100000000] [seed=1]            plain-spin RTP, hit rate, bonus rates, per-part RTP
//   nice -n 15 node games/coldcall-sim.js --buys [runsPerBuy=5000000] [seed=1]  average bonus value + RTP of each buy at its price
//   add --cfg '{"landP":0.05,"payScale":1.1}' to override levers (top-level keys replace) while tuning; --json for one JSON line.
// Seeds are stratified: the run is cut into 1M-spin chunks, each chunk has its own seed (splitmix of base seed + chunk index) and its
// own 128-bit rng stream, so chunks are independent and the result does not depend on how many threads ran it.
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const Eng = require('./coldcall-engine.js');

const MAX_THREADS = 6, CHUNK = 1000000;
const seedOf = (base, k) => { let z = (base + Math.imul(k + 1, 0x9E3779B9)) | 0; z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B); z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35); return (z ^ (z >>> 16)) >>> 0; };
const mk = () => ({ n: 0, sum: 0, sq: 0 });
const add = (a, x) => { a.n++; a.sum += x; a.sq += x * x; };

if (!isMainThread) {
  const { cfg, mode, chunks, size, baseSeed } = workerData;
  const eng = Eng.createEngine(cfg);
  const out = { total: mk(), base: mk(), rotary: mk(), quote: mk(), buyRotary: mk(), buyQuote: mk(), nRot: 0, nQuo: 0, nAny: 0, nBoth: 0, hitBase: 0, hitAny: 0, maxT: 0, capHits: 0, grand: 0, rotaryNat: mk(), quoteNat: mk() };
  for (const k of chunks) {
    const rng = Eng.rngFrom(seedOf(baseSeed, k));
    if (mode === 'buys') {
      for (let i = 0; i < size; i++) { add(out.buyRotary, eng.round(rng, 'rotary').winTenths); add(out.buyQuote, eng.round(rng, 'quote').winTenths); }
      continue;
    }
    for (let i = 0; i < size; i++) {
      const r = eng.round(rng, null);
      const w = r.winTenths;
      add(out.total, w); add(out.base, r.baseTenths); add(out.rotary, r.rotaryTenths); add(out.quote, r.quoteTenths);
      if (r.baseTenths > 0) out.hitBase++;
      if (w > 0) out.hitAny++;
      if (r.rotary) { out.nRot++; add(out.rotaryNat, r.rotaryTenths); }
      if (r.quote) { out.nQuo++; add(out.quoteNat, r.quoteTenths); }
      if (r.rotary || r.quote) out.nAny++;
      if (r.rotary && r.quote) out.nBoth++;
      if (w > out.maxT) out.maxT = w;
      if (r.capped && w >= eng.cfg.maxWinTenths) out.capHits++;
      if (r.grand) out.grand++;
    }
  }
  parentPort.postMessage(out);
} else {
  try { os.setPriority(15); } catch {}
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
  const bool = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const cfgArg = flag('--cfg'), buysMode = bool('--buys'), asJson = bool('--json'), thrArg = flag('--threads');
  const nums = argv.filter((a) => !a.startsWith('--')).map(Number);
  const N = buysMode ? (nums[0] || 5000000) : (nums[0] || 100000000), seed = nums[1] || 1;
  const cfg = Object.assign({}, Eng.CFG, cfgArg && cfgArg !== true ? JSON.parse(cfgArg) : {});
  const threads = Math.min(MAX_THREADS, Math.max(1, +thrArg || MAX_THREADS));
  const size = Math.min(CHUNK, N), nChunks = Math.ceil(N / size), total = nChunks * size;
  const per = Array.from({ length: threads }, () => []);
  for (let k = 0; k < nChunks; k++) per[k % threads].push(k);
  const t0 = Date.now();
  const mode = buysMode ? 'buys' : 'spins';
  Promise.all(per.filter((c) => c.length).map((chunks) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { cfg, mode, chunks, size, baseSeed: seed } });
    w.once('message', res); w.once('error', rej);
  }))).then((parts) => {
    const merge = (key) => parts.reduce((a, p) => { a.n += p[key].n; a.sum += p[key].sum; a.sq += p[key].sq; return a; }, mk());
    const stat = (a, k = 1) => { const m = a.sum / a.n, sd = Math.sqrt(Math.max(0, a.sq / a.n - m * m)); return { mean: m / 10 * k, ci: 1.96 * sd / Math.sqrt(a.n) / 10 * k }; };
    const secs = (Date.now() - t0) / 1000;
    const sumP = (key) => parts.reduce((a, p) => a + p[key], 0);
    if (buysMode) {
      const o = { mode, runsPerBuy: total, seed, secs };
      for (const [kind, key] of [['rotary', 'buyRotary'], ['quote', 'buyQuote']]) {
        const s = stat(merge(key)), price = cfg.buyCost[kind] / 10;
        o[kind] = { avgValueX: s.mean, ci: s.ci, priceX: price, rtpPct: s.mean / price * 100, rtpCi: s.ci / price * 100, suggestedPriceTenths: Math.round(s.mean / 0.98 * 10) };
      }
      if (asJson) return console.log(JSON.stringify(o));
      console.log(`buys, ${total} runs each, seed ${seed}, ${secs.toFixed(1)}s`);
      for (const kind of ['rotary', 'quote']) { const b = o[kind]; console.log(`  ${kind.padEnd(7)} avg value ${b.avgValueX.toFixed(3)}x (+-${b.ci.toFixed(3)})  price ${b.priceX.toFixed(1)}x  RTP ${b.rtpPct.toFixed(2)}% (+-${b.rtpCi.toFixed(2)})  suggested price (avg/0.98) ${(b.suggestedPriceTenths / 10).toFixed(1)}x = ${b.suggestedPriceTenths} tenths`); }
      return;
    }
    const tot = stat(merge('total')), part = (k) => stat(merge(k));
    const nRot = sumP('nRot'), nQuo = sumP('nQuo'), nAny = sumP('nAny');
    const o = {
      mode, spins: total, seed, secs, rtpPct: tot.mean * 100, rtpCi: tot.ci * 100,
      hitBasePct: sumP('hitBase') / total * 100, hitAnyPct: sumP('hitAny') / total * 100,
      oneInRotary: total / nRot, oneInQuote: total / nQuo, oneInAny: total / nAny, nBoth: sumP('nBoth'),
      parts: { base: part('base').mean * 100, rotary: part('rotary').mean * 100, quote: part('quote').mean * 100 },
      partsCi: { base: part('base').ci * 100, rotary: part('rotary').ci * 100, quote: part('quote').ci * 100 },
      maxWinX: Math.max(...parts.map((p) => p.maxT)) / 10, capHits: sumP('capHits'), capOneIn: sumP('capHits') ? total / sumP('capHits') : null, grand: sumP('grand'),
      avgRotaryX: nRot ? merge('rotaryNat').sum / merge('rotaryNat').n / 10 : 0, avgQuoteX: nQuo ? merge('quoteNat').sum / merge('quoteNat').n / 10 : 0,
    };
    if (asJson) return console.log(JSON.stringify(o));
    const f = (x, d = 2) => x.toFixed(d);
    console.log(`COLD CALL sim: ${total} spins, seed ${seed}, ${threads} threads, ${f(secs, 1)}s (${f(total / secs / 1e6, 2)}M spins/s)`);
    console.log(`  total RTP        ${f(o.rtpPct, 3)}% +- ${f(o.rtpCi, 3)} (95%)`);
    console.log(`  hit rate         base ways ${f(o.hitBasePct)}%   any win ${f(o.hitAnyPct)}%`);
    console.log(`  ROTARY           1 in ${f(o.oneInRotary, 1)}   avg value ${f(o.avgRotaryX)}x`);
    console.log(`  QUOTE ACCEPTED   1 in ${f(o.oneInQuote, 1)}   avg value ${f(o.avgQuoteX)}x   grand ${o.grand} (1 in ${o.grand ? f(total / o.grand, 0) : 'n/a'})`);
    console.log(`  any bonus        1 in ${f(o.oneInAny, 1)}   (both on one spin: ${o.nBoth})`);
    console.log(`  RTP by part      base ${f(o.parts.base)}% (+-${f(o.partsCi.base)})  ROTARY ${f(o.parts.rotary)}% (+-${f(o.partsCi.rotary)})  QUOTE ${f(o.parts.quote)}% (+-${f(o.partsCi.quote)})`);
    console.log(`  max win          ${f(o.maxWinX, 1)}x   cap (${Eng.MAX_WIN_X}x) hit ${o.capHits} times${o.capOneIn ? ' (1 in ' + f(o.capOneIn, 0) + ')' : ''}`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
