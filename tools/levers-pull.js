'use strict';
// COLD CALL levers sim, Part 3: the whole game WITH THE PULL (engine.playRound, state carried, real calendar days, daily streak).
// Written by the levers agent; reads the engine, never changes it.
//   node tools/levers-pull.js --stream [spins=100000000] [seed=1] [--pick best|first|none] [--day 1000] [--bet 100]
//        one returning player per 500,000-spin chunk: flat bet, the daily appointment claimed once per `day` paid spins on consecutive calendar days
//        (so the streak climbs to streakMax, the steady state), ONE MORE CALL banked (neutral at more.rtp 1.0, see --more take), idle time none (cold.* not exercised).
//        Prints: payback by part with CI (chunk means), hit / under-1x / win ladder, event gaps, bonus value spread (natural and Callback), Callback cadence, warm, ghost.
//   node tools/levers-pull.js --sessions [bankX=100] [sessions=200000] [seed=1] [--pick best|first|none] [--cap 20000]
//        fresh player (empty state, the daily gift on the first spin), flat 1x bet until the balance is under one bet.
//   node tools/levers-pull.js --buys [runs=1000000] [seed=1] [--pick best|first|none]    average value of every buy at its CFG price, with PICK in
//   --more bank|take (gamble policy), --cfg '{...}' | --cfg @file.json, --threads N, --out file.json, --json
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const Eng = require(fs.existsSync(path.join(__dirname, 'coldcall-engine.js')) ? './coldcall-engine.js' : '../games/coldcall-engine.js');

const MAX_THREADS = +process.env.CC_MAX_THREADS || 6, CHUNK = 500000;
const seedOf = (base, k) => { let z = (base + Math.imul(k + 1, 0x9E3779B9)) | 0; z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B); z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35); return (z ^ (z >>> 16)) >>> 0; };
const merged = (a, b) => { const o = Array.isArray(a) ? a.slice() : Object.assign({}, a); for (const k of Object.keys(b)) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? merged(o[k], b[k]) : b[k]; return o; };
const GAPMAX = 5000;
const SERIES = ['dead', 'bonus', 'natbonus', 'win5', 'win20', 'tease', 'phone', 'any'];
const LADDER = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 5000, 10000];
const BEDGES = [1, 5, 10, 20, 50, 100, 200, 1000];       // bonus value thresholds (x bet)

const nb4 = (p, set) => { const r = (p / 6) | 0, c = p % 6; let n = 0; if (r > 0 && set.has(p - 6)) n++; if (c > 0 && set.has(p - 1)) n++; if (c < 5 && set.has(p + 1)) n++; if (r < 4 && set.has(p + 6)) n++; return n; };
const bestPick = (choices) => { const set = new Set(choices); let b = choices[0], bn = -1; for (const p of choices) { const n = nb4(p, set); if (n > bn) { bn = n; b = p; } } return b; };
const mkDecide = (pick, more) => (pt) => (pt.k === 'more' ? (more === 'take' ? { k: 'more', take: true } : null) : pick === 'best' ? { k: 'pick', p: bestPick(pt.choices) } : null);
const withPick = (c, pick) => (pick === 'none' ? merged(c, { pull: { pick: { on: false } } }) : c);

if (!isMainThread) {
  const { cfg, mode, chunks, o } = workerData;
  const e = Eng.createEngine(withPick(cfg, o.pick)), decide = mkDecide(o.pick, o.more), P = cfg.pull, capT = cfg.maxWinTenths;
  if (mode === 'stream') {
    const out = [];
    for (const k of chunks) {
      const rng = Eng.rngFrom(seedOf(o.seed, k));
      const a = { k, paid: 0, cbRounds: 0, cluster: 0, phone: 0, nat: 0, cb: 0, moreNet: 0, sq: 0, hit: 0, under1: 0, eq1: 0, ladder: new Array(LADDER.length).fill(0), eventLadder: new Array(LADDER.length).fill(0),
        dead: 0, nat1: [0, 0, 0, 0], natSum: [0, 0, 0, 0], natBand: new Array(BEDGES.length + 1).fill(0), cbBand: new Array(BEDGES.length + 1).fill(0), natN: 0, cbN: 0, cbSum: 0, cbSq: 0,
        gap: {}, gapMax: {}, gapN: {}, gapSum: {}, arms: 0, armGap: new Uint32Array(GAPMAX + 2), bandN: new Array(8).fill(0), bandSum: new Array(8).fill(0), warmSpins: 0, warmPhone: 0, warmPhonePay: 0, warmCreated: 0, marked: 0, ghostN: 0, ghostSum: 0, ghostGe1: 0, ghostLt1: 0, ghostShownNoCl: 0, filled: 0, dailyLeads: 0, caps: 0, bells2: 0, pickN: 0, offers: 0 };
      for (const s of SERIES) { a.gap[s] = new Uint32Array(GAPMAX + 2); a.gapMax[s] = 0; a.gapN[s] = 0; a.gapSum[s] = 0; }
      const last = {}; for (const s of SERIES) last[s] = 0;
      const mark = (s, t) => { const g = Math.ceil(t - last[s]); last[s] = t; if (g <= 0) return; a.gap[s][Math.min(g, GAPMAX + 1)]++; a.gapN[s]++; a.gapSum[s] += g; if (g > a.gapMax[s]) a.gapMax[s] = g; };
      const band = (x) => { let i = 0; while (i < BEDGES.length && x >= BEDGES[i]) i++; return i; };   // x in x-bet: band i = [edge i-1, edge i)
      let st = Eng.newState(), day = '2026-01-01', sinceArm = 0, inDay = 0, t = 1e9, lastArmT = 0;
      for (let i = 0; i < o.spins; i++) {
        if (inDay >= o.day) { day = (function nd(d) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10); })(day); inDay = 0; }
        let r = e.playRound(rng, { bet: o.bet, state: st, now: t, day, script: false, auto: true, decide }, []);
        t += 1000; st = r.newState;
        if (r.callback) {      // the free Callback happens between paid spins: index paid + 0.5
          const R = r.round, x = r.winTenths / 10; a.cbRounds++; a.cb += R.bonusRawTenths; a.moreNet += R.bonusTenths - R.bonusRawTenths; a.cbN++; a.cbSum += r.winTenths; a.cbSq += r.winTenths * r.winTenths; a.cbBand[band(x)]++;
          for (let j = 0; j < LADDER.length; j++) if (x >= LADDER[j]) a.eventLadder[j]++;
          if (r.winTenths >= capT) a.caps++;
          mark('bonus', a.paid + 0.5); mark('any', a.paid + 0.5); if (x >= 5) mark('win5', a.paid + 0.5); if (x >= 20) mark('win20', a.paid + 0.5);
          r = e.playRound(rng, { bet: o.bet, state: st, now: t, day, script: false, auto: true, decide }, []);   // then the paid spin it was waiting in front of
          t += 1000; st = r.newState;
        }
        const R = r.round, pl = r.pull, w = r.winTenths; a.paid++; inDay++; const T = a.paid;
        a.cluster += R.clusterTenths; a.phone += R.phoneTenths; a.sq += w * w;
        if (R.bonusKind) { const raw = R.bonusRawTenths; a.nat += raw; a.moreNet += R.bonusTenths - raw; a.nat1[R.bonusKind]++; a.natSum[R.bonusKind] += R.bonusTenths; a.natN++; a.natBand[band(R.bonusTenths / 10)]++; }
        if (w >= capT) a.caps++;
        if (w > 0) a.hit++; if (w > 0 && w < 10) a.under1++; if (w === 10) a.eq1++;
        const x = w / 10; for (let j = 0; j < LADDER.length; j++) if (x >= LADDER[j]) { a.ladder[j]++; a.eventLadder[j]++; }
        { const bd = w === 0 ? 0 : w < 10 ? 1 : w < 20 ? 2 : w < 50 ? 3 : w < 200 ? 4 : w < 1000 ? 5 : w < 10000 ? 6 : 7; a.bandN[bd]++; a.bandSum[bd] += w; }
        const dead = w === 0; if (dead) a.dead++; else mark('dead', T);   // gap between paying spins = dead runs
        if (R.bonusKind) { mark('bonus', T); mark('natbonus', T); }
        if (x >= 5) mark('win5', T); if (x >= 20) mark('win20', T);
        if (R.bells === 2 && !R.bonusKind) { mark('tease', T); a.bells2++; }
        if (R.phoneFired) mark('phone', T);
        if (R.bonusKind || x >= 5 || (R.bells === 2) || R.phoneFired) mark('any', T);
        a.filled += pl.filled; if (pl.daily) a.dailyLeads += pl.daily.leads * 10;
        if (pl.armed) { a.arms++; a.armGap[Math.min(T - lastArmT, GAPMAX + 1)]++; lastArmT = T; }
        if (R.marked > 0 && R.phones === 0) a.marked++;
        a.warmCreated += pl.warmOut.length; if (pl.warmIn.length) { a.warmSpins++; if (R.phoneFired) { a.warmPhone++; a.warmPhonePay += R.phoneTenths; } }
        if (pl.ghost) { a.ghostN++; a.ghostSum += pl.ghost.pay; if (pl.ghost.pay >= 10) a.ghostGe1++; else a.ghostLt1++; }
        if (pl.pick) a.pickN++; if (pl.more) a.offers++;
      }
      out.push(a);
    }
    return parentPort.postMessage(out);
  }
  if (mode === 'sessions') {
    const out = { n: 0, spins: new Uint32Array(o.cap + 2), sawCb: 0, sawBonus: 0, sawNat: 0, saw20: 0, saw100: 0, doubled: 0, cap: 0, firstBonusSum: 0, firstBonusN: 0, cbSum: 0, natSum: 0, finalSum: 0, cbPerSession: 0, bonuses: 0 };
    for (const k of chunks) {
      const rng = Eng.rngFrom(seedOf(o.seed, k));
      for (let s = 0; s < o.sessions; s++) {
        let st = Eng.newState(); if (o.carry) { st.lt = Math.floor(rng() * P.list * 10); st.avg = o.bet; st.day = '2026-01-01'; } let bal = o.bankX * 10, spins = 0, t = 1e9, cbSeen = 0, nat = 0, big20 = false, big100 = false, dbl = false, firstB = 0;
        while (bal >= 10 && spins < o.cap) {
          let r = e.playRound(rng, { bet: o.bet, state: st, now: t, day: '2026-01-01', script: false, auto: true, decide }, []);
          t += 1000; st = r.newState;
          if (r.callback) { bal += r.winTenths; cbSeen++; out.cbSum += r.winTenths; if (r.winTenths >= 200) big20 = true; if (r.winTenths >= 1000) big100 = true; if (!firstB) firstB = spins + 0.5; r = e.playRound(rng, { bet: o.bet, state: st, now: t, day: '2026-01-01', script: false, auto: true, decide }, []); t += 1000; st = r.newState; }
          spins++; bal += r.winTenths - 10; if (r.round.bonusKind) { nat++; out.natSum += r.round.bonusTenths; if (!firstB) firstB = spins; }
          if (r.winTenths >= 200) big20 = true; if (r.winTenths >= 1000) big100 = true; if (bal >= o.bankX * 20) dbl = true;
          if (r.winTenths >= capT) out.cap++;
        }
        out.n++; out.spins[Math.min(spins, o.cap + 1)]++; if (cbSeen) out.sawCb++; if (nat) out.sawNat++; if (cbSeen || nat) out.sawBonus++; if (big20) out.saw20++; if (big100) out.saw100++; if (dbl) out.doubled++; if (firstB) { out.firstBonusSum += firstB; out.firstBonusN++; }
        out.bonuses += cbSeen + nat; out.finalSum += bal;
      }
    }
    return parentPort.postMessage(out);
  }
  if (mode === 'buys') {
    const kinds = ['call', 'bonus1', 'bonus2', 'hunt'], out = {};
    for (const b of kinds) out[b] = { n: 0, sum: 0, sq: 0, nb: 0 };
    for (const k of chunks) {
      const rng = Eng.rngFrom(seedOf(o.seed, k));
      for (const b of kinds) for (let i = 0; i < o.runs; i++) {
        const r = e.playRound(rng, { buy: b, bet: 100, state: null, script: false, auto: true, decide }, []);
        const w = r.winTenths; out[b].n++; out[b].sum += w; out[b].sq += w * w; if (r.round.bonusKind) out[b].nb++;
      }
    }
    return parentPort.postMessage(out);
  }
} else {
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, v && !v.startsWith('--') ? 2 : 1); return v && !v.startsWith('--') ? v : true; };
  const bool = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
  const cfgArg = flag('--cfg'), outFile = flag('--out'), thrArg = flag('--threads'), pickA = flag('--pick'), moreA = flag('--more'), dayA = flag('--day'), betA = flag('--bet'), capA = flag('--cap'), carryA = bool('--carry'), asJson = bool('--json');
  const streamM = bool('--stream'), sessM = bool('--sessions'), buysM = bool('--buys');
  const nums = argv.filter((a) => !a.startsWith('--')).map(Number);
  const cfgText = cfgArg && cfgArg !== true ? (cfgArg[0] === '@' ? fs.readFileSync(cfgArg.slice(1), 'utf8') : cfgArg) : '{}';
  const cfg = merged(Eng.CFG, JSON.parse(cfgText));
  const threads = Math.min(MAX_THREADS, Math.max(1, +thrArg || MAX_THREADS));
  const pick = pickA && pickA !== true ? pickA : 'best', more = moreA && moreA !== true ? moreA : 'bank', bet = +betA || 100;
  const t0 = Date.now(), f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : x.toFixed(d));
  const spawn = (per, o, mode) => Promise.all(per.filter((c) => c.length).map((chunks) => new Promise((res, rej) => { const w = new Worker(__filename, { workerData: { cfg, mode, chunks, o } }); w.once('message', res); w.once('error', rej); })));
  const meanSe = (arr) => { const n = arr.length, m = arr.reduce((a, b) => a + b, 0) / n, v = n > 1 ? arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1) : 0; return { mean: m, ci: 1.96 * Math.sqrt(v / n) }; };
  const dist = (h, n) => { const q = (p) => { let acc = 0; for (let i = 0; i < h.length; i++) { acc += h[i]; if (acc >= p * n) return i; } return h.length - 1; }; return { median: q(0.5), p90: q(0.9), p99: q(0.99), p999: q(0.999) }; };
  if (streamM) {
    const spins = nums[0] || 100000000, seed = nums[1] || 1, day = +dayA || 1000, nChunks = Math.ceil(spins / CHUNK);
    const per = Array.from({ length: threads }, () => []); for (let k = 0; k < nChunks; k++) per[k % threads].push(k);
    spawn(per, { spins: CHUNK, seed, pick, more, day, bet }, 'stream').then((parts) => {
      const C = parts.flat().sort((a, b) => a.k - b.k), sum = (k) => C.reduce((a, c) => a + c[k], 0), paid = sum('paid');
      const vec = (fn) => meanSe(C.map(fn));
      const stake = (c) => c.paid * 10;                                  // tenths staked (flat bet: nominal bet = actual bet, a Callback is at cb.bet = bet)
      const part = (key) => vec((c) => c[key] / stake(c) * 100);
      const nat = part('nat'), cbp = part('cb'), mn = part('moreNet'), cl = part('cluster'), ph = part('phone');
      const total = vec((c) => (c.cluster + c.phone + c.nat + c.cb + c.moreNet) / stake(c) * 100);
      const combine = (key) => { const h = new Array(GAPMAX + 2).fill(0); let n = 0, s = 0, mx = 0; for (const c of C) { for (let i = 0; i <= GAPMAX + 1; i++) h[i] += c.gap[key][i]; n += c.gapN[key]; s += c.gapSum[key]; mx = Math.max(mx, c.gapMax[key]); } return { n, mean: s / n, max: mx, ...dist(h, n) }; };
      const gaps = {}; for (const s of SERIES) gaps[s] = combine(s);
      const armH = new Array(GAPMAX + 2).fill(0); for (const c of C) for (let i = 0; i <= GAPMAX + 1; i++) armH[i] += c.armGap[i]; const arms = sum('arms');
      const sumArr = (key) => LADDER.map((_, j) => C.reduce((a, c) => a + c[key][j], 0));
      const natBand = BEDGES.concat([Infinity]).map((_, i) => C.reduce((a, c) => a + c.natBand[i], 0)), cbBand = BEDGES.concat([Infinity]).map((_, i) => C.reduce((a, c) => a + c.cbBand[i], 0));
      const natN = sum('natN'), cbN = sum('cbN'), sd = Math.sqrt(sum('sq') / paid - Math.pow((sum('cluster') + sum('phone') + sum('nat') + sum('moreNet')) / paid, 2)) / 10;
      const o = { mode: 'stream', paid, seed, pick, more, day, bet, secs: (Date.now() - t0) / 1000, chunks: C.length,
        rtp: { total: total.mean, ci: total.ci, clusters: cl.mean, basePhone: ph.mean, natBonus: nat.mean, callback: cbp.mean, callbackCi: cbp.ci, natCi: nat.ci, moreNet: mn.mean },
        bonusSharePct: (nat.mean + cbp.mean + mn.mean) / total.mean * 100,
        hit: sum('hit') / paid, under1: sum('under1') / paid, eq1: sum('eq1') / paid, sdX: sd,
        ladderPaid: LADDER.map((x, j) => ({ x, oneIn: paid / sumArr('ladder')[j] })), ladderEvents: LADDER.map((x, j) => ({ x, oneIn: paid / sumArr('eventLadder')[j] })),
        natBonus: { n: natN, oneIn: paid / natN, kinds: null, avgX: sum('nat') / natN / 10, avgFinalX: (sum('nat') + sum('moreNet')) / natN / 10, band: natBand.map((n) => n / natN) },
        callback: { n: cbN, perPaid: cbN / paid, spinsPer: { mean: arms ? paid / arms : null, ...dist(armH, arms) }, avgX: sum('cbSum') / cbN / 10, band: cbBand.map((n) => n / cbN) },
        bands: { names: ['0', '<1x', '1-2x', '2-5x', '5-20x', '20-100x', '100-1000x', '1000x+'], spinPct: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => sum('bandN') ? C.reduce((a, c) => a + c.bandN[i], 0) / paid * 100 : 0), rtpPts: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => C.reduce((a, c) => a + c.bandSum[i], 0) / (paid * 10) * 100), callbackPts: cbp.mean + mn.mean },
        anyBonusOneIn: paid / (natN + cbN), gaps, bellsTeasePerSpin: sum('bells2') / paid,
        warm: { markedNoPhonePer100: sum('marked') / paid * 100, createdPerSpin: sum('warmCreated') / paid, spinsWithWarmPer100: sum('warmSpins') / paid * 100, phoneOnWarmPer100: sum('warmPhone') / paid * 100, avgPhonePayOnWarmX: sum('warmPhone') ? sum('warmPhonePay') / sum('warmPhone') / 10 : null },
        ghost: { per100: sum('ghostN') / paid * 100, avgX: sum('ghostN') ? sum('ghostSum') / sum('ghostN') / 10 : null, ge1x: sum('ghostGe1') / Math.max(1, sum('ghostN')) },
        leads: { filledPerSpin: sum('filled') / 10 / paid, dailyPerDay: sum('dailyLeads') / 10 / (paid / day) }, decisions: { picksPer100: sum('pickN') / paid * 100, offersPer100: sum('offers') / paid * 100 }, caps: sum('caps'), capOneIn: sum('caps') ? paid / sum('caps') : null };
      o.natBonus.kinds = [1, 2, 3].map((k) => ({ kind: k, oneIn: paid / Math.max(1, C.reduce((a, c) => a + c.nat1[k], 0)), avgX: C.reduce((a, c) => a + c.natSum[k], 0) / Math.max(1, C.reduce((a, c) => a + c.nat1[k], 0)) / 10 }));
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      if (asJson) return console.log(JSON.stringify(o));
      console.log(JSON.stringify(o, null, 1));
    }).catch((e) => { console.error(e); process.exit(1); });
  } else if (sessM) {
    const bankX = nums[0] || 100, sessions = nums[1] || 200000, seed = nums[2] || 1, cap = +capA || 20000, per0 = 500, nChunks = Math.ceil(sessions / per0);
    const per = Array.from({ length: threads }, () => []); for (let k = 0; k < nChunks; k++) per[k % threads].push(k);
    spawn(per, { sessions: per0, seed, pick, more, bankX, bet, cap, carry: carryA }, 'sessions').then((parts) => {
      const A = parts.reduce((a, p) => { for (const k of Object.keys(p)) { if (k === 'spins') { for (let i = 0; i < p.spins.length; i++) a.spins[i] += p.spins[i]; } else a[k] += p[k]; } return a; }, { n: 0, spins: new Array(cap + 2).fill(0), sawCb: 0, sawBonus: 0, sawNat: 0, saw20: 0, saw100: 0, doubled: 0, cap: 0, firstBonusSum: 0, firstBonusN: 0, cbSum: 0, natSum: 0, finalSum: 0, cbPerSession: 0, bonuses: 0 });
      const q = (p) => { let acc = 0; for (let i = 0; i < A.spins.length; i++) { acc += A.spins[i]; if (acc >= p * A.n) return i; } return cap; };
      const o = { mode: 'sessions', carry: carryA, bankX, sessions: A.n, seed, pick, more, cap, secs: (Date.now() - t0) / 1000, spins: { p10: q(0.1), median: q(0.5), p90: q(0.9) }, hitCapShare: A.spins[cap] / A.n + A.spins[cap + 1] / A.n, sawCallback: A.sawCb / A.n, sawAnyBonus: A.sawBonus / A.n, sawNaturalBonus: A.sawNat / A.n, saw20x: A.saw20 / A.n, saw100x: A.saw100 / A.n, doubled: A.doubled / A.n, firstBonusMeanSpin: A.firstBonusN ? A.firstBonusSum / A.firstBonusN : null, bonusesPerSession: A.bonuses / A.n, capHits: A.cap };
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      console.log(JSON.stringify(o, null, 1));
    }).catch((e) => { console.error(e); process.exit(1); });
  } else if (buysM) {
    const runs = nums[0] || 1000000, seed = nums[1] || 1, per0 = 100000, nChunks = Math.ceil(runs / per0), per = Array.from({ length: threads }, () => []); for (let k = 0; k < nChunks; k++) per[k % threads].push(k);
    spawn(per, { runs: per0, seed, pick, more }, 'buys').then((parts) => {
      const o = { mode: 'buys', runs: nChunks * per0, seed, pick, more, buys: {} };
      for (const b of ['call', 'bonus1', 'bonus2', 'hunt']) { const a = parts.reduce((x, p) => { for (const k of Object.keys(p[b])) x[k] += p[b][k]; return x; }, { n: 0, sum: 0, sq: 0, nb: 0 }); const m = a.sum / a.n, sd = Math.sqrt(a.sq / a.n - m * m); o.buys[b] = { price: cfg.buyCost[b] / 10, avgX: m / 10, ci: 1.96 * sd / Math.sqrt(a.n) / 10, rtpPct: m / cfg.buyCost[b] * 100, rtpCi: 1.96 * sd / Math.sqrt(a.n) / cfg.buyCost[b] * 100, bonusRate: a.nb / a.n }; }
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      console.log(JSON.stringify(o, null, 1));
    }).catch((e) => { console.error(e); process.exit(1); });
  } else { console.error('usage: --stream | --sessions | --buys (see header)'); process.exit(1); }
}
