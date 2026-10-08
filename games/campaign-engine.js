'use strict';
/* CAMPAIGN TRAIL engine: pure, no I/O, no Math.random, never mutates its input. Contract: CAMPAIGN-DESIGN.md section 2, maths: CAMPAIGN-MATH.md.
   The multiplier is an integer in hundredths (mx, 100 = 1.00x). The scandal chance is derived from the two integers, so
   P(survive) * mx = 0.96 * 100 after every step of every route: RTP is 96.00% by algebra. The house edge sits in step 1 only. */
const MAP = require('./campaign-map.js');

const VERSION = 1, RTP_BPS = 9600, LANDSLIDE_MX = 100000, CAP_MX = 1000000, MAX_STEPS = 49;
const BET_LEVELS = [100, 200, 500, 1000, 2500];
const TIERS = MAP.tiers;
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
const nextMx = (mxPrev, g100, n) => (n === MAX_STEPS ? LANDSLIDE_MX : Math.floor(mxPrev * g100 / 100));

function newRun(home) {
  if (!has(MAP.states, home)) throw new EngineError('bad_home', 'unknown home state');
  return { v: VERSION, home, at: home, trail: [home], steps: 0, mx: 100, done: null };
}

function options(run) {
  if (run.done) return [];
  const n = run.steps + 1, out = [];
  for (const to of MAP.states[run.at].adj) {
    if (run.trail.includes(to)) continue;
    const tier = MAP.states[to].tier, g100 = TIERS[tier].g100, mx = nextMx(run.mx, g100, n);
    const deadEnd = n < MAX_STEPS && MAP.states[to].adj.every((a) => a === to || run.trail.includes(a));
    out.push({ to, tier, g100, nextMx: mx, pFail: pFail(run.mx, mx, n), deadEnd, landslide: n === MAX_STEPS });
  }
  return out;
}

function step(run, to, rng) {
  if (run.done) throw new EngineError('bad_step', 'run is over');
  const opt = options(run).find((o) => o.to === to);
  if (!opt) throw new EngineError('bad_step', 'not an option');
  const trail = run.trail.slice();
  if (rng() < opt.pFail) return { ok: false, run: { ...run, trail, done: 'scandal', failedAt: to }, opt };
  const steps = run.steps + 1;
  if (opt.nextMx > CAP_MX) throw new EngineError('bad_run', 'cap');
  trail.push(to);
  return { ok: true, run: { ...run, at: to, trail, steps, mx: opt.nextMx, done: steps === MAX_STEPS ? 'landslide' : opt.deadEnd ? 'deadend' : null }, opt };
}

function payout(run, bet) {
  if (run.done === 'scandal') return 0;
  if (run.steps === 0) throw new EngineError('bad_run', 'no step taken: refund, not a win');
  const win = bet * run.mx / 100;
  if (!Number.isSafeInteger(bet) || bet <= 0 || !Number.isSafeInteger(win)) throw new EngineError('bad_bet', 'bet does not pay whole units');
  return win;
}

/* Re-derive at / steps / mx / done from home + trail. A stored record is never trusted as it stands. */
function check(run) {
  const bad = (m) => { throw new EngineError('bad_run', m); };
  if (!run || typeof run !== 'object' || run.v !== VERSION || !has(MAP.states, run.home)) bad('shape');
  const t = run.trail;
  if (!Array.isArray(t) || t.length < 1 || t.length > 50 || t[0] !== run.home || !DONE.includes(run.done)) bad('trail');
  let mx = 100;
  for (let i = 1; i < t.length; i++) {
    if (!has(MAP.states, t[i]) || t.indexOf(t[i]) !== i) bad('repeat');
    if (!MAP.states[t[i - 1]].adj.includes(t[i])) bad('hop');
    mx = nextMx(mx, TIERS[MAP.states[t[i]].tier].g100, i);
    if (mx > CAP_MX) bad('cap');
  }
  const steps = t.length - 1, at = t[steps];
  if (run.steps !== steps || run.at !== at || run.mx !== mx) bad('derived');
  const live = options({ ...run, done: null }).length;
  if (run.done === 'scandal') {
    if (!MAP.states[at].adj.includes(run.failedAt) || t.includes(run.failedAt) || steps >= MAX_STEPS) bad('failedAt');
  } else if (run.failedAt !== undefined) bad('failedAt');
  if (run.done === 'landslide' ? steps !== MAX_STEPS : run.done === 'deadend' ? live !== 0 || steps === MAX_STEPS : run.done === null && (live === 0 || steps === MAX_STEPS)) bad('done');
  return true;
}

module.exports = { VERSION, RTP_BPS, LANDSLIDE_MX, CAP_MX, MAX_STEPS, BET_LEVELS, TIERS, MAP, EngineError, newRun, options, step, payout, check, pFail, nextMx };
