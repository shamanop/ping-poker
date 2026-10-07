/* COLD CALL engine v2 (Le Bandit rules, Cold Call names): pure math, no DOM, no node-only APIs. Used by the server
   (games/coldcall.js), the sim, and (byte-identical copy at public/games/coldcall/engine.js) the browser for animation only.
   A paid round is a pure function of (rng, buy): it resolves the whole round (base spin, cascades, hot leads, phone feature,
   bonuses) into a win in whole TENTHS of the bet plus a replayable script. The contract is cold-call/ENGINE-V2.md.
   Inside the engine money is never rounded: every pay, bubble value, multiplier and close value is an integer number of tenths of the bet.
   Cents: win cents = winTenths * bet / 10 is an exact integer at every bet of 10 cents or more. At 1c / 2c / 5c (DENOMS, cold-call/PULL-ENGINE.md section 7) a win can be a fraction
   of a cent: it is paid by unbiased rounding (floor, plus one cent with probability = the fraction; roundCents), the random number is an ARGUMENT (input.rnd, never the round's own stream).
   Grid: 6 columns x 5 rows, flat array of 30, pos = row * 6 + col, row 0 on top. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ColdCallEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 6, ROWS = 5, N = 30, MIN_CLUSTER = 5, MAX_WIN_X = 10000, MAX_WIN_T = MAX_WIN_X * 10;
  const BET_LEVELS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2500];
  // symbol ids: regular 0..9 (low 0-4, high 5-9), then closer (wild), bell (scatter), phone ("the call connects")
  const SYM = ['mug', 'note', 'ball', 'can', 'cups', 'headset', 'rx', 'pile', 'cashwad', 'cash', 'closer', 'bell', 'phone'];
  const NREG = 10, WILD = 10, BELL = 11, PHONE = 12, NSYM = 13;
  const MODES = ['base', 'bonus1', 'bonus2', 'bonus3'];
  const BUYS = ['call', 'bonus1', 'bonus2', 'hunt'];
  const FORCES = ['bonus1', 'bonus2', 'bonus3', 'phone', 'close', 'big', 'tease'];
  const TIER_NAMES = ['bronze', 'silver', 'gold'];

  /* ---------------------------------------------------------------- LEVERS (tune here) ---------------------------------
     All money numbers are integers in TENTHS of the bet (10 = 1.0x bet). */
  const CFG = {
    // cell weights of the 10 regular symbols (order = SYM): mug note ball can cups headset rx pile cashwad cash
    weights: [29.925, 25.552, 20.828, 17.21, 13.464, 10.034, 8.159, 6.436, 5.001, 3.79],
    // closer (wild), bell (scatter) and phone weights per cell, per mode (a phone is also guaranteed on every bonus3 spin and on a 'call' buy)
    extra: {
      base: { wild: 1, bell: 1.175, phone: 0.2275 },   // levers Part 3 (2026-10-06): bell 1.52 -> 1.175 pays for the Callback, phone 0.308 -> 0.2275 pays for warm squares (cold-call/LEVERS.md section 8)
      bonus1: { wild: 5, bell: 1.567, phone: 4.5 },
      bonus2: { wild: 3, bell: 1.567, phone: 4.5 },
      bonus3: { wild: 2, bell: 1.567, phone: 3 },
    },
    // cluster pay in tenths of the bet by cluster size: 5, 6, 7, 8, 9, 10, 11, 12, 13+  (mug 5 pays 0.3x, every other 5 pays 1x to 1.8x; 13+ pays 130x to 715x)
    pay: {
      mug:     [3, 10, 10, 11, 16, 50, 140, 450, 1300],
      note:    [10, 10, 11, 13, 18, 55, 154, 495, 1430],
      ball:    [10, 10, 12, 14, 22, 60, 168, 540, 1560],
      can:     [10, 10, 13, 17, 26, 68, 189, 608, 1755],
      cups:    [10, 10, 16, 20, 30, 78, 217, 698, 2015],
      headset: [11, 11, 18, 24, 38, 93, 259, 833, 2405],
      rx:      [12, 12, 22, 30, 46, 115, 322, 1035, 2990],
      pile:    [13, 13, 30, 40, 62, 150, 420, 1350, 3900],
      cashwad: [15, 15, 46, 60, 96, 200, 560, 1800, 5200],
      cash   : [18, 18, 63, 83, 132, 275, 770, 2475, 7150],
    },
    payScale: 1,   // applied once when the engine is built (rounded to integer tenths, min 1); 1 = the table as written
    // hot lead reveals: tier weights per mode (bonus3 has no bronze), optional per-mode value weights (bubbles), values in tenths of the bet
    reveal: {
      base: { bronze: 100, silver: 2.95, gold: 0.2, upsell: 6, close: 0.6 },
      bonus1: { bronze: 100, silver: 19, gold: 1.9, upsell: 9, close: 0.6 },
      bonus2: { bronze: 100, silver: 11, gold: 0.9, upsell: 9, close: 0.2 },
      bonus3: { bronze: 0, silver: 5.5, gold: 0.05, upsell: 0.5, close: 0.004,
        bubbles: { silver: [[50, 75], [100, 15], [150, 7], [200, 3]], gold: [[250, 60], [500, 25], [1000, 10], [2500, 4], [5000, 1]] } },
    },
    bubbles: {
      bronze: [[2, 30], [5, 28], [10, 20], [20, 10], [30, 7], [40, 5]],           // 0.2 0.5 1 2 3 4 x bet
      silver: [[50, 40], [100, 30], [150, 18], [200, 12]],                         // 5 10 15 20 x
      gold: [[250, 45], [500, 30], [1000, 17], [2500, 6], [5000, 2]],              // 25 50 100 250 500 x
    },
    upsell: [[2, 40], [3, 28], [4, 17], [5, 10], [10, 5]],                         // multiplier, weight
    adjacency: 4,                // upsell reaches this many neighbours (4 = up/down/left/right; 8 adds the diagonals, tail too hot: see ENGINE-V2.md)
    spins: { bonus1: 8, bonus2: 12, bonus3: 12 },
    retrigger: { two: 2, three: 4, upgrade: 4 },   // 2 bells +2 spins, 3 bells +4, 4 bells in bonus1 = upgrade to bonus2 +4
    maxSpins: 40,                // cap on the total free spins of one bonus (start + added)
    maxCascades: 40,             // hard cap on cascade steps in one spin
    maxRevealRounds: 30,         // hard cap on the reveal / close repeat loop (it cannot pass the number of hot leads anyway)
    // buy prices, tenths of the bet. Set from the measured average value / 0.98 (rounded to a whole tenth), then re-simulated.
    buyCost: { call: 27, bonus1: 964, bonus2: 2910, hunt: 20 },   // levers Part 3: repriced for the new bell weight and for PICK (best-pick average / 0.98), LEVERS.md 8.5
    hunt: { bellMult: 1.845 },     // 'hunt': one spin whose bell weight is multiplied (base game otherwise)
    maxWinTenths: MAX_WIN_T,
    // THE PULL (cold-call/PULL.md, PULL-ENGINE.md): per-player memory, decisions and the floor. Money in tenths of the bet, leads in whole leads (one decimal at most),
    // pot money in cents. The VALUES are provisional (the levers agent sets them); the mechanisms are the engine's. pull.on = false is the old stateless game.
    pull: {
      on: true,
      list: 450,                                    // leads for THE CALLBACK: one about every 422 paid spins (LEVERS.md 8.1)
      fill: { dead: 1.2, win: 0.6, bonus: 0.6 },    // leads per paid base spin: round paid 0 / paid > 0 / triggered a natural bonus (dead must stay > win)
      callback: { kind: 'bonus1' },                 // 'bonus1' | 'bonus2'; played free at cb.bet, no base spin, never fills the list
      carryOver: true,                              // leads above the list size stay for the next list
      cold: { afterMs: 129600000, stepMs: 43200000, batch: 8, floor: 300 },   // idle 36 h, then `batch` leads go cold every 12 h, never below `floor`; warm squares die at the first event
      warm: { chance: 0.35, cap: 4 },               // per marked square of a base spin that ended with marked squares and no phone
      ghost: { on: true, maxWinTenths: 10, minTenths: 50 },   // IF A PHONE HAD LANDED: a real phone feature on a sub-rng, pay never added; shown on a spin that paid under 1x, only if it would have paid >= 5x (about 6 spins in 100)
      pick: { on: true, minLeads: 2, mult: { bronze: 0.3, silver: 2, gold: 3, upsell: 1, close: 1 } },   // PICK YOUR LEAD: tier weights of the picked square x mult
      more: { on: true, mult: 2, rtp: 1.0, minTenths: 50 },   // ONE MORE CALL: a fair coin, wins with probability rtp / mult = 1/2, pays bonus x mult, else 0; offered from a 5x bonus up
      daily: { base: 0.2, perStreak: 0.05, streakMax: 4, stakeCap: 10 },   // free leads on the first paid spin of a day: 0.2 to 0.4 of a lead, worked at 10 cents: a ritual, not money (critic N2: 8 to 24 leads paid a once-a-day $1 player about $5 a day; this pays about a cent), LEVERS.md 8.8
      pot: { feedBps: 100, oneInPerDollar: 3000, seed: 0, minBal: 1000, capCents: 5000 },   // server only (cents, basis points); seed stays 0 (W9); capCents = the most one hit pays, in money, the same for every bet: capCents / 100 / oneInPerDollar = 1.67% is the most a pot chaser can add at ANY bet (W8, 8.11); keep capCents >= feedBps x oneInPerDollar / 100 (3000), or the pot cannot pay out what it is fed
      feed: { minWinX: 100, minWinCents: 500 },     // server only: a win goes to the room feed when it is >= minWinX x bet AND >= minWinCents (a 100x win at 1c is one dollar: not a room event)
      decision: { timeoutMs: 20000 },               // server only
    },
  };
  const TIERS = [[100, 'legend'], [50, 'mega'], [25, 'huge'], [10, 'big'], [5, 'sweet'], [2, 'nice']];
  function winTier(winX) { for (const [x, name] of TIERS) if (winX >= x) return name; return 'none'; }

  // sfc32 seeded through splitmix32: 128-bit state, so streams from different seeds do not overlap in any sim
  function rngFrom(seed) {
    let s = seed >>> 0;
    const sm = () => { s = (s + 0x9E3779B9) | 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B); z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35); return (z ^ (z >>> 16)) >>> 0; };
    let a = sm(), b = sm(), c = sm(), d = sm();
    for (let i = 0; i < 12; i++) { const t = (a + b | 0) + d | 0; d = d + 1 | 0; a = b ^ (b >>> 9); b = c + (c << 3) | 0; c = (c << 21 | c >>> 11) + t | 0; }
    return function () { const t = (a + b | 0) + d | 0; d = d + 1 | 0; a = b ^ (b >>> 9); b = c + (c << 3) | 0; c = (c << 21 | c >>> 11) + t | 0; return (t >>> 0) / 4294967296; };
  }

  // neighbour tables (flat positions)
  const NB4 = [], NB8 = [];
  for (let p = 0; p < N; p++) {
    const r = (p / COLS) | 0, c = p % COLS, a = [], b = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= ROWS || cc >= COLS) continue;
      b.push(rr * COLS + cc); if (!dr || !dc) a.push(rr * COLS + cc);
    }
    NB4.push(a); NB8.push(b);
  }
  const bucket = (n) => (n >= 13 ? 8 : n - 5);

  // cumulative table over [value, weight] outcomes
  function cumOf(ws) { const tot = ws.reduce((a, b) => a + b, 0); const cum = []; let c = 0; for (const w of ws) { c += w / tot; cum.push(c); } cum[cum.length - 1] = 1; return cum; }
  function pickCum(rng, cum) { const x = rng(); let i = 0; while (x >= cum[i] && i < cum.length - 1) i++; return i; }

  /* ---------------------------------------------------- THE PULL: player state helpers (pure, no clock of their own) ----------------------------------------------------
     state = { v, lt (tenths of a lead), avg (cents, lead-weighted), cb: null | { bet }, warm: [positions], warmBet (cents the warm squares were made at, 0 = none), coldAt: null | ms, day, streak, rounds, callbacks, carry (cents, [0, 10): the part of the lead stake the last Callback bet could not carry, see cbArm) }. */
  function newState() { return { v: 1, lt: 0, avg: 0, cb: null, warm: [], warmBet: 0, coldAt: null, day: null, streak: 0, rounds: 0, callbacks: 0, carry: 0 }; }
  // a stored carry is a finite number in [0, 10) cents; anything else (missing, NaN, negative, text, 10 or more) reads as 0
  const cleanCarry = (c) => (typeof c === 'number' && c > 0 && c < 10 ? c : 0);
  const cloneState = (st) => Object.assign({}, st, { warm: st.warm.slice(), cb: st.cb ? Object.assign({}, st.cb) : null, carry: cleanCarry(st.carry) });
  // the Callback is played at the lead-weighted average bet ROUNDED DOWN to a whole step, in [1, max bet level]: leads earned small cannot fire a big bet,
  // and a few cheap leads (the daily gift) cannot knock a big bettor down a whole bet level. Below an average of 10 cents the step is 1 cent (DENOMS: 1c / 2c / 5c bettors),
  // from 10 cents up it is EXACTLY the old rule (step 10); any whole number of cents in [1, 2500] is a legal Eng.cents-exact Callback bet.
  // Floor, never nearest (W1B N1): nearest let a player who mixes bet sizes sit just over a half step and arm every Callback up to half a step above what the leads were
  // worth. With the floor, cb.bet <= the average always, so no bet mix gains; a flat bettor whose average is already a whole step is exact (1e-9 absorbs float noise).
  // FLOOR + CARRY (N1-CARRY): the floor alone threw the remainder away (a flat $1 player whose daily gift pulled the average to 99.96c played every Callback at 90c).
  // cbArm adds the carry the last Callback left to this list's average, plays the floor of the sum and keeps the rest. INVARIANT (proved by the fuzz in the tests): each arm keeps
  // bet + carry out = avg + carry in (unless a clamp lowers the bet and drops the rest), carry out >= 0 and below the step of THIS list (1 or 10), so over any mix of lists, crossing
  // the 10c line either way, the stake handed out is at or under the stake the leads were worth: sum(bet) = sum(avg) - carry_now <= sum(avg). A carry of 7.5c left by a 10c+ list and
  // added to a list that averages 3c is worth 10.5c: the Callback plays 10c and keeps 0.5c. A carry of 0.7c added to a 12c list: 12.7c, plays 10c, keeps 2.7c. The step follows the
  // average of the list being armed, not the sum (so the 10c+ rule reads exactly as before). The clamps only lower the stake; a remainder that does not fit [0, step) after a clamp is dropped.
  const CB_MAX = BET_LEVELS[BET_LEVELS.length - 1], CB_MIN = BET_LEVELS[0];
  function cbArm(avg, carry) {
    const a = Number.isFinite(avg) && avg > 0 ? avg : 0, t = a + cleanCarry(carry), step = a < 10 ? 1 : 10;
    const bet = Math.min(CB_MAX, Math.max(CB_MIN, Math.floor(t / step + 1e-9) * step)), rest = t - bet;
    return { bet, carry: rest >= 0 && rest < step ? rest : 0 };
  }
  const cbBet = (avg) => cbArm(avg, 0).bet;      // the floor alone (no carry): the Callback bet of an average
  function nextDay(d) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10); }
  // add `t` tenths of a lead worked at `bet` cents; arms THE CALLBACK at a full list (returns true if it armed one)
  function addLeads(st, t, bet, P) {
    if (t <= 0) return false;
    st.avg = (st.avg * st.lt + bet * t) / (st.lt + t); st.lt += t;
    const full = Math.round(P.list * 10);
    if (st.lt < full || st.cb) return false;
    const arm = cbArm(st.avg, st.carry); st.cb = { bet: arm.bet }; st.carry = arm.carry;
    if (P.carryOver) st.lt -= full; else { st.lt = 0; st.avg = 0; }
    return true;
  }
  // the cold clock: from coldAt, every stepMs is one cold event; the first kills the warm squares, every one takes `batch` leads down to `floor`
  function tickStateWith(P, state, now) {
    const st = cloneState(state);
    if (st.coldAt == null || !Number.isFinite(now) || now < st.coldAt) return st;
    const step = P.cold.stepMs > 0 ? P.cold.stepMs : Infinity, n = Math.floor((now - st.coldAt) / step) + 1, fl = Math.round(P.cold.floor * 10);
    st.warm = []; st.warmBet = 0;
    if (st.lt > fl) st.lt = Math.max(fl, st.lt - n * Math.round(P.cold.batch * 10));
    st.coldAt = st.lt <= fl ? null : st.coldAt + n * step;
    return st;
  }
  const tickState = (state, now, pullCfg) => tickStateWith(pullCfg || CFG.pull, state, now);
  // null (nothing will go cold) or { inMs, leads (whole leads that go cold at the next event), warm (squares that die with it) }
  function coldInfo(state, now, pullCfg) {
    const P = pullCfg || CFG.pull, st = tickStateWith(P, state, now);
    if (st.coldAt == null) return null;
    const fl = Math.round(P.cold.floor * 10);
    return { inMs: Math.max(0, st.coldAt - now), leads: Math.floor(Math.max(0, Math.min(Math.round(P.cold.batch * 10), st.lt - fl)) / 10), warm: st.warm.length };
  }
  // the OFFICE POT slice of one bet: exact integer cents with the remainder carried (basis points)
  function potSlice(feedBps, costCents, rem) { const n = costCents * feedBps + (rem || 0); return { slice: Math.floor(n / 10000), rem: n % 10000 }; }
  // chance that one paid spin takes the pot: one in `oneInPerDollar` per dollar of cost
  // oneInPerDollar <= 0 (or not a number) switches the pot off: chance 0, never 1
  function potHitChance(pullCfg, costCents) { const o = (pullCfg || CFG.pull).pot.oneInPerDollar; return o > 0 && Number.isFinite(o) ? Math.min(1, (costCents / 100) / o) : 0; }
  // prize of one pot hit (levers 8.11, FIX POT-CAP): the whole balance up to capCents, the same cap for every bet. The old cap, maxPayX x bet, paid a 10c bettor at most $5 of a pot that
  // was fed 1% of every bet (the rest piled up) and let a $25 bettor take $1,250 (a chaser's pot EV per dollar is min(pot, cap) / 100 / oneInPerDollar, so it grew with the bet).
  // A knob that is not a whole number of cents >= 0 (NaN, text, negative, Infinity, missing) falls back to POT_CAP_DEFAULT: never NaN, never above the balance, never a throw.
  const POT_CAP_DEFAULT = 5000;
  function potPrize(pullCfg, bal) { const c = (pullCfg || CFG.pull).pot.capCents; return Math.min(bal, typeof c === 'number' && Number.isFinite(c) && c >= 0 ? Math.floor(c) : POT_CAP_DEFAULT); }

  /* ---------------------------------------------------- DENOMS: whole-cent prices and unbiased whole-cent rounding (cold-call/PULL-ENGINE.md section 7) ----------------------------------------------------
     The engine counts in tenths of the bet. A scale { price, num, den } turns tenths into cents: cents = tenths * num / den.
       - a paid spin: price = bet, num = bet, den = 10 (a tenth of the bet is bet / 10 cents: whole at 10c and up, a fraction at 1c / 2c / 5c);
       - a buy: price = the exact price (costTenths * bet / 10) rounded to the NEAREST cent (half up, at least 1c), and the round is played at the stake that makes it fair:
         num = price, den = costTenths, so a tenth of the cost multiple is price / costTenths cents and the buy's payback is the same at 1c as at $1;
       - a Callback: price 0 (free), num = its own bet, den = 10.
     A cost is whole cents, fixed and shown before the player pays, never random. A win that is not a whole number of cents is paid by roundCents: floor, plus one cent with probability
     equal to the fraction (same idea as Ballot Bender's spin handler, in exact integer arithmetic so no 1e-9 guard is needed). The random number is an argument. At 10c and up every amount
     is whole, so the number is never read and the arithmetic is the old tenths * bet / 10. */
  const buyPrice = (costTenths, bet) => Math.max(1, Math.floor((costTenths * bet + 5) / 10));
  function scaleOf(costTenths, bet) {
    if (costTenths > 0) { const price = buyPrice(costTenths, bet); return { price, num: price, den: costTenths }; }
    return { price: 0, num: bet, den: 10 };
  }
  const isFractional = (sc) => sc.num % sc.den !== 0;      // some amount of tenths is not a whole number of cents at this scale
  function roundCents(tenths, sc, u) {
    const n = tenths * sc.num, r = n % sc.den, whole = (n - r) / sc.den;
    return whole + (r > 0 && u * sc.den < r ? 1 : 0);
  }
  // the whole-cent total of a round: base spin (cluster + phone) and bonus rounded apart (u0 for the base, u1 for the bonus), then clamped to capCents (10,000 x the bet: no rounding can lift a payout above it)
  function settleCents({ base, bonus, scale, us, capCents }) {
    return Math.min(roundCents(base, scale, us[0]) + roundCents(bonus, scale, us[1]), capCents);
  }
  // the most one round can pay in cents: the engine's cap in tenths at this scale, never above MAX_WIN_X x the nominal bet (a buy's fair stake can sit above the bet by under 0.5 cent)
  const capCentsOf = (capT, sc, bet) => Math.min(Math.floor(capT * sc.num / sc.den), MAX_WIN_X * bet);
  const needRnd = () => { const e = new Error('a rounding source (input.rnd) is required when an amount at this bet can be a fraction of a cent'); e.code = 'need_rnd'; return e; };
  // pay a plain round result (the stateless game: clusterTenths + phoneTenths = base spin, bonusTenths = bonus) in whole cents; rnd() is read twice (base, bonus) when the scale is fractional, never at 10c and up
  function payRound(res, bet, rnd, capT) {
    const sc = scaleOf(res.costTenths, bet), frac = isFractional(sc), cap = capCentsOf(capT === undefined ? MAX_WIN_T : capT, sc, bet);
    if (frac && typeof rnd !== 'function') throw needRnd();
    const us = frac ? [rnd(), rnd()] : [0, 0], base = roundCents(res.clusterTenths + res.phoneTenths, sc, us[0]), bonus = roundCents(res.bonusTenths, sc, us[1]);
    return { price: sc.price, num: sc.num, den: sc.den, base, bonus, win: Math.min(base + bonus, cap), capCents: cap };
  }

  function createEngine(cfgIn) {
    const cfg = cfgIn || CFG;
    const capT = cfg.maxWinTenths;
    const NB = cfg.adjacency === 4 ? NB4 : NB8;
    const PAY = [];
    for (let s = 0; s < NREG; s++) PAY.push(cfg.pay[SYM[s]].map((v) => Math.max(1, Math.round(v * cfg.payScale))));

    // symbol draw tables per mode: noBell variant (QA force) and bell-boosted variant (hunt)
    function makeSymTable(mode, bellMult, noBell) {
      const x = cfg.extra[mode]; const w = cfg.weights.slice(); w.push(x.wild, noBell ? 0 : x.bell * bellMult, x.phone);
      return cumOf(w);
    }
    const SYMT = MODES.map((m) => makeSymTable(m, 1, false));
    const SYMT_NB = MODES.map((m) => makeSymTable(m, 1, true));
    const SYMT_HUNT = makeSymTable('base', cfg.hunt.bellMult, false);
    // reveal tables per mode: outcomes = 15 bubbles, 5 upsells, 1 close. f = optional per-tier weight factors (the picked lead of THE PULL; all 1 = the plain table)
    const ONE = { bronze: 1, silver: 1, gold: 1, upsell: 1, close: 1 };
    function buildRev(m, f) {
      const r = cfg.reveal[m], out = [], ws = [];
      TIER_NAMES.forEach((tn, ti) => {
        const list = (r.bubbles && r.bubbles[tn]) || cfg.bubbles[tn], tot = list.reduce((a, b) => a + b[1], 0);   // r.bubbles: optional per-mode value weights
        for (const [v, w] of list) { out.push({ k: 'b', v, t: ti }); ws.push(r[tn] * f[tn] * w / tot); }
      });
      const ut = cfg.upsell.reduce((a, b) => a + b[1], 0);
      for (const [v, w] of cfg.upsell) { out.push({ k: 'u', v, t: 0 }); ws.push(r.upsell * f.upsell * w / ut); }
      out.push({ k: 'c', v: 0, t: 0 }); ws.push(r.close * f.close);
      return { out, cum: cumOf(ws) };
    }
    const REV = MODES.map((m) => buildRev(m, ONE));
    // PICKREV: the reveal tables of the picked square = cfg.reveal x pull.pick.mult, built now and rebuilt only if the mult object changes
    let pickKey = null, PICKREV = null;
    function pickTables() {
      const m = cfg.pull && cfg.pull.pick && cfg.pull.pick.mult, key = JSON.stringify(m || null);
      if (key !== pickKey) {
        pickKey = key; const f = Object.assign({}, ONE, m || {});
        PICKREV = MODES.map((md, i) => { const t = buildRev(md, f); return t.cum.slice(0, -1).some(Number.isNaN) ? REV[i] : t; });
      }
      return PICKREV;
    }
    pickTables();

    const drawSym = (rng, cum) => { const x = rng(); let i = 0; while (x >= cum[i] && i < NSYM - 1) i++; return i; };

    // ---- clusters on a grid: [{sym, cells, pay}] (wild joins every symbol it touches; a cluster needs 5+ cells incl. wilds)
    const cnt = new Uint8Array(NSYM), seen = new Uint8Array(N), stack = new Uint8Array(N);
    function findClusters(g) {
      cnt.fill(0); for (let p = 0; p < N; p++) cnt[g[p]]++;
      const wc = cnt[WILD]; let out = null;
      for (let s = 0; s < NREG; s++) {
        if (!cnt[s] || cnt[s] + wc < MIN_CLUSTER) continue;
        seen.fill(0);
        for (let p0 = 0; p0 < N; p0++) {
          if (g[p0] !== s || seen[p0]) continue;
          let sp = 0, cells = []; stack[sp++] = p0; seen[p0] = 1;
          while (sp) {
            const p = stack[--sp]; cells.push(p);
            const nb = NB4[p];
            for (let i = 0; i < nb.length; i++) { const q = nb[i]; if (seen[q]) continue; const t = g[q]; if (t !== s && t !== WILD) continue; seen[q] = 1; stack[sp++] = q; }
          }
          if (cells.length < MIN_CLUSTER) continue;
          cells.sort((a, b) => a - b);
          (out || (out = [])).push({ sym: s, cells, pay: PAY[s][bucket(cells.length)] });
        }
      }
      return out;
    }

    // ---- phone feature: every hot lead reveals; upsells; closes collect; repeat on the non-close leads until no new close
    function phoneFeature(rng, mi, hot, S, capLeft, pickP) {      // pickP: the square the player picked (THE PULL), its reveals draw from PICKREV
      const rv = REV[mi], pv = pickP >= 0 ? pickTables()[mi] : null;
      const leads = []; for (let p = 0; p < N; p++) if (hot[p]) leads.push(p);
      const kind = new Uint8Array(N);              // 0 empty, 1 bubble, 2 upsell, 3 close
      const val = new Array(N).fill(0), pm = new Array(N).fill(1), done = new Uint8Array(N), tier = new Uint8Array(N);
      const rounds = S ? [] : null;
      let active = leads, nRounds = 0, nClose = 0;
      while (active.length && nRounds < cfg.maxRevealRounds) {
        const rr = S ? { reveals: [], upsells: [], collects: [] } : null;
        for (const p of active) {
          const tb = p === pickP ? pv : rv, o = tb.out[pickCum(rng, tb.cum)];
          kind[p] = o.k === 'b' ? 1 : o.k === 'u' ? 2 : 3; val[p] = o.k === 'c' ? 0 : o.v; tier[p] = o.t; pm[p] = 1; done[p] = 0;
          if (S) { const rv0 = o.k === 'b' ? { p, k: 'b', v: o.v, t: o.t } : o.k === 'u' ? { p, k: 'u', v: o.v } : { p, k: 'c', v: 0 }; if (p === pickP) rv0.up = 1; rr.reveals.push(rv0); }
        }
        for (const p of active) {                   // upsells apply first, top to bottom, left to right (leads are in position order)
          if (kind[p] !== 2) continue;
          const m = val[p], hits = S ? [] : null;
          for (const q of NB[p]) {
            if (!hot[q]) continue;
            if (kind[q] === 1) { const b = val[q]; val[q] = Math.min(b * m, capT); if (S) hits.push({ p: q, k: 'b', before: b, after: val[q] }); }
            else if (kind[q] === 3) {
              if (done[q]) { const b = val[q]; val[q] = Math.min(b * m, capT); if (S) hits.push({ p: q, k: 'c', before: b, after: val[q] }); }
              else { const b = pm[q]; pm[q] = Math.min(b * m, capT); if (S) hits.push({ p: q, k: 'c', pend: 1, before: b, after: pm[q] }); }
            }
          }
          if (S) rr.upsells.push({ p, m, hits });
        }
        let fresh = 0;
        for (const p of active) {                   // closes collect in order; each takes every bubble and every other close
          if (kind[p] !== 3) continue;
          let took = 0; for (const q of leads) if (q !== p && (kind[q] === 1 || (kind[q] === 3 && done[q]))) took += val[q];
          took = Math.min(took, capT);
          val[p] = Math.min(took * pm[p], capT); done[p] = 1; fresh++;
          if (S) { let run = 0; for (const q of leads) if (kind[q] === 1 || kind[q] === 3) run += val[q]; rr.collects.push({ p, m: pm[p], took, value: val[p], run }); }
        }
        if (S) rounds.push(rr);
        nRounds++; nClose += fresh;
        if (!fresh) break;
        active = leads.filter((q) => kind[q] !== 3);
      }
      let pay = 0; for (const p of leads) if (kind[p] === 1 || kind[p] === 3) pay += val[p];
      let capped = false;
      if (pay >= capLeft) { pay = capLeft; capped = true; }
      return { pay, capped, closes: nClose, rounds: nRounds, leads: leads.length, script: S ? { leads, rounds, pay, capped } : null };
    }

    // ---- one spin: fill, super cascade until no win, then the phone feature. hot (Uint8Array 30) carries between bonus spins.
    // o: { guarantee, noBell, bellsAt (force: exact bells), hunt, capLeft, pickHook, keepHot }
    function playSpin(rng, mi, hot, S, o) {
      const tab = o.hunt ? SYMT_HUNT : o.noBell ? SYMT_NB[mi] : SYMT[mi];
      const refill = o.noBell ? SYMT_NB[mi] : tab;
      const g = new Uint8Array(N);
      if (o.grid) g.set(o.grid); else for (let p = 0; p < N; p++) g[p] = drawSym(rng, tab);   // o.grid: test hook (a fixed start grid)
      let gp = -1;
      if (o.bellsAt) {                               // QA force: exactly this many bells land at once
        const cells = []; for (let p = 0; p < N; p++) cells.push(p);
        for (let i = 0; i < o.bellsAt; i++) { const j = i + Math.floor(rng() * (N - i)); const t = cells[i]; cells[i] = cells[j]; cells[j] = t; g[cells[i]] = BELL; }
      }
      if (o.guarantee) {
        let has = false; for (let p = 0; p < N; p++) if (g[p] === PHONE) { has = true; break; }
        if (!has) {
          const cand = []; for (let p = 0; p < N; p++) if (g[p] !== BELL) cand.push(p);
          gp = cand[Math.floor(rng() * cand.length)]; g[gp] = PHONE;
        }
      }
      const res = { win: 0, cluster: 0, phone: 0, bells: 0, phones: 0, cascades: 0, capped: false, closes: 0, leads: 0, fired: false, script: null };
      const hotIn = S ? hotList(hot) : null;
      const steps = S ? [] : null;
      let capLeft = o.capLeft;
      const sc = S ? { grid: Array.from(g), gp, hotIn, steps, bells: 0, phones: 0, phone: null, hotOut: null, cluster: 0, win: 0, capped: false } : null;
      const typeWin = new Uint8Array(NSYM), rem = new Uint8Array(N);
      for (;;) {
        const cl = findClusters(g);
        if (!cl) break;
        let stepPay = 0; for (const k of cl) stepPay += k.pay;
        const paid = Math.min(stepPay, capLeft); capLeft -= paid; res.cluster += paid; res.cascades++;
        typeWin.fill(0); rem.fill(0);
        for (const k of cl) { typeWin[k.sym] = 1; for (const p of k.cells) { rem[p] = 1; hot[p] = 1; } }
        for (let p = 0; p < N; p++) if (typeWin[g[p]]) rem[p] = 1;      // super cascade: every symbol of a winning type goes
        const removed = S ? [] : null; if (S) for (let p = 0; p < N; p++) if (rem[p]) removed.push(p);
        const falls = S ? [] : null, fresh = S ? [] : null;
        for (let c = 0; c < COLS; c++) {
          let w = ROWS - 1;
          for (let r = ROWS - 1; r >= 0; r--) {
            const p = r * COLS + c; if (rem[p]) continue;
            if (w !== r) { g[w * COLS + c] = g[p]; if (S) falls.push([p, w * COLS + c]); }
            w--;
          }
          for (; w >= 0; w--) { const s = drawSym(rng, refill); g[w * COLS + c] = s; if (S) fresh.push([w * COLS + c, s]); }
        }
        const lastStep = capLeft <= 0 || res.cascades >= cfg.maxCascades;
        if (capLeft <= 0) res.capped = true;
        if (S) steps.push({ wins: cl.map((k) => ({ sym: k.sym, pos: k.cells, pay: k.pay })), pay: paid, removed, falls, fresh, grid: Array.from(g), hot: hotList(hot), ...(capLeft <= 0 ? { capped: true } : {}) });
        if (lastStep) break;
      }
      for (let p = 0; p < N; p++) { if (g[p] === BELL) res.bells++; else if (g[p] === PHONE) res.phones++; }
      let nHot = 0; for (let p = 0; p < N; p++) nHot += hot[p];
      if (!res.capped && res.phones > 0 && nHot > 0) {
        const pp = o.pickHook ? o.pickHook(hot, nHot, sc, res) : -1;      // THE PULL: PICK YOUR LEAD (may throw to wait for the player)
        const f = phoneFeature(rng, mi, hot, S, capLeft, pp);
        res.phone = f.pay; capLeft -= f.pay; res.closes = f.closes; res.leads = f.leads; res.fired = true; res.revealRounds = f.rounds;
        if (f.capped) res.capped = true;
        if (S) sc.phone = f.script;
        if (mi <= 1) hot.fill(0);                    // base spin clears; bonus1 clears once a phone has used them
      }
      if (mi === 0) { if (o.keepHot) res.hotEnd = hotList(hot); hot.fill(0); }   // keepHot: the marked squares of a base spin that did not use them (warm squares)
      res.win = res.cluster + res.phone;
      if (S) { sc.bells = res.bells; sc.phones = res.phones; sc.cluster = res.cluster; sc.phoneTenths = res.phone; sc.win = res.win; sc.capped = res.capped; sc.hotOut = hotList(hot); sc.mode = MODES[mi]; res.script = sc; }
      return res;
    }
    const hotList = (hot) => { const a = []; for (let p = 0; p < N; p++) if (hot[p]) a.push(p); return a; };

    // ---- bonus: start 1 (DIALING FOR DOLLARS), 2 (ALWAYS BE CLOSING) or 3 (QUOTE ACCEPTED)
    function playBonus(rng, start, S, capLeft, o) {
      const startKind = MODES[start];
      let mi = start, left = cfg.spins[startKind], awarded = left, upgraded = false;
      const hot = new Uint8Array(N);
      const out = { total: 0, cluster: 0, phone: 0, spins: 0, added: 0, upgraded: false, capped: false, cascades: 0, fired: 0, closes: 0, script: null };
      const spins = S ? [] : null;
      if (o && o.reg) o.reg(spins);
      const hardCap = cfg.maxSpins + 2;
      while (left > 0 && out.spins < hardCap) {
        left--; out.spins++;
        const sp = playSpin(rng, mi, hot, S, o && o.pickHook ? { guarantee: mi === 3, capLeft: capLeft - out.total, pickHook: (h, nh, sc, r) => o.pickHook(h, nh, sc, r, out.spins, mi) } : { guarantee: mi === 3, capLeft: capLeft - out.total });
        out.total += sp.win; out.cluster += sp.cluster; out.phone += sp.phone; out.cascades += sp.cascades; out.fired += sp.fired ? 1 : 0; out.closes += sp.closes;
        const b = sp.bells; let add = 0, up = false;
        if (mi === 1) { if (b >= 4) { add = cfg.retrigger.upgrade; up = true; mi = 2; upgraded = true; } else if (b === 3) add = cfg.retrigger.three; else if (b === 2) add = cfg.retrigger.two; }
        else if (b >= 3) add = cfg.retrigger.three; else if (b === 2) add = cfg.retrigger.two;
        add = Math.max(0, Math.min(add, cfg.maxSpins - awarded)); awarded += add; left += add; out.added += add;
        if (S) { const s = sp.script; s.n = out.spins; s.added = add; s.upgrade = up; s.left = left; s.bonusTotal = Math.min(out.total, capLeft); spins.push(s); }
        if (sp.capped || out.total >= capLeft) { out.capped = true; out.total = Math.min(out.total, capLeft); break; }
      }
      out.upgraded = upgraded;
      if (S) out.script = { kind: startKind, startSpins: cfg.spins[startKind], spins, totalSpins: awarded, upgraded, winTenths: out.total, capped: out.capped };
      return out;
    }

    // ---- full paid round. buy: null | 'call' | 'bonus1' | 'bonus2' | 'hunt'. opts: { script, force }
    function roundOnce(rng, buy, S, force) {
      const res = { buy: buy || null, costTenths: buy ? cfg.buyCost[buy] : 10, winTenths: 0, clusterTenths: 0, phoneTenths: 0, bonusTenths: 0, bonusKind: 0, upgraded: false,
        capped: false, script: null, bells: 0, phoneFired: false, closes: 0, cascades: 0, baseCascades: 0, bonusSpins: 0, bonusCluster: 0, bonusPhone: 0, leads: 0, revealRounds: 0 };
      let capLeft = capT, spin = null;
      if (buy === 'bonus1' || buy === 'bonus2') {
        res.bonusKind = buy === 'bonus1' ? 1 : 2;
      } else {
        const so = { guarantee: buy === 'call', hunt: buy === 'hunt', capLeft };
        if (force === 'bonus1' || force === 'bonus2' || force === 'bonus3') { so.noBell = true; so.bellsAt = force === 'bonus1' ? 3 : force === 'bonus2' ? 4 : 5; }
        else if (force === 'tease') { so.noBell = true; so.bellsAt = 2; }
        spin = playSpin(rng, 0, new Uint8Array(N), S, so);
        res.clusterTenths = spin.cluster; res.phoneTenths = spin.phone; res.bells = spin.bells; res.phoneFired = spin.fired; res.closes = spin.closes; res.cascades = spin.cascades; res.baseCascades = spin.cascades;
        res.leads = spin.leads; res.revealRounds = spin.revealRounds || 0;
        capLeft -= spin.win; if (spin.capped || capLeft <= 0) { res.capped = true; capLeft = 0; }
        if (!res.capped && spin.bells >= 3) res.bonusKind = spin.bells >= 5 ? 3 : spin.bells === 4 ? 2 : 1;
      }
      let bonus = null;
      if (res.bonusKind && !res.capped) {
        bonus = playBonus(rng, res.bonusKind, S, capLeft, null);
        res.bonusTenths = bonus.total; res.upgraded = bonus.upgraded; res.bonusSpins = bonus.spins; res.bonusCluster = bonus.cluster; res.bonusPhone = bonus.phone;
        res.cascades += bonus.cascades; res.closes += bonus.closes; if (bonus.capped) res.capped = true;
      }
      res.winTenths = Math.min(res.clusterTenths + res.phoneTenths + res.bonusTenths, capT);
      if (res.winTenths >= capT) res.capped = true;
      res.winX = res.winTenths / 10; res.tier = winTier(res.winX);
      if (S) res.script = { v: 2, buy: res.buy, costTenths: res.costTenths, winTenths: res.winTenths, tier: res.tier, capped: res.capped, maxWinTenths: capT,
        parts: { cluster: res.clusterTenths, phone: res.phoneTenths, bonus: res.bonusTenths }, spin: spin ? spin.script : null, bonus: bonus ? bonus.script : null };
      return res;
    }
    // QA forces that cannot be steered by placement are conditioned by re-rolling whole rounds (bounded)
    function round(rng, buy, opts) {
      const S = !!(opts && opts.script), force = opts && opts.force;
      if (buy || !(force === 'phone' || force === 'close' || force === 'big')) return roundOnce(rng, buy, S, force);
      let r;
      for (let i = 0; i < 200000; i++) {
        r = roundOnce(rng, null, S, null);
        if (force === 'phone' ? r.phoneFired && r.leads >= 4 : force === 'close' ? r.closes >= 1 && r.revealRounds >= 2 : r.winTenths >= 250) break;
      }
      return r;
    }

    /* ================================================ THE PULL: stateful rounds ================================================
       playRound(rng, input, decisions) is a pure function of (rng draws, input, decisions). A decision the player has not made yet
       throws PEND out of the round; the caller (the server) records the rng draws as a tape and replays the same round from the
       tape with one more decision. Nothing here keeps state between calls. Contract: cold-call/PULL-ENGINE.md. */
    const PEND = { pending: true };
    const badDecision = (msg) => { const e = new Error('bad_decision: ' + msg); e.code = 'bad_decision'; return e; };
    const bonusNum = (k) => (k === 'bonus2' ? 2 : 1);
    function emptyPull(state) { const lt = state ? state.lt : 0; return { leadsBefore: lt, leadsAfter: lt, filled: 0, leaked: 0, warmDied: 0, warmDropped: 0, armed: false, daily: null, warmIn: [], warmOut: [], ghost: null, decisions: [], pick: null, more: null }; }

    function playRound(rng, input, decisions) {
      const P = cfg.pull, buy = input.buy || null, S = input.script !== false, bet0 = input.bet;
      if (!P || !P.on || input.force) {              // the old stateless game: legacy round, state untouched, no decisions
        const r = round(rng, buy, { script: S, force: input.force });
        return { status: 'done', round: r, buy: r.buy, callback: false, betCents: bet0, costTenths: r.costTenths, winTenths: r.winTenths, winX: r.winX, capped: r.capped, tier: r.tier, script: r.script, newState: input.state || null, pull: emptyPull(input.state), pay: payRound(r, bet0, input.rnd, capT) };
      }
      const decs = decisions || [], now = input.now, day = input.day;
      let s = null, callback = false, bet = bet0, leaked = 0, warmDied = 0;
      if (!buy) {
        if (!input.state) throw new Error('playRound: state required for a spin');
        const before = input.state;
        s = tickStateWith(P, before, now); callback = !!s.cb; if (callback) bet = s.cb.bet;
        leaked = before.lt - s.lt; warmDied = before.warm.length - s.warm.length;
      }
      // DENOMS: the scale tenths -> cents of this round (a Callback at its own bet, a buy at its fair stake) and the rounding source (read twice per DONE round when an amount can be a fraction of a cent)
      const costT0 = callback ? 0 : buy ? cfg.buyCost[buy] : 10, scale = scaleOf(costT0, bet), frac = isFractional(scale), rnd = input.rnd;
      if (frac && typeof rnd !== 'function') throw needRnd();
      let U = null;
      const us = () => U || (U = frac ? [rnd(), rnd()] : [0, 0]);
      const rc = (t, k) => (frac ? roundCents(t, scale, us()[k]) : t * scale.num / scale.den), capC = capCentsOf(capT, scale, bet);
      const pull = emptyPull(s || input.state);
      pull.leaked = leaked; pull.warmDied = warmDied;
      const dx = { i: 0, pick: false, spins: null, cur: null, curNo: 0, curMi: 0, point: null, bonus: null };

      // a decision: the recorded ones first (replay), then the caller's policy (input.decide, sim), then the safe default (input.auto), else wait (PEND)
      function take(kind, point, dflt) {
        let d, auto = false;
        if (dx.i < decs.length) { d = decs[dx.i++]; auto = (d && d.auto) || false; }
        else if (input.decide && (d = input.decide(point))) auto = d.auto || false;
        else if (input.auto) { d = dflt; auto = true; }
        else { dx.point = point; throw PEND; }
        if (!d || d.k !== kind) throw badDecision('expected ' + kind);
        if (kind === 'pick' && !point.choices.includes(d.p)) throw badDecision('square ' + d.p + ' is not a hot square');
        if (kind === 'more' && typeof d.take !== 'boolean') throw badDecision('take must be a boolean');
        const rec = kind === 'pick' ? { k: 'pick', p: d.p } : { k: 'more', take: d.take }; if (auto) rec.auto = auto;
        pull.decisions.push(rec);
        return { d, auto };
      }
      const hooks = {
        reg: (spins) => { dx.spins = spins; },
        pickHook: (hot, nHot, sc, r, spinNo, mi) => {       // first phone feature of a bonus: pick one of the hot squares
          if (dx.pick) return -1; dx.pick = true;
          if (!P.pick || !P.pick.on || nHot < P.pick.minLeads) return -1;
          const choices = hotList(hot);
          dx.cur = [sc, r, spinNo, mi];
          const { d, auto } = take('pick', { k: 'pick', spin: spinNo, choices }, { k: 'pick', p: choices[0] });
          pull.pick = { spin: spinNo, choices, p: d.p, auto: auto || false };
          return d.p;
        },
      };

      const capT0 = capT;
      const res = { buy, costTenths: callback ? 0 : buy ? cfg.buyCost[buy] : 10, winTenths: 0, clusterTenths: 0, phoneTenths: 0, bonusTenths: 0, bonusRawTenths: 0, bonusKind: 0, upgraded: false,
        capped: false, script: null, bells: 0, phoneFired: false, closes: 0, cascades: 0, baseCascades: 0, bonusSpins: 0, bonusCluster: 0, bonusPhone: 0, leads: 0, revealRounds: 0, callback, phones: 0, marked: 0 };
      let capLeft = capT0, spin = null, bonus = null, hotEnd = null;
      const scriptSoFar = (bonusScript) => ({ v: 2, partial: true, buy, callback, bet, costTenths: res.costTenths, spin: spin ? spin.script : null, bonus: bonusScript,
        pull: { leadsBefore: pull.leadsBefore, daily: pull.daily, warmIn: pull.warmIn, decisions: pull.decisions.slice() } });
      try {
        if (!buy && !callback && day && (!s.day || day > s.day)) {            // THE APPOINTMENT: first paid spin of a new day
          const streak = s.day && nextDay(s.day) === day ? s.streak + 1 : 1;
          const dl = P.daily.base + P.daily.perStreak * Math.min(streak - 1, P.daily.streakMax);
          pull.daily = { leads: dl, streak };
          s.day = day; s.streak = streak;
          if (addLeads(s, Math.round(dl * 10), Math.min(bet, P.daily.stakeCap), P)) pull.armed = true;
        }
        if (!buy && !callback && s.warm.length && s.warmBet !== bet) {          // warm squares belong to the bet they were made at: any other bet and they are gone before the round is played
          pull.warmDropped = s.warm.length; s.warm = []; s.warmBet = 0;
        }
        if (!buy && !callback) pull.warmIn = s.warm.slice();
        const hot = new Uint8Array(N);
        if (!buy && !callback) for (const p of s.warm) if (p >= 0 && p < N) hot[p] = 1;
        if (callback) res.bonusKind = bonusNum(P.callback.kind);
        else if (buy === 'bonus1' || buy === 'bonus2') res.bonusKind = buy === 'bonus1' ? 1 : 2;
        else {
          spin = playSpin(rng, 0, hot, S, { guarantee: buy === 'call', hunt: buy === 'hunt', capLeft, keepHot: !buy });
          res.clusterTenths = spin.cluster; res.phoneTenths = spin.phone; res.bells = spin.bells; res.phoneFired = spin.fired; res.closes = spin.closes; res.cascades = spin.cascades; res.baseCascades = spin.cascades;
          res.leads = spin.leads; res.revealRounds = spin.revealRounds || 0; hotEnd = spin.hotEnd; res.phones = spin.phones; res.marked = hotEnd ? hotEnd.length : 0;
          capLeft -= spin.win; if (spin.capped || capLeft <= 0) { res.capped = true; capLeft = 0; }
          if (!res.capped && spin.bells >= 3) res.bonusKind = spin.bells >= 5 ? 3 : spin.bells === 4 ? 2 : 1;
        }
        let finalBonus = 0, moreCents = null;       // moreCents: { bonus } the whole-cent bonus when ONE MORE CALL was offered (the amounts the player was shown)
        if (res.bonusKind && !res.capped) {
          bonus = playBonus(rng, res.bonusKind, S, capLeft, hooks);
          dx.bonus = bonus; const W = bonus.total;
          res.bonusRawTenths = W; res.upgraded = bonus.upgraded; res.bonusSpins = bonus.spins; res.bonusCluster = bonus.cluster; res.bonusPhone = bonus.phone;
          res.cascades += bonus.cascades; res.closes += bonus.closes; if (bonus.capped) res.capped = true;
          finalBonus = W;
          const M = P.more, mult = M ? Math.floor(M.mult) : 0;
          if (M && M.on && mult >= 2 && !bonus.capped && W > 0 && W >= M.minTenths && W * mult <= capLeft) {     // ONE MORE CALL (capLeft: the cap the bonus had, so a win is never clipped)
            // SHOWN = PAID (DENOMS): the amounts of this decision are whole cents, rounded ONCE here (base and bonus apart) from the rounding source; banking pays them, a won gamble
            // pays base + bonusCents x mult, a lost one the base: whole-cent arithmetic on what was shown, so what the player reads is what the option pays and no option leaks the draw.
            // The rounding draws are made at this point on a replay too (same order), so they are the same numbers whenever the round is replayed from its tapes.
            const baseC = rc(res.clusterTenths + res.phoneTenths, 0), bonusC = rc(W, 1);
            if (baseC + bonusC * mult <= capC) {                       // the cap in whole cents (the same test as the tenths one at 10c and up, where nothing rounds)
              const pWin = M.rtp / mult;
              const { d, auto } = take('more', { k: 'more', W, mult, pWin, capT: capT0, bankCents: baseC + bonusC, baseCents: baseC, bonusCents: bonusC, winCents: baseC + bonusC * mult }, { k: 'more', take: false });
              let won = null;
              moreCents = { bonus: bonusC };
              if (d.take) { const u = rng(); won = u * mult < M.rtp; finalBonus = won ? W * mult : 0; moreCents.bonus = won ? bonusC * mult : 0; }
              pull.more = { W, mult, pWin, take: d.take, won, auto: auto || false };
            }
          }
        }
        res.bonusTenths = finalBonus;
        res.winTenths = Math.min(res.clusterTenths + res.phoneTenths + finalBonus, capT0);
        if (res.winTenths >= capT0) res.capped = true;
        res.winX = res.winTenths / 10; res.tier = winTier(res.winX);
        const payBase = rc(res.clusterTenths + res.phoneTenths, 0), payBonus = moreCents ? moreCents.bonus : rc(finalBonus, 1);
        us();                                                           // a fractional round always reads both rounding numbers (tape alignment), even when nothing needs rounding
        const pay = { price: scale.price, num: scale.num, den: scale.den, base: payBase, bonus: payBonus, win: Math.min(payBase + payBonus, capC), capCents: capC };

        // state out. Buys never touch it.
        let ns = input.state || null;
        if (!buy) {
          ns = s; ns.rounds++;
          if (callback) { ns.cb = null; ns.callbacks++; }
          else {
            const fill = res.bonusKind ? P.fill.bonus : res.clusterTenths + res.phoneTenths > 0 ? P.fill.win : P.fill.dead;
            const ft = Math.round(fill * 10); pull.filled = ft;
            if (addLeads(ns, ft, bet, P)) pull.armed = true;
            // warm squares and the ghost: the marks the base spin did not use; draws come last, from a sub-rng (one main-stream draw), so the round's own draws never move
            const marks = hotEnd || [];
            if (marks.length && spin.phones === 0) {
              const gOn = P.ghost && P.ghost.on && spin.win < P.ghost.maxWinTenths, wOn = P.warm.cap > 0 && P.warm.chance > 0;
              if (gOn || wOn) {
                const sub = rngFrom(Math.floor(rng() * 4294967296));
                if (gOn) {
                  const gh = new Uint8Array(N); for (const p of marks) gh[p] = 1;
                  const f = phoneFeature(sub, 0, gh, S, capT0);
                  if (f.pay >= P.ghost.minTenths) pull.ghost = { pay: f.pay, closes: f.closes, leads: f.leads, script: f.script };
                }
                if (wOn) for (const p of marks) { if (pull.warmOut.length >= P.warm.cap) break; if (sub() < P.warm.chance) pull.warmOut.push(p); }
              }
            }
            ns.warm = pull.warmOut.slice(); ns.warmBet = ns.warm.length ? bet : 0;
          }
          if (Number.isFinite(now)) ns.coldAt = ns.lt <= Math.round(P.cold.floor * 10) && !ns.warm.length ? null : now + P.cold.afterMs;
          pull.leadsAfter = ns.lt;
        }
        if (dx.i < decs.length) throw badDecision('more decisions than decision points');
        if (S) res.script = { v: 2, buy, callback, bet, costTenths: res.costTenths, winTenths: res.winTenths, tier: res.tier, capped: res.capped, maxWinTenths: capT0,
          parts: { cluster: res.clusterTenths, phone: res.phoneTenths, bonus: finalBonus }, spin: spin ? spin.script : null, bonus: bonus ? bonus.script : null, pull };
        return { status: 'done', round: res, buy, callback, betCents: bet, costTenths: res.costTenths, winTenths: res.winTenths, winX: res.winX, capped: res.capped, tier: res.tier, script: res.script, newState: ns, pull, pay };
      } catch (e) {
        if (e !== PEND) throw e;
        let partial = null;
        if (S) {
          if (dx.point.k === 'pick') {      // inside a bonus spin, after the cascades, before the phone feature reveals anything
            const [sc, r, spinNo, mi] = dx.cur;
            const { win, capped, phoneTenths, ...seen } = sc;       // what the player has seen: the board and the cascades, not the phone feature or the spin's total
            const cur = { ...seen, bells: r.bells, phones: r.phones, cluster: r.cluster, mode: MODES[mi], n: spinNo, pickPending: 1 };
            const kind = MODES[res.bonusKind];
            partial = scriptSoFar({ kind, startSpins: cfg.spins[kind], spins: dx.spins.concat([cur]), partial: true });
          } else partial = scriptSoFar(bonus.script);
        }
        return { status: 'pending', pending: dx.point, partial, buy, callback, betCents: bet, costTenths: res.costTenths, pull, pay: { price: scale.price, num: scale.num, den: scale.den, capCents: capC } };      // pull: what is known so far (decisions made, daily, warm in, leads before)
      }
    }

    return { round, playSpin, playBonus, phoneFeature, findClusters, playRound, cfg, PAY, REV, SYMT, get PICKREV() { return pickTables(); } };
  }

  // whole cents for a tenths amount at a bet; throws if it would not be an exact integer (always exact at 10c and up; at 1c / 2c / 5c only when tenths x bet / 10 is whole: use roundCents / payRound for wins)
  function cents(tenths, bet) {
    const c = tenths * bet / 10;
    if (!Number.isSafeInteger(tenths) || !Number.isSafeInteger(bet) || !Number.isSafeInteger(c)) throw new Error('not whole cents');
    return c;
  }

  const engine = createEngine();
  // Resolves one full paid round with the injected rng (() => [0,1)). buy: null | 'call' | 'bonus1' | 'bonus2' | 'hunt'. opts.force: QA only.
  function resolveRound(rng, buy, opts) {
    const r = engine.round(rng, buy, { script: true, ...(opts || {}) });
    return { round: r, buy: r.buy, costTenths: r.costTenths, winTenths: r.winTenths, winX: r.winX, capped: r.capped, tier: r.tier, script: r.script };
  }

  // THE PULL round: (rng, { buy, bet, state, now, day, script, auto, decide }, decisions) -> { status: 'done' | 'pending', ... }
  const playRound = (rng, input, decisions) => engine.playRound(rng, input, decisions);

  return { createEngine, engine, resolveRound, rngFrom, playRound, newState, tickState, coldInfo, potSlice, potHitChance, potPrize, cbBet, cbArm, cbLevel: cbBet, winTier, cents, buyPrice, scaleOf, roundCents, settleCents, payRound, TIERS, CFG, SYM, MODES, BUYS, FORCES, TIER_NAMES, BET_LEVELS, COLS, ROWS, N, NREG, WILD, BELL, PHONE, MIN_CLUSTER, MAX_WIN_X, MAX_WIN_T };
});
