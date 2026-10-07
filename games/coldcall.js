'use strict';
// COLD CALL: server-authoritative slot. Math lives in coldcall-engine.js (same file the client copy uses, for animation only).
// P6: every unit of money is a balance in the ledger and every movement is ONE ctx.money call (ADD-A-GAME.md sections 3-5). This module keeps its own
// state (leads, Callback, the open-round records, the pot's remainder and statistics) in coldcall-pull.json; none of it is money. See cold-call/PULL-STATE.md "P6: money on the ledger".
const crypto = require('crypto');
const path = require('path');
const Eng = require('./coldcall-engine.js');
const { createStore } = require('./coldcall-store.js');
const L = require('./coldcall-livecfg.js');   // live config: validate / smoke / swap / persist, and the per-round snapshot (config + an engine built from it)

const BET_LEVELS = Eng.BET_LEVELS;   // cents: 1, 2, 5 (DENOMS), then 10 and up
const BUYS = Eng.BUYS;   // call, bonus1, bonus2, hunt (prices in Eng.CFG.buyCost, tenths of the bet; whole cents at every bet through Eng.buyPrice)
const RATE_MS = 150;
const HISTORY_MAX = 20;
const RTP_LABEL = '98.0% (long-run, 200M-spin sim, +-0.22, includes the Callback and the office pot)';
const rtpLabel = () => L.rtp(RTP_LABEL);   // the label that goes with the math in force: the shipped line, the one that came with the overrides, or "custom settings, not measured"

// QA hook: forces a feature so the front end can be driven by a test. It runs ONLY when the server process was started
// with COLDCALL_TEST=1 (and NODE_ENV is not 'production'); otherwise `force` in a spin payload is ignored. Forced rounds are paid and
// charged through the normal money path, with real engine rounds (bells placed, or whole rounds re-rolled until the condition holds; no hand-made scripts).
//   bonus1 / bonus2 / bonus3 = 3 / 4 / 5 bells land; phone = phone feature with >= 4 hot leads; close = phone feature with a close and a second reveal round;
//   big = round pays >= 25x; tease = exactly 2 bells, no bonus.
const FORCES = Eng.FORCES;
const testHookOn = () => process.env.COLDCALL_TEST === '1' && process.env.NODE_ENV !== 'production';
const resolveForced = (K, rng, force) => L.resolveRound(K, rng, null, { force });

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || ''); };
const nkey = (k) => String(k).toLowerCase().trim();   // same normalisation as ctx.money
const whoOf = (socket) => { const a = socket.data && socket.data.acct; return String((a && typeof a === 'object' ? (a.display || a.key) : a) || ''); };
const clone = (o) => JSON.parse(JSON.stringify(o));
// LIVECFG: a round is played on a SNAPSHOT of the whole live config (L.snapshot(): a structuredClone of Eng.CFG, so Infinity survives, W1B N3, plus an engine built from that copy, so
// the baked tables and every live-read knob come from it, W1B N6). The live config can be swapped (setLiveConfig) between any two rounds: an open round never notices.
const CEILING_MS = 180000;           // a decision's timer is armed to max(timeoutMs, this) when the pending result is sent; the first `ready` brings it down to timeoutMs from then (U4)
const DEFAULT_TIMEOUT_MS = 20000;   // armTimer's fallback when decision.timeoutMs is missing or not a finite positive number (W1B N4)
// names that would address Object.prototype if they ever became a plain-object key
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const reserved = (k) => RESERVED.has(nkey(k));
const rateLast = new Map(); // account key (normalised) -> time of its last accepted spin: the 150 ms limit is per account, not per socket
const readyLast = new Map(); // the same limit for `ready`, kept apart so a spin does not block the ready that follows it

function err(socket, code, message, extra) { socket.emit('error', { message, code, game: 'coldcall', ...(extra || {}) }); }

// a refused bet: `funds` is told as it always was; any other refusal of the ledger is the generic one
const fundsMsg = (mode) => (mode === 'chips' ? 'Not enough chips' : 'Not enough Play $');
function walletErr(socket, e, mode) {
  if (e && e.code === 'funds') return err(socket, 'funds', fundsMsg(mode));
  return err(socket, 'bad_request', 'Could not place that bet');
}

// ---------------------------------------------------------------------------------------------------------------- THE PULL
// Player state, decisions, feed. See cold-call/PULL-ENGINE.md section 4 and PULL-STATE.md "P6". The money of one spin or one settlement is ONE ctx.money call; the state follows it
// in the same synchronous block (no await, timer or callback between reading the pool and writing the batch), so concurrent callers cannot interleave.
const pullOn = () => { const c = Eng.CFG.pull; return !!(c && c.on !== false); };
let C = null;                 // the games ctx from init (io, money, now)
let store = null;
const open = new Map();       // roundId -> open record (memory: tape, state snapshot, timer, owning socket)
const openByKey = new Map();  // "<nkey>|<mode>" -> open record
let feed = [], feedSeq = 0;   // ring buffer (50), memory only
const FEED_MAX = 50, FEED_STATE = 20, FEED_MIN_CENTS = 500;   // FEED_MIN_CENTS: the fallback when a snapshot has no (or a damaged) feed.minWinCents
const POOL = 'office';        // the one shared pot: pool:coldcall:office, a balance per currency

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' });
const chicagoDay = (ms) => dayFmt.format(new Date(ms));
const pullCfg = () => Eng.CFG.pull;
const logf = (...a) => { const f = module.exports.log; if (f) f(...a); };
const M = () => C.money;
let seedWarned = false;

function clearTimers() { for (const rec of open.values()) if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; } }

// the player's two balances as the wallet push carries them (ctx.money.balance: what can be spent now; an open stake is in escrow, not in here)
const balances = (key) => ({ play: M().balance(key, 'play'), chips: M().balance(key, 'chips') });

// A stored state of the wrong shape must never lock an account out: every field is checked, a missing one gets its default, a malformed one resets
// the whole state (newState). cb.bet is any whole number of cents in [1, 2500] (DENOMS: below an average of 10c the Callback step is 1 cent); warmBet (cents of the bet the warm squares were made at) is 0 when absent, carry (cents, [0, 10)) is 0 when absent or damaged.
// cb.id (P6) is the Callback's round id, 'cb' + the id of the round that armed it; a missing or unusable id is not a damaged state, it is given a new one before the Callback may be played.
const isInt = (n) => Number.isSafeInteger(n);
const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
const validId = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
function normState(st) {
  const d = Eng.newState();
  if (!st || typeof st !== 'object' || Array.isArray(st) || st.v !== 1) return d;
  const BAD = {}, cells = Eng.N || 30, out = {};
  const get = (k, dflt, ok, fix) => { const x = st[k]; if (x === undefined || (x === null && dflt === null)) return dflt; return ok(x) ? (fix ? fix(x) : x) : BAD; };
  out.lt = get('lt', 0, (x) => isFiniteNum(x) && x >= 0);
  out.avg = get('avg', 0, (x) => isFiniteNum(x) && x >= 0);
  out.cb = get('cb', null, (x) => x && typeof x === 'object' && !Array.isArray(x) && isInt(x.bet) && x.bet >= 1 && x.bet <= 2500, (x) => { const c = { ...x }; if (!validId(c.id)) delete c.id; return c; });
  out.warm = get('warm', [], (x) => Array.isArray(x) && x.every((q) => isInt(q) && q >= 0 && q < cells), (x) => x.slice());
  out.warmBet = get('warmBet', 0, (x) => isInt(x) && x >= 0);
  out.coldAt = get('coldAt', null, isFiniteNum);
  out.day = get('day', null, (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x + 'T12:00:00Z')));
  out.streak = get('streak', 0, (x) => isInt(x) && x >= 0);
  out.rounds = get('rounds', 0, (x) => isInt(x) && x >= 0);
  out.callbacks = get('callbacks', 0, (x) => isInt(x) && x >= 0);
  out.carry = typeof st.carry === 'number' && st.carry > 0 && st.carry < 10 ? st.carry : 0;   // N1-CARRY: cents left over by the last Callback; missing or damaged reads as 0 and never resets the rest of the state
  if (Object.values(out).includes(BAD)) return d;
  return Object.assign(clone(st), out, { v: 1 });
}

// the player's STORED state as the engine should see it (a checked clone; NOT ticked: the engine ticks it itself, so it can report leaked / warmDied)
const loadState = (nk, mode) => normState(store.player(nk, mode));

// the day after a Chicago day string (noon UTC is early morning in Chicago, so +24 h never skips or repeats a day)
const dayAfter = (d) => chicagoDay(Date.parse(d + 'T12:00:00Z') + 86400000);

// How many leads the next daily claim gives. One source of truth: the claim itself. The engine plays a throwaway paid spin on a copy of the state on the
// day the claim would happen (today if unclaimed, else the next day: the streak continues) and reports what it granted; nothing is stored or charged.
const PROBE_BET = 10;   // the probe spin only reads the daily grant (the same leads at any bet): a whole-cent bet, so it needs no rounding source
function dailyNext(st, now, day, K) {
  let claimDay;
  try { claimDay = !st.day || day > st.day ? day : dayAfter(st.day); } catch (e) { return null; }   // a day the clock cannot add to: no number, never a throw
  try {                                       // the probe runs on the config the view is for (K)
    const r = K.eng.playRound(Eng.rngFrom(1), { buy: null, bet: PROBE_BET, state: { ...clone(st), cb: null }, now, day: claimDay, script: false, auto: true });
    return r.pull && r.pull.daily ? r.pull.daily.leads : null;
  } catch (e) { return null; }
}

// the config a settled round's state view is shown on: the LIVE one (the next spin runs on it), or the round's own snapshot if the live one has no pull block at all
function viewK(rec) { const K = L.snapshot(); return K.cfg.pull ? K : rec.K; }

// the player's state as the screen shows it (cold clock applied). The Callback's id is the server's business: a client view never carries it.
function stateView(state, now, day, K) {
  K = K || L.snapshot(); const P = K.cfg.pull, st = Eng.tickState(state, now, P);
  const cb = st.cb ? (({ id, ...rest }) => rest)(st.cb) : null;
  return {
    leads: Math.floor(st.lt / 10), lt: st.lt, list: P.list, cb, warm: st.warm, warmBet: st.warmBet || 0,
    cold: Eng.coldInfo(st, now, P), daily: { claimed: st.day === day, streak: st.streak, next: dailyNext(st, now, day, K) },
  };
}
// the pot is the ledger's pool account; `last` is game state
const potView = (mode) => { const p = store.peekPot(mode); return { bal: M().pool(POOL, mode), last: p ? p.last : null }; };
const potsView = () => ({ play: potView('play'), chips: potView('chips') });
// the mirror in the store (audit() reads it, no decision does) is set from the ledger after every call that can move the pool
function syncPot(mode) {
  const bal = M().pool(POOL, mode);
  let p = store.peekPot(mode);
  if (!p) { if (bal === 0) return 0; p = store.pot(mode); }       // no pot record and nothing in the pool: nothing to mirror (a game that never ran a pot leaves none)
  if (p.bal !== bal) { p.bal = bal; store.potChanged(); }
  return bal;
}

function broadcast(ev, payload) {
  const m = C && C.io && C.io.sockets && C.io.sockets.sockets;
  if (!m) return;
  for (const s of m.values()) if (s.data && s.data.acct) { try { s.emit(ev, payload); } catch {} }
}
function pushFeed(kind, rec, x, amount, bonus) {
  const ev = { id: ++feedSeq, t: C.now(), game: 'coldcall', kind, who: rec.who, x, amount, mode: rec.mode };
  if (bonus) ev.bonus = bonus;
  feed.push(ev); if (feed.length > FEED_MAX) feed.shift();
  broadcast('floor:feed', ev);
}

// every live socket of an account (plus the owner socket, if it is still signed in as that account, plus `extra`): results of a round that settles later
// go to all of them, and never to a socket that has since signed in as somebody else
function emitAcct(rec, ev, payload, extra) {
  const to = new Set();
  const m = C && C.io && C.io.sockets && C.io.sockets.sockets;
  if (m) for (const s of m.values()) if (s.data && s.data.acct && nkey(keyOf(s)) === rec.nk) to.add(s);
  if (rec.socket && rec.socket.data && rec.socket.data.acct && nkey(keyOf(rec.socket)) === rec.nk) to.add(rec.socket);
  if (extra) to.add(extra);
  for (const s of to) { try { s.emit(ev, payload); } catch {} }
}

// a recording rng over the module rng: replays the tape first, then draws (and records) fresh values.
// The round runs on the config it was spun with (rec.K: the whole snapshot and an engine built from it): a swap, a knob edit or a pull.on flip while a decision is open cannot change or void it.
function runRound(rec, decisions, auto) {
  const base = module.exports.rng || cryptoRng();
  let i = 0;
  const rng = () => { if (i < rec.tape.length) return rec.tape[i++]; const v = base(); rec.tape.push(v); i++; return v; };
  // DENOMS: the whole-cent rounding numbers come from their OWN source (module.exports.roundRng, like potRng), never from the round's stream / tape, and are recorded
  // (rec.rtape) so every replay of the round shows and pays the same cents. A 10c+ round never reads it.
  const rbase = module.exports.roundRng || cryptoRng();
  let j = 0;
  const rnd = () => { if (j < rec.rtape.length) return rec.rtape[j++]; const v = rbase(); rec.rtape.push(v); j++; return v; };
  const len = rec.tape.length, rlen = rec.rtape.length;
  try {
    return rec.K.eng.playRound(rng, { buy: rec.buy, bet: rec.bet, state: clone(rec.state), now: rec.now, day: rec.day, script: true, auto: !!auto, rnd, ...(rec.force ? { force: rec.force } : {}) }, decisions);
  } catch (e) { rec.tape.length = len; rec.rtape.length = rlen; throw e; }
}

function pendingView(rec) {
  return {
    roundId: rec.id, status: 'pending', pending: rec.pending, partial: rec.partial, mode: rec.mode, bet: rec.betCents, betCents: rec.betCents,
    cost: rec.cost, costTenths: rec.costTenths, buyBonus: rec.buy, callback: rec.callback, timeoutMs: rec.timeoutMs, expiresAt: rec.expiresAt,
    pull: { state: stateView(rec.state, rec.now, rec.day, rec.K) }, pot: null,
  };
}

// a new decision: armed to a long CEILING (the client plays the whole bonus, 15 to 50 s, before the prompt is on screen), stored per round; the first `ready`
// of the decision brings the timer down to a full timeoutMs from then. A client that never sends `ready` defaults at the ceiling (U4)
function armTimer(rec) {
  const t = rec.cfg.decision && rec.cfg.decision.timeoutMs;
  rec.timeoutMs = Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
  rec.ceilingMs = Math.max(rec.timeoutMs, CEILING_MS);
  rec.armedAt = C.now(); rec.readyDone = false;
  setTimer(rec, rec.ceilingMs);
}
function setTimer(rec, ms) {
  if (rec.timer) clearTimeout(rec.timer);
  rec.expiresAt = C.now() + ms;
  rec.timer = setTimeout(() => {
    rec.timer = null;
    try { autoSettle(rec, 'timeout'); } catch (e) { logf('coldcall: timeout settle threw', rec.id, e && e.message); try { voidRound(rec, 'timer_error'); } catch {} }   // never an uncaught throw in a timer (W1B N5)
  }, ms);
  if (rec.timer.unref) rec.timer.unref();
}

function dropOpen(rec) {
  if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
  open.delete(rec.id); if (openByKey.get(rec.nk + '|' + rec.mode) === rec) openByKey.delete(rec.nk + '|' + rec.mode);
}

// ---- the open record: everything needed to finish the round after a restart --------------------------------------------------------------------------------------------------
// roundId, key, mode, cost, bet, buy, callback flag, the clock (t / now / day), the pre-round state, the tapes (rng draws and rounding draws so far), the decisions made so far, the QA force,
// and the WHOLE config snapshot the round runs on (not only cfg.pull; non-finite numbers are stored as { $num }, see livecfg encodeCfg).
const encoded = new WeakMap();
const encodedCfg = (K) => { let e = encoded.get(K.cfg); if (!e) { e = L.encodeCfg(K.cfg); encoded.set(K.cfg, e); } return e; };
const openRecord = (rec) => ({
  v: 2, roundId: rec.id, key: rec.nk, mode: rec.mode, who: rec.who, cost: rec.cost, bet: rec.betCents, pbet: rec.bet, buy: rec.buy, callback: !!rec.callback,
  t: rec.t, now: rec.now, day: rec.day, force: rec.force || null, costTenths: rec.costTenths,
  state: clone(rec.state), tape: rec.tape.slice(), rtape: rec.rtape.slice(), decisions: clone(rec.decisions), cfg: encodedCfg(rec.K),
});
const nums = (a) => Array.isArray(a) && a.every((x) => typeof x === 'number' && Number.isFinite(x));
// stored record -> a live round object (no socket, no timer). Throws on anything that is not a record of this version.
function rebuild(o) {
  const bad = (m) => { throw new Error('open record: ' + m); };
  if (!o || typeof o !== 'object' || o.v !== 2) bad('not a P6 record');
  if (!validId(o.roundId)) bad('roundId');
  if (typeof o.key !== 'string' || !o.key || o.key !== nkey(o.key) || reserved(o.key)) bad('key');
  if (o.mode !== 'play' && o.mode !== 'chips') bad('mode');
  if (!isInt(o.cost) || o.cost < 0 || !isInt(o.bet) || o.bet < 1 || !isInt(o.pbet)) bad('amounts');
  if (!(o.buy === null || BUYS.includes(o.buy))) bad('buy');
  if (!isFiniteNum(o.now) || !isFiniteNum(o.t) || typeof o.day !== 'string') bad('clock');
  if (!nums(o.tape) || !nums(o.rtape) || !Array.isArray(o.decisions) || !o.state || typeof o.state !== 'object') bad('tapes');
  if (!(o.force === null || o.force === undefined || FORCES.includes(o.force))) bad('force');
  const K = L.restoreSnapshot(o.cfg);
  if (!K.cfg.pull) bad('config without a pull block');
  const force = o.force || null;
  return {
    id: o.roundId, key: o.key, nk: o.key, mode: o.mode, who: typeof o.who === 'string' && o.who ? o.who : o.key, socket: null, buy: o.buy, bet: o.pbet, betCents: o.bet, callback: !!o.callback,
    state: normState(o.state), now: o.now, day: o.day, t: o.t, tape: o.tape.slice(), rtape: o.rtape.slice(), decisions: clone(o.decisions), force, forced: force,
    K, cfg: K.cfg.pull, cost: o.cost, costTenths: o.costTenths, stored: true, escrow: o.cost > 0, settled: false,
  };
}

// A money call that failed for a reason the game cannot act on (not "already played"): the round is NOT settled, its record stays, the client is told (an error, never a result) and the
// round's timer is armed again so it tries once more as a timeout.
function moneyFailed(rec, e, where) {
  rec.lastError = e;
  logf('coldcall: money call failed, the round stays open', rec.id, where, e && e.code, e && e.message);
  if (rec.stored && !open.has(rec.id)) {         // a Callback that settled at once, or a record found at boot: it stays open with no prompt (pending null) and finishes as a timeout
    open.set(rec.id, rec); openByKey.set(rec.nk + '|' + rec.mode, rec);
    rec.pending = null; rec.partial = null;
    const t = rec.cfg && rec.cfg.decision && rec.cfg.decision.timeoutMs; rec.timeoutMs = Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
  }
  const payload = e && e.code === 'funds' ? { message: fundsMsg(rec.mode), code: 'funds', game: 'coldcall' } : { message: 'Server error', code: 'internal', game: 'coldcall' };
  if (open.has(rec.id)) { emitAcct(rec, 'error', payload); setTimer(rec, rec.timeoutMs || DEFAULT_TIMEOUT_MS); }
  else if (rec.socket) { try { rec.socket.emit('error', payload); } catch {} }
  return null;
}

// the ONE ledger call that closes a round (ADD-A-GAME section 3): an instant paid spin is `round`, an escrowed one `settle` with its stake, a Callback `settle` with stake 0 under its own id.
// Returns { dup } or throws; `round_closed` is thrown for "already played with other numbers".
function payOut(rec, win, pool) {
  const m = M(), o = { win, ...(pool ? { pool } : {}) };
  if (!rec.stored) return m.round(rec.key, rec.mode, rec.id, { cost: rec.cost, ...o });
  return m.settle(rec.key, rec.mode, rec.id, { ...o, stake: rec.cost });
}

// Settle a round (status done). Order: everything that can throw is computed FIRST (cents, pot slice and hit, clock, feed knobs, the state view); a throw there ends in voidRound. Then ONE
// ledger call (stake, pot feed, pot prize and win in one batch). Only after it returned: the state, the pot's statistics and the record are changed and flushed in ONE store write, then the
// result goes out. A refused ledger call never produces a result (see moneyFailed). `dup` and `round_closed` mean the round was already played: the state advances, nothing is paid.
// -> the result, or null (nothing settled: voided, refused, or the money call failed and the round stays open; look at rec.settled / rec.lastError)
function settle(rec, r, autoWhy, extraSocket) {
  if (rec.settled) return null;
  const mode = rec.mode, key = rec.key, cfg = rec.cfg, cost = rec.cost, wasOpen = open.has(rec.id);
  const betCents = r.betCents != null ? r.betCents : rec.betCents;
  const plain = cost > 0 && !rec.buy;     // RULE 1 (FIX M1): only a PLAIN paid spin feeds the pot, rolls for it or wins it. A buy and a Callback never pass a pool and never draw potRng
  let winCents, slice = null, prize = null, wonAt = 0, view, minWinX, minWinCents, pool = null;
  try {
    winCents = r.pay.win;                    // whole cents from the engine (rounded once, from the recorded rounding numbers); exact at 10c and up
    if (!isInt(winCents) || winCents < 0) throw new Error('bad win cents');
    if (cfg.pot.seed > 0 && !seedWarned) { seedWarned = true; logf('coldcall: pot.seed ignored (a pool is fed only from stakes)', cfg.pot.seed); }
    if (plain) {
      const bal0 = M().pool(POOL, mode);
      slice = Eng.potSlice(cfg.pot.feedBps, cost, store.pot(mode).rem);
      if (!isInt(slice.slice) || !isInt(slice.rem)) throw new Error('bad pot slice');
      const u = (module.exports.potRng || cryptoRng())(), bal = bal0 + slice.slice;
      if (u < Eng.potHitChance(cfg, cost) && bal >= cfg.pot.minBal && bal > 0) {
        prize = Eng.potPrize(cfg, bal);
        if (!isInt(prize) || prize < 0) throw new Error('bad pot prize');
        wonAt = C.now();
      }
      pool = { name: POOL, feed: slice.slice, prize: prize || 0 };
    }
    minWinX = cfg.feed.minWinX; minWinCents = Number.isFinite(cfg.feed.minWinCents) && cfg.feed.minWinCents >= 0 ? cfg.feed.minWinCents : FEED_MIN_CENTS;
    if (r.pull && r.pull.armed && r.newState && r.newState.cb && !r.newState.cb.id) r.newState.cb.id = 'cb' + rec.id;     // a Callback armed by this round: its round id is fixed now and travels with the state
    view = stateView(r.newState, rec.now, rec.day, viewK(rec));
  } catch (e) { logf('coldcall: settle failed, voiding', rec.id, e && e.message); return voidRound(rec, 'settle_error'); }

  // ---- the ledger, ONE call
  let dup = false, closed = false;
  try { const res = payOut(rec, winCents, pool); dup = !!(res && res.dup); }
  catch (e) {
    if (e && e.code === 'round_closed') closed = true;
    else if (e && e.code === 'stake_mismatch') { logf('coldcall: settle refused, the escrow is not the stake the round recorded: voiding', rec.id); return voidRound(rec, 'unresolvable'); }   // retrying cannot change what the escrow holds; boot (recoverOne) does the same
    else return moneyFailed(rec, e, rec.stored ? 'settle' : 'round');
  }

  // ---- state second: the record is dropped in the same store write as the state
  rec.settled = true;
  if (wasOpen) dropOpen(rec);
  let potWon = null, flushErr = null;
  try {
    if (plain) {                                   // C3: the record and the pot's numbers leave the disk in ONE write, so a record that is still here (a dup, a round_closed) means the batch the ledger already holds was never counted:
      const pot = store.pot(mode);                 // `rem` and the feed are the same for every batch of this round (same stored config, same rem), so they count on a dup AND on a round_closed;
      pot.rem = slice.rem; pot.fed += slice.slice; // a prize is known only for a batch this call wrote or an identical one (dup): on a round_closed the roll may differ from the one that paid, so `paid` / `last` are not touched
      if (prize != null && !closed) { pot.paid += prize; pot.last = { who: rec.who, amount: prize, at: wonAt }; }
      store.potChanged();
    }
    if (plain && prize != null && !closed) potWon = { won: true, amount: prize, who: rec.who };
    try { syncPot(mode); } catch (e) { logf('coldcall: pot mirror not refreshed', rec.id, e && e.message); }
    store.setPlayer(rec.nk, mode, r.newState);
    if (rec.stored) store.delOpen(rec.nk, mode);
    if (rec.stored || potWon || (r.pull && r.pull.armed)) { try { store.flush(); } catch (e) { flushErr = e; } }
  } catch (e) { logf('coldcall: settle bookkeeping failed', rec.id, e && e.message); }
  if (flushErr) logf('coldcall: store flush failed after the ledger call (the ledger is the truth; recover() replays the stored record)', rec.id, flushErr && flushErr.message);

  if (closed) {                                    // paid before, with other numbers: the state advanced, nothing was paid now, no result is shown for numbers we cannot vouch for
    logf('coldcall: round was already played, state advanced, nothing paid', rec.id);
    try { syncPot(mode); } catch {}
    if (wasOpen) emitAcct(rec, 'error', { message: 'That round was already settled', code: 'round_closed', game: 'coldcall' }, extraSocket);
    else if (rec.socket) { try { rec.socket.emit('error', { message: 'That round was already settled', code: 'round_closed', game: 'coldcall' }); } catch {} }
    return null;
  }

  let w;
  try { w = balances(key); } catch (e) { w = null; logf('coldcall: balance read failed', rec.id, e && e.message); }
  const callback = r.callback != null ? !!r.callback : !!rec.callback;
  const auto = autoWhy || null;
  const h = history.get(rec.nk) || [];
  h.unshift({ roundId: rec.id, t: rec.t, bet: betCents, cost, mode, buy: rec.buy, totalWin: winCents, tier: r.tier, callback, auto, pot: potWon });
  if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
  history.set(rec.nk, h);

  const result = {
    roundId: rec.id, status: 'done', pending: null, resolved: wasOpen, auto, bet: betCents, betCents, cost, mode, buyBonus: rec.buy, callback,
    script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, totalWin: winCents, tier: r.tier, maxed: r.capped, pay: r.pay,
    wallet: w, balances: w,
    pull: { ...(r.pull || {}), state: view }, pot: potWon,
    ...(rec.forced ? { forced: rec.forced } : {}),
  };
  if (wasOpen) emitAcct(rec, 'g:coldcall:result', result, extraSocket);   // a defaulted / decided round: every tab of the account hears it
  else if (rec.socket) { try { rec.socket.emit('g:coldcall:result', result); } catch {} }

  // feed + floor (never lets a throw escape after the money has moved)
  try {
    const bonusKind = r.script && r.script.bonus && r.script.bonus.kind;
    if (bonusKind) pushFeed('bonus', rec, r.winX, winCents, bonusKind);
    if (r.winX >= minWinX && winCents >= minWinCents) pushFeed('win', rec, r.winX, winCents, bonusKind || undefined);      // BOTH: x of the bet and money (a 100x win at 1c is one dollar: no room event)
    if (r.pull && r.pull.armed) pushFeed('callback', rec, 0, 0);
    if (potWon) pushFeed('pot', rec, potWon.amount / betCents, potWon.amount);
    if (plain && (slice.slice > 0 || potWon)) broadcast('floor:pot', { mode, bal: store.pot(mode).bal });
  } catch (e) { logf('coldcall: feed failed', rec.id, e && e.message); }
  return result;
}

// Void a round (a round the engine could not default or settle, a failed open): the escrow goes back to the player in ONE call, then the record is dropped and flushed, then the client hears it.
// A Callback has no escrow: voiding it only drops the record and leaves the entitlement armed. -> 'voided' | null (the ledger refused: the round stays open, see moneyFailed)
function voidRound(rec, why) {
  if (rec.settled) return null;
  let refund = 0;                                  // what the ledger really returned: the escrow of an open paid round; 0 for an instant round that never reached the ledger, a Callback, a round already closed
  if (rec.stored || rec.escrow) {
    let before = null;
    try { before = M().balance(rec.key, rec.mode); } catch {}
    try { M().void(rec.key, rec.mode, rec.id, why); }
    catch (e) { if (!(e && e.code === 'round_closed')) return moneyFailed(rec, e, 'void'); }     // round_closed: it was played already, nothing to give back
    try { if (before != null) refund = Math.max(0, M().balance(rec.key, rec.mode) - before); } catch {}   // the player's own balance, read either side of the one synchronous void
  }
  rec.settled = true;
  dropOpen(rec);
  if (rec.stored) { try { store.delOpen(rec.nk, rec.mode); store.flush(); } catch (e) { logf('coldcall: record drop not flushed', rec.id, e && e.message); } }
  let w = null;
  try { w = balances(rec.key); } catch {}
  logf('coldcall: voided round', rec.id, why, 'refund', refund, rec.mode);
  emitAcct(rec, 'g:coldcall:voided', { roundId: rec.id, mode: rec.mode, refund, reason: why, wallet: w });
  return 'voided';
}

// take the safe default for every remaining decision of an open round and settle it
function autoSettle(rec, why) {
  if (rec.settled || !open.has(rec.id)) return;
  let r = null;
  try { r = runRound(rec, rec.decisions, true); } catch (e) { r = null; }
  if (!r || r.status !== 'done') return voidRound(rec, 'unresolvable');
  settle(rec, r, why);
}

// ---- boot: recover(rounds, ctx) (decision D1) --------------------------------------------------------------------------------------------------------------------------------
// Synchronous, called by the games registry before the server listens. `rounds` = this game's non-zero escrows read from the ledger. Every stored open record is rebuilt and replayed with the
// decisions made so far and the safe default for the rest, exactly as its timeout would (autoSettle), then settled in ONE ledger call, then state + record dropped + flushed. A round the ledger
// already closed answers dup / round_closed: the state advances, nothing is paid. A record that cannot be rebuilt or replayed is voided (a paid round gets its stake back; a Callback stays armed).
// A record with a stake whose escrow is gone and whose round is not closed is stale: dropped, nothing paid. Escrows with no record are left to the registry (it voids them).
function recoverOne(o, escrows) {
  let rec;
  try { rec = rebuild(o); } catch (e) {
    logf('coldcall: recover: record cannot be rebuilt, voiding it', o && o.roundId, e && e.message);
    const k = o && typeof o.key === 'string' ? o.key : '', mode = o && o.mode;
    if (!k || (mode !== 'play' && mode !== 'chips')) { try { store.delOpen(k, mode); store.flush(); } catch {} return; }
    const mini = { id: String(o.roundId), key: k, nk: k, mode, who: k, socket: null, cost: isInt(o.cost) ? o.cost : 0, stored: true, escrow: isInt(o.cost) && o.cost > 0, settled: false };
    return voidRound(mini, 'unresolvable');
  }
  if (rec.cost > 0 && !escrows.has(`${rec.nk}|${rec.mode}|${rec.id}`)) {
    let played = false;
    try { played = M().closed(rec.nk, rec.id); } catch (e) { logf('coldcall: recover: cannot tell whether the round was played, leaving the record', rec.id, e && e.message); return; }
    if (!played) { try { store.delOpen(rec.nk, rec.mode); store.flush(); } catch {} logf('coldcall: recover: stale record (no escrow, round not closed), dropped', rec.id); return; }
    // C1: closed is not the same as played. A round the ledger closed by a VOID (the stake went back) gives nothing at boot: no replay, so no state advance and no Callback armed from a round that was refunded.
    // The ledger tells the kind of its close only through the void call: a stored void answers dup, a stored settle round_closed. No escrow is held here, so the call writes nothing.
    let voided = false;
    try { const v = M().void(rec.nk, rec.mode, rec.id, 'recover'); voided = !!(v && v.dup) || !!(v && v.id != null); } catch (e) { if (!(e && e.code === 'round_closed')) { logf('coldcall: recover: cannot tell how the round was closed, leaving the record', rec.id, e && e.message); return; } }
    if (voided) { try { store.delOpen(rec.nk, rec.mode); store.flush(); } catch (e) { logf('coldcall: recover: record of a voided round not dropped', rec.id, e && e.message); } logf('coldcall: recover: the ledger closed this round by a void, record dropped, nothing replayed', rec.id); return; }
  }
  let r = null;
  try { r = runRound(rec, rec.decisions, true); if (r.status !== 'done' || r.pay.price !== rec.cost || !!r.callback !== rec.callback) r = null; } catch (e) { r = null; }
  if (!r) return voidRound(rec, 'unresolvable');
  settle(rec, r, 'restart');
  if (!rec.settled && rec.lastError && rec.lastError.code === 'stake_mismatch') return voidRound(rec, 'unresolvable');
  // anything else the ledger refused: moneyFailed kept the record and the round (no prompt) and armed its timer, it tries again as a timeout
}
function recover(rounds) {
  if (!store) return;
  const escrows = new Set((rounds || []).map((r) => `${nkey(r.key)}|${r.cur}|${r.roundId}`));
  for (const o of store.allOpen().slice()) { try { recoverOne(o, escrows); } catch (e) { logf('coldcall: recover threw on a record', o && o.roundId, e && e.message); } }
  for (const mode of ['play', 'chips']) {
    try {
      const bal = M().pool(POOL, mode), p = store.peekPot(mode) || (bal ? store.pot(mode) : null);
      if (p && p.bal !== bal) { logf('coldcall: pot mirror differs from the ledger (' + mode + '): store', p.bal, 'ledger', bal); p.bal = bal; store.potChanged(); }
    } catch (e) { logf('coldcall: pot mirror not set', mode, e && e.message); }
  }
  try { store.flush(); } catch (e) { logf('coldcall: store flush failed after recover', e && e.message); }
}
// from the slot's OWN state: every open record with a stake, and the pot mirrors. The soak compares it with the ledger.
function audit() {
  const openRounds = [];
  if (store) for (const o of store.allOpen()) if (o && isInt(o.cost) && o.cost > 0) openRounds.push({ key: o.key, cur: o.mode, roundId: o.roundId, amount: o.cost });
  const pot = (m) => { const p = store && store.peekPot(m); return p ? p.bal : 0; };
  return { openRounds, pools: { [POOL]: { chips: pot('chips'), play: pot('play') } } };
}

// a Callback that has no id yet (a state file from before P6) is given one and flushed BEFORE it may be played: the id is the ledger's key for "this free round was paid"
function ensureCbId(nk, mode, state) {
  if (!state.cb || state.cb.id) return;
  state.cb.id = 'cb' + crypto.randomBytes(6).toString('hex');
  store.setPlayer(nk, mode, state); store.flush();
}

function pullSpin(socket, p, buy, now) {
  const key = keyOf(socket), nk = nkey(key), mode = p.mode;
  const ok = nk + '|' + mode;
  const o = openByKey.get(ok);
  if (o) return err(socket, 'decision_open', 'Finish your open decision first', { open: o.pending ? pendingView(o) : null });
  const day = chicagoDay(now);
  const state = loadState(nk, mode);
  const force = testHookOn() && buy === null && FORCES.includes(p.force) ? p.force : null;
  const callback = buy === null && !force && !!state.cb;       // a QA-forced round is a stateless paid spin: the waiting Callback is not played
  if (callback) { try { ensureCbId(nk, mode, state); } catch (e) { logf('coldcall: callback id not flushed', e && e.message); return err(socket, 'bad_request', 'Could not place that bet'); } }
  const rec = {
    id: callback ? state.cb.id : crypto.randomBytes(6).toString('hex'), key, nk, mode, who: whoOf(socket), socket, buy, bet: p.bet,
    betCents: callback ? state.cb.bet : p.bet, callback, state, now, day, t: now, tape: [], rtape: [], decisions: [], force, forced: force, stored: false, escrow: false, settled: false,
  };
  try {
    rec.K = L.snapshot();                  // the whole config this round is played, defaulted and settled on (Infinity preserved), and an engine built from it
    rec.cfg = rec.K.cfg.pull;              // its PULL knobs (pot, feed, decision timer: read at settle and by armTimer)
  } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
  const auto = p.auto === true;
  let r, cost;
  try {
    r = runRound(rec, [], auto);
    if (r.betCents != null) rec.betCents = r.betCents;
    rec.costTenths = r.costTenths;
    cost = r.pay.price;                     // whole cents, fixed by the engine before anything is paid (a buy at 1c / 2c / 5c: the exact price rounded to the nearest cent, at least 1c); 0 on a Callback
    if (!isInt(cost) || cost < 0) throw new Error('bad cost');
  } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
  rec.cost = cost;

  if (callback) {                           // a free round: no escrow. The record (with the whole tape of what was rolled) is on disk BEFORE anything else happens: a crash replays THAT tape, never a new roll (RULE 2)
    rec.stored = true;
    try { store.putOpen(openRecord(rec)); store.flush(); }
    catch (e) { logf('coldcall: callback record not flushed, nothing played', rec.id, e && e.message); try { store.delOpen(nk, mode); } catch {} return err(socket, 'bad_request', 'Could not place that bet'); }
  } else {
    try { if (cost > 0 && M().balance(key, mode) < cost) return err(socket, 'funds', fundsMsg(mode)); } catch (e) { return walletErr(socket, e, mode); }
  }

  if (r.status === 'pending') {
    if (!callback) { try { M().open(key, mode, rec.id, cost); } catch (e) { return walletErr(socket, e, mode); } rec.escrow = true; }
    // the stake is in escrow (or the Callback record is on disk): anything that throws from here on is voided, never an open round without a timer (W1B N4)
    try {
      rec.pending = r.pending; rec.partial = r.partial; rec.stored = true;
      open.set(rec.id, rec); openByKey.set(ok, rec);
      if (!callback) { store.putOpen(openRecord(rec)); store.flush(); }
      armTimer(rec);
      socket.emit('g:coldcall:result', pendingView(rec));
    } catch (e) { logf('coldcall: pending path failed, voiding', rec.id, e && e.message); voidRound(rec, 'open_error'); if (!rec.settled) err(socket, 'bad_request', 'Could not place that bet'); }
    return;
  }
  const autoHit = auto && r.pull && ((r.pull.pick && r.pull.pick.auto) || (r.pull.more && r.pull.more.auto));
  settle(rec, r, autoHit ? 'autoplay' : null);
}

module.exports = {
  id: 'coldcall',
  name: 'Cold Call',
  kind: 'solo',
  betLevels: BET_LEVELS,
  RTP_LABEL,
  // LIVECFG (PULL-ENGINE.md section 8): the admin block in server.js calls these; the shipped label comes with the code, the live one with the config
  setLiveConfig: (arg) => { L.setLiveConfig(arg); return L.liveInfo(RTP_LABEL); }, loadLiveConfig: (log) => L.loadLiveConfig(log), liveInfo: () => L.liveInfo(RTP_LABEL),
  clientCfg: () => L.clientCfg(RTP_LABEL), cfgEvent: () => L.clientCfg(RTP_LABEL),
  // init loads the config and the store and moves NO money (boot settles / voids open rounds in recover()). ctx.files (from server.js) says where the game's files live.
  init(ctx) {
    this.rng = ctx.rng || cryptoRng();
    const files = ctx.files || {};
    L.setFile(files.coldcallConfig);
    L.loadLiveConfig();                                   // the saved live config (coldcall-config.json), if any; a damaged file is logged once and the defaults stay
    clearTimers(); open.clear(); openByKey.clear(); rateLast.clear(); readyLast.clear();
    if (store) store.close();
    C = ctx; feed = []; feedSeq = 0; seedWarned = false;
    const file = process.env.COLDCALL_PULL_FILE || files.coldcallPull || null;
    store = createStore(file, { log: logf });
    for (const mode of ['play', 'chips']) { try { syncPot(mode); } catch {} }
  },
  recover, audit,
  onDisconnect(socket) {
    for (const rec of [...open.values()]) if (rec.socket === socket) { try { autoSettle(rec, 'disconnect'); } catch {} }
  },
  handlers: {
    state(socket, payload, ctx) {
      const w = balances(keyOf(socket));
      const extra = {};
      const K = L.snapshot();
      if (pullOn() && store) {
        const now = ctx.now(), day = chicagoDay(now), nk = nkey(keyOf(socket));
        const opens = ['play', 'chips'].map((m) => openByKey.get(nk + '|' + m)).filter((x) => x && x.pending).map(pendingView);
        extra.pull = { on: true, rules: clone(pullCfg()), list: pullCfg().list, decisionMs: pullCfg().decision.timeoutMs, play: stateView(loadState(nk, 'play'), now, day, K), chips: stateView(loadState(nk, 'chips'), now, day, K) };
        extra.pot = potsView(); extra.feed = feed.slice(-FEED_STATE); extra.open = opens[0] || null; extra.opens = opens;
      }
      socket.emit('g:coldcall:state', {
        engine: 2, grid: { cols: Eng.COLS, rows: Eng.ROWS },
        betLevels: BET_LEVELS, modes: ['play', 'chips'], rtp: rtpLabel(), maxWinX: Eng.CFG.maxWinTenths / 10,
        buyCostX: Object.fromEntries(BUYS.map((b) => [b, Eng.CFG.buyCost[b] / 10])),
        buyPriceCents: L.buyPrices(), cfg: L.publicCfg(),     // LIVECFG: the live pay table, weights and prices (PULL-UI.md 0c); pull.rules above carries the PULL knobs
        wallet: w, balances: w, bets: BET_LEVELS,
        ...(testHookOn() ? { qaHook: true } : {}),
        ...extra,
      });
    },
    history(socket) {
      socket.emit('g:coldcall:history', { rounds: history.get(nkey(keyOf(socket))) || [] });
    },
    floor(socket) {
      if (!store) return;
      socket.emit('g:coldcall:floor', { pot: potsView(), feed: feed.slice(-FEED_STATE) });
    },
    decide(socket, payload) {
      const p = payload && typeof payload === 'object' ? payload : {};
      const rec = open.get(String(p.roundId));
      if (!rec || !rec.pending) return err(socket, 'no_round', 'No open decision');
      if (rec.nk !== nkey(keyOf(socket))) return err(socket, 'forbidden', 'Not your round');
      const pend = rec.pending;
      if (p.k !== pend.k) return err(socket, 'bad_request', 'Wrong decision');
      let d;
      if (pend.k === 'pick') {
        if (!Number.isSafeInteger(p.p) || !pend.choices.includes(p.p)) return err(socket, 'bad_request', 'Pick one of the marked squares');
        d = { k: 'pick', p: p.p };
      } else {
        if (typeof p.take !== 'boolean') return err(socket, 'bad_request', 'Take it or bank it');
        d = { k: 'more', take: p.take };
      }
      const decisions = rec.decisions.concat([d]);
      const tl = rec.tape.length, rl = rec.rtape.length;
      let r;
      try { r = runRound(rec, decisions, false); } catch (e) { return err(socket, 'bad_request', 'Invalid decision'); }
      // The player's answer is in the stored record, flushed, BEFORE anything that follows it (the next prompt, the money call, the result): a restart replays what the player chose, never the
      // default for a decision already answered (C2: a Callback whose taken gamble pays 0 writes no ledger line, so only the record can tell boot the gamble was taken). A failed flush undoes the answer.
      const prev = { decisions: rec.decisions, pending: rec.pending, partial: rec.partial };
      rec.decisions = decisions;
      if (r.status === 'pending') { rec.pending = r.pending; rec.partial = r.partial; }
      try { store.putOpen(openRecord(rec)); store.flush(); }
      catch (e) {
        logf('coldcall: open record update not flushed, decision refused', rec.id, e && e.message);
        rec.decisions = prev.decisions; rec.pending = prev.pending; rec.partial = prev.partial; rec.tape.length = tl; rec.rtape.length = rl;
        try { store.putOpen(openRecord(rec)); } catch {}
        return err(socket, 'internal', 'Server error');
      }
      if (r.status === 'pending') {
        armTimer(rec);
        const v = pendingView(rec);
        for (const s of new Set([rec.socket, socket])) if (s) { try { s.emit('g:coldcall:result', v); } catch {} }
        return;
      }
      settle(rec, r, null, socket);
    },
    // The prompt is on screen: the open decision gets a full timeoutMs from now, ONCE per decision (the ONE MORE CALL event carries the whole bonus,
    // whose animation runs longer than timeoutMs, so the timer was armed to the ceiling). Never past armedAt + ceiling. Answers every socket of the account.
    ready(socket, payload, ctx) {
      const t = ctx.now(), rk = nkey(keyOf(socket)), prev = readyLast.get(rk);
      if (prev != null && t >= prev && t - prev < RATE_MS) return err(socket, 'rate', 'Slow down');
      readyLast.set(rk, t);
      const p = payload && typeof payload === 'object' ? payload : {};
      if (typeof p.roundId !== 'string') return err(socket, 'no_round', 'No open decision');
      const rec = open.get(p.roundId);
      if (!rec || !rec.pending) return err(socket, 'no_round', 'No open decision');
      if (rec.nk !== rk) return err(socket, 'forbidden', 'Not your round');
      if (!rec.readyDone) {
        const room = rec.armedAt + rec.ceilingMs - t;           // what is left of the ceiling this decision may ever be held
        if (room <= 0) return;                                  // too late: the running timer decides
        rec.readyDone = true;
        setTimer(rec, Math.min(rec.timeoutMs, room));
      }
      emitAcct(rec, 'g:coldcall:timer', { roundId: rec.id, timeoutMs: rec.timeoutMs, expiresAt: rec.expiresAt }, socket);
    },
    spin(socket, payload, ctx) {
      const t = ctx.now();
      const rk = nkey(keyOf(socket)), prev = rateLast.get(rk);
      if (prev != null && t >= prev && t - prev < RATE_MS) return err(socket, 'rate', 'Slow down');   // t < prev = the clock stepped back: allowed
      rateLast.set(rk, t);
      const p = payload && typeof payload === 'object' ? payload : {};
      if (!Number.isSafeInteger(p.bet) || !BET_LEVELS.includes(p.bet)) return err(socket, 'bad_bet', 'Pick a listed bet');
      if (p.mode !== 'play' && p.mode !== 'chips') return err(socket, 'bad_mode', 'Pick Play $ or Chips');
      const buy = p.buyBonus == null || p.buyBonus === false ? null : p.buyBonus;
      if (buy !== null && !BUYS.includes(buy)) return err(socket, 'bad_request', 'Bad bonus');
      if (pullOn() && store) return pullSpin(socket, p, buy, t);

      // the old stateless game (pull.on false): one instant round, ONE ledger call
      const key = keyOf(socket);
      const rng = module.exports.rng || cryptoRng();
      const roundId = crypto.randomBytes(6).toString('hex');
      const force = testHookOn() && buy === null && FORCES.includes(p.force) ? p.force : null;
      const K = L.snapshot();                     // the live config, whole (a stateless round; nothing is open)
      const r = force ? resolveForced(K, rng, force) : L.resolveRound(K, rng, buy);   // pure; nothing touched yet
      let cost, totalWin, pay;
      try { pay = Eng.payRound(r.round, p.bet, module.exports.roundRng || cryptoRng(), K.cfg.maxWinTenths); cost = pay.price; totalWin = pay.win; } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
      let w;
      try { M().round(key, p.mode, roundId, { cost, win: totalWin }); } catch (e) { return walletErr(socket, e, p.mode); }
      try { w = balances(key); } catch (e) { w = null; }

      const hk = nkey(key), h = history.get(hk) || [];
      h.unshift({ roundId, t, bet: p.bet, cost, mode: p.mode, buy, totalWin, tier: r.tier });
      if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
      history.set(hk, h);

      socket.emit('g:coldcall:result', {
        roundId, bet: p.bet, cost, mode: p.mode, buyBonus: buy,
        script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, totalWin, tier: r.tier, maxed: r.capped, pay,
        wallet: w, balances: w,
        ...(force ? { forced: force } : {}),
      });
    },
  },
  _history: history,
  _pull: { open, get store() { return store; } },
};

// reserved names never reach the ledger, the store or the history (default-on-logout needs server.js and is not done here)
for (const [ev, fn] of Object.entries(module.exports.handlers)) {
  module.exports.handlers[ev] = function (socket, ...rest) {
    if (reserved(keyOf(socket))) return err(socket, 'bad_request', 'That account name cannot play here');
    return fn.call(this, socket, ...rest);
  };
}
