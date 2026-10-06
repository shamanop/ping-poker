'use strict';
// COLD CALL v2 simulator, on worker threads (at most 6; the box is shared: start it with `nice -n 10`).
//   nice -n 10 node games/coldcall-sim.js [spins=100000000] [seed=1]          plain full rounds: RTP by part, hit rate, bonus rates, tails, cap hits
//   nice -n 10 node games/coldcall-sim.js --strat [baseSpins=100000000] [bonusRunsPerKind=20000000] [seed=1]
//        stratified RTP: RTP = E[base cluster + base phone] + sum_k P(bell trigger k) * E[bonus k]; each bonus is sampled directly,
//        so the heavy tail of the bonuses no longer dominates the interval (same idea as games/bender-rtp.js)
//   nice -n 10 node games/coldcall-sim.js --buys [runsPerBuy=5000000] [seed=1] [--only call,hunt]  average value and RTP of every buy at its configured price
//   nice -n 10 node games/coldcall-sim.js --pull [sessions=20000] [spinsPerSession=2000] [seed=1] [--pickpolicy first|best|none] [--more bank|take] [--bet 100] [--nowarmdiff] [--fresh] [--bet-switch]
//        THE PULL (cold-call/PULL-ENGINE.md section 5): sequential sessions with state (no idle time): RTP by part per paid spin (money in real cents), spins per Callback, warm, ghost, value per lead, pot.
//        The state is CARRIED across the sessions of a batch (a returning player); --fresh = every session starts empty (old behaviour). --bet-switch = the F1 attacker: 10c spins, $25 on the spin after >= 3 warm squares exist. --bet-mix lo,hi[,T] = the critic's N1 attacker: bet hi (cents) while the state's lead-weighted average is under T, else lo (T defaults to the first half step over the middle, 15.5 for 10,20).
//        DENOMS (1c / 2c / 5c, cold-call/PULL-ENGINE.md section 7): --bet 1|2|5 plays them; wins are paid in whole cents by Eng.roundCents with its OWN random stream (the round's stream does not move), the output adds
//        'paid cents' (what the wallet would get) next to the exact tenths-based parts, and a decision ledger: for every ONE MORE CALL offer, (expected value of the option the policy took, given the SHOWN cents) minus (the exact value of banking).
//        --more bank|take|bankup|takeup: bankup = bank when the shown bank amount rounded UP, gamble when it rounded down; takeup = the reverse. A fair design pays every policy the exact value (ledger 0 +- noise).
//        --bet-mix lo,hi[,T]: any two bets (1,2 / 1,10 / 5,10 / 2,100 ...), T = the average at which it switches (default: just over the middle).
//   nice -n 10 node games/coldcall-sim.js --buys-pull [runs=1000000] [seed=1] [--bet 100] [--pickpolicy first|best|none] [--more bank|take|bankup|takeup] [--only call,bonus1,bonus2,hunt] [--cfg ...]
//        every buy through the real playRound (PICK, ONE MORE CALL) at its whole-cent price for that bet and the fair stake (Eng.buyPrice / scaleOf): paid cents / price cents with a CI by batch means, the exact payback
//        (winTenths / costTenths: identical at every bet for the same seed), the paid - exact drift, cap hits. Same seeds at 1c, 2c, 5c and $1 = the same rounds; only the rounding differs.
//   nice -n 10 node games/coldcall-sim.js --pot-room [ticks=1000000] [seed=1] --feeders 10:40,20:40 [--chase 2500,T[,perTick]] [--batches 20]
//        POT ONLY (levers 8.11): the office pot of a room, no game. Each tick every feeder (bet:count, cents) spins once; the chaser (bet cents, threshold T cents, spins per tick, default 1) spins only while the pot holds at least T.
//        Same pot rule and rng as --pull (potSlice, potHitChance, potPrize; separate stream per batch), so a flat one-bettor room reproduces the pot part of a --pull run bit for bit. Per bet class: stake, paid, pot % of stake, average and largest prize in bets; cents left; fed + seeded = paid + left to the cent.
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
  if (mode === 'room') {
    const R = workerData.room, Pc = cfg.pull, out = [];
    for (const k of chunks) {
      const rng = Eng.rngFrom((seedOf(baseSeed, k) ^ 0xA5A5A5A5) >>> 0);
      const pot = { bal: Pc.pot.seed, rem: 0, fed: 0, seeded: Pc.pot.seed, paid: 0, hits: 0 };
      const cls = R.classes.map((c) => ({ bet: c.bet, n: c.n, chase: !!c.chase, stake: 0, paid: 0, exp: 0, hits: 0, spins: 0, sumX: 0, maxX: 0 }));
      const spin = (c) => {
        const sl = Eng.potSlice(Pc.pot.feedBps, c.bet, pot.rem); pot.rem = sl.rem; pot.bal += sl.slice; pot.fed += sl.slice; c.stake += c.bet; c.spins++;
        const hc = Eng.potHitChance(Pc, c.bet), live = pot.bal >= Pc.pot.minBal && pot.bal > 0;
        if (live) c.exp += hc * Eng.potPrize(Pc, pot.bal);          // expected prize of this spin given the pot now: the same mean as the rolled prizes without the roll's noise
        if (rng() < hc && live) {
          const prize = Eng.potPrize(Pc, pot.bal); pot.paid += prize; pot.bal -= prize; pot.hits++; c.paid += prize; c.hits++; c.sumX += prize / c.bet; if (prize / c.bet > c.maxX) c.maxX = prize / c.bet;
          if (Pc.pot.seed > 0) { pot.bal += Pc.pot.seed; pot.seeded += Pc.pot.seed; }
        }
      };
      let potSum = 0, potMax = 0;
      for (let t = 0; t < R.ticks; t++) {
        for (const c of cls) { if (c.chase) { for (let j = 0; j < R.perTick; j++) { if (pot.bal < R.threshold) break; spin(c); } } else for (let j = 0; j < c.n; j++) spin(c); }
        potSum += pot.bal; if (pot.bal > potMax) potMax = pot.bal;
      }
      out.push({ k, pot: { ...pot, left: pot.bal, avgBal: potSum / R.ticks, maxBal: potMax }, cls });
    }
    return parentPort.postMessage(out);
  }
  if (mode === 'pull' || mode === 'bonus' || mode === 'buyspull') {
    const nb4 = (p, set) => { const r = (p / 6) | 0, c = p % 6; let n = 0; if (r > 0 && set.has(p - 6)) n++; if (c > 0 && set.has(p - 1)) n++; if (c < 5 && set.has(p + 1)) n++; if (r < 4 && set.has(p + 6)) n++; return n; };
    // 'best' pick: the hot square with the most hot neighbours (an upsell on it reaches the most leads); ties go to reading order
    const bestPick = (choices) => { const set = new Set(choices); let b = choices[0], bn = -1; for (const p of choices) { const n = nb4(p, set); if (n > bn) { bn = n; b = p; } } return b; };
    // ctx = { num, den, pt }: the scale of the round about to be played (cents per tenth = num / den) and the last ONE MORE CALL point seen (the SHOWN cents), read by the shown-cents policies and the decision ledger
    const mkDecide = (pickpolicy, more, ctx) => (pt) => {
      if (pt.k === 'more') {
        if (ctx) ctx.pt = pt;
        if (more === 'take') return { k: 'more', take: true };
        if (more === 'bank' || !ctx) return null;
        const up = pt.bonusCents > pt.W * ctx.num / ctx.den + 1e-9;           // the shown bonus rounded UP (strictly above the exact amount)
        return more === 'bankup' ? (up ? null : { k: 'more', take: true }) : (up ? { k: 'more', take: true } : null);
      }
      return pickpolicy === 'best' ? { k: 'pick', p: bestPick(pt.choices) } : null;
    };
    const withPick = (c, pickpolicy) => (pickpolicy === 'none' ? merged(c, { pull: { pick: { on: false } } }) : c);
    if (mode === 'bonus') {
      const { kinds, combos } = workerData.bonusOpts, bet = workerData.bet, out = {};
      for (const kind of kinds) for (const cb of combos) {
        const key = kind + '|' + cb.pick + '|' + cb.more, e = Eng.createEngine(withPick(cfg, cb.pick)), decide = mkDecide(cb.pick, cb.more);
        const a = { n: 0, sum: 0, sq: 0, cap: 0, ge100: 0, ge1000: 0, offers: 0, takes: 0, wins: 0, picks: 0 };
        for (const k of chunks) {
          const rng = Eng.rngFrom(seedOf(baseSeed + kind * 977, k)), rnd = Eng.rngFrom(seedOf(baseSeed + kind * 977 + 13, k));         // same stream for every policy of a kind: common random numbers; rnd = the whole-cent rounding stream (1c / 2c / 5c)
          for (let i = 0; i < size; i++) {
            const r = e.playRound(rng, { buy: 'bonus' + kind, bet, state: null, script: false, auto: true, decide, rnd }, []);
            const w = r.winTenths; a.n++; a.sum += w; a.sq += w * w; if (w >= capT) a.cap++; if (w >= 1000) a.ge100++; if (w >= 10000) a.ge1000++;
            if (r.pull.pick) a.picks++; if (r.pull.more) { a.offers++; if (r.pull.more.take) { a.takes++; if (r.pull.more.won) a.wins++; } }
          }
        }
        out[key] = a;
      }
      return parentPort.postMessage(out);
    }
    if (mode === 'buyspull') {
      // every buy through the real playRound (PICK, ONE MORE CALL) at its whole-cent price and the fair stake; the same seed gives the same rounds at every bet, so only the rounding differs
      const o = workerData.buyOpts, bet = workerData.bet, out = {};
      for (const [bi, b] of o.only.entries()) {
        const ctx = { num: 0, den: 1, pt: null }, e = Eng.createEngine(withPick(cfg, o.pickpolicy)), decide = mkDecide(o.pickpolicy, o.more, ctx), sc = Eng.scaleOf(cfg.buyCost[b], bet); ctx.num = sc.num; ctx.den = sc.den;
        const acc = { chunks: [], paid: 0, price: 0, wt: 0, ct: 0, bonus: 0, cap: 0, n: 0, dgN: 0, dgSum: 0 };
        for (const k of chunks) {
          const rng = Eng.rngFrom(seedOf(baseSeed + bi * 977, k)), rnd = Eng.rngFrom(seedOf(baseSeed + bi * 977 + 13, k)), c = { paid: 0, price: 0, wt: 0, ct: 0, n: 0, bonus: 0, cap: 0 };
          for (let i = 0; i < size; i++) {
            ctx.pt = null;
            const r = e.playRound(rng, { buy: b, bet, state: null, script: false, auto: true, decide, rnd }, []);
            c.paid += r.pay.win; c.price += r.pay.price; c.wt += r.winTenths; c.ct += r.costTenths; c.n++; if (r.round.bonusKind) c.bonus++; if (r.winTenths >= capT) c.cap++;
            if (r.pull.more && ctx.pt) { const pt = ctx.pt, ev = r.pull.more.take ? pt.pWin * pt.winCents + (1 - pt.pWin) * pt.baseCents : pt.bankCents; acc.dgN++; acc.dgSum += ev - (r.round.clusterTenths + r.round.phoneTenths + pt.W) * r.pay.num / r.pay.den; }
          }
          acc.chunks.push(c); for (const key of ['paid', 'price', 'wt', 'ct', 'bonus', 'cap', 'n']) acc[key] += c[key];
        }
        out[b] = acc;
      }
      return parentPort.postMessage(out);
    }
    // ---- pull: sessions of sequential play with state. Money is counted in real CENTS (a Callback is played at cb.bet, not at the nominal bet).
    const o = workerData.pullOpts, bet = workerData.bet, P = cfg.pull, DAY = '2026-10-06';
    const HIST = 3000, SW_LO = 10, SW_HI = 2500;
    const runChunk = (c, seed) => {
      const ctx = { num: bet, den: 10, pt: null }, e = Eng.createEngine(withPick(c, o.pickpolicy)), decide = mkDecide(o.pickpolicy, o.more, ctx), Pc = c.pull;
      // the office pot, the way the server runs it (store.pot: created holding `seed` cents of tracked house money; one shared pot per batch)
      const rng = Eng.rngFrom(seed), potRng = Eng.rngFrom((seed ^ 0xA5A5A5A5) >>> 0), rnd = Eng.rngFrom((seed ^ 0x5A5A5A5A) >>> 0), pot = { bal: Pc.pot.seed, rem: 0, fed: 0, seeded: Pc.pot.seed, paid: 0, hits: 0, balAtHit: 0 };
      const a = { sess: 0, paid: 0, cbRounds: 0, cluster: 0, phone: 0, nat: 0, cb: 0, cbT: 0, cbBetSum: 0, cbUnder: 0, moreNet: 0, natBonuses: 0, dead: 0, win: 0, filled: 0, arms: 0, armHist: new Array(HIST + 1).fill(0), marked: 0, warmCreated: 0, warmSpins: 0, warmPhone: 0, warmPhonePay: 0,
        ghost: { n: 0, sum: 0, nz: 0, ge10: 0, ge100: 0, max: 0 }, picks: 0, offers: 0, takes: 0, takeWins: 0, stakeCents: 0, capHits: 0, sq: 0, warmDropped: 0,
        loStake: 0, loBack: 0, hiStake: 0, hiBack: 0, hiSpins: 0, dropStake: 0, dropBack: 0, dropSpins: 0, leftLt: 0, leftCb: 0, ends: 0,
        paidCents: 0, exactCents: 0, dgN: 0, dgSum: 0, dgSq: 0, dgUp: 0, dgTake: 0 };
      let st = Eng.newState(), since = 0, t = 1e9;
      for (let s = 0; s < o.sessions; s++) {
        let paid = 0;
        if (o.fresh) { st = Eng.newState(); since = 0; }        // old behaviour: every session starts empty and its unfinished list is thrown away
        else st = Object.assign({}, st, { day: null });         // carried state; a session is still one calendar day (one daily claim, streak 1)
        while (paid < o.spins) {
          const cur = o.betSwitch ? (st.warm.length >= 3 ? SW_HI : SW_LO) : o.betMix ? (st.avg < o.betMix.T ? o.betMix.hi : o.betMix.lo) : bet;
          ctx.num = st.cb ? st.cb.bet : cur; ctx.pt = null;                          // a Callback is played at its own bet
          const r = e.playRound(rng, { bet: cur, state: st, now: t, day: DAY, script: false, auto: true, decide, rnd }, []);
          t += 1000; st = r.newState; const R = r.round, pl = r.pull, bc = r.betCents / 10;   // bc: cents per tenth of the bet actually played
          a.paidCents += r.pay.win; a.exactCents += r.winTenths * r.pay.num / r.pay.den;        // what the wallet gets vs the exact value of the same rounds
          if (pl.more && ctx.pt) {                                                     // DECISION LEDGER: the value (given the shown cents) of the option taken minus the exact value of banking
            const pt = ctx.pt, exactBank = (R.clusterTenths + R.phoneTenths + pt.W) * r.pay.num / r.pay.den;
            const ev = pl.more.take ? pt.pWin * pt.winCents + (1 - pt.pWin) * pt.baseCents : pt.bankCents, g = ev - exactBank;
            a.dgN++; a.dgSum += g; a.dgSq += g * g; if (pt.bonusCents > pt.W * r.pay.num / r.pay.den + 1e-9) a.dgUp++; if (pl.more.take) a.dgTake++;
          }
          if (r.winTenths >= capT) a.capHits++;
          if (pl.pick) a.picks++; if (pl.more) { a.offers++; if (pl.more.take) { a.takes++; if (pl.more.won) a.takeWins++; } }
          if (R.bonusRawTenths !== undefined) a.moreNet += (R.bonusTenths - R.bonusRawTenths) * bc;
          if (r.callback) { a.cbRounds++; a.cb += R.bonusRawTenths * bc; a.cbT += R.bonusRawTenths; a.cbBetSum += r.betCents; if (!o.betSwitch && !o.betMix && r.betCents < bet) a.cbUnder++; continue; }
          paid++; since++; a.paid++; a.stakeCents += cur; a.warmDropped += pl.warmDropped || 0;
          a.cluster += R.clusterTenths * bc; a.phone += R.phoneTenths * bc; if (R.bonusKind) { a.nat += R.bonusRawTenths * bc; a.natBonuses++; }
          if (o.betSwitch) { if (cur === SW_HI) { a.hiStake += cur; a.hiBack += r.winTenths * bc; a.hiSpins++; if (pl.warmDropped > 0) { a.dropStake += cur; a.dropBack += r.winTenths * bc; a.dropSpins++; } } else { a.loStake += cur; a.loBack += r.winTenths * bc; } }
          if (R.clusterTenths + R.phoneTenths === 0 && !R.bonusKind) a.dead++; else if (R.clusterTenths + R.phoneTenths > 0) a.win++;
          a.filled += pl.filled + (pl.daily ? Math.round(pl.daily.leads * 10) : 0);
          if (pl.armed) { a.arms++; a.armHist[Math.min(since, HIST)]++; since = 0; }
          if (R.marked > 0 && R.phones === 0) a.marked++;
          a.warmCreated += pl.warmOut.length; if (pl.warmIn.length) { a.warmSpins++; if (R.phoneFired) { a.warmPhone++; a.warmPhonePay += R.phoneTenths; } }
          if (pl.ghost) { const g = a.ghost, w = pl.ghost.pay; g.n++; g.sum += w; if (w > 0) g.nz++; if (w >= 10) g.ge10++; if (w >= 100) g.ge100++; if (w > g.max) g.max = w; }
          // the pot rule of games/coldcall.js settle(): bal kept above the cap, seed added after a hit, hit needs bal >= minBal and bal > 0
          const sl = Eng.potSlice(Pc.pot.feedBps, cur, pot.rem); pot.rem = sl.rem; pot.bal += sl.slice; pot.fed += sl.slice;
          if (potRng() < Eng.potHitChance(Pc, cur) && pot.bal >= Pc.pot.minBal && pot.bal > 0) {
            const prize = Eng.potPrize(Pc, pot.bal); pot.paid += prize; pot.bal -= prize; pot.hits++; pot.balAtHit += pot.bal + prize;
            if (Pc.pot.seed > 0) { pot.bal += Pc.pot.seed; pot.seeded += Pc.pot.seed; }
          }
        }
        a.sess++;
        if (o.fresh) { a.leftLt += st.lt; if (st.cb) a.leftCb++; a.ends++; }
      }
      if (!o.fresh) { a.leftLt += st.lt; if (st.cb) a.leftCb++; a.ends++; }       // carried: what the player still holds at the end of the batch
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
  const pullMode = bool('--pull'), bonusMode = bool('--bonus'), noWarmDiff = bool('--nowarmdiff'), freshArg = bool('--fresh'), betSwitchArg = bool('--bet-switch'), betMixArg = flag('--bet-mix'), pickArg = flag('--pickpolicy'), moreArg = flag('--more'), betArg = flag('--bet');
  const ONLY = onlyArg && onlyArg !== true ? onlyArg.split(',') : ['call', 'bonus1', 'bonus2', 'hunt'];
  const nums = argv.filter((a) => !a.startsWith('--')).map(Number);
  const cfgText = cfgArg && cfgArg !== true ? (cfgArg[0] === '@' ? fs.readFileSync(cfgArg.slice(1), 'utf8') : cfgArg) : '{}';   // --cfg '@file.json' reads the override from a file
  const presetArg = flag('--preset');   // --preset file.json: a cold-call/presets/*.json file (or a bare overrides object) applied through games/coldcall-livecfg.js merge(): the same validation and deep merge the server uses
  let cfg = merged(Eng.CFG, JSON.parse(cfgText));
  if (presetArg && presetArg !== true) { const pj = JSON.parse(fs.readFileSync(presetArg, 'utf8')); cfg = require('./coldcall-livecfg.js').merge(pj && pj.overrides !== undefined ? pj.overrides : pj); }
  const threads = Math.min(MAX_THREADS, Math.max(1, +thrArg || MAX_THREADS));

  if (bool('--pot-room')) {
    const feedersArg = flag('--feeders'), chaseArg = flag('--chase'), batchesArg = flag('--batches'), f = (x, d = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(d)), t0 = Date.now();
    const ticks = nums[0] || 1000000, seedR = nums[1] || 1, nB = Math.max(1, +batchesArg || 20);
    const classes = String(feedersArg && feedersArg !== true ? feedersArg : '10:1').split(',').map((x) => { const [b, n] = x.split(':').map(Number); return { bet: b, n: n || 1 }; });
    let threshold = 0, perTick = 1;
    if (chaseArg && chaseArg !== true) { const m = String(chaseArg).split(',').map(Number); threshold = m[1] || 0; perTick = m[2] || 1; classes.push({ bet: m[0], n: 1, chase: true }); }
    if (classes.some((c) => !(c.bet > 0) || !Number.isInteger(c.bet) || !(c.n >= 1))) { console.error('--feeders bet:count,... and --chase bet,threshold[,perTick] in whole cents'); process.exit(1); }
    const per = Array.from({ length: threads }, () => []); for (let k = 0; k < nB; k++) per[k % threads].push(k);
    Promise.all(per.filter((c) => c.length).map((chunks) => new Promise((res, rej) => { const w = new Worker(__filename, { workerData: { cfg, chunks, mode: 'room', size: 0, baseSeed: seedR, room: { ticks, classes, threshold, perTick } } }); w.once('message', res); w.once('error', rej); }))).then((parts) => {
      const bs = parts.flat().sort((a, b) => a.k - b.k), n = bs.length, seedC = cfg.pull.pot.seed;
      const o = { mode: 'pot-room', ticks, seed: seedR, batches: n, feeders: classes.filter((c) => !c.chase), chase: threshold || classes.some((c) => c.chase) ? { bet: (classes.find((c) => c.chase) || {}).bet, threshold, perTick } : null, rule: { ...cfg.pull.pot }, secs: (Date.now() - t0) / 1000, classes: [] };
      const conserved = bs.every((b) => b.pot.fed + b.pot.seeded === b.pot.paid + b.pot.left);
      classes.forEach((c, i) => {
        const g = (key) => bs.reduce((a, b) => a + b.cls[i][key], 0), stake = g('stake'), paid = g('paid'), R = stake ? paid / stake : 0;
        const dev = bs.reduce((a, b) => a + Math.pow(b.cls[i].paid - R * b.cls[i].stake, 2), 0), se = stake && n > 1 ? Math.sqrt(dev * n / (n - 1)) / stake : 0;
        const expC = g('exp'), devE = bs.reduce((a, b) => a + Math.pow(b.cls[i].exp - (stake ? expC / stake : 0) * b.cls[i].stake, 2), 0), seE = stake && n > 1 ? Math.sqrt(devE * n / (n - 1)) / stake : 0;
        const hits = g('hits'), sumX = g('sumX');
        o.classes.push({ role: c.chase ? 'chaser' : 'feeder', bet: c.bet, players: c.chase ? 1 : c.n, spins: g('spins'), stakeCents: stake, paidCents: paid, potPct: R * 100, potCi: 196 * se, expPct: stake ? expC / stake * 100 : 0, expCi: 196 * seE, hits, avgPrizeBets: hits ? sumX / hits : null, maxPrizeBets: bs.reduce((a, b) => Math.max(a, b.cls[i].maxX), 0) });
      });
      o.pot = { fedCents: bs.reduce((a, b) => a + b.pot.fed, 0), seededCents: bs.reduce((a, b) => a + b.pot.seeded, 0), paidCents: bs.reduce((a, b) => a + b.pot.paid, 0), leftCents: bs.reduce((a, b) => a + b.pot.left, 0), hits: bs.reduce((a, b) => a + b.pot.hits, 0), avgBalCents: bs.reduce((a, b) => a + b.pot.avgBal, 0) / n, maxBalCents: bs.reduce((a, b) => Math.max(a, b.pot.maxBal), 0), conserved };
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      if (asJson) return console.log(JSON.stringify(o));
      console.log(`COLD CALL --pot-room: ${n} rooms x ${ticks} ticks, feeders ${classes.filter((c) => !c.chase).map((c) => c.n + ' x ' + c.bet + 'c').join(', ')}, ${o.chase ? 'chaser ' + o.chase.bet + 'c while pot >= ' + o.chase.threshold + 'c (' + o.chase.perTick + ' a tick)' : 'no chaser'}, rule ${JSON.stringify(o.rule)}, seed ${seedR}, ${f(o.secs, 1)}s`);
      for (const c of o.classes) console.log(`  ${c.role.padEnd(7)} ${String(c.bet).padStart(5)}c  spins ${c.spins}  stake ${(c.stakeCents / 100).toFixed(0)}  pot part ${f(c.potPct, 3)}% +- ${f(c.potCi, 3)} (expected-prize estimate ${f(c.expPct, 3)}% +- ${f(c.expCi, 3)})  hits ${c.hits}  prize avg ${f(c.avgPrizeBets, 1)} bets, largest ${f(c.maxPrizeBets, 1)} bets`);
      console.log(`  pot             fed ${o.pot.fedCents} seed ${o.pot.seededCents} paid ${o.pot.paidCents} left ${o.pot.leftCents} (cents, all rooms); average balance ${f(o.pot.avgBalCents / 100)}  largest ${f(o.pot.maxBalCents / 100)}; fed + seeded = paid + left: ${conserved ? 'YES, to the cent' : 'NO'}`);
    }).catch((e) => { console.error(e); process.exit(1); });
    return;
  }
  if (bool('--buys-pull')) {
    const bet = +betArg || 100, f = (x, d = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(d)), t0 = Date.now();
    const pickpolicy = pickArg && pickArg !== true ? pickArg : 'best', more = moreArg && moreArg !== true ? moreArg : 'bank';
    if (!['first', 'best', 'none'].includes(pickpolicy) || !['bank', 'take', 'bankup', 'takeup'].includes(more) || !Eng.BET_LEVELS.includes(bet)) { console.error('--bet one of ' + Eng.BET_LEVELS.join(','), '--pickpolicy first|best|none, --more bank|take|bankup|takeup'); process.exit(1); }
    const runs = nums[0] || 1000000, seedB = nums[1] || 1, size = Math.max(1, Math.min(CHUNK, Math.ceil(runs / 20))), nChunks = Math.ceil(runs / size), per = Array.from({ length: threads }, () => []); for (let k = 0; k < nChunks; k++) per[k % threads].push(k);      // at least 20 chunks for the interval
    const meanSe = (arr) => { const n = arr.length, m = arr.reduce((a, b) => a + b, 0) / n, v = n > 1 ? arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1) : 0; return { mean: m, se: Math.sqrt(v / n) }; };
    Promise.all(per.filter((c) => c.length).map((chunks) => new Promise((res, rej) => { const w = new Worker(__filename, { workerData: { cfg, chunks, bet, mode: 'buyspull', size, baseSeed: seedB, buyOpts: { only: ONLY, pickpolicy, more } } }); w.once('message', res); w.once('error', rej); }))).then((parts) => {
      const o = { mode: 'buys-pull', runsPerBuy: nChunks * size, seed: seedB, bet, pickpolicy, more, secs: (Date.now() - t0) / 1000, buys: {} };
      for (const b of ONLY) {
        const acc = parts.map((p) => p[b]), g = (k) => acc.reduce((a, x) => a + x[k], 0), cs = acc.flatMap((x) => x.chunks), sc = Eng.scaleOf(cfg.buyCost[b], bet);
        const paid = meanSe(cs.map((c) => c.paid / c.price * 100)), exact = meanSe(cs.map((c) => c.wt / c.ct * 100)), drift = meanSe(cs.map((c) => (c.paid / c.price - c.wt / c.ct) * 100)), dgN = g('dgN');
        o.buys[b] = { priceCents: sc.price, exactPriceCents: cfg.buyCost[b] * bet / 10, stakeCentsPerBet: sc.num * 10 / sc.den, paidPct: g('paid') / g('price') * 100, paidCi: 1.96 * paid.se, exactPct: g('wt') / g('ct') * 100, exactCi: 1.96 * exact.se, driftPct: (g('paid') / g('price') - g('wt') / g('ct')) * 100, driftCi: 1.96 * drift.se,
          avgWinCents: g('paid') / g('n'), bonusRate: g('bonus') / g('n'), capHits: g('cap'), ledgerGainCents: dgN ? g('dgSum') / dgN : null, ledgerOffers: dgN };
      }
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      if (asJson) return console.log(JSON.stringify(o));
      console.log(`COLD CALL --buys-pull: ${o.runsPerBuy} rounds per buy at ${bet}c, pick ${pickpolicy}, gamble ${more}, seed ${seedB}, ${threads} threads, ${f(o.secs, 1)}s`);
      for (const b of ONLY) { const x = o.buys[b]; console.log(`  ${b.padEnd(7)} price ${x.priceCents}c (exact ${f(x.exactPriceCents, 1)}c, played at ${f(x.stakeCentsPerBet, 3)}c per 10 tenths)  paid payback ${f(x.paidPct, 3)}% +- ${f(x.paidCi, 3)}  exact ${f(x.exactPct, 3)}% +- ${f(x.exactCi, 3)}  paid - exact ${f(x.driftPct, 4)}% +- ${f(x.driftCi, 4)}  avg win ${f(x.avgWinCents, 3)}c  bonus on ${f(x.bonusRate * 100, 3)}%  cap hits ${x.capHits}  ledger ${x.ledgerGainCents === null ? 'n/a' : f(x.ledgerGainCents, 5) + 'c/offer (' + x.ledgerOffers + ')'}`); }
    }).catch((e) => { console.error(e); process.exit(1); });
    return;
  }
  if (pullMode || bonusMode) {
    const bet = +betArg || 100, f = (x, d = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(d)), t0 = Date.now();
    const pickpolicy = pickArg && pickArg !== true ? pickArg : 'first', more = moreArg && moreArg !== true ? moreArg : 'bank';
    if (!['first', 'best', 'none'].includes(pickpolicy) || !['bank', 'take', 'bankup', 'takeup'].includes(more)) { console.error('--pickpolicy first|best|none, --more bank|take|bankup|takeup'); process.exit(1); }
    let betMix = null;
    if (betMixArg) { const m = String(betMixArg).split(',').map(Number); if (m.length < 2 || !(m[0] > 0) || !(m[1] > m[0]) || (m.length > 2 && !Number.isFinite(m[2]))) { console.error('--bet-mix lo,hi[,T] in cents, 0 < lo < hi'); process.exit(1); } betMix = { lo: m[0], hi: m[1], T: m.length > 2 ? m[2] : m[1] < 10 || m[0] + m[1] < 20 ? (m[0] + m[1]) / 2 + 0.05 : Math.floor((m[0] + m[1]) / 20) * 10 + 5.5 }; }
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
    spawn(per, { mode: 'pull', size: 0, baseSeed: seedP, pullOpts: { sessions: perChunk, spins, pickpolicy, more, warmdiff: !noWarmDiff, fresh: freshArg, betSwitch: betSwitchArg, betMix } }).then((parts) => {
      const chunks = parts.flat().sort((a, b) => a.k - b.k), P = cfg.pull;
      const sum = (key, which = 'on') => chunks.reduce((a, c) => a + c[which][key], 0);
      const paid = sum('paid');
      const pctOf = (c, key) => c[key] / c.stakeCents * 100;                       // percent of stake: real cents won over real cents staked (the Callback is valued at its own bet)
      const potPct = (c) => c.pot.paid / c.stakeCents * 100;                       // what the pot actually paid out (seed money included); the fed slice is only an assumption
      const partVec = { cluster: [], basePhone: [], natBonus: [], callbackBonus: [], moreNet: [], pot: [], total: [] };
      const rtpOf = (c) => pctOf(c, 'cluster') + pctOf(c, 'phone') + pctOf(c, 'nat') + pctOf(c, 'cb') + pctOf(c, 'moreNet') + potPct(c);
      for (const { on: c } of chunks) {
        partVec.cluster.push(pctOf(c, 'cluster')); partVec.basePhone.push(pctOf(c, 'phone')); partVec.natBonus.push(pctOf(c, 'nat')); partVec.callbackBonus.push(pctOf(c, 'cb')); partVec.moreNet.push(pctOf(c, 'moreNet')); partVec.pot.push(potPct(c)); partVec.total.push(rtpOf(c));
      }
      const parts_ = {}; for (const k of Object.keys(partVec)) { const m = meanSe(partVec[k]); parts_[k] = { pct: m.mean, ci: 1.96 * m.se }; }
      const hist = new Array(3001).fill(0); for (const c of chunks) c.on.armHist.forEach((v, i) => { hist[i] += v; });
      const arms = hist.reduce((a, b) => a + b, 0), q = (p) => { let acc = 0; for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= p * arms) return i; } return hist.length - 1; };
      const meanSpinsPerCb = arms ? hist.reduce((a, v, i) => a + v * i, 0) / arms : null;
      const leads = sum('filled') / 10, cbCents = sum('cb'), cbBonusT = sum('cbT'), cbRounds = sum('cbRounds'), stakeAll = sum('stakeCents'), bet0 = bet;
      const g = { n: 0, sum: 0, nz: 0, ge10: 0, ge100: 0, max: 0 }; for (const c of chunks) { const x = c.on.ghost; g.n += x.n; g.sum += x.sum; g.nz += x.nz; g.ge10 += x.ge10; g.ge100 += x.ge100; g.max = Math.max(g.max, x.max); }
      const potHits = chunks.reduce((a, c) => a + c.on.pot.hits, 0), potBal = chunks.reduce((a, c) => a + c.on.pot.balAtHit, 0), potPaid = chunks.reduce((a, c) => a + c.on.pot.paid, 0), potFed = chunks.reduce((a, c) => a + c.on.pot.fed, 0), potSeeded = chunks.reduce((a, c) => a + c.on.pot.seeded, 0), potLeft = chunks.reduce((a, c) => a + c.on.pot.bal, 0);
      let warmDiff = null;
      if (!noWarmDiff) { const d = chunks.map((c) => rtpOf(c.on) - rtpOf(c.off)), m = meanSe(d); const dp = meanSe(chunks.map((c) => pctOf(c.on, 'phone') - pctOf(c.off, 'phone'))), dl = meanSe(chunks.map((c) => c.on.filled / c.on.paid - c.off.filled / c.off.paid)); warmDiff = { onPct: parts_.total.pct, offPct: meanSe(chunks.map((c) => rtpOf(c.off))).mean, diffPct: m.mean, ci: 1.96 * m.se, basePhoneDiffPct: dp.mean, basePhoneCi: 1.96 * dp.se, leadsPerSpinDiff: dl.mean }; }
      const ends = sum('ends'), sw = betSwitchArg ? { loPct: sum('loStake') ? sum('loBack') / sum('loStake') * 100 : null, hiPct: sum('hiStake') ? sum('hiBack') / sum('hiStake') * 100 : null, hiSpins: sum('hiSpins'), droppedPct: sum('dropStake') ? sum('dropBack') / sum('dropStake') * 100 : null, droppedSpins: sum('dropSpins'), hiSharePct: sum('hiSpins') / paid * 100, loBet: 10, hiBet: 2500 } : null;
      const o = { mode: 'pull', sessions: totalSessions, spinsPerSession: spins, paidSpins: paid, seed: seedP, bet, pickpolicy, more, carry: !freshArg, betSwitch: sw, betMix: betMix ? Object.assign({ avgStakeCents: stakeAll / paid, cbAvgBetCents: cbRounds ? sum('cbBetSum') / cbRounds : null }, betMix) : null, secs: (Date.now() - t0) / 1000, batches: chunks.length,
        parts: parts_, rtpPct: parts_.total.pct, rtpCi: parts_.total.ci,
        callback: { arms, perHundredSpins: arms / paid * 100, spinsPer: { mean: meanSpinsPerCb, p10: q(0.1), median: q(0.5), p90: q(0.9) }, rounds: cbRounds, avgBonusX: cbRounds ? cbBonusT / cbRounds / 10 : null, avgBetCents: cbRounds ? sum('cbBetSum') / cbRounds : null, playedUnderNominal: betSwitchArg ? null : sum('cbUnder') },
        leftOver: { points: ends, avgLeads: ends ? sum('leftLt') / 10 / ends : null, callbacksWaiting: sum('leftCb'), at: freshArg ? 'end of every session (thrown away)' : 'end of every batch (carried until then)' },
        deadShare: sum('dead') / paid, winShare: sum('win') / paid, bonusOneIn: sum('natBonuses') ? paid / sum('natBonuses') : null, capHits: sum('capHits'),
        warm: { markedNoPhonePer100: sum('marked') / paid * 100, createdPerSpin: sum('warmCreated') / paid, spinsWithWarmPer100: sum('warmSpins') / paid * 100, phoneOnWarmPer100: sum('warmPhone') / paid * 100, avgPhonePayOnWarmX: sum('warmPhone') ? sum('warmPhonePay') / sum('warmPhone') / 10 : null, diff: warmDiff },
        ghost: { per100: g.n / paid * 100, avgPayX: g.n ? g.sum / g.n / 10 : null, shareNonZero: g.n ? g.nz / g.n : null, shareGe1x: g.n ? g.ge10 / g.n : null, shareGe10x: g.n ? g.ge100 / g.n : null, maxX: g.max / 10 },
        leads: { filledTotal: leads, perPaidSpin: leads / paid, callbackValuePerLeadX: leads ? cbCents / bet0 / leads : null, callbackPartPct: parts_.callbackBonus.pct },
        decisions: { picksPer100: sum('picks') / paid * 100, offersPer100: sum('offers') / paid * 100, takesPer100: sum('takes') / paid * 100, takeWinRate: sum('takes') ? sum('takeWins') / sum('takes') : null },
        paidCents: { paidPct: sum('paidCents') / stakeAll * 100, exactPct: sum('exactCents') / stakeAll * 100, driftPct: (sum('paidCents') - sum('exactCents')) / stakeAll * 100, ci: 1.96 * meanSe(chunks.map((c) => (c.on.paidCents - c.on.exactCents) / c.on.stakeCents * 100)).se, paidTotalPct: sum('paidCents') / stakeAll * 100, paidTotalCi: 1.96 * meanSe(chunks.map((c) => c.on.paidCents / c.on.stakeCents * 100)).se },
        decisionLedger: (() => { const n = sum('dgN'), m = n ? sum('dgSum') / n : null, ms = meanSe(chunks.filter((c) => c.on.dgN).map((c) => c.on.dgSum / c.on.dgN)); return { decisions: n, meanGainCents: m, ci: 1.96 * ms.se, upShare: n ? sum('dgUp') / n : null, takeShare: n ? sum('dgTake') / n : null, sdCents: n ? Math.sqrt(Math.max(0, sum('dgSq') / n - m * m)) : null, note: 'per ONE MORE CALL offer: (EV of the option the policy took, from the shown cents) - (exact value of banking), in cents; 0 for a design that cannot be gamed by reading the shown amount' }; })(),
        pot: { hitsPer1M: potHits / paid * 1e6, avgBalAtHitCents: potHits ? potBal / potHits : null, paidPctOfStake: potPaid / stakeAll * 100, fedPctOfStake: potFed / stakeAll * 100, seededPctOfStake: potSeeded / stakeAll * 100, leftInPotCents: potLeft, note: 'one shared pot per batch, server rule (bal kept above the cap, seed after a hit, minBal); the RTP part is what the pot PAID (seed money included), not the fed slice' } };
      if (outFile) fs.writeFileSync(outFile, JSON.stringify(o));
      if (asJson) return console.log(JSON.stringify(o));
      console.log(`COLD CALL --pull: ${totalSessions} sessions x ${spins} paid spins = ${paid} paid spins, ${betSwitchArg ? 'bet SWITCH 10c/2500c (F1 attacker)' : betMix ? 'bet MIX ' + betMix.lo + 'c/' + betMix.hi + 'c, hi while average < ' + betMix.T + 'c (N1 attacker)' : 'flat bet ' + bet + 'c'}, ${freshArg ? 'FRESH sessions' : 'state carried across sessions'}, pick ${pickpolicy}, gamble ${more}, seed ${seedP}, ${threads} threads, ${chunks.length} batches, ${f(o.secs, 1)}s`);
      console.log(`  total payback   ${f(o.rtpPct, 3)}% +- ${f(o.rtpCi, 3)} (95%, by batch means, per PAID spin, money in real cents; Callback rounds are free)`);
      console.log(`  paid cents      wallet gets ${f(o.paidCents.paidPct, 3)}% of stake (+-${f(o.paidCents.paidTotalCi, 3)}) incl. Callback, ex pot; exact value of the same rounds ${f(o.paidCents.exactPct, 3)}%; rounding drift ${f(o.paidCents.driftPct, 4)}% +- ${f(o.paidCents.ci, 4)} (should be 0)`);
      const dl = o.decisionLedger; console.log(`  decision ledger ${dl.decisions} ONE MORE CALL offers (${dl.upShare === null ? 'n/a' : f(dl.upShare * 100, 1)}% shown rounded up, taken ${dl.takeShare === null ? 'n/a' : f(dl.takeShare * 100, 1)}%): policy ${more} gains ${dl.meanGainCents === null ? 'n/a' : f(dl.meanGainCents, 5)} cents per offer +- ${f(dl.ci, 5)} (sd ${dl.sdCents === null ? 'n/a' : f(dl.sdCents, 3)}); 0 = the shown amount tells nothing`);
      const pp = o.parts; console.log(`  by part         base clusters ${f(pp.cluster.pct)}%  base phone ${f(pp.basePhone.pct)}%  natural bonus ${f(pp.natBonus.pct)}% (+-${f(pp.natBonus.ci, 3)})  Callback bonus ${f(pp.callbackBonus.pct)}% (+-${f(pp.callbackBonus.ci, 3)})  ONE MORE CALL net ${f(pp.moreNet.pct, 3)}% (+-${f(pp.moreNet.ci, 3)})  pot paid ${f(pp.pot.pct, 3)}% (+-${f(pp.pot.ci, 3)})`);
      console.log(`  Callback        ${f(o.callback.perHundredSpins, 3)} per 100 paid spins; spins per Callback mean ${f(o.callback.spinsPer.mean, 1)}  P10 ${o.callback.spinsPer.p10}  median ${o.callback.spinsPer.median}  P90 ${o.callback.spinsPer.p90}; avg Callback bonus ${f(o.callback.avgBonusX, 2)}x of its own bet; avg Callback bet ${f(o.callback.avgBetCents, 1)}c${o.callback.playedUnderNominal === null ? '' : ', ' + o.callback.playedUnderNominal + ' of ' + o.callback.rounds + ' played under the nominal bet'}`);
      const lo = o.leftOver; console.log(`  left over       ${f(lo.avgLeads, 1)} leads on average and ${lo.callbacksWaiting} of ${lo.points} Callbacks still waiting at the ${lo.at}`);
      if (o.betSwitch) console.log(`  bet switch      spins at 10c payback ${f(o.betSwitch.loPct)}% (base + natural bonus + ONE MORE CALL, no Callback/pot); the ${o.betSwitch.hiSpins} spins at $25 (${f(o.betSwitch.hiSharePct, 2)}% of spins) payback ${f(o.betSwitch.hiPct)}%, of which the ${o.betSwitch.droppedSpins} attack spins (warm squares made at 10c, dropped at $25) pay ${o.betSwitch.droppedPct === null ? 'n/a' : f(o.betSwitch.droppedPct) + '%'} and the rest are a same-bet $25 chain (warm made at $25 honoured at $25); warm squares dropped on a bet change ${sum('warmDropped')}`);
      if (o.betMix) console.log(`  bet mix         average stake ${f(o.betMix.avgStakeCents, 2)}c a paid spin, average Callback bet ${f(o.betMix.cbAvgBetCents, 2)}c (a floor of the lead-weighted average plus the carry: the Callback is worth ${f(o.betMix.cbAvgBetCents / o.betMix.avgStakeCents * 100, 1)}% of what the leads were staked at)`);
      console.log(`  spins           dead ${f(o.deadShare * 100, 2)}%  paid base ${f(o.winShare * 100, 2)}%  natural bonus 1 in ${f(o.bonusOneIn, 0)}  cap hits ${o.capHits}  leads worked ${f(o.leads.perPaidSpin, 3)} per paid spin  value per lead ${f(o.leads.callbackValuePerLeadX, 4)}x bet (Callback part ${f(o.leads.callbackPartPct, 2)}% of stake)`);
      const w = o.warm; console.log(`  warm            marked-no-phone spins ${f(w.markedNoPhonePer100, 2)} per 100; warm squares created ${f(w.createdPerSpin, 3)} per spin; spins starting with warm ${f(w.spinsWithWarmPer100, 2)} per 100; phone features fired on warm squares ${f(w.phoneOnWarmPer100, 3)} per 100 (avg pay ${w.avgPhonePayOnWarmX === null ? 'n/a' : f(w.avgPhonePayOnWarmX, 2) + 'x'})`);
      if (w.diff) console.log(`  warm payback    with ${f(w.diff.onPct, 3)}%  without (chance 0) ${f(w.diff.offPct, 3)}%  -> total differs by ${f(w.diff.diffPct, 3)}% +- ${f(w.diff.ci, 3)} (95%, batches of the same seeds; noisy: Callback and bonus tails); base phone part alone ${f(w.diff.basePhoneDiffPct, 3)}% +- ${f(w.diff.basePhoneCi, 3)}; leads per spin ${f(w.diff.leadsPerSpinDiff, 4)} (warm hits turn dead spins into paid ones)`);
      const gh = o.ghost; console.log(`  ghost           ${f(gh.per100, 2)} per 100 spins; avg shown ${gh.avgPayX === null ? 'n/a' : f(gh.avgPayX, 2) + 'x'}; pay > 0 ${gh.shareNonZero === null ? 'n/a' : f(gh.shareNonZero * 100, 1) + '%'}; >= 1x ${gh.shareGe1x === null ? 'n/a' : f(gh.shareGe1x * 100, 1) + '%'}; >= 10x ${gh.shareGe10x === null ? 'n/a' : f(gh.shareGe10x * 100, 2) + '%'}; max ${f(gh.maxX, 1)}x`);
      const d = o.decisions; console.log(`  decisions       picks ${f(d.picksPer100, 3)} per 100 spins; ONE MORE CALL offered ${f(d.offersPer100, 3)} per 100, taken ${f(d.takesPer100, 3)} per 100${d.takeWinRate === null ? '' : ', win rate ' + f(d.takeWinRate * 100, 2) + '%'}`);
      console.log(`  pot             ${f(o.pot.hitsPer1M, 1)} hits per 1M spins; avg pot at hit ${o.pot.avgBalAtHitCents === null ? 'n/a' : f(o.pot.avgBalAtHitCents / 100, 2) + ' (bet units: ' + f(o.pot.avgBalAtHitCents / bet, 1) + 'x bet)'}; fed ${f(o.pot.fedPctOfStake, 3)}% of stake, seed ${f(o.pot.seededPctOfStake, 3)}%, paid out ${f(o.pot.paidPctOfStake, 3)}%, ${f(o.pot.leftInPotCents / 100, 2)} left in the pot at the end`);
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
