'use strict';
// COLD CALL levers sim: the "feel" numbers the retune never measured (streaks, event gaps, tease, time on device, win ladder).
// Runs the engine exactly as games/coldcall-engine.js round() does (same rng draw order), on worker threads.
//   node tools/levers-sim.js --stream [spins=1000000000] [seed=1]            long sequential chunks: gaps, streaks, teases, ladder, bonus value spread
//   node tools/levers-sim.js --sessions [sessions=300000] [bankX=100] [seed=1] [--cap 20000]   flat 1x bet from a bankroll until bust
//   node tools/levers-sim.js --check                                          replay 200k rounds against engine.round() and compare
//   --cfg '{...}' | --cfg @file.json overrides CFG (objects merge, arrays/numbers replace); --threads N; --out file.json
// Chunks are 1M spins, each with its own seed (splitmix of base seed + chunk index), so the thread count never changes a result.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const Eng = require(fs.existsSync(path.join(__dirname, 'coldcall-engine.js')) ? './coldcall-engine.js' : '../games/coldcall-engine.js');

const MAX_THREADS = +process.env.CC_MAX_THREADS || 6, CHUNK = 1000000;
const seedOf = (base, k) => { let z = (base + Math.imul(k + 1, 0x9E3779B9)) | 0; z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B); z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35); return (z ^ (z >>> 16)) >>> 0; };
const merged = (a, b) => { const o = Array.isArray(a) ? a.slice() : Object.assign({}, a); for (const k of Object.keys(b)) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' ? merged(o[k], b[k]) : b[k]; return o; };

const GAPMAX = 20000;                                   // exact gap histogram up to this many spins, then one overflow bin
const EVENTS = ['dead', 'under1', 'win5', 'win20', 'tease', 'phone', 'bonus', 'any'];   // streak / gap series, see below
const LADDER = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000, 10000];           // thresholds in x bet
const BONUS_EDGES = [1, 5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000, 5000];   // bonus total (x bet) thresholds
const LOGBINS = 100, LOGMAX = 5;                        // bonus value histogram: 100 bins per decade of (tenths), 0..1e5 tenths

if (!isMainThread) {
  const { cfg, mode, chunks, size, baseSeed, sessions, bankX, cap } = workerData;
  const eng = Eng.createEngine(cfg);
  const capT = cfg.maxWinTenths;
  const NS = 30;
  // one full paid round with the same draw order as engine.round(rng, null)
  function oneRound(rng, hot) {
    hot.fill(0);
    const sp = eng.playSpin(rng, 0, hot, false, { capLeft: capT });
    let capLeft = capT - sp.win, capped = sp.capped || capLeft <= 0; if (capped) capLeft = 0;
    let kind = 0; if (!capped && sp.bells >= 3) kind = sp.bells >= 5 ? 3 : sp.bells === 4 ? 2 : 1;
    let bonus = 0;
    if (kind && !capped) { const b = eng.playBonus(rng, kind, false, capLeft, null); bonus = b.total; }
    const win = Math.min(sp.cluster + sp.phone + bonus, capT);
    return { win, bells: sp.bells, phoneFired: sp.fired, phones: sp.phones, kind, bonus, base: sp.win };
  }
  if (mode === 'check') {
    let bad = 0, n = 0;
    for (const k of chunks) {
      const r1 = Eng.rngFrom(seedOf(baseSeed, k)), r2 = Eng.rngFrom(seedOf(baseSeed, k)), hot = new Uint8Array(NS);
      for (let i = 0; i < size; i++) { const a = oneRound(r1, hot), b = eng.round(r2, null); n++; if (a.win !== b.winTenths) bad++; }
    }
    parentPort.postMessage({ n, bad });
  } else if (mode === 'stream') {
    const out = { n: 0, gaps: {}, ladder: LADDER.map(() => 0), bonusN: 0, bonusEdge: BONUS_EDGES.map(() => 0), bonusLog: new Array(LOGBINS * LOGMAX + 1).fill(0), bonusSum: 0,
      teaseN: 0, teaseThenBonus1: 0, teaseThenBonus10: 0, teaseThenBonus50: 0, teaseThenWin5_10: 0, bonusNextBase1: 0, bonusAfterAny10: 0, windows: {}, sumWin: 0, under1: 0, exact1: 0, hits: 0, phoneLandedDead: 0, bellsHist: new Array(6).fill(0),
      big10Rate: 0 };
    for (const e of EVENTS) out.gaps[e] = new Array(GAPMAX + 2).fill(0);
    const WIN = [5, 25, 100, 400];                        // window sizes for "no event in this window" (spins)
    for (const e of EVENTS) { out.windows[e] = { w: WIN.map(() => 0) }; }
    for (const k of chunks) {
      const rng = Eng.rngFrom(seedOf(baseSeed, k)), hot = new Uint8Array(NS);
      const last = {}; for (const e of EVENTS) last[e] = -1;
      const teases = [], bonuses = [], win5s = [];
      let firstSeen = {};
      for (let i = 0; i < size; i++) {
        const r = oneRound(rng, hot), w = r.win;
        out.n++; out.sumWin += w;
        const ev = { dead: w === 0, under1: w < 10, win5: w >= 50, win20: w >= 200, tease: r.bells === 2, phone: r.phoneFired, bonus: r.kind > 0 };
        ev.any = ev.win5 || ev.tease || ev.phone || ev.bonus;
        for (const e of EVENTS) {
          if (!ev[e]) continue;
          if (e === 'dead' || e === 'under1') continue;        // run lengths of these are handled below
          if (last[e] >= 0) { const g = i - last[e]; out.gaps[e][g > GAPMAX ? GAPMAX + 1 : g]++; }
          last[e] = i;
        }
        // streak series: length of each completed run of consecutive dead (or under-1x) spins
        for (const e of ['dead', 'under1']) {
          if (ev[e]) { if (last[e + '_run'] === undefined) last[e + '_run'] = 0; last[e + '_run']++; }
          else if (last[e + '_run']) { const g = last[e + '_run']; out.gaps[e][g > GAPMAX ? GAPMAX + 1 : g]++; last[e + '_run'] = 0; }
        }
        if (w > 0) out.hits++;
        if (w < 10) out.under1++;
        if (w === 10) out.exact1++;
        for (let j = 0; j < LADDER.length; j++) if (w >= LADDER[j] * 10) out.ladder[j]++;
        out.bellsHist[Math.min(5, r.bells)]++;
        if (r.phones > 0 && !r.phoneFired) out.phoneLandedDead++;
        if (ev.tease) teases.push(i);
        if (ev.bonus) { bonuses.push(i); out.bonusN++; out.bonusSum += r.bonus; const bx = r.bonus / 10; for (let j = 0; j < BONUS_EDGES.length; j++) if (bx < BONUS_EDGES[j]) out.bonusEdge[j]++; const lb = Math.min(LOGBINS * LOGMAX, Math.floor(Math.log10(Math.max(1, r.bonus)) * LOGBINS)); out.bonusLog[lb]++; }
      }
      // tease -> bonus within the next 1 / 10 / 50 spins
      let bj = 0;
      for (const t of teases) {
        while (bj < bonuses.length && bonuses[bj] <= t) bj++;
        out.teaseN++;
        if (bj < bonuses.length) { const d = bonuses[bj] - t; if (d <= 1) out.teaseThenBonus1++; if (d <= 10) out.teaseThenBonus10++; if (d <= 50) out.teaseThenBonus50++; }
      }
    }
    parentPort.postMessage(out);
  } else {
    // sessions: flat 1x bet, bankroll bankX bets, stop at bust (balance < 1 bet) or cap spins
    const out = { n: 0, hist: new Array(cap + 2).fill(0), capped: 0, sawBonus: 0, saw5: 0, saw20: 0, saw100: 0, sawDouble: 0, endAboveStart: 0, peakSum: 0, peakHist: new Array(41).fill(0), firstBonusSum: 0, firstBonusN: 0, spinsSum: 0, wonBackAfterDown50: 0, down50: 0,
      bonusPerSession: 0 };
    const bank0 = bankX * 10;
    for (const k of chunks) {
      const rng = Eng.rngFrom(seedOf(baseSeed, k)), hot = new Uint8Array(NS);
      for (let s = 0; s < sessions; s++) {
        let bal = bank0, spins = 0, peak = bal, sawB = false, saw5 = false, saw20 = false, saw100 = false, fb = 0, dipped = false, back = false;
        while (bal >= 10 && spins < cap) {
          const r = oneRound(rng, hot); spins++; bal += r.win - 10;
          if (r.kind) { out.bonusPerSession++; if (!sawB) { sawB = true; fb = spins; } }
          if (r.win >= 50) saw5 = true; if (r.win >= 200) saw20 = true; if (r.win >= 1000) saw100 = true;
          if (bal > peak) peak = bal;
          if (bal <= bank0 / 2) dipped = true; else if (dipped && bal >= bank0) back = true;
        }
        out.n++; out.hist[spins]++; out.spinsSum += spins; if (spins >= cap) out.capped++;
        if (sawB) { out.sawBonus++; out.firstBonusSum += fb; out.firstBonusN++; } if (saw5) out.saw5++; if (saw20) out.saw20++; if (saw100) out.saw100++;
        if (peak >= 2 * bank0) out.sawDouble++; if (bal > bank0) out.endAboveStart++;
        out.peakSum += peak; out.peakHist[Math.min(40, Math.floor(peak / bank0 * 4))]++;
        if (dipped) { out.down50++; if (back) out.wonBackAfterDown50++; }
      }
    }
    parentPort.postMessage(out);
  }
} else {
  try { os.setPriority(10); } catch {}
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
  const bool = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const cfgArg = flag('--cfg'), thrArg = flag('--threads'), outFile = flag('--out'), capArg = flag('--cap');
  const streamMode = bool('--stream'), sessMode = bool('--sessions'), checkMode = bool('--check');
  const nums = argv.filter((a) => !a.startsWith('--')).map(Number);
  const cfgText = cfgArg && cfgArg !== true ? (cfgArg[0] === '@' ? fs.readFileSync(cfgArg.slice(1), 'utf8') : cfgArg) : '{}';
  const cfg = merged(Eng.CFG, JSON.parse(cfgText));
  const threads = Math.min(MAX_THREADS, Math.max(1, +thrArg || MAX_THREADS));
  const mode = checkMode ? 'check' : streamMode ? 'stream' : sessMode ? 'sessions' : null;
  if (!mode) { console.error('give --stream, --sessions or --check'); process.exit(2); }
  let N, seed, bankX = 100, perChunkSessions = 0, nChunks, size;
  if (mode === 'stream') { N = nums[0] || 1e9; seed = nums[1] || 1; size = CHUNK; nChunks = Math.ceil(N / size); }
  else if (mode === 'check') { N = 200000; seed = 5; size = 50000; nChunks = 4; }
  else { const S = nums[0] || 300000; bankX = nums[1] || 100; seed = nums[2] || 1; nChunks = 200; perChunkSessions = Math.ceil(S / nChunks); size = 0; }
  const cap = +capArg || 20000;
  const per = Array.from({ length: threads }, () => []);
  for (let k = 0; k < nChunks; k++) per[k % threads].push(k);
  const t0 = Date.now();
  Promise.all(per.filter((c) => c.length).map((chunks) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { cfg, mode, chunks, size, baseSeed: seed, sessions: perChunkSessions, bankX, cap } });
    w.once('message', res); w.once('error', rej);
  }))).then((parts) => {
    const secs = (Date.now() - t0) / 1000, f = (x, d = 2) => x.toFixed(d);
    const sum = (key) => parts.reduce((a, p) => a + p[key], 0);
    const sumA = (key) => parts[0][key].map((_, i) => parts.reduce((a, p) => a + p[key][i], 0));
    // quantile of a histogram (index = value), q in 0..1; overflow bin is reported as '>limit'
    const qh = (h, q) => { const tot = h.reduce((a, b) => a + b, 0); let c = 0; for (let i = 0; i < h.length; i++) { c += h[i]; if (c >= q * tot) return i; } return h.length - 1; };
    let o;
    if (mode === 'check') { o = { mode, n: sum('n'), mismatches: sum('bad'), secs }; }
    else if (mode === 'stream') {
      const n = sum('n'), gaps = {};
      for (const e of EVENTS) {
        const h = parts.reduce((a, p) => a.map((x, i) => x + p.gaps[e][i]), new Array(GAPMAX + 2).fill(0));
        const cnt = h.reduce((a, b) => a + b, 0); let mean = 0; for (let i = 0; i < h.length; i++) mean += i * h[i]; mean /= cnt;
        let mx = 0; for (let i = h.length - 1; i >= 0; i--) if (h[i]) { mx = i; break; }
        // share of windows of w spins with NO such event (stationary: sum_{g>w} (g-w) P(g) / mean)
        const wins = [5, 25, 100, 400].map((w) => { let s = 0; for (let g = w + 1; g < h.length; g++) s += (g - w) * h[g]; return s / cnt / mean; });
        gaps[e] = { gaps: cnt, mean, p50: qh(h, 0.5), p90: qh(h, 0.9), p99: qh(h, 0.99), p999: qh(h, 0.999), max: mx >= GAPMAX + 1 ? '>' + GAPMAX : mx, noEventInWindow: { 5: wins[0], 25: wins[1], 100: wins[2], 400: wins[3] } };
      }
      const bl = sumA('bonusLog'), bn = sum('bonusN'), bq = (q) => { let c = 0; for (let i = 0; i < bl.length; i++) { c += bl[i]; if (c >= q * bn) return Math.pow(10, (i + 0.5) / LOGBINS) / 10; } return 0; };
      const ladder = sumA('ladder'), be = sumA('bonusEdge');
      o = { mode, spins: n, seed, secs,
        rtpPct: sum('sumWin') / n / 10 * 100,
        hitPct: sum('hits') / n * 100, under1Pct: sum('under1') / n * 100 - (n - sum('hits')) / n * 100, exact1Pct: sum('exact1') / n * 100,
        bellsHist: sumA('bellsHist').map((c) => c / n),
        teasePct: sum('teaseN') / n * 100, teaseOneIn: n / sum('teaseN'),
        teaseThenBonusNext1Pct: sum('teaseThenBonus1') / sum('teaseN') * 100, teaseThenBonusNext10Pct: sum('teaseThenBonus10') / sum('teaseN') * 100, teaseThenBonusNext50Pct: sum('teaseThenBonus50') / sum('teaseN') * 100,
        phoneLandedDeadPct: sum('phoneLandedDead') / n * 100,
        gaps,
        ladder: LADDER.map((x, i) => ({ x, pctSpins: ladder[i] / n * 100, oneIn: ladder[i] ? n / ladder[i] : null, pIn200: ladder[i] ? 1 - Math.pow(1 - ladder[i] / n, 200) : 0, pIn1000: ladder[i] ? 1 - Math.pow(1 - ladder[i] / n, 1000) : 0 })),
        bonus: { n: bn, avgX: sum('bonusSum') / bn / 10, pBelow: BONUS_EDGES.map((x, i) => ({ x, pct: be[i] / bn * 100 })), p10: bq(0.1), p25: bq(0.25), p50: bq(0.5), p75: bq(0.75), p90: bq(0.9), p99: bq(0.99) } };
    } else {
      const n = sum('n'), h = sumA('hist'), capped = sum('capped');
      const q = (qq) => qh(h, qq);
      const peak = sumA('peakHist');
      o = { mode, sessions: n, bankX, cap, seed, secs, cappedPct: capped / n * 100, spinsMean: sum('spinsSum') / n, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p99: q(0.99),
        sawBonusPct: sum('sawBonus') / n * 100, saw5Pct: sum('saw5') / n * 100, saw20Pct: sum('saw20') / n * 100, saw100Pct: sum('saw100') / n * 100, doublePct: sum('sawDouble') / n * 100, endAbovePct: sum('endAboveStart') / n * 100,
        firstBonusMeanSpins: sum('firstBonusN') ? sum('firstBonusSum') / sum('firstBonusN') : null, peakMeanX: sum('peakSum') / n / 10 / bankX,
        wonBackAfterDown50Pct: sum('down50') ? sum('wonBackAfterDown50') / sum('down50') * 100 : null, bonusesPerSession: sum('bonusPerSession') / n };
      // cap-adjusted: spinsMean is a lower bound when sessions hit the cap
      o.spinsHist = h.slice(0, 0);
    }
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
    console.log(JSON.stringify(o, null, 1));
  }).catch((e) => { console.error(e); process.exit(1); });
}
