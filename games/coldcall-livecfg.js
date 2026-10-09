'use strict';
// COLD CALL live config: change the slot math without a redeploy (the same switch Ballot Bender has, see games/bender-engine.js "SERVER ADDITIONS").
// Overrides are deep-merged onto the shipped defaults, validated (type, range, shape, relationships), smoke-tested on a real engine built from the
// merged config, saved on the data volume, then swapped into Eng.CFG in place between rounds. A bad config throws and changes NOTHING (memory and file).
// The engine file stays pure and unchanged; everything with a file, an env var or a clock lives here. Contract: cold-call/PULL-ENGINE.md section 8.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Eng = require('./coldcall-engine.js');

const DEFAULT = structuredClone(Eng.CFG);          // the shipped numbers, captured when this file loads
const MAX_T = Eng.MAX_WIN_T;                       // the 10,000x cap in tenths of the bet
const CUSTOM_LABEL = 'custom settings, not measured';
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = (o) => structuredClone(o);
const show = (v) => { try { const s = typeof v === 'number' ? String(v) : JSON.stringify(v); return s === undefined ? String(v) : (s.length > 40 ? s.slice(0, 40) + '...' : s); } catch { return String(v); } };

// ---------------------------------------------------------------------------------------------------------------- rules
// Every number must be finite and >= 0 (Infinity / NaN / negative / text / null are refused, Opus N3). A rule is [min, max, mustBeWholeNumber]; the key is the dotted path, or
// `parent.*` for every key of a block. The shape (which keys exist, array lengths, strings, switches) is the SHIPPED one and cannot change: only listed numbers move.
const WIDE = [0, 1e9];
const RULES = {
  payScale: [0.01, 100], adjacency: { enum: [4, 8] },
  'spins.*': [1, 100, 1], 'retrigger.*': [0, 40, 1], maxSpins: [1, 200, 1], maxCascades: [1, 200, 1], maxRevealRounds: [1, 100, 1],   // loop bounds: a bonus must always end
  'buyCost.*': [1, 100000, 1], 'hunt.bellMult': [0, 100], maxWinTenths: [1, MAX_T, 1],
  'extra.*.*': [0, 1000], 'reveal.*.*': [0, 1e6],
  'pull.list': [0.1, 100000], 'pull.fill.*': [0, 1000],
  'pull.callback.kind': { enum: ['bonus1', 'bonus2'] },
  'pull.cold.afterMs': [0, 3.15e10, 1], 'pull.cold.stepMs': [1000, 3.15e10, 1], 'pull.cold.batch': [0, 1e6], 'pull.cold.floor': [0, 1e6],
  'pull.warm.chance': [0, 1], 'pull.warm.cap': [0, 30, 1],
  'pull.ghost.maxWinTenths': [0, MAX_T], 'pull.ghost.minTenths': [0, MAX_T],
  'pull.pick.minLeads': [0, 30, 1], 'pull.pick.mult.*': [0, 1000],
  'pull.more.mult': [0, 100, 1], 'pull.more.rtp': [0, 100], 'pull.more.minTenths': [0, MAX_T],
  'pull.daily.base': [0, 100], 'pull.daily.perStreak': [0, 100], 'pull.daily.streakMax': [0, 365, 1], 'pull.daily.stakeCap': [0, 2500, 1],
  'pull.pot.feedBps': [0, 10000, 1], 'pull.pot.oneInPerDollar': [0, 1e9], 'pull.pot.seed': [0, 0, 1], 'pull.pot.minBal': [0, 1e9, 1], 'pull.pot.capCents': [0, 1e9, 1],
  'pull.feed.minWinX': WIDE, 'pull.feed.minWinCents': [0, 1e9, 1],
  'pull.decision.timeoutMs': [3000, 120000, 1],
};
function ruleFor(at) {                                   // at = 'cfg.pull.list' style path (the leading 'cfg.' is dropped)
  const p = at.replace(/^cfg\./, '');
  if (hasOwn(RULES, p)) return RULES[p];
  const parts = p.split('.');
  for (let mask = 1; mask < (1 << parts.length); mask++) {   // wildcard any subset of segments, fewest wildcards first is not needed: rules do not overlap
    const q = parts.map((s, i) => (mask & (1 << i) ? '*' : s)).join('.');
    if (hasOwn(RULES, q)) return RULES[q];
  }
  return WIDE;
}
// list columns: weights (any number >= 0), pay rows (tenths of the bet), [value, weight] pair lists (bubbles, upsell: value is a whole number of tenths / a whole multiplier >= 1)
function colRule(at, col, pair) {
  const p = at.replace(/^cfg\./, '');
  if (pair) return col === 0 ? [1, MAX_T, 1] : [0, 1e6];
  if (p === 'weights') return [0, 1e6];
  if (/^pay\./.test(p)) return [0, MAX_T];
  return WIDE;
}

function num(v, at, rule) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(at + ': must be a finite number (got ' + show(v) + ')');
  const [min, max, whole] = rule;
  if (v < min || v > max) throw new Error(at + ': must be between ' + min + ' and ' + max + ' (got ' + show(v) + ')');
  if (whole && !Number.isInteger(v)) throw new Error(at + ': must be a whole number (got ' + show(v) + ')');
  return v;
}

// deep merge of the overrides onto a clone of the defaults, in place on `out` (a clone of `base`)
function apply(base, over, out, at) {
  if (!isPlain(over)) throw new Error(at + ': expected an object (a block cannot be removed or replaced)');
  for (const k of Object.keys(over)) {
    const here = at + '.' + k;
    if (!hasOwn(base, k)) throw new Error(here + ': unknown setting');
    const b = base[k], v = over[k];
    if (typeof b === 'number') {
      const rule = ruleFor(here);
      if (rule.enum) { if (!rule.enum.includes(v)) throw new Error(here + ': must be one of ' + rule.enum.join(', ') + ' (got ' + show(v) + ')'); out[k] = v; }
      else out[k] = num(v, here, rule);
    } else if (typeof b === 'boolean') {
      if (typeof v !== 'boolean') throw new Error(here + ': must be true or false (got ' + show(v) + ')');
      out[k] = v;
    } else if (typeof b === 'string') {
      const rule = ruleFor(here);
      if (!rule.enum || !rule.enum.includes(v)) throw new Error(here + ': must be one of ' + (rule.enum || []).join(', ') + ' (got ' + show(v) + ')');
      out[k] = v;
    } else if (Array.isArray(b)) {
      if (!Array.isArray(v)) throw new Error(here + ': must be a list (got ' + show(v) + ')');
      if (Array.isArray(b[0])) {                                  // a list of [value, weight] pairs: any length >= 1, every row the same width as the shipped rows
        if (!v.length || v.length > 64) throw new Error(here + ': must be a list of 1 to 64 rows');
        out[k] = v.map((row, i) => {
          if (!Array.isArray(row) || row.length !== b[0].length) throw new Error(here + '[' + i + ']: each row must have ' + b[0].length + ' numbers');
          return row.map((x, c) => num(x, here + '[' + i + '][' + c + ']', colRule(here, c, true)));
        });
        if (!(out[k].reduce((a, r) => a + r[1], 0) > 0)) throw new Error(here + ': the weights must add up to more than 0');
      } else {                                                    // a fixed-length list of numbers
        if (v.length !== b.length) throw new Error(here + ': must have ' + b.length + ' entries (got ' + v.length + ')');
        out[k] = v.map((x, i) => num(x, here + '[' + i + ']', colRule(here, i, false)));
      }
    } else if (isPlain(b)) apply(b, v, out[k], here);
    else throw new Error(here + ': not tunable');
  }
}

// rules that tie several knobs together (checked on the merged config, so they hold whatever subset was overridden)
function relations(c) {
  const sum = (a) => a.reduce((x, y) => x + y, 0), fail = (m) => { throw new Error(m); };
  if (!(sum(c.weights) > 0)) fail('cfg.weights: the symbol weights must add up to more than 0');
  for (const m of Eng.MODES) { const r = c.reveal[m]; if (!(r.bronze + r.silver + r.gold + r.upsell + r.close > 0)) fail('cfg.reveal.' + m + ': the reveal weights must add up to more than 0'); }
  for (const k of Object.keys(c.spins)) if (c.spins[k] > c.maxSpins) fail('cfg.spins.' + k + ': must not be above maxSpins (' + c.maxSpins + ')');
  const P = c.pull;
  if (P.fill.dead < P.fill.win) fail('cfg.pull.fill.dead: must stay >= fill.win (a dead spin never earns fewer leads than a paying one)');
  if (P.pot.seed !== 0) fail('cfg.pull.pot.seed: must be 0 (a seed above 0 mints currency out of nothing: W9)');
  if (P.pot.oneInPerDollar === 0 && P.pot.feedBps > 0) fail('cfg.pull.pot: oneInPerDollar 0 means the pot never pays, so feedBps must be 0 too');
  if (P.pot.capCents < P.pot.feedBps * P.pot.oneInPerDollar / 100) fail('cfg.pull.pot.capCents: must be >= feedBps x oneInPerDollar / 100 (' + P.pot.feedBps * P.pot.oneInPerDollar / 100 + '), or the pot cannot pay out what it is fed');
  if (P.more.mult >= 2 && P.more.rtp > P.more.mult) fail('cfg.pull.more.rtp: must be <= more.mult (the win chance rtp / mult cannot pass 1)');
  if (P.more.rtp > 1) fail('cfg.pull.more.rtp: must be <= 1 (it is the payback of the ONE MORE CALL gamble as a fraction: above 1 the gamble pays the player more than it takes)');
  // D2, the chaser bar: a player who bets only while the pot shows its cap collects capCents / 100 / oneInPerDollar points on top of the game (shipped 5000 / 3000 = 1.667, the bar of LEVERS 8.11 / 8.13). Whole numbers: capCents x 3 <= oneInPerDollar x 5.
  if (P.pot.oneInPerDollar > 0 && P.pot.capCents * 3 > P.pot.oneInPerDollar * 5) fail('cfg.pull.pot: the chaser bar: capCents / 100 / oneInPerDollar must not pass the shipped 1.667 points (capCents x 3 <= oneInPerDollar x 5; got ' + P.pot.capCents + ' x 3 > ' + P.pot.oneInPerDollar + ' x 5), or a player who bets only on a full pot beats the 98.7 bar');
}

// ---------------------------------------------------------------------------------------------------------------- smoke test
// A real engine from the merged config plays a few hundred rounds: the plain game, every buy, then full PULL rounds (daily, Callback, PICK, ONE MORE CALL decisions taken
// and banked) at several bets down to 1 cent (rounding source given). Any throw, non-finite or non-whole amount, price <= 0 or win above the cap refuses the config.
const SMOKE_BETS = [1, 5, 10, 100, 2500];
function smoke(next) {
  const out = { rounds: 0, buys: { call: 0, bonus1: 0, bonus2: 0, hunt: 0 }, pull: 0, decisions: 0, callbacks: 0, maxWinTenths: 0 };
  try {
    const e = Eng.createEngine(next), rng = Eng.rngFrom(20261006), rnd = Eng.rngFrom(77), cap = next.maxWinTenths;
    const bad = (m) => { throw new Error(m); };
    for (let i = 0; i < 120; i++) {
      const buy = i % 4 === 0 ? Eng.BUYS[(i / 4) % 4] : null, r = e.round(rng, buy, { script: false }); out.rounds++; if (buy) out.buys[buy]++;
      if (!(Number.isFinite(r.winTenths) && r.winTenths >= 0 && r.winTenths <= cap && Number.isInteger(r.winTenths))) bad('a plain round paid ' + r.winTenths + ' tenths');
      if (!(r.costTenths === (buy ? next.buyCost[buy] : 10) && r.costTenths > 0)) bad('a plain round cost ' + r.costTenths + ' tenths');
      out.maxWinTenths = Math.max(out.maxWinTenths, r.winTenths);
    }
    let st = Eng.newState(), now = Date.UTC(2026, 9, 6, 18), k = 0;
    const decide = (pt) => { out.decisions++; return pt.k === 'pick' ? { k: 'pick', p: pt.choices[pt.choices.length - 1] } : { k: 'more', take: k++ % 2 === 0 }; };
    for (let i = 0; i < 200; i++) {
      const bet = SMOKE_BETS[i % SMOKE_BETS.length], buy = i % 5 === 3 ? Eng.BUYS[1 + ((i / 5) | 0) % 2] : i % 17 === 4 ? 'hunt' : i % 19 === 5 ? 'call' : null;
      if (!buy && i % 23 === 11 && !st.cb) st.cb = { bet: SMOKE_BETS[(i / 23 | 0) % SMOKE_BETS.length] };     // exercise a Callback whatever the list says
      now += 3600000 * (i % 31 === 0 ? 30 : 1); const day = new Date(now).toISOString().slice(0, 10);
      const r = e.playRound(rng, { buy, bet, state: st, now, day, script: i % 20 === 0, rnd, decide }, []);
      out.pull++; out.rounds++; if (buy) out.buys[buy]++; if (r.callback) out.callbacks++;
      if (r.status !== 'done') bad('a PULL round with answered decisions did not finish');
      const p = r.pay;
      for (const v of [p.price, p.win, p.capCents]) if (!Number.isSafeInteger(v) || v < 0) bad('a PULL round paid or charged ' + v + ' cents');
      if (p.win > p.capCents) bad('a PULL round paid above its cap');
      if (!buy && !r.callback && p.price !== bet) bad('a paid spin was charged ' + p.price + ' at a bet of ' + bet);
      if (buy && !(p.price >= 1)) bad('a buy cost ' + p.price + ' cents');
      if (!buy) { st = r.newState; if (!(Number.isFinite(st.lt) && st.lt >= 0 && Number.isFinite(st.avg) && st.avg >= 0 && st.carry >= 0 && st.carry < 10)) bad('the player state went out of range: ' + JSON.stringify({ lt: st.lt, avg: st.avg, carry: st.carry })); }
    }
    for (const c of [100, 1000, 100000]) {
      const h = Eng.potHitChance(next.pull, c), z = Eng.potPrize(next.pull, 123456);
      if (!(Number.isFinite(h) && h >= 0 && h <= 1) || !Number.isSafeInteger(z) || z < 0 || z > 123456) bad('the pot rules gave a bad chance or prize');
    }
  } catch (e) { throw new Error('cfg: smoke test failed: ' + (e && e.message)); }
  return out;
}

// the merged config (a clone of the defaults with the overrides applied); throws on anything wrong. No side effects.
function merge(overrides) {
  if (overrides === undefined) overrides = {};
  const next = clone(DEFAULT);
  apply(DEFAULT, overrides, next, 'cfg');
  relations(next);
  return next;
}
function validate(overrides) { const next = merge(overrides); return { next, smoke: smoke(next) }; }

// ---------------------------------------------------------------------------------------------------------------- payback check (K4-1)
// A config is accepted only after the server has MEASURED what every paid way to play pays back under it, and none is above CEILING_PCT. Exact arithmetic is not possible (cascades, bonuses, the lead
// economy), so this is a seeded, repeatable simulation made tight by STRATIFICATION: the payback of a way is  base part + sum over bonus kinds k of P(k) x E[bonus k] (+ the Callback / daily lead part), each
// factor sampled on its own (the same idea as games/coldcall-sim.js --strat and games/bender-rtp.js), so the 10,000x tail of the bonuses does not drown the plain spin. Every way is a batch-means estimate
// with a stated standard error; the SE of the product is the sum of the factors' SE by the delta rule. A config is refused when any way's estimate is above the ceiling. The simulation yields to the event
// loop every ~SLICE_MS ms (setImmediate), so no stretch blocks the server for more than that plus one engine step; the longest stretch seen is reported with every result.
// Policy of the player (the one the shipped prices were set against): PICK = the hot square with the most hot neighbours; ONE MORE CALL = bank (its EV is rtp x W, never above banking: relation rule).
const CEILING_PCT = 100.0;               // refuse any way whose payback is not shown to be at or under this
const BOUND_SE = 3;                      // R2C-3: a way is accepted only if measured + BOUND_SE standard errors is at or under the ceiling (the check's own uncertainty counts against the admin; a fixed seed that reads low cannot decide it)
const PB_SEED = 20261008;                // fixed: the same config always measures the same
const SLICE_MS = 40;                     // longest synchronous stretch the check asks for
const PB_DEADLINE_MS = 300000;           // a check that has not finished by then refuses (fail closed)
// R2C-3b: a way that is UNDECIDED after the budget (measured at or under the ceiling, measured + BOUND_SE standard errors above it) is not refused for being unlucky or accepted for being lucky: more rounds are run for THAT way
// (the parts of its standard error that are largest first), EXT_STEP batches at a time, until it is decided (upper bound at or under the ceiling = accept; measured above the ceiling = refuse), or each part has been
// sampled EXT_MAX_X times its budget, or EXT_MS of wall clock have passed since the check began: still undecided then = refused.
const EXT_MAX_X = 8, EXT_MS = 240000;
const PB_PLAN = { b1: 150000, b2: 50000, b3: 3000, sess: 1600000, call: 1400000, hunt: 2000000, batches: 50 };
const DAILY_GIFT_MAX_CENTS = 5;          // the daily gift may be worth at most this many cents to one account on one day (a once-a-day spin pays back above 100% of a 10-cent stake by design: the gift is cents, see report)
const hotNbrs = (adj) => { const out = []; for (let p = 0; p < 30; p++) { const r = (p / 6) | 0, c = p % 6, l = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; if (adj === 4 && dr && dc) continue; const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 5 && cc >= 0 && cc < 6) l.push(rr * 6 + cc); } out.push(l); } return out; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const varOf = (a) => { const m = mean(a); return a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1); };
const yieldLoop = () => new Promise((r) => setImmediate(r));

// the sampler of one config: all its draws come from streams seeded off (seed, stream id), so a result does not depend on the order or the chunking
function pbSampler(cfg, seed) {
  const e = Eng.createEngine(cfg), P = cfg.pull, capT = cfg.maxWinTenths, NBR = hotNbrs(cfg.adjacency);
  const pickOn = !!(P && P.on && P.pick && P.pick.on), minLeads = pickOn ? P.pick.minLeads : 0;
  const hooks = () => { let done = false; return { pickHook: (hot, nHot) => {
    if (done) return -1; done = true;
    if (!pickOn || nHot < minLeads) return -1;
    let best = -1, bn = -1; for (let p = 0; p < 30; p++) if (hot[p]) { let n = 0; for (const q of NBR[p]) if (hot[q]) n++; if (n > bn) { bn = n; best = p; } }
    return best;
  } }; };
  const rng = (stream, k) => Eng.rngFrom((seed + Math.imul(stream + 1, 0x9E3779B1) + Math.imul(k + 1, 0x85EBCA6B)) >>> 0);
  return {
    // one bought / natural bonus of kind 1..3 played with the best PICK; returns tenths of the bet
    bonus: (kind, r) => e.playBonus(r, kind, false, capT, hooks()).total,
    // one base spin of a stateless way ('call' buys a guaranteed phone, 'hunt' a hotter bell weight); returns { base, kind }
    spin: (way, r) => { const s = e.playSpin(r, 0, new Uint8Array(30), false, { guarantee: way === 'call', hunt: way === 'hunt', capLeft: capT }); const capped = s.capped || s.win >= capT; return { base: s.win, kind: !capped && s.bells >= 3 ? (s.bells >= 5 ? 3 : s.bells === 4 ? 2 : 1) : 0 }; },
    // one paid spin of the stateful plain game at a flat $1 (warm squares carry over); the bonus it played is NOT counted (replaced by its mean), the Callback leads are returned
    session: (st, r, rnd, now) => { const x = e.playRound(r, { buy: null, bet: 100, state: st, now, day: '2026-10-08', script: false, rnd, auto: true }, []); return { st: x.newState, base: x.round.clusterTenths + x.round.phoneTenths, kind: x.round.bonusKind && !x.round.capped ? x.round.bonusKind : 0, leads: x.pull.filled / 10 }; },
    rng,
  };
}

// run the whole measurement; opts: { seed, scale (1 = full budget), now() }. Resolves { ok, ceilingPct, ways: { plain, call, hunt, bonus1, bonus2, daily }, worst: { way, pct }, se, rounds, ms, maxStretchMs, seed, scale, early }
async function measurePayback(cfg, opts = {}) {
  const seed = (opts.seed === undefined ? PB_SEED : opts.seed) >>> 0, scale = opts.scale === undefined ? 1 : opts.scale, t0 = Date.now();
  const S = pbSampler(cfg, seed), P = cfg.pull || { on: false }, pullOn = !!P.on, J = PB_PLAN.batches, plan = {};
  for (const k of Object.keys(PB_PLAN)) plan[k] = k === 'batches' ? J : Math.max(J * 2, Math.round(PB_PLAN[k] * scale / J) * J);
  const acc = { b1: [], b2: [], b3: [], sess: [], call: [], hunt: [] };           // per batch: bonus mean | { n, base, k1, k2, k3, leads }
  let maxStretch = 0, mark = process.hrtime.bigint(), rounds = 0;
  const lap = () => { const t = process.hrtime.bigint(); maxStretch = Math.max(maxStretch, Number(t - mark) / 1e6); mark = t; };
  const sinceYield = () => Number(process.hrtime.bigint() - mark) / 1e6;
  const tick = async () => { if (sinceYield() >= SLICE_MS) { lap(); await yieldLoop(); mark = process.hrtime.bigint(); if (Date.now() - t0 > PB_DEADLINE_MS) throw new Error('payback check did not finish in ' + PB_DEADLINE_MS / 1000 + ' s'); if (opts.cancelled && opts.cancelled()) throw new Error('payback check cancelled'); } };
  const bonusB = async (key, kind, upto) => { const per = plan[key] / J; while (acc[key].length < upto) { const j = acc[key].length, r = S.rng(kind, j); let s = 0; for (let i = 0; i < per; i++) { s += S.bonus(kind, r); rounds++; if ((i & 15) === 15) await tick(); } acc[key].push(s / per); } };
  const stateless = async (key, upto) => { const per = plan[key] / J; while (acc[key].length < upto) { const j = acc[key].length, r = S.rng(10 + (key === 'call' ? 0 : 1), j), b = { n: per, base: 0, k1: 0, k2: 0, k3: 0 }; for (let i = 0; i < per; i++) { const x = S.spin(key, r); b.base += x.base; if (x.kind) b['k' + x.kind]++; rounds++; if ((i & 63) === 63) await tick(); } acc[key].push(b); } };
  const session = async (upto) => { const per = plan.sess / J; while (acc.sess.length < upto) { const j = acc.sess.length, r = S.rng(20, j), rnd = S.rng(21, j), b = { n: per, base: 0, k1: 0, k2: 0, k3: 0, leads: 0 }; let st = Eng.newState(), now = Date.UTC(2026, 9, 8, 12); for (let i = 0; i < per; i++) { now += 3000; const x = S.session(st, r, rnd, now); st = x.st; st.cb = null; st.lt = 0; st.avg = 0; b.base += x.base; if (x.kind) b['k' + x.kind]++; b.leads += x.leads; rounds++; if ((i & 31) === 31) await tick(); } acc.sess.push(b); } };

  // the numbers of a way from the accumulators so far
  const cbK = pullOn && P.callback ? (P.callback.kind === 'bonus2' ? 2 : 1) : 1;
  const compute = () => {
    const B = [null, 1, 2, 3].map((k) => (k ? { m: mean(acc['b' + k]), v: varOf(acc['b' + k]) / acc['b' + k].length } : null));
    const potPct = pullOn ? P.pot.feedBps / 100 : 0;                                  // the office pot pays back at most what it was fed
    const way = (batches, cost, withLeads, own) => {
      const per = batches.map((b) => { let t = b.base / b.n; for (const k of [1, 2, 3]) t += (b['k' + k] / b.n) * B[k].m; if (withLeads && pullOn) t += (b.leads / b.n / P.list) * B[cbK].m; return t / cost * 100; });
      const parts = { [own]: varOf(per) / per.length };
      for (const k of [1, 2, 3]) { let c = mean(batches.map((b) => b['k' + k] / b.n)); if (withLeads && pullOn && k === cbK) c += mean(batches.map((b) => b.leads / b.n)) / P.list; parts['b' + k] = (c / cost * 100) ** 2 * B[k].v; }
      return { pct: mean(per) + (withLeads ? potPct : 0), se: Math.sqrt(Object.values(parts).reduce((a, b) => a + b, 0)), parts };
    };
    const bought = (k, cost) => ({ pct: B[k].m / cost * 100, se: Math.sqrt(B[k].v) / cost * 100, parts: { ['b' + k]: B[k].v / cost ** 2 * 1e4 } });          // a buy never feeds or rolls the pot (coldcall.js settle: `plain` only)
    const ways = { plain: way(acc.sess, 10, true, 'sess'), call: way(acc.call, cfg.buyCost.call, false, 'call'), hunt: way(acc.hunt, cfg.buyCost.hunt, false, 'hunt'), bonus1: bought(1, cfg.buyCost.bonus1), bonus2: bought(2, cfg.buyCost.bonus2) };
    // the daily spin: the player's once-a-day spin earns the daily leads on top of the plain game, at the longest streak. Its payback is plain + gift / stake, which passes 100% at a 10-cent stake even at
    // the shipped numbers (0.4 lead x the Callback / 450 = about 0.8 cent), so the gift is judged in money: giftCents = leads x (Callback value per lead) at the bet the leads are worked at (stakeCap, 10c shipped)
    if (pullOn) { const dl = P.daily.base + P.daily.perStreak * P.daily.streakMax, cents = dl / P.list * (B[cbK].m / 10) * P.daily.stakeCap, f = dl / P.list * 10; ways.daily = { pct: ways.plain.pct + f * B[cbK].m, se: Math.hypot(ways.plain.se, f * Math.sqrt(B[cbK].v)), giftCents: cents, judged: 'gift' }; }
    return ways;
  };
  const worstOf = (ways) => Object.entries(ways).filter(([w, x]) => x.judged !== 'gift').map(([w, x]) => ({ way: w, pct: x.pct, se: x.se })).sort((a, b) => b.pct - a.pct)[0];
  // stage 1 (a tenth of the budget): a config far above the ceiling is refused at once; stage 2: the rest
  const steps = [Math.max(5, Math.round(J / 10)), J];
  let early = false, ways = null;
  for (const upto of steps) {
    await bonusB('b1', 1, upto); await bonusB('b2', 2, upto); await bonusB('b3', 3, upto); await session(upto); await stateless('call', upto); await stateless('hunt', upto);
    ways = compute(); const w = worstOf(ways);
    if (upto < J && (w.pct - 6 * w.se > CEILING_PCT || (ways.daily && ways.daily.giftCents > 4 * DAILY_GIFT_MAX_CENTS))) { early = true; break; }
  }
  // R2C-3b: extend the undecided ways (see EXT_MAX_X). Never after an early stop, and never for a config that is already over the ceiling on a point estimate or whose daily gift is too big (refused as before).
  const judged = (w) => Object.entries(w).filter(([, x]) => x.judged !== 'gift'), up = (x) => x.pct + BOUND_SE * x.se, undecided = (x) => x.pct <= CEILING_PCT && up(x) > CEILING_PCT;
  const grow = (key, upto) => (key === 'sess' ? session(upto) : key === 'call' || key === 'hunt' ? stateless(key, upto) : bonusB(key, +key[1], upto));
  const ext = { rounds: 0, batches: {}, capped: false, ms: 0 }, extT0 = Date.now(), r0 = rounds;
  while (!early && !(ways.daily && ways.daily.giftCents > DAILY_GIFT_MAX_CENTS) && !judged(ways).some(([, x]) => x.pct > CEILING_PCT)) {
    const und = judged(ways).filter(([, x]) => undecided(x)).sort((a, b) => up(b[1]) - up(a[1]));
    if (!und.length) break;
    const cand = Object.entries(und[0][1].parts).filter(([k, v]) => v > 0 && acc[k].length < EXT_MAX_X * J).sort((a, b) => b[1] - a[1]);
    if (!cand.length || Date.now() - t0 > (opts.extMs || EXT_MS)) { ext.capped = true; break; }
    const key = cand[0][0], upto = Math.min(EXT_MAX_X * J, acc[key].length + J / 2);
    await grow(key, upto); ext.batches[key] = upto; ways = compute();
  }
  ext.rounds = rounds - r0; ext.ms = Date.now() - extT0;
  lap();
  const worst = worstOf(ways);
  const giftOk = !ways.daily || ways.daily.giftCents <= DAILY_GIFT_MAX_CENTS;
  const bound = Object.entries(ways).filter(([w, x]) => x.judged !== 'gift').map(([way, x]) => ({ way, pct: x.pct, se: x.se, upper: x.pct + BOUND_SE * x.se })).sort((a, b) => b.upper - a.upper)[0];
  return { ok: bound.upper <= CEILING_PCT && giftOk, giftOk, ceilingPct: CEILING_PCT, boundSe: BOUND_SE, bound, ways, worst, rounds, extraRounds: ext.rounds, extended: ext, ms: Date.now() - t0, maxStretchMs: maxStretch, seed, scale, early };
}
// R2C-4: the admin path never runs a config's smoke test or its measuring on the server's event loop (the smoke test and a bonus of a degenerate config are synchronous, one of them can take seconds). A worker thread (this file
// again, `ccCheck` in workerData) plays the smoke test, then measurePayback(); the server only waits for its message. A config whose smoke test does not end in SMOKE_LIMIT_MS, or whose check does not end in PB_DEADLINE_MS,
// or that the admin withdrew (opts.cancelled), is stopped (terminate) and refused.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const SMOKE_LIMIT_MS = 10000;
function measureInWorker(cfg, opts = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { ccCheck: true, cfg, opts: { scale: opts.scale, seed: opts.seed, extMs: opts.extMs } }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
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
const round2 = (x) => Math.round(x * 100) / 100;
const pbSummary = (r) => Object.fromEntries(Object.entries(r.ways).map(([w, x]) => [w, { pct: round2(x.pct), se: round2(x.se), ...(x.giftCents !== undefined ? { giftCents: round2(x.giftCents) } : {}) }]));
// the label players see for a config that is not the shipped one and not a measured preset: the measured value, never a fixed claim
const measuredLabel = (r) => { const p = r.ways.plain; return round2(p.pct).toFixed(1) + '% (measured by the server when this was set: plain game, +-' + round2(1.96 * p.se).toFixed(1) + '; highest way ' + r.worst.way + ' ' + round2(r.worst.pct).toFixed(1) + '%)'; };

// ---------------------------------------------------------------------------------------------------------------- live state + file
let live = { overrides: {}, rtpLabel: null, note: '', updatedAt: null, measured: null };
let applied = false;                     // true once this process has put something other than its own boot values into Eng.CFG
let fileGiven = null;                    // set by the game module's init from the server's paths (next to money.jsonl); COLDCALL_CFG_FILE still wins
const setFile = (f) => { fileGiven = typeof f === 'string' && f ? f : null; };
const cfgFile = () => process.env.COLDCALL_CFG_FILE || fileGiven || path.join(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..'), 'coldcall-config.json');

function swapIn(next) {                  // synchronous, between rounds: Eng.CFG stays the one object every reader holds; open rounds hold their own snapshot (snapshot())
  for (const k of Object.keys(Eng.CFG)) delete Eng.CFG[k];
  Object.assign(Eng.CFG, clone(next));
  applied = true;
}
function writeFile(rec) {                // atomic: temp + rename. Throws when the disk refuses: the caller has changed nothing yet
  const f = cfgFile(), tmp = f + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(rec, null, 2)); fs.renameSync(tmp, f); } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
}

// swap the live config. Order: validate + smoke (pure), write the file, then swap. Any failure leaves memory and file as they were.
// K4-1: this is the swap machinery (synchronous: write the file, swap in place). The admin route and boot never call it with a config that was not measured: the route goes through setLiveConfigChecked
// (measure, refuse above the ceiling, then this), and boot loads a saved file only if it carries the measurement made for exactly these numbers (loadLiveConfig). A caller that gets here without a passing
// measurement for these numbers (tests of the machinery) is never silent: it writes an `unchecked` audit line, and the file it saves is not trusted at the next boot.
function setLiveConfig({ overrides, rtpLabel, note, measured } = {}) {
  const next = merge(overrides === undefined ? {} : overrides), reset = deepEq(next, DEFAULT), h = configHash(next);
  const proven = measured && measured.ok === true && measured.hash === h;
  if (!reset && !proven) smoke(next);               // R2C-4: a measured config was smoke-tested in the checking worker, the shipped one is the shipped one; only a config nobody measured plays its smoke rounds on this thread
  if (!reset && !proven && !presets().some((p) => p.measuredHash === h)) audit({ who: 'in-process caller', outcome: 'unchecked', why: 'swapped in without a payback measurement of these numbers', note: String(note || '').slice(0, 120) });
  const rec = {
    overrides: JSON.parse(JSON.stringify(overrides === undefined ? {} : overrides)),
    rtpLabel: typeof rtpLabel === 'string' && rtpLabel.trim() ? rtpLabel.trim().slice(0, 160) : null,
    note: String(note || '').slice(0, 300), updatedAt: new Date().toISOString(),
    measured: !reset && proven ? measured : null,
  };
  writeFile(rec.measured ? rec : (({ measured: _m, ...r }) => r)(rec));
  swapIn(next); live = rec;
  if (checking) { checking.cancelled = true; checking = null; }   // R2C-2: an accepted change (a reset included) supersedes the payback check in flight
  return liveInfo();
}
const auditFile = () => cfgFile() + '.audit.log';
function audit(rec) {                    // one line per accepted or refused change: when, who, old and new measured payback
  const line = JSON.stringify({ t: new Date().toISOString(), game: 'coldcall', ...rec });
  console.log('[cfg-audit] ' + line);
  try { fs.appendFileSync(auditFile(), line + '\n'); } catch {}
}
// R2C-2: the payback check that is running (null when none); setLiveConfig cancels it, so a check that ends later cannot swap in on top of a later admin action.
let checking = null;
const SUPERSEDED = 'another admin change (a reset or a new config) was accepted while this check ran; nothing was changed by this one';
// The admin path: validate, MEASURE (async, never blocks the loop for long), refuse above the ceiling, then write + swap. `who` is a short text naming the caller (the route passes a token fingerprint + address).
// Resolves liveInfo on success; rejects with an Error whose message says why (bad value, or the measured payback). Every outcome is one audit line.
async function setLiveConfigChecked({ overrides, rtpLabel, note, who, scale, seed } = {}) {
  const old = live.measured ? { pct: live.measured.summary.plain && live.measured.summary.plain.pct, worst: live.measured.worst, source: 'measured when set' } : { pct: 98.0, source: isCustom() ? 'unmeasured custom (pre-check file)' : 'shipped label (200M-spin sim)' };
  const log = (rec) => audit({ who: who || 'unknown', note: String(note || '').slice(0, 120), old, ...rec });
  let next;
  try { next = merge(overrides === undefined ? {} : overrides); } catch (e) { log({ outcome: 'refused', why: String(e.message).slice(0, 200), new: null }); throw e; }
  if (deepEq(next, DEFAULT)) {                       // back to the shipped numbers: nothing to measure
    try { const info = setLiveConfig({ overrides: {}, note }); log({ outcome: 'accepted', new: { pct: 98.0, source: 'shipped' } }); return info; } catch (e) { log({ outcome: 'refused', why: String(e.message).slice(0, 200), new: null }); throw e; }
  }
  if (checking) { const e = new Error('cfg: another payback check is running, try again when it has finished'); log({ outcome: 'refused', why: e.message, new: null }); throw e; }
  const token = checking = { cancelled: false };
  let m;
  try { m = await measureInWorker(next, { scale, seed, cancelled: () => token.cancelled }); } catch (e) { if (checking === token) checking = null; const why = token.cancelled ? SUPERSEDED : 'check failed: ' + String(e.message).slice(0, 200); log({ outcome: 'refused', why, new: null }); throw token.cancelled ? new Error('cfg: refused, ' + why) : e; }
  if (checking === token) checking = null;
  if (token.cancelled) { log({ outcome: 'refused', why: SUPERSEDED, new: null }); throw new Error('cfg: refused, ' + SUPERSEDED); }
  const summary = pbSummary(m), nw = { worst: { way: m.worst.way, pct: round2(m.worst.pct), se: round2(m.worst.se) }, plain: summary.plain, ways: summary, ms: m.ms, maxStretchMs: round2(m.maxStretchMs), extraRounds: m.extraRounds, seed: m.seed };
  if (!m.ok) {
    const b = m.bound, why = !m.giftOk ? 'the daily gift is worth ' + round2(m.ways.daily.giftCents) + ' cents a day (limit ' + DAILY_GIFT_MAX_CENTS + ')' : 'the ' + b.way + ' way is not shown to be at or under the ' + CEILING_PCT + '% ceiling: measured ' + round2(b.pct) + '% with a standard error of ' + round2(b.se) + ' points, so its upper bound (measured + ' + BOUND_SE + ' standard errors) is ' + round2(b.upper) + '%, above the ' + CEILING_PCT + '% ceiling' + (m.extraRounds ? ' (after ' + m.extraRounds + ' extra rounds on the undecided ways' + (m.extended.capped ? ', the limit for extra rounds was reached' : '') + ')' : '');
    log({ outcome: 'refused', why, new: nw }); throw new Error('cfg: refused, ' + why + (m.early ? ' (stopped early)' : ''));
  }
  const measured = { hash: configHash(next), ok: true, ceilingPct: CEILING_PCT, label: measuredLabel(m), summary, worst: nw.worst, seed: m.seed, at: new Date().toISOString() };
  try { const info = setLiveConfig({ overrides, rtpLabel, note, measured }); log({ outcome: 'accepted', new: nw }); return info; } catch (e) { log({ outcome: 'refused', why: String(e.message).slice(0, 200), new: nw }); throw e; }
}

// boot: load the saved file. A missing file leaves Eng.CFG alone; a damaged one (bad JSON, wrong shape, a config that fails validation) is logged ONCE and the game boots on the
// defaults. Never throws. The damaged file is kept for inspection until the next good save replaces it.
function loadLiveConfig(log) {
  const say = log || ((...a) => console.error(...a));
  const toDefaults = () => { if (applied) swapIn(DEFAULT); live = { overrides: {}, rtpLabel: null, note: '', updatedAt: null, measured: null }; };
  let raw;
  try { raw = fs.readFileSync(cfgFile(), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') say('[coldcall] live config not loaded, using defaults:', e.message); toDefaults(); return false; }
  try {
    const j = JSON.parse(raw);
    if (!isPlain(j)) throw new Error('the file is not an object');
    const overrides = j.overrides === undefined ? {} : j.overrides;
    for (const [k, t] of [['rtpLabel', 'string'], ['note', 'string'], ['updatedAt', 'string']]) if (j[k] !== undefined && j[k] !== null && typeof j[k] !== t) throw new Error('the file has a ' + k + ' that is not text');
    const { next } = validate(overrides);
    // K4-1: a saved file goes live only with the payback measurement that was made when it was set (same numbers, passed), or as a preset measured offline (hash of a known preset). Anything else is not trusted.
    const h = configHash(next), m = j.measured, trusted = deepEq(next, DEFAULT) || presets().some((p) => p.measuredHash === h) || (isPlain(m) && m.ok === true && m.hash === h && isPlain(m.summary) && isPlain(m.worst));
    if (!trusted) throw new Error('the saved config has no passing payback measurement; POST it again so the server can measure it');
    swapIn(next);
    live = { measured: isPlain(m) && m.hash === h ? m : null, overrides: JSON.parse(JSON.stringify(overrides)), rtpLabel: typeof j.rtpLabel === 'string' && j.rtpLabel ? j.rtpLabel.slice(0, 160) : null, note: typeof j.note === 'string' ? j.note.slice(0, 300) : '', updatedAt: typeof j.updatedAt === 'string' ? j.updatedAt : null };
    return true;
  } catch (e) { say('[coldcall] live config not loaded, using defaults:', e && e.message); toDefaults(); return false; }
}

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isCustom = () => !deepEq(Eng.CFG, DEFAULT);

// FIX D3: an RTP label is a claim about ONE set of numbers. The hash of a full merged config (sha256 of its JSON with every key sorted) identifies those numbers; each preset file carries the
// `measuredHash` of the config its label was measured on (tools/coldcall-preset-hash.js writes it; tests/coldcall-presets.js recomputes it against the current shipped defaults).
const stable = (v) => (Array.isArray(v) ? v.map(stable) : isPlain(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
const configHash = (cfg) => crypto.createHash('sha256').update(JSON.stringify(stable(cfg))).digest('hex');
let hashMemo = { json: null, hash: null };
const liveHash = () => { const j = JSON.stringify(Eng.CFG); if (hashMemo.json !== j) hashMemo = { json: j, hash: configHash(Eng.CFG) }; return hashMemo.hash; };
const PRESET_DIR = path.join(__dirname, '..', 'cold-call', 'presets');
let presetCache = null;
function presets() {                     // [{ name, rtpLabel, measuredHash }]; a missing folder or a damaged file leaves fewer known presets, which only ever makes the label more cautious
  if (presetCache) return presetCache;
  const out = [];
  try {
    for (const f of fs.readdirSync(PRESET_DIR).filter((x) => x.endsWith('.json')).sort()) {
      try { const j = JSON.parse(fs.readFileSync(path.join(PRESET_DIR, f), 'utf8')); if (typeof j.rtpLabel === 'string' && /^[0-9a-f]{64}$/.test(j.measuredHash)) out.push({ name: f.replace(/\.json$/, ''), rtpLabel: j.rtpLabel.trim().slice(0, 160), measuredHash: j.measuredHash }); } catch {}
    }
  } catch {}
  return (presetCache = out);
}
// the label that goes with the math in force: the shipped line while the numbers are the shipped ones; a label that came with the overrides ONLY when the live merged config is, hash for hash,
// the one a known preset's label was measured on; anything else (hand-edited preset, a saved file re-merged onto changed defaults, any other number) reads "custom settings, not measured"
const rtp = (shipped) => {
  if (!isCustom()) return shipped;
  const h = liveHash();
  if (live.rtpLabel && presets().some((p) => p.rtpLabel === live.rtpLabel && p.measuredHash === h)) return live.rtpLabel;
  return live.measured && live.measured.hash === h && typeof live.measured.label === 'string' ? live.measured.label : CUSTOM_LABEL;
};
// said in the POST reply: a label that was sent and is not what the room is shown
const labelWarning = (shipped) => (live.rtpLabel && rtp(shipped) !== live.rtpLabel ? 'rtpLabel not shown: it is not the label of a known preset measured on exactly these numbers (the room reads "' + rtp(shipped) + '")' : null);

// ---------------------------------------------------------------------------------------------------------------- what clients get
const buyPrices = () => Object.fromEntries(Eng.BET_LEVELS.map((bet) => [bet, Object.fromEntries(Eng.BUYS.map((b) => [b, Eng.buyPrice(Eng.CFG.buyCost[b], bet)]))]));
// the live math as the info screen needs it (everything but the PULL rules, which go in `rules`); payTenths = the effective pay table in tenths of the bet (payScale applied the way the engine does)
function publicCfg() {
  const c = clone(Eng.CFG); delete c.pull;
  c.payTenths = Object.fromEntries(Eng.SYM.slice(0, Eng.NREG).map((n) => [n, (Eng.CFG.pay[n] || []).map((v) => Math.max(1, Math.round(v * Eng.CFG.payScale)))]));
  return c;
}
// the payload of `g:coldcall:cfg` (broadcast on every swap) and the fields `g:coldcall:state` carries: a COPY, editing it moves nothing
function clientCfg(shipped) { return { cfg: publicCfg(), rules: clone(Eng.CFG.pull || null), buyPriceCents: buyPrices(), rtp: rtp(shipped), bets: Eng.BET_LEVELS.slice() }; }
function liveInfo(shipped) {
  return { file: cfgFile(), rtpLabel: rtp(shipped), warning: labelWarning(shipped), configHash: liveHash(), custom: isCustom(), note: live.note, updatedAt: live.updatedAt, measured: live.measured ? clone(live.measured) : null, overrides: clone(live.overrides), cfg: clone(Eng.CFG), defaults: clone(DEFAULT) };
}

// ---------------------------------------------------------------------------------------------------------------- snapshots (item 3)
// The whole live config at this instant plus an engine built from THAT copy. A round runs, replays, defaults and settles on its snapshot, whatever is swapped meanwhile:
// every table the engine bakes (weights, pay, reveal, ...) and every knob it reads live comes from the copy. structuredClone keeps Infinity / NaN as they are.
// FIX D6: built ONCE per distinct config, not twice per spin: the snapshot is memoised on the content of Eng.CFG (a swap changes it; so does a test that edits a knob in place) and handed, deep-frozen,
// to every round, every `state` request and every settle. A round keeps its own reference, so "an open round finishes on the config it started on" still holds after a swap (a new object is built then).
// Non-finite numbers are named in the key (JSON would turn Infinity / NaN into null and a knob going from one to the other would reuse a stale engine).
const deepFreeze = (o) => { if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; };
const keyOf = (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? '#' + v : v);
let snapMemo = null;
function snapshot() {
  const j = JSON.stringify(Eng.CFG, keyOf);
  if (snapMemo && snapMemo.json === j) return snapMemo.K;
  const cfg = deepFreeze(clone(Eng.CFG)), K = { cfg, eng: Eng.createEngine(cfg) };
  snapMemo = { json: j, K };
  return K;
}
// P6: an open round's record carries the WHOLE config it runs on, so a restart can finish it on the same numbers. JSON turns Infinity / NaN into null, so a non-finite number is stored as
// { $num: 'Infinity' | '-Infinity' | 'NaN' } and read back as the number. restoreSnapshot gives the same { cfg (frozen), eng } shape as snapshot(), built from a stored config (memoised on its content).
const encodeCfg = (v) => (typeof v === 'number' && !Number.isFinite(v) ? { $num: String(v) } : Array.isArray(v) ? v.map(encodeCfg) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).map((k) => [k, encodeCfg(v[k])])) : v);
const decodeCfg = (v) => {
  if (Array.isArray(v)) return v.map(decodeCfg);
  if (v !== null && typeof v === 'object') {
    const ks = Object.keys(v);
    if (ks.length === 1 && ks[0] === '$num') { if (!['Infinity', '-Infinity', 'NaN'].includes(v.$num)) throw new Error('bad stored number'); return Number(v.$num); }
    return Object.fromEntries(ks.map((k) => [k, decodeCfg(v[k])]));
  }
  return v;
};
const restored = new Map();
function restoreSnapshot(stored) {
  if (!isPlain(stored)) throw new Error('stored config is not an object');
  const j = JSON.stringify(stored);
  if (restored.has(j)) return restored.get(j);
  const cfg = deepFreeze(decodeCfg(JSON.parse(j))), K = { cfg, eng: Eng.createEngine(cfg) };
  if (restored.size >= 8) restored.delete(restored.keys().next().value);
  restored.set(j, K);
  return K;
}
// the stateless round of the old game (pull off, the QA hook) on a snapshot; same shape as Eng.resolveRound
function resolveRound(K, rng, buy, opts) {
  const r = K.eng.round(rng, buy, { script: true, ...(opts || {}) });
  return { round: r, buy: r.buy, costTenths: r.costTenths, winTenths: r.winTenths, winX: r.winX, capped: r.capped, tier: r.tier, script: r.script };
}

if (!isMainThread && workerData && workerData.ccCheck) {
  (async () => {
    try { smoke(workerData.cfg); parentPort.postMessage({ stage: 'smoke' }); parentPort.postMessage({ ok: true, r: await measurePayback(workerData.cfg, workerData.opts) }); }
    catch (e) { parentPort.postMessage({ ok: false, message: String(e && e.message) }); }
  })();
}
module.exports = { measureInWorker, setLiveConfigChecked, DAILY_GIFT_MAX_CENTS, measurePayback, pbSummary, measuredLabel, CEILING_PCT, DEFAULT, CUSTOM_LABEL, RULES, file: cfgFile, setFile, encodeCfg, decodeCfg, restoreSnapshot, configHash, presets, merge, validate, smoke, setLiveConfig, loadLiveConfig, liveInfo, clientCfg, publicCfg, buyPrices, rtp, snapshot, resolveRound };
