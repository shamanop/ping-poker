'use strict';
// COLD CALL: server-authoritative slot. Math lives in coldcall-engine.js (same file the client copy uses, for animation only).
const crypto = require('crypto');
const path = require('path');
const Eng = require('./coldcall-engine.js');
const { createStore } = require('./coldcall-store.js');

const BET_LEVELS = Eng.BET_LEVELS;
const BUYS = Eng.BUYS;   // call, bonus1, bonus2, hunt (prices in Eng.CFG.buyCost, tenths of the bet)
const RATE_MS = 150;
const HISTORY_MAX = 20;
const RTP_LABEL = '97.93% (long-run, 450M-spin stratified sim, +-0.11)';

// QA hook: forces a feature so the front end can be driven by a test. It runs ONLY when the server process was started
// with COLDCALL_TEST=1 (and NODE_ENV is not 'production'); otherwise `force` in a spin payload is ignored. Forced rounds are paid and
// charged through the normal wallet path, with real engine rounds (bells placed, or whole rounds re-rolled until the condition holds; no hand-made scripts).
//   bonus1 / bonus2 / bonus3 = 3 / 4 / 5 bells land; phone = phone feature with >= 4 hot leads; close = phone feature with a close and a second reveal round;
//   big = round pays >= 25x; tease = exactly 2 bells, no bonus.
const FORCES = Eng.FORCES;
const testHookOn = () => process.env.COLDCALL_TEST === '1' && process.env.NODE_ENV !== 'production';
const resolveForced = (rng, force) => Eng.resolveRound(rng, null, { force });

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || ''); };
const nkey = (k) => String(k).toLowerCase().trim();   // same normalisation as wallet.js
const whoOf = (socket) => { const a = socket.data && socket.data.acct; return String((a && typeof a === 'object' ? (a.display || a.key) : a) || ''); };
const clone = (o) => JSON.parse(JSON.stringify(o));
// knob snapshots keep every value as it is: Infinity ("never" / "no cap") must stay Infinity, JSON would turn it into null, which every knob reads as 0 / "always" (W1B N3)
const snap = (o) => structuredClone(o);
// knobs outside CFG.pull that a replay reads live: frozen into the record beside CFG.pull, so an edit while a decision is open cannot change the bonus the player was shown (W1B N6)
const SNAP_KNOBS = ['spins', 'retrigger', 'maxSpins', 'maxRevealRounds', 'maxCascades', 'buyCost'];
const DEFAULT_TIMEOUT_MS = 20000;   // armTimer's fallback when decision.timeoutMs is missing or not a finite positive number (W1B N4)
// names that would address Object.prototype if they ever became a plain-object key (wallet.js still keys a plain object)
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const reserved = (k) => RESERVED.has(nkey(k));
const rateLast = new Map(); // account key (normalised) -> time of its last accepted spin: the 150 ms limit is per account, not per socket
const readyLast = new Map(); // the same limit for `ready`, kept apart so a spin does not block the ready that follows it

function err(socket, code, message, extra) { socket.emit('error', { message, code, game: 'coldcall', ...(extra || {}) }); }

function walletErr(socket, e) {
  if (e && e.code === 'funds') return err(socket, 'funds', e.message);
  return err(socket, 'bad_request', 'Could not place that bet');
}

// ---------------------------------------------------------------------------------------------------------------- THE PULL
// Player state, the pot, decisions, feed. See cold-call/PULL-ENGINE.md section 4. Everything that moves money in one spin or one settlement
// runs in one synchronous block (no await), so concurrent callers cannot interleave.
const pullOn = () => { const c = Eng.CFG.pull; return !!(c && c.on !== false); };
let C = null;                 // the games ctx from init (io, wallet, now)
let store = null;
const open = new Map();       // roundId -> open record (memory: tape, state snapshot, timer, owning socket)
const openByKey = new Map();  // "<nkey>|<mode>" -> open record
let feed = [], feedSeq = 0;   // ring buffer (50), memory only
const FEED_MAX = 50, FEED_STATE = 20;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' });
const chicagoDay = (ms) => dayFmt.format(new Date(ms));
const pullCfg = () => Eng.CFG.pull;
const logf = (...a) => { const f = module.exports.log; if (f) f(...a); };

function clearTimers() { for (const rec of open.values()) if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; } }

// A stored state of the wrong shape must never lock an account out: every field is checked, a missing one gets its default, a malformed one resets
// the whole state (newState). cb.bet is any multiple of 10 in [10, 2500]; warmBet (cents of the bet the warm squares were made at) is 0 when absent.
const isInt = (n) => Number.isSafeInteger(n);
const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
function normState(st) {
  const d = Eng.newState();
  if (!st || typeof st !== 'object' || Array.isArray(st) || st.v !== 1) return d;
  const BAD = {}, cells = Eng.N || 30, out = {};
  const get = (k, dflt, ok, fix) => { const x = st[k]; if (x === undefined || (x === null && dflt === null)) return dflt; return ok(x) ? (fix ? fix(x) : x) : BAD; };
  out.lt = get('lt', 0, (x) => isFiniteNum(x) && x >= 0);
  out.avg = get('avg', 0, (x) => isFiniteNum(x) && x >= 0);
  out.cb = get('cb', null, (x) => x && typeof x === 'object' && !Array.isArray(x) && isInt(x.bet) && x.bet % 10 === 0 && x.bet >= 10 && x.bet <= 2500, (x) => ({ ...x }));
  out.warm = get('warm', [], (x) => Array.isArray(x) && x.every((q) => isInt(q) && q >= 0 && q < cells), (x) => x.slice());
  out.warmBet = get('warmBet', 0, (x) => isInt(x) && x >= 0);
  out.coldAt = get('coldAt', null, isFiniteNum);
  out.day = get('day', null, (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && Number.isFinite(Date.parse(x + 'T12:00:00Z')));
  out.streak = get('streak', 0, (x) => isInt(x) && x >= 0);
  out.rounds = get('rounds', 0, (x) => isInt(x) && x >= 0);
  out.callbacks = get('callbacks', 0, (x) => isInt(x) && x >= 0);
  if (Object.values(out).includes(BAD)) return d;
  return Object.assign(clone(st), out, { v: 1 });
}

// the player's STORED state as the engine should see it (a checked clone; NOT ticked: the engine ticks it itself, so it can report leaked / warmDied)
const loadState = (nk, mode) => normState(store.player(nk, mode));

// the day after a Chicago day string (noon UTC is early morning in Chicago, so +24 h never skips or repeats a day)
const dayAfter = (d) => chicagoDay(Date.parse(d + 'T12:00:00Z') + 86400000);

// How many leads the next daily claim gives. One source of truth: the claim itself. The engine plays a throwaway paid spin on a copy of the state on the
// day the claim would happen (today if unclaimed, else the next day: the streak continues) and reports what it granted; nothing is stored or charged.
function dailyNext(st, now, day, P) {
  const live = Eng.CFG.pull;
  let claimDay;
  try { claimDay = !st.day || day > st.day ? day : dayAfter(st.day); } catch (e) { return null; }   // a day the clock cannot add to: no number, never a throw
  Eng.CFG.pull = P;                          // synchronous: the probe runs under the knobs the view is for
  try {
    const r = Eng.playRound(Eng.rngFrom(1), { buy: null, bet: BET_LEVELS[0], state: { ...clone(st), cb: null }, now, day: claimDay, script: false, auto: true });
    return r.pull && r.pull.daily ? r.pull.daily.leads : null;
  } catch (e) { return null; } finally { Eng.CFG.pull = live; }
}

// the player's state as the screen shows it (cold clock applied)
function stateView(state, now, day, cfg) {
  const P = cfg || pullCfg(), st = Eng.tickState(state, now, P);
  return {
    leads: Math.floor(st.lt / 10), lt: st.lt, list: P.list, cb: st.cb, warm: st.warm, warmBet: st.warmBet || 0,
    cold: Eng.coldInfo(st, now, P), daily: { claimed: st.day === day, streak: st.streak, next: dailyNext(st, now, day, P) },
  };
}
const potView = (mode) => { const p = store.pot(mode, pullCfg().pot.seed); return { bal: p.bal, last: p.last }; };
const potsView = () => ({ play: potView('play'), chips: potView('chips') });

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
// The round runs under the knobs it was spun with (rec.cfg): a knob edit or a pull.on flip while a decision is open cannot change or void it.
function runRound(rec, decisions, auto) {
  const base = module.exports.rng || cryptoRng();
  let i = 0;
  const rng = () => { if (i < rec.tape.length) return rec.tape[i++]; const v = base(); rec.tape.push(v); i++; return v; };
  const len = rec.tape.length, live = Eng.CFG.pull, liveX = {};
  Eng.CFG.pull = rec.cfg;                    // synchronous: nothing else runs while the snapshot is in place
  for (const k of SNAP_KNOBS) { liveX[k] = Object.prototype.hasOwnProperty.call(Eng.CFG, k) ? { v: Eng.CFG[k] } : null; if (rec.cfgx && k in rec.cfgx) Eng.CFG[k] = rec.cfgx[k]; }
  try {
    return Eng.playRound(rng, { buy: rec.buy, bet: rec.bet, state: clone(rec.state), now: rec.now, day: rec.day, script: true, auto: !!auto, ...(rec.force ? { force: rec.force } : {}) }, decisions);
  } catch (e) { rec.tape.length = len; throw e; } finally {
    Eng.CFG.pull = live;
    for (const k of SNAP_KNOBS) { if (liveX[k]) Eng.CFG[k] = liveX[k].v; else delete Eng.CFG[k]; }
  }
}

function pendingView(rec) {
  return {
    roundId: rec.id, status: 'pending', pending: rec.pending, partial: rec.partial, mode: rec.mode, bet: rec.betCents, betCents: rec.betCents,
    cost: rec.cost, costTenths: rec.costTenths, buyBonus: rec.buy, callback: rec.callback, timeoutMs: rec.timeoutMs, expiresAt: rec.expiresAt,
    pull: { state: stateView(rec.state, rec.now, rec.day, rec.cfg) }, pot: null,
  };
}

// a new decision: a full timeoutMs, and its one re-arm (`ready`) is available again
function armTimer(rec) {
  const t = rec.cfg.decision && rec.cfg.decision.timeoutMs;
  rec.timeoutMs = Number.isFinite(t) && t > 0 ? t : DEFAULT_TIMEOUT_MS;
  rec.armedAt = C.now(); rec.readyDone = false;
  setTimer(rec, rec.timeoutMs);
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
  open.delete(rec.id); openByKey.delete(rec.nk + '|' + rec.mode);
}

// Settle a round (status done). Everything that can throw (cents, pot slice and hit, seed, clock, feed knobs, the state view) is computed FIRST; a throw
// there ends in voidRound (the cost refunded once). Then one synchronous block: record dropped, pot, state, wallet credits. A round that was open is
// flushed in the order store (record gone) then wallet (win credited), so a crash can lose a win but never pay a round twice. A pot prize is flushed to the
// pot file BEFORE it is credited, so the file never still holds a prize that sits on the wallet.
function settle(rec, r, autoWhy, extraSocket) {
  if (rec.settled) return null;
  const mode = rec.mode, key = rec.key, cfg = rec.cfg, cost = rec.cost, wasOpen = open.has(rec.id);
  const betCents = r.betCents != null ? r.betCents : rec.betCents;
  const ref = { game: 'coldcall', round: rec.id };
  let winCents, pot, slice = null, prize = null, seed = 0, wonAt = 0, view, minWinX;
  try {
    winCents = Eng.cents(r.winTenths, betCents);
    pot = store.pot(mode, cfg.pot.seed);
    seed = cfg.pot.seed > 0 ? cfg.pot.seed : 0;
    if (cost > 0) {                 // pot: slice of every paid spin, one hit roll, award (never on a Callback)
      slice = Eng.potSlice(cfg.pot.feedBps, cost, pot.rem);
      if (!isInt(slice.slice) || !isInt(slice.rem)) throw new Error('bad pot slice');
      const u = (module.exports.potRng || cryptoRng())(), bal = pot.bal + slice.slice;
      if (u < Eng.potHitChance(cfg, cost) && bal >= cfg.pot.minBal && bal > 0) {
        prize = Math.min(bal, cfg.pot.maxPayX * betCents);
        if (!isInt(prize) || prize < 0) throw new Error('bad pot prize');
        wonAt = C.now();
      }
    }
    minWinX = cfg.feed.minWinX;
    view = stateView(r.newState, rec.now, rec.day, cfg);
  } catch (e) { logf('coldcall: settle failed, voiding', rec.id, e && e.message); return voidRound(rec, 'settle_error'); }

  rec.settled = true;
  if (wasOpen) { dropOpen(rec); store.delOpen(rec.nk, mode); }
  let potWon = null, potMoved = false;
  try {                             // the record is already gone: nothing in this block may stop the credit below (W1B N5)
  if (slice) {
    pot.rem = slice.rem; pot.bal += slice.slice; pot.fed += slice.slice; potMoved = slice.slice > 0;
    if (prize != null) {
      pot.paid += prize; pot.bal -= prize;
      if (seed > 0) { pot.bal += seed; pot.seeded += seed; }
      pot.last = { who: rec.who, amount: prize, at: wonAt };
      potWon = { won: true, amount: prize, who: rec.who }; potMoved = true;
    }
    store.potChanged();
  }
  store.setPlayer(rec.nk, mode, r.newState);
  if (wasOpen || potWon) store.flush();
  } catch (e) { logf('coldcall: settle bookkeeping failed', rec.id, e && e.message); }

  let w;
  try { w = C.wallet.credit(key, mode, winCents, ref); } catch (e) { logf('coldcall: win credit failed', rec.id, e && e.message); w = C.wallet.get(key); }
  if (potWon) { try { w = C.wallet.credit(key, mode, potWon.amount, { ...ref, pot: true }); } catch (e) { logf('coldcall: pot credit failed', rec.id, e && e.message); w = C.wallet.get(key); } }
  if (wasOpen && C.wallet.flush) C.wallet.flush();

  const callback = r.callback != null ? !!r.callback : !!rec.callback;
  const auto = autoWhy || null;
  const h = history.get(rec.nk) || [];
  h.unshift({ roundId: rec.id, t: rec.t, bet: betCents, cost, mode, buy: rec.buy, totalWin: winCents, tier: r.tier, callback, auto, pot: potWon });
  if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
  history.set(rec.nk, h);

  const result = {
    roundId: rec.id, status: 'done', pending: null, resolved: wasOpen, auto, bet: betCents, betCents, cost, mode, buyBonus: rec.buy, callback,
    script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, totalWin: winCents, tier: r.tier, maxed: r.capped,
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
    if (r.winX >= minWinX) pushFeed('win', rec, r.winX, winCents, bonusKind || undefined);
    if (r.pull && r.pull.armed) pushFeed('callback', rec, 0, 0);
    if (potWon) pushFeed('pot', rec, potWon.amount / betCents, potWon.amount);
    if (potMoved) broadcast('floor:pot', { mode, bal: pot.bal });
  } catch (e) { logf('coldcall: feed failed', rec.id, e && e.message); }
  return result;
}

// Refund a round (restart, or a round the engine could not default or settle). Record dropped first, then the cost credited once.
function voidRound(rec, why) {
  if (rec.settled) return;
  rec.settled = true;
  if (open.has(rec.id)) dropOpen(rec);
  store.delOpen(rec.nk, rec.mode); store.flush();
  let w = null;
  try { w = C.wallet.credit(rec.key, rec.mode, rec.cost, { game: 'coldcall', round: rec.id, void: why }); } catch (e) { logf('coldcall: refund failed', rec.id, e && e.message); }
  if (C.wallet.flush) C.wallet.flush();
  logf('coldcall: voided round', rec.id, why, 'refund', rec.cost, rec.mode);
  emitAcct(rec, 'g:coldcall:voided', { roundId: rec.id, mode: rec.mode, refund: rec.cost, reason: why, wallet: w });
}

// take the safe default for every remaining decision of an open round and settle it
function autoSettle(rec, why) {
  if (rec.settled || !open.has(rec.id)) return;
  let r = null;
  try { r = runRound(rec, rec.decisions, true); } catch (e) { r = null; }
  if (!r || r.status !== 'done') return voidRound(rec, 'unresolvable');
  settle(rec, r, why);
}

// restart: every open round from the last run is refunded exactly once
function voidStored() {
  for (const o of store.allOpen()) {
    store.delOpen(o.key, o.mode); store.flush();
    try { C.wallet.credit(o.key, o.mode, o.cost, { game: 'coldcall', round: o.roundId, void: 'restart' }); } catch (e) { logf('coldcall: refund failed', o.roundId, e && e.message); }
    logf('coldcall: voided round at restart', o.roundId, 'refund', o.cost, o.mode, o.key);
  }
  if (C.wallet.flush) C.wallet.flush();
}

function pullSpin(socket, p, buy, now) {
  const key = keyOf(socket), nk = nkey(key), mode = p.mode;
  const ok = nk + '|' + mode;
  const o = openByKey.get(ok);
  if (o) return err(socket, 'decision_open', 'Finish your open decision first', { open: pendingView(o) });
  const day = chicagoDay(now);
  const state = loadState(nk, mode);
  const callback = buy === null && !!state.cb;
  const force = testHookOn() && buy === null && FORCES.includes(p.force) ? p.force : null;
  const rec = {
    id: crypto.randomBytes(6).toString('hex'), key, nk, mode, who: whoOf(socket), socket, buy, bet: p.bet,
    betCents: callback ? state.cb.bet : p.bet, callback, state, now, day, t: now, tape: [], decisions: [], force, forced: force,
  };
  try {
    rec.cfg = snap(pullCfg());             // the knobs this round is played, defaulted and settled under (Infinity preserved)
    rec.cfgx = {}; for (const k of SNAP_KNOBS) if (Object.prototype.hasOwnProperty.call(Eng.CFG, k)) rec.cfgx[k] = snap(Eng.CFG[k]);
  } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
  const auto = p.auto === true;
  let r, cost;
  try {
    r = runRound(rec, [], auto);
    if (r.betCents != null) rec.betCents = r.betCents;
    rec.costTenths = r.costTenths;
    cost = r.costTenths ? Eng.cents(r.costTenths, rec.betCents) : 0;
  } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
  rec.cost = cost;
  if (cost > 0) { try { C.wallet.spend(key, mode, cost, { game: 'coldcall', round: rec.id }); } catch (e) { return walletErr(socket, e); } }

  if (r.status === 'pending') {
    // the cost is taken: anything that throws from here on ends in one refund, never an open round without a timer (W1B N4)
    try {
      rec.pending = r.pending; rec.partial = r.partial;
      open.set(rec.id, rec); openByKey.set(ok, rec);
      store.putOpen({ roundId: rec.id, key: nk, mode, cost, bet: rec.betCents, buy, t: now, cfg: rec.cfg });
      armTimer(rec);
      if (C.wallet.flush) C.wallet.flush();
      store.flush();
      const view = pendingView(rec);
      socket.emit('g:coldcall:result', view);
    } catch (e) { logf('coldcall: pending path failed, voiding', rec.id, e && e.message); voidRound(rec, 'open_error'); }
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
  init(ctx) {
    this.rng = ctx.rng || cryptoRng();
    clearTimers(); open.clear(); openByKey.clear(); rateLast.clear(); readyLast.clear();
    if (store) store.close();
    C = ctx; feed = []; feedSeq = 0;
    const file = process.env.COLDCALL_PULL_FILE || (ctx.wallet && ctx.wallet.file ? path.join(path.dirname(ctx.wallet.file), 'coldcall-pull.json') : null);
    store = createStore(file);
    voidStored();
  },
  onDisconnect(socket) {
    for (const rec of [...open.values()]) if (rec.socket === socket) { try { autoSettle(rec, 'disconnect'); } catch {} }
  },
  handlers: {
    state(socket, payload, ctx) {
      const w = ctx.wallet.get(keyOf(socket));
      const extra = {};
      if (pullOn() && store) {
        const now = ctx.now(), day = chicagoDay(now), nk = nkey(keyOf(socket));
        const opens = ['play', 'chips'].map((m) => openByKey.get(nk + '|' + m)).filter(Boolean).map(pendingView);
        extra.pull = { on: true, rules: clone(pullCfg()), list: pullCfg().list, decisionMs: pullCfg().decision.timeoutMs, play: stateView(loadState(nk, 'play'), now, day), chips: stateView(loadState(nk, 'chips'), now, day) };
        extra.pot = potsView(); extra.feed = feed.slice(-FEED_STATE); extra.open = opens[0] || null; extra.opens = opens;
      }
      socket.emit('g:coldcall:state', {
        engine: 2, grid: { cols: Eng.COLS, rows: Eng.ROWS },
        betLevels: BET_LEVELS, modes: ['play', 'chips'], rtp: RTP_LABEL, maxWinX: Eng.MAX_WIN_X,
        buyCostX: Object.fromEntries(BUYS.map((b) => [b, Eng.CFG.buyCost[b] / 10])),
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
      if (!rec) return err(socket, 'no_round', 'No open decision');
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
      let r;
      try { r = runRound(rec, decisions, false); } catch (e) { return err(socket, 'bad_request', 'Invalid decision'); }
      rec.decisions = decisions;
      if (r.status === 'pending') {
        rec.pending = r.pending; rec.partial = r.partial;
        armTimer(rec);
        const v = pendingView(rec);
        for (const s of new Set([rec.socket, socket])) if (s) { try { s.emit('g:coldcall:result', v); } catch {} }
        return;
      }
      settle(rec, r, null, socket);
    },
    // The prompt is on screen: give the open decision a full timeoutMs from now, ONCE per decision (the ONE MORE CALL event carries the whole bonus,
    // whose animation runs longer than the timer that started when the event was sent). Never past armedAt + 2 x timeoutMs. Answers every socket of the account.
    ready(socket, payload, ctx) {
      const t = ctx.now(), rk = nkey(keyOf(socket)), prev = readyLast.get(rk);
      if (prev != null && t >= prev && t - prev < RATE_MS) return err(socket, 'rate', 'Slow down');
      readyLast.set(rk, t);
      const p = payload && typeof payload === 'object' ? payload : {};
      if (typeof p.roundId !== 'string') return err(socket, 'no_round', 'No open decision');
      const rec = open.get(p.roundId);
      if (!rec) return err(socket, 'no_round', 'No open decision');
      if (rec.nk !== rk) return err(socket, 'forbidden', 'Not your round');
      if (!rec.readyDone) {
        const room = rec.armedAt + 2 * rec.timeoutMs - t;       // what is left of the 2 x timeoutMs this decision may ever be held
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

      const key = keyOf(socket);
      const rng = module.exports.rng || cryptoRng();
      const roundId = crypto.randomBytes(6).toString('hex');
      const force = testHookOn() && buy === null && FORCES.includes(p.force) ? p.force : null;
      const r = force ? resolveForced(rng, force) : Eng.resolveRound(rng, buy);   // pure; nothing touched yet
      let cost, totalWin;
      try { cost = Eng.cents(r.costTenths, p.bet); totalWin = Eng.cents(r.winTenths, p.bet); } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
      const ref = { game: 'coldcall', round: roundId };
      let w;
      try { ctx.wallet.spend(key, p.mode, cost, ref); } catch (e) { return walletErr(socket, e); }
      try { w = ctx.wallet.credit(key, p.mode, totalWin, ref); } catch (e) { w = ctx.wallet.get(key); }

      const hk = nkey(key), h = history.get(hk) || [];
      h.unshift({ roundId, t, bet: p.bet, cost, mode: p.mode, buy, totalWin, tier: r.tier });
      if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
      history.set(hk, h);

      socket.emit('g:coldcall:result', {
        roundId, bet: p.bet, cost, mode: p.mode, buyBonus: buy,
        script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, totalWin, tier: r.tier, maxed: r.capped,
        wallet: w, balances: w,
        ...(force ? { forced: force } : {}),
      });
    },
  },
  _history: history,
  _pull: { open, get store() { return store; } },
};

// reserved names never reach the wallet, the store or the history (default-on-logout needs server.js and is not done here)
for (const [ev, fn] of Object.entries(module.exports.handlers)) {
  module.exports.handlers[ev] = function (socket, ...rest) {
    if (reserved(keyOf(socket))) return err(socket, 'bad_request', 'That account name cannot play here');
    return fn.call(this, socket, ...rest);
  };
}
