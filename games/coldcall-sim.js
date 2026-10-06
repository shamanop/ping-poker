'use strict';
// COLD CALL v2 simulator, on worker threads (at most 6; the box is shared: start it with `nice -n 10`).
//   nice -n 10 node games/coldcall-sim.js [spins=100000000] [seed=1]          plain full rounds: RTP by part, hit rate, bonus rates, tails, cap hits
//   nice -n 10 node games/coldcall-sim.js --strat [baseSpins=100000000] [bonusRunsPerKind=20000000] [seed=1]
//        stratified RTP: RTP = E[base cluster + base phone] + sum_k P(bell trigger k) * E[bonus k]; each bonus is sampled directly,
//        so the heavy tail of the bonuses no longer dominates the interval (same idea as games/bender-rtp.js)
//   nice -n 10 node games/coldcall-sim.js --buys [runsPerBuy=5000000] [seed=1] [--only call,hunt]  average value and RTP of every buy at its configured price
//   nice -n 10 node games/coldcall-sim.js --pull [sessions=20000] [spinsPerSession=2000] [seed=1] [--pickpolicy first|best|none] [--more bank|take] [--bet 100] [--nowarmdiff]
//        THE PULL (cold-call/PULL-ENGINE.md section 5): sequential flat-bet sessions with state (no idle time): RTP by part per paid spin, spins per Callback, warm, ghost, value per lead, pot
//   nice -n 10 node games/coldcall-sim.js --bonus [runs=2000000] [seed=1] [--bet 100]     per bonus kind x pick policy x (bank|take): average value, P(cap), tails
//   add --cfg '{"extra":{"base":{"phone":0.6}}}' (or --cfg @file.json) to override levers (objects merge, arrays and numbers replace); --json for one JSON line; --out file.json also writes the JSON.
// Seeds are stratified: the run is cut into 1M-spin chunks, each chunk has its own seed (splitmix of base seed + chunk index) and its
// own 128-bit rng stream, so chunks are independent and the result does not depend on how many threads ran it.
const os = require('os');
const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const Eng = require('./coldcall-engine.js');

const MAX_THREADS = +process.env.CC_MAX_THREADS || 6, CHUNK = 1000000;   // CC_MAX_THREADS raises the ceiling on a bigger machine (default 6)
// round win / bet bands (plain mode); lower edge inclusive; edges in tenths of the bet. band 0 = no win
const BAND_EDGES = [1, 10, 20, 50, 200, 1000, 10000], BAND_NAMES = ['0', '<1', '1-2', '2-5', '5-20', '20-100', '100-1000', '1000+'];
const bandOf = (w) => { if (w <= 0) return 0; let b = 1; while (b < BAND_EDGES.length && w >= BAND_EDGES[b]) b++; return b; };
const seedOf = (base, k) => { let z = (base + Math.imul(k + 1, 0x9E3779B9)) | 0; z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B); z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35); return (z ^ (z >>> 16)) >>> 0; };
const mk = () => ({ n: 0, sum: 0, sq: 0 });
const add = (a, x) => { a.n++; a.sum += x; a.sq += x * x; };
const merged = (a, b) => { const o = Array.isArray(a) ? a.slice() : Object.assign({}, a); for (const k of Object.keys(b)) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' ? merged(o[k], b[k]) : b[k]; return o; };
const KINDS = [1, 2, 3];

if (!isMainThread) {
  const { cfg, mode, chunks, size, baseSeed, bonusRuns, only } = workerData;
  const eng = Eng.createEngine(cfg);
  const capT = cfg.maxWinTenths;
  if (mode === 'pull' || mode === 'bonus') {
    const nb4 = (p, set) => { const r = (p / 6) | 0, c = p % 6; let n = 0; if (r > 0 && set.has(p - 6)) n++; if (c > 0 && set.has(p - 1)) n++; if (c < 5 && set.has(p + 1)) n++; if (r < 4 && set.has(p + 6)) n++; return n; };
    // 'best' pick: the hot square with the most hot neighbours (an upsell on it reaches the most leads); ties go to reading order
    const bestPick = (choices) => { const set = new Set(choices); let b = choices[0], bn = -1; for (const p of choices) { const n = nb4(p, set); if (n > bn) { bn = n; b = p; } } return b; };
    const mkDecide = (pickpolicy, more) => (pt) => (pt.k === 'more' ? (more === 'take' ? { k: 'more', take: true } : null) : pickpolicy === 'best' ? { k: 'pick', p: bestPick(pt.choices) } : null);
    const withPick = (c, pickpolicy) => (pickpolicy === 'none' ? merged(c, { pull: { pick: { on: false } } }) : c);
    if (mode === 'bonus') {
      const { kinds, combos } = workerData.bonusOpts, bet = workerData.bet, out = {};
      for (const kind of kinds) for (const cb of combos) {
        const key = kind + '|' + cb.pick + '|' + cb.more, e = Eng.createEngine(withPick(cfg, cb.pick)), decide = mkDecide(cb.pick, cb.more);
        const a = { n: 0, sum: 0, sq: 0, cap: 0, ge100: 0, ge1000: 0, offers: 0, takes: 0, wins: 0, picks: 0 };
        for (const k of chunks) {
          const rng = Eng.rngFrom(seedOf(baseSeed + kind * 977, k));         // same stream for every policy of a kind: common random numbers
          for (let i = 0; i < size; i++) {
            const r = e.playRound(rng, { buy: 'bonus' + kind, bet, state: null, script: false, auto: true, decide }, []);
            const w = r.winTenths; a.n++; a.sum += w; a.sq += w * w; if (w >= capT) a.cap++; if (w >= 1000) a.ge100++; if (w >= 10000) a.ge1000++;
            if (r.pull.pick) a.picks++; if (r.pull.more) { a.offers++; if (r.pull.more.take) { a.takes++; if (r.pull.more.won) a.wins++; } }
          }
        }
        out[key] = a;
      }
      return parentPort.postMessage(out);
    }
    // ---- pull: sessions of flat-bet sequential play with state
    const o = workerData.pullOpts, bet = workerData.bet, P = cfg.pull, DAY = '2026-10-06';
    const HIST = 3000;
    const runChunk = (c, seed) => {
      const e = Eng.createEngine(withPick(c, o.pickpolicy)), decide = mkDecide(o.pickpolicy, o.more), Pc = c.pull;
      const rng = Eng.rngFrom(seed), potRng = Eng.rngFrom((seed ^ 0xA5A5A5A5) >>> 0), pot = { bal: Pc.pot.seed, rem: 0, fed: 0, paid: 0, hits: 0, balAtHit: 0 };
      const a = { sess: 0, paid: 0, cbRounds: 0, cluster: 0, phone: 0, nat: 0, cb: 0, moreNet: 0, natBonuses: 0, dead: 0, win: 0, filled: 0, arms: 0, armHist: new Array(HIST + 1).fill(0), marked: 0, warmCreated: 0, warmSpins: 0, warmPhone: 0, warmPhonePay: 0,
        ghost: { n: 0, sum: 0, nz: 0, ge10: 0, ge100: 0, max: 0 }, picks: 0, offers: 0, takes: 0, takeWins: 0, stakeCents: 0, capHits: 0, sq: 0 };
      for (let s = 0; s < o.sessions; s++) {
        let st = Eng.newState(), paid = 0, since = 0, t = 1e9;
        while (paid < o.spins) {
          const r = e.playRound(rng, { bet, state: st, now: t, day: DAY, script: false, auto: true, decide }, []);
          t += 1000; st = r.newState; const R = r.round, pl = r.pull;
          if (R.bonusRawTenths !== undefined) a.moreNet += R.bonusTenths - R.bonusRawTenths;
          if (r.winTenths >= capT) a.capHits++;
          if (pl.pick) a.picks++; if (pl.more) { a.offers++; if (pl.more.take) { a.takes++; if (pl.more.won) a.takeWins++; } }
          if (r.callback) { a.cbRounds++; a.cb += R.bonusRawTenths; continue; }
          paid++; since++; a.paid++; a.stakeCents += bet;
          a.cluster += R.clusterTenths; a.phone += R.phoneTenths; if (R.bonusKind) { a.nat += R.bonusRawTenths; a.natBonuses++; }
          if (R.clusterTenths + R.phoneTenths === 0 && !R.bonusKind) a.dead++; else if (R.clusterTenths + R.phoneTenths > 0) a.win++;
          a.filled += pl.filled + (pl.daily ? Math.round(pl.daily.leads * 10) : 0);
          if (pl.armed) { a.arms++; a.armHist[Math.min(since, HIST)]++; since = 0; }
          if (R.marked > 0 && R.phones === 0) a.marked++;
          a.warmCreated += pl.warmOut.length; if (pl.warmIn.length) { a.warmSpins++; if (R.phoneFired) { a.warmPhone++; a.warmPhonePay += R.phoneTenths; } }
          if (pl.ghost) { const g = a.ghost, w = pl.ghost.pay; g.n++; g.sum += w; if (w > 0) g.nz++; if (w >= 10) g.ge10++; if (w >= 100) g.ge100++; if (w > g.max) g.max = w; }
          // the office pot, the way the server runs it (one shared pot per chunk: every session feeds it)
          const sl = Eng.potSlice(Pc.pot.feedBps, bet, pot.rem); pot.rem = sl.rem; pot.bal += sl.slice; pot.fed += sl.slice;
          if (potRng() < Eng.potHitChance(Pc, bet) && pot.bal >= Pc.pot.minBal) { const prize = Math.min(pot.bal, Pc.pot.maxPayX * bet); pot.paid += prize; pot.hits++; pot.balAtHit += pot.bal; pot.bal = Pc.pot.seed - 0 > 0 ? Pc.pot.seed : 0; }
        }
        a.sess++;
      }
      a.pot = pot; return a;
    };
    const res = [];
    for (const k of chunks) {
      const sd = seedOf(baseSeed, k), on = runChunk(cfg, sd);
      res.push({ k, on, off: o.warmdiff ? runChunk(merged(cfg, { pull: { warm: { chance: 0 } } }), sd) : null });
    }
    return parentPort.postMessage(res);
  }
  if (mode === 'buys') {
    const out = {}; for (const b of only) out[b] = { w: mk(), bonus: 0, bonusAny: mk(), capHits: 0, nb: 0 };
    for (const k of chunks) {
      const rng = Eng.rngFrom(seedOf(baseSeed, k));
      for (const b of Object.keys(out)) for (let i = 0; i < size; i++) {
        const r = eng.round(rng, b); add(out[b].w, r.winTenths); if (r.bonusKind) out[b].nb++; if (r.winTenths >= capT) out[b].capHits++;
      }
    }
    parentPort.postMessage(out);
  } else if (mode === 'strat') {
    const out = { a: mk(), n: 0, nk: [0, 0, 0, 0], ak: [0, 0, 0, 0], cl: 0, ph: 0, bonus: {}, nUp: 0, capBase: 0, over1000Base: 0 };
    for (const k of chunks) {
      const rng = Eng.rngFrom(seedOf(baseSeed, k));
      for (let i = 0; i < size; i++) {
        const sp = eng.playSpin(rng, 0, new Uint8Array(30), false, { capLeft: capT });
        const a = sp.win; add(out.a, a); out.cl += sp.cluster; out.ph += sp.phone; if (sp.capped) out.capBase++; if (a >= 10000) out.over1000Base++;
        const kind = sp.capped || sp.bells < 3 ? 0 : sp.bells >= 5 ? 3 : sp.bells === 4 ? 2 : 1;
        out.nk[kind]++; out.ak[kind] += a;
      }
      for (const kind of KINDS) {
        const o = out.bonus[kind] || (out.bonus[kind] = { t: mk(), cl: 0, ph: 0, spins: 0, casc: 0, fired: 0, closes: 0, up: 0, capHits: 0, over100: 0, over1000: 0, over5000: 0 });
        for (let i = 0; i < bonusRuns[kind]; i++) {
          const b = eng.playBonus(rng, kind, false, capT, null);
          add(o.t, b.total); o.cl += b.cluster; o.ph += b.phone; o.spins += b.spins; o.casc += b.cascades; o.fired += b.fired; o.closes += b.closes; if (b.upgraded) o.up++;
          if (b.total >= capT) o.capHits++; if (b.total >= 1000) o.over100++; if (b.total >= 10000) o.over1000++; if (b.total >= 50000) o.over5000++;
        }
      }
    }
    parentPort.postMessage(out);
  } else {
    const out = { total: mk(), cluster: mk(), phone: mk(), bonus: [mk(), mk(), mk(), mk()], nBonus: [0, 0, 0, 0], upg: 0, hitAny: 0, hitBase: 0, hitBaseAny: 0, baseBandN: new Array(8).fill(0), baseBandSum: new Array(8).fill(0), bandN: new Array(8).fill(0), bandSum: new Array(8).fill(0), maxT: 0, capHits: 0, exact1: 0,
      capByKind: [0, 0, 0, 0], baseWinSpins: 0, baseCascades: 0, phoneBase: 0, phoneBaseLeads: 0, phoneBaseCloses: 0, over100: 0, over1000: 0, over5000: 0, bells2: 0, bonusSpins: 0, bonusCascades: 0 };
    for (const k of chunks) {
      const rng = Eng.rngFrom(seedOf(baseSeed, k));
      for (let i = 0; i < size; i++) {
        const r = eng.round(rng, null);
        const w = r.winTenths;
        add(out.total, w); add(out.cluster, r.clusterTenths); add(out.phone, r.phoneTenths);
        if (r.bonusKind) { add(out.bonus[r.bonusKind], r.bonusTenths); out.nBonus[r.bonusKind]++; if (r.upgraded) out.upg++; out.bonusSpins += r.bonusSpins; out.bonusCascades += r.cascades - r.baseCascades; }
        if (w > 0) out.hitAny++;
        if (w === 10) out.exact1++;
        if (r.clusterTenths + r.phoneTenths > 0) out.hitBaseAny++;
        { const bd = bandOf(w); out.bandN[bd]++; out.bandSum[bd] += w; const bw = r.clusterTenths + r.phoneTenths, bb = bandOf(bw); out.baseBandN[bb]++; out.baseBandSum[bb] += bw; }
        if (r.clusterTenths > 0) { out.hitBase++; out.baseWinSpins++; out.baseCascades += r.baseCascades; }
        if (r.phoneFired) { out.phoneBase++; out.phoneBaseLeads += r.leads; out.phoneBaseCloses += r.closes; }
        if (r.bells === 2) out.bells2++;
        if (w > out.maxT) out.maxT = w;
        if (w >= capT) { out.capHits++; out.capByKind[r.bonusKind]++; }
        if (w >= 1000) out.over100++; if (w >= 10000) out.over1000++; if (w >= 50000) out.over5000++;
      }
    }
    parentPort.postMessage(out);
  }
} else {
  try { os.setPriority(10); } catch {}
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
  const bool = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const cfgArg = flag('--cfg'), buysMode = bool('--buys'), stratMode = bool('--strat'), asJson = bool('--json'), thrArg = flag('--threads'), outFile = flag('--out'), onlyArg = flag('--only');
  const pullMode = bool('--pull'), bonusMode = bool('--bonus'), noWarmDiff = bool('--nowarmdiff'), pickArg = flag('--pickpolicy'), moreArg = flag('--more'), betArg = flag('--bet');
  const ONLY = onlyArg && onlyArg !== true ? onlyArg.split(',') : ['call', 'bonus1', 'bonus2', 'hunt'];
  const nums = argv.filter((a) => !a.startsWith('--')).map(Number);
  const cfgText = cfgArg && cfgArg !== true ? (cfgArg[0] === '@' ? fs.readFileSync(cfgArg.slice(1), 'utf8') : cfgArg) : '{}';   // --cfg '@file.json' reads the override from a file
  const cfg = merged(Eng.CFG, JSON.parse(cfgText));
  const threads = Math.min(MAX_THREADS, Math.max(1, +thrArg || MAX_THREADS));

  if (pullMode || bonusMode) {
    const bet = +betArg || 100, f = (x, d = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(d)), t0 = Date.now();
    const pickpolicy = pickArg && pickArg !== true ? pickArg : 'first', more = moreArg && moreArg !== true ? moreArg : 'bank';
    if (!['first', 'best', 'none'].includes(pickpolicy) || !['bank', 'take'].includes(more)) { console.error('--pickpolicy first|best|none, --more bank|take'); process.exit(1); }
    const spawn = (per, data) => Promise.all(per.filter((c) => c.length).map((chunks) => new Promise((res, rej) => { const w = new Worker(__filename, { workerData: { cfg, chunks, bet, ...data } }); w.once('message', res); w.once('error', rej); })));
    const meanSe = (arr) => { const n = arr.length, m = arr.reduce((a, b) => a + b, 0) / n, v = n > 1 ? arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1) : 0; return { mean: m, se: Math.sqrt(v / n) }; };
    if (bonusMode) {
      const runs = nums[0] || 2000000, seedB = nums[1] || 1, size = Math.min(CHUNK, runs), nChunks = Math.ceil(runs / size), totalRuns = nChunks * size;
      const combos = []; for (const pk of ['first', 'best', 'none']) for (const mo of ['bank', 'take']) combos.push({ pick: pk, more: mo });
      const per = Array.from({ length: threads }, () => []); for (let k = 0; k < nChunks; k++) per[k % threads].push(k);
      spawn(per, { mode: 'bonus', size, baseSeed: seedB, bonusOpts: { kinds: [1, 2], combos } }).then((parts) => {
        const o = { mode: 'bonus', runsPerCombo: totalRuns, seed: seedB, bet, secs: (Date.now() - t0) / 1000, kinds: {} };
        for (const kind of [1, 2]) {
          o.kinds['bonus' + kind] = combos.map((cb) => {
            const key = kind + '|' + cb.pick + '|' + cb.more, a = parts.reduce((x, p) => { const q = p[key]; if (!q) return x; for (const k of Object.keys(q)) x[k] += q[k]; return x; }, { n: 0, sum: 0, sq: 0, cap: 0, ge100: 0, ge1000: 0, offers: 0, takes: 0, wins: 0, picks: 0 });
            const m = a.sum / a.n, sd = Math.sqrt(Math.max(0, a.sq / a.n - m * m));
            return { pick: cb.pick, more: cb.more, avgX: m / 10, ci: 1.96 * sd / Math.sqrt(a.n) / 10, sdX: sd / 10, pCap: a.cap / a.n, capOneIn: a.cap ? a.n / a.cap : null, ge100: a.ge100 / a.n, ge1000: a.ge1000 / a.n, offerRate: a.offers / a.n, takeWinRate: a.takes ? a.wins / a.takes : null, pickRate: a.picks / a.n };
          });
        }
        if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
        if (asJson) return console.log(JSON.stringify(o));
        console.log(`COLD CALL --bonus: ${totalRuns} bought bonuses per kind and policy (common random numbers across policies), seed ${seedB}, bet ${bet}c, ${f(o.secs, 1)}s`);
        for (const key of Object.keys(o.kinds)) {
          console.log(`  ${key}: pick policy / gamble -> average value (95% CI), sd, P(cap), P(>=100x), P(>=1000x), offers per bonus, gamble win rate`);
          for (const r of o.kinds[key]) console.log(`    ${r.pick.padEnd(5)} ${r.more.padEnd(4)}  avg ${f(r.avgX, 3)}x (+-${f(r.ci, 3)})  sd ${f(r.sdX, 1)}x  cap ${r.capOneIn ? '1 in ' + f(r.capOneIn, 0) : 'none'}  >=100x ${f(r.ge100 * 100, 2)}%  >=1000x ${f(r.ge1000 * 100, 3)}%  offers ${f(r.offerRate, 3)}  take wins ${r.takeWinRate === null ? 'n/a' : f(r.takeWinRate * 100, 2) + '%'}`);
        }
      }).catch((e) => { console.error(e); process.exit(1); });
      return;
    }
    const sessions = nums[0] || 20000, spins = nums[1] || 2000, seedP = nums[2] || 1;
    const perChunk = Math.max(1, Math.min(Math.ceil(CHUNK / spins), Math.ceil(sessions / 20))), nChunks = Math.ceil(sessions / perChunk), totalSessions = nChunks * perChunk;
    const per = Array.from({ length: threads }, () => []); for (let k = 0; k < nChunks; k++) per[k % threads].push(k);
    spawn(per, { mode: 'pull', size: 0, baseSeed: seedP, pullOpts: { sessions: perChunk, spins, pickpolicy, more, warmdiff: !noWarmDiff } }).then((parts) => {
      const chunks = parts.flat().sort((a, b) => a.k - b.k), P = cfg.pull;
      const sum = (key, which = 'on') => chunks.reduce((a, c) => a + c[which][key], 0);
      const paid = sum('paid');
      const pctOf = (c, key) => c[key] / (c.paid * 10) * 100;                      // percent of stake: tenths of the bet over 10 tenths per paid spin
      const partVec = { cluster: [], basePhone: [], natBonus: [], callbackBonus: [], moreNet: [], pot: [], total: [] };
      const rtpOf = (c) => pctOf(c, 'cluster') + pctOf(c, 'phone') + pctOf(c, 'nat') + pctOf(c, 'cb') + pctOf(c, 'moreNet') + P.pot.feedBps / 100;
      for (const { on: c } of chunks) {
        partVec.cluster.push(pctOf(c, 'cluster')); partVec.basePhone.push(pctOf(c, 'phone')); partVec.natBonus.push(pctOf(c, 'nat')); partVec.callbackBonus.push(pctOf(c, 'cb')); partVec.moreNet.push(pctOf(c, 'moreNet')); partVec.pot.push(P.pot.feedBps / 100); partVec.total.push(rtpOf(c));
      }
      const parts_ = {}; for (const k of Object.keys(partVec)) { const m = meanSe(partVec[k]); parts_[k] = { pct: m.mean, ci: 1.96 * m.se }; }
      const hist = new Array(3001).fill(0); for (const c of chunks) c.on.armHist.forEach((v, i) => { hist[i] += v; });
      const arms = hist.reduce((a, b) => a + b, 0), q = (p) => { let acc = 0; for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= p * arms) return i; } return hist.length - 1; };
      const meanSpinsPerCb = arms ? hist.reduce((a, v, i) => a + v * i, 0) / arms : null;
      const leads = sum('filled') / 10, cbBonus = sum('cb'), cbRounds = sum('cbRounds');
      const g = { n: 0, sum: 0, nz: 0, ge10: 0, ge100: 0, max: 0 }; for (const c of chunks) { const x = c.on.ghost; g.n += x.n; g.sum += x.sum; g.nz += x.nz; g.ge10 += x.ge10; g.ge100 += x.ge100; g.max = Math.max(g.max, x.max); }
      const potHits = chunks.reduce((a, c) => a + c.on.pot.hits, 0), potBal = chunks.reduce((a, c) => a + c.on.pot.balAtHit, 0), potPaid = chunks.reduce((a, c) => a + c.on.pot.paid, 0), potFed = chunks.reduce((a, c) => a + c.on.pot.fed, 0);
      let warmDiff = null;
      if (!noWarmDiff) { const d = chunks.map((c) => rtpOf(c.on) - rtpOf(c.off)), m = meanSe(d); const dp = meanSe(chunks.map((c) => pctOf(c.on, 'phone') - pctOf(c.off, 'phone'))), dl = meanSe(chunks.map((c) => c.on.filled / c.on.paid - c.off.filled / c.off.paid)); warmDiff = { onPct: parts_.total.pct, offPct: meanSe(chunks.map((c) => rtpOf(c.off))).mean, diffPct: m.mean, ci: 1.96 * m.se, basePhoneDiffPct: dp.mean, basePhoneCi: 1.96 * dp.se, leadsPerSpinDiff: dl.mean }; }
      const o = { mode: 'pull', sessions: totalSessions, spinsPerSession: spins, paidSpins: paid, seed: seedP, bet, pickpolicy, more, secs: (Date.now() - t0) / 1000, batches: chunks.length,
        parts: parts_, rtpPct: parts_.total.pct, rtpCi: parts_.total.ci,
        callback: { arms, perHundredSpins: arms / paid * 100, spinsPer: { mean: meanSpinsPerCb, p10: q(0.1), median: q(0.5), p90: q(0.9) }, rounds: cbRounds, avgBonusX: cbRounds ? cbBonus / cbRounds / 10 : null },
        deadShare: sum('dead') / paid, winShare: sum('win') / paid, bonusOneIn: sum('natBonuses') ? paid / sum('natBonuses') : null, capHits: sum('capHits'),
        warm: { markedNoPhonePer100: sum('marked') / paid * 100, createdPerSpin: sum('warmCreated') / paid, spinsWithWarmPer100: sum('warmSpins') / paid * 100, phoneOnWarmPer100: sum('warmPhone') / paid * 100, avgPhonePayOnWarmX: sum('warmPhone') ? sum('warmPhonePay') / sum('warmPhone') / 10 : null, diff: warmDiff },
        ghost: { per100: g.n / paid * 100, avgPayX: g.n ? g.sum / g.n / 10 : null, shareNonZero: g.n ? g.nz / g.n : null, shareGe1x: g.n ? g.ge10 / g.n : null, shareGe10x: g.n ? g.ge100 / g.n : null, maxX: g.max / 10 },
        leads: { filledTotal: leads, perPaidSpin: leads / paid, callbackValuePerLeadX: leads ? cbBonus / 10 / leads : null, callbackPartPct: parts_.callbackBonus.pct },
        decisions: { picksPer100: sum('picks') / paid * 100, offersPer100: sum('offers') / paid * 100, takesPer100: sum('takes') / paid * 100, takeWinRate: sum('takes') ? sum('takeWins') / sum('takes') : null },
        pot: { hitsPer1M: potHits / paid * 1e6, avgBalAtHitCents: potHits ? potBal / potHits : null, paidPctOfStake: potPaid / sum('stakeCents') * 100, fedPctOfStake: potFed / sum('stakeCents') * 100, note: 'one shared pot per batch; the RTP part uses feedBps/10000 (assumes the pot pays back what it takes)' } };
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      if (asJson) return console.log(JSON.stringify(o));
      console.log(`COLD CALL --pull: ${totalSessions} sessions x ${spins} paid spins = ${paid} paid spins, flat bet ${bet}c, pick ${pickpolicy}, gamble ${more}, seed ${seedP}, ${threads} threads, ${chunks.length} batches, ${f(o.secs, 1)}s`);
      console.log(`  total payback   ${f(o.rtpPct, 3)}% +- ${f(o.rtpCi, 3)} (95%, by batch means, per PAID spin; Callback rounds are free)`);
      const pp = o.parts; console.log(`  by part         base clusters ${f(pp.cluster.pct)}%  base phone ${f(pp.basePhone.pct)}%  natural bonus ${f(pp.natBonus.pct)}% (+-${f(pp.natBonus.ci, 3)})  Callback bonus ${f(pp.callbackBonus.pct)}% (+-${f(pp.callbackBonus.ci, 3)})  ONE MORE CALL net ${f(pp.moreNet.pct, 3)}% (+-${f(pp.moreNet.ci, 3)})  pot slice ${f(pp.pot.pct)}%`);
      console.log(`  Callback        ${f(o.callback.perHundredSpins, 3)} per 100 paid spins; spins per Callback mean ${f(o.callback.spinsPer.mean, 1)}  P10 ${o.callback.spinsPer.p10}  median ${o.callback.spinsPer.median}  P90 ${o.callback.spinsPer.p90}; avg Callback bonus ${f(o.callback.avgBonusX, 2)}x`);
      console.log(`  spins           dead ${f(o.deadShare * 100, 2)}%  paid base ${f(o.winShare * 100, 2)}%  natural bonus 1 in ${f(o.bonusOneIn, 0)}  cap hits ${o.capHits}  leads worked ${f(o.leads.perPaidSpin, 3)} per paid spin  value per lead ${f(o.leads.callbackValuePerLeadX, 4)}x bet (Callback part ${f(o.leads.callbackPartPct, 2)}% of stake)`);
      const w = o.warm; console.log(`  warm            marked-no-phone spins ${f(w.markedNoPhonePer100, 2)} per 100; warm squares created ${f(w.createdPerSpin, 3)} per spin; spins starting with warm ${f(w.spinsWithWarmPer100, 2)} per 100; phone features fired on warm squares ${f(w.phoneOnWarmPer100, 3)} per 100 (avg pay ${w.avgPhonePayOnWarmX === null ? 'n/a' : f(w.avgPhonePayOnWarmX, 2) + 'x'})`);
      if (w.diff) console.log(`  warm payback    with ${f(w.diff.onPct, 3)}%  without (chance 0) ${f(w.diff.offPct, 3)}%  -> total differs by ${f(w.diff.diffPct, 3)}% +- ${f(w.diff.ci, 3)} (95%, batches of the same seeds; noisy: Callback and bonus tails); base phone part alone ${f(w.diff.basePhoneDiffPct, 3)}% +- ${f(w.diff.basePhoneCi, 3)}; leads per spin ${f(w.diff.leadsPerSpinDiff, 4)} (warm hits turn dead spins into paid ones)`);
      const gh = o.ghost; console.log(`  ghost           ${f(gh.per100, 2)} per 100 spins; avg shown ${gh.avgPayX === null ? 'n/a' : f(gh.avgPayX, 2) + 'x'}; pay > 0 ${gh.shareNonZero === null ? 'n/a' : f(gh.shareNonZero * 100, 1) + '%'}; >= 1x ${gh.shareGe1x === null ? 'n/a' : f(gh.shareGe1x * 100, 1) + '%'}; >= 10x ${gh.shareGe10x === null ? 'n/a' : f(gh.shareGe10x * 100, 2) + '%'}; max ${f(gh.maxX, 1)}x`);
      const d = o.decisions; console.log(`  decisions       picks ${f(d.picksPer100, 3)} per 100 spins; ONE MORE CALL offered ${f(d.offersPer100, 3)} per 100, taken ${f(d.takesPer100, 3)} per 100${d.takeWinRate === null ? '' : ', win rate ' + f(d.takeWinRate * 100, 2) + '%'}`);
      console.log(`  pot             ${f(o.pot.hitsPer1M, 1)} hits per 1M spins; avg pot at hit ${o.pot.avgBalAtHitCents === null ? 'n/a' : f(o.pot.avgBalAtHitCents / 100, 2) + ' (bet units: ' + f(o.pot.avgBalAtHitCents / bet, 1) + 'x bet)'}; fed ${f(o.pot.fedPctOfStake, 3)}% of stake, paid out ${f(o.pot.paidPctOfStake, 3)}%`);
    }).catch((e) => { console.error(e); process.exit(1); });
    return;
  }
  const N = buysMode ? (nums[0] || 5000000) : (nums[0] || 100000000);
  const seed = (buysMode ? nums[1] : stratMode ? nums[2] : nums[1]) || 1;
  const bonusPerKind = stratMode ? (nums[1] || 20000000) : 0;
  const size = Math.min(CHUNK, N), nChunks = Math.ceil(N / size), total = nChunks * size;
  const per = Array.from({ length: threads }, () => []);
  for (let k = 0; k < nChunks; k++) per[k % threads].push(k);
  // bonus runs per chunk for strat (kind 3 is rare in play but its value is large, so it is sampled as often as the others)
  const bonusRuns = { 1: Math.ceil(bonusPerKind / nChunks), 2: Math.ceil(bonusPerKind / nChunks), 3: Math.ceil(bonusPerKind / nChunks) };
  const t0 = Date.now();
  const mode = buysMode ? 'buys' : stratMode ? 'strat' : 'spins';
  Promise.all(per.filter((c) => c.length).map((chunks) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { cfg, mode, chunks, size, baseSeed: seed, bonusRuns, only: ONLY } });
    w.once('message', res); w.once('error', rej);
  }))).then((parts) => {
    const secs = (Date.now() - t0) / 1000;
    const f = (x, d = 2) => x.toFixed(d);
    const sumP = (key) => parts.reduce((a, p) => a + p[key], 0);
    const sumArr = (key, i) => parts.reduce((a, p) => a + p[key][i], 0);
    const mergeAcc = (get) => parts.reduce((a, p) => { const o = get(p); a.n += o.n; a.sum += o.sum; a.sq += o.sq; return a; }, mk());
    const stat = (a) => { const m = a.sum / a.n, sd = Math.sqrt(Math.max(0, a.sq / a.n - m * m)); return { mean: m / 10, se: sd / Math.sqrt(a.n) / 10, sd: sd / 10 }; };

    if (buysMode) {
      const o = { mode, runsPerBuy: total, seed, secs, buys: {} };
      for (const b of ONLY) {
        const s = stat(mergeAcc((p) => p[b].w)), price = cfg.buyCost[b] / 10;
        const nb = parts.reduce((a, p) => a + p[b].nb, 0), caps = parts.reduce((a, p) => a + p[b].capHits, 0);
        o.buys[b] = { avgValueX: s.mean, ci: 1.96 * s.se, priceX: price, rtpPct: s.mean / price * 100, rtpCi: 1.96 * s.se / price * 100, suggestedPriceTenths: Math.round(s.mean / 0.98 * 10), bonusPct: nb / total * 100, capHits: caps, sdX: s.sd };
      }
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      if (asJson) return console.log(JSON.stringify(o));
      console.log(`buys, ${total} runs each, seed ${seed}, ${f(secs, 1)}s`);
      for (const b of Object.keys(o.buys)) { const x = o.buys[b]; console.log(`  ${b.padEnd(7)} avg value ${f(x.avgValueX, 3)}x (+-${f(x.ci, 3)})  price ${f(x.priceX, 1)}x  RTP ${f(x.rtpPct)}% (+-${f(x.rtpCi)})  suggested price (avg/0.98) ${f(x.suggestedPriceTenths / 10, 1)}x = ${x.suggestedPriceTenths} tenths  bonus on ${f(x.bonusPct, 2)}% of rounds  cap hits ${x.capHits}  sd ${f(x.sdX, 1)}x`); }
      return;
    }

    if (stratMode) {
      // Y_i = a_i + E_k (kind of spin i); mean(Y) estimates RTP, its variance includes the a/kind covariance; bonus means add their own variance.
      const nBase = sumP('n') || total;
      const E = {}, VAR = {}, bs = {};
      for (const kind of KINDS) {
        const acc = mergeAcc((p) => p.bonus[kind].t), s = stat(acc);
        E[kind] = s.mean * 10; VAR[kind] = s.se * s.se * 100;         // in tenths
        const g = (key) => parts.reduce((a, p) => a + p.bonus[kind][key], 0);
        bs[kind] = { avgX: s.mean, ci: 1.96 * s.se, runs: acc.n, cl: g('cl') / acc.n / 10, ph: g('ph') / acc.n / 10, spins: g('spins') / acc.n, casc: g('casc') / acc.n, fired: g('fired') / acc.n, closes: g('closes') / acc.n, up: g('up') / acc.n,
          capHits: g('capHits'), capOneIn: g('capHits') ? acc.n / g('capHits') : null, over100: g('over100') / acc.n, over1000: g('over1000') / acc.n, over5000: g('over5000') / acc.n };
      }
      const a = mergeAcc((p) => p.a), nk = [0, 1, 2, 3].map((k) => sumArr('nk', k)), ak = [0, 1, 2, 3].map((k) => sumArr('ak', k));
      const n = a.n;
      let ey = a.sum / n, ey2 = a.sq / n; const pk = nk.map((c) => c / n);
      for (const kind of KINDS) { ey += pk[kind] * E[kind]; ey2 += 2 * E[kind] * ak[kind] / n + E[kind] * E[kind] * pk[kind]; }
      let varY = (ey2 - ey * ey) / n; for (const kind of KINDS) varY += pk[kind] * pk[kind] * VAR[kind];
      const rtp = ey / 10, ci = 1.96 * Math.sqrt(varY) / 10;
      const clP = sumP('cl') / n / 10, phP = sumP('ph') / n / 10;
      const partB = {}, partBci = {};
      for (const kind of KINDS) { partB[kind] = pk[kind] * bs[kind].avgX; partBci[kind] = 1.96 * Math.sqrt(pk[kind] ** 2 * VAR[kind] / 100 + bs[kind].avgX ** 2 * pk[kind] * (1 - pk[kind]) / n); }
      const o = { mode, baseSpins: n, bonusRunsPerKind: bs[1].runs, seed, secs, rtpPct: rtp * 100, rtpCi: ci * 100, parts: { cluster: clP * 100, basePhone: phP * 100, bonus1: partB[1] * 100, bonus2: partB[2] * 100, bonus3: partB[3] * 100 },
        partsCi: { bonus1: partBci[1] * 100, bonus2: partBci[2] * 100, bonus3: partBci[3] * 100 }, oneIn: { bonus1: 1 / pk[1], bonus2: 1 / pk[2], bonus3: pk[3] ? 1 / pk[3] : null, any: 1 / (pk[1] + pk[2] + pk[3]) }, bonus: bs, capBase: sumP('capBase'), over1000Base: sumP('over1000Base') };
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      if (asJson) return console.log(JSON.stringify(o));
      console.log(`COLD CALL stratified RTP: ${n} base spins + ${bs[1].runs} runs of each bonus, seed ${seed}, ${f(secs, 1)}s`);
      console.log(`  total RTP   ${f(o.rtpPct, 3)}% +- ${f(o.rtpCi, 3)} (95%)`);
      console.log(`  by part     clusters ${f(o.parts.cluster)}%  base phone ${f(o.parts.basePhone)}%  bonus1 ${f(o.parts.bonus1)}% (+-${f(o.partsCi.bonus1, 3)})  bonus2 ${f(o.parts.bonus2)}% (+-${f(o.partsCi.bonus2, 3)})  bonus3 ${f(o.parts.bonus3)}% (+-${f(o.partsCi.bonus3, 3)})`);
      console.log(`  base spin alone (no bonus): >=1000x ${o.over1000Base} times, cap ${o.capBase} times in ${n} spins`);
      console.log(`  triggers    bonus1 1 in ${f(o.oneIn.bonus1, 0)}  bonus2 1 in ${f(o.oneIn.bonus2, 0)}  bonus3 ${o.oneIn.bonus3 ? '1 in ' + f(o.oneIn.bonus3, 0) : 'none seen'}  any 1 in ${f(o.oneIn.any, 1)}`);
      for (const kind of KINDS) { const b = bs[kind]; console.log(`  bonus${kind}      avg ${f(b.avgX, 2)}x (+-${f(b.ci, 2)}) [clusters ${f(b.cl, 1)}x, phone ${f(b.ph, 1)}x]  spins ${f(b.spins, 1)}  cascades ${f(b.casc, 1)}  phone fired ${f(b.fired, 1)}/bonus  closes ${f(b.closes, 2)}  ${kind === 1 ? 'upgraded ' + f(b.up * 100, 1) + '%  ' : ''}>=100x ${f(b.over100 * 100, 1)}%  >=1000x ${f(b.over1000 * 100, 2)}%  >=5000x ${f(b.over5000 * 100, 3)}%  cap hits ${b.capHits}${b.capOneIn ? ' (1 in ' + f(b.capOneIn, 0) + ' runs)' : ''}`); }
      return;
    }

    const tot = stat(mergeAcc((p) => p.total)), part = (k) => stat(mergeAcc((p) => p[k]));
    const bonusPart = (k) => stat(mergeAcc((p) => p.bonus[k]));
    const bonusMean = (k) => { const a = mergeAcc((p) => p.bonus[k]); return a.n ? a.sum / a.n / 10 : 0; };
    const nb = [0, 1, 2, 3].map((k) => sumArr('nBonus', k)), nAny = nb[1] + nb[2] + nb[3];
    // a part's contribution to RTP = its sum over ALL spins / total spins (spins without that part count as zero)
    const contrib = (a) => a.sum / total / 10 * 100;
    const o = {
      mode, spins: total, seed, secs, rtpPct: tot.mean * 100, rtpCi: tot.se * 196, sdX: tot.sd,
      hitAnyPct: sumP('hitAny') / total * 100, hitBasePct: sumP('hitBase') / total * 100, exact1Pct: sumP('exact1') / total * 100, exact1PctOfHits: sumP('exact1') / sumP('hitAny') * 100, under1PctOfHits: sumArr('bandN', 1) / sumP('hitAny') * 100, hitBaseAnyPct: sumP('hitBaseAny') / total * 100,
      baseBands: BAND_NAMES.map((name, i) => ({ band: name, pctSpins: sumArr('baseBandN', i) / total * 100, pctRtp: sumArr('baseBandSum', i) / total / 10 * 100 })),   // base spin only (cluster + phone pay, no bonus)
      bands: BAND_NAMES.map((name, i) => ({ band: name, pctSpins: sumArr('bandN', i) / total * 100, pctRtp: sumArr('bandSum', i) / total / 10 * 100, spins: sumArr('bandN', i) })),
      oneIn: { bonus1: nb[1] ? total / nb[1] : null, bonus2: nb[2] ? total / nb[2] : null, bonus3: nb[3] ? total / nb[3] : null, any: nAny ? total / nAny : null },
      avg: { bonus1: bonusMean(1), bonus2: bonusMean(2), bonus3: bonusMean(3), any: nAny ? (nb[1] * bonusMean(1) + nb[2] * bonusMean(2) + nb[3] * bonusMean(3)) / nAny : 0 }, bonusSharePct: (contrib(mergeAcc((p) => p.bonus[1])) + contrib(mergeAcc((p) => p.bonus[2])) + contrib(mergeAcc((p) => p.bonus[3]))) / (tot.mean * 100) * 100, upgradedOfBonus1: nb[1] ? sumP('upg') / nb[1] : 0,
      parts: { cluster: contrib(mergeAcc((p) => p.cluster)), basePhone: contrib(mergeAcc((p) => p.phone)), bonus1: contrib(mergeAcc((p) => p.bonus[1])), bonus2: contrib(mergeAcc((p) => p.bonus[2])), bonus3: contrib(mergeAcc((p) => p.bonus[3])) },
      phoneBase: { oneIn: sumP('phoneBase') ? total / sumP('phoneBase') : null, pctOfSpins: sumP('phoneBase') / total * 100, avgLeads: sumP('phoneBase') ? sumP('phoneBaseLeads') / sumP('phoneBase') : 0, avgCloses: sumP('phoneBase') ? sumP('phoneBaseCloses') / sumP('phoneBase') : 0 },
      avgCascadesPerWinningSpin: sumP('baseWinSpins') ? sumP('baseCascades') / sumP('baseWinSpins') : 0,
      avgBonusSpins: nAny ? sumP('bonusSpins') / nAny : 0,
      maxWinX: Math.max(...parts.map((p) => p.maxT)) / 10, capHits: sumP('capHits'), capOneIn: sumP('capHits') ? total / sumP('capHits') : null,
      tail: { ge100: sumP('over100') / total, ge1000: sumP('over1000') / total, ge5000: sumP('over5000') / total }, tailCounts: { ge100: sumP('over100'), ge1000: sumP('over1000'), ge5000: sumP('over5000') },
      capByKind: [0, 1, 2, 3].map((k) => sumArr('capByKind', k)),
      twoBells: sumP('bells2') / total,
    };
    if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
    if (asJson) return console.log(JSON.stringify(o));
    console.log(`COLD CALL sim (plain full rounds): ${total} spins, seed ${seed}, ${threads} threads, ${f(secs, 1)}s (${f(total / secs / 1e6, 2)}M spins/s)`);
    console.log(`  total RTP        ${f(o.rtpPct, 3)}% +- ${f(o.rtpCi, 3)} (95%, plain; use --strat for the tight figure)  sd of a round ${f(o.sdX, 2)}x bet`);
    console.log(`  hit rate         whole round (any win) ${f(o.hitAnyPct)}%   base-only (cluster or phone pay) ${f(o.hitBaseAnyPct)}%   base cluster win ${f(o.hitBasePct)}%`);
    console.log('  bands (round win / bet)  ' + o.bands.map((b) => `${b.band}: ${f(b.pctSpins, 3)}% spins ${f(b.pctRtp, 2)}% RTP`).join(' | '));
    console.log('  base-only bands (cluster+phone, bonus excluded)  ' + o.baseBands.map((b) => `${b.band}: ${f(b.pctSpins, 3)}% spins ${f(b.pctRtp, 2)}% RTP`).join(' | '));
    console.log(`  RTP by part      clusters(base) ${f(o.parts.cluster)}%  base phone ${f(o.parts.basePhone)}%  bonus1 ${f(o.parts.bonus1)}%  bonus2 ${f(o.parts.bonus2)}%  bonus3 ${f(o.parts.bonus3)}%`);
    console.log(`  bonus triggers   bonus1 1 in ${o.oneIn.bonus1 ? f(o.oneIn.bonus1, 0) : 'n/a'} (avg ${f(o.avg.bonus1)}x, upgraded ${f(o.upgradedOfBonus1 * 100, 1)}%)  bonus2 1 in ${o.oneIn.bonus2 ? f(o.oneIn.bonus2, 0) : 'n/a'} (avg ${f(o.avg.bonus2)}x)  bonus3 ${o.oneIn.bonus3 ? '1 in ' + f(o.oneIn.bonus3, 0) : 'none'} (avg ${f(o.avg.bonus3)}x)  all bonuses avg ${f(o.avg.any)}x, ${f(o.bonusSharePct, 1)}% of RTP  any 1 in ${o.oneIn.any ? f(o.oneIn.any, 1) : 'n/a'}`);
    console.log(`  base phone       fires on ${f(o.phoneBase.pctOfSpins, 2)}% of spins (1 in ${o.phoneBase.oneIn ? f(o.phoneBase.oneIn, 1) : 'n/a'}), avg ${f(o.phoneBase.avgLeads, 1)} hot leads, ${f(o.phoneBase.avgCloses, 3)} closes`);
    console.log(`  cascades         ${f(o.avgCascadesPerWinningSpin, 2)} per winning base spin   bonus avg ${f(o.avgBonusSpins, 1)} spins`);
    console.log(`  max win          ${f(o.maxWinX, 1)}x   cap (${Eng.MAX_WIN_X}x) hit ${o.capHits} times${o.capOneIn ? ' (1 in ' + f(o.capOneIn, 0) + ')' : ''}`);
    console.log(`  cap hits by source  base only ${o.capByKind[0]}  bonus1 ${o.capByKind[1]}  bonus2 ${o.capByKind[2]}  bonus3 ${o.capByKind[3]}`);
    console.log(`  tail (share of spins)  >=100x ${(o.tail.ge100 * 100).toExponential(3)}% (1 in ${o.tail.ge100 ? f(1 / o.tail.ge100, 0) : 'n/a'})  >=1000x ${(o.tail.ge1000 * 100).toExponential(3)}% (1 in ${o.tail.ge1000 ? f(1 / o.tail.ge1000, 0) : 'n/a'})  >=5000x ${(o.tail.ge5000 * 100).toExponential(3)}% (${o.tailCounts.ge5000} spins)`);
  }).catch((e) => { console.error(e); process.exit(1); });
}
