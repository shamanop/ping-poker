'use strict';
// COLD CALL live config: change the slot math without a redeploy (the same switch Ballot Bender has, see games/bender-engine.js "SERVER ADDITIONS").
// Overrides are deep-merged onto the shipped defaults, validated (type, range, shape, relationships), smoke-tested on a real engine built from the
// merged config, saved on the data volume, then swapped into Eng.CFG in place between rounds. A bad config throws and changes NOTHING (memory and file).
// The engine file stays pure and unchanged; everything with a file, an env var or a clock lives here. Contract: cold-call/PULL-ENGINE.md section 8.
const fs = require('fs');
const path = require('path');
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

// ---------------------------------------------------------------------------------------------------------------- live state + file
let live = { overrides: {}, rtpLabel: null, note: '', updatedAt: null };
let applied = false;                     // true once this process has put something other than its own boot values into Eng.CFG
const cfgFile = () => process.env.COLDCALL_CFG_FILE || path.join(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..'), 'coldcall-config.json');

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
function setLiveConfig({ overrides, rtpLabel, note } = {}) {
  const { next } = validate(overrides === undefined ? {} : overrides);
  const rec = {
    overrides: JSON.parse(JSON.stringify(overrides === undefined ? {} : overrides)),
    rtpLabel: typeof rtpLabel === 'string' && rtpLabel.trim() ? rtpLabel.trim().slice(0, 160) : null,
    note: String(note || '').slice(0, 300), updatedAt: new Date().toISOString(),
  };
  writeFile(rec);
  swapIn(next); live = rec;
  return liveInfo();
}

// boot: load the saved file. A missing file leaves Eng.CFG alone; a damaged one (bad JSON, wrong shape, a config that fails validation) is logged ONCE and the game boots on the
// defaults. Never throws. The damaged file is kept for inspection until the next good save replaces it.
function loadLiveConfig(log) {
  const say = log || ((...a) => console.error(...a));
  const toDefaults = () => { if (applied) swapIn(DEFAULT); live = { overrides: {}, rtpLabel: null, note: '', updatedAt: null }; };
  let raw;
  try { raw = fs.readFileSync(cfgFile(), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') say('[coldcall] live config not loaded, using defaults:', e.message); toDefaults(); return false; }
  try {
    const j = JSON.parse(raw);
    if (!isPlain(j)) throw new Error('the file is not an object');
    const overrides = j.overrides === undefined ? {} : j.overrides;
    for (const [k, t] of [['rtpLabel', 'string'], ['note', 'string'], ['updatedAt', 'string']]) if (j[k] !== undefined && j[k] !== null && typeof j[k] !== t) throw new Error('the file has a ' + k + ' that is not text');
    const { next } = validate(overrides);
    swapIn(next);
    live = { overrides: JSON.parse(JSON.stringify(overrides)), rtpLabel: typeof j.rtpLabel === 'string' && j.rtpLabel ? j.rtpLabel.slice(0, 160) : null, note: typeof j.note === 'string' ? j.note.slice(0, 300) : '', updatedAt: typeof j.updatedAt === 'string' ? j.updatedAt : null };
    return true;
  } catch (e) { say('[coldcall] live config not loaded, using defaults:', e && e.message); toDefaults(); return false; }
}

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isCustom = () => !deepEq(Eng.CFG, DEFAULT);
// the label that goes with the math in force: the one that came with the overrides, else "custom settings, not measured" when the numbers differ from the shipped ones, else the shipped line
const rtp = (shipped) => live.rtpLabel || (isCustom() ? CUSTOM_LABEL : shipped);

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
  return { file: cfgFile(), rtpLabel: rtp(shipped), custom: isCustom(), note: live.note, updatedAt: live.updatedAt, overrides: clone(live.overrides), cfg: clone(Eng.CFG), defaults: clone(DEFAULT) };
}

// ---------------------------------------------------------------------------------------------------------------- snapshots (item 3)
// The whole live config at this instant plus an engine built from THAT copy. A round runs, replays, defaults and settles on its snapshot, whatever is swapped meanwhile:
// every table the engine bakes (weights, pay, reveal, ...) and every knob it reads live comes from the copy. structuredClone keeps Infinity / NaN as they are.
function snapshot() { const cfg = clone(Eng.CFG); return { cfg, eng: Eng.createEngine(cfg) }; }
// the stateless round of the old game (pull off, the QA hook) on a snapshot; same shape as Eng.resolveRound
function resolveRound(K, rng, buy, opts) {
  const r = K.eng.round(rng, buy, { script: true, ...(opts || {}) });
  return { round: r, buy: r.buy, costTenths: r.costTenths, winTenths: r.winTenths, winX: r.winX, capped: r.capped, tier: r.tier, script: r.script };
}

module.exports = { DEFAULT, CUSTOM_LABEL, RULES, file: cfgFile, merge, validate, smoke, setLiveConfig, loadLiveConfig, liveInfo, clientCfg, publicCfg, buyPrices, rtp, snapshot, resolveRound };
