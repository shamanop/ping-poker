'use strict';
/* CAMPAIGN TRAIL engine: pure, no I/O, no Math.random, never mutates its input. Contract: CAMPAIGN-DESIGN.md section 2, maths: CAMPAIGN-MATH.md.
   The multiplier is an integer in hundredths (mx, 100 = 1.00x). The scandal chance is derived from the two integers, so
   P(survive) * mx = 0.96 * 100 after every step of every route: RTP is 96.00% by algebra. The house edge sits in step 1 only. */
const MAP = require('./campaign-map.js');

const VERSION = 1, RTP_BPS = 9600, LANDSLIDE_MX = 100000, CAP_MX = 1000000, MAX_STEPS = 49;
const BET_LEVELS = [100, 200, 500, 1000, 2500];
const TIERS = MAP.tiers;
/* The rules a run is played on: the borders and tier of every state, the step limit, the LANDSLIDE and the cap. `CUR` is this build's (it reads MAP live); a run stores `snapshot()` of it when it is opened
   and every function below takes that as its last argument, so a deploy that edits the map never changes what an open run is worth (ADD-A-GAME.md section 4). */
const CUR = { v: VERSION, maxSteps: MAX_STEPS, landslideMx: LANDSLIDE_MX, capMx: CAP_MX, get states() { return MAP.states; } };
const DONE = [null, 'scandal', 'deadend', 'landslide'];

class EngineError extends Error {
  constructor(code, message) { super(message || code); this.name = 'EngineError'; this.code = code; }
}
const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

/* Step n (1-based) from mxPrev to mxNext: 1 - R(n) * mxPrev / mxNext with R(1) = 0.96, else 1. One integer division, so it is correctly rounded. */
function pFail(mxPrev, mxNext, n) {
  if (n === 1) return (10000 * mxNext - RTP_BPS * mxPrev) / (10000 * mxNext);
  return (mxNext - mxPrev) / mxNext;
}
const nextMx = (mxPrev, g100, n, map = CUR) => (n === map.maxSteps ? map.landslideMx : Math.floor(mxPrev * g100 / 100));

function newRun(home) {
  if (!has(MAP.states, home)) throw new EngineError('bad_home', 'unknown home state');
  return { v: VERSION, home, at: home, trail: [home], steps: 0, mx: 100, done: null };
}

/* `tiers` (optional, same shape as TIERS) is the growth table a run was OPENED with and `map` (optional, `snapshot()` shape) its borders / tiers / limits: a stored run is paid and checked on its own numbers,
   never on a table or a map a later deploy changed (ADD-A-GAME.md section 4). */
function options(run, tiers = TIERS, map = CUR) {
  if (run.done) return [];
  const n = run.steps + 1, out = [], st = map.states;
  for (const to of st[run.at].adj) {
    if (run.trail.includes(to)) continue;
    const tier = st[to].tier, g100 = tiers[tier].g100, mx = nextMx(run.mx, g100, n, map);
    const deadEnd = n < map.maxSteps && st[to].adj.every((a) => a === to || run.trail.includes(a));
    out.push({ to, tier, g100, nextMx: mx, pFail: pFail(run.mx, mx, n), deadEnd, landslide: n === map.maxSteps });
  }
  return out;
}

/* A deep copy of the rules a run starts on (what `map` above is). */
function snapshot() {
  const states = {};
  for (const c of Object.keys(MAP.states)) states[c] = { tier: MAP.states[c].tier, adj: MAP.states[c].adj.slice() };
  return { v: VERSION, maxSteps: MAX_STEPS, landslideMx: LANDSLIDE_MX, capMx: CAP_MX, states };
}
/* Is a stored snapshot usable with the growth table `tiers`? Whole shape, every border points at a state, every tier has a growth. A stored value is never trusted as it stands. */
function mapOk(m, tiers = TIERS) {
  const isInt = Number.isSafeInteger, plain = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  if (!plain(m) || !plain(m.states) || !plain(tiers)) return false;
  if (!isInt(m.v) || !isInt(m.maxSteps) || m.maxSteps < 1 || m.maxSteps > 200 || !isInt(m.landslideMx) || m.landslideMx < 100 || !isInt(m.capMx) || m.capMx < m.landslideMx) return false;
  const codes = Object.keys(m.states);
  if (codes.length < 1 || codes.length > 200) return false;
  return codes.every((c) => { const x = m.states[c]; return plain(x) && has(tiers, x.tier) && plain(tiers[x.tier]) && Array.isArray(x.adj) && x.adj.length <= 200 && x.adj.every((a) => has(m.states, a)); });
}

function step(run, to, rng, tiers = TIERS, map = CUR) {
  if (run.done) throw new EngineError('bad_step', 'run is over');
  const opt = options(run, tiers, map).find((o) => o.to === to);
  if (!opt) throw new EngineError('bad_step', 'not an option');
  const trail = run.trail.slice();
  if (rng() < opt.pFail) return { ok: false, run: { ...run, trail, done: 'scandal', failedAt: to }, opt };
  const steps = run.steps + 1;
  if (opt.nextMx > map.capMx) throw new EngineError('bad_run', 'cap');
  trail.push(to);
  return { ok: true, run: { ...run, at: to, trail, steps, mx: opt.nextMx, done: steps === map.maxSteps ? 'landslide' : opt.deadEnd ? 'deadend' : null }, opt };
}

function payout(run, bet) {
  if (run.done === 'scandal') return 0;
  if (run.steps === 0) throw new EngineError('bad_run', 'no step taken: refund, not a win');
  const win = bet * run.mx / 100;
  if (!Number.isSafeInteger(bet) || bet <= 0 || !Number.isSafeInteger(win)) throw new EngineError('bad_bet', 'bet does not pay whole units');
  return win;
}

/* Re-derive at / steps / mx / done from home + trail. A stored record is never trusted as it stands. */
function check(run, tiers = TIERS, map = CUR) {
  const bad = (m) => { throw new EngineError('bad_run', m); };
  if (!run || typeof run !== 'object' || run.v !== map.v || !has(map.states, run.home)) bad('shape');
  const t = run.trail;
  if (!Array.isArray(t) || t.length < 1 || t.length > map.maxSteps + 1 || t[0] !== run.home || !DONE.includes(run.done)) bad('trail');
  let mx = 100;
  for (let i = 1; i < t.length; i++) {
    if (!has(map.states, t[i]) || t.indexOf(t[i]) !== i) bad('repeat');
    if (!map.states[t[i - 1]].adj.includes(t[i])) bad('hop');
    mx = nextMx(mx, tiers[map.states[t[i]].tier].g100, i, map);
    if (mx > map.capMx) bad('cap');
  }
  const steps = t.length - 1, at = t[steps];
  if (run.steps !== steps || run.at !== at || run.mx !== mx) bad('derived');
  const live = options({ ...run, done: null }, tiers, map).length;
  if (run.done === 'scandal') {
    if (!map.states[at].adj.includes(run.failedAt) || t.includes(run.failedAt) || steps >= map.maxSteps) bad('failedAt');
  } else if (run.failedAt !== undefined) bad('failedAt');
  if (run.done === 'landslide' ? steps !== map.maxSteps : run.done === 'deadend' ? live !== 0 || steps === map.maxSteps : run.done === null && (live === 0 || steps === map.maxSteps)) bad('done');
  return true;
}

module.exports = { VERSION, RTP_BPS, LANDSLIDE_MX, CAP_MX, MAX_STEPS, BET_LEVELS, TIERS, MAP, EngineError, newRun, options, step, payout, check, pFail, nextMx, snapshot, mapOk, CUR };
